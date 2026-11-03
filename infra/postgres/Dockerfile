# PostgreSQL do projeto = imagem oficial + pgBackRest (Fase 5).
#
# A MESMA imagem roda o primário (serviço postgres) e a réplica
# (postgres-replica); o papel vem da variável PAPEL. Veja entrypoint.sh.
FROM postgres:18.6-alpine

# pgBackRest 2.58.0: a versão empacotada no Alpine 3.24 (base desta imagem).
# A 2.60 existe, mas só compilando do fonte — não vale a complexidade aqui.
RUN apk add --no-cache pgbackrest=2.58.0-r0 \
 && mkdir -p /var/lib/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest

COPY entrypoint.sh /usr/local/bin/nosqlgo-entrypoint.sh
ENTRYPOINT ["nosqlgo-entrypoint.sh"]
CMD ["postgres"]
