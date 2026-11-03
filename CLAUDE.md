# CLAUDE.md

## 📦 Projeto

`nosqlGo` é um projeto **de estudo de bancos de dados**: um marketplace em que
cada parte usa o banco mais adequado ao problema, e um **Painel do DBA** que
mostra o que acontece por dentro. O roteiro segue os tópicos 8.1–8.12 de um
edital (modelagem, SQL, ACID, índices, procedures, administração, NoSQL,
replicação, alta disponibilidade, segurança) e avança em fases.

- `backend/`: API Go (chi, pgx, sqlc, goose) e o comando `seed-catalogo`.
- `frontend/`: SPA React + Vite + TypeScript, servida pelo nginx.
- `e2e/`: suíte Playwright e o catálogo de cenários de falha.
- `infra/`: configuração comentada de cada banco.
- `docs/`: o material de estudo (um arquivo por tópico) e o diário de cada fase.

O código existe para **ensinar**: clareza e comentários que explicam o porquê
valem mais que abstração. O backend segue a **arquitetura hexagonal** (escolha
discutida e registrada em `docs/12-arquitetura-hexagonal.md`); fora dela, não
introduza ORM, frameworks, camadas ou padrões sem uma necessidade concreta
discutida antes.

## 📚 Fontes de verdade

| | Arquivo | Contém |
|---|---|---|
| 🛠️ | `Makefile` | comandos disponíveis (`make` lista todos) |
| 📖 | `README.md` | visão geral, stack, portas, roadmap das fases e versões |
| 🗺️ | `docs/fases/fase-N.md` | o que cada fase entregou, resultados medidos e exercícios |
| 📘 | `docs/NN-*.md` | o conceito de cada tópico, onde aparece no código e as fontes de pesquisa |
| 🧭 | `e2e/CENARIOS.md` | como cada funcionalidade pode quebrar (ids citados pelos testes) |
| 🐘 | `backend/db/migrations/` | o esquema do PostgreSQL, com as decisões comentadas |
| 🍃 | `backend/internal/loja/adaptadores/mongo/esquema.go` | coleções, `$jsonSchema` e índices do MongoDB |
| 🔑 | `backend/internal/loja/adaptadores/redis/redis.go` (constantes `Prefixo*`, `Chave*`) | as chaves do Redis |
| 📌 | `docker-compose.yml`, `go.mod`, `package.json`, Dockerfiles | versões fixadas |

Quando documentação e código divergirem, investigue a implementação e atualize
a documentação relacionada **na mesma mudança**.

## 🧭 Antes de alterar código

- Leia a implementação, os testes e o `docs/fases/` da fase envolvida.
- Mudanças incrementais e limitadas ao pedido; nada de refatoração oportunista.
- Para funcionalidade nova, siga a ordem da seção 🧪 Testes: **cenários primeiro**.
- Novidade de uma fase entra no roadmap do `README.md` e no `docs/fases/fase-N.md`.

## 🧱 Fronteiras

No backend, **arquitetura hexagonal** (portas e adaptadores) com três
contextos em `internal/`, cada um com `dominio/`, `portas/`, `aplicacao/` e
`adaptadores/<tecnologia>/`:

| Contexto | Bancos (adaptadores) | Responsabilidade |
|---|---|---|
| `loja` | PostgreSQL, MongoDB, Redis, HTTP | checkout ACID, carrinho, catálogo (cache-aside, avaliações, ranking), vitrine, relatórios (réplica), conta (cadastro, login, sessão, LGPD) |
| `laboratorio` | PostgreSQL (+ PgBouncer, réplica), catálogo da loja, clusters do perfil `ha` | os laboratórios: concorrência, isolamento, MVCC, expurgo, índices, conexões, cache, replicação, backup e PITR, alta disponibilidade |
| `painel` | todos (+ PgBouncer) | Painel do DBA: visão geral, locks, saúde, manutenção, auditoria, replicação, Redis, MongoDB |
| `plataforma` | — | `config`, `storage` (conexões e migrações), `health`, `httpx`, `limite` (rate limit), `testinfra` |
| `app` | — | **a** raiz de composição: liga adaptadores → casos de uso → rotas (API e testes) |

Regra de dependência (conferida por `internal/app/arquitetura_test.go`):

- `dominio` só usa a biblioteca padrão (e `uuid`); `portas` + o domínio;
  `aplicacao` + domínio e portas **do próprio contexto**. Nada de pgx, mongo,
  redis ou `net/http` no centro.
- O adaptador `http` chama casos de uso, nunca um banco nem outro adaptador.
- Contextos não se importam. Exceção desenhada: o laboratório fala com a loja
  pelos adaptadores-ponte `laboratorio/adaptadores/loja` e `…/catalogo`.

Regras:

- **SQL só em `db/queries/*.sql` (sqlc)** ou, quando dinâmico/administrativo,
  nos adaptadores `postgres` do `painel` e do `laboratorio`. Nada de SQL
  concatenado com entrada do usuário.
- Erro de banco vira erro do domínio **no adaptador** (SQLSTATE 40001 →
  `ErrConflito`, 23514 → `ErrSemEstoque`…); o adaptador HTTP traduz erro do
  domínio em status. Regra fica no domínio/aplicação.
- Só `app.Montar` monta o servidor: um teste que montasse rotas por conta
  própria testaria outro servidor.
- `sqlcdb/` é gerado (`make sqlc`): não edite à mão.

## ⚠️ Invariantes importantes

- **Estoque nunca fica negativo nem vende além do que existe.** O checkout é
  uma transação; o `CHECK (quantidade >= 0)` é a última barreira. A estratégia
  `ingenua` está **errada de propósito** (é o contraexemplo do laboratório) e
  não pode ser "consertada".
- **Idempotência:** a mesma `Idempotency-Key` devolve o mesmo pedido, inclusive
  depois que o carrinho foi esvaziado.
- **Preço vigente e estoque vêm sempre do PostgreSQL.** O documento do MongoDB
  e o cache do Redis guardam cópias que podem estar velhas.
- **Não há transação entre bancos.** O Redis só é tocado depois do COMMIT no
  PostgreSQL; falha ali é registrada e não desfaz o pedido.
- **Dinheiro não passa por float:** `numeric(12,2)` no PG, `Decimal128` no
  Mongo, texto entre os dois (`preco::text`).
- **Dados derivados se reconstroem da fonte:** `pedido.total` (trigger),
  `relatorio.vendas_por_dia` (refresh), resumo de avaliações (`$merge`),
  ranking do Redis (seed a partir de `item_pedido`).
- O seed grava os pedidos em **ordem cronológica** (correlação ≈ 1): é isso que
  faz o BRIN do Laboratório de Índices funcionar.
- O Laboratório de Índices só cria/remove índices **do catálogo**
  (`laboratorio/adaptadores/postgres/indices_catalogo.go`); o nome da URL nunca vira SQL.
- **Laboratórios não tocam nos dados da loja:** só no schema `lab`, na
  partição de 18 meses atrás da auditoria e no SKU "Console Edição Limitada".
- `auditoria.log` é particionada: partições do mês corrente e dos próximos
  são criadas pela API ao subir; a partição DEFAULT deve ficar vazia.
- As conexões da API se identificam com `application_name = marketplace-api`
  (o Laboratório de Conexões e o painel dependem disso).
- **Senha só como hash argon2id, calculado na API** (nunca uma função do banco
  com a senha como parâmetro: parâmetros vão para o log). A `CHECK` de
  `conta.credencial` recusa o resto. A sessão no Redis guarda o **hash** do token.
- **A compra, a avaliação e "Meus pedidos" são da conta logada** (cookie de
  sessão): o `cliente_id` do corpo nunca decide (`Pedido.DaConta`). Nada de
  rota que liste clientes ou abra pedido de terceiros.
- Leituras do cliente sobre os próprios pedidos passam por **RLS** (`SET LOCAL
  ROLE loja_cliente` + `app.cliente_id`); relatórios usam `relatorio_leitura`.
- Dado pessoal novo entra no **inventário da LGPD** (`docs/10` §7) e em
  `conta.esquecer_cliente` / `Contas.Esquecer` — inclusive cópias em cache.
- **Escrita sempre no primário.** Só leituras que toleram atraso (relatórios)
  vão à réplica; depois de escrever, quem relê da réplica espera o LSN
  (`reports.EsperarReplica`). Sem réplica, tudo cai no primário — e a tela diz.
- O padrão do servidor é `synchronous_commit = local`: o COMMIT comum **nunca**
  espera a réplica (se ela cair, a loja não trava). Só o laboratório pede espera.
- **O PITR nunca toca no primário:** restaura numa instância à parte (porta
  5433, `/var/lib/postgresql/pitr`), confere depois de a recuperação terminar e
  a apaga no fim.
- `COPY … FROM/TO PROGRAM` (pgBackRest, derrubar o líder do Patroni) só com
  **comandos fixos**: nada que vem da requisição entra neles, só valores
  validados contra listas.

## 🐘 Bancos de dados e migrations

**PostgreSQL** — migrations goose em `backend/db/migrations/`, aplicadas pela
API ao subir.

- Migration aplicada é **imutável**: corrija com uma nova.
- Toda migration tem `-- +goose Down` que desfaz o Up por completo
  (`TestMigracoesSobemDescemESobemDeNovo` falha se não desfizer).
- Blocos com `$$` precisam de `-- +goose StatementBegin/End`.
- **Nunca escreva o texto `+goose` dentro de um comentário**: o goose o lê como
  anotação e a migration quebra.
- Aqui migrations **podem** ter trigger, função, procedure e view: ensiná-los é
  o objetivo do projeto (tópico 8.6). Comente o porquê de cada um.
- O que é do **cluster**, não do banco (usuário de replicação, stanza do
  pgBackRest, `pg_hba.conf`), fica em `infra/postgres/` (entrypoint e arquivos
  montados) — vale também para volumes criados antes, que não rodam os scripts
  de init de novo.

**MongoDB** — não há migration: `catalog.GarantirEsquema` cria coleções,
`$jsonSchema` e índices de forma idempotente a cada subida.

**Redis** — toda chave tem prefixo (`carrinho:`, `cache:produto:`, `ranking:`,
`rl:`, `stream:`, `sessao:`) e, se for temporária, TTL. Nunca use `KEYS`: use `SCAN`.

> [!CAUTION]
> `make seed` e `make reset` **apagam dados** do ambiente de desenvolvimento.
> Execute somente quando pedido.

## 🔤 Nomenclatura

Conceitos de negócio em português, sem acento nos identificadores: `Pedido`,
`Estoque`, `Carrinho`, `Avaliacao`, `Corrida`. Termos técnicos universais em
inglês: handler, middleware, pool, cache, upsert, pipeline, stream.

**Comentários, godoc, mensagens de erro e documentação em português.** O
comentário explica o porquê (e, por ser estudo, o conceito de banco envolvido)
— não repete o que a linha faz.

## 🧪 Testes

- **NUNCA** escreva o teste depois do código: **PRIMEIRO** escreva como a
  funcionalidade pode quebrar — em `e2e/CENARIOS.md` (o que passa pela tela) ou
  no comentário `// Como quebra:` do teste —, **DEPOIS** o código.
- **E2E primeiro** para o que passa pela tela (Playwright, `e2e/testes/`). Cada
  teste cita o id do cenário (`[A4]`); id sem teste é lacuna declarada no
  relatório. Prepare dados pela API (fixture `api`); verifique pela tela.
- **Integração** (build tag `integration`) para o resto: serviço e servidor
  inteiro por HTTP (`internal/app`) contra **bancos efêmeros** do
  `internal/plataforma/testinfra` (Testcontainers).
- **Teste sem Docker só para** função pura (validação, geradores do seed,
  `nomePublico`).
- **Proibido mock ou fake de banco.** Constraint, transação, trigger, índice,
  `$jsonSchema` e TTL se testam no banco de verdade.
- Os testes **nunca** tocam no banco de desenvolvimento: nada de
  `POSTGRES_URL`, porta fixa ou `.env` em teste.
- Sem nova tentativa (`retries: 0`): teste intermitente é bug a corrigir. Em
  E2E, espere o estado da tela (`expect`), não o tempo (`waitForTimeout`).
- Testes com Redis não usam `t.Parallel()` (o testinfra recicla os 16 databases).
- Em E2E, estado que depende de outras transações (ex.: VACUUM e o horizonte
  de transações abertas) se verifica com `expect.poll` repetindo a ação, não
  com uma única tentativa.
- O PgBouncer não está no `testinfra`: o modo PgBouncer se testa no E2E.

## ✅ Comandos e verificação

O `Makefile` é a interface principal. Rode `make` para listar os alvos.

| | Comando | O que faz |
|---|---|---|
| 🐳 | `make up` / `make down` | stack de desenvolvimento (núcleo) |
| 🌱 | `make seed` | dados de estudo: PostgreSQL + catálogo MongoDB + Redis |
| ⚡ | `make check` | build, vet, testes unitários e build do frontend — **sem Docker** |
| 🐘 | `make check-db` | integração com PostgreSQL, MongoDB e Redis efêmeros — **exige Docker** |
| 🧭 | `make e2e` | o app inteiro pelo navegador, num stack isolado — **exige Docker** |
| 🧬 | `make sqlc` | regenera `internal/sqlcdb` depois de mudar `db/queries` ou migrations |
| 🔗 | `make links` | confere links e âncoras do catálogo de fontes — **exige internet** |

Durante a implementação rode os testes relacionados. **Antes de entregar uma
fase ou mudança transversal: `make check`, `make check-db` e `make e2e`.**
O relatório do E2E fica em `e2e/relatorio/resumo.md`.

## 🖥️ Recursos da máquina

> [!IMPORTANT]
> O ambiente é um WSL com **~3,8 GB** de RAM, dividido com o Windows.
>
> - **Só sobe o que o projeto já usa.** Testes de integração sobem apenas
>   PostgreSQL, MongoDB e Redis; o E2E sobe o núcleo (postgres,
>   postgres-replica, pgbouncer, mongo, redis, api, web) **e o perfil `ha`**
>   (Fase 5, ~600 MB). **Cassandra e Neo4j não sobem em teste nem no dia a
>   dia** até a Fase 7 começar a usá-los; o perfil `nosql` existe só para isso.
>   O perfil `tools` também não sobe em teste, e o `ha` fica fora do dia a dia
>   (`make up-ha` quando for usar o laboratório).
> - Ao chegar a fase de um banco novo, ele entra no `testinfra`, no stack de
>   E2E (`e2e/rodar.sh`) e no `G1` do catálogo — nunca antes.
> - **Depois** dos testes, confira com `docker ps` que nada ficou para trás:
>   o `rodar.sh` derruba o stack `nosqlgo-e2e` (exceto com `MANTER=1`) e o
>   Testcontainers derruba os seus (o `ryuk` sai sozinho em segundos).
> - Para reconstruir só a API ou o front, use `docker compose up -d --build --no-deps api web`:
>   sem `--no-deps`, o compose reconstrói e **recria o primário** (é dependência),
>   derrubando conexões e a replicação por alguns segundos (cenário S8).
> - Portas: desenvolvimento `3000 8080 5432 5433 6432 27017 6379` (+ `7000`
>   com o perfil `ha`); E2E `23000 28080 25432 25433 26432 27117 26379 27000`.
>   Exceção que fica sempre de pé: `registry-local`.

## 📝 Documentação

O projeto é material de estudo: documentação faz parte da entrega.

- `docs/` **aparece no app** (`/estudo`, `frontend/src/estudo/`): o build lê os
  próprios `.md` (contexto extra `docs` no compose). Escreva para os dois
  lugares: link entre documentos é relativo (`fases/fase-4.md#secao`) e vira
  link do app; link para código mostra o caminho. Os testes `[M1]`–`[M4]`
  comparam a tela com os arquivos — seção ou fonte nova entra sozinha.

- Cada fase tem `docs/fases/fase-N.md` com: tabela de **etapas** (entregável e
  como verificar), objetos/rotas criados, **resultados medidos** (números de
  verdade, não estimativas), **exercícios para você** e observações para as
  próximas fases.
- Cada documento de tópico (`docs/NN-*.md`) termina com **Fontes para
  pesquisa**: documentação oficial primeiro, depois artigos originais e livros.
  Verifique que cada link responde antes de entregar.
- Tabelas com emoji na primeira coluna para listas de ferramentas e comandos
  (como neste arquivo e no `README.md`).
- Ao atualizar uma versão, atualize a tabela **Versões** do `README.md` e as
  imagens do `internal/plataforma/testinfra/doc.go` (as mesmas do compose).

## 🎨 Frontend didático

- Todo bloco que mostra dado tem o **selo do banco** de onde ele veio
  (`<Banco nome="PostgreSQL" />`). Selo errado é bug (cenário `[L5]`).
- Toda página nova abre com `<Explicacao>`: uma frase simples sempre visível e
  o "Por dentro" (SQL, plano, conceito) recolhível, com o tópico do edital.
- Laboratório termina com `<Conclusao>` que **interpreta** o resultado em
  português simples, não só mostra números.
- Todo laboratório tem, nesta ordem: `<Conceito>` (aberto, linguagem simples,
  glossário dos termos), `<Ficha usos={…}>` (que recurso usa: banco,
  estrutura, chave/tabela, por quê) e `<SobreOpcao>` para a opção escolhida
  (o que é, analogia, o comando exato, o que esperar). Cenários `[K1]`, `[K2]`.
- Selo de banco com **uso**: prefira `<UsoSelo id="redis-cache" />` ("Redis ·
  cache do produto") a `<Banco nome="Redis" />`. Os usos ficam no catálogo
  `components/usos.tsx` — recurso novo entra lá primeiro (`[L6]`).
- A lista de laboratórios (`LabsPage`) é **agrupada pelo serviço do compose**
  (`[K5]`); laboratório novo entra no serviço de que depende, e o `<Fontes doc=…>`
  do laboratório aponta o material completo do tópico (`[M5]`).
- Todo laboratório abre com um tutorial **"do zero"** (`<Tutorial>`, conteúdo
  em `components/tutoriais.tsx`): passos curtos, ilustração SVG, ligação com o
  laboratório (`[K4]`).
- **Toda afirmação tem fonte** (`[K3]`): cada passo do tutorial, cada
  `<SobreOpcao fontes={…}>` e cada experimento de índice cita ids do catálogo
  `components/fontes.tsx` (o que a fonte **confirma**), e o laboratório termina
  com `<Fontes>`. Fonte nova entra no catálogo primeiro; rode `make links`.
- Experimento novo no Laboratório de Índices exige os textos de
  `laboratorio/adaptadores/postgres/indices_didatica.go` (o teste `TestTodoExperimentoTemDidatica` falha sem eles).
- Gráficos: siga a skill de visualização — uma série por gráfico de linha
  (nunca dois eixos), cor fixa por entidade (`--serie-1..3`, paleta validada),
  rótulo direto nas barras.
- **Tema escuro "Neon 3000"** (`styles.css`): cor só por variável do tema —
  nada de hex solto em componente. Ilustrações SVG usam `--il-*`, gráficos
  `--serie-1..3` (passos escuros validados pela skill), o Mermaid recebe as
  mesmas cores no `themeVariables`. Todo texto passa de 4,5:1 (`[V4]`).
- Navegação: o menu tem três grupos (Loja, Estudo, Operação), cabe numa linha
  de 1024 px para cima e recolhe num botão "Menu" abaixo disso (`[V1]`, `[V2]`);
  página nova entra em `GRUPOS` (`App.tsx`) com a regra que a acende (`[V3]`).
- Acessibilidade conta: nomes de botão únicos, ícone decorativo com
  `aria-hidden`, `aria-label` em tabelas e figuras (os testes os usam).

## 🔐 Segurança

As credenciais do compose são **de desenvolvimento** (inclusive `replicador`,
a keyfile e o usuário do Mongo de laboratório) e a API usa o superusuário do
PostgreSQL de propósito — é o que permite o `COPY … FROM PROGRAM` dos
laboratórios da Fase 5. Tirar o superusuário da API ficou pendente na Fase 6 (`docs/fases/fase-6.md` §7). Até lá, não exponha portas
para fora da máquina e não reaproveite essas senhas. O `DEBUG` do Redis só é
ligado no Redis de laboratório (`infra/redis-ha/`).

Nunca registre segredos, `.env` ou dados pessoais reais. Não faça upgrade
major de banco ou runtime como trabalho incidental; fixe versões explícitas e
nunca use `:latest`.

## 🌱 Git

- Nunca altere a identidade Git configurada.
- Antes de cada commit, mostre o que está staged e peça autorização.
- Nunca execute `git push`.
- Conventional Commits: `type(escopo): descrição` (ex.: `feat(catalog): busca com $facet`).
