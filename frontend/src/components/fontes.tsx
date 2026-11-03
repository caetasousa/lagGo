// Catálogo de FONTES: de onde vem cada afirmação dos laboratórios.
//
// Cada fonte diz o que ela CONFIRMA — para o aluno saber o que procurar ao
// abrir. Os links foram conferidos (HTTP 200 e âncora existente) em
// 2026-11-02; `make links` confere de novo (o DOI da ACM
// recusa robôs com 403 e só pode ser conferido no navegador). Ao citar algo novo, adicione aqui
// primeiro: o tipo IdFonte faz o build falhar se um id não existir.

import { Link } from 'react-router'

export type TipoFonte = 'doc' | 'artigo' | 'livro' | 'ferramenta' | 'lei'

export type Fonte = {
  titulo: string
  url?: string
  tipo: TipoFonte
  onde?: string     // seção, capítulo ou página
  confirma: string  // o que esta fonte sustenta no laboratório
}

const PG = 'https://www.postgresql.org/docs/current'

export const FONTES = {
  // ------------------------------------------------------------ transações e concorrência
  pg_transacoes: { tipo: 'doc', titulo: 'PostgreSQL · Tutorial: Transactions', url: `${PG}/tutorial-transactions.html`,
    confirma: 'o que é uma transação; BEGIN, COMMIT e ROLLBACK; "tudo ou nada".' },
  pg_mvcc: { tipo: 'doc', titulo: 'PostgreSQL · Concurrency Control: Introduction', url: `${PG}/mvcc-intro.html`,
    confirma: 'o MVCC: cada transação vê uma fotografia (snapshot); leitura não bloqueia escrita e vice-versa.' },
  pg_isolamento: { tipo: 'doc', titulo: 'PostgreSQL · Transaction Isolation', url: `${PG}/transaction-iso.html`,
    confirma: 'a tabela de anomalias por nível; READ UNCOMMITTED se comporta como READ COMMITTED; REPEATABLE READ impede fantasmas no PostgreSQL; erro de serialização.' },
  pg_rc: { tipo: 'doc', titulo: 'PostgreSQL · Read Committed Isolation Level', url: `${PG}/transaction-iso.html#XACT-READ-COMMITTED`,
    confirma: 'cada comando vê o que estava confirmado quando ELE começou; o UPDATE espera a linha travada e reavalia o WHERE com a versão nova.' },
  pg_rr: { tipo: 'doc', titulo: 'PostgreSQL · Repeatable Read Isolation Level', url: `${PG}/transaction-iso.html#XACT-REPEATABLE-READ`,
    confirma: 'a transação inteira usa o snapshot do primeiro comando; alterar linha mudada por outra depois dele dá "could not serialize access" (40001).' },
  pg_ser: { tipo: 'doc', titulo: 'PostgreSQL · Serializable Isolation Level', url: `${PG}/transaction-iso.html#XACT-SERIALIZABLE`,
    confirma: 'detecção de dependências perigosas (SSI), abortos com 40001 e a obrigação de repetir a transação.' },
  pg_locks_linha: { tipo: 'doc', titulo: 'PostgreSQL · Explicit Locking: Row-Level Locks', url: `${PG}/explicit-locking.html#LOCKING-ROWS`,
    confirma: 'FOR UPDATE trava a linha até o fim da transação; quem pede o mesmo lock espera.' },
  pg_deadlocks: { tipo: 'doc', titulo: 'PostgreSQL · Explicit Locking: Deadlocks', url: `${PG}/explicit-locking.html#LOCKING-DEADLOCKS`,
    confirma: 'o que é deadlock, como o PostgreSQL detecta e aborta uma transação, e que a prevenção é travar sempre na mesma ordem.' },
  pg_for_update: { tipo: 'doc', titulo: 'PostgreSQL · SELECT: The Locking Clause', url: `${PG}/sql-select.html#SQL-FOR-UPDATE-SHARE`,
    confirma: 'sintaxe de FOR UPDATE, NOWAIT e SKIP LOCKED.' },
  pg_update: { tipo: 'doc', titulo: 'PostgreSQL · UPDATE', url: `${PG}/sql-update.html`,
    confirma: 'UPDATE … WHERE e a contagem de linhas afetadas (0 = nada mudou).' },
  pg_deadlock_timeout: { tipo: 'doc', titulo: 'PostgreSQL · deadlock_timeout', url: `${PG}/runtime-config-locks.html#GUC-DEADLOCK-TIMEOUT`,
    confirma: 'o tempo de espera antes de procurar deadlock: 1 segundo por padrão.' },
  pg_erros: { tipo: 'doc', titulo: 'PostgreSQL · Error Codes', url: `${PG}/errcodes-appendix.html#ERRCODES-TABLE`,
    confirma: 'os códigos 40001 (serialization_failure), 40P01 (deadlock_detected), 53300 (too_many_connections), 23514 (check_violation).' },
  pg_app_consistencia: { tipo: 'doc', titulo: 'PostgreSQL · Data Consistency Checks at the Application Level', url: `${PG}/applevel-consistency.html`,
    confirma: 'por que regras que envolvem várias linhas exigem SERIALIZABLE ou locks explícitos (o caso do write skew).' },
  ssi_artigo: { tipo: 'artigo', titulo: 'PORTS, D.; GRITTNER, K. Serializable Snapshot Isolation in PostgreSQL. VLDB, 2012', url: 'https://drkp.net/papers/ssi-vldb12.pdf',
    confirma: 'como o SERIALIZABLE do PostgreSQL foi implementado e por que ele aborta transações em vez de travar.' },
  berenson: { tipo: 'artigo', titulo: 'BERENSON, H. et al. A Critique of ANSI SQL Isolation Levels. SIGMOD, 1995', url: 'https://arxiv.org/abs/cs/0701157',
    confirma: 'as definições clássicas das anomalias (dirty read, lost update, write skew) e por que os níveis do padrão SQL são ambíguos.' },
  hermitage: { tipo: 'ferramenta', titulo: 'Hermitage — testes de isolamento em vários bancos', url: 'https://github.com/ept/hermitage',
    confirma: 'os mesmos roteiros deste laboratório executados em PostgreSQL, MySQL, Oracle e outros, com o resultado de cada nível.' },
  ddia_transacoes: { tipo: 'livro', titulo: 'KLEPPMANN, M. Designing Data-Intensive Applications. O\'Reilly', url: 'https://dataintensive.net/', onde: '1ª ed., cap. 7 "Transactions"',
    confirma: 'condições de corrida, lost update, write skew, snapshot isolation e SSI explicados com exemplos e diagramas.' },
  elmasri_transacoes: { tipo: 'livro', titulo: 'ELMASRI, R.; NAVATHE, S. Sistemas de Banco de Dados. Pearson', onde: 'capítulos de processamento de transações e controle de concorrência',
    confirma: 'ACID, serializabilidade e bloqueio em duas fases — a visão de livro-texto, como cai em prova.' },

  // ------------------------------------------------------------ MVCC, VACUUM, WAL
  pg_pagina: { tipo: 'doc', titulo: 'PostgreSQL · Database Page Layout', url: `${PG}/storage-page-layout.html#STORAGE-PAGE-LAYOUT`,
    confirma: 'a página de 8 KB, o cabeçalho, os ponteiros de item e onde ficam as tuplas.' },
  pg_colunas_sistema: { tipo: 'doc', titulo: 'PostgreSQL · System Columns', url: `${PG}/ddl-system-columns.html`,
    confirma: 'as colunas ocultas ctid (endereço físico), xmin (quem criou a versão) e xmax (quem a apagou).' },
  pg_hot: { tipo: 'doc', titulo: 'PostgreSQL · Heap-Only Tuples (HOT)', url: `${PG}/storage-hot.html`,
    confirma: 'as duas condições do HOT: nenhuma coluna indexada alterada e espaço livre na mesma página.' },
  pg_fillfactor: { tipo: 'doc', titulo: 'PostgreSQL · CREATE TABLE: fillfactor', url: `${PG}/sql-createtable.html#RELOPTION-FILLFACTOR`,
    confirma: 'o fillfactor (padrão 100) e que reservar espaço favorece UPDATEs na mesma página.' },
  pg_vacuum_rotina: { tipo: 'doc', titulo: 'PostgreSQL · Routine Vacuuming: Recovering Disk Space', url: `${PG}/routine-vacuuming.html#VACUUM-FOR-SPACE-RECOVERY`,
    confirma: 'por que as versões mortas existem, que o VACUUM comum torna o espaço reutilizável sem devolvê-lo ao disco e que o VACUUM FULL devolve.' },
  pg_autovacuum: { tipo: 'doc', titulo: 'PostgreSQL · The Autovacuum Daemon', url: `${PG}/routine-vacuuming.html#AUTOVACUUM`,
    confirma: 'a fórmula de disparo: limite + fator × linhas da tabela.' },
  pg_autovacuum_cfg: { tipo: 'doc', titulo: 'PostgreSQL · Automatic Vacuuming (parâmetros)', url: `${PG}/runtime-config-autovacuum.html`,
    confirma: 'autovacuum_vacuum_threshold = 50 tuplas e autovacuum_vacuum_scale_factor = 0,2 (20%) por padrão.' },
  pg_vacuum_cmd: { tipo: 'doc', titulo: 'PostgreSQL · VACUUM', url: `${PG}/sql-vacuum.html`,
    confirma: 'VACUUM roda junto com leituras e escritas; VACUUM FULL reescreve a tabela e exige lock exclusivo.' },
  pg_pgstattuple: { tipo: 'doc', titulo: 'PostgreSQL · pgstattuple', url: `${PG}/pgstattuple.html`,
    confirma: 'a contagem exata de tuplas vivas, mortas e espaço livre que o laboratório mostra.' },
  pg_wal: { tipo: 'doc', titulo: 'PostgreSQL · Write-Ahead Logging (WAL)', url: `${PG}/wal-intro.html`,
    confirma: 'toda alteração é registrada no WAL antes de ir para a tabela; é a base da durabilidade, da réplica e do backup.' },
  pg_idle_tx: { tipo: 'doc', titulo: 'PostgreSQL · idle_in_transaction_session_timeout', url: `${PG}/runtime-config-client.html#GUC-IDLE-IN-TRANSACTION-SESSION-TIMEOUT`,
    confirma: 'derrubar sessões esquecidas dentro de uma transação — as que seguram o horizonte do VACUUM.' },
  pg_repack: { tipo: 'ferramenta', titulo: 'pg_repack', url: 'https://reorg.github.io/pg_repack/',
    confirma: 'reorganizar uma tabela inchada sem segurar lock exclusivo durante a cópia (a alternativa ao VACUUM FULL).' },
  interdb_concorrencia: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql05.html', onde: 'cap. 5 "Concurrency Control"',
    confirma: 'xmin/xmax, snapshots e regras de visibilidade, com desenhos das tuplas na página.' },
  interdb_vacuum: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql06.html', onde: 'cap. 6 "Vacuum Processing"',
    confirma: 'o que o VACUUM faz passo a passo, visibility map e VACUUM FULL.' },
  interdb_hot: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql07.html', onde: 'cap. 7 "Heap Only Tuple and Index-Only Scans"',
    confirma: 'a cadeia HOT dentro da página e o index-only scan, com desenhos.' },
  interdb_wal: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql09.html', onde: 'cap. 9 "Write Ahead Logging"',
    confirma: 'como o WAL é escrito e usado na recuperação.' },

  // ------------------------------------------------------------ particionamento
  pg_particionamento: { tipo: 'doc', titulo: 'PostgreSQL · Declarative Partitioning', url: `${PG}/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE`,
    confirma: 'tabela-mãe e partições, RANGE/LIST/HASH, a chave primária precisar conter a chave de partição e a partição DEFAULT.' },
  pg_pruning: { tipo: 'doc', titulo: 'PostgreSQL · Partition Pruning', url: `${PG}/ddl-partitioning.html#DDL-PARTITION-PRUNING`,
    confirma: 'o planejador descarta partições que não podem conter a resposta, em tempo de planejamento ou de execução.' },
  pg_alter_table: { tipo: 'doc', titulo: 'PostgreSQL · ALTER TABLE (ATTACH/DETACH PARTITION)', url: `${PG}/sql-altertable.html`,
    confirma: 'DETACH PARTITION transforma a partição numa tabela comum, que pode ser apagada com DROP.' },
  pg_partman: { tipo: 'ferramenta', titulo: 'pg_partman', url: 'https://github.com/pgpartman/pg_partman',
    confirma: 'automação de criação de partições futuras e de retenção (o que as procedures do projeto fazem à mão).' },
  lgpd: { tipo: 'lei', titulo: 'BRASIL. Lei nº 13.709/2018 (LGPD)', url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm', onde: 'arts. 15 e 16',
    confirma: 'o término do tratamento e a eliminação dos dados pessoais — por que existe política de retenção.' },

  // ------------------------------------------------------------ conexões
  pg_conexao: { tipo: 'doc', titulo: 'PostgreSQL · How Connections Are Established', url: `${PG}/connect-estab.html`,
    confirma: 'o modelo "um processo por conexão": o postmaster cria um processo novo para cada cliente.' },
  pg_max_conexoes: { tipo: 'doc', titulo: 'PostgreSQL · max_connections', url: `${PG}/runtime-config-connection.html#GUC-MAX-CONNECTIONS`,
    confirma: 'o limite de conexões simultâneas (padrão 100) e que ele só muda reiniciando o servidor.' },
  pg_scram: { tipo: 'doc', titulo: 'PostgreSQL · SASL/SCRAM Authentication', url: `${PG}/sasl-authentication.html`,
    confirma: 'a troca de mensagens da autenticação SCRAM-SHA-256 a cada conexão nova.' },
  pg_pgbench: { tipo: 'doc', titulo: 'PostgreSQL · pgbench', url: `${PG}/pgbench.html`,
    confirma: 'as opções usadas no `make pgbench`: -C (conexão nova por transação), -S (só leitura), -c clientes, -T segundos.' },
  pgbouncer_uso: { tipo: 'doc', titulo: 'PgBouncer · Usage (pool modes)', url: 'https://www.pgbouncer.org/usage.html',
    confirma: 'os modos session, transaction e statement e o console de administração (SHOW POOLS).' },
  pgbouncer_config: { tipo: 'doc', titulo: 'PgBouncer · Configuration', url: 'https://www.pgbouncer.org/config.html',
    confirma: 'pool_mode, default_pool_size, max_client_conn e max_prepared_statements.' },
  pgbouncer_recursos: { tipo: 'doc', titulo: 'PgBouncer · Features: SQL feature map', url: 'https://www.pgbouncer.org/features.html',
    confirma: 'o que NÃO funciona em modo transaction: SET/RESET, LISTEN, cursores WITH HOLD, PREPARE, advisory lock de sessão.' },
  pgxpool: { tipo: 'doc', titulo: 'pgx · pgxpool (pool de conexões em Go)', url: 'https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool',
    confirma: 'como a API mantém e empresta conexões abertas (MaxConns).' },
  freund_conexoes: { tipo: 'artigo', titulo: 'FREUND, A. Analyzing the Limits of Connection Scalability in Postgres', url: 'https://techcommunity.microsoft.com/blog/adforpostgresql/analyzing-the-limits-of-connection-scalability-in-postgres/1757266',
    confirma: 'por que muitas conexões custam caro no PostgreSQL (memória por processo, custo dos snapshots) — escrito por um desenvolvedor do PostgreSQL.' },

  // ------------------------------------------------------------ cache e Redis
  latencias: { tipo: 'artigo', titulo: 'Latency Numbers Every Programmer Should Know', url: 'https://gist.github.com/jboner/2841832',
    confirma: 'as ordens de grandeza: memória ~100 ns, ida e volta na rede local ~0,5 ms, leitura em disco muito mais lenta.' },
  aws_cache: { tipo: 'doc', titulo: 'AWS · Database Caching Strategies Using Redis: Caching Patterns', url: 'https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html',
    confirma: 'cache-aside (lazy loading), write-through e o uso de TTL.' },
  redis_strings: { tipo: 'doc', titulo: 'Redis · Strings', url: 'https://redis.io/docs/latest/develop/data-types/strings/',
    confirma: 'SET e GET, inclusive guardar um JSON como valor.' },
  redis_expire: { tipo: 'doc', titulo: 'Redis · EXPIRE', url: 'https://redis.io/docs/latest/commands/expire/',
    confirma: 'TTL: a chave some sozinha depois do prazo; como o Redis remove chaves expiradas.' },
  redis_eviction: { tipo: 'doc', titulo: 'Redis · Key eviction', url: 'https://redis.io/docs/latest/develop/reference/eviction/',
    confirma: 'maxmemory e as políticas de despejo (noeviction, allkeys-lru, allkeys-lfu, volatile-ttl… e as novas *-lrm do Redis 8).' },
  redis_hashes: { tipo: 'doc', titulo: 'Redis · Hashes', url: 'https://redis.io/docs/latest/develop/data-types/hashes/',
    confirma: 'HASH = mapa de campos dentro de uma chave (o carrinho: sku → quantidade).' },
  redis_sorted_sets: { tipo: 'doc', titulo: 'Redis · Sorted sets', url: 'https://redis.io/docs/latest/develop/data-types/sorted-sets/',
    confirma: 'placar ordenado por pontuação: ZINCRBY e ZREVRANGE (o ranking).' },
  redis_streams: { tipo: 'doc', titulo: 'Redis · Streams', url: 'https://redis.io/docs/latest/develop/data-types/streams/',
    confirma: 'log só de acréscimo com XADD e grupos de consumidores (a fila de pedidos).' },
  redis_incr: { tipo: 'doc', titulo: 'Redis · INCR (padrão: rate limiter)', url: 'https://redis.io/docs/latest/commands/incr/',
    confirma: 'contador atômico e o padrão de limite de requisições por janela.' },
  memcache_fb: { tipo: 'artigo', titulo: 'NISHTALA, R. et al. Scaling Memcache at Facebook. NSDI, 2013', url: 'https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala',
    confirma: 'cache-aside em escala real: invalidação por DELETE, "thundering herd" e os problemas de consistência do cache.' },
  mongo_findone: { tipo: 'doc', titulo: 'MongoDB · db.collection.findOne()', url: 'https://www.mongodb.com/docs/manual/reference/method/db.collection.findOne/',
    confirma: 'a leitura de um documento que o cache evita repetir.' },

  // ------------------------------------------------------------ replicação (Fase 5)
  pg_alta_disp: { tipo: 'doc', titulo: 'PostgreSQL · High Availability, Load Balancing, and Replication', url: `${PG}/high-availability.html`,
    confirma: 'o panorama: primário e réplicas, síncrono × assíncrono, físico × lógico, e por que o PostgreSQL não faz failover sozinho.' },
  pg_streaming: { tipo: 'doc', titulo: 'PostgreSQL · Streaming Replication', url: `${PG}/warm-standby.html#STREAMING-REPLICATION`,
    confirma: 'a réplica recebe o WAL por uma conexão contínua e o reaplica; a replicação é assíncrona por padrão.' },
  pg_slots: { tipo: 'doc', titulo: 'PostgreSQL · Replication Slots', url: `${PG}/warm-standby.html#STREAMING-REPLICATION-SLOTS`,
    confirma: 'o slot faz o primário guardar o WAL que a réplica ainda não recebeu — e por isso pode encher o disco.' },
  pg_max_slot_wal: { tipo: 'doc', titulo: 'PostgreSQL · max_slot_wal_keep_size', url: `${PG}/runtime-config-replication.html#GUC-MAX-SLOT-WAL-KEEP-SIZE`,
    confirma: 'o limite de WAL que um slot pode segurar; acima dele o slot é invalidado.' },
  pg_sync_rep: { tipo: 'doc', titulo: 'PostgreSQL · Synchronous Replication', url: `${PG}/warm-standby.html#SYNCHRONOUS-REPLICATION`,
    confirma: 'o COMMIT pode esperar a réplica; o custo é a latência e, sem réplica, a espera indefinida.' },
  pg_sync_commit: { tipo: 'doc', titulo: 'PostgreSQL · synchronous_commit', url: `${PG}/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT`,
    confirma: 'os cinco valores (off, local, remote_write, on, remote_apply), o que cada um espera, e que dá para mudar por transação.' },
  pg_sync_nomes: { tipo: 'doc', titulo: 'PostgreSQL · synchronous_standby_names', url: `${PG}/runtime-config-replication.html#GUC-SYNCHRONOUS-STANDBY-NAMES`,
    confirma: 'quais réplicas podem ser síncronas (pelo application_name), FIRST e ANY.' },
  pg_wal_writer: { tipo: 'doc', titulo: 'PostgreSQL · wal_writer_delay', url: `${PG}/runtime-config-wal.html#GUC-WAL-WRITER-DELAY`,
    confirma: 'com synchronous_commit = off, o WAL vai ao disco pelo WAL writer em ciclos de 200 ms — e só então segue para a réplica.' },
  pg_hot_standby: { tipo: 'doc', titulo: 'PostgreSQL · Hot Standby', url: `${PG}/hot-standby.html`,
    confirma: 'a réplica aceita consultas de leitura enquanto reaplica o WAL, e os conflitos que isso causa.' },
  pg_hs_feedback: { tipo: 'doc', titulo: 'PostgreSQL · hot_standby_feedback', url: `${PG}/runtime-config-replication.html#GUC-HOT-STANDBY-FEEDBACK`,
    confirma: 'a réplica avisa o primário das consultas em andamento, evitando cancelamentos ao custo de inchaço no primário.' },
  pg_basebackup: { tipo: 'doc', titulo: 'PostgreSQL · pg_basebackup', url: `${PG}/app-pgbasebackup.html`,
    confirma: 'a cópia física do cluster usada para criar a réplica; -R grava a configuração de réplica, -S/-C usam e criam o slot.' },
  pg_stat_replicacao: { tipo: 'doc', titulo: 'PostgreSQL · pg_stat_replication', url: `${PG}/monitoring-stats.html#MONITORING-PG-STAT-REPLICATION-VIEW`,
    confirma: 'sent/write/flush/replay_lsn e write/flush/replay_lag: os estágios do WAL na réplica vistos do primário.' },
  pg_stat_receptor: { tipo: 'doc', titulo: 'PostgreSQL · pg_stat_wal_receiver', url: `${PG}/monitoring-stats.html#MONITORING-PG-STAT-WAL-RECEIVER-VIEW`,
    confirma: 'o lado da réplica: de quem ela recebe, por qual slot e até onde.' },
  pg_funcoes_recuperacao: { tipo: 'doc', titulo: 'PostgreSQL · Recovery Information Functions', url: `${PG}/functions-admin.html#FUNCTIONS-RECOVERY-INFO-TABLE`,
    confirma: 'pg_is_in_recovery(), pg_last_wal_replay_lsn() e pg_last_xact_replay_timestamp().' },
  pg_funcoes_backup: { tipo: 'doc', titulo: 'PostgreSQL · Backup Control Functions', url: `${PG}/functions-admin.html#FUNCTIONS-ADMIN-BACKUP`,
    confirma: 'pg_current_wal_lsn(), pg_switch_wal() e pg_walfile_name().' },
  ddia_replicacao: { tipo: 'livro', titulo: 'KLEPPMANN, M. Designing Data-Intensive Applications. O\'Reilly', url: 'https://dataintensive.net/', onde: '1ª ed., cap. 5 "Replication"',
    confirma: 'líder e seguidores, síncrono × assíncrono, atraso de replicação e "ler as próprias escritas" (read-your-writes).' },
  interdb_streaming: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql11.html', onde: 'cap. 11 "Streaming Replication"',
    confirma: 'walsender e walreceiver, a troca de mensagens e como a replicação síncrona espera a réplica.' },

  // ------------------------------------------------------------ backup e PITR (Fase 5)
  pg_backup: { tipo: 'doc', titulo: 'PostgreSQL · Backup and Restore', url: `${PG}/backup.html`,
    confirma: 'os três jeitos de fazer backup: dump SQL, cópia de arquivos e arquivamento contínuo.' },
  pg_arquivamento: { tipo: 'doc', titulo: 'PostgreSQL · Continuous Archiving and PITR', url: `${PG}/continuous-archiving.html`,
    confirma: 'backup físico + WAL arquivado permite restaurar o banco a qualquer instante.' },
  pg_pitr: { tipo: 'doc', titulo: 'PostgreSQL · Recovering Using a Continuous Archive Backup', url: `${PG}/continuous-archiving.html#BACKUP-PITR-RECOVERY`,
    confirma: 'o roteiro da recuperação: restaurar o backup, apontar o restore_command e o alvo, subir o servidor.' },
  pg_alvo: { tipo: 'doc', titulo: 'PostgreSQL · Recovery Target', url: `${PG}/runtime-config-wal.html#RUNTIME-CONFIG-WAL-RECOVERY-TARGET`,
    confirma: 'recovery_target_time, recovery_target_inclusive e recovery_target_action (pause, promote, shutdown).' },
  pg_archive_command: { tipo: 'doc', titulo: 'PostgreSQL · archive_command', url: `${PG}/runtime-config-wal.html#GUC-ARCHIVE-COMMAND`,
    confirma: 'o comando chamado para cada segmento de WAL completo; se falhar, o PostgreSQL guarda o segmento e tenta de novo.' },
  pg_archive_timeout: { tipo: 'doc', titulo: 'PostgreSQL · archive_timeout', url: `${PG}/runtime-config-wal.html#GUC-ARCHIVE-TIMEOUT`,
    confirma: 'força a troca do segmento de WAL de tempos em tempos — limita quanto se perde se o primário morrer.' },
  pg_stat_arquivador: { tipo: 'doc', titulo: 'PostgreSQL · pg_stat_archiver', url: `${PG}/monitoring-stats.html#MONITORING-PG-STAT-ARCHIVER-VIEW`,
    confirma: 'quantos segmentos foram arquivados, o último e as falhas — o que o painel mostra.' },
  pg_copy: { tipo: 'doc', titulo: 'PostgreSQL · COPY (FROM PROGRAM)', url: `${PG}/sql-copy.html`,
    confirma: 'COPY ... FROM PROGRAM executa um comando no servidor e exige superusuário ou pg_execute_server_program.' },
  pg_papeis: { tipo: 'doc', titulo: 'PostgreSQL · Predefined Roles', url: `${PG}/predefined-roles.html`,
    confirma: 'pg_execute_server_program e os outros papéis prontos — a base do "menor privilégio" da Fase 6.' },
  pg_ctl: { tipo: 'doc', titulo: 'PostgreSQL · pg_ctl', url: `${PG}/app-pg-ctl.html`,
    confirma: 'sobe e desliga uma instância apontando o diretório de dados (-D) — como a instância à parte do PITR.' },
  pg_dump: { tipo: 'doc', titulo: 'PostgreSQL · pg_dump', url: `${PG}/app-pgdump.html`,
    confirma: 'o backup lógico (SQL), o caminho para copiar uma tabela da instância restaurada de volta ao primário.' },
  pgbackrest_guia: { tipo: 'ferramenta', titulo: 'pgBackRest · User Guide', url: 'https://pgbackrest.org/user-guide.html',
    confirma: 'stanza, repositório, backups full/diff/incr, archive-push/get, retenção e restore com --type=time.' },
  pgbackrest_tipos: { tipo: 'ferramenta', titulo: 'pgBackRest · User Guide: Backup', url: 'https://pgbackrest.org/user-guide.html#concept/backup',
    confirma: 'a diferença entre full, differential (desde o último full) e incremental (desde o último backup de qualquer tipo).' },
  pgbackrest_comandos: { tipo: 'ferramenta', titulo: 'pgBackRest · Command Reference', url: 'https://pgbackrest.org/command.html',
    confirma: 'as opções de backup, info e restore usadas no laboratório (--type, --target, --target-action, --pg1-path).' },
  interdb_pitr: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql10.html', onde: 'cap. 10 "Base Backup & Point-in-Time Recovery"',
    confirma: 'como o servidor reaplica o WAL arquivado até o instante-alvo, com desenhos da linha do tempo.' },
  gitlab_2017: { tipo: 'artigo', titulo: 'GitLab · Postmortem of database outage of January 31 (2017)', url: 'https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/',
    confirma: 'um caso real: um diretório de dados apagado por engano, réplicas que não salvaram e backups que não funcionavam — por que testar a RESTAURAÇÃO.' },

  // ------------------------------------------------------------ alta disponibilidade (Fase 5)
  sre_risco: { tipo: 'livro', titulo: 'BEYER, B. et al. Site Reliability Engineering (Google)', url: 'https://sre.google/sre-book/embracing-risk/', onde: 'cap. 3 "Embracing Risk"',
    confirma: 'disponibilidade medida em "noves", o custo de cada nove e por que 100% não é o alvo certo.' },
  ddia_consenso: { tipo: 'livro', titulo: 'KLEPPMANN, M. Designing Data-Intensive Applications. O\'Reilly', url: 'https://dataintensive.net/', onde: '1ª ed., cap. 5 (failover) e cap. 9 "Consistency and Consensus"',
    confirma: 'failover automático e seus perigos (split-brain, perda de escritas), quórum e algoritmos de consenso.' },
  raft: { tipo: 'artigo', titulo: 'ONGARO, D.; OUSTERHOUT, J. In Search of an Understandable Consensus Algorithm (Raft). USENIX ATC, 2014', url: 'https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro',
    confirma: 'eleição de líder por maioria e mandatos (terms) — a base do etcd e das eleições do MongoDB.' },
  raft_site: { tipo: 'ferramenta', titulo: 'The Raft Consensus Algorithm (visualização interativa)', url: 'https://raft.github.io/',
    confirma: 'veja uma eleição acontecer: derrube o líder na simulação e acompanhe os votos.' },
  etcd_faq: { tipo: 'doc', titulo: 'etcd · FAQ', url: 'https://etcd.io/docs/latest/faq/',
    confirma: 'por que usar um número ímpar de membros e quantas falhas cada tamanho de cluster tolera.' },
  patroni_docs: { tipo: 'doc', titulo: 'Patroni · documentação', url: 'https://patroni.readthedocs.io/en/latest/',
    confirma: 'o agente que transforma réplicas do PostgreSQL num cluster com failover automático, usando um DCS (etcd).' },
  patroni_config: { tipo: 'doc', titulo: 'Patroni · Dynamic Configuration', url: 'https://patroni.readthedocs.io/en/latest/dynamic_configuration.html',
    confirma: 'ttl, loop_wait, retry_timeout e maximum_lag_on_failover: o que define quanto o failover demora.' },
  patroni_rest: { tipo: 'doc', titulo: 'Patroni · REST API', url: 'https://patroni.readthedocs.io/en/latest/rest_api.html',
    confirma: '/primary e /replica (o que o HAProxy consulta), /cluster, /switchover e PATCH /config.' },
  patroni_sync: { tipo: 'doc', titulo: 'Patroni · Replication modes (synchronous_mode)', url: 'https://patroni.readthedocs.io/en/latest/replication_modes.html',
    confirma: 'com synchronous_mode, só uma réplica síncrona pode ser promovida — failover sem perder COMMIT confirmado.' },
  pg_rewind: { tipo: 'doc', titulo: 'PostgreSQL · pg_rewind', url: `${PG}/app-pgrewind.html`,
    confirma: 'como o antigo primário é sincronizado com o novo e volta como réplica sem ser clonado de novo.' },
  haproxy_docs: { tipo: 'doc', titulo: 'HAProxy · documentação', url: 'https://docs.haproxy.org/',
    confirma: 'health checks (option httpchk) e o roteamento TCP para o nó que responde como primário.' },
  mongo_eleicoes: { tipo: 'doc', titulo: 'MongoDB · Replica Set Elections', url: 'https://www.mongodb.com/docs/manual/core/replica-set-elections/',
    confirma: 'heartbeats a cada 2 s, electionTimeoutMillis (10 s) e a eleição por maioria dos votos.' },
  mongo_stepdown: { tipo: 'doc', titulo: 'MongoDB · replSetStepDown (election handoff)', url: 'https://www.mongodb.com/docs/manual/reference/command/replSetStepDown/',
    confirma: 'a troca planejada e o election handoff: o primário que sai indica um sucessor e a eleição leva milissegundos.' },
  mongo_wc: { tipo: 'doc', titulo: 'MongoDB · Write Concern', url: 'https://www.mongodb.com/docs/manual/reference/write-concern/',
    confirma: 'w: 1 × w: "majority": quando a escrita é confirmada e o que sobrevive a uma eleição.' },
  mongo_rollback: { tipo: 'doc', titulo: 'MongoDB · Rollbacks During Replica Set Failover', url: 'https://www.mongodb.com/docs/manual/core/replica-set-rollbacks/',
    confirma: 'o que acontece com escritas que só o antigo primário tinha: desfeitas quando ele volta (evitadas com w: "majority").' },
  mongo_retry: { tipo: 'doc', titulo: 'MongoDB · Retryable Writes', url: 'https://www.mongodb.com/docs/manual/core/retryable-writes/',
    confirma: 'o driver repete uma vez a escrita que falhou por troca de primário.' },
  mongo_keyfile: { tipo: 'doc', titulo: 'MongoDB · Deploy Replica Set With Keyfile Authentication', url: 'https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-with-keyfile-access-control/',
    confirma: 'a autenticação interna por keyfile e a exceção de localhost para criar o primeiro usuário.' },
  redis_sentinel: { tipo: 'doc', titulo: 'Redis · High availability with Sentinel', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/',
    confirma: 'SDOWN, ODOWN, quórum, a eleição de um sentinel líder e a promoção da réplica.' },
  redis_replicacao: { tipo: 'doc', titulo: 'Redis · Replication', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/replication/',
    confirma: 'a replicação do Redis é assíncrona: o primário confirma antes de a réplica receber.' },
  redis_wait: { tipo: 'doc', titulo: 'Redis · WAIT', url: 'https://redis.io/docs/latest/commands/wait/',
    confirma: 'espera N réplicas confirmarem o recebimento — e por que isso não torna o Redis fortemente consistente.' },
  jepsen_redis: { tipo: 'artigo', titulo: 'KINGSBURY, K. Jepsen: Redis (2013)', url: 'https://aphyr.com/posts/283-jepsen-redis',
    confirma: 'como o Redis com Sentinel perde escritas confirmadas numa partição de rede.' },
  jepsen_mongo: { tipo: 'artigo', titulo: 'KINGSBURY, K. Jepsen: MongoDB 4.2.6 (2020)', url: 'https://jepsen.io/analyses/mongodb-4.2.6',
    confirma: 'o que write concern e read concern garantem de verdade sob falhas.' },

  // ------------------------------------------------------------ índices
  pg_indices: { tipo: 'doc', titulo: 'PostgreSQL · Indexes: Introduction', url: `${PG}/indexes-intro.html`,
    confirma: 'o que é um índice, que ele acelera leituras e custa nas escritas.' },
  pg_tipos_indice: { tipo: 'doc', titulo: 'PostgreSQL · Index Types', url: `${PG}/indexes-types.html`,
    confirma: 'B-tree, Hash, GiST, SP-GiST, GIN e BRIN e para que operadores cada um serve.' },
  pg_btree: { tipo: 'doc', titulo: 'PostgreSQL · B-Tree Indexes', url: `${PG}/btree.html`,
    confirma: 'a implementação da B-tree no PostgreSQL.' },
  pg_multicoluna: { tipo: 'doc', titulo: 'PostgreSQL · Multicolumn Indexes', url: `${PG}/indexes-multicolumn.html`,
    confirma: 'o índice composto é mais eficiente com condições nas colunas da ESQUERDA (a regra do prefixo).' },
  pg_parcial: { tipo: 'doc', titulo: 'PostgreSQL · Partial Indexes', url: `${PG}/indexes-partial.html`,
    confirma: 'índice só com as linhas de um WHERE: menor e útil para valores raros.' },
  pg_expressao: { tipo: 'doc', titulo: 'PostgreSQL · Indexes on Expressions', url: `${PG}/indexes-expressional.html`,
    confirma: 'índice sobre lower(coluna) e a necessidade de a consulta usar a mesma expressão.' },
  pg_index_only: { tipo: 'doc', titulo: 'PostgreSQL · Index-Only Scans', url: `${PG}/indexes-index-only-scans.html`,
    confirma: 'responder só com o índice, quando ele tem todas as colunas e o visibility map está em dia.' },
  pg_examinar: { tipo: 'doc', titulo: 'PostgreSQL · Examining Index Usage', url: `${PG}/indexes-examine.html`,
    confirma: 'por que um índice pode não ser usado, rodar ANALYZE e testar com enable_seqscan.' },
  pg_explain: { tipo: 'doc', titulo: 'PostgreSQL · Using EXPLAIN', url: `${PG}/using-explain.html`,
    confirma: 'como ler o plano: nós, estimativa × real (rows), EXPLAIN ANALYZE e BUFFERS.' },
  pg_estatisticas: { tipo: 'doc', titulo: 'PostgreSQL · Statistics Used by the Planner', url: `${PG}/planner-stats.html`,
    confirma: 'as estatísticas que o ANALYZE coleta e que o planejador usa para estimar linhas (seletividade).' },
  pg_planejador_cfg: { tipo: 'doc', titulo: 'PostgreSQL · Query Planning (enable_*, random_page_cost)', url: `${PG}/runtime-config-query.html#GUC-RANDOM-PAGE-COST`,
    confirma: 'os ajustes de sessão do laboratório e o custo de leitura fora de ordem (4 por padrão).' },
  pg_juncoes: { tipo: 'doc', titulo: 'PostgreSQL · Planner/Optimizer (nested loop, merge join, hash join)', url: `${PG}/planner-optimizer.html`,
    confirma: 'os três algoritmos de junção e como o planejador escolhe entre eles.' },
  utl_juncoes: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/join', onde: 'cap. "The Join Operation"',
    confirma: 'nested loop, hash join e merge join, e que índices ajudam cada um.' },
  pg_work_mem: { tipo: 'doc', titulo: 'PostgreSQL · work_mem', url: `${PG}/runtime-config-resource.html#GUC-WORK-MEM`,
    confirma: 'a memória por operação de ordenação/hash (4 MB por padrão) e que, sem ela, a operação usa arquivos temporários.' },
  pg_gin: { tipo: 'doc', titulo: 'PostgreSQL · GIN Indexes', url: `${PG}/gin.html`,
    confirma: 'índice invertido: para cada "pedaço" (palavra, trigrama, chave JSON), as linhas que o contêm.' },
  pg_trgm: { tipo: 'doc', titulo: 'PostgreSQL · pg_trgm', url: `${PG}/pgtrgm.html`,
    confirma: 'trigramas e o suporte a LIKE/ILIKE com curinga no começo usando índice GIN.' },
  pg_brin: { tipo: 'doc', titulo: 'PostgreSQL · BRIN Indexes', url: `${PG}/brin.html`,
    confirma: 'resumo (mínimo/máximo) por bloco de páginas; eficaz quando os valores seguem a ordem física.' },
  utl_anatomia: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/anatomy', onde: 'cap. 1 "Anatomy of an Index"',
    confirma: 'as folhas encadeadas e a árvore de busca da B-tree, com desenhos — a melhor explicação gratuita.' },
  utl_composto: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys', onde: '"Concatenated Indexes"',
    confirma: 'a ordem das colunas no índice composto e a analogia da lista telefônica.' },
  utl_funcoes: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/where-clause/functions', onde: '"Functions"',
    confirma: 'função na coluna impede o uso do índice; a solução é o índice de expressão.' },
  utl_like: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/where-clause/searching-for-ranges/like-performance-tuning', onde: '"LIKE filters"',
    confirma: 'só a parte ANTES do primeiro curinga usa o índice B-tree.' },
  utl_parcial: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/where-clause/partial-and-filtered-indexes', onde: '"Partial Indexes"',
    confirma: 'índice parcial para filas de trabalho ("só os pendentes").' },
  utl_explain: { tipo: 'livro', titulo: 'WINAND, M. Use The Index, Luke!', url: 'https://use-the-index-luke.com/sql/explain-plan/postgresql/getting-an-execution-plan', onde: '"Getting an Execution Plan" (PostgreSQL)',
    confirma: 'como obter e ler o plano de execução no PostgreSQL.' },
  bayer_btree: { tipo: 'artigo', titulo: 'BAYER, R.; McCREIGHT, E. Organization and Maintenance of Large Ordered Indices. Acta Informatica, 1972', url: 'https://doi.org/10.1007/BF00288683',
    confirma: 'o artigo original que criou a B-tree.' },
  comer_btree: { tipo: 'artigo', titulo: 'COMER, D. The Ubiquitous B-Tree. ACM Computing Surveys, 1979', url: 'https://doi.org/10.1145/356770.356776',
    confirma: 'a visão geral clássica de B-trees e B+-trees (as folhas com os valores).' },
  ddia_indices: { tipo: 'livro', titulo: 'KLEPPMANN, M. Designing Data-Intensive Applications. O\'Reilly', url: 'https://dataintensive.net/', onde: '1ª ed., cap. 3 "Storage and Retrieval"',
    confirma: 'B-tree × LSM-tree, índices secundários e por que índice custa nas escritas.' },
  interdb_planejador: { tipo: 'livro', titulo: 'SUZUKI, H. The Internals of PostgreSQL', url: 'https://www.interdb.jp/pg/pgsql03.html', onde: 'cap. 3 "Query Processing"',
    confirma: 'como o planejador calcula o custo de Seq Scan e Index Scan.' },
  dalibo: { tipo: 'ferramenta', titulo: 'explain.dalibo.com — visualizador de planos', url: 'https://explain.dalibo.com/',
    confirma: 'cole um plano do laboratório e veja-o desenhado como árvore.' },
} as const satisfies Record<string, Fonte>

export type IdFonte = keyof typeof FONTES

const TIPO: Record<TipoFonte, string> = {
  doc: '📘 documentação oficial',
  artigo: '📄 artigo',
  livro: '📗 livro',
  ferramenta: '🧪 ferramenta',
  lei: '⚖️ lei',
}

function Item({ id, curto }: { id: IdFonte; curto?: boolean }) {
  const f: Fonte = FONTES[id]
  const titulo = f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.titulo}</a> : <span>{f.titulo}</span>
  return (
    <li>
      <span className="tipo-fonte">{TIPO[f.tipo]}</span> {titulo}{f.onde && <> — {f.onde}</>}
      {!curto && <div className="muted small">Confirma: {f.confirma}</div>}
      {curto && <span className="muted small"> · {f.confirma}</span>}
    </li>
  )
}

/** Fontes de um passo, opção ou experimento (lista curta). */
export function FontesCurtas({ ids, titulo = 'Fontes' }: { ids: readonly IdFonte[]; titulo?: string }) {
  if (!ids.length) return null
  return (
    <section className="fontes-curtas" aria-label={titulo}>
      <h4>📚 {titulo}</h4>
      <ul>{ids.map((id) => <Item key={id} id={id} curto />)}</ul>
    </section>
  )
}

/** Seção completa "Fontes para pesquisar", no fim de cada laboratório. */
export function Fontes({ ids, doc, children }: { ids: readonly IdFonte[]; doc: string; children?: React.ReactNode }) {
  const unicos = [...new Set(ids)]
  const ordem: TipoFonte[] = ['doc', 'livro', 'artigo', 'ferramenta', 'lei']
  unicos.sort((a, b) => ordem.indexOf(FONTES[a].tipo) - ordem.indexOf(FONTES[b].tipo))
  return (
    <section className="conceito fontes" aria-label="Fontes para pesquisar">
      <h2>📚 Fontes para pesquisar</h2>
      <p className="muted small">
        {children ?? 'De onde vem o que este laboratório afirma. Comece pela documentação oficial; os livros e artigos aprofundam.'}{' '}
        Cada item diz o que ele confirma.
      </p>
      <p>
        📖 <Link to={`/estudo/${doc}`}>Material completo do tópico</Link> (<code>docs/{doc}.md</code>): a teoria inteira,
        com mais exemplos, tabelas, diagramas e a lista de fontes do tópico.
      </p>
      <ul>{unicos.map((id) => <Item key={id} id={id} />)}</ul>
    </section>
  )
}
