package dominio

import "slices"

// Laboratório Grafo × SQL (Fase 7, Neo4j e PostgreSQL, docs/07): a MESMA
// pergunta nos dois bancos, com o tempo e a resposta lado a lado.

var PerguntasDoGrafo = []string{"tambem_comprou", "alcance"}

func ValidarPerguntaDoGrafo(p string) error {
	if !slices.Contains(PerguntasDoGrafo, p) {
		return ErrValidacao{"pergunta deve ser tambem_comprou ou alcance"}
	}
	return nil
}

// LinhaGrafo: um SKU e a força (clientes distintos) — ou só o total, no alcance.
type LinhaGrafo struct {
	SkuID string `json:"sku_id"`
	Forca int64  `json:"forca"`
}

// Medida: a resposta de um banco, o tempo e a consulta exata.
type Medida struct {
	Banco    string       `json:"banco"`
	Consulta string       `json:"consulta"`
	MS       float64      `json:"ms"`
	Linhas   []LinhaGrafo `json:"linhas"`
	Total    int64        `json:"total"` // alcance: clientes a 3 saltos
}

type ResultadoGrafo struct {
	Pergunta string `json:"pergunta"`
	SkuID    string `json:"sku_id"`
	Grafo    Medida `json:"grafo"`
	SQL      Medida `json:"sql"`
	Iguais   bool   `json:"iguais"` // as duas respostas batem (Y3)
}

// MesmaResposta: o top (sku e força, na ordem) e o total são iguais.
func MesmaResposta(a, b Medida) bool {
	return a.Total == b.Total && slices.Equal(a.Linhas, b.Linhas)
}

// SkuParaOGrafo: os SKUs que a tela oferece (os de mais compradores).
type SkuParaOGrafo struct {
	ID          string `json:"id"`
	Descricao   string `json:"descricao"`
	Compradores int64  `json:"compradores"`
}
