package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Contas implementa portas.Contas (Fase 6, db/queries/conta.sql).
type Contas struct {
	pool *pgxpool.Pool
	// chave do CPF (pgcrypto). Vem da configuração, nunca do código.
	chaveCPF string
}

func NovasContas(pool *pgxpool.Pool, chaveCPF string) *Contas {
	return &Contas{pool: pool, chaveCPF: chaveCPF}
}

// Criar grava cliente, endereço e credencial numa transação: não existe
// "cliente sem senha" nem "senha sem cliente" pela metade.
func (a *Contas) Criar(ctx context.Context, c dominio.Cadastro, senhaHash string) (uuid.UUID, error) {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	// A chave do CPF vai como parâmetro do INSERT — e o log de consultas
	// lentas (log_min_duration_statement) registra os parâmetros. SET LOCAL:
	// só nesta transação, o log fica desligado. (Exige superusuário — a API
	// ainda é; veja docs/fases/fase-6.md.)
	if _, err := tx.Exec(ctx, "SET LOCAL log_min_duration_statement = -1"); err != nil {
		return uuid.Nil, err
	}
	q := sqlcdb.New(tx)
	id, err := q.CriarCliente(ctx, sqlcdb.CriarClienteParams{Nome: c.Nome, Email: c.Email, Cpf: c.CPF, Chave: a.chaveCPF})
	if err != nil {
		return uuid.Nil, traduzirCadastro(err)
	}
	e := c.Endereco
	if _, err := q.CriarEndereco(ctx, sqlcdb.CriarEnderecoParams{ClienteID: id, Cep: e.CEP, Logradouro: e.Logradouro,
		Numero: e.Numero, Complemento: e.Complemento, Cidade: e.Cidade, Uf: e.UF}); err != nil {
		return uuid.Nil, err
	}
	if err := q.CriarCredencial(ctx, sqlcdb.CriarCredencialParams{ClienteID: id, SenhaHash: senhaHash}); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

// traduzirCadastro: o UNIQUE violado diz qual dado já tem conta.
func traduzirCadastro(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		switch pg.ConstraintName {
		case "cliente_email_key":
			return dominio.ErrEmailEmUso
		case "cliente_cpf_hmac_key":
			return dominio.ErrCpfEmUso
		}
	}
	return err
}

func (a *Contas) Credencial(ctx context.Context, email string) (uuid.UUID, string, error) {
	r, err := sqlcdb.New(a.pool).CredencialPorEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", dominio.ErrCredenciais
	}
	return r.ID, r.SenhaHash, err
}

func (a *Contas) RegistrarAcesso(ctx context.Context, cliente uuid.UUID) error {
	return sqlcdb.New(a.pool).RegistrarAcesso(ctx, cliente)
}

func (a *Contas) Conta(ctx context.Context, cliente uuid.UUID) (dominio.Conta, error) {
	r, err := sqlcdb.New(a.pool).ContaPorID(ctx, cliente)
	if errors.Is(err, pgx.ErrNoRows) {
		return dominio.Conta{}, dominio.ErrNaoAutenticado
	}
	return dominio.Conta{ClienteID: r.ID, Nome: r.Nome, Email: r.Email, EmailMascarado: r.EmailMascarado,
		CPFMascarado: r.CpfMascarado, EnderecoID: r.EnderecoID, Cidade: r.Cidade, Uf: r.Uf}, err
}

// Esquecer chama a procedure conta.esquecer_cliente (migração 00008).
func (a *Contas) Esquecer(ctx context.Context, cliente uuid.UUID) error {
	err := sqlcdb.New(a.pool).EsquecerCliente(ctx, cliente)
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "P0002" { // no_data_found: já anonimizado
		return dominio.ErrNaoAutenticado
	}
	return err
}

// ------------------------------------------------------------ meus pedidos

// MeusPedidos implementa portas.MeusPedidos com Row-Level Security: cada
// leitura roda numa transação que assume o papel loja_cliente e diz ao banco
// quem é o cliente (app.cliente_id). As policies da migração 00008 fazem o
// resto — mesmo que uma consulta esqueça o WHERE, o banco não devolve pedido
// de outra pessoa (cenário W1).
type MeusPedidos struct{ pool *pgxpool.Pool }

func NovosMeusPedidos(pool *pgxpool.Pool) *MeusPedidos { return &MeusPedidos{pool: pool} }

// comoCliente abre a transação de leitura já no papel do cliente.
func (a *MeusPedidos) comoCliente(ctx context.Context, cliente uuid.UUID, ler func(*sqlcdb.Queries) error) error {
	tx, err := a.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// SET LOCAL ROLE / set_config(…, true): valem só até o fim da transação —
	// a conexão volta ao pool limpa, sem o papel nem o cliente de ninguém.
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE loja_cliente"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('app.cliente_id', $1, true)", cliente.String()); err != nil {
		return err
	}
	if err := ler(sqlcdb.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *MeusPedidos) Lista(ctx context.Context, cliente uuid.UUID, limite int32) ([]dominio.PedidoResumo, error) {
	var out []dominio.PedidoResumo
	err := a.comoCliente(ctx, cliente, func(q *sqlcdb.Queries) error {
		rows, err := q.ListarPedidosDoCliente(ctx, sqlcdb.ListarPedidosDoClienteParams{ClienteID: cliente, Limite: limite})
		out = make([]dominio.PedidoResumo, len(rows))
		for i, p := range rows {
			out[i] = dominio.PedidoResumo{ID: p.ID, Status: p.Status, Total: dinheiro(p.Total), CriadoEm: p.CriadoEm, Itens: p.Itens}
		}
		return err
	})
	return out, err
}

func (a *MeusPedidos) Detalhe(ctx context.Context, cliente, pedido uuid.UUID) (dominio.PedidoDetalhe, error) {
	var d dominio.PedidoDetalhe
	err := a.comoCliente(ctx, cliente, func(q *sqlcdb.Queries) (err error) {
		d, err = lerPedido(ctx, q, pedido)
		return err
	})
	return d, err
}
