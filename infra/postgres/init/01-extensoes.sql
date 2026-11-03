-- Executado UMA vez, quando o volume do Postgres é criado.
-- pg_stat_statements exige superusuário; por isso fica aqui e não nas migrações.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
