# Nó do cluster de alta disponibilidade (Fase 5, perfil ha): PostgreSQL +
# Patroni. O Patroni não tem imagem oficial; instala-se com pip sobre a
# imagem oficial do PostgreSQL.
FROM postgres:18.6-alpine

# psycopg2 do Alpine (compilado para musl); o resto vem do PyPI na versão fixa.
RUN apk add --no-cache python3 py3-pip py3-psycopg2 \
 && pip install --no-cache-dir --break-system-packages "patroni[etcd3]==4.1.5"

COPY patroni.yml /etc/patroni.yml
COPY supervisor.sh /usr/local/bin/supervisor.sh
USER postgres
ENTRYPOINT ["supervisor.sh"]
