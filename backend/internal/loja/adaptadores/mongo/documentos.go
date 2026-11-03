package mongo

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

// Os documentos como estão GRAVADOS no MongoDB (com os tipos do BSON:
// Decimal128 para dinheiro, ObjectID para o _id). Ficam só aqui no adaptador;
// para fora sai o dominio.Produto, convertido por paraDominio.
const (
	colecaoProdutos   = "produtos"
	colecaoAvaliacoes = "avaliacoes"
)

type categoriaDoc struct {
	ID      int32  `bson:"id"`
	Nome    string `bson:"nome"`
	Caminho string `bson:"caminho"`
}

// skuDoc é a oferta embutida no documento: referência ao SKU do PostgreSQL
// (sem FK entre bancos) com uma CÓPIA do preço para ordenar e filtrar a busca
// (padrão Extended Reference). A cópia pode ficar velha — por isso a página do
// produto lê o preço vigente do PostgreSQL.
type skuDoc struct {
	SkuID    string          `bson:"sku_id"`
	Vendedor string          `bson:"vendedor"`
	Preco    bson.Decimal128 `bson:"preco"`
}

type avaliacaoResumoDoc struct {
	ClienteNome string    `bson:"cliente_nome"`
	Nota        int32     `bson:"nota"`
	Texto       string    `bson:"texto"`
	Em          time.Time `bson:"em"`
}

// produtoDoc é o documento da coleção produtos.
//
// Dinheiro é Decimal128 no MongoDB (como numeric no PostgreSQL: nunca double);
// no domínio vira o texto exato (dominio.Dinheiro).
type produtoDoc struct {
	ID                 bson.ObjectID        `bson:"_id"`
	Nome               string               `bson:"nome"`
	Marca              string               `bson:"marca"`
	Descricao          string               `bson:"descricao"`
	Categoria          categoriaDoc         `bson:"categoria"`
	Categorias         []int32              `bson:"categorias"`
	Atributos          bson.M               `bson:"atributos"`
	Skus               []skuDoc             `bson:"skus"`
	PrecoMin           bson.Decimal128      `bson:"preco_min"`
	NotaMedia          float64              `bson:"nota_media"`
	QtdAvaliacoes      int32                `bson:"qtd_avaliacoes"`
	AvaliacoesRecentes []avaliacaoResumoDoc `bson:"avaliacoes_recentes"`
	CriadoEm           time.Time            `bson:"criado_em"`
}

func (c categoriaDoc) paraDominio() dominio.CategoriaRef {
	return dominio.CategoriaRef{ID: c.ID, Nome: c.Nome, Caminho: c.Caminho}
}

func (p produtoDoc) paraDominio() dominio.Produto {
	d := dominio.Produto{ID: p.ID.Hex(), Nome: p.Nome, Marca: p.Marca, Descricao: p.Descricao,
		Categoria: p.Categoria.paraDominio(), Categorias: p.Categorias, Atributos: map[string]any(p.Atributos),
		PrecoMin: dominio.Dinheiro(p.PrecoMin.String()), NotaMedia: p.NotaMedia, QtdAvaliacoes: p.QtdAvaliacoes,
		CriadoEm: p.CriadoEm, Skus: make([]dominio.SkuRef, len(p.Skus)), AvaliacoesRecentes: make([]dominio.AvaliacaoResumo, len(p.AvaliacoesRecentes))}
	for i, s := range p.Skus {
		d.Skus[i] = dominio.SkuRef{SkuID: s.SkuID, Vendedor: s.Vendedor, Preco: dominio.Dinheiro(s.Preco.String())}
	}
	for i, a := range p.AvaliacoesRecentes {
		d.AvaliacoesRecentes[i] = dominio.AvaliacaoResumo{ClienteNome: a.ClienteNome, Nota: a.Nota, Texto: a.Texto, Em: a.Em}
	}
	return d
}

func (r produtoResumoDoc) paraDominio() dominio.ProdutoResumo {
	return dominio.ProdutoResumo{ID: r.ID.Hex(), Nome: r.Nome, Marca: r.Marca, Categoria: r.Categoria.paraDominio(),
		PrecoMin: dominio.Dinheiro(r.PrecoMin.String()), NotaMedia: r.NotaMedia, QtdAvaliacoes: r.QtdAvaliacoes,
		QtdOfertas: r.QtdOfertas, Relevancia: r.Relevancia}
}

// produtoResumoDoc é o card da listagem (projeção: só os campos necessários).
type produtoResumoDoc struct {
	ID            bson.ObjectID   `bson:"_id"`
	Nome          string          `bson:"nome"`
	Marca         string          `bson:"marca"`
	Categoria     categoriaDoc    `bson:"categoria"`
	PrecoMin      bson.Decimal128 `bson:"preco_min"`
	NotaMedia     float64         `bson:"nota_media"`
	QtdAvaliacoes int32           `bson:"qtd_avaliacoes"`
	QtdOfertas    int32           `bson:"qtd_ofertas"`
	Relevancia    float64         `bson:"relevancia,omitempty"`
}

// avaliacaoDoc é o documento da coleção avaliacoes.
type avaliacaoDoc struct {
	ID          bson.ObjectID `bson:"_id"`
	ProdutoID   bson.ObjectID `bson:"produto_id"`
	ClienteID   string        `bson:"cliente_id"`
	ClienteNome string        `bson:"cliente_nome"`
	Nota        int32         `bson:"nota"`
	Texto       string        `bson:"texto"`
	Em          time.Time     `bson:"em"`
}
