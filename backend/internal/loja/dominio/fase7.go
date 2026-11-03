package dominio

import (
	"time"

	"github.com/google/uuid"
)

// Fase 7 (docs/07-nosql.md): "vistos recentemente" no Cassandra e "quem
// comprou também comprou" no Neo4j.

// VistosNaVitrine: quantos produtos distintos a vitrine mostra.
const VistosNaVitrine = 8

// RetencaoDosVistos: o TTL de cada evento no Cassandra — o histórico de
// navegação some sozinho (minimização da LGPD; cenário X2).
const RetencaoDosVistos = 30 * 24 * time.Hour

// Visto: um produto aberto por um cliente. O nome vai junto (cópia do
// MongoDB): no Cassandra não existe JOIN — a tabela guarda o que a consulta
// precisa mostrar (desnormalização).
type Visto struct {
	ProdutoID string    `json:"produto_id"`
	Nome      string    `json:"nome"`
	Em        time.Time `json:"em"`
}

// Distintos: os mais recentes primeiro, sem repetir produto, até n
// (cenário X1). Recebe os eventos já do mais novo para o mais antigo.
func Distintos(eventos []Visto, n int) []Visto {
	vistos := map[string]bool{}
	out := []Visto{}
	for _, e := range eventos {
		if vistos[e.ProdutoID] {
			continue
		}
		vistos[e.ProdutoID] = true
		out = append(out, e)
		if len(out) == n {
			break
		}
	}
	return out
}

// Coocorrencia: um SKU comprado por clientes que também compraram os SKUs
// consultados, e por QUANTOS clientes distintos (a "força").
type Coocorrencia struct {
	SkuID string `json:"sku_id"`
	Forca int64  `json:"forca"`
}

// Recomendacao: um produto sugerido na página de outro.
type Recomendacao struct {
	ProdutoID string   `json:"produto_id"`
	Nome      string   `json:"nome"`
	Preco     Dinheiro `json:"preco"`
	Forca     int64    `json:"forca"`
}

// Compra: o que vai para o grafo depois do COMMIT (Cliente -COMPROU-> Sku).
type Compra struct {
	ClienteID uuid.UUID
	Itens     []Item
}

// EstadoDoGrafo: tamanho do grafo (para a tela e para o teste da reconstrução).
type EstadoDoGrafo struct {
	Clientes  int64 `json:"clientes"`
	Skus      int64 `json:"skus"`
	Compras   int64 `json:"compras"` // relacionamentos COMPROU
	DuracaoMS int64 `json:"duracao_ms,omitempty"`
	LidasDoPG int64 `json:"lidas_do_postgres,omitempty"`
}
