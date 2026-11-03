-- Fase 5: replicação e backup (docs/08-replicacao-backup.md).
--
-- O usuário de replicação e a configuração de arquivamento NÃO estão aqui:
-- são do cluster (infra/postgres/entrypoint.sh e postgresql.conf), não deste
-- banco. Aqui ficam só as tabelas dos laboratórios, no schema lab.

-- +goose Up

-- Laboratório de Replicação: cada linha é um COMMIT feito com um valor de
-- synchronous_commit; a API então procura a mesma linha NA RÉPLICA. A carga
-- (texto) só existe para gerar WAL de verdade.
CREATE TABLE lab.replicacao (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rodada    uuid        NOT NULL,
    modo      text        NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
    carga     text
);

COMMENT ON TABLE lab.replicacao IS
  'Laboratório de Replicação (Fase 5): commits com cada synchronous_commit, lidos de volta na réplica.';

-- +goose Down
DROP TABLE lab.replicacao;
