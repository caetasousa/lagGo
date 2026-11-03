# Consultas SQL (sqlc)

Coloque aqui arquivos `.sql` com consultas anotadas. O [sqlc](https://docs.sqlc.dev/)
lê o schema em `../migrations` e gera código Go tipado em `internal/sqlcdb`.

```sql
-- name: BuscarClientePorEmail :one
SELECT id, nome, email FROM clientes WHERE email = $1;
```

Gerar: `make sqlc` (roda a imagem Docker oficial do sqlc, sem instalar nada).
Comece lendo `checkout.sql`: cada estratégia de estoque é uma consulta comentada.

