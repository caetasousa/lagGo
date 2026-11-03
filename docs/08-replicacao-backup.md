# 08 · Replicação, backup e recuperação (8.10)

## 1. Conceitos

| Termo | Definição |
|---|---|
| **Replicação** | Manter cópias dos dados em mais de um servidor (disponibilidade, escala de leitura, proximidade geográfica) |
| **Backup** | Cópia para **recuperar** dados perdidos ou corrompidos. **Replicação não é backup**: um `DROP TABLE` é replicado em milissegundos |
| **RPO** (*Recovery Point Objective*) | Quanto dado posso perder? (ex.: 5 minutos) |
| **RTO** (*Recovery Time Objective*) | Quanto tempo posso ficar fora do ar? (ex.: 30 minutos) |
| **Regra 3-2-1** | 3 cópias, em 2 mídias diferentes, 1 fora do local |

### Tipos de replicação

| Critério | Opções |
|---|---|
| Sincronismo | **Síncrona** (commit espera a réplica: RPO=0, mais latência) x **assíncrona** (rápida, pode perder as últimas transações) |
| Topologia | Primário-réplica (*leader-follower*), multi-primário, sem líder (*leaderless*, Cassandra) |
| Nível | **Física** (bytes do WAL; cópia idêntica do cluster inteiro) x **lógica** (alterações linha a linha; seletiva, entre versões diferentes) |

### Tipos de backup

| Tipo | O que copia | Exemplo |
|---|---|---|
| **Lógico** | Comandos SQL/dados (portável, lento em bases grandes) | `pg_dump`, `mongodump` |
| **Físico** | Arquivos do cluster | `pg_basebackup`, pgBackRest |
| **Full** | Tudo | — |
| **Diferencial** | O que mudou desde o último **full** | pgBackRest `--type=diff` |
| **Incremental** | O que mudou desde o último backup **de qualquer tipo** | pgBackRest `--type=incr`; `pg_basebackup --incremental` (PG 17+) |
| **Contínuo** | Arquivamento do WAL | habilita **PITR** |

## 2. O WAL é a base de tudo no PostgreSQL

O **Write-Ahead Log** registra cada alteração *antes* de ela ir para os
arquivos de dados. O WAL serve para:

1. **Recuperação após queda (crash recovery):** reaplica o WAL desde o último *checkpoint*.
2. **Replicação física:** a réplica recebe e reaplica o WAL do primário (*streaming replication*).
3. **PITR** (*Point-In-Time Recovery*): backup físico + WAL arquivado = restaurar para **qualquer instante**.

`wal_level = replica` já está em [`infra/postgres/postgresql.conf`](../infra/postgres/postgresql.conf).

## 3. Como o projeto faz (Fase 5)

Resultados medidos e decisões em [fase-5.md](fases/fase-5.md#3-resultados-medidos).

### 3.1 Réplica por streaming

O serviço `postgres-replica` usa a mesma imagem do primário
([`infra/postgres/Dockerfile`](../infra/postgres/Dockerfile)). No primeiro boot, o
[`entrypoint.sh`](../infra/postgres/entrypoint.sh) clona o primário:

```bash
pg_basebackup -h postgres -U replicador -D "$PGDATA" -R -X stream -C -S replica1
#  -R cria standby.signal + primary_conninfo   -C -S cria e usa o replication slot
```

O slot faz o primário guardar o WAL que a réplica ainda não recebeu, limitado
por `max_slot_wal_keep_size = 1GB` (sem limite, uma réplica parada enche o disco).

Monitorar no primário e na réplica (o Painel do DBA → Replicação mostra tudo isto):

```sql
-- primário: os quatro estágios do WAL na réplica
SELECT application_name, state, sync_state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS atraso_bytes, write_lag, flush_lag, replay_lag
  FROM pg_stat_replication;
-- réplica
SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn(), now() - pg_last_xact_replay_timestamp() AS atraso;
```

**Os relatórios leem da réplica.** Depois do "Atualizar" (um REFRESH no
primário), a API espera a réplica reaplicar até o LSN em que o primário estava
(`pg_current_wal_lsn()` × `pg_last_wal_replay_lsn()`) antes de responder — sem
isso, a tela releria o relatório velho (*read-your-writes*).

### 3.2 Síncrona sob demanda

`synchronous_standby_names = 'replica1'` com `synchronous_commit = local`: o
padrão não espera a réplica (se ela cair, a loja não trava), e o
[Laboratório de Replicação](../frontend/src/pages/labs/ReplicacaoPage.tsx) pede
cada modo por transação:

| `synchronous_commit` | O COMMIT espera… | Lido na réplica logo depois? |
|---|---|---|
| `off` | nada (nem o disco local) | não; aparece em ~200 ms (`wal_writer_delay`) |
| `local` | o disco do primário | quase nunca; aparece em milissegundos |
| `remote_write` | a réplica receber | não garantido |
| `on` | o disco da réplica | quase sempre, sem garantia |
| `remote_apply` | a réplica aplicar | **sempre** |

### 3.3 Backup com pgBackRest + PITR

O pgBackRest 2.58 roda dentro do container do `postgres`
([`infra/pgbackrest/pgbackrest.conf`](../infra/pgbackrest/pgbackrest.conf)):

```ini
archive_mode = on
archive_command = 'pgbackrest --stanza=main archive-push %p'
archive_timeout = 300        # troca de segmento a cada 5 min: o RPO se o disco do primário morrer
```

O [Laboratório de Backup e PITR](../frontend/src/pages/labs/BackupPage.tsx) faz
backups full, diff e incr e ensaia a recuperação de um `DROP TABLE`:

```bash
pgbackrest --stanza=main --type=full backup
pgbackrest --stanza=main --pg1-path=/var/lib/postgresql/pitr \
  --type=time --target="2026-11-02 13:31:02-03" --target-action=promote restore
pg_ctl -D /var/lib/postgresql/pitr -o "-p 5433 -c hot_standby=off" start   # instância À PARTE
```

Duas lições do laboratório: **restaure ao lado**, nunca por cima do primário
(o que veio depois do alvo, inclusive o que era bom, sumiria); e confira o
resultado só **depois** de a recuperação terminar — com *hot standby* ligado a
instância aceita conexões no meio do caminho e mostra um ponto qualquer entre o
backup e o alvo (foi um defeito pego pelo E2E).

A API dispara o pgBackRest com `COPY … FROM PROGRAM`, um poder de superusuário
(um shell no servidor) que a Fase 6 retira dela.

### 3.4 Backup lógico

```bash
pg_dump -Fc -d marketplace -f marketplace.dump      # formato custom, compactado
pg_restore -d marketplace_teste -j 4 marketplace.dump  # paralelo
```

## 4. MongoDB

- **Replica set:** 1 primário + N secundários. O secundário lê o **oplog**
  (log de operações) do primário. A eleição de novo primário é automática (docs/09).
  A loja usa o replica set `rs0` de 1 nó (para ter transações); o Laboratório de
  Alta Disponibilidade usa o `rsha`, de 3 nós.
- **Write concern** `w: "majority"`: confirma só depois que a maioria gravou, o que evita *rollback* após failover.
- **Backup:** `mongodump`/`mongorestore` (lógico), snapshot de disco ou ferramentas como o Percona Backup for MongoDB (com PITR via oplog).

```bash
docker compose exec mongo mongodump --db marketplace --archive=/tmp/mkt.gz --gzip
```

## 5. Redis

| Mecanismo | Como funciona | Perda máxima |
|---|---|---|
| **RDB** | Snapshot periódico (`save 60 10000`); `fork()` + cópia | Desde o último snapshot |
| **AOF** | Log de todos os comandos de escrita; `appendfsync everysec` | ~1 segundo |
| RDB + AOF | Recomendado; o AOF usa o RDB como base | ~1 segundo |

Replicação: `replicaof <primario> 6379`, sempre **assíncrona**. `WAIT n` faz a
escrita esperar `n` réplicas receberem — reduz, mas não elimina, a perda num
failover. O Laboratório de Alta Disponibilidade compara com e sem `WAIT 1`.

## 6. Cassandra

- Replicação nativa e sem líder: `replication_factor` por keyspace; *hinted
  handoff*, *read repair* e `nodetool repair` mantêm as réplicas convergindo.
- Backup: `nodetool snapshot` (hard links das SSTables) + *incremental backups*.

## 7. Neo4j

- Community: `neo4j-admin database dump` / `load` (com o banco parado).
- Enterprise: backup online e cluster com Raft.

## Fontes para pesquisa

- PostgreSQL. [Backup and Restore](https://www.postgresql.org/docs/current/backup.html), em especial [Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- PostgreSQL. [High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/high-availability.html) e [Log-Shipping Standby Servers](https://www.postgresql.org/docs/current/warm-standby.html)
- PostgreSQL. [Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- PostgreSQL. [pg_basebackup](https://www.postgresql.org/docs/current/app-pgbasebackup.html) e [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [pgBackRest: User Guide](https://pgbackrest.org/user-guide.html)
- MongoDB. [Replication](https://www.mongodb.com/docs/manual/replication/) e [Backup Methods](https://www.mongodb.com/docs/manual/core/backups/)
- Redis. [Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) e [Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- Cassandra. [Backups](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/backups.html)
- KLEPPMANN, M. *Designing Data-Intensive Applications*. Cap. 5, "Replication".
- PostgreSQL. [synchronous_commit](https://www.postgresql.org/docs/current/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT) · [Replication Slots](https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION-SLOTS) · [pg_stat_replication](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-REPLICATION-VIEW) · [Recovery Target](https://www.postgresql.org/docs/current/runtime-config-wal.html#RUNTIME-CONFIG-WAL-RECOVERY-TARGET)
- [pgBackRest: User Guide](https://pgbackrest.org/user-guide.html#concept/backup) (tipos de backup) e [Command Reference](https://pgbackrest.org/command.html)
- SUZUKI, H. [The Internals of PostgreSQL](https://www.interdb.jp/pg/): cap. [10 "Base Backup & PITR"](https://www.interdb.jp/pg/pgsql10.html) e [11 "Streaming Replication"](https://www.interdb.jp/pg/pgsql11.html)
- GitLab. [*Postmortem of database outage of January 31*](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/) (2017): réplica não é backup, e backup que não foi restaurado é só esperança
- As fontes de **cada passo e opção** dos Laboratórios de Replicação e de Backup e PITR estão no próprio laboratório (catálogo em `frontend/src/components/fontes.tsx`)
