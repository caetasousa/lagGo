# Fase 6: segurança e governança

**Tópico:** 8.12 (segurança, privacidade e governança de dados)
**Status:** ✅ cadastro, login, RLS, papéis, CPF cifrado e LGPD · TLS, ACLs e secrets em aberto (seção 7)

A loja passou a ter **contas de verdade**: cadastro com endereço e CPF, login,
sessão e "excluir minha conta". Até a Fase 5 qualquer pessoa comprava em nome
de qualquer cliente (o `cliente_id` vinha do corpo da requisição), via a lista
de clientes com nome e e-mail e abria o pedido de qualquer um pelo id. Agora a
compra, a avaliação e "Meus pedidos" são **da conta logada**, e o próprio
banco garante "só os seus pedidos" com Row-Level Security.

## 1. Etapas

| # | Entregável | Onde | Como verificar |
|---|---|---|---|
| 6.0 | Cenários primeiro | [`e2e/CENARIOS.md`](../../e2e/CENARIOS.md) seções Q e W, escritas antes do código | relatório do E2E |
| 6.1 | Esquema | [`00008_contas_e_seguranca.sql`](../../backend/db/migrations/00008_contas_e_seguranca.sql): schema `conta`, `conta.credencial` com `CHECK` de argon2id, colunas do CPF, papéis, policies e a procedure da LGPD | `TestMigracoesSobemDescemESobemDeNovo` |
| 6.2 | Hash de senha | [`senha/argon2.go`](../../backend/internal/loja/adaptadores/senha/argon2.go): argon2id (RFC 9106) com os parâmetros mínimos da OWASP, comparação em tempo constante | `TestArgon2idComSalEConferencia` |
| 6.3 | Sessão | [`redis/sessoes.go`](../../backend/internal/loja/adaptadores/redis/sessoes.go): `sessao:{sha256}` com TTL deslizante; cookie `HttpOnly`/`SameSite=Lax`/`Secure` ([`http/conta.go`](../../backend/internal/loja/adaptadores/http/conta.go)) | `[Q2]`, `[Q7]` |
| 6.4 | Cadastro e login | [`aplicacao/conta.go`](../../backend/internal/loja/aplicacao/conta.go), [`dominio/conta.go`](../../backend/internal/loja/dominio/conta.go) (validação com dígitos do CPF), telas **Entrar**, **Criar conta**, **Minha conta** | `[Q1]`–`[Q3]` |
| 6.5 | A compra é da conta | `Pedido.DaConta` e `NovaAvaliacao.DaConta`; `/checkout`, `/carrinho/finalizar` e avaliações exigem login; saíram `/loja/clientes`, `/loja/pedidos/{id}` e `/loja/clientes/{id}/pedidos` | `[Q4]`, `[Q5]` |
| 6.6 | Row-Level Security | papel `loja_cliente` + policies em `pedido`, `item_pedido`, `pagamento`; "Meus pedidos" lê com `SET LOCAL ROLE` + `set_config('app.cliente_id')` | `[W1]`, `[Q5]` |
| 6.7 | Menor privilégio | papel `relatorio_leitura` (só `SELECT`) para os relatórios, no primário e na réplica | `[W2]` |
| 6.8 | CPF cifrado | `pgp_sym_encrypt` + `hmac` (UNIQUE) + 2 dígitos para a máscara; chave em `CPF_CHAVE` | `[W3]` |
| 6.9 | LGPD | procedure `conta.esquecer_cliente`; sessões, nome nas avaliações e cache do produto apagados; pedidos mantidos | `[Q6]` |
| 6.10 | Didática | explicações nas telas de conta, selos `pg-contas`, `pg-rls`, `redis-sessao`; [docs/10 §7](../10-seguranca-governanca.md#7-onde-está-no-código-fase-6) com o inventário de dados pessoais | `[L6]`, `[M1]` |

## 2. Objetos criados

| Banco | Objeto | Para quê |
|---|---|---|
| PostgreSQL | schema `conta`, tabela `conta.credencial` | hash da senha, separado de `cliente` |
| PostgreSQL | `cliente.cpf_cifrado`, `cpf_hmac` (UNIQUE), `cpf_final`, `anonimizado_em` | CPF cifrado, unicidade sem decifrar, máscara, LGPD |
| PostgreSQL | visão `conta.v_cliente_mascarado` | o que a tela da conta pode ver |
| PostgreSQL | papéis `loja_cliente`, `relatorio_leitura` (NOLOGIN) | menor privilégio, assumidos com `SET LOCAL ROLE` |
| PostgreSQL | policies `pedido_do_cliente`, `item_do_cliente`, `pagamento_do_cliente`, `relatorio_le_pedidos`, `relatorio_le_itens` | Row-Level Security |
| PostgreSQL | procedure `conta.esquecer_cliente(uuid)` | "direito ao esquecimento" numa transação |
| Redis | `sessao:{sha256 do token}` (STRING, TTL 7 dias), `sessao:cliente:{id}` (SET) | sessão e o índice para encerrar todas |

**Rotas:** `POST /api/conta/cadastro`, `POST /api/conta/entrar`, `POST /api/conta/sair`, `GET /api/conta/eu`, `DELETE /api/conta`, `GET /api/conta/pedidos`, `GET /api/conta/pedidos/{id}`.

## 3. Resultados medidos

### O custo de adivinhar uma senha

| Hash | Tempo por cálculo | Memória por cálculo |
|---|---|---|
| SHA-256 | 0,25 µs | 0 |
| argon2id (m=19 MiB, t=2, p=1) | 49 ms | 19 MB |

Medido com `go test -bench` nesta máquina (12 núcleos). O argon2id é ~200 mil
vezes mais caro **para quem ataca**: com SHA-256, uma lista de 1 bilhão de
senhas vazadas se testa em minutos; com argon2id, em anos — e cada tentativa
paralela precisa de 19 MB próprios, o que limita a placa de vídeo. Para quem
usa, 49 ms no login não se nota.

### O login de ponta a ponta (pela internet, pelo subdomínio `lab` via Cloudflare)

| Chamada | Tempo |
|---|---|
| `POST /api/conta/cadastro` (argon2id + transação de 3 INSERTs + sessão no Redis) | 0,79 s (a primeira; inclui o aquecimento) |
| `POST /api/conta/entrar` (3 vezes) | 0,29 s · 0,26 s · 0,24 s |

Inclui a ida e volta Cloudflare → túnel → nginx → API. O cookie chegou com
`Secure` porque a requisição veio por HTTPS (cabeçalho do proxy).

### Testes

| Suíte | Resultado |
|---|---|
| Unidade (`make check`) | inclui a validação do cadastro (`[Q1]`) e o argon2id (`[Q7]`) |
| Integração (`make check-db`) | `TestCadastroLoginESessao`, `TestExcluirContaAnonimizaEMantemPedidos`, `TestRLSEPapeisComMenorPrivilegio` e os testes antigos, agora logados |
| E2E (`make e2e`) | **75 de 75** em 3,6 min (5 testes novos de conta; os antigos agora compram com contas criadas pela API) |

### O que os testes pegaram durante a fase

| Onde | Defeito | Correção |
|---|---|---|
| E2E `[Q6]` (escrevendo o teste) | "excluir a conta" anonimizava o MongoDB, mas a **cópia do produto no cache do Redis** continuava com o nome nas avaliações por até 5 minutos — dado pessoal sobrevivendo num cache | `AnonimizarAutor` devolve os produtos mexidos e o caso de uso apaga essas chaves; o teste de integração põe o produto no cache antes de excluir (sabotagem conferida: sem a correção, falha) |
| integração `[Q5]` | sabotagem: sem o `SET LOCAL ROLE loja_cliente`, o pedido de outra pessoa abria pelo id (200) | é o RLS que protege — o teste fica como guarda |
| E2E (a primeira execução) | o `TRUNCATE` do seed não conhecia `conta.credencial` (FK para `cliente`) e o seed parou | a tabela entrou no `TRUNCATE` de `db/seed/seed.sql` |
| relatório do E2E | o gerador lia só o PRIMEIRO id do título ("[L2] [L3] …"): L3 e Q2 apareciam "sem teste" | lê todos os ids; cenário marcado "(integração…)" aparece como "fora do E2E" em vez de lacuna |
| sqlc | `CASE … END` sem tipo virou `interface{}` e a máscara do CPF podia ser NULL | `coalesce(…)::text` na consulta |

## 4. API da fase

```bash
# criar conta (o cookie da sessão vem no Set-Cookie)
curl -c c.txt -X POST localhost:8080/api/conta/cadastro -H 'Content-Type: application/json' -d '{
  "nome":"Ana Lima","email":"ana@exemplo.com","senha":"uma senha longa","cpf":"529.982.247-25",
  "endereco":{"cep":"01310-100","logradouro":"Av. Paulista","numero":"1000","cidade":"São Paulo","uf":"SP"}}'
curl -b c.txt localhost:8080/api/conta/eu             # e-mail e CPF mascarados
curl -b c.txt localhost:8080/api/conta/pedidos        # com RLS
curl -b c.txt -X POST localhost:8080/api/conta/sair   # o cookie antigo deixa de valer
```

## 5. O frontend

- **Entrar** e **Criar conta** (`/entrar`, `/cadastro`): voltam para onde a pessoa estava (`?voltar=/carrinho`).
- O cabeçalho troca o seletor "Entrar como" (login simulado) por **Entrar** / **Olá, Nome**.
- **Carrinho**: monta sem conta (sessão do carrinho no `X-Sessao`); finalizar pede para entrar.
- **Minha conta** (`/conta`): dados mascarados, sair e "Excluir minha conta" com confirmação.
- **Meus pedidos** e a página do pedido leem `/api/conta/pedidos` (RLS).

## 6. Exercícios para você

- [ ] **Veja a policy trabalhar:** no `psql`, `BEGIN; SET LOCAL ROLE loja_cliente; SELECT count(*) FROM pedido;` — e depois com `SELECT set_config('app.cliente_id', '<um id>', true);`. Por que sem o `set_config` dá zero, e não erro?
- [ ] **Esqueça a policy:** `ALTER TABLE pedido DISABLE ROW LEVEL SECURITY` num banco de teste. O que o papel `loja_cliente` passa a ver? E com `FORCE ROW LEVEL SECURITY`, o que muda para o dono da tabela?
- [ ] **Força bruta:** com o rate limit de 30/min, quanto tempo levaria testar as 10 mil senhas mais comuns contra uma conta? E se o atacante trocar de IP?
- [ ] **Log que vaza:** com `log_min_duration_statement = 0`, cadastre uma conta e procure a chave do CPF no log do PostgreSQL. Agora entenda por que o cadastro faz `SET LOCAL log_min_duration_statement = -1`.
- [ ] **Rotação de chave:** como trocar a `CPF_CHAVE` sem perder os CPFs já cifrados? (dica: decifrar com a velha e cifrar com a nova, numa transação por lote).
- [ ] **Sessão roubada:** copie o cookie de uma aba para outro navegador. O que impede? (dica: nada — por isso `HttpOnly` e HTTPS importam). Como "sair de todos os dispositivos" já funciona por baixo (`sessao:cliente:{id}`)?
- [ ] **LGPD:** a lei manda guardar a nota fiscal; o pedido fica. Mas o endereço do pedido foi apagado. Isso é um problema fiscal? Como você resolveria?

## 7. Observações para as próximas fases

- **A API ainda é superusuário.** É o que permite o `COPY … FROM PROGRAM` dos laboratórios da Fase 5 e o `SET LOCAL log_min_duration_statement` do cadastro. O passo seguinte: separar o pool da loja (um papel `loja_app` com DML e sem `BYPASSRLS`) do pool dos laboratórios e do painel.
- **Em aberto do roadmap:** TLS no PostgreSQL, ACL no Redis da loja, autenticação no MongoDB da loja e Docker secrets para `CPF_CHAVE` e as senhas do compose. Mexem na infra inteira (e na memória da máquina); entram quando a Fase 7 estabilizar.
- **Os laboratórios e o Painel do DBA não exigem login.** São ferramentas de estudo; na internet (o subdomínio `lab`), a proteção é o Cloudflare Access na frente do site inteiro.
- **Clientes do seed não têm senha.** Para entrar, crie uma conta pela tela; os testes de integração gravam uma credencial para eles no banco efêmero.
