// Package postgres são os ADAPTADORES da loja para o PostgreSQL: implementam
// as portas de pedidos, ofertas, clientes, vitrine e relatórios com o SQL
// gerado pelo sqlc (db/queries). Todo o SQL e todo conhecimento do
// PostgreSQL da loja (transação, nível de isolamento, SQLSTATE) mora aqui.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Pedidos implementa portas.Pedidos. A baixa de estoque tem quatro
// estratégias, comparadas no Laboratório de Concorrência (docs/03):
//
//	ingenua       lê e grava sem lock (READ COMMITTED)       → lost update
//	for_update    SELECT ... FOR UPDATE (lock pessimista)    → correto, serializa na linha
//	condicional   UPDATE ... WHERE quantidade >= x           → correto, um comando só
//	serializavel  lê e grava sem lock, mas em SERIALIZABLE   → correto, com abortos (repetidos pela aplicação)
type Pedidos struct {
	pool *pgxpool.Pool
}

func NovosPedidos(pool *pgxpool.Pool) *Pedidos { return &Pedidos{pool: pool} }

// Criar: uma transação ACID — pedido, itens, estoque e pagamento, ou nada.
func (a *Pedidos) Criar(ctx context.Context, p dominio.Pedido, itens []dominio.Item, op dominio.Opcoes) (dominio.Resultado, error) {
	iso := pgx.ReadCommitted
	if op.Estrategia == dominio.Serializavel {
		iso = pgx.Serializable
	}
	var res dominio.Resultado
	err := pgx.BeginTxFunc(ctx, a.pool, pgx.TxOptions{IsoLevel: iso}, func(tx pgx.Tx) error {
		var err error
		res, err = executar(ctx, sqlcdb.New(tx), p, itens, op)
		return err // erro → ROLLBACK; nil → COMMIT
	})
	return res, traduzir(err)
}

// traduzir converte o que o PostgreSQL disse em erros que o negócio conhece.
func traduzir(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch {
	case pgErr.Code == "40001" || pgErr.Code == "40P01":
		// serialization_failure / deadlock_detected: o banco abortou a
		// transação inteira. A aplicação decide repetir.
		return fmt.Errorf("%w: %s (%s)", dominio.ErrConflito, pgErr.Message, pgErr.Code)
	case pgErr.Code == "23505" && pgErr.ConstraintName == "pedido_chave_idempotencia_key":
		return dominio.ErrChaveRepetida
	case pgErr.Code == "23503" && pgErr.TableName == "pedido":
		return dominio.ErrValidacao{Msg: "cliente ou endereço inexistente (ou endereço de outro cliente)"}
	case pgErr.Code == "23514" && pgErr.ConstraintName == "estoque_quantidade_check":
		// O CHECK (quantidade >= 0) é a última linha de defesa.
		return dominio.ErrSemEstoque
	}
	return err
}

func executar(ctx context.Context, q *sqlcdb.Queries, p dominio.Pedido, itens []dominio.Item, op dominio.Opcoes) (dominio.Resultado, error) {
	// 1. Pedido primeiro: se a chave de idempotência já existe, falha aqui,
	//    antes de tocar no estoque.
	pedidoID, err := q.CriarPedido(ctx, sqlcdb.CriarPedidoParams{
		ClienteID: p.ClienteID, EnderecoID: p.EnderecoID, ChaveIdempotencia: p.Chave,
	})
	if err != nil {
		return dominio.Resultado{}, err
	}

	// 2. Preço vigente de cada SKU (vira preco_unitario do item).
	ids := make([]uuid.UUID, len(itens))
	for i, it := range itens {
		ids[i] = it.SkuID
	}
	skus, err := q.BuscarSkusParaVenda(ctx, ids)
	if err != nil {
		return dominio.Resultado{}, err
	}
	precos := make(map[uuid.UUID]pgtype.Numeric, len(skus))
	for _, s := range skus {
		if s.Ativo {
			precos[s.ID] = s.Preco
		}
	}

	// 3. Estoque e itens, na ordem de sku_id que o domínio garantiu (evita deadlock).
	for i, it := range itens {
		preco, ok := precos[it.SkuID]
		if !ok {
			return dominio.Resultado{}, dominio.ErrSkuInvalido
		}
		if err := baixarEstoque(ctx, q, it, op); err != nil {
			return dominio.Resultado{}, err
		}
		err := q.InserirItemPedido(ctx, sqlcdb.InserirItemPedidoParams{
			PedidoID: pedidoID, Numero: int16(i + 1), SkuID: it.SkuID,
			Quantidade: it.Quantidade, PrecoUnitario: preco,
		})
		if err != nil {
			return dominio.Resultado{}, err
		}
	}

	// 4. Total (atributo derivado) e pagamento.
	total, err := q.FecharPedido(ctx, pedidoID)
	if err != nil {
		return dominio.Resultado{}, err
	}
	err = q.RegistrarPagamento(ctx, sqlcdb.RegistrarPagamentoParams{
		PedidoID: pedidoID, Metodo: p.MetodoPagamento, Valor: total,
	})
	if err != nil {
		return dominio.Resultado{}, err
	}
	return dominio.Resultado{PedidoID: pedidoID, Total: dinheiro(total)}, nil
}

func baixarEstoque(ctx context.Context, q *sqlcdb.Queries, it dominio.Item, op dominio.Opcoes) error {
	switch op.Estrategia {
	case dominio.Ingenua, dominio.Serializavel:
		// Lê → decide na aplicação → grava valor absoluto.
		// Em READ COMMITTED, duas transações podem ler o mesmo valor e ambas
		// gravarem "atual - 1": uma venda some (lost update).
		// Em SERIALIZABLE, o PostgreSQL detecta o conflito e aborta uma delas (40001).
		atual, err := q.LerEstoque(ctx, it.SkuID)
		if err != nil {
			return semLinhaComoSkuInvalido(err)
		}
		if atual < it.Quantidade {
			return dominio.ErrSemEstoque
		}
		if err := esperar(ctx, op.Atraso); err != nil {
			return err
		}
		return q.GravarEstoque(ctx, sqlcdb.GravarEstoqueParams{Quantidade: atual - it.Quantidade, SkuID: it.SkuID})

	case dominio.ForUpdate:
		// Trava a linha: quem chegar depois espera o COMMIT e então lê o valor novo.
		atual, err := q.LerEstoqueComLock(ctx, it.SkuID)
		if err != nil {
			return semLinhaComoSkuInvalido(err)
		}
		if atual < it.Quantidade {
			return dominio.ErrSemEstoque
		}
		if err := esperar(ctx, op.Atraso); err != nil {
			return err
		}
		return q.DebitarEstoque(ctx, sqlcdb.DebitarEstoqueParams{Quantidade: it.Quantidade, SkuID: it.SkuID})

	case dominio.Condicional:
		// Verificação e escrita no MESMO comando: o UPDATE trava a linha e
		// reavalia o WHERE com o valor mais recente.
		n, err := q.DebitarEstoqueSeHouver(ctx, sqlcdb.DebitarEstoqueSeHouverParams{Quantidade: it.Quantidade, SkuID: it.SkuID})
		if err != nil {
			return err
		}
		if n == 0 {
			return dominio.ErrSemEstoque
		}
		return esperar(ctx, op.Atraso) // segura o lock da linha durante o atraso
	}
	return dominio.ErrValidacao{Msg: fmt.Sprintf("estratégia desconhecida: %q", op.Estrategia)}
}

// PorChave: o pedido criado com esta Idempotency-Key.
func (a *Pedidos) PorChave(ctx context.Context, chave uuid.UUID) (dominio.Resultado, error) {
	q := sqlcdb.New(a.pool)
	id, err := q.BuscarPedidoPorChave(ctx, &chave)
	if errors.Is(err, pgx.ErrNoRows) {
		return dominio.Resultado{}, dominio.ErrPedidoNaoEncontrado
	}
	if err != nil {
		return dominio.Resultado{}, err
	}
	p, err := q.BuscarPedido(ctx, id)
	if err != nil {
		return dominio.Resultado{}, err
	}
	return dominio.Resultado{PedidoID: id, Total: dinheiro(p.Total)}, nil
}

func semLinhaComoSkuInvalido(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return dominio.ErrSkuInvalido
	}
	return err
}

func esperar(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
