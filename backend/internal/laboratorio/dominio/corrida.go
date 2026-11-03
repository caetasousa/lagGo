package dominio

import "github.com/google/uuid"

// Laboratório de Concorrência (Fase 1, docs/03): N compradores disputam o
// último item ao mesmo tempo, com uma das estratégias de baixa de estoque da
// loja (ingenua, for_update, condicional, serializavel).

// SkuLaboratorio é criado pelo seed (backend/db/seed/seed.sql): o único SKU
// que os laboratórios disputam ("Console Edição Limitada").
var SkuLaboratorio = uuid.MustParse("11111111-1111-1111-1111-111111111111")

// Comprador: um cliente e o endereço dele.
type Comprador struct {
	ClienteID  uuid.UUID
	EnderecoID uuid.UUID
}

type CorridaParams struct {
	SkuID          uuid.UUID `json:"sku_id"`
	EstoqueInicial int32     `json:"estoque_inicial"`
	Compradores    int       `json:"compradores"`
	Estrategia     string    `json:"estrategia"`
	AtrasoMS       int       `json:"atraso_ms"`
}

type CorridaResultado struct {
	CorridaParams
	Vendidos     int     `json:"vendidos"`
	SemEstoque   int     `json:"sem_estoque"`
	Erros        int     `json:"erros"`
	PrimeiroErro string  `json:"primeiro_erro,omitempty"`
	Retentativas int     `json:"retentativas"` // transações repetidas após 40001/40P01
	EstoqueFinal int32   `json:"estoque_final"`
	VendasAMais  int     `json:"vendas_a_mais"` // vendidos além do estoque inicial
	Consistente  bool    `json:"consistente"`   // estoque_final == inicial - vendidos?
	DuracaoMS    float64 `json:"duracao_ms"`
}

// ValidarCorrida confere os limites (a estratégia é conferida pela loja).
func ValidarCorrida(p CorridaParams) error {
	switch {
	case p.Compradores < 1 || p.Compradores > 200:
		return ErrValidacao{"compradores deve estar entre 1 e 200"}
	case p.EstoqueInicial < 0 || p.EstoqueInicial > 1000:
		return ErrValidacao{"estoque_inicial deve estar entre 0 e 1000"}
	case p.AtrasoMS < 0 || p.AtrasoMS > 2000:
		return ErrValidacao{"atraso_ms deve estar entre 0 e 2000"}
	}
	return nil
}
