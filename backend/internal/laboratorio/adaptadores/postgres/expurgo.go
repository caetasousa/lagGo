package postgres

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Laboratório de Expurgo: apagar UM MÊS da auditoria particionada de dois
// jeitos. O mês usado é de 18 meses atrás — fora do histórico do seed (13
// meses), numa partição criada e preenchida só para o experimento.

var expurgoMu sync.Mutex

// Expurgo implementa portas.Expurgo.
type Expurgo struct{ pool *pgxpool.Pool }

func NovoExpurgo(pool *pgxpool.Pool) *Expurgo { return &Expurgo{pool: pool} }

func (a *Expurgo) Expurgar(ctx context.Context, metodo string, linhas int) (dominio.ResultadoExpurgo, error) {
	pool := a.pool
	expurgoMu.Lock()
	defer expurgoMu.Unlock()
	r := dominio.ResultadoExpurgo{Metodo: metodo}

	// 1. Prepara o mês: partição própria, vazia, com N linhas.
	mes := time.Now().AddDate(0, -dominio.MesesAtrasDoExpurgo, 0)
	if err := pool.QueryRow(ctx, "SELECT auditoria.criar_particao($1)", mes).Scan(&r.Particao); err != nil {
		return r, err
	}
	tabela := pgx.Identifier{"auditoria", r.Particao}.Sanitize()
	for _, sql := range []string{"TRUNCATE " + tabela} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			return r, err
		}
	}
	if _, err := pool.Exec(ctx, "SELECT auditoria.gerar_historico($1, $2)", mes, linhas); err != nil {
		return r, err
	}
	if _, err := pool.Exec(ctx, "ANALYZE "+tabela); err != nil {
		return r, err
	}
	contarOutras := func() (n int64, err error) {
		// Por NOME: depois do DROP a partição não existe mais (::regclass falharia).
		// Só os meses JÁ FECHADOS: o mês corrente continua recebendo auditoria
		// da loja durante o expurgo (outras compras, outros usuários), e esses
		// INSERTs legítimos fariam o "antes → depois" mudar sem que nada tivesse
		// sido apagado fora do mês expurgado.
		err = pool.QueryRow(ctx, `SELECT count(*) FROM auditoria.log
		  WHERE tableoid::regclass::text <> $1 AND em < date_trunc('month', now())`, "auditoria."+r.Particao).Scan(&n)
		return
	}
	var err error
	if r.OutrasAntes, err = contarOutras(); err != nil {
		return r, err
	}
	if err := pool.QueryRow(ctx, "SELECT pg_total_relation_size($1::regclass)", "auditoria."+r.Particao).Scan(&r.BytesAntes); err != nil {
		return r, err
	}

	// 2. Mede só o expurgo.
	var lsn0 string
	_ = pool.QueryRow(ctx, "SELECT pg_current_wal_lsn()::text").Scan(&lsn0)
	inicio := time.Now()
	switch metodo {
	case "delete":
		// DELETE pelo intervalo do mês (o mesmo cálculo de fuso das partições):
		// cada linha vira uma tupla morta e uma entrada no WAL.
		tag, err := pool.Exec(ctx, `
DELETE FROM auditoria.log
 WHERE em >= date_trunc('month', $1::timestamptz AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
   AND em <  (date_trunc('month', $1::timestamptz AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo'`, mes)
		if err != nil {
			return r, err
		}
		r.LinhasRemovidas = tag.RowsAffected()
	case "drop":
		// DETACH + DROP: remove o ARQUIVO da partição. Custo independe do
		// número de linhas; quase nada vai para o WAL.
		r.LinhasRemovidas = int64(linhas)
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "ALTER TABLE auditoria.log DETACH PARTITION "+tabela); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "DROP TABLE "+tabela)
			return err
		})
		if err != nil {
			return r, err
		}
	}
	r.DuracaoMS = float64(time.Since(inicio).Microseconds()) / 1000
	_ = pool.QueryRow(ctx, "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::bigint", lsn0).Scan(&r.WALBytes)

	// 3. O que sobrou.
	if metodo == "delete" {
		_ = pool.QueryRow(ctx, "SELECT pg_total_relation_size($1::regclass), (pgstattuple($1::regclass)).dead_tuple_count",
			"auditoria."+r.Particao).Scan(&r.BytesDepois, &r.TuplasMortas)
	}
	r.OutrasDepois, err = contarOutras()
	return r, err
}
