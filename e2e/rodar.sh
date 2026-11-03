#!/usr/bin/env bash
# Roda a suíte E2E contra um stack descartável e deixa o relatório em
# e2e/relatorio/. É o que `make e2e` chama.
#
# O stack é o docker-compose.yml da raiz num projeto próprio (nosqlgo-e2e),
# com portas e variáveis de e2e/stack.env. Sobe SÓ o núcleo (postgres,
# postgres-replica, pgbouncer, mongo, redis, cassandra, neo4j, api, web) e,
# desde a Fase 5, os clusters de alta disponibilidade (perfil ha).
# Nasce com bancos vazios, é semeado, e morre no fim: nada aqui toca no banco
# de quem desenvolve.
#
# O Playwright roda na imagem oficial (mesma versão do e2e/package.json),
# dentro da rede do stack: não depende de node nem de navegador na máquina.
#
#   MANTER=1          deixa o stack de pé no fim (http://localhost:23000)
#   E2E_ARGS="-g D1"  repassa argumentos ao playwright (ex.: um id só)

set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
cd "$raiz"

projeto=nosqlgo-e2e
# Fase 5: os clusters de alta disponibilidade (perfil ha) entram para os testes [U*].
servicos=(postgres postgres-replica pgbouncer mongo redis cassandra neo4j api web
	etcd1 etcd2 etcd3 patroni1 patroni2 haproxy mongo-ha1 mongo-ha2 mongo-ha3
	redis-ha1 redis-ha2 sentinel1 sentinel2 sentinel3)
compose=(docker compose --project-directory "$raiz" -p "$projeto" --env-file "$raiz/e2e/stack.env"
	-f "$raiz/docker-compose.yml" --profile ha)
versao_pw="$(sed -n 's/.*"@playwright\/test": "\([0-9.]*\)".*/\1/p' e2e/package.json)"
imagem_pw="mcr.microsoft.com/playwright:v${versao_pw}-noble"
runner="$projeto-playwright"

derrubar() {
	docker rm -f "$runner" >/dev/null 2>&1 || true
	"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
no_fim() {
	if [ "${MANTER:-0}" = 1 ]; then
		echo "stack mantido: http://localhost:23000  (derrube com: ${compose[*]} down -v)"
	else
		derrubar
	fi
}
trap no_fim EXIT

echo "→ stack de E2E do zero ($projeto: ${servicos[*]})"
derrubar
"${compose[@]}" up -d --build --quiet-pull --wait "${servicos[@]}"

echo "→ semeando"
"${compose[@]}" exec -T postgres psql -q -U marketplace -d marketplace -v ON_ERROR_STOP=1 \
	< backend/db/seed/seed.sql > /dev/null
if "${compose[@]}" exec -T api sh -c 'command -v seed-catalogo' >/dev/null 2>&1; then
	"${compose[@]}" exec -T api seed-catalogo
fi

# O commit e as imagens exatas vão para o resumo: é o que torna a execução repetível.
commit="$(git rev-parse --short HEAD 2>/dev/null || echo 'sem git')"
if git rev-parse --git-dir >/dev/null 2>&1 && [ -n "$(git status --porcelain)" ]; then
	commit="$commit (com alterações não commitadas)"
fi
imagens="$(docker ps --filter "label=com.docker.compose.project=$projeto" \
	--format '{{.Label "com.docker.compose.service"}} {{.Image}}' | while read -r servico img; do
	echo "$servico $img@$(docker image inspect --format '{{.Id}}' "$img" | cut -c8-19)"
done | sort)"

rm -rf e2e/relatorio
set +e
# Copia a suíte para dentro do container em vez de montar a pasta: assim o
# node_modules e o relatório não nascem com dono root na máquina.
docker create --name "$runner" --network "${projeto}_default" --ipc=host --workdir /e2e \
	-e E2E_BASE_URL=http://web -e E2E_DOCS=/docs -e E2E_COMMIT="$commit" -e E2E_IMAGENS="$imagens" \
	"$imagem_pw" bash -c "npm ci --no-audit --no-fund --silent && npx playwright test ${E2E_ARGS:-}; r=\$?; node resumo.mjs; exit \$r" >/dev/null
tar -C e2e --exclude node_modules --exclude relatorio -cf - . | docker cp - "$runner:/e2e"
# docs/ também vai: os testes [M*] comparam o que a tela mostra com os arquivos .md.
docker cp docs "$runner:/docs"
docker start -a "$runner"
resultado=$?
docker cp "$runner:/e2e/relatorio" e2e/relatorio >/dev/null 2>&1
set -e

echo
echo "relatório: e2e/relatorio/resumo.md  ·  e2e/relatorio/html/index.html"
exit $resultado
