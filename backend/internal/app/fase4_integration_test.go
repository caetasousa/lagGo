//go:build integration

package app_test

import (
	"context"
	"strings"
	"testing"
)

// G4, G5, G6: o painel de administração do PostgreSQL.
func TestPainelAdministracao(t *testing.T) {
	s := novoServidor(t)
	s.req("POST", "/api/checkout", s.pedido(s.loja.Clientes[0], s.loja.Skus[0].ID, 1), nil)

	var tabelas []struct {
		Nome         string
		Particionada bool
		Particoes    int
		BytesTotal   int64 `json:"bytes_total"`
		Opcoes       []string
	}
	s.req("GET", "/api/dba/postgres/tabelas", nil, &tabelas)
	achou := map[string]bool{}
	for _, tb := range tabelas {
		achou[tb.Nome] = true
		if tb.Nome == "auditoria.log" && (!tb.Particionada || tb.Particoes < 5) {
			t.Errorf("[G4] auditoria.log deveria aparecer particionada (≥5 partições): %+v", tb)
		}
		if tb.Nome == "public.estoque" && !strings.Contains(strings.Join(tb.Opcoes, ","), "fillfactor=80") {
			t.Errorf("[G4] estoque sem o fillfactor da migração: %v", tb.Opcoes)
		}
	}
	for _, n := range []string{"public.pedido", "public.estoque", "auditoria.log", "lab.inchaco"} {
		if !achou[n] {
			t.Errorf("[G4] tabela %s ausente", n)
		}
	}
	for _, tb := range tabelas {
		if strings.HasPrefix(tb.Nome, "auditoria.log_") {
			t.Errorf("[G4] partição %s listada como tabela (deveria somar no pai)", tb.Nome)
		}
	}

	var indices []struct {
		Nome      string
		Primario  bool
		Unico     bool
		Candidato bool `json:"candidato_remocao"`
	}
	s.req("GET", "/api/dba/postgres/indices", nil, &indices)
	for _, i := range indices {
		if i.Candidato && (i.Primario || i.Unico) {
			t.Errorf("[G4] PK/UNIQUE marcado como removível: %s", i.Nome)
		}
	}

	var cache struct {
		TotalBuffers int64 `json:"total_buffers"`
		Relacoes     []struct{ Nome string }
	}
	s.req("GET", "/api/dba/postgres/cache", nil, &cache)
	if cache.TotalBuffers == 0 || len(cache.Relacoes) == 0 {
		t.Fatalf("[G5] pg_buffercache vazio: %+v", cache)
	}

	var m1, m2 struct{ Commits int64 }
	s.req("GET", "/api/dba/postgres/metricas", nil, &m1)
	s.req("POST", "/api/checkout", s.pedido(s.loja.Clientes[1], s.loja.Skus[1].ID, 1), nil)
	s.req("GET", "/api/dba/postgres/metricas", nil, &m2)
	if m1.Commits == 0 {
		t.Fatalf("[G6] métricas sem contador de commits: %+v", m1)
	}

	if st := s.req("POST", "/api/dba/postgres/manutencao", map[string]any{"acao": "vacuum", "tabela": "public.pedido"}, nil); st != 200 {
		t.Fatalf("VACUUM pela API: %d", st)
	}
	if st := s.req("POST", "/api/dba/postgres/manutencao", map[string]any{"acao": "vacuum", "tabela": "pg_catalog.pg_class"}, nil); st != 422 {
		t.Fatalf("tabela fora da aplicação deveria dar 422, deu %d", st)
	}
	if st := s.req("POST", "/api/dba/postgres/manutencao", map[string]any{"acao": "drop", "tabela": "public.pedido"}, nil); st != 400 {
		t.Fatalf("ação fora da lista deveria dar 400, deu %d", st)
	}
	if st := s.req("GET", "/api/dba/pgbouncer", nil, nil); st != 503 {
		t.Fatalf("sem PgBouncer configurado deveria dar 503, deu %d", st)
	}
}

// E3, E4: ajustes de sessão e partition pruning no Laboratório de Índices.
func TestLaboratorioAjustesEPruning(t *testing.T) {
	s := novoServidor(t)
	// Histórico dos últimos meses, como o seed faz.
	if _, err := s.pg.Exec(context.Background(), `CALL auditoria.garantir_particoes(6, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pg.Exec(context.Background(), `SELECT auditoria.gerar_historico(now() - make_interval(months => m), 2000) FROM generate_series(1, 6) m`); err != nil {
		t.Fatal(err)
	}
	var p struct{ Plano []string }
	plano := func(id string, corpo map[string]any) string {
		t.Helper()
		if st := s.req("POST", "/api/dba/indices/experimentos/"+id+"/explain", corpo, &p); st != 200 {
			t.Fatalf("explain %s: %d", id, st)
		}
		return strings.Join(p.Plano, "\n")
	}
	// Partições lidas = nós de leitura (Seq/Index/Bitmap…) sobre "log_…".
	contar := func(plano string) int { return strings.Count(plano, " on log_") }

	comPruning := plano("auditoria-um-mes", map[string]any{})
	semPruning := plano("auditoria-um-mes", map[string]any{"ajustes": map[string]string{"enable_partition_pruning": "off"}})
	comFuncao := plano("auditoria-mes-com-funcao", map[string]any{})
	if contar(comPruning) != 1 || contar(semPruning) < 5 || contar(comFuncao) < 5 {
		t.Fatalf("[E4] partições lidas: com pruning %d, desligado %d, com date_trunc %d\n%s",
			contar(comPruning), contar(semPruning), contar(comFuncao), comPruning)
	}

	// Com poucos pedidos o planner prefere Seq Scan; desligado, usa o índice.
	semSeq := plano("pedidos-do-cliente", map[string]any{"ajustes": map[string]string{"enable_seqscan": "off"}})
	if strings.Contains(semSeq, "Seq Scan on pedido") || !strings.Contains(semSeq, "idx_pedido_cliente_criado") {
		t.Fatalf("[E3] enable_seqscan=off não chegou ao plano:\n%s", semSeq)
	}
	if st := s.req("POST", "/api/dba/indices/experimentos/pedidos-do-cliente/explain",
		map[string]any{"ajustes": map[string]string{"shared_buffers": "1GB"}}, nil); st != 400 {
		t.Fatalf("ajuste fora da lista deveria dar 400, deu %d", st)
	}
}

// R1 e L3
func TestLabCacheEMeusPedidos(t *testing.T) {
	s := novoServidor(t)
	s.semearCatalogo()
	var r struct {
		Acertos, Falhas int
		SemCache        struct {
			P50MS float64 `json:"p50_ms"`
		} `json:"sem_cache"`
		ComCache struct {
			P50MS float64 `json:"p50_ms"`
		} `json:"com_cache"`
	}
	if st := s.req("POST", "/api/lab/cache", map[string]any{"leituras": 50}, &r); st != 200 {
		t.Fatalf("lab cache: %d", st)
	}
	if r.Falhas != 1 || r.Acertos != 49 {
		t.Fatalf("[R1] esperado 1 falha e 49 acertos: %+v", r)
	}

	c := s.loja.Clientes[3]
	var ped struct {
		PedidoID string `json:"pedido_id"`
	}
	s.req("POST", "/api/checkout", s.pedido(c, s.loja.Skus[2].ID, 1), &ped)
	var meus []struct{ ID string }
	s.req("GET", "/api/conta/pedidos", nil, &meus)
	if len(meus) != 1 || meus[0].ID != ped.PedidoID {
		t.Fatalf("[L3] meus pedidos: %+v", meus)
	}
	// Outra pessoa logada: nem na lista, nem pelo id (Q5, com RLS no banco).
	s.entrarComo(s.loja.Clientes[4])
	var outro []struct{ ID string }
	s.req("GET", "/api/conta/pedidos", nil, &outro)
	if len(outro) != 0 {
		t.Fatalf("[L3] pedido apareceu para outro cliente: %+v", outro)
	}
	if st := s.req("GET", "/api/conta/pedidos/"+ped.PedidoID, nil, nil); st != 404 {
		t.Fatalf("[Q5] o pedido de outra pessoa abriu pelo id: %d", st)
	}
}
