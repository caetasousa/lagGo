# Fase 1: modelagem relacional, SQL e transações

**Tópicos:** 8.1 (modelagem), 8.2 (SQL), 8.4 (transações e ACID)
**Status:** ✅ implementada · exercícios do estudante em aberto (seção 4)

## 1. Etapas

Cada etapa entrega **código + documentação + uma forma de verificar**.

| # | Etapa | Entregáveis | Como verificar |
|---|---|---|---|
| 1.1 | Esquema relacional | [`00002_modelo_relacional.sql`](../../backend/db/migrations/00002_modelo_relacional.sql), DER em [docs/01 §3](../01-modelagem-dados.md#3-der-do-marketplace-implementado-na-fase-1) | `make up` aplica a migração; `make psql` → `\d+ pedido` |
| 1.2 | Seed com volume | [`db/seed/seed.sql`](../../backend/db/seed/seed.sql), `make seed` | Contagem no fim do seed (100 mil pedidos, ~250 mil itens) |
| 1.3 | Consultas com sqlc | [`db/queries/`](../../backend/db/queries/), código gerado em `internal/sqlcdb` | `make sqlc` sem erros; `go build ./...` |
| 1.4 | Checkout transacional | [`internal/loja/adaptadores/postgres/pedidos.go`](../../backend/internal/loja/adaptadores/postgres/pedidos.go), `POST /api/checkout` | Tela **Loja**; casos de erro na seção 3 |
| 1.5 | Laboratório de concorrência | [`laboratorio/aplicacao/corrida.go`](../../backend/internal/laboratorio/aplicacao/corrida.go), `POST /api/lab/corrida`, tela **Laboratório**, testes | `make check`, `make check-db` (desde a Fase 3: bancos efêmeros) e `make e2e` [D1]–[D2] |
| 1.6 | Painel: locks | [`internal/painel/adaptadores/postgres/postgres.go`](../../backend/internal/painel/adaptadores/postgres/postgres.go), seção Locks no Painel | Laboratório com `for_update` + atraso 400 ms |
| 1.7 | Documentação | [docs/01](../01-modelagem-dados.md), [docs/03](../03-transacoes-acid.md), este arquivo | — |

## 2. Para começar

```bash
make up          # aplica as migrações ao subir a API
make seed        # ~1 min; APAGA e recria os dados da loja
```

- Loja: http://localhost:3000/loja
- Laboratório: http://localhost:3000/lab
- Painel do DBA: http://localhost:3000/dba

## 3. API da fase

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/loja/skus?busca=&limite=` | SKUs ativos com estoque, vendedor e categoria (JOIN de 4 tabelas) |
| GET | `/api/loja/clientes?limite=` | Clientes com o endereço ativo mais recente (`DISTINCT ON`) |
| GET | `/api/loja/pedidos/{id}` | Pedido com itens e pagamentos |
| POST | `/api/checkout?estrategia=` | Fecha o pedido. Header opcional `Idempotency-Key: <uuid>` |
| POST | `/api/lab/corrida` | Corrida de N compradores pelo mesmo SKU |
| GET | `/api/dba/postgres/locks` | Locks atuais (`pg_locks` + `pg_blocking_pids`) |

Exemplo de checkout:

```bash
curl -X POST 'localhost:8080/api/checkout?estrategia=condicional' \
  -H 'Idempotency-Key: 6f1c...' \
  -d '{"cliente_id":"...","endereco_id":"...","metodo_pagamento":"PIX",
       "itens":[{"sku_id":"...","quantidade":2}]}'
```

| Situação | HTTP | Quem detecta |
|---|---|---|
| Pedido criado | 201 | — |
| Mesma `Idempotency-Key` repetida | 200, `reaproveitado: true` | UNIQUE em `pedido.chave_idempotencia` (23505) |
| Endereço de outro cliente | 422 | FK composta (23503) |
| Estoque insuficiente | 409 | Aplicação **ou** `CHECK (quantidade >= 0)` (23514) |
| SKU inexistente/inativo | 422 | Aplicação |
| JSON inválido ou campo desconhecido | 400 | `DisallowUnknownFields` |

## 4. Exercícios para você

- [ ] **Normalização no papel:** monte uma "planilha" com uma linha por item
      vendido (dados do cliente, endereço, produto, vendedor repetidos) e
      normalize passo a passo até a 3FN. Compare com o esquema implementado.
- [ ] **Anomalias no `psql`:** reproduza o lost update em READ COMMITTED e veja
      o erro em REPEATABLE READ ([docs/03 §10](../03-transacoes-acid.md#10-roteiro-manual-com-psql-dois-terminais)).
- [ ] **Deadlock:** provoque com o roteiro de dois terminais e encontre a mensagem no log (`make logs s=postgres`).
- [ ] **Laboratório:** responda às 6 perguntas no fim da tela Laboratório.
- [ ] **SQL:** escreva em `db/queries/` (e gere com `make sqlc`):
  - receita por categoria raiz, usando CTE recursiva sobre `categoria`;
  - top 3 SKUs por vendedor com `rank() OVER (PARTITION BY ...)`;
  - clientes que nunca compraram, com `NOT EXISTS`.
- [ ] **Desafio:** a estratégia `serializavel` às vezes esgota as tentativas
      com 200 compradores. Proponha e meça uma solução.

## 5. Observações para as próximas fases

- ✅ (Fase 2) As FKs ganharam índices na migração `00004`, e o Lab de Índices mede o antes e o depois.
- ✅ (Fase 2) `pedido.total` passou a ser mantido pelo trigger `trg_total_pedido`.
- ✅ (Fase 2) O seed deixou de fazer `UPDATE` em massa: monta tudo em tabelas temporárias e grava os pedidos em ordem cronológica.
- O carrinho vive no navegador; na Fase 3 vai para o Redis.
