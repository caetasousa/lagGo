// Package neo4j é o adaptador da loja para o Neo4j (Fase 7): o grafo
// (Cliente)-[:COMPROU {unidades}]->(Sku), base do "quem comprou também comprou".
//
// No grafo, "os vizinhos dos meus vizinhos" é andar por ponteiros: cada nó
// guarda os seus relacionamentos (index-free adjacency) — o custo depende de
// quantos vizinhos há, não do tamanho do banco. No SQL, a mesma pergunta é um
// self-join em item_pedido (compare no Laboratório Grafo × SQL).
package neo4j

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

// Grafo implementa portas.Grafo.
type Grafo struct {
	driver neo4j.Driver
	erro   error // storage.ErrDisabled quando o Neo4j não foi configurado

	mu     sync.Mutex
	pronto bool
}

func NovoGrafo(driver neo4j.Driver, erroDeInicio error) *Grafo {
	return &Grafo{driver: driver, erro: erroDeInicio}
}

func (g *Grafo) consultar(ctx context.Context, cypher string, params map[string]any) (*neo4j.EagerResult, error) {
	if g.erro != nil {
		return nil, g.erro
	}
	if err := g.garantirEsquema(ctx); err != nil {
		return nil, err
	}
	return neo4j.ExecuteQuery(ctx, g.driver, cypher, params, neo4j.EagerResultTransformer, neo4j.ExecuteQueryWithDatabase("neo4j"))
}

// garantirEsquema: as restrições de unicidade criam os índices que o MERGE
// usa para achar o nó — sem elas, cada MERGE varreria todos os nós do label.
func (g *Grafo) garantirEsquema(ctx context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.pronto {
		return nil
	}
	// Desligado do CANCELAMENTO da requisição (se o navegador sai da página
	// no meio, a criação não morre junto — E2E [Y1]), mas preso ao PRAZO dela:
	// com o Neo4j fora, uma compra não pode esperar 30 s pelo esquema (Y4).
	prazo, ok := ctx.Deadline()
	if !ok {
		prazo = time.Now().Add(30 * time.Second)
	}
	ctx, cancel := context.WithDeadline(context.WithoutCancel(ctx), prazo)
	defer cancel()
	for _, c := range []string{
		"CREATE CONSTRAINT cliente_id IF NOT EXISTS FOR (c:Cliente) REQUIRE c.id IS UNIQUE",
		"CREATE CONSTRAINT sku_id IF NOT EXISTS FOR (s:Sku) REQUIRE s.id IS UNIQUE",
	} {
		if _, err := neo4j.ExecuteQuery(ctx, g.driver, c, nil, neo4j.EagerResultTransformer, neo4j.ExecuteQueryWithDatabase("neo4j")); err != nil {
			return err
		}
	}
	g.pronto = true
	return nil
}

// Registrar: UNWIND transforma a lista em linhas; MERGE cria só o que falta
// — repetir a mesma compra soma unidades, mas não duplica nó nem aresta.
func (g *Grafo) Registrar(ctx context.Context, compras []dominio.Compra) error {
	var linhas []map[string]any
	for _, c := range compras {
		for _, it := range c.Itens {
			linhas = append(linhas, map[string]any{"cliente": c.ClienteID.String(), "sku": it.SkuID.String(), "unidades": int64(it.Quantidade)})
		}
	}
	if len(linhas) == 0 {
		return nil
	}
	_, err := g.consultar(ctx, `
		UNWIND $linhas AS l
		MERGE (c:Cliente {id: l.cliente})
		MERGE (s:Sku {id: l.sku})
		MERGE (c)-[r:COMPROU]->(s)
		  ON CREATE SET r.unidades = l.unidades
		  ON MATCH  SET r.unidades = r.unidades + l.unidades`, map[string]any{"linhas": linhas})
	return err
}

// ConsultaTambemCompraram: dois saltos a partir dos SKUs do produto. Exportada
// para o Laboratório Grafo × SQL mostrar exatamente esta consulta.
const ConsultaTambemCompraram = `MATCH (s:Sku) WHERE s.id IN $skus
MATCH (s)<-[:COMPROU]-(c:Cliente)-[:COMPROU]->(outro:Sku)
WHERE NOT outro.id IN $skus
RETURN outro.id AS sku, count(DISTINCT c) AS forca
ORDER BY forca DESC, sku
LIMIT $limite`

func (g *Grafo) TambemCompraram(ctx context.Context, skus []string, limite int) ([]dominio.Coocorrencia, error) {
	// Leitura da página do produto: prazo curto. Sem prazo, o driver repete a
	// transação por até 30 s quando o Neo4j está fora — e a página esperaria.
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	r, err := g.consultar(ctx, ConsultaTambemCompraram, map[string]any{"skus": skus, "limite": int64(limite)})
	if err != nil {
		return nil, err
	}
	out := make([]dominio.Coocorrencia, 0, len(r.Records))
	for _, rec := range r.Records {
		sku, _ := rec.Get("sku")
		forca, _ := rec.Get("forca")
		out = append(out, dominio.Coocorrencia{SkuID: sku.(string), Forca: forca.(int64)})
	}
	return out, nil
}

// Aquecer prepara o Neo4j para a primeira visita: garante o esquema e roda
// uma vez a consulta das recomendações. Um Neo4j recém-ligado leva ~1,2 s na
// primeira consulta (JIT da JVM, page cache vazio, plano do Cypher ainda não
// compilado — o plano fica em cache pelo TEXTO da consulta, por isso é a mesma
// constante). Com a máquina ocupada isso passava do prazo de 3 s da página, e
// o primeiro visitante via "recomendações indisponíveis" (E2E [Y1]).
// Repete a cada 10 s até o Neo4j responder (ele sobe depois da API).
func (g *Grafo) Aquecer(ctx context.Context) {
	if g.erro != nil {
		return
	}
	for {
		inicio := time.Now()
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		_, err := g.consultar(c, ConsultaTambemCompraram, map[string]any{"skus": []string{""}, "limite": int64(1)})
		cancel()
		if err == nil {
			slog.Info("neo4j aquecido", "ms", time.Since(inicio).Milliseconds())
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}

// Limpar apaga o grafo em lotes (CALL … IN TRANSACTIONS): apagar 300 mil
// relacionamentos numa transação só estouraria a memória do Neo4j de estudo.
// IN TRANSACTIONS exige transação implícita (auto-commit), por isso Run.
//
// Primeiro as arestas, depois os nós. Um lote de N nós com DETACH DELETE
// levaria junto TODAS as arestas deles — um SKU popular tem centenas — e o
// lote deixaria de ter tamanho previsível (medido: 5000 nós por lote
// estourava o limite de 179 MiB por transação com ~237 mil arestas).
func (g *Grafo) Limpar(ctx context.Context) error {
	if g.erro != nil {
		return g.erro
	}
	if err := g.garantirEsquema(ctx); err != nil {
		return err
	}
	s := g.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: "neo4j"})
	defer s.Close(ctx)
	for _, c := range []string{
		"MATCH ()-[r]->() CALL (r) { DELETE r } IN TRANSACTIONS OF 10000 ROWS",
		"MATCH (n) CALL (n) { DELETE n } IN TRANSACTIONS OF 10000 ROWS",
	} {
		res, err := s.Run(ctx, c, nil)
		if err != nil {
			return err
		}
		if _, err = res.Consume(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (g *Grafo) Estado(ctx context.Context) (dominio.EstadoDoGrafo, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	r, err := g.consultar(ctx, `
		CALL () { MATCH (c:Cliente) RETURN count(c) AS clientes }
		CALL () { MATCH (s:Sku) RETURN count(s) AS skus }
		CALL () { MATCH ()-[r:COMPROU]->() RETURN count(r) AS compras }
		RETURN clientes, skus, compras`, nil)
	if err != nil {
		return dominio.EstadoDoGrafo{}, err
	}
	rec := r.Records[0]
	c, _ := rec.Get("clientes")
	s, _ := rec.Get("skus")
	k, _ := rec.Get("compras")
	return dominio.EstadoDoGrafo{Clientes: c.(int64), Skus: s.(int64), Compras: k.(int64)}, nil
}

// Comprou (para os testes): o cliente tem aresta COMPROU para o SKU?
func (g *Grafo) Comprou(ctx context.Context, cliente, sku uuid.UUID) (bool, error) {
	r, err := g.consultar(ctx, `RETURN EXISTS { (:Cliente {id: $c})-[:COMPROU]->(:Sku {id: $s}) } AS ok`,
		map[string]any{"c": cliente.String(), "s": sku.String()})
	if err != nil {
		return false, err
	}
	ok, _ := r.Records[0].Get("ok")
	return ok.(bool), nil
}
