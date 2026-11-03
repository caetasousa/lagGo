# Backup e recuperação (Fase 5)

O que estava previsto para esta pasta foi para:

| O quê | Onde |
|---|---|
| pgBackRest (configuração) | [`../pgbackrest/pgbackrest.conf`](../pgbackrest/pgbackrest.conf) |
| pgBackRest (instalação) e arquivamento do WAL | [`../postgres/Dockerfile`](../postgres/Dockerfile) e [`../postgres/postgresql.conf`](../postgres/postgresql.conf) |
| backups full/diff/incr e **PITR** | Laboratório de Backup e PITR ([`backend/internal/laboratorio/adaptadores/postgres/backup.go`](../../backend/internal/laboratorio/adaptadores/postgres/backup.go)) |

Ficaram de fora (bons exercícios): scripts `mongodump`/`mongorestore` e um
teste de restauração do Redis a partir do RDB/AOF.

Explicações e fontes: [docs/08-replicacao-backup.md](../../docs/08-replicacao-backup.md) · resultados: [docs/fases/fase-5.md](../../docs/fases/fase-5.md).
