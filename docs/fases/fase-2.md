# Fase 2: índices, otimização, procedures, triggers e views

**Tópicos:** 8.2 (SQL), 8.5 (índices e otimização), 8.6 (procedures, triggers e views)
**Status:** ✅ implementada · exercícios do estudante em aberto (seção 5)

## 1. Etapas

| # | Etapa | Entregáveis | Como verificar |
|---|---|---|---|
| 2.1 | Triggers | [`00003_triggers.sql`](../../backend/db/migrations/00003_triggers.sql): auditoria DML (jsonb), **event trigger** de DDL, `atualizado_em`, total do pedido | Compre na Loja → seção Auditoria do Painel; teste `TestTotalMantidoPorTrigger` |
| 2.2 | Índices nas FKs | [`00004_indices.sql`](../../backend/db/migrations/00004_indices.sql) | `\di` no `make psql` |
| 2.3 | Laboratório de Índices | [`laboratorio/adaptadores/postgres/indices_catalogo.go`](../../backend/internal/laboratorio/adaptadores/postgres/indices_catalogo.go), [`laboratorio/adaptadores/postgres/indices.go`](../../backend/internal/laboratorio/adaptadores/postgres/indices.go), tela **Lab: Índices** | Os 7 experimentos (seção 3) |
| 2.4 | Função, views e materialized view | [`00005_funcoes_views_procedures.sql`](../../backend/db/migrations/00005_funcoes_views_procedures.sql): `categoria_descendentes()`, `cliente_publico`, `relatorio.vendas_por_dia` | Filtro de categoria na Loja; e-mails mascarados no seletor de cliente |
| 2.5 | Procedures | `relatorio.atualizar_vendas_por_dia()`, `cancelar_pedidos_expirados()` (COMMIT por lote) | Botões em Relatórios e no Painel (Manutenção) |
| 2.6 | Relatórios | [`db/queries/relatorios.sql`](../../backend/db/queries/relatorios.sql), [`loja/adaptadores/postgres/relatorios.go`](../../backend/internal/loja/adaptadores/postgres/relatorios.go), tela **Relatórios** | `CUBE`, janelas com `RANGE`, curva ABC, CTE recursiva |
| 2.7 | Seed e documentação | seed sem triggers e em ordem cronológica; [docs/02](../02-sql.md), [04](../04-indices-otimizacao.md), [05](../05-procedures-triggers-views.md) | `make seed` (~7 s) |

Telas novas: http://localhost:3000/relatorios e http://localhost:3000/indices.
O Painel do DBA ganhou **Manutenção**, **Auditoria de dados** e **Auditoria de esquema**.

## 2. Objetos criados no banco

| Objeto | Tipo | Para quê |
|---|---|---|
| `auditoria.log` + `auditoria.registrar()` | tabela + trigger AFTER ROW (`SECURITY DEFINER`) | Trilha de INSERT/UPDATE/DELETE em `pedido`, `pagamento` e `sku`, com antes/depois em `jsonb` |
| `auditoria.ddl` + `trg_auditoria_ddl` / `trg_auditoria_drop` | **event triggers** (`ddl_command_end`, `sql_drop`) | Registra toda mudança de esquema, inclusive os índices do Laboratório |
| `definir_atualizado_em()` | trigger BEFORE ROW | Preenche `atualizado_em` em `pedido` e `estoque` |
| `atualizar_total_pedido()` | trigger AFTER ROW em `item_pedido` | Mantém `pedido.total` (atributo derivado) de forma incremental |
| `categoria_descendentes(int)` | função SQL `STABLE` com CTE recursiva | Filtro "categoria + subcategorias" na Loja e nos relatórios |
| `cliente_publico` | view `security_barrier` | E-mail mascarado (`c***@exemplo.com`) para a Loja |
| `relatorio.vendas_por_dia` | **materialized view** + índice único | Base pré-agregada dos relatórios (~5,8 mil linhas em vez de 100 mil pedidos) |
| `relatorio.atualizar_vendas_por_dia()` | procedure | `REFRESH ... CONCURRENTLY` + registra quando e quanto demorou |
| `cancelar_pedidos_expirados(interval, int, INOUT int)` | procedure com **COMMIT por lote** | Cancela pendentes antigos e devolve o estoque |
| `idx_*` (7 índices) | B-tree | FKs e `(cliente_id, criado_em DESC)` |

## 3. Resultados medidos

Base: 100 mil pedidos, ~250 mil itens, 10 mil clientes. Tudo em cache (`read=0`).
Os **buffers** (páginas de 8 KB) são a métrica estável; o tempo varia de uma execução para outra.

| # | Experimento | Sem índice | Com índice | Tamanho do índice |
|---|---|---|---|---|
| 1 | Pedidos de um cliente | Seq Scan · 1432 buffers · 3,4 ms | Bitmap Index Scan · 13 buffers · 0,06 ms | — |
| 2 | Vendas de um SKU (JOIN) | Parallel Seq Scan · 2824 buffers · 8,1 ms | Bitmap Index Scan + Nested Loop · 598 buffers · 0,56 ms | — |
| 3 | Pedidos de um dia | Seq Scan · 1432 buffers · 5,4 ms | **B-tree**: 5 buffers · 0,06 ms | **2208 KB** |
| | | | **BRIN**: 285 buffers · 2,1 ms | **24 KB** (92× menor) |
| 4 | Fila de pendentes | Seq Scan + Sort · 1432 buffers · 4,6 ms | índice em `status`: 6 buffers | 704 KB |
| | | | **parcial** (`WHERE status='PENDENTE'`): 5 buffers, sem Sort | **16 KB** (44× menor) |
| 5 | `lower(nome) = ...` | Seq Scan · 115 buffers | índice em `(nome)`: **ignorado** (Seq Scan) | — |
| | | | índice em `lower(nome)`: Bitmap Index Scan · 0,08 ms | — |
| 6 | `email ILIKE '%4321%'` | Seq Scan · 3,6 ms | GIN trigram · 6 buffers · 0,04 ms | 656 KB |
| 7 | Curva ABC (relatório) | work_mem 64 kB: 97 ms, Hash `Batches: 16`, Sort `external merge Disk` | work_mem 4 MB: 48 ms, tudo em memória | (índice não ajuda) |

Outros números da fase:

| Medida | Valor |
|---|---|
| `make seed` **com** triggers e FKs ligados (Fase 1) | ~54 s |
| `make seed` com `session_replication_role = replica` | **~7 s** |
| Correlação física de `pedido.criado_em` com INSERT em ordem aleatória → cronológica | 0,003 → **1,000** |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY relatorio.vendas_por_dia` | ~125 ms |
| `cancelar_pedidos_expirados('48 hours', 1000)` | 3101 pedidos em 4 lotes, 210 ms |
| Registros de auditoria gerados por **um** checkout com 2 itens | 5 (1 INSERT + 3 UPDATE em `pedido`, 1 INSERT em `pagamento`) |

### O que os números ensinam

- **FK sem índice** custa ~100× mais buffers nas consultas mais comuns da aplicação.
- **BRIN** é 92× menor que o B-tree e ainda corta 80% das páginas, *desde que* a ordem física acompanhe a coluna. Com a ordem aleatória da Fase 1 (correlação 0,003), ele não serviria para nada.
- **Índice parcial**: quando a consulta sempre filtra pelo mesmo valor raro, ele é menor e ainda elimina o Sort.
- **Índice de expressão**: a consulta precisa usar *exatamente* a expressão indexada.
- **work_mem** não é "quanto mais, melhor": de 4 MB para 64 MB não houve ganho, porque tudo já cabia.
- **Triggers têm custo**: um checkout de 2 itens fez 4 UPDATEs em `pedido` (um por item, mais o status), e cada um gerou uma linha de auditoria.

## 4. API da fase

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/loja/categorias` | Árvore com caminho e contagem de SKUs |
| GET | `/api/loja/skus?categoria=` | Filtro com subcategorias |
| GET | `/api/relatorios/vendas-mensais?meses=` | `GROUP BY CUBE (mes, uf)` |
| GET | `/api/relatorios/receita-diaria?dias=` | Média móvel (`RANGE 6 days`) e `lag()` |
| GET | `/api/relatorios/curva-abc?dias=` | Pareto com soma acumulada |
| GET / POST | `/api/relatorios/atualizacao` · `/atualizar` | Estado e refresh da materialized view |
| GET | `/api/dba/indices/experimentos` | Catálogo com estado dos índices (existe, tamanho, usos) |
| POST | `/api/dba/indices/experimentos/{id}/explain` | `EXPLAIN (ANALYZE, BUFFERS)` em transação READ ONLY; body `{"work_mem":"4MB"}` |
| POST / DELETE | `/api/dba/indices/{nome}` | `CREATE`/`DROP INDEX CONCURRENTLY` (só nomes do catálogo) |
| GET | `/api/dba/auditoria` · `/auditoria/ddl` | Trilhas de auditoria |
| POST | `/api/dba/manutencao/cancelar-expirados` | `CALL cancelar_pedidos_expirados(...)` |

## 5. Exercícios para você

- [ ] **Consultas da Fase 1** que ficaram para você (receita por categoria raiz, top 3 por vendedor, clientes sem compra): agora use `categoria_descendentes()` e meça cada uma no `psql` com `EXPLAIN (ANALYZE, BUFFERS)`.
- [ ] **Experimento 1:** no `psql`, rode `SET enable_bitmapscan = off;` e compare o custo estimado do Index Scan com o do Bitmap + Sort. Ache o cliente com mais pedidos e repita.
- [ ] **BRIN quebrado:** num banco de teste, faça `UPDATE pedido SET total = total` em todas as linhas, rode `ANALYZE pedido` e veja a correlação e o experimento 3. O que aconteceu e por quê?
- [ ] **Trigger por instrução:** reescreva `atualizar_total_pedido()` como `FOR EACH STATEMENT` com *transition tables* e compare o número de UPDATEs (e de linhas de auditoria) num checkout de 4 itens.
- [ ] **Auditoria enxuta:** altere `auditoria.registrar()` para gravar em UPDATE só as colunas que mudaram (dica: `jsonb_each` + `IS DISTINCT FROM`).
- [ ] **ROLLUP × CUBE × GROUPING SETS:** reescreva o relatório mensal com os três e compare as linhas geradas.
- [ ] **Desafio de concorrência:** `cancelar_pedidos_expirados()` atualiza vários estoques num único `UPDATE ... FROM`, em ordem não garantida. Monte um cenário de deadlock com um checkout de vários itens e proponha a correção.

## 6. Observações para as próximas fases

- A aplicação ainda conecta como **superusuário**. Por isso consegue criar event triggers, usar `session_replication_role` e criar/dropar índices pela API. Na Fase 6 isso muda: roles separadas, o Laboratório de Índices passa a exigir um papel de DBA, e o `SECURITY DEFINER` da auditoria passa a fazer diferença.
- `auditoria.log` cresce sem limite. Particionar por mês e expurgar é tema das Fases 4 e 6.
- A materialized view é atualizada a cada 10 min. Na Fase 5 os relatórios passam a ler da **réplica**.
