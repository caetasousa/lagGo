package dominio

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Dinheiro é um valor EXATO em texto decimal ("123.45"). Nunca float: o banco
// guarda numeric/Decimal128 e o JSON sai como número com as casas certas.
type Dinheiro = json.Number

// Estrategia é como o estoque é baixado no checkout. A loja usa a
// condicional; as outras existem para o Laboratório de Concorrência (docs/03).
type Estrategia string

const (
	Ingenua      Estrategia = "ingenua"      // lê e grava sem lock: lost update (errada de propósito)
	ForUpdate    Estrategia = "for_update"   // trava a linha antes de ler
	Condicional  Estrategia = "condicional"  // UPDATE … WHERE quantidade >= x: um comando só
	Serializavel Estrategia = "serializavel" // como a ingênua, mas em SERIALIZABLE (aborta e repete)
)

var Estrategias = []Estrategia{Ingenua, ForUpdate, Condicional, Serializavel}

func (e Estrategia) Valida() bool { return slices.Contains(Estrategias, e) }

// Erros que o negócio conhece. Os adaptadores traduzem para eles o que vem do
// banco (um CHECK violado, uma linha que não existe…).
var (
	ErrSemEstoque           = errors.New("estoque insuficiente")
	ErrSkuInvalido          = errors.New("sku inexistente ou inativo")
	ErrPedidoNaoEncontrado  = errors.New("pedido não encontrado")
	ErrProdutoNaoEncontrado = errors.New("produto não encontrado")
	ErrClienteNaoEncontrado = errors.New("cliente não encontrado")

	// ErrConflito: o banco abortou a transação por concorrência (no
	// PostgreSQL, 40001 ou 40P01). Tudo foi desfeito: repetir é seguro.
	ErrConflito = errors.New("conflito de concorrência")
	// ErrChaveRepetida: a Idempotency-Key já gerou um pedido.
	ErrChaveRepetida = errors.New("chave de idempotência já usada")
)

// ErrValidacao indica entrada inválida (vira HTTP 422 no adaptador HTTP).
type ErrValidacao struct{ Msg string }

func (e ErrValidacao) Error() string { return e.Msg }

type Item struct {
	SkuID      uuid.UUID `json:"sku_id"`
	Quantidade int32     `json:"quantidade"`
}

type Pedido struct {
	ClienteID       uuid.UUID  `json:"cliente_id"`
	EnderecoID      uuid.UUID  `json:"endereco_id"`
	Itens           []Item     `json:"itens"`
	MetodoPagamento string     `json:"metodo_pagamento"`
	Chave           *uuid.UUID `json:"-"` // cabeçalho Idempotency-Key
}

type Opcoes struct {
	Estrategia Estrategia
	// Atraso entre ler e gravar o estoque. Só existe para o laboratório:
	// alarga a "janela de corrida" e deixa os locks visíveis no Painel do DBA.
	Atraso time.Duration
}

type Resultado struct {
	PedidoID      uuid.UUID `json:"pedido_id"`
	Total         Dinheiro  `json:"total"`
	Tentativas    int       `json:"tentativas"`
	Reaproveitado bool      `json:"reaproveitado"` // true = mesma Idempotency-Key, o pedido já existia
}

var MetodosDePagamento = []string{"PIX", "CARTAO", "BOLETO"}

// Normalizar valida o pedido, soma SKUs repetidos e ordena os itens por
// sku_id. A ordem é uma regra de negócio contra deadlock: duas compras com os
// mesmos itens travam o estoque sempre na mesma sequência (docs/03, seção 7).
func Normalizar(p Pedido) ([]Item, error) {
	if p.ClienteID == uuid.Nil || p.EnderecoID == uuid.Nil {
		return nil, ErrValidacao{"cliente_id e endereco_id são obrigatórios"}
	}
	if !slices.Contains(MetodosDePagamento, p.MetodoPagamento) {
		return nil, ErrValidacao{"metodo_pagamento deve ser PIX, CARTAO ou BOLETO"}
	}
	if len(p.Itens) == 0 || len(p.Itens) > 50 {
		return nil, ErrValidacao{"o pedido deve ter entre 1 e 50 itens"}
	}
	soma := map[uuid.UUID]int32{}
	for _, it := range p.Itens {
		if it.SkuID == uuid.Nil || it.Quantidade <= 0 || it.Quantidade > 1000 {
			return nil, ErrValidacao{"cada item precisa de sku_id e quantidade entre 1 e 1000"}
		}
		soma[it.SkuID] += it.Quantidade
	}
	itens := make([]Item, 0, len(soma))
	for id, qtd := range soma {
		itens = append(itens, Item{SkuID: id, Quantidade: qtd})
	}
	slices.SortFunc(itens, func(a, b Item) int { return slices.Compare(a.SkuID[:], b.SkuID[:]) })
	return itens, nil
}

// EstrategiaOuPadrao: vazio = a da loja (condicional); desconhecida = erro.
func EstrategiaOuPadrao(e Estrategia) (Estrategia, error) {
	if e == "" {
		return Condicional, nil
	}
	if !e.Valida() {
		return e, ErrValidacao{fmt.Sprintf("estratégia desconhecida: %q", e)}
	}
	return e, nil
}
