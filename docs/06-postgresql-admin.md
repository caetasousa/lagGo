# 06 · Administração e otimização do PostgreSQL (8.7)

## 1. Arquitetura em 1 minuto

- **Um processo por conexão** (*backend*), criado pelo processo principal
  (*postmaster*). Por isso conexões custam caro e usamos **pool** (pgxpool na
  API e, na Fase 4, o PgBouncer).
- **Memória compartilhada:** `shared_buffers` (cache de páginas de 8 KB) e WAL buffers.
- **Processos auxiliares:** checkpointer, background writer, WAL writer,
  **autovacuum launcher/workers**, WAL senders (replicação) e stats.
- **Disco:** arquivos de dados (heap + índices), **WAL** (`pg_wal/`) e arquivos de configuração.

Veja com `SELECT pid, backend_type FROM pg_stat_activity;`.

## 2. Configuração

O arquivo comentado do projeto é [`infra/postgres/postgresql.conf`](../infra/postgres/postgresql.conf).

| Parâmetro | Regra prática | Observação |
|---|---|---|
| `shared_buffers` | ~25% da RAM | Exige restart |
| `effective_cache_size` | ~50–75% da RAM | Só informa o planner |
| `work_mem` | 4–64 MB | **Por operação**: 100 conexões × 3 sorts × 64 MB = 19 GB! |
| `maintenance_work_mem` | 64 MB–1 GB | VACUUM, CREATE INDEX |
| `max_connections` | o menor possível | Use pooler |
| `random_page_cost` | 1.1 em SSD (padrão 4) | Muda a preferência entre índice e seq scan |
| `checkpoint_timeout` / `max_wal_size` | — | Checkpoints menos frequentes = menos I/O, recuperação mais longa |

```sql
SHOW work_mem;
ALTER SYSTEM SET work_mem = '16MB';   -- grava em postgresql.auto.conf
SELECT pg_reload_conf();              -- aplica o que não exige restart
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;
```

## 3. VACUUM e autovacuum

Por causa do MVCC (docs/03), `UPDATE` e `DELETE` deixam **tuplas mortas**. O VACUUM:

1. marca o espaço das tuplas mortas como reutilizável;
2. atualiza o *visibility map*, que habilita *index-only scans*;
3. **congela** XIDs antigos para evitar o *transaction ID wraparound*, que pode parar o banco;
4. com `ANALYZE`, atualiza as estatísticas do planner.

`VACUUM FULL` reescreve a tabela e devolve espaço ao SO, mas **trava a
tabela inteira**. Alternativa online: a extensão `pg_repack`.

```sql
-- Tabelas com mais tuplas mortas e último autovacuum
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
  FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;
```

### HOT update e fillfactor

Se o UPDATE não altera nenhuma coluna indexada **e** há espaço livre na mesma
página, a versão nova fica ao lado da antiga (*Heap-Only Tuple*): os índices
não são tocados e a tabela não cresce. O `fillfactor` (padrão 100) reserva esse
espaço — a migração `00006` deixa o `estoque` com 80. No Laboratório de MVCC:
fillfactor 100 → **0 de 2.000** updates HOT; fillfactor 70 → **2.000 de 2.000**,
com 6× menos WAL ([fase-4.md §3](fases/fase-4.md#3-resultados-medidos)).

### O horizonte do VACUUM

O VACUUM só remove versões mortas que **nenhuma transação aberta** ainda pode
enxergar. Uma única transação esquecida aberta (um `BEGIN` num terminal, um
relatório de horas) segura o "horizonte" de todo o banco e a tabela incha.
Para achar o culpado:

```sql
SELECT pid, usename, application_name, state, now() - xact_start AS aberta_ha, age(backend_xmin)
  FROM pg_stat_activity WHERE backend_xmin IS NOT NULL ORDER BY age(backend_xmin) DESC;
```

Parâmetros de proteção: `idle_in_transaction_session_timeout`, `statement_timeout`.

## 4. Monitoramento: as views `pg_stat_*`

| View | Pergunta que responde | No Painel |
|---|---|---|
| `pg_stat_activity` | Quem está conectado e fazendo o quê? | ✅ Sessões ativas |
| `pg_stat_statements` | Quais consultas consomem mais tempo? | ✅ Top queries |
| `pg_stat_database` | Cache hit, commits/rollbacks, deadlocks | ✅ Visão geral |
| `pg_locks` | Quem trava o quê? | Fase 1 |
| `pg_stat_user_tables` / `_indexes` | Seq scans, tuplas mortas, índices não usados | Fase 4 |
| `pg_stat_replication` | Atraso das réplicas | Fase 5 |
| `pg_stat_io` (PG 16+) | I/O por tipo de backend | Fase 4 |

O código das três primeiras está em [`backend/internal/painel/adaptadores/postgres/postgres.go`](../backend/internal/painel/adaptadores/postgres/postgres.go).

```sql
SELECT pg_stat_statements_reset();  -- zera as estatísticas antes de um experimento
```

Na Fase 4 o Painel ganhou as abas **PostgreSQL** (saúde das tabelas, índices
nunca usados, `pg_buffercache`, consultas, sessões e locks) e **Visão geral**
com gráficos ao vivo de `pg_stat_database` — código em
[`painel/adaptadores/postgres/postgres.go`](../backend/internal/painel/adaptadores/postgres/postgres.go).

| Pergunta | Fonte |
|---|---|
| O que está no `shared_buffers`? | extensão `pg_buffercache` |
| Quantas tuplas mortas há, exatamente? | extensão `pgstattuple` (lê a tabela inteira; as contagens de `pg_stat_user_tables` são estimativas) |
| Que índices nunca foram usados? | `pg_stat_user_indexes.idx_scan = 0`, excluindo PK e UNIQUE |
| Tamanho de uma tabela particionada | `pg_partition_tree()` + `pg_total_relation_size()` (atenção: para tabela **comum**, `pg_partition_tree` devolve zero linhas) |

## 5. Pool de conexões: PgBouncer (Fase 4)

O PgBouncer roda no compose com a configuração comentada em
[`infra/pgbouncer/pgbouncer.ini`](../infra/pgbouncer/pgbouncer.ini). O
Laboratório de Conexões e o `make pgbench` comparam os modos; os números estão
em [fase-4.md §3](fases/fase-4.md#3-resultados-medidos). Resumo:

- manter conexões abertas (pool) é ~40× mais rápido que abrir uma por transação;
- o PgBouncer **não** acelera a abertura de conexões — ele deixa muitos
  clientes dividirem poucas conexões reais (120 clientes → 20 processos no
  PostgreSQL, contra 630 recusas `53300` no modo direto);
- um salto a mais tem custo: com conexões mantidas, 14 mil tps via PgBouncer
  contra 23,5 mil direto.

Console de administração: `psql -h pgbouncer -p 6432 -U marketplace pgbouncer` → `SHOW POOLS; SHOW STATS;`.

| Modo | Conexão do servidor é devolvida... | Restrições |
|---|---|---|
| session | ao desconectar o cliente | nenhuma |
| **transaction** | ao fim de cada transação | sem `SET` de sessão, advisory locks de sessão, `LISTEN` |
| statement | a cada comando | sem transações multi-comando |

Experimento: `pgbench -c 200 -j 4 -T 60` direto no Postgres x via PgBouncer.

## 6. Particionamento declarativo (Fase 4)

**Implementado:** `auditoria.log` particionada por mês (migração `00006`), com
`auditoria.garantir_particoes()`, `auditoria.expurgar()` e uma partição
DEFAULT. A tabela `pedido` **não** foi particionada: a PK teria de incluir
`criado_em`, e as FKs de `item_pedido` e `pagamento` também — um bom exercício
de modelagem, não um ganho para 100 mil linhas. Laboratório:
[DELETE × DROP PARTITION](fases/fase-4.md#expurgo-de-um-mês-30-mil-linhas)
(75× menos WAL) e *partition pruning* no Laboratório de Índices (1 partição
lida contra 18).

Exemplo genérico:

```sql
CREATE TABLE pedido (
  id uuid, criado_em timestamptz NOT NULL, ...,
  PRIMARY KEY (id, criado_em)            -- a PK precisa conter a chave de partição
) PARTITION BY RANGE (criado_em);

CREATE TABLE pedido_2026_11 PARTITION OF pedido
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
```

Vantagens: *partition pruning* (a consulta só lê as partições necessárias) e
expurgo instantâneo (`DROP`/`DETACH PARTITION` em vez de um `DELETE` gigante).
Tipos: `RANGE`, `LIST` e `HASH`. A extensão
[pg_partman](https://github.com/pgpartman/pg_partman) automatiza a criação de
partições.

## 7. Tarefas rotineiras do DBA

- [ ] Monitorar crescimento (`pg_database_size`, `pg_total_relation_size`)
- [ ] Acompanhar autovacuum e bloat
- [ ] Revisar consultas lentas (`pg_stat_statements`, `log_min_duration_statement`)
- [ ] Remover índices não usados e duplicados
- [ ] Testar **restauração** de backup (docs/08), não só fazer backup
- [ ] Planejar upgrades: *minor* = trocar binários; *major* = `pg_upgrade` ou replicação lógica
- [ ] Gerenciar roles e permissões (docs/10)

## Fontes para pesquisa

- PostgreSQL. [Server Configuration](https://www.postgresql.org/docs/current/runtime-config.html) e [Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html)
- PostgreSQL. [Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- PostgreSQL. [The Cumulative Statistics System](https://www.postgresql.org/docs/current/monitoring-stats.html) e [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)
- PostgreSQL. [Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- PostgreSQL. [pgbench](https://www.postgresql.org/docs/current/pgbench.html) e [pg_upgrade](https://www.postgresql.org/docs/current/pgupgrade.html)
- [PgBouncer: documentação](https://www.pgbouncer.org/usage.html) · [configuração](https://www.pgbouncer.org/config.html) · [features por modo de pool](https://www.pgbouncer.org/features.html)
- PostgreSQL. [pg_buffercache](https://www.postgresql.org/docs/current/pgbuffercache.html) · [pgstattuple](https://www.postgresql.org/docs/current/pgstattuple.html)
- PostgreSQL. [Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/current/storage-hot.html) · [fillfactor](https://www.postgresql.org/docs/current/sql-createtable.html#RELOPTION-FILLFACTOR)
- PostgreSQL. [Partition Pruning](https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITION-PRUNING)
- [PGTune](https://pgtune.leopard.in.ua/): sugestão inicial de parâmetros
- [PostgreSQL Wiki: Tuning Your PostgreSQL Server](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)
- FREUND, A. [*Analyzing the Limits of Connection Scalability in Postgres*](https://techcommunity.microsoft.com/blog/adforpostgresql/analyzing-the-limits-of-connection-scalability-in-postgres/1757266): por que muitas conexões custam caro
- As fontes de **cada passo e opção** dos Laboratórios de MVCC, Expurgo e Conexões estão no próprio laboratório (catálogo em `frontend/src/components/fontes.tsx`)
- SUZUKI, H. [The Internals of PostgreSQL](https://www.interdb.jp/pg/): cap. 2 (processos e memória), 5 (MVCC) e 6 (VACUUM)
- ROGOV, E. [*PostgreSQL 14 Internals*](https://postgrespro.com/community/books/internals): livro gratuito (Postgres Professional)
