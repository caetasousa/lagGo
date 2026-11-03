#!/bin/sh
# Mantém o Patroni rodando, com uma pausa de propósito (Fase 5, perfil ha).
#
# O Laboratório de Alta Disponibilidade "derruba o líder" matando o processo
# do Patroni (kill -9, pelo PID gravado aqui). Este script então:
#   1. desliga o PostgreSQL do nó de forma abrupta (-m immediate): é o nó
#      inteiro caindo, não só o agente — sem isso o PostgreSQL órfão seguiria
#      aceitando escrita de quem conectasse direto nele (split-brain);
#   2. espera MAIS que o TTL da chave de líder no etcd, tempo para o outro nó
#      ser eleito;
#   3. sobe o Patroni de novo: ele encontra outro líder e volta como RÉPLICA
#      (com pg_rewind, se a linha do tempo divergiu) — cenário U3.
set -u
PAUSA="${PAUSA_APOS_QUEDA:-45}"
mkdir -p "$PGDATA" && chmod 700 "$PGDATA"
while true; do
	patroni /etc/patroni.yml &
	echo $! > /tmp/patroni.pid
	wait $!
	echo "nosqlgo: Patroni saiu; derrubando o PostgreSQL deste nó e esperando ${PAUSA}s"
	pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
	sleep "$PAUSA"
done
