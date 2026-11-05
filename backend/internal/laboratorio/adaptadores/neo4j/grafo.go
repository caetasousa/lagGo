// Package neo4j: o lado "grafo" do Laboratório Grafo × SQL (Fase 7).
package neo4j

import (
	"context"
	"time"

	"github.com/neo4j/neo4j-go-driver/v6/neo4j"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// As consultas são o assunto da aula: ficam aqui, inteiras, e vão para a tela.
// O SKU do Laboratório de Concorrência fica de fora dos dois lados: as compras
// dele não passam pelo grafo (a corrida mede só o PostgreSQL).
const (
	CypherTambemComprou = `MATCH (:Sku {id: $sku})<-[:COMPROU]-(c:Cliente)-[:COMPROU]->(outro:Sku)
WHERE outro.id <> $sku AND outro.id <> $lab
RETURN outro.id AS sku, count(DISTINCT c) AS forca
ORDER BY forca DESC, sku
LIMIT 10`

	// Alcance: clientes que NÃO compraram o SKU, mas compraram algo que os
	// compradores dele compraram — três saltos de relacionamento.
	//
	// A versão "ingênua" (um MATCH só, com NOT (c2)-[:COMPROU]->(x) no WHERE)
	// dá a mesma resposta, mas anda por cada CAMINHO (~445 mil) e testa a
	// exclusão em cada um: 16,2 milhões de acessos ao banco no seed. Esta
	// junta os compradores numa lista e deduplica os SKUs do meio (WITH
	// DISTINCT) — como a CTE do SQL — e cai para 426 mil acessos. Em grafo,
	// também importa COMO se escreve a consulta.
	CypherAlcance = `MATCH (x:Sku {id: $sku})<-[:COMPROU]-(c1:Cliente)
WITH x, collect(c1) AS compradores
UNWIND compradores AS c1
MATCH (c1)-[:COMPROU]->(s2:Sku)
WHERE s2 <> x AND s2.id <> $lab
WITH DISTINCT s2, compradores
MATCH (s2)<-[:COMPROU]-(c2:Cliente)
WHERE NOT c2 IN compradores
RETURN count(DISTINCT c2) AS total`
)

// CypherExplicarAlcance: o mesmo caminho do alcance, mas agrupado pelo SKU do
// meio — quantos compradores de X o compraram (forca) e a quantos clientes
// novos ele leva (novos). Não entra na comparação: só desmonta o número.
// Ordena pela força: os caminhos mais percorridos a partir de X (pelos
// novos, os SKUs populares empatam e o exemplo não ensina nada).
const CypherExplicarAlcance = `MATCH (x:Sku {id: $sku})<-[:COMPROU]-(c1:Cliente)
WITH x, collect(c1) AS compradores
UNWIND compradores AS c1
MATCH (c1)-[:COMPROU]->(s2:Sku)
WHERE s2 <> x AND s2.id <> $lab
WITH compradores, s2, count(DISTINCT c1) AS forca
OPTIONAL MATCH (s2)<-[:COMPROU]-(c2:Cliente)
WHERE NOT c2 IN compradores
WITH compradores, s2, forca, count(DISTINCT c2) AS novos
ORDER BY forca DESC, novos DESC, s2.id
RETURN size(compradores) AS compradores, count(s2) AS intermediarios,
       collect({sku: s2.id, forca: forca, novos: novos})[0..5] AS caminhos`

type Grafo struct {
	driver neo4j.Driver
	erro   error
}

func NovoGrafo(driver neo4j.Driver, erroDeInicio error) *Grafo {
	return &Grafo{driver: driver, erro: erroDeInicio}
}

func (g *Grafo) rodar(ctx context.Context, cypher, sku string) (*neo4j.EagerResult, float64, error) {
	if g.erro != nil {
		return nil, 0, g.erro
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	inicio := time.Now()
	r, err := neo4j.ExecuteQuery(ctx, g.driver, cypher, map[string]any{"sku": sku, "lab": dominio.SkuLaboratorio.String()},
		neo4j.EagerResultTransformer, neo4j.ExecuteQueryWithDatabase("neo4j"), neo4j.ExecuteQueryWithReadersRouting())
	return r, float64(time.Since(inicio).Microseconds()) / 1000, err
}

func (g *Grafo) TambemCompraram(ctx context.Context, sku string) (dominio.Medida, error) {
	m := dominio.Medida{Banco: "Neo4j", Consulta: CypherTambemComprou, Linhas: []dominio.LinhaGrafo{}}
	r, ms, err := g.rodar(ctx, CypherTambemComprou, sku)
	if err != nil {
		return m, err
	}
	m.MS = ms
	for _, rec := range r.Records {
		s, _ := rec.Get("sku")
		f, _ := rec.Get("forca")
		m.Linhas = append(m.Linhas, dominio.LinhaGrafo{SkuID: s.(string), Forca: f.(int64)})
	}
	return m, nil
}

func (g *Grafo) Alcance(ctx context.Context, sku string) (dominio.Medida, error) {
	m := dominio.Medida{Banco: "Neo4j", Consulta: CypherAlcance, Linhas: []dominio.LinhaGrafo{}}
	r, ms, err := g.rodar(ctx, CypherAlcance, sku)
	if err != nil {
		return m, err
	}
	m.MS = ms
	t, _ := r.Records[0].Get("total")
	m.Total = t.(int64)
	return m, nil
}

func (g *Grafo) ExplicarAlcance(ctx context.Context, sku string) (dominio.ExplicacaoAlcance, error) {
	e := dominio.ExplicacaoAlcance{Caminhos: []dominio.CaminhoAlcance{}}
	r, _, err := g.rodar(ctx, CypherExplicarAlcance, sku)
	if err != nil || len(r.Records) == 0 { // sem compradores, o MATCH não devolve linha
		return e, err
	}
	rec := r.Records[0]
	c, _ := rec.Get("compradores")
	i, _ := rec.Get("intermediarios")
	e.Compradores, e.Intermediarios = c.(int64), i.(int64)
	caminhos, _ := rec.Get("caminhos")
	for _, x := range caminhos.([]any) {
		m := x.(map[string]any)
		e.Caminhos = append(e.Caminhos, dominio.CaminhoAlcance{SkuID: m["sku"].(string), Forca: m["forca"].(int64), Novos: m["novos"].(int64)})
	}
	return e, nil
}
