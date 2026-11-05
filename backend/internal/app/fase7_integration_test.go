//go:build integration

package app_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/nosqlgo/marketplace/internal/app"
	lojacassandra "github.com/nosqlgo/marketplace/internal/loja/adaptadores/cassandra"
	lojaneo4j "github.com/nosqlgo/marketplace/internal/loja/adaptadores/neo4j"
	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

// Fase 7: Cassandra (vistos recentemente, consistência ajustável) e Neo4j
// (grafo de compras, Grafo × SQL), contra bancos EFÊMEROS de verdade.

type fase7 struct {
	*servidor
	cass *storage.Cassandra
	ks   string
	neo  neo4j.Driver
}

func novoServidorFase7(t *testing.T) *fase7 {
	cass, ks := testinfra.Cassandra(t)
	neo := testinfra.Neo4j(t)
	s := novoServidorCom(t, app.Opcoes{}, func(c *app.Conexoes) {
		c.Cassandra, c.CassandraKeyspace, c.Neo4j = cass, ks, neo
	})
	return &fase7{servidor: s, cass: cass, ks: ks, neo: neo}
}

// Como quebra (X1, X2, X5): "vistos recentemente" repete produto, não põe o mais
// novo primeiro, mistura clientes; o evento grava sem TTL.
func TestVistosRecentesNoCassandra(t *testing.T) {
	s := novoServidorFase7(t)
	s.semearCatalogo()
	var b busca
	s.req("GET", "/api/catalogo/produtos?por_pagina=5", nil, &b)
	a, outro := s.loja.Clientes[0], s.loja.Clientes[1]

	s.entrarComo(a)
	for _, i := range []int{0, 1, 0, 2} { // o produto 0 duas vezes
		if st := s.req("GET", "/api/catalogo/produtos/"+b.Itens[i].ID, nil, nil); st != 200 {
			t.Fatalf("abrir produto: %d", st)
		}
		time.Sleep(5 * time.Millisecond) // timeuuid em milissegundos distintos
	}
	var vistos []struct {
		ProdutoID string `json:"produto_id"`
		Nome      string
	}
	if st := s.req("GET", "/api/conta/vistos", nil, &vistos); st != 200 {
		t.Fatalf("vistos: %d", st)
	}
	esperado := []string{b.Itens[2].ID, b.Itens[0].ID, b.Itens[1].ID}
	if len(vistos) != 3 || vistos[0].ProdutoID != esperado[0] || vistos[1].ProdutoID != esperado[1] || vistos[2].ProdutoID != esperado[2] || vistos[0].Nome == "" {
		t.Fatalf("[X1] vistos: %+v (esperado %v)", vistos, esperado)
	}

	s.entrarComo(outro)
	var dele []struct{}
	s.req("GET", "/api/conta/vistos", nil, &dele)
	if len(dele) != 0 {
		t.Fatalf("[X1] o histórico de A apareceu para B: %d itens", len(dele))
	}

	// X2: cada linha tem TTL (e não maior que 30 dias).
	ttl, err := lojacassandra.NovosVistos(s.cass, s.ks).TTLRestante(context.Background(), a.ID)
	if err != nil || ttl <= 0 || ttl > 30*24*3600 {
		t.Fatalf("[X2] TTL do evento: %d %v", ttl, err)
	}

	// X5: "excluir minha conta" apaga a partição de A no Cassandra na hora,
	// sem esperar o TTL; a de B (vazia aqui) não importa.
	s.entrarComo(a)
	if st := s.req("DELETE", "/api/conta", nil, nil); st != 204 {
		t.Fatalf("[X5] excluir conta: %d", st)
	}
	restam, err := lojacassandra.NovosVistos(s.cass, s.ks).Recentes(context.Background(), a.ID, 50)
	if err != nil || len(restam) != 0 {
		t.Fatalf("[X5] o histórico sobreviveu à exclusão da conta: %d eventos %v", len(restam), err)
	}
}

// Como quebra (X3): o laboratório mente — com RF=3 e uma réplica só, QUORUM
// e ALL "funcionam", ou ONE falha; com RF=1, algum nível falha.
func TestConsistenciaAjustavel(t *testing.T) {
	s := novoServidorFase7(t)
	type tentativa struct {
		Nivel       string
		Necessarias int
		Escreveu    bool
		Leu         bool
		ErroEscrita string `json:"erro_escrita"`
	}
	var r3, r1 struct {
		Vivas      int `json:"replicas_vivas"`
		Tentativas []tentativa
	}
	if st := s.req("POST", "/api/lab/consistencia", map[string]int{"rf": 3}, &r3); st != 200 {
		t.Fatalf("lab rf=3: %d", st)
	}
	esperado := map[string]bool{"ONE": true, "QUORUM": false, "ALL": false}
	for _, x := range r3.Tentativas {
		if x.Escreveu != esperado[x.Nivel] || x.Leu != esperado[x.Nivel] {
			t.Errorf("[X3] RF=3, %s (precisa de %d, há %d viva): escreveu=%v leu=%v %s", x.Nivel, x.Necessarias, r3.Vivas, x.Escreveu, x.Leu, x.ErroEscrita)
		}
	}
	s.req("POST", "/api/lab/consistencia", map[string]int{"rf": 1}, &r1)
	for _, x := range r1.Tentativas {
		if !x.Escreveu || !x.Leu {
			t.Errorf("[X3] RF=1, %s deveria funcionar: %+v", x.Nivel, x)
		}
	}
	if st := s.req("POST", "/api/lab/consistencia", map[string]int{"rf": 2}, nil); st != 422 {
		t.Errorf("RF=2 deveria ser recusado: %d", st)
	}
}

// Como quebra (Y1, Y2, Y3, Y5): a compra não entra no grafo; o grafo não se
// reconstrói dos pedidos; a recomendação inclui o próprio produto ou vem
// fora de ordem; Cypher e SQL respondem coisas diferentes; a resposta do
// laboratório não diz de que produto é cada SKU.
func TestGrafoDeComprasERecomendacoes(t *testing.T) {
	s := novoServidorFase7(t)
	s.semearCatalogo()
	ctx := context.Background()
	nomeDoProduto := map[string]string{} // sku → nome do produto no catálogo
	produtoDe := func(sku uuid.UUID) string {
		var p struct {
			ID   bson.ObjectID `bson:"_id"`
			Nome string        `bson:"nome"`
		}
		if err := s.mg.Collection("produtos").FindOne(ctx, bson.D{{Key: "skus.sku_id", Value: sku.String()}}).Decode(&p); err != nil {
			t.Fatalf("produto do sku %s: %v", sku, err)
		}
		nomeDoProduto[sku.String()] = p.Nome
		return p.ID.Hex()
	}
	nomeNoCatalogo := func(sku string) string {
		if _, ok := nomeDoProduto[sku]; !ok {
			produtoDe(uuid.MustParse(sku))
		}
		return nomeDoProduto[sku]
	}
	// Três SKUs de produtos DIFERENTES (o seed sorteia; dois SKUs do mesmo
	// produto tornariam a recomendação ambígua).
	var sk []testinfra.Sku
	vistos := map[string]bool{}
	for _, x := range s.loja.Skus {
		if p := produtoDe(x.ID); !vistos[p] {
			vistos[p] = true
			sk = append(sk, x)
		}
		if len(sk) == 3 {
			break
		}
	}
	if len(sk) < 3 {
		t.Fatalf("preparação: o seed tem menos de 3 produtos com SKU")
	}
	compra := func(c testinfra.Cliente, skus ...uuid.UUID) {
		itens := []map[string]any{}
		for _, id := range skus {
			itens = append(itens, map[string]any{"sku_id": id, "quantidade": 1})
		}
		s.entrarComo(c)
		if st := s.req("POST", "/api/checkout", map[string]any{"metodo_pagamento": "PIX", "itens": itens}, nil); st != 201 {
			t.Fatalf("compra: %d", st)
		}
	}
	// sku0+sku1 por dois clientes (força 2); sku0+sku2 por um (força 1).
	compra(s.loja.Clientes[0], sk[0].ID, sk[1].ID)
	compra(s.loja.Clientes[1], sk[0].ID, sk[1].ID)
	compra(s.loja.Clientes[2], sk[0].ID, sk[2].ID)

	// Y1: a compra entrou no grafo logo depois do COMMIT.
	g := lojaneo4j.NovoGrafo(s.neo, nil)
	if ok, err := g.Comprou(ctx, s.loja.Clientes[2].ID, sk[2].ID); err != nil || !ok {
		t.Fatalf("[Y1] a compra não entrou no grafo: %v %v", ok, err)
	}

	// Y2: recomendações do produto do sku0, sem ele mesmo, pela força.
	p0, p1, p2 := produtoDe(sk[0].ID), produtoDe(sk[1].ID), produtoDe(sk[2].ID)
	var rec []struct {
		ProdutoID string `json:"produto_id"`
		Forca     int64
	}
	if st := s.req("GET", "/api/catalogo/produtos/"+p0+"/recomendacoes", nil, &rec); st != 200 {
		t.Fatalf("recomendações: %d", st)
	}
	if len(rec) < 2 || rec[0].ProdutoID != p1 || rec[0].Forca != 2 || rec[1].ProdutoID != p2 || rec[1].Forca != 1 {
		t.Fatalf("[Y2] recomendações de %s: %+v (esperado %s força 2, depois %s força 1)", p0, rec, p1, p2)
	}
	for _, r := range rec {
		if r.ProdutoID == p0 {
			t.Fatal("[Y2] o produto recomendou a si mesmo")
		}
	}

	// Y1: o grafo é derivado — apagado e refeito a partir dos pedidos.
	var e struct{ Clientes, Skus, Compras int64 }
	if st := s.req("POST", "/api/recomendacoes/grafo/reconstruir", nil, &e); st != 200 || e.Clientes != 3 || e.Skus != 3 || e.Compras != 6 {
		t.Fatalf("[Y1] reconstrução: %d %+v (esperado 3 clientes, 3 SKUs, 6 COMPROU)", st, e)
	}

	// Y3: Cypher e SQL respondem a mesma coisa.
	type linha struct {
		SkuID string `json:"sku_id"`
		Forca int64
	}
	for _, pergunta := range []string{"tambem_comprou", "alcance"} {
		var r struct {
			Iguais bool
			Grafo  struct {
				Linhas []linha
				Total  int64
			}
			SQL struct {
				Linhas []linha
				Total  int64
			}
			Nomes      map[string]string
			Explicacao *struct {
				Compradores, Intermediarios int64
				Caminhos                    []struct {
					SkuID        string `json:"sku_id"`
					Forca, Novos int64
				}
			}
		}
		if st := s.req("POST", "/api/lab/grafo", map[string]string{"pergunta": pergunta, "sku_id": sk[1].ID.String()}, &r); st != 200 || !r.Iguais {
			t.Fatalf("[Y3] %s: %d, iguais=%v grafo=%+v sql=%+v", pergunta, st, r.Iguais, r.Grafo, r.SQL)
		}
		// Y5: o SKU de partida e cada SKU da resposta vêm com o nome do
		// produto do catálogo (MongoDB) — e o vendedor, que distingue dois
		// SKUs do mesmo produto.
		ids := []string{sk[1].ID.String()}
		for _, l := range r.Grafo.Linhas {
			ids = append(ids, l.SkuID)
		}
		// Y5 no alcance: o número sozinho não ensina; a resposta diz como ele
		// se forma. Do sku1: 2 compradores (clientes 0 e 1), que também
		// compraram só o sku0 (força 2); o sku0 leva a 1 cliente novo (o 2).
		if pergunta == "alcance" {
			e := r.Explicacao
			if e == nil || e.Compradores != 2 || e.Intermediarios != 1 || len(e.Caminhos) != 1 ||
				e.Caminhos[0].SkuID != sk[0].ID.String() || e.Caminhos[0].Forca != 2 || e.Caminhos[0].Novos != 1 || r.Grafo.Total != 1 {
				t.Fatalf("[Y5] explicação do alcance: %+v (total %d)", e, r.Grafo.Total)
			}
			ids = append(ids, e.Caminhos[0].SkuID)
		} else if r.Explicacao != nil {
			t.Fatalf("[Y5] explicação de alcance na pergunta de 2 saltos: %+v", r.Explicacao)
		}
		if pergunta == "tambem_comprou" && len(ids) < 2 {
			t.Fatalf("[Y5] a resposta veio vazia: %+v", r.Grafo)
		}
		for _, id := range ids {
			if n := nomeNoCatalogo(id); !strings.HasPrefix(r.Nomes[id], n+" · ") {
				t.Fatalf("[Y5] %s: nome %q (esperado %q · vendedor)", id, r.Nomes[id], n)
			}
		}
	}

	// Y5: os SKUs oferecidos como ponto de partida também têm nome.
	var partidas []struct{ ID, Nome string }
	if st := s.req("GET", "/api/lab/grafo/skus", nil, &partidas); st != 200 || len(partidas) == 0 {
		t.Fatalf("[Y5] skus: %d %+v", st, partidas)
	}
	for _, p := range partidas {
		if n := nomeNoCatalogo(p.ID); !strings.HasPrefix(p.Nome, n+" · ") {
			t.Fatalf("[Y5] ponto de partida %s: nome %q (esperado %q · vendedor)", p.ID, p.Nome, n)
		}
	}
}

// Como quebra (X4, Y4): com o Cassandra ou o Neo4j fora do ar, abrir o
// produto ou comprar falha — mas os dois são efeitos secundários.
func TestLojaSegueSemCassandraENeo4j(t *testing.T) {
	morto, err := neo4j.NewDriver("neo4j://127.0.0.1:1", neo4j.BasicAuth("neo4j", "x", ""))
	if err != nil {
		t.Fatal(err)
	}
	s := novoServidorCom(t, app.Opcoes{}, func(c *app.Conexoes) {
		c.Cassandra = storage.NewCassandra([]string{"127.0.0.1:1"})
		c.Neo4j = morto
	})
	s.semearCatalogo()
	var b busca
	s.req("GET", "/api/catalogo/produtos", nil, &b)
	s.entrarComo(s.loja.Clientes[0])
	if st := s.req("GET", "/api/catalogo/produtos/"+b.Itens[0].ID, nil, nil); st != 200 {
		t.Fatalf("[X4] produto sem Cassandra: %d", st)
	}
	// Y4 também é sobre TEMPO: o grafo tem prazo de 2 s na compra e 3 s na
	// leitura. Sem prazo (ou com um prazo que o esquema ignora), o driver
	// repete por 30 s e a compra "funciona" — depois de meio minuto.
	inicio := time.Now()
	if st := s.req("POST", "/api/checkout", s.pedido(s.loja.Clientes[0], s.loja.Skus[0].ID, 1), nil); st != 201 {
		t.Fatalf("[Y4] compra sem Neo4j: %d", st)
	}
	if d := time.Since(inicio); d > 5*time.Second {
		t.Fatalf("[Y4] a compra esperou o Neo4j fora do ar: %v", d)
	}
	inicio = time.Now()
	if st := s.req("GET", "/api/catalogo/produtos/"+b.Itens[0].ID+"/recomendacoes", nil, nil); st != 503 {
		t.Fatalf("recomendações sem Neo4j deveriam dizer 503: %d", st)
	}
	if d := time.Since(inicio); d > 5*time.Second {
		t.Fatalf("[Y4] as recomendações esperaram o Neo4j fora do ar: %v", d)
	}
}
