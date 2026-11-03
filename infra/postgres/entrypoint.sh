#!/bin/sh
# Entrada do PostgreSQL do projeto (Fase 5). Antes de entregar ao
# docker-entrypoint.sh oficial, prepara o papel deste nó:
#
#   PAPEL=primario  (padrão) em segundo plano, quando o servidor estiver de pé:
#                   cria o usuário de replicação e a "stanza" do pgBackRest.
#                   Roda a cada subida e é idempotente — vale também para um
#                   volume antigo, criado antes da Fase 5 (os scripts de
#                   /docker-entrypoint-initdb.d só rodam num volume vazio).
#
#   PAPEL=replica   no primeiro boot (diretório de dados vazio), clona o
#                   primário com pg_basebackup -R: a cópia já nasce com
#                   standby.signal + primary_conninfo e entra em recuperação,
#                   aplicando o WAL que chega por streaming.
set -eu

PAPEL="${PAPEL:-primario}"

preparar_primario() {
	# Espera o servidor DE VERDADE: durante a inicialização do volume o
	# servidor temporário só escuta no socket, não em TCP.
	until pg_isready -q -h 127.0.0.1 -p 5432; do sleep 1; done

	# Usuário só de replicação (não lê tabelas): é o que a réplica usa.
	# format(%L) escapa a senha; ela vem do compose, não de quem usa a API.
	until gosu postgres psql -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres \
		-v senha="$REPLICADOR_PASSWORD" <<-'SQL'
		SELECT format('CREATE ROLE replicador LOGIN REPLICATION PASSWORD %L', :'senha')
		 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicador') \gexec
		SQL
	do sleep 2; done

	# Stanza = a configuração de backup de UM cluster no repositório. Enquanto
	# ela não existe, o archive_command falha e o PostgreSQL guarda o WAL e
	# tenta de novo — nada se perde.
	until gosu postgres pgbackrest --stanza=main --log-level-console=warn stanza-create; do sleep 5; done
	echo "nosqlgo: primário preparado (replicador + stanza main)"
}

clonar_replica() {
	[ -s "$PGDATA/PG_VERSION" ] && return 0
	mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
	until pg_isready -q -h "$PRIMARIO_HOST" -p 5432; do sleep 1; done
	export PGPASSWORD="$REPLICADOR_PASSWORD"
	# -C -S cria o replication slot no primário: ele guarda o WAL que a
	# réplica ainda não recebeu (limitado por max_slot_wal_keep_size).
	# Se o slot já existe (réplica recriada), usa o existente.
	until gosu postgres pg_basebackup -h "$PRIMARIO_HOST" -U replicador -D "$PGDATA" -R -X stream -C -S replica1 2>/tmp/clone.err \
		|| { grep -q 'already exists' /tmp/clone.err && rm -rf "$PGDATA"/* \
		     && gosu postgres pg_basebackup -h "$PRIMARIO_HOST" -U replicador -D "$PGDATA" -R -X stream -S replica1; }
	do
		cat /tmp/clone.err >&2
		rm -rf "$PGDATA"/*
		sleep 2
	done
	echo "nosqlgo: réplica clonada de $PRIMARIO_HOST"
}

# Keepalive de TCP na conexão de replicação (cenário S8). Quando o primário é
# recriado (docker compose up --build api, por exemplo), o contêiner novo pode
# herdar o MESMO IP: a conexão antiga fica "aberta" do lado da réplica, o
# receptor de WAL continua dizendo streaming e nunca se reconecta — o padrão
# do sistema só testa a conexão depois de 2 h. Com keepalive, a sonda chega
# ao primário novo, volta um RST e a réplica reconecta em ~25 s.
# Vale também para volumes antigos: o pg_basebackup -R gravou o
# primary_conninfo sem isso no postgresql.auto.conf.
garantir_keepalive() {
	conf="$PGDATA/postgresql.auto.conf"
	[ -f "$conf" ] || return 0
	grep -q "keepalives_idle" "$conf" && return 0
	sed -i "s/^primary_conninfo = '\(.*\)'$/primary_conninfo = '\1 keepalives=1 keepalives_idle=10 keepalives_interval=5 keepalives_count=3'/" "$conf"
	echo "nosqlgo: keepalive de TCP ligado na conexão de replicação"
}

case "$PAPEL" in
	primario) preparar_primario & ;;
	replica) clonar_replica; garantir_keepalive ;;
	*) echo "PAPEL inválido: $PAPEL (use primario ou replica)" >&2; exit 1 ;;
esac

exec docker-entrypoint.sh "$@"
