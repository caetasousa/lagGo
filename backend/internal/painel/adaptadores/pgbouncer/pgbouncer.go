// Package pgbouncer: o adaptador do Painel do DBA para o console de
// administração do PgBouncer — um banco virtual chamado pgbouncer, que só
// aceita o protocolo simples e comandos SHOW.
package pgbouncer

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// PgBouncer — o "console de administração" é um banco virtual chamado
// pgbouncer, que só aceita o protocolo simples e comandos SHOW.
// PgBouncer implementa portas.PgBouncer.
type PgBouncer struct {
	url string // postgres://...@pgbouncer:6432/pgbouncer ("" = não configurado)
}

func Novo(url string) *PgBouncer { return &PgBouncer{url: url} }

func (p *PgBouncer) Estado(ctx context.Context) (dominio.EstadoPgBouncer, error) {
	if p.url == "" {
		return nil, dominio.ErrIndisponivel{Msg: "PgBouncer não configurado (PGBOUNCER_ADMIN_URL)"}
	}
	cfg, err := pgx.ParseConfig(p.url)
	if err != nil {
		return nil, err
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, dominio.ErrIndisponivel{Msg: err.Error()}
	}
	defer conn.Close(ctx)
	out := dominio.EstadoPgBouncer{}
	for _, cmd := range []string{"POOLS", "STATS", "CONFIG"} {
		linhas, err := mostrar(ctx, conn, "SHOW "+cmd)
		if err != nil {
			return nil, err
		}
		if cmd == "CONFIG" { // só o que interessa ao estudo
			var filtradas []map[string]any
			for _, l := range linhas {
				if slices.Contains([]string{"pool_mode", "max_client_conn", "default_pool_size", "max_prepared_statements"}, l["key"].(string)) {
					filtradas = append(filtradas, l)
				}
			}
			linhas = filtradas
		}
		out[cmd] = linhas
	}
	return out, nil
}

// mostrar devolve as linhas de um SHOW como mapas coluna → valor (as colunas
// mudam entre versões do PgBouncer; não vale a pena fixá-las numa struct).
func mostrar(ctx context.Context, conn *pgx.Conn, sql string) ([]map[string]any, error) {
	rows, err := conn.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := map[string]any{}
		for i, f := range rows.FieldDescriptions() {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			m[f.Name] = v
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
