# 05 · Procedures, triggers e views (8.6)

Esses objetos colocam **lógica dentro do banco**. Vantagens: a regra vale para
qualquer aplicação que acesse o banco, há menos idas e voltas na rede, e dá
para garantir auditoria. Desvantagens: a lógica fica mais difícil de testar e
versionar, e o código fica acoplado ao SGBD. No projeto, todos esses objetos
ficam **em migrações** (`backend/db/migrations`), versionados junto com o código.

## 0. O que existe no projeto

Todos os objetos estão nas migrações [`00003_triggers.sql`](../backend/db/migrations/00003_triggers.sql)
e [`00005_funcoes_views_procedures.sql`](../backend/db/migrations/00005_funcoes_views_procedures.sql).
A lista completa, com o propósito de cada um, está em [fase-2.md §2](fases/fase-2.md#2-objetos-criados-no-banco).

| Conceito | Objeto no projeto | Onde ver funcionando |
|---|---|---|
| Função SQL `STABLE` | `categoria_descendentes(int)` | Filtro de categoria na Loja |
| Procedure com `COMMIT` em lotes e `INOUT` | `cancelar_pedidos_expirados()` | Painel → Manutenção |
| Procedure de manutenção | `relatorio.atualizar_vendas_por_dia()` | Relatórios → botão REFRESH |
| Trigger `BEFORE ROW` | `definir_atualizado_em()` | coluna `atualizado_em` |
| Trigger `AFTER ROW` (atributo derivado) | `atualizar_total_pedido()` | `pedido.total` |
| Trigger `AFTER ROW` genérico + `SECURITY DEFINER` | `auditoria.registrar()` | Painel → Auditoria de dados |
| **Event trigger** (DDL) | `auditoria.registrar_ddl()` / `registrar_drop()` | Painel → Auditoria de esquema |
| View de segurança | `cliente_publico` (`security_barrier`) | E-mails mascarados na Loja |
| Materialized view | `relatorio.vendas_por_dia` | Tela Relatórios |

Os exemplos abaixo são versões **didáticas e simplificadas**. Leia as migrações para ver a versão real.

## 1. Function x Procedure (PostgreSQL)

| | `FUNCTION` | `PROCEDURE` (desde o PG 11) |
|---|---|---|
| Chamada | `SELECT f()` ou dentro de expressões | `CALL p()` |
| Retorna valor | Sim (escalar, linha, `SETOF`, `TABLE`) | Não (só parâmetros `OUT`/`INOUT`) |
| Controle de transação | **Não** (roda dentro da transação de quem chamou) | **Sim**: pode fazer `COMMIT`/`ROLLBACK` internamente |
| Volatilidade | `IMMUTABLE` / `STABLE` / `VOLATILE` (afeta o otimizador) | — |

Linguagens: SQL puro, **PL/pgSQL** (a mais usada), PL/Python, PL/Perl, entre outras.

### Exemplo: procedure de manutenção em lotes (Fase 2)

```sql
-- +goose Up
-- +goose StatementBegin
CREATE PROCEDURE cancelar_pedidos_expirados(p_lote int DEFAULT 1000)
LANGUAGE plpgsql AS $$
DECLARE
  v_qtd int;
BEGIN
  LOOP
    UPDATE pedido SET status = 'CANCELADO'
     WHERE id IN (SELECT id FROM pedido
                   WHERE status = 'PENDENTE' AND criado_em < now() - interval '2 hours'
                   LIMIT p_lote FOR UPDATE SKIP LOCKED);
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    EXIT WHEN v_qtd = 0;
    COMMIT;  -- só possível em PROCEDURE: libera locks a cada lote
  END LOOP;
END $$;
-- +goose StatementEnd
```

> No goose, blocos com `$$ ... ;` precisam de `-- +goose StatementBegin/End`.

## 2. Triggers

Um trigger executa uma função **automaticamente** em resposta a um evento.

| Dimensão | Opções |
|---|---|
| Momento | `BEFORE`, `AFTER`, `INSTEAD OF` (só em views) |
| Evento | `INSERT`, `UPDATE [OF coluna]`, `DELETE`, `TRUNCATE` |
| Granularidade | `FOR EACH ROW` (acessa `NEW`/`OLD`) ou `FOR EACH STATEMENT` (usa *transition tables*) |
| Condição | `WHEN (OLD.status IS DISTINCT FROM NEW.status)` |

Também existem **event triggers**, que disparam em DDL (`CREATE TABLE`,
`DROP`...). São úteis para governança, por exemplo para registrar quem alterou o esquema.

### Exemplo: auditoria genérica (Fase 2)

```sql
CREATE SCHEMA auditoria;
CREATE TABLE auditoria.log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabela      text        NOT NULL,
  operacao    text        NOT NULL,
  usuario     text        NOT NULL DEFAULT current_user,
  em          timestamptz NOT NULL DEFAULT now(),
  antes       jsonb,
  depois      jsonb
);

CREATE FUNCTION auditoria.registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria.log (tabela, operacao, antes, depois)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;  -- em AFTER o retorno é ignorado
END $$;

CREATE TRIGGER trg_auditoria_pedido
AFTER INSERT OR UPDATE OR DELETE ON pedido
FOR EACH ROW EXECUTE FUNCTION auditoria.registrar();
```

Outros triggers do projeto:

- `BEFORE UPDATE` → `NEW.atualizado_em := now()`.
- `AFTER INSERT/UPDATE/DELETE ON item_pedido` → recalcula `pedido.total` (desnormalização controlada, docs/01).

**Cuidados:** triggers são "invisíveis" para quem lê o código da aplicação,
podem disparar em cascata e deixam operações em massa mais lentas.
Documente-os bem.

Medido no projeto: um checkout com 2 itens gera **4 UPDATEs** em `pedido`
(o trigger de total roda uma vez por item, mais a mudança de status) e
**5 linhas** de auditoria.

### Desligando triggers em carga em massa

```sql
SET LOCAL session_replication_role = replica;  -- exige superusuário
```

Desliga os triggers de usuário **e as verificações de FK** (que no PostgreSQL
também são triggers internos). É o que o `pg_restore --disable-triggers` faz.
No [`seed.sql`](../backend/db/seed/seed.sql) isso reduziu a carga de ~54 s para
~7 s. Só é aceitável com dados que já se sabe estarem consistentes.

### Event triggers

Disparam em eventos do **banco inteiro** (`ddl_command_start`,
`ddl_command_end`, `sql_drop`, `table_rewrite`, `login` no PG 17+), não de uma
tabela. Funções úteis: `pg_event_trigger_ddl_commands()` e
`pg_event_trigger_dropped_objects()`. Exigem superusuário para criar.

## 3. Views

| Tipo | O que é | Uso no projeto |
|---|---|---|
| **View** | Consulta salva; não guarda dados | `cliente_publico`, sem CPF (segurança, docs/10) |
| **View atualizável** | View simples (uma tabela, sem agregação) aceita INSERT/UPDATE | `WITH CHECK OPTION` impede gravar linhas que a view não mostraria |
| **Materialized view** | **Guarda o resultado** em disco; precisa de `REFRESH` | `vendas_por_dia` para o dashboard |

```sql
CREATE MATERIALIZED VIEW vendas_por_dia AS
SELECT date_trunc('day', p.criado_em)::date AS dia,
       count(*) AS pedidos, sum(p.total) AS receita
  FROM pedido p WHERE p.status <> 'CANCELADO'
 GROUP BY 1;

CREATE UNIQUE INDEX ON vendas_por_dia (dia);           -- exigido pelo CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY vendas_por_dia; -- não bloqueia leituras
```

Agendamento do refresh: pela própria API (um *ticker* em Go) ou com a extensão
[pg_cron](https://github.com/citusdata/pg_cron).

Views com `security_barrier` e `security_invoker` (PG 15+) importam para
segurança: veja docs/10.

## 4. Equivalentes no NoSQL

| Conceito | MongoDB | Redis | Cassandra | Neo4j |
|---|---|---|---|---|
| View | `db.createView()` (pipeline de agregação) | — | **Materialized views** (experimentais) | — |
| Trigger | **Change Streams** (a aplicação escuta as mudanças) | Keyspace notifications | Triggers em Java (raros) | APOC triggers |
| Procedure | — (lógica no app) | **Functions/Lua** (atômicas) | UDF/UDA | Procedures (Java/APOC) |

## Fontes para pesquisa

- PostgreSQL. [PL/pgSQL](https://www.postgresql.org/docs/current/plpgsql.html), em especial [Trigger Functions](https://www.postgresql.org/docs/current/plpgsql-trigger.html) e [Transaction Management](https://www.postgresql.org/docs/current/plpgsql-transactions.html)
- PostgreSQL. [CREATE PROCEDURE](https://www.postgresql.org/docs/current/sql-createprocedure.html), [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html), [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html), [Event Triggers](https://www.postgresql.org/docs/current/event-triggers.html)
- PostgreSQL. [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html) e [Materialized Views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- PostgreSQL Wiki. [Audit trigger](https://wiki.postgresql.org/wiki/Audit_trigger_91plus)
- goose. [Annotations](https://pressly.github.io/goose/documentation/annotations/)
- MongoDB. [Views](https://www.mongodb.com/docs/manual/core/views/) e [Change Streams](https://www.mongodb.com/docs/manual/changestreams/)
- Redis. [Functions](https://redis.io/docs/latest/develop/programmability/functions-intro/)
