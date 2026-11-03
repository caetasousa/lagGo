//go:build integration

package aplicacao_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/postgres"
	"github.com/nosqlgo/marketplace/internal/laboratorio/aplicacao"
	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

// J1–J4: cada roteiro em cada nível, contra a tabela de anomalias do
// PostgreSQL (docs/03 §4). Se o PostgreSQL mudar de comportamento — ou
// alguém "consertar" um roteiro —, a tabela da aula deixa de valer.
func TestIsolamentoTabelaDeAnomalias(t *testing.T) {
	pool := testinfra.Postgres(t)
	casos := []struct {
		roteiro, nivel string
		anomalia       bool
		codigo         string // SQLSTATE esperado em algum passo ("" = nenhum)
	}{
		{"leitura-suja", "read_uncommitted", false, ""}, // PG nunca lê sujo
		{"leitura-nao-repetivel", "read_committed", true, ""},
		{"leitura-nao-repetivel", "repeatable_read", false, ""},
		{"fantasma", "read_committed", true, ""},
		{"fantasma", "repeatable_read", false, ""}, // no PG, RR também impede fantasma
		{"lost-update", "read_committed", true, ""},
		{"lost-update", "repeatable_read", false, "40001"},
		{"write-skew", "repeatable_read", true, ""},
		{"write-skew", "serializable", false, "40001"},
		{"deadlock", "read_committed", true, "40P01"},
	}
	for _, c := range casos {
		t.Run(c.roteiro+"/"+c.nivel, func(t *testing.T) {
			r, err := aplicacao.NovoIsolamento(postgres.NovoIsolamento(pool)).Rodar(context.Background(), c.roteiro, c.nivel)
			if err != nil {
				t.Fatal(err)
			}
			if r.Anomalia != c.anomalia {
				t.Errorf("anomalia = %v, esperado %v (estado final %q)", r.Anomalia, c.anomalia, r.EstadoFinal)
			}
			achou := ""
			for _, p := range r.Passos {
				if p.Codigo != "" {
					achou = p.Codigo
				}
			}
			if achou != c.codigo {
				t.Errorf("SQLSTATE = %q, esperado %q: %+v", achou, c.codigo, r.Passos)
			}
		})
	}
}

// H1, H2, H3
func TestMVCCVacuumEHot(t *testing.T) {
	pool := testinfra.Postgres(t)
	ctx := context.Background()
	acao := func(a string, ff int) dominio.ResultadoMVCC {
		t.Helper()
		r, err := aplicacao.NovoMVCC(postgres.NovoMVCC(pool)).Executar(ctx, a, ff)
		if err != nil {
			t.Fatalf("%s: %v", a, err)
		}
		return r
	}

	acao("recriar", 100)
	up := acao("atualizar_indexada", 0)
	if up.Atualizadas != dominio.LinhasDoInchaco/10 || up.Depois.TuplasMortas < up.Atualizadas || up.HOT != 0 {
		t.Fatalf("[H1] UPDATE em coluna indexada: %d mortas, %d HOT", up.Depois.TuplasMortas, up.HOT)
	}
	if up.Depois.BytesTabela <= up.Antes.BytesTabela {
		t.Fatalf("[H1] a tabela deveria crescer com as versões novas")
	}
	vac := acao("vacuum", 0)
	if vac.Depois.TuplasMortas != 0 || vac.Depois.BytesTabela < vac.Antes.BytesTabela {
		t.Fatalf("[H2] VACUUM: %d mortas, %d → %d bytes (não deveria encolher)", vac.Depois.TuplasMortas, vac.Antes.BytesTabela, vac.Depois.BytesTabela)
	}
	full := acao("vacuum_full", 0)
	if full.Depois.BytesTabela >= full.Antes.BytesTabela {
		t.Fatalf("[H2] VACUUM FULL não devolveu espaço: %d → %d", full.Antes.BytesTabela, full.Depois.BytesTabela)
	}

	acao("recriar", 100)
	cheio := acao("atualizar", 0)
	acao("recriar", 70)
	hot := acao("atualizar", 0)
	if float64(hot.HOT) < 0.9*float64(hot.Atualizadas) || hot.HOT <= cheio.HOT {
		t.Fatalf("[H3] HOT: fillfactor 70 = %d de %d; fillfactor 100 = %d", hot.HOT, hot.Atualizadas, cheio.HOT)
	}
	t.Logf("HOT com fillfactor 100: %d/%d · com 70: %d/%d", cheio.HOT, cheio.Atualizadas, hot.HOT, hot.Atualizadas)
}

// P1, P2
func TestExpurgoDeleteXDrop(t *testing.T) {
	pool := testinfra.Postgres(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "CALL auditoria.garantir_particoes(3, 1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "SELECT auditoria.gerar_historico(now() - interval '2 months', 5000)"); err != nil {
		t.Fatal(err)
	}

	del, err := aplicacao.NovoExpurgo(postgres.NovoExpurgo(pool)).Expurgar(ctx, "delete", 20000)
	if err != nil {
		t.Fatal(err)
	}
	if del.LinhasRemovidas != 20000 || del.TuplasMortas != 20000 || del.BytesDepois != del.BytesAntes {
		t.Fatalf("[P1] DELETE: %+v", del)
	}
	drop, err := aplicacao.NovoExpurgo(postgres.NovoExpurgo(pool)).Expurgar(ctx, "drop", 20000)
	if err != nil {
		t.Fatal(err)
	}
	if drop.WALBytes*10 > del.WALBytes {
		t.Fatalf("[P1] DROP deveria gerar MUITO menos WAL: drop %d × delete %d", drop.WALBytes, del.WALBytes)
	}
	for _, r := range []dominio.ResultadoExpurgo{del, drop} {
		if r.OutrasAntes != r.OutrasDepois || r.OutrasAntes < 5000 {
			t.Fatalf("[P2] %s mexeu em outros meses: %d → %d", r.Metodo, r.OutrasAntes, r.OutrasDepois)
		}
	}
}

// N1, N3 (o modo pgbouncer é coberto no E2E, onde o PgBouncer existe)
func TestConexoesDiretoXPool(t *testing.T) {
	pool := testinfra.Postgres(t)
	testinfra.SemearLoja(t, pool)
	ctx := context.Background()
	c := aplicacao.NovasConexoes(postgres.NovasConexoes(pool, pool.Config().ConnString(), ""))

	direto, err := c.Rodar(ctx, "direto", 5, 2)
	if err != nil {
		t.Fatal(err)
	}
	comPool, err := c.Rodar(ctx, "pool", 5, 2)
	if err != nil {
		t.Fatal(err)
	}
	if direto.Erros != 0 || comPool.Erros != 0 || direto.Operacoes == 0 {
		t.Fatalf("erros inesperados: direto %+v pool %+v", direto, comPool)
	}
	if comPool.OpsPorSegundo <= direto.OpsPorSegundo || comPool.P50MS >= direto.P50MS {
		t.Fatalf("[N1] conexão nova por requisição deveria custar mais: direto %.0f ops/s p50 %.2f × pool %.0f ops/s p50 %.2f",
			direto.OpsPorSegundo, direto.P50MS, comPool.OpsPorSegundo, comPool.P50MS)
	}

	muitos, err := c.Rodar(ctx, "direto", 120, 2)
	if err != nil {
		t.Fatal(err)
	}
	if muitos.Erros == 0 || muitos.PrimeiroErro[:5] != "53300" {
		t.Fatalf("[N3] 120 clientes diretos deveriam esbarrar no max_connections (%d): %+v", muitos.MaxConnections, muitos)
	}
	if _, err := c.Rodar(ctx, "pgbouncer", 5, 1); err == nil {
		t.Fatal("sem PGBOUNCER_URL o modo pgbouncer deveria ser recusado")
	}
}

// Como quebra (S6): sem a réplica conectada como síncrona, um COMMIT com
// remote_write/on/remote_apply esperaria por ela PARA SEMPRE — e quem chamou
// (a loja inteira, se fosse o padrão) travaria junto. O laboratório precisa
// recusar antes de começar.
//
// O banco de teste é um primário sem réplica nenhuma: exatamente a condição.
// Como "réplica" de leitura usamos outra conexão ao mesmo banco — basta para
// os modos que não esperam (e lá a linha sempre está visível).
func TestReplicacaoRecusaModoQueEsperaSemReplicaSincrona(t *testing.T) {
	pool := testinfra.Postgres(t)
	ctx := context.Background()
	lab := aplicacao.NovaReplicacao(postgres.NovaReplicacao(pool, pool))
	for _, modo := range []string{"remote_write", "on", "remote_apply"} {
		_, err := lab.Rodar(ctx, modo, 3, false)
		var val dominio.ErrValidacao
		if !errors.As(err, &val) {
			t.Fatalf("[S6] %s sem réplica síncrona deveria ser recusado, veio: %v", modo, err)
		}
	}
	r, err := lab.Rodar(ctx, "local", 5, false)
	if err != nil {
		t.Fatal(err)
	}
	if r.VisiveisNaHora != 5 || r.EstadoReplica != "desconectada" {
		t.Fatalf("local deveria rodar sem esperar a réplica: %+v", r)
	}
	if _, err := aplicacao.NovaReplicacao(postgres.NovaReplicacao(pool, nil)).Rodar(ctx, "local", 1, false); !errors.As(err, new(dominio.ErrValidacao)) {
		t.Fatalf("sem réplica configurada deveria ser recusado, veio: %v", err)
	}
}

// Como quebra (S7): com a réplica parada, nada do que é gravado no primário
// aparece nela. O laboratório esperava 2 s por transação — 50 transações,
// 100 s —, o servidor cortava a requisição em 60 s e a tela falhava sem
// explicar. Tem de desistir cedo e dizer o que está errado.
//
// A "réplica" aqui é OUTRO banco efêmero (mesmo esquema, dados à parte): o
// que se grava no primário nunca chega nela, como numa réplica parada.
func TestReplicacaoComReplicaParadaDesisteCedoEExplica(t *testing.T) {
	primario, parada := testinfra.Postgres(t), testinfra.Postgres(t)
	lab := aplicacao.NovaReplicacao(postgres.NovaReplicacao(primario, parada))
	inicio := time.Now()
	_, err := lab.Rodar(context.Background(), "local", 50, false)
	if d := time.Since(inicio); d > 5*time.Second {
		t.Fatalf("[S7] com a réplica parada a rodada levou %v: tem de desistir em poucos segundos", d)
	}
	var val dominio.ErrValidacao
	if !errors.As(err, &val) || !strings.Contains(err.Error(), "postgres-replica") {
		t.Fatalf("[S7] esperado erro explicando que a réplica está parada (e o serviço a conferir), veio: %v", err)
	}
}
