package dominio

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// TempoDeCache: quanto uma cópia do produto pode ficar velha. É uma decisão
// de negócio (descrição e avaliações toleram minutos; preço e estoque, nada —
// por isso eles nunca vão para o cache).
const TempoDeCache = 5 * time.Minute

type CategoriaRef struct {
	ID      int32  `json:"id"`
	Nome    string `json:"nome"`
	Caminho string `json:"caminho"`
}

// SkuRef é a oferta citada no produto, com uma CÓPIA do preço para ordenar e
// filtrar a busca. A cópia pode ficar velha: o preço vigente é o da Oferta.
type SkuRef struct {
	SkuID    string   `json:"sku_id"`
	Vendedor string   `json:"vendedor"`
	Preco    Dinheiro `json:"preco"`
}

type AvaliacaoResumo struct {
	ClienteNome string    `json:"cliente_nome"`
	Nota        int32     `json:"nota"`
	Texto       string    `json:"texto"`
	Em          time.Time `json:"em"`
}

// Produto: cada categoria tem atributos próprios (notebook tem RAM, livro tem
// autor) — por isso Atributos é um mapa, e o produto mora num banco de documentos.
type Produto struct {
	ID                 string            `json:"id"`
	Nome               string            `json:"nome"`
	Marca              string            `json:"marca"`
	Descricao          string            `json:"descricao"`
	Categoria          CategoriaRef      `json:"categoria"`
	Categorias         []int32           `json:"categorias"`
	Atributos          map[string]any    `json:"atributos"`
	Skus               []SkuRef          `json:"skus"`
	PrecoMin           Dinheiro          `json:"preco_min"`
	NotaMedia          float64           `json:"nota_media"`
	QtdAvaliacoes      int32             `json:"qtd_avaliacoes"`
	AvaliacoesRecentes []AvaliacaoResumo `json:"avaliacoes_recentes"`
	CriadoEm           time.Time         `json:"criado_em"`
}

// ProdutoResumo é o card da listagem.
type ProdutoResumo struct {
	ID            string       `json:"id"`
	Nome          string       `json:"nome"`
	Marca         string       `json:"marca"`
	Categoria     CategoriaRef `json:"categoria"`
	PrecoMin      Dinheiro     `json:"preco_min"`
	NotaMedia     float64      `json:"nota_media"`
	QtdAvaliacoes int32        `json:"qtd_avaliacoes"`
	QtdOfertas    int32        `json:"qtd_ofertas"`
	Relevancia    float64      `json:"relevancia,omitempty"`
}

type FiltroBusca struct {
	Texto     string
	Categoria int32   // 0 = todas; inclui as subcategorias
	PrecoDe   float64 // 0 = sem limite
	PrecoAte  float64 // 0 = sem limite
	Ordenar   string  // relevancia | preco_asc | preco_desc | avaliacao
	Pagina    int
	PorPagina int
}

type FacetaCategoria struct {
	ID    int32  `json:"id"`
	Nome  string `json:"nome"`
	Total int32  `json:"total"`
}

type FacetaPreco struct {
	De    float64 `json:"de"`
	Ate   float64 `json:"ate"` // 0 = sem limite
	Total int32   `json:"total"`
}

type ResultadoBusca struct {
	Itens       []ProdutoResumo   `json:"itens"`
	Total       int32             `json:"total"`
	Pagina      int               `json:"pagina"`
	PorPagina   int               `json:"por_pagina"`
	Categorias  []FacetaCategoria `json:"facetas_categorias"`
	FaixasPreco []FacetaPreco     `json:"facetas_preco"`
	Consulta    json.RawMessage   `json:"pipeline"` // a consulta que o banco rodou, para estudo
}

// Detalhe é a página do produto: o documento (do cache ou do banco) mais as
// ofertas vigentes.
type Detalhe struct {
	Produto Produto  `json:"produto"`
	Ofertas []Oferta `json:"ofertas"`
	Cache   string   `json:"cache"` // hit | miss
}

type NovaAvaliacao struct {
	ClienteID uuid.UUID `json:"cliente_id"`
	Nota      int32     `json:"nota"`
	Texto     string    `json:"texto"`
}

// Validar confere a nota e o texto (já sem espaços nas pontas).
func (a *NovaAvaliacao) Validar() error {
	a.Texto = strings.TrimSpace(a.Texto)
	switch {
	case a.Nota < 1 || a.Nota > 5:
		return ErrValidacao{"a nota deve estar entre 1 e 5"}
	case utf8.RuneCountInString(a.Texto) < 3 || utf8.RuneCountInString(a.Texto) > 1000:
		return ErrValidacao{"o texto deve ter entre 3 e 1000 caracteres"}
	}
	return nil
}

// Avaliacao é o que é gravado: a nova avaliação já com o nome público.
type Avaliacao struct {
	ProdutoID   string
	ClienteID   uuid.UUID
	ClienteNome string
	Nota        int32
	Texto       string
	Em          time.Time
}

type ResultadoAvaliacao struct {
	NotaMedia     float64 `json:"nota_media"`
	QtdAvaliacoes int32   `json:"qtd_avaliacoes"`
}

// NomePublico guarda só "Ana S." no que é exibido a todos (minimização — LGPD).
func NomePublico(nome string) string {
	partes := strings.Fields(nome)
	switch len(partes) {
	case 0:
		return "Cliente"
	case 1:
		return partes[0]
	}
	inicial, _ := utf8.DecodeRuneInString(partes[len(partes)-1])
	return fmt.Sprintf("%s %c.", partes[0], inicial)
}

type MaisVendido struct {
	SkuID     string   `json:"sku_id"`
	Vendidos  int64    `json:"vendidos"`
	ProdutoID string   `json:"produto_id"`
	Nome      string   `json:"nome"`
	Preco     Dinheiro `json:"preco"`
}

// PosicaoNoRanking: um SKU e quantas unidades vendeu.
type PosicaoNoRanking struct {
	SkuID    string
	Vendidos int64
}

// ProdutoDoSku: o produto a que um SKU pertence (para completar o ranking).
type ProdutoDoSku struct {
	ProdutoID string
	Nome      string
	Preco     Dinheiro
}
