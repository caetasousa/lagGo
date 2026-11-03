//go:build integration

// Fase 3: catálogo (MongoDB + cache Redis), carrinho (Redis) e rate limit,
// pelo servidor inteiro. Cada teste cita o cenário do e2e/CENARIOS.md que
// protege por baixo da tela.
package app_test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/nosqlgo/marketplace/internal/app"
	lojamongo "github.com/nosqlgo/marketplace/internal/loja/adaptadores/mongo"
	lojaredis "github.com/nosqlgo/marketplace/internal/loja/adaptadores/redis"
)

type resumo struct {
	ID        string
	Nome      string
	Categoria struct {
		ID   int32
		Nome string
	}
	PrecoMin float64 `json:"preco_min"`
}

type busca struct {
	Itens             []resumo
	Total             int
	FacetasCategorias []struct {
		ID    int32
		Nome  string
		Total int
	} `json:"facetas_categorias"`
	FacetasPreco []struct{ Total int } `json:"facetas_preco"`
}

func (s *servidor) semearCatalogo() lojamongo.ResumoSemente {
	s.t.Helper()
	r, err := lojamongo.Semear(context.Background(), s.pg, s.mg, s.rdb)
	if err != nil {
		s.t.Fatal(err)
	}
	return r
}

func (s *servidor) categoria(nome string) int32 {
	var id int32
	if err := s.pg.QueryRow(context.Background(), `SELECT id FROM categoria WHERE nome = $1`, nome).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	return id
}

// A1, A2, A3
func TestCatalogoBuscaCategoriaEFacetas(t *testing.T) {
	s := novoServidor(t)
	sem := s.semearCatalogo()
	if sem.Produtos < 2 {
		t.Fatalf("catálogo pequeno demais: %+v", sem)
	}

	var b busca
	s.req("GET", "/api/catalogo/produtos?busca=notebook&por_pagina=60", nil, &b)
	if b.Total == 0 {
		t.Fatal("[A1] a busca por 'notebook' não achou nada")
	}
	for _, p := range b.Itens {
		if p.Categoria.Nome != "Notebooks" && !strings.Contains(strings.ToLower(p.Nome), "notebook") {
			t.Errorf("[A1] resultado sem relação com 'notebook': %+v", p)
		}
	}

	var raiz, todos busca
	s.req("GET", fmt.Sprintf("/api/catalogo/produtos?categoria=%d&por_pagina=60", s.categoria("Eletrônicos")), nil, &raiz)
	s.req("GET", "/api/catalogo/produtos?por_pagina=60", nil, &todos)
	if raiz.Total == 0 || raiz.Total != todos.Total { // na fixture, tudo descende de Eletrônicos
		t.Fatalf("[A2] filtrar pela raiz trouxe %d de %d", raiz.Total, todos.Total)
	}

	soma := 0
	for _, f := range raiz.FacetasCategorias {
		soma += f.Total
	}
	somaPreco := 0
	for _, f := range raiz.FacetasPreco {
		somaPreco += f.Total
	}
	if soma != raiz.Total || somaPreco != raiz.Total {
		t.Fatalf("[A3] facetas não fecham: categorias=%d preço=%d total=%d", soma, somaPreco, raiz.Total)
	}
}

type detalhe struct {
	Produto struct {
		ID                 string
		Atributos          map[string]any
		NotaMedia          float64 `json:"nota_media"`
		QtdAvaliacoes      int     `json:"qtd_avaliacoes"`
		AvaliacoesRecentes []struct {
			Texto       string
			ClienteNome string `json:"cliente_nome"`
		} `json:"avaliacoes_recentes"`
	}
	Ofertas []struct {
		ID      string
		Estoque int
	}
	Cache string
}

// A4, A5, A6, A7, A8
func TestCatalogoProdutoCacheEAvaliacoes(t *testing.T) {
	s := novoServidor(t)
	s.semearCatalogo()
	var b busca
	s.req("GET", fmt.Sprintf("/api/catalogo/produtos?categoria=%d", s.categoria("Notebooks")), nil, &b)
	var id string
	for _, p := range b.Itens {
		if p.Nome != "Console Edição Limitada" { // o SKU do laboratório tem estoque 1
			id = p.ID
			break
		}
	}

	var d1, d2 detalhe
	s.req("GET", "/api/catalogo/produtos/"+id, nil, &d1)
	s.req("GET", "/api/catalogo/produtos/"+id, nil, &d2)
	if d1.Cache != "miss" || d2.Cache != "hit" {
		t.Fatalf("[A8] cache: primeira=%s segunda=%s", d1.Cache, d2.Cache)
	}
	if _, ok := d1.Produto.Atributos["ram_gb"]; !ok {
		t.Fatalf("[A4] notebook sem os atributos da categoria: %v", d1.Produto.Atributos)
	}

	// A5: a oferta vem do PostgreSQL, mesmo com o documento em cache.
	sku := d2.Ofertas[0]
	c := s.loja.Clientes[0]
	if st := s.req("POST", "/api/checkout", s.pedido(c, uuid.MustParse(sku.ID), 2), nil); st != 201 {
		t.Fatalf("[A5] compra: %d", st)
	}
	var d3 detalhe
	s.req("GET", "/api/catalogo/produtos/"+id, nil, &d3)
	if d3.Cache != "hit" || d3.Ofertas[0].Estoque != sku.Estoque-2 {
		t.Fatalf("[A5] estoque com documento em cache: %d (esperado %d, cache %s)", d3.Ofertas[0].Estoque, sku.Estoque-2, d3.Cache)
	}

	// A7: nota inválida é recusada pela aplicação...
	if st := s.req("POST", "/api/catalogo/produtos/"+id+"/avaliacoes",
		map[string]any{"cliente_id": c.ID, "nota": 6, "texto": "nota impossível"}, nil); st != 422 {
		t.Fatalf("[A7] nota 6 deveria dar 422, deu %d", st)
	}
	// ...e pelo próprio MongoDB ($jsonSchema), se alguém gravar por fora.
	_, err := s.mg.Collection("avaliacoes").InsertOne(context.Background(), bson.D{
		{Key: "produto_id", Value: bson.NewObjectID()}, {Key: "cliente_id", Value: c.ID.String()},
		{Key: "nota", Value: 7}, {Key: "texto", Value: "por fora da API"}, {Key: "em", Value: bson.NewDateTimeFromTime(time.Now())},
	})
	if err == nil {
		t.Fatal("[A7] o $jsonSchema aceitou nota 7")
	}

	// A6 + A8: avaliação válida move a média e invalida o cache.
	var res struct {
		NotaMedia     float64 `json:"nota_media"`
		QtdAvaliacoes int     `json:"qtd_avaliacoes"`
	}
	if st := s.req("POST", "/api/catalogo/produtos/"+id+"/avaliacoes",
		map[string]any{"cliente_id": c.ID, "nota": 1, "texto": "teste de integração"}, &res); st != 201 {
		t.Fatalf("[A6] avaliar: %d", st)
	}
	var d4 detalhe
	s.req("GET", "/api/catalogo/produtos/"+id, nil, &d4)
	if d4.Cache != "miss" {
		t.Fatalf("[A8] a avaliação não invalidou o cache (%s)", d4.Cache)
	}
	if d4.Produto.QtdAvaliacoes != d1.Produto.QtdAvaliacoes+1 || d4.Produto.AvaliacoesRecentes[0].Texto != "teste de integração" {
		t.Fatalf("[A6] avaliação não aparece: qtd %d→%d, recentes %+v", d1.Produto.QtdAvaliacoes, d4.Produto.QtdAvaliacoes, d4.Produto.AvaliacoesRecentes)
	}
	if d1.Produto.QtdAvaliacoes > 0 && d4.Produto.NotaMedia >= d1.Produto.NotaMedia {
		t.Fatalf("[A6] nota 1 não baixou a média: %.2f → %.2f", d1.Produto.NotaMedia, d4.Produto.NotaMedia)
	}

	// Avaliar em nome de OUTRA pessoa (Q4): a avaliação é de quem está logado.
	if st := s.req("POST", "/api/catalogo/produtos/"+id+"/avaliacoes",
		map[string]any{"cliente_id": uuid.New(), "nota": 5, "texto": "fantasma"}, nil); st != 422 {
		t.Fatalf("[Q4] avaliar como outro cliente deveria dar 422, deu %d", st)
	}
	s.sair()
	if st := s.req("POST", "/api/catalogo/produtos/"+id+"/avaliacoes",
		map[string]any{"nota": 5, "texto": "sem login"}, nil); st != 401 {
		t.Fatalf("[Q4] avaliar sem login deveria dar 401, deu %d", st)
	}
}

type carrinhoResp struct {
	Itens []struct {
		ID         string
		Quantidade int
	}
	TTLSegundos int `json:"ttl_segundos"`
}

// B1–B7
func TestCarrinhoNoRedis(t *testing.T) {
	s := novoServidor(t)
	s.semearCatalogo()
	sessaoA, sessaoB := uuid.NewString(), uuid.NewString()
	sku1, sku2 := s.loja.Skus[0], s.loja.Skus[1]
	put := func(sessao string, sku uuid.UUID, q int) int {
		return s.req("PUT", "/api/carrinho/itens/"+sku.String(), map[string]any{"quantidade": q}, nil, "X-Sessao", sessao)
	}
	ver := func(sessao string) carrinhoResp {
		var c carrinhoResp
		s.req("GET", "/api/carrinho", nil, &c, "X-Sessao", sessao)
		return c
	}

	put(sessaoA, sku1.ID, 2)
	put(sessaoA, sku2.ID, 1)
	if c := ver(sessaoA); len(c.Itens) != 2 || c.TTLSegundos <= 0 {
		t.Fatalf("[B1] carrinho A: %+v", c)
	}
	if c := ver(sessaoB); len(c.Itens) != 0 {
		t.Fatalf("[B3] a sessão B vê o carrinho da A: %+v", c)
	}
	put(sessaoA, sku2.ID, 0)
	put(sessaoA, sku1.ID, 3)
	if c := ver(sessaoA); len(c.Itens) != 1 || c.Itens[0].Quantidade != 3 {
		t.Fatalf("[B2] alterar/remover: %+v", c)
	}

	cli := s.loja.Clientes[0]
	corpo := map[string]any{"cliente_id": cli.ID, "endereco_id": cli.EnderecoID, "metodo_pagamento": "PIX"}
	// Montar o carrinho não exige login; finalizar exige (Fase 6, Q4).
	if st := s.req("POST", "/api/carrinho/finalizar", corpo, nil, "X-Sessao", sessaoA); st != 401 {
		t.Fatalf("[Q4] finalizar sem login deveria dar 401, deu %d", st)
	}
	s.entrarComo(cli)
	if st := s.req("POST", "/api/carrinho/finalizar", corpo, nil, "X-Sessao", sessaoB, "Idempotency-Key", uuid.NewString()); st != 422 {
		t.Fatalf("[B4] carrinho vazio deveria dar 422, deu %d", st)
	}

	put(sessaoB, sku2.ID, 99)
	s.req("PUT", "/api/carrinho/itens/"+sku2.ID.String(), map[string]any{"quantidade": 99}, nil, "X-Sessao", sessaoB)
	if st := s.req("POST", "/api/carrinho/finalizar", corpo, nil, "X-Sessao", sessaoB); st != 409 {
		t.Fatalf("[B6] acima do estoque (50) deveria dar 409, deu %d", st)
	}
	if c := ver(sessaoB); len(c.Itens) != 1 {
		t.Fatal("[B6] o carrinho sumiu depois de uma compra recusada")
	}

	chave := uuid.NewString()
	var r1, r2 struct {
		PedidoID      string `json:"pedido_id"`
		Reaproveitado bool
	}
	if st := s.req("POST", "/api/carrinho/finalizar", corpo, &r1, "X-Sessao", sessaoA, "Idempotency-Key", chave); st != 201 {
		t.Fatalf("[B5] finalizar: %d", st)
	}
	if c := ver(sessaoA); len(c.Itens) != 0 {
		t.Fatalf("[B5] o carrinho não esvaziou: %+v", c)
	}
	var ped struct {
		Itens []struct {
			SkuID      string `json:"sku_id"`
			Quantidade int
		}
	}
	s.req("GET", "/api/conta/pedidos/"+r1.PedidoID, nil, &ped)
	if len(ped.Itens) != 1 || ped.Itens[0].SkuID != sku1.ID.String() || ped.Itens[0].Quantidade != 3 {
		t.Fatalf("[B5] pedido diferente do carrinho: %+v", ped)
	}
	if st := s.req("POST", "/api/carrinho/finalizar", corpo, &r2, "X-Sessao", sessaoA, "Idempotency-Key", chave); st != 200 || r2.PedidoID != r1.PedidoID {
		t.Fatalf("[C2] repetir a chave com o carrinho já vazio: %d %+v", st, r2)
	}

	score, err := s.rdb.ZScore(context.Background(), lojaredis.ChaveRanking, sku1.ID.String()).Result()
	if err != nil || score != 3 {
		t.Fatalf("[B7] ranking do SKU: %v (%v)", score, err)
	}
	if n, _ := s.rdb.XLen(context.Background(), "stream:pedidos").Result(); n != 1 {
		t.Fatalf("o pedido não foi publicado no stream (%d)", n)
	}
	var top []struct {
		SkuID    string `json:"sku_id"`
		Vendidos int
	}
	s.req("GET", "/api/catalogo/mais-vendidos", nil, &top)
	if len(top) == 0 || top[0].SkuID != sku1.ID.String() || top[0].Vendidos != 3 {
		t.Fatalf("[B7] mais vendidos: %+v", top)
	}

	if st := s.req("GET", "/api/carrinho", nil, nil, "X-Sessao", "nao-e-uuid"); st != 400 {
		t.Fatalf("sessão inválida deveria dar 400, deu %d", st)
	}
}

// Como quebra: o rate limit não barra, ou barra sem dizer quando tentar de novo.
func TestRateLimitPorIP(t *testing.T) {
	s := novoServidor(t, app.Opcoes{LimitePorMinuto: 3})
	s.semearCatalogo()
	var b busca
	s.req("GET", "/api/catalogo/produtos", nil, &b)
	corpo := map[string]any{"cliente_id": s.loja.Clientes[0].ID, "nota": 4, "texto": "limite"}
	s.entrarComo(s.loja.Clientes[0])
	for i := 1; i <= 3; i++ {
		if st := s.req("POST", "/api/catalogo/produtos/"+b.Itens[0].ID+"/avaliacoes", corpo, nil); st != 201 {
			t.Fatalf("requisição %d dentro do limite: %d", i, st)
		}
	}
	r, _ := http.NewRequest("POST", s.url+"/api/catalogo/produtos/"+b.Itens[0].ID+"/avaliacoes", strings.NewReader(`{"cliente_id":"`+s.loja.Clientes[0].ID.String()+`","nota":4,"texto":"limite"}`))
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 429 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("4ª requisição: %d, Retry-After=%q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
}

// G3: o painel enxerga os bancos NoSQL.
func TestPainelNoSQL(t *testing.T) {
	s := novoServidor(t)
	s.semearCatalogo()
	s.req("PUT", "/api/carrinho/itens/"+s.loja.Skus[0].ID.String(), map[string]any{"quantidade": 1}, nil, "X-Sessao", uuid.NewString())

	var rd struct {
		ChavesPorPrefixo map[string]int `json:"chaves_por_prefixo"`
		Info             map[string]string
	}
	s.req("GET", "/api/dba/redis", nil, &rd)
	if rd.ChavesPorPrefixo["carrinho"] != 1 || rd.Info["redis_version"] == "" {
		t.Fatalf("[G3] Redis: %+v", rd)
	}
	var mg struct {
		ReplicaSet string `json:"replica_set"`
		Colecoes   []struct {
			Nome         string
			Documentos   int
			TemValidacao bool `json:"tem_validacao"`
			Indices      []struct{ Nome string }
		}
	}
	s.req("GET", "/api/dba/mongo", nil, &mg)
	achou := false
	for _, c := range mg.Colecoes {
		if c.Nome == "produtos" {
			achou = c.Documentos > 0 && c.TemValidacao && len(c.Indices) == 4 // _id + 3 do esquema
		}
	}
	if !achou || mg.ReplicaSet == "" {
		t.Fatalf("[G3] Mongo: %+v", mg)
	}
}
