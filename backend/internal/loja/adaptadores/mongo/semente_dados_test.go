package mongo

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Como quebra: o gerador de uma categoria entra em pânico ou monta um produto
// que o $jsonSchema recusaria (sem nome, sem SKU, sem preço). A fixture de
// integração só tem Notebooks e Monitores; este teste passa por todas.
func TestGeradoresDeTodasAsCategorias(t *testing.T) {
	for nome := range modelos {
		for i := range 3000 {
			sku := sqlcdb.SkusParaCatalogoRow{ID: uuid.New(), Preco: "199.90", Vendedor: "Loja"}
			cat := sqlcdb.CategoriasComAncestraisRow{ID: int32(i), Nome: nome, Caminho: "Raiz > " + nome, Ancestrais: []int32{1, int32(i)}}
			p := montarProduto([]sqlcdb.SkusParaCatalogoRow{sku}, cat, time.Now())
			if len([]rune(p.Nome)) < 3 || len(p.Skus) != 1 || p.PrecoMin.String() != "199.90" || len(p.Atributos) == 0 {
				t.Fatalf("%s: produto inválido: %+v", nome, p)
			}
		}
	}
}
