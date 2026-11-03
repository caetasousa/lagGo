#!/bin/sh
# Nó do replica set "rsha" (Fase 5, perfil ha).
#
# 1. Autenticação com keyfile: os membros provam uns aos outros que são do
#    mesmo replica set com uma chave compartilhada, e os clientes precisam de
#    usuário e senha. (Sem autenticação o MongoDB só aceita "shutdown" vindo
#    de localhost — e o laboratório precisa derrubar o primário pela rede.)
# 2. INICIAR=1 (só no mongo-ha1): cria o replica set e o usuário (iniciar.js).
# 3. Mesma ideia do supervisor do Patroni: o laboratório derruba o primário
#    (shutdown), este script espera mais que o tempo de eleição e sobe o
#    mongod de novo — ele volta como SECUNDÁRIO, porque outro nó foi eleito.
#
# --wiredTigerCacheSizeGB 0.25: o mínimo. Três nós com o cache padrão (metade
# da RAM) não caberiam na máquina de estudo.
set -u
PAUSA="${PAUSA_APOS_QUEDA:-30}"
printf '%s' "$MONGO_HA_CHAVE" > /tmp/chave && chmod 400 /tmp/chave

if [ "${INICIAR:-0}" = 1 ]; then
	(
		until mongosh --quiet --eval 'db.adminCommand({ ping: 1 })' >/dev/null 2>&1; do sleep 1; done
		mongosh --quiet /ha/iniciar.js
	) &
fi

while true; do
	mongod --replSet rsha --bind_ip_all --port 27017 --dbpath /data/db --keyFile /tmp/chave \
		--wiredTigerCacheSizeGB 0.25 --quiet
	echo "nosqlgo: mongod saiu; esperando ${PAUSA}s antes de voltar"
	sleep "$PAUSA"
done
