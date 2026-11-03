//go:build integration

// O caso de uso de checkout com o adaptador DE VERDADE do PostgreSQL, num
// banco efêmero (testinfra). Nada de banco falso: transação, trigger, CHECK e
// FK composta só se testam no banco. Rode com: make check-db
package aplicacao_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/loja/adaptadores/postgres"
	"github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

func novoCenario(t *testing.T) (*aplicacao.Checkout, *pgxpool.Pool, testinfra.Loja) {
	t.Helper()
	pool := testinfra.Postgres(t)
	return aplicacao.NovoCheckout(postgres.NovosPedidos(pool)), pool, testinfra.SemearLoja(t, pool)
}

func pedidoDe(c testinfra.Cliente, itens ...dominio.Item) dominio.Pedido {
	return dominio.Pedido{ClienteID: c.ID, EnderecoID: c.EnderecoID, Itens: itens, MetodoPagamento: "PIX"}
}

// Como quebra: o total (atributo derivado mantido por trigger) diverge dos itens.
func TestTotalMantidoPorTrigger(t *testing.T) {
	svc, pool, loja := novoCenario(t)
	ctx := context.Background()
	res, err := svc.Finalizar(ctx, pedidoDe(loja.Clientes[0],
		dominio.Item{SkuID: loja.Skus[0].ID, Quantidade: 2},
		dominio.Item{SkuID: loja.Skus[1].ID, Quantidade: 1},
		dominio.Item{SkuID: loja.Skus[0].ID, Quantidade: 1}, // repetido: soma com o primeiro
	), dominio.Opcoes{})
	if err != nil {
		t.Fatal(err)
	}
	var iguais bool
	var qtd int32
	err = pool.QueryRow(ctx, `
SELECT p.total = (SELECT sum(i.quantidade * i.preco_unitario) FROM item_pedido i WHERE i.pedido_id = p.id),
       (SELECT quantidade FROM item_pedido WHERE pedido_id = p.id AND sku_id = $2)
  FROM pedido p WHERE p.id = $1`, res.PedidoID, loja.Skus[0].ID).Scan(&iguais, &qtd)
	if err != nil {
		t.Fatal(err)
	}
	if !iguais || qtd != 3 {
		t.Fatalf("total confere=%v, quantidade somada=%d (esperado 3)", iguais, qtd)
	}
}

// Como quebra: repetir a requisição (timeout, duplo clique) cria dois pedidos
// ou baixa o estoque duas vezes.
func TestIdempotenciaReaproveitaPedido(t *testing.T) {
	svc, pool, loja := novoCenario(t)
	ctx := context.Background()
	chave := uuid.New()
	p := pedidoDe(loja.Clientes[0], dominio.Item{SkuID: loja.Skus[0].ID, Quantidade: 1})
	p.Chave = &chave

	r1, err := svc.Finalizar(ctx, p, dominio.Opcoes{})
	if err != nil {
		t.Fatal(err)
	}
	r2, err := svc.Finalizar(ctx, p, dominio.Opcoes{})
	if err != nil {
		t.Fatal(err)
	}
	if !r2.Reaproveitado || r2.PedidoID != r1.PedidoID {
		t.Fatalf("segunda chamada criou outro pedido: %v × %v", r1, r2)
	}
	var estoque int32
	_ = pool.QueryRow(ctx, `SELECT quantidade FROM estoque WHERE sku_id = $1`, loja.Skus[0].ID).Scan(&estoque)
	if estoque != loja.Skus[0].Estoque-1 {
		t.Fatalf("estoque baixou duas vezes: %d", estoque)
	}
}

// Como quebra: falha no meio deixa pedido pela metade (atomicidade).
func TestSemEstoqueDesfazTudo(t *testing.T) {
	svc, pool, loja := novoCenario(t)
	ctx := context.Background()
	_, err := svc.Finalizar(ctx, pedidoDe(loja.Clientes[0],
		dominio.Item{SkuID: loja.Skus[0].ID, Quantidade: 1},
		dominio.Item{SkuID: loja.Skus[1].ID, Quantidade: 999}, // estoque é 50
	), dominio.Opcoes{})
	if !errors.Is(err, dominio.ErrSemEstoque) {
		t.Fatalf("esperava ErrSemEstoque, veio %v", err)
	}
	var pedidos, estoque int32
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM pedido`).Scan(&pedidos)
	_ = pool.QueryRow(ctx, `SELECT quantidade FROM estoque WHERE sku_id = $1`, loja.Skus[0].ID).Scan(&estoque)
	if pedidos != 0 || estoque != loja.Skus[0].Estoque {
		t.Fatalf("ROLLBACK incompleto: %d pedidos, estoque %d", pedidos, estoque)
	}
}

// Como quebra: o banco aceita entregar no endereço de OUTRO cliente.
func TestEnderecoDeOutroClienteRecusado(t *testing.T) {
	svc, _, loja := novoCenario(t)
	p := pedidoDe(loja.Clientes[0], dominio.Item{SkuID: loja.Skus[0].ID, Quantidade: 1})
	p.EnderecoID = loja.Clientes[1].EnderecoID
	var v dominio.ErrValidacao
	if _, err := svc.Finalizar(context.Background(), p, dominio.Opcoes{}); !errors.As(err, &v) {
		t.Fatalf("esperava ErrValidacao (FK composta), veio %v", err)
	}
}
