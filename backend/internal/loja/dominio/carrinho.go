package dominio

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Regras do carrinho. Ele guarda só a INTENÇÃO de compra (SKU → quantidade):
// preço e estoque vigentes vêm sempre da Oferta, lida na hora.
const (
	ValidadeDoCarrinho = 7 * 24 * time.Hour // carrinho abandonado some sozinho
	MaxPorItem         = 99
)

// Oferta é um SKU à venda agora: preço e estoque VIGENTES.
type Oferta struct {
	ID        uuid.UUID `json:"id"`
	ProdutoID *string   `json:"produto_id"`
	Descricao string    `json:"descricao"`
	Preco     Dinheiro  `json:"preco"`
	Ativo     bool      `json:"ativo"`
	Estoque   int32     `json:"estoque"`
	Vendedor  string    `json:"vendedor"`
}

type ItemCarrinho struct {
	Oferta
	Quantidade int32 `json:"quantidade"`
}

type Carrinho struct {
	Itens       []ItemCarrinho `json:"itens"`
	TTLSegundos int64          `json:"ttl_segundos"` // -2 = não existe; -1 = sem validade
}

func ValidarQuantidade(n int) error {
	if n < 0 || n > MaxPorItem {
		return ErrValidacao{fmt.Sprintf("quantidade deve estar entre 0 e %d", MaxPorItem)}
	}
	return nil
}
