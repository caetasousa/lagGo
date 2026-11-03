//go:build integration

package aplicacao_test

import (
	"context"
	"os"
	"testing"

	lojapg "github.com/nosqlgo/marketplace/internal/loja/adaptadores/postgres"
	lojaapp "github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	lojadominio "github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/painel/adaptadores/postgres"
	"github.com/nosqlgo/marketplace/internal/painel/aplicacao"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

// Como quebra: a procedure cancela o pedido mas não devolve o estoque, cancela
// pedidos recentes, ou toca em pedidos que não estão PENDENTES.
func TestCancelarExpiradosDevolveEstoque(t *testing.T) {
	pool := testinfra.Postgres(t)
	loja := testinfra.SemearLoja(t, pool)
	ctx := context.Background()
	svc := lojaapp.NovoCheckout(lojapg.NovosPedidos(pool))
	sku := loja.Skus[0]

	comprar := func(i int) string {
		r, err := svc.Finalizar(ctx, lojadominio.Pedido{
			ClienteID: loja.Clientes[i].ID, EnderecoID: loja.Clientes[i].EnderecoID, MetodoPagamento: "PIX",
			Itens: []lojadominio.Item{{SkuID: sku.ID, Quantidade: 3}},
		}, lojadominio.Opcoes{})
		if err != nil {
			t.Fatal(err)
		}
		return r.PedidoID.String()
	}
	velho, recente, pago := comprar(0), comprar(1), comprar(2)
	_, err := pool.Exec(ctx, `UPDATE pedido SET status = 'PENDENTE', criado_em = now() - interval '3 days' WHERE id = $1`, velho)
	if err == nil {
		_, err = pool.Exec(ctx, `UPDATE pedido SET status = 'PENDENTE' WHERE id = $1`, recente)
	}
	if err == nil {
		_, err = pool.Exec(ctx, `UPDATE pedido SET criado_em = now() - interval '3 days' WHERE id = $1`, pago)
	}
	if err != nil {
		t.Fatal(err)
	}

	pg := postgres.Novo(pool)
	res, err := aplicacao.NovoPainel(pg, pg, nil, nil, nil, nil).CancelarExpirados(ctx, 48, 1)
	if err != nil || res.Cancelados != 1 {
		t.Fatalf("esperava 1 cancelado, veio %+v (%v)", res, err)
	}

	status := map[string]string{}
	rows, _ := pool.Query(ctx, `SELECT id::text, status FROM pedido`)
	for rows.Next() {
		var id, st string
		_ = rows.Scan(&id, &st)
		status[id] = st
	}
	if status[velho] != "CANCELADO" || status[recente] != "PENDENTE" || status[pago] != "PAGO" {
		t.Fatalf("status errados: %v", status)
	}
	var estoque int32
	_ = pool.QueryRow(ctx, `SELECT quantidade FROM estoque WHERE sku_id = $1`, sku.ID).Scan(&estoque)
	if estoque != sku.Estoque-6 { // 3 pedidos de 3, um devolvido
		t.Fatalf("estoque %d, esperado %d", estoque, sku.Estoque-6)
	}
}

func TestMain(m *testing.M) {
	code := m.Run()
	testinfra.Encerrar()
	os.Exit(code)
}
