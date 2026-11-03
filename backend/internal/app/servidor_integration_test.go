//go:build integration

// O servidor inteiro por HTTP, com a mesma montagem da produção (app.Montar),
// contra PostgreSQL, MongoDB e Redis efêmeros. Rode com: make check-db
package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/nosqlgo/marketplace/internal/app"
	"github.com/nosqlgo/marketplace/internal/loja/adaptadores/senha"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

type servidor struct {
	t    *testing.T
	url  string
	loja testinfra.Loja
	pg   *pgxpool.Pool
	mg   *mongo.Database
	rdb  *redis.Client
	// Fase 6: cookie da sessão de quem está "logado" no teste (vazio = ninguém)
	// e de quem ele é.
	sessao string
	quem   uuid.UUID
}

func novoServidor(t *testing.T, opcoes ...app.Opcoes) *servidor {
	t.Helper()
	var op app.Opcoes
	if len(opcoes) > 0 {
		op = opcoes[0]
	}
	return novoServidorCom(t, op, nil)
}

// novoServidorCom: o mesmo servidor, com a chance de mexer nas conexões antes
// de montar (a Fase 7 pluga Cassandra e Neo4j efêmeros, ou endereços mortos).
func novoServidorCom(t *testing.T, op app.Opcoes, ajustar func(*app.Conexoes)) *servidor {
	t.Helper()
	pg := testinfra.Postgres(t)
	mg, mgDB := testinfra.Mongo(t)
	rdb := testinfra.Redis(t)
	loja := testinfra.SemearLoja(t, pg)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if op.ChaveCPF == "" {
		op.ChaveCPF = "chave-de-teste"
	}
	con := app.Conexoes{Postgres: pg, Mongo: mg, MongoDB: mgDB, Redis: rdb}
	if ajustar != nil {
		ajustar(&con)
	}
	h, err := app.Montar(ctx, con, op)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &servidor{t: t, url: srv.URL, loja: loja, pg: pg, mg: mg.Database(mgDB), rdb: rdb}
}

// req faz a chamada e decodifica o JSON da resposta em `out` (se não for nil).
func (s *servidor) req(metodo, caminho string, corpo any, out any, headers ...string) int {
	s.t.Helper()
	var body io.Reader
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		body = bytes.NewReader(b)
	}
	r, _ := http.NewRequest(metodo, s.url+caminho, body)
	r.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	if s.sessao != "" {
		r.AddCookie(&http.Cookie{Name: "nosqlgo_sessao", Value: s.sessao})
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		raw, _ := io.ReadAll(resp.Body)
		if err := json.Unmarshal(raw, out); err != nil {
			s.t.Fatalf("%s %s: resposta não é o JSON esperado (%d): %s", metodo, caminho, resp.StatusCode, raw)
		}
	}
	return resp.StatusCode
}

// SenhaDeTeste: a senha que entrarComo grava para os clientes do seed.
const SenhaDeTeste = "senha-de-teste-123"

// entrarComo (Fase 6): os clientes do seed não têm senha. Grava uma
// credencial argon2id para ele direto no banco EFÊMERO do teste, entra pela
// API (POST /api/conta/entrar) e guarda o cookie para as próximas chamadas.
func (s *servidor) entrarComo(c testinfra.Cliente) {
	s.t.Helper()
	if s.quem == c.ID && s.sessao != "" {
		return
	}
	hash, err := senha.Novo().Gerar(SenhaDeTeste)
	if err != nil {
		s.t.Fatal(err)
	}
	var email string
	if err := s.pg.QueryRow(context.Background(), `
		WITH cr AS (INSERT INTO conta.credencial (cliente_id, senha_hash) VALUES ($1, $2)
		             ON CONFLICT (cliente_id) DO UPDATE SET senha_hash = excluded.senha_hash)
		SELECT email::text FROM cliente WHERE id = $1`, c.ID, hash).Scan(&email); err != nil {
		s.t.Fatal(err)
	}
	b, _ := json.Marshal(map[string]string{"email": email, "senha": SenhaDeTeste})
	resp, err := http.Post(s.url+"/api/conta/entrar", "application/json", bytes.NewReader(b))
	if err != nil {
		s.t.Fatal(err)
	}
	resp.Body.Close()
	for _, ck := range resp.Cookies() {
		if ck.Name == "nosqlgo_sessao" {
			s.sessao, s.quem = ck.Value, c.ID
			return
		}
	}
	s.t.Fatalf("entrar como %s: sem cookie de sessão (status %d)", c.Nome, resp.StatusCode)
}

func (s *servidor) sair() { s.sessao, s.quem = "", uuid.Nil }

// pedido monta o corpo da compra E entra como o cliente: desde a Fase 6 a
// compra é sempre de quem está logado.
func (s *servidor) pedido(cliente testinfra.Cliente, sku uuid.UUID, qtd int) map[string]any {
	s.entrarComo(cliente)
	return map[string]any{
		"cliente_id": cliente.ID, "endereco_id": cliente.EnderecoID, "metodo_pagamento": "PIX",
		"itens": []map[string]any{{"sku_id": sku, "quantidade": qtd}},
	}
}

// Como quebra: um banco do núcleo aparece fora do ar, ou os opcionais (a
// réplica, que o testinfra não sobe; Cassandra e Neo4j, da Fase 7) aparecem
// como "down" em vez de "disabled".
func TestHealthMostraNucleoNoArEOpcionaisDesabilitados(t *testing.T) {
	s := novoServidor(t)
	var status []struct{ Name, Status string }
	s.req("GET", "/api/health", nil, &status)
	esperado := map[string]string{"PostgreSQL": "up", "PostgreSQL réplica": "disabled", "MongoDB": "up", "Redis": "up",
		"Cassandra": "disabled", "Neo4j": "disabled"}
	if len(status) != len(esperado) {
		t.Errorf("o health devolveu %d bancos, esperado %d: %+v", len(status), len(esperado), status)
	}
	for _, st := range status {
		if esperado[st.Name] != st.Status {
			t.Errorf("%s: %s (esperado %s)", st.Name, st.Status, esperado[st.Name])
		}
	}
}

// Como quebra: o contrato HTTP do checkout muda (status, idempotência,
// mapeamento de erro do banco para 4xx).
func TestCheckoutPorHTTP(t *testing.T) {
	s := novoServidor(t)
	c, sku := s.loja.Clientes[0], s.loja.Skus[0].ID
	chave := uuid.NewString()

	var r1, r2 struct {
		PedidoID      string  `json:"pedido_id"`
		Total         float64 `json:"total"`
		Reaproveitado bool    `json:"reaproveitado"`
	}
	if st := s.req("POST", "/api/checkout", s.pedido(c, sku, 2), &r1, "Idempotency-Key", chave); st != 201 {
		t.Fatalf("checkout: %d", st)
	}
	if st := s.req("POST", "/api/checkout", s.pedido(c, sku, 2), &r2, "Idempotency-Key", chave); st != 200 || !r2.Reaproveitado || r2.PedidoID != r1.PedidoID {
		t.Fatalf("repetição com a mesma chave: %d %+v", st, r2)
	}

	var detalhe struct {
		Status string
		Total  float64
		Itens  []struct{ Quantidade int }
	}
	s.req("GET", "/api/conta/pedidos/"+r1.PedidoID, nil, &detalhe)
	if detalhe.Status != "PAGO" || detalhe.Total != r1.Total || len(detalhe.Itens) != 1 {
		t.Fatalf("pedido gravado diferente do retornado: %+v", detalhe)
	}

	casos := []struct {
		nome   string
		corpo  any
		status int
	}{
		{"sem estoque", s.pedido(c, sku, 999), 409},
		{"endereço de outro cliente", map[string]any{
			"cliente_id": c.ID, "endereco_id": s.loja.Clientes[1].EnderecoID, "metodo_pagamento": "PIX",
			"itens": []map[string]any{{"sku_id": sku, "quantidade": 1}}}, 422},
		{"sku inexistente", s.pedido(c, uuid.New(), 1), 422},
		{"campo desconhecido", map[string]any{"xyz": 1}, 400},
	}
	for _, tc := range casos {
		var e struct{ Error string }
		if st := s.req("POST", "/api/checkout", tc.corpo, &e); st != tc.status || e.Error == "" {
			t.Errorf("%s: status %d (esperado %d), erro %q", tc.nome, st, tc.status, e.Error)
		}
	}
}

// Como quebra: compra nova não entra no relatório depois do REFRESH, ou o
// total geral do CUBE não bate com a soma das UFs.
func TestRelatoriosDepoisDoRefresh(t *testing.T) {
	s := novoServidor(t)
	for _, c := range s.loja.Clientes[:3] {
		s.req("POST", "/api/checkout", s.pedido(c, s.loja.Skus[2].ID, 1), nil)
	}
	// Antes do refresh a materialized view está vazia: o CUBE devolve só a
	// linha do total geral, com zero (e não 500 por causa do NULL).
	var vazio []struct{ Pedidos, Nivel int }
	if st := s.req("GET", "/api/relatorios/vendas-mensais", nil, &vazio); st != 200 || len(vazio) != 1 || vazio[0].Pedidos != 0 {
		t.Fatalf("antes do refresh: %d %+v", st, vazio)
	}

	if st := s.req("POST", "/api/relatorios/atualizar", map[string]any{}, nil); st != 200 {
		t.Fatalf("refresh: %d", st)
	}
	var linhas []struct {
		Uf      string
		Pedidos int
		Nivel   int
	}
	s.req("GET", "/api/relatorios/vendas-mensais", nil, &linhas)
	var geral, somaUF int
	for _, l := range linhas {
		switch l.Nivel {
		case 3:
			geral = l.Pedidos
		case 2:
			somaUF += l.Pedidos
		}
	}
	if geral != 3 || somaUF != geral {
		t.Fatalf("total geral %d, soma das UFs %d (esperado 3 e 3)", geral, somaUF)
	}
}

// Como quebra: criar o índice não muda o plano, ou o DDL não é auditado.
func TestLaboratorioDeIndices(t *testing.T) {
	s := novoServidor(t)
	explain := func() string {
		var r struct{ Plano []string }
		if st := s.req("POST", "/api/dba/indices/experimentos/nome-sem-caixa/explain", map[string]any{}, &r); st != 200 {
			t.Fatalf("explain: %d", st)
		}
		return strings.Join(r.Plano, "\n")
	}
	if p := explain(); strings.Contains(p, "idx_lab_cliente_lower_nome") {
		t.Fatal("o índice do laboratório já existia")
	}
	if st := s.req("POST", "/api/dba/indices/idx_lab_cliente_lower_nome", map[string]any{}, nil); st != 200 {
		t.Fatalf("criar índice: %d", st)
	}
	// Com 20 clientes o planner pode preferir Seq Scan mesmo com índice; o
	// que se garante aqui é o índice existir e o DDL ficar auditado.
	var exps []struct {
		ID      string
		Indices []struct {
			Nome   string
			Existe bool
		}
	}
	s.req("GET", "/api/dba/indices/experimentos", nil, &exps)
	criado := false
	for _, e := range exps {
		for _, i := range e.Indices {
			criado = criado || (i.Nome == "idx_lab_cliente_lower_nome" && i.Existe)
		}
	}
	if !criado {
		t.Fatal("índice não aparece como existente")
	}
	if st := s.req("DELETE", "/api/dba/indices/idx_lab_cliente_lower_nome", nil, nil); st != 204 {
		t.Fatalf("remover índice: %d", st)
	}
	if st := s.req("POST", "/api/dba/indices/qualquer;DROP TABLE pedido", map[string]any{}, nil); st != 404 {
		t.Fatalf("nome fora do catálogo deveria dar 404, deu %d", st)
	}

	var ddl []struct{ Comando, Objeto string }
	s.req("GET", "/api/dba/auditoria/ddl", nil, &ddl)
	var viuCreate, viuDrop bool
	for _, d := range ddl {
		viuCreate = viuCreate || (d.Comando == "CREATE INDEX" && strings.HasSuffix(d.Objeto, "idx_lab_cliente_lower_nome"))
		viuDrop = viuDrop || (d.Comando == "DROP INDEX" && strings.HasSuffix(d.Objeto, "idx_lab_cliente_lower_nome"))
	}
	if !viuCreate || !viuDrop {
		t.Fatalf("auditoria de DDL incompleta: %+v", ddl)
	}
}
