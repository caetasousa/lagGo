# 10 · Segurança e governança de dados (8.12)

> Estado atual (Fase 0): **inseguro de propósito**. A API usa o superusuário,
> o Mongo e o Redis não têm autenticação e as senhas estão no compose. Cada item
> abaixo corrige uma dessas falhas na Fase 6.

## 1. Pilares

- **Confidencialidade, Integridade e Disponibilidade** (tríade CID).
- **Defesa em profundidade:** rede → autenticação → autorização → criptografia → auditoria.
- **Menor privilégio:** cada componente recebe só o acesso de que precisa.

## 2. Autenticação e autorização no PostgreSQL

### Roles (Fase 6)

```sql
-- Dono do esquema: só as migrações usam
CREATE ROLE marketplace_owner LOGIN PASSWORD '...';
-- Aplicação: apenas DML, sem DDL
CREATE ROLE marketplace_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO marketplace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO marketplace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE marketplace_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_app;
-- Relatórios: somente leitura (role predefinida do PG 14+)
CREATE ROLE marketplace_bi LOGIN PASSWORD '...' IN ROLE pg_read_all_data;
REVOKE ALL ON auditoria.log FROM marketplace_app;  -- app não pode apagar auditoria
```

- **`pg_hba.conf`:** quem pode conectar, de onde e com qual método. Use `scram-sha-256`; nunca `trust` fora do laboratório.
- **TLS:** `ssl = on` no servidor e `sslmode=verify-full` no cliente.

### Row-Level Security (RLS)

O vendedor só enxerga os próprios itens vendidos, **garantido pelo banco**,
mesmo que a aplicação tenha um bug:

```sql
ALTER TABLE sku ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendedor_ve_seus_skus ON sku
  USING (vendedor_id = current_setting('app.vendedor_id')::uuid);
```

```go
// a cada transação, a API informa quem é o usuário:
tx.Exec(ctx, "SELECT set_config('app.vendedor_id', $1, true)", vendedorID) // true = só nesta transação
```

> Atenção: o dono da tabela e os superusuários **ignoram** o RLS, a menos que se use
> `FORCE ROW LEVEL SECURITY`. Mais um motivo para a API não usar o superusuário.

### Views de segurança e mascaramento

```sql
CREATE VIEW cliente_publico WITH (security_barrier) AS
SELECT id, nome, regexp_replace(email, '(^.).*(@.*$)', '\1***\2') AS email
  FROM cliente;
```

## 3. Criptografia

| Onde | Técnica | No projeto |
|---|---|---|
| Em trânsito | TLS em todas as conexões (PG, Mongo, Redis, HTTPS no nginx) | Fase 6 |
| Em repouso (disco) | Criptografia de volume (LUKS, discos de nuvem). O PostgreSQL community não tem TDE nativo | Fora do escopo |
| Coluna | `pgcrypto`: `pgp_sym_encrypt(cpf, chave)` | CPF do cliente |
| Senhas | **Hash** lento com sal: argon2id ou bcrypt. Nunca criptografia reversível, nunca MD5/SHA puro | Login (Go: `golang.org/x/crypto/argon2`) |
| Busca em dado cifrado | Coluna extra com HMAC do valor (*blind index*) | Buscar cliente por CPF |

A chave de criptografia **não** pode ficar no banco nem no código. Use
variável de ambiente ou Docker secrets e, em produção, um KMS ou Vault.

## 4. Segurança na aplicação

- **SQL/NoSQL injection:** consultas sempre parametrizadas (docs/02). No
  Mongo, nunca monte filtros a partir de JSON enviado pelo cliente (`{"$ne": null}`).
- Validar a entrada e limitar o tamanho das requisições.
- Rate limit (Redis, docs/07).
- Não vazar detalhes de erro do banco para o cliente. Hoje o Painel do DBA
  mostra os erros de propósito; em produção ele seria protegido por login e perfil de administrador.
- Segredos: tirar do `docker-compose.yml` e passar a usar [Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/).

## 5. NoSQL

| Banco | Fase 6 |
|---|---|
| MongoDB | `--auth` + **keyfile** entre membros do replica set; usuários com roles (`readWrite` no banco `marketplace`) |
| Redis | **ACL** (`ACL SETUSER app on >senha ~carrinho:* ~cache:* +@read +@write -@dangerous`); desabilitar `FLUSHALL`/`CONFIG` |
| Cassandra | `PasswordAuthenticator` + `CassandraAuthorizer` |
| Neo4j | Já exige senha; roles detalhadas só na edição Enterprise |

## 6. Governança de dados

Governança é o **conjunto de políticas, papéis e processos** que garante que
os dados sejam confiáveis, seguros e usados corretamente. A referência é o
**DAMA-DMBOK**, que organiza a gestão de dados em áreas de conhecimento
(arquitetura, modelagem, armazenamento, segurança, integração, qualidade,
metadados...).

Conceitos:

- **Papéis:** *data owner* (responsável pelo negócio), *data steward*
  (cuida da qualidade e das definições), *data custodian* (TI, guarda
  técnica) e, pela LGPD, o **encarregado (DPO)**.
- **Catálogo de dados e metadados:** o que existe, onde fica, quem é o dono e qual o significado.
- **Linhagem (*lineage*):** de onde o dado veio e por onde passou. Exemplo: pedido no PG → evento no Cassandra → grafo no Neo4j.
- **Qualidade:** completude, unicidade, validade, consistência, atualidade e acurácia.
- **Classificação:** público, interno, confidencial, pessoal, pessoal sensível.
- **Ciclo de vida e retenção:** por quanto tempo guardar e como descartar.

### LGPD (Lei 13.709/2018) no marketplace

| Exigência | Implementação no projeto |
|---|---|
| **Inventário** de dados pessoais | Tabela em `docs/` listando cada campo pessoal, o banco, a finalidade e a base legal |
| **Base legal** (art. 7º) | Execução de contrato (pedido) e consentimento (marketing) |
| **Minimização** | Não coletar o que não usa |
| **Direitos do titular** (art. 18): acesso, correção, eliminação, portabilidade | Endpoint que exporta e anonimiza os dados do cliente **nos 5 bancos** |
| **Anonimização x pseudonimização** | Anonimizado sai do escopo da LGPD; pseudonimizado (ex.: hash do CPF) continua dentro |
| **Segurança** (art. 46) | Seções 2–5 deste documento |
| **Registro das operações** (art. 37) | Trigger de auditoria (docs/05) |
| **Retenção** | TTL no Cassandra (90 dias, já em [`init.cql`](../infra/cassandra/init.cql)), TTL no Redis, rotina de expurgo no PG |
| **Incidentes** (art. 48) | Comunicar a ANPD e os titulares |

**Exercício da Fase 6:** implementar o "direito ao esquecimento" e descobrir
na prática **onde** o dado de um cliente se espalhou: PG, Mongo
(avaliações), Redis (sessão/carrinho), Cassandra (eventos), Neo4j (grafo) e
**backups**. Qual é a estratégia para os backups?

## 7. Onde está no código (Fase 6)

O cadastro e o login usam os três bancos, cada um no que faz melhor:

| O quê | Onde | Por quê |
|---|---|---|
| Hash da senha (argon2id, 19 MiB, 2 passadas, sal de 16 bytes) | [`loja/adaptadores/senha/argon2.go`](../backend/internal/loja/adaptadores/senha/argon2.go) | lento e caro em memória de propósito; calculado **na API** — uma função do banco receberia a senha como parâmetro, e parâmetros vão para o log de consultas lentas |
| `conta.credencial` com `CHECK (senha_hash LIKE '$argon2id$%')` | [`00008_contas_e_seguranca.sql`](../backend/db/migrations/00008_contas_e_seguranca.sql) | a última barreira: o banco recusa senha em texto |
| Sessão: `sessao:{sha256 do token}` com TTL de 7 dias | [`loja/adaptadores/redis/sessoes.go`](../backend/internal/loja/adaptadores/redis/sessoes.go) | toda requisição pergunta "quem é?" (rápido) e a sessão vence sozinha; o Redis guarda o **hash** do token |
| Cookie `HttpOnly`, `SameSite=Lax`, `Secure` atrás de HTTPS | [`loja/adaptadores/http/conta.go`](../backend/internal/loja/adaptadores/http/conta.go) | o JavaScript não lê o token (XSS) e outro site não o usa (CSRF) |
| Mesma resposta e mesmo tempo para "e-mail sem conta" e "senha errada" | [`loja/aplicacao/conta.go`](../backend/internal/loja/aplicacao/conta.go) | a tela de login não pode contar quem é cliente |
| Compra e avaliação sempre da conta logada | `Pedido.DaConta`, `NovaAvaliacao.DaConta` ([`dominio/conta.go`](../backend/internal/loja/dominio/conta.go)) | o `cliente_id` do corpo da requisição não decide nada |
| RLS em `pedido`, `item_pedido`, `pagamento` (papel `loja_cliente`) | migração 00008 + [`adaptadores/postgres/contas.go`](../backend/internal/loja/adaptadores/postgres/contas.go) | "só os seus pedidos" garantido pelo banco, mesmo se um `WHERE` sumir |
| Relatórios com o papel `relatorio_leitura` (só `SELECT`) | [`adaptadores/postgres/relatorios.go`](../backend/internal/loja/adaptadores/postgres/relatorios.go) | um relatório com bug não consegue escrever |
| CPF: `pgp_sym_encrypt` + `hmac` (UNIQUE) + 2 dígitos em claro | migração 00008, [`db/queries/conta.sql`](../backend/db/queries/conta.sql) | ilegível num dump; "CPF já tem conta?" sem decifrar ninguém; a tela mascara sem a chave |
| "Excluir minha conta": procedure `conta.esquecer_cliente` | migração 00008 + `Contas.Esquecer` | anonimiza numa transação; depois apaga as sessões, o nome nas avaliações (MongoDB) e a cópia do produto no cache |

### Inventário de dados pessoais (LGPD, art. 37)

| Dado | Onde mora | Proteção | Ao excluir a conta |
|---|---|---|---|
| nome | `cliente.nome` (PostgreSQL) | — | vira "Cliente removido" |
| e-mail | `cliente.email` | mascarado na tela (`conta.v_cliente_mascarado`) | vira `removido-{id}@anonimo.invalid` |
| CPF | `cliente.cpf_cifrado`, `cpf_hmac`, `cpf_final` | cifrado (pgcrypto); chave fora do repositório em produção | apagado |
| endereço | `endereco` | — | CEP zerado, logradouro removido; cidade/UF ficam (estatística) |
| senha | `conta.credencial.senha_hash` | só o hash argon2id | apagada |
| sessão | `sessao:*` (Redis) | hash do token; TTL de 7 dias | apagadas |
| nome nas avaliações | `avaliacoes`, `produtos.avaliacoes_recentes` (MongoDB), `cache:produto:*` (Redis) | só "Nome I." (minimização) | "Cliente removido"; cache apagado |
| pedidos | `pedido`, `item_pedido`, `pagamento` | RLS | **ficam** (obrigação fiscal, art. 16, I), ligados ao cliente anônimo |

### O que ainda falta (declarado)

A API ainda conecta como **superusuário** (os laboratórios da Fase 5 usam `COPY … FROM PROGRAM`), e o `SET LOCAL log_min_duration_statement` do cadastro depende disso. TLS no PostgreSQL, ACL no Redis da loja, autenticação no MongoDB da loja e Docker secrets ficaram para depois — veja [fase-6.md](fases/fase-6.md#7-observações-para-as-próximas-fases).

## Fontes para pesquisa

- PostgreSQL. [Database Roles](https://www.postgresql.org/docs/current/user-manag.html), [Predefined Roles](https://www.postgresql.org/docs/current/predefined-roles.html), [GRANT](https://www.postgresql.org/docs/current/sql-grant.html)
- PostgreSQL. [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- PostgreSQL. [pg_hba.conf](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html), [SSL](https://www.postgresql.org/docs/current/ssl-tcp.html), [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)
- MongoDB. [Security Checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)
- Redis. [ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
- OWASP. [Cheat Sheet Series](https://cheatsheetseries.owasp.org/): [SQL Injection](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html), [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Database Security](https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html)
- BIRYUKOV, A. et al. [RFC 9106: Argon2 Memory-Hard Function for Password Hashing](https://www.rfc-editor.org/rfc/rfc9106.html) (2021): o algoritmo do hash de senha
- OWASP. [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): token aleatório, cookie HttpOnly/SameSite, mensagens genéricas no login
- NIST. [SP 800-63B: Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html): tamanho mínimo de senha e o que (não) exigir
- MDN. [Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie): `HttpOnly`, `Secure`, `SameSite`, `Path`
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks): guias de hardening de PostgreSQL, MongoDB etc.
- BRASIL. [Lei nº 13.709/2018 (LGPD)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD: Autoridade Nacional de Proteção de Dados](https://www.gov.br/anpd/pt-br): guias orientativos
- DAMA International. [*DAMA-DMBOK: Data Management Body of Knowledge*](https://www.dama.org/cpages/body-of-knowledge). 2. ed.
