-- Extensões usadas ao longo do projeto.
-- (pg_stat_statements é criada em infra/postgres/init, pois exige superusuário
--  e shared_preload_libraries — veja docs/06-postgresql-admin.md.)

-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), criptografia de colunas (docs/10)
CREATE EXTENSION IF NOT EXISTS citext;    -- texto case-insensitive (ex.: e-mail)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- busca por similaridade / índices GIN em LIKE '%x%' (docs/04)

-- +goose Down
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
