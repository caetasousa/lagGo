//go:build integration

// A corrida com os adaptadores DE VERDADE: o estoque no PostgreSQL e o
// checkout da loja (pela ponte laboratorio/adaptadores/loja).
package aplicacao_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/loja"
	"github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/postgres"
	"github.com/nosqlgo/marketplace/internal/laboratorio/aplicacao"
	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	lojapg "github.com/nosqlgo/marketplace/internal/loja/adaptadores/postgres"
	lojaapp "github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testinfra.Encerrar()
	os.Exit(code)
}

func novaCorrida(t *testing.T) *aplicacao.Corrida {
	t.Helper()
	pool := testinfra.Postgres(t)
	testinfra.SemearLoja(t, pool)
	return aplicacao.NovaCorrida(postgres.NovoEstoque(pool), loja.Nova(lojaapp.NovoCheckout(lojapg.NovosPedidos(pool))))
}

// Como quebra: uma estratégia "correta" vende além do estoque sob disputa.
func TestCorridaEstrategiasCorretasNuncaVendemAMais(t *testing.T) {
	svc := novaCorrida(t)
	for _, e := range []string{"for_update", "condicional", "serializavel"} {
		for _, atraso := range []int{0, 20} {
			t.Run(fmt.Sprintf("%s/atraso=%dms", e, atraso), func(t *testing.T) {
				r, err := svc.Rodar(context.Background(), dominio.CorridaParams{
					Estrategia: e, Compradores: 30, EstoqueInicial: 5, AtrasoMS: atraso,
				})
				if err != nil {
					t.Fatal(err)
				}
				if r.Vendidos > 5 || !r.Consistente {
					t.Fatalf("vendeu %d com estoque 5 (estoque final %d)", r.Vendidos, r.EstoqueFinal)
				}
				// SERIALIZABLE pode esgotar as tentativas: esses recebem erro,
				// mas nenhum vende a mais.
				if e != "serializavel" && r.Vendidos != 5 {
					t.Fatalf("esperava 5 vendas, veio %d", r.Vendidos)
				}
			})
		}
	}
}

// Como quebra: o laboratório deixa de demonstrar o lost update (alguém
// "consertou" a estratégia ingênua e a aula perdeu o contraexemplo).
func TestCorridaIngenuaDemonstraLostUpdate(t *testing.T) {
	svc := novaCorrida(t)
	r, err := svc.Rodar(context.Background(), dominio.CorridaParams{
		Estrategia: "ingenua", Compradores: 30, EstoqueInicial: 5, AtrasoMS: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.VendasAMais == 0 || r.Consistente {
		t.Fatalf("a ingênua deveria vender a mais com atraso de 50 ms; vendeu %d", r.Vendidos)
	}
}
