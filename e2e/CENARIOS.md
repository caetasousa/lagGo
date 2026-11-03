# Como o nosqlGo pode quebrar

Este catálogo vem **antes** dos testes e, para funcionalidade nova, **antes do
código**: cada item é uma maneira concreta de algo deixar de funcionar para
quem usa. Cada teste em `testes/` cita o id que cobre (`[A4]`) e o relatório
(`relatorio/resumo.md`) lista o resultado por id. Um item sem teste aparece
como **lacuna declarada**, não como esquecimento.

Os testes rodam contra o stack do núcleo (frontend de produção no nginx, API,
PostgreSQL e a sua réplica, PgBouncer, MongoDB e Redis) e os clusters de alta
disponibilidade (perfil `ha`, Fase 5) num projeto compose isolado (`nosqlgo-e2e`),
semeado do zero a cada execução. Desde a Fase 7, Cassandra e Neo4j
também sobem (com memória reduzida). Nada aqui toca no banco de quem desenvolve.

Alguns cenários não cabem no navegador e são cobertos noutra camada, indicada
na própria linha: Q7, W1–W3, X2, X4, X5 e Y4 (integração, `internal/app`), S6 e S7 (integração, `internal/laboratorio/aplicacao`), S8 (verificação manual: precisa recriar contêineres) e U6 (unidade, `internal/laboratorio/aplicacao`).

## L. Loja simulada e didática (Fase 4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| L1 | a página inicial não mostra as categorias (PostgreSQL) nem os mais vendidos (Redis) | vitrine vazia |
| L2 | trocar a conta em "Entrar como" não troca o cliente do checkout e de "Meus pedidos" | compra feita em nome de outra pessoa |
| L3 | "Meus pedidos" não lista a compra recém-feita, ou mostra pedido de outro cliente | histórico errado |
| L4 | a página do pedido não mostra itens, total e situação | confirmação vazia |
| L5 | o selo de banco aponta o banco errado (ex.: oferta marcada como MongoDB) | a aula ensina errado de onde vem cada dado |
| L6 | o selo diz o banco mas não o USO (o Redis aqui é cache? carrinho? ranking? fila?) | "Redis" sozinho não ensina nada |

## K. Didática dos laboratórios (Fase 4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| K1 | escolher uma opção (estratégia, situação, nível, modo, ação) não mostra a explicação DAQUELA opção | o aluno clica sem saber o que está testando |
| K2 | o laboratório não diz qual recurso usa (banco, estrutura, chave/tabela) | não dá para saber o que está sendo medido |
| K3 | o conteúdo não diz de onde veio: um passo, uma opção ou um experimento sem fontes para pesquisar | o aluno não consegue conferir nem aprofundar |
| K4 | um laboratório não tem o tutorial "do zero" passo a passo (com ilustração) no mesmo nível do de Índices | profundidade desigual entre os tópicos |
| K5 | a lista de laboratórios não está agrupada pelos serviços do `docker-compose.yml`, um laboratório aparece no serviço errado, ou um serviço de banco some da lista por ainda não ter laboratório | não dá para ver o que cada serviço ensina, o que precisa estar de pé nem o que falta |

## M. Material de estudo no app (`docs/` renderizado)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| M1 | um documento de `docs/` (tópico ou fase) não aparece no app, ou o app mostra outro texto que não o do arquivo | o app fica mais raso que o `.md` e os dois divergem |
| M2 | as "Fontes para pesquisa" viram texto solto (sem link) ou abrem na mesma aba | não dá para pesquisar a partir do app |
| M3 | um link entre documentos ou para uma seção (`fases/fase-4.md#3-resultados-medidos`) quebra dentro do app | cai numa página vazia ou no topo, não na seção |
| M4 | tabela ou diagrama (Mermaid) de algum documento não é desenhado — inclusive por erro de sintaxe no `.md` (ex.: `;` dentro de mensagem do `sequenceDiagram`) | o aluno vê código cru ou "Syntax error in text" no lugar do diagrama |
| M5 | o laboratório não leva ao material completo do seu tópico | o detalhamento do `.md` fica escondido |

## V. Navegação e tema visual

| id | Como quebra | O que o usuário vê |
|---|---|---|
| V1 | no celular (390 px) o menu quebra em várias linhas e o cabeçalho empurra o conteúdo para baixo; ou o menu recolhido não abre, não fecha ao escolher uma página, ou esconde algum destino | metade da tela é cabeçalho, ou páginas inalcançáveis |
| V2 | no computador (1024–1440 px) um link do menu quebra linha, fica cortado, ou a página ganha rolagem horizontal | menu "truncado" e torto |
| V3 | a página atual não fica marcada no menu: um laboratório (`/lab/mvcc`, `/indices`) não acende "Laboratórios" | o aluno não sabe em que seção está |
| V4 | no tema escuro, um texto fica sem contraste: tokens de texto abaixo de 4,5:1 sobre o fundo, ou a ilustração do tutorial ainda desenhada com tinta escura sobre o painel escuro | texto que some na tela |

## Q. Cadastro, login e conta (Fase 6, tópico 8.12)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| Q1 | o cadastro aceita dados inválidos (e-mail torto, senha curta, CPF com dígito errado, CEP/UF inválidos) ou um e-mail/CPF que já tem conta | contas duplicadas ou lixo no cadastro |
| Q2 | depois de cadastrar ou entrar, o cabeçalho, o carrinho e "Meus pedidos" não reconhecem a pessoa; ou "Sair" não encerra a sessão (o cookie antigo continua valendo) | logado sem estar, ou sessão que não morre |
| Q3 | a senha errada e o e-mail inexistente dão mensagens diferentes (dá para descobrir quem tem conta) | vazamento de quem é cliente |
| Q4 | dá para comprar ou avaliar em nome de OUTRA pessoa mandando o `cliente_id` dela no corpo, ou sem estar logado | compra no nome de terceiros |
| Q5 | uma pessoa abre o pedido de outra pelo id (ou a lista de clientes com nome e e-mail continua pública) | dados pessoais de terceiros expostos |
| Q6 | "Minha conta" mostra o CPF inteiro, ou "excluir minha conta" deixa nome, e-mail, CPF ou o nome nas avaliações; ou apaga os pedidos (que a lei manda guardar) | LGPD descumprida |
| Q7 | a senha vai para o banco (ou para o log) em texto, ou o Redis guarda o token da sessão como ele é (quem lê um dump entra na conta) (integração: `internal/app`; unidade: `loja/adaptadores/senha`) | senha ou sessão vazada num backup |

## W. Segurança no banco (Fase 6, tópico 8.12)

Cobertos na camada de integração (`internal/app`), contra o PostgreSQL de verdade.

| id | Como quebra | O que o usuário vê |
|---|---|---|
| W1 | sem Row-Level Security, um erro de `WHERE` no código entrega pedidos de outros clientes: o papel `loja_cliente` enxerga linhas que não são da sessão (integração: `internal/app`) | o banco não defende o dado |
| W2 | o papel dos relatórios (`relatorio_leitura`) consegue escrever ou apagar (integração: `internal/app`) | um relatório com bug destrói dados |
| W3 | o CPF fica em texto no banco, ou a busca por CPF repetido precisa decifrar todos (integração: `internal/app`) | dado pessoal legível num dump |

## X. Cassandra: eventos e consistência ajustável (Fase 7, tópico 8.8)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| X1 | abrir produtos logado não alimenta "Vistos recentemente": o mais novo não vem primeiro, o mesmo produto aparece repetido, ou a lista mistura o histórico de outra pessoa | vitrine pessoal errada |
| X2 | o evento grava sem TTL (o histórico cresce para sempre, contra a retenção da LGPD) ou a consulta precisa de `ALLOW FILTERING` (varre o cluster) (integração: `internal/app`) | disco cheio, consulta lenta |
| X3 | o Laboratório de Consistência mente: com RF=3 e só 1 réplica no ar, `QUORUM` ou `ALL` "funcionam", ou `ONE` falha | a regra R + W > RF ensinada errada |
| X4 | com o Cassandra fora do ar, abrir o produto dá erro (o evento é um efeito secundário, não pode derrubar a página) (integração: `internal/app`) | loja quebrada por causa do histórico |
| X5 | "excluir minha conta" deixa o histórico de navegação no Cassandra (o TTL só o apagaria em 30 dias) (integração: `internal/app`) | LGPD descumprida: o que a pessoa olhou sobrevive à conta |

## Y. Neo4j: grafo e recomendações (Fase 7, tópico 8.8)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| Y1 | uma compra não entra no grafo (o "quem comprou também comprou" nunca muda) ou o grafo não se reconstrói a partir dos pedidos | recomendação congelada |
| Y2 | a recomendação inclui o próprio produto, ou não vem ordenada pela força (quantos clientes compraram os dois) | sugestão sem sentido |
| Y3 | o Laboratório Grafo × SQL compara consultas que respondem perguntas diferentes: o top da recomendação em Cypher e em SQL não bate | comparação de desempenho inválida |
| Y4 | com o Neo4j fora do ar, a compra falha (o grafo é derivado: atualizá-lo é efeito depois do COMMIT) (integração: `internal/app`) | compra perdida por causa da recomendação |

## A. Catálogo (MongoDB · Fase 3)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| A1 | a busca por texto não acha o produto pelo nome, ou devolve produtos sem relação | procura "notebook" e não acha notebook |
| A2 | filtrar por uma categoria raiz não inclui as subcategorias (array de ancestrais) | "Eletrônicos" vazio, embora existam notebooks |
| A3 | as facetas não batem com os resultados | o filtro diz 12 e a lista mostra 9 |
| A4 | a página do produto não mostra os atributos próprios da categoria | notebook sem RAM, livro sem autor |
| A5 | preço ou estoque da oferta vem do documento (desatualizado) e não do PostgreSQL | compra feita e o estoque na tela não muda |
| A6 | a avaliação enviada não aparece ou não move a média | avaliou e nada aconteceu |
| A7 | avaliação inválida (nota fora de 1–5) é aceita | média corrompida |
| A8 | a segunda visita não vem do cache, ou a avaliação nova não invalida o cache | página sempre lenta, ou avaliação "some" por 5 minutos |

## B. Carrinho (Redis · Fase 3)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| B1 | o carrinho não sobrevive a recarregar a página | itens somem no F5 |
| B2 | alterar a quantidade ou remover não reflete | o total não muda |
| B3 | o carrinho de uma sessão aparece em outra | itens de outra pessoa no meu carrinho |
| B4 | finalizar com o carrinho vazio cria pedido | pedido de R$ 0,00 |
| B5 | finalizar não esvazia o carrinho, ou o pedido sai com itens diferentes do carrinho | compra duplicada no próximo clique; item errado |
| B6 | pedir mais do que o estoque é aceito | pedido que não pode ser entregue |
| B7 | a compra não entra no ranking "mais vendidos" | ranking parado |

## C. Pedidos (PostgreSQL · Fase 1)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| C1 | o pedido criado não mostra os itens, o total (soma dos itens) ou o pagamento | pedido com total errado |
| C2 | repetir o envio com a mesma Idempotency-Key cria outro pedido | cobrança em dobro |

## J. Laboratório de Isolamento e Deadlock (Fase 4, tópico 8.4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| J1 | a leitura não repetível não aparece em READ COMMITTED, ou aparece em REPEATABLE READ | a tabela de níveis de isolamento "mente" |
| J2 | o *lost update* passa em REPEATABLE READ (deveria abortar com 40001) | a proteção do nível não é demonstrada |
| J3 | o *write skew* passa em SERIALIZABLE | o nível mais forte parece igual aos outros |
| J4 | o deadlock não é detectado (trava) ou nenhuma transação é abortada | laboratório preso |

## D. Laboratório de Concorrência (Fase 1)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| D1 | a estratégia ingênua deixa de demonstrar o *lost update* | a aula perde o contraexemplo |
| D2 | uma estratégia correta vende além do estoque | o laboratório "prova" uma estratégia errada |

## E. Laboratório de Índices (Fase 2)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| E1 | criar o índice não muda o plano (Seq Scan → uso do índice), ou remover não volta | o experimento não demonstra nada |
| E2 | `CREATE`/`DROP INDEX` do laboratório não aparecem na auditoria de esquema | trilha de DDL incompleta |
| E3 | um ajuste de sessão (work_mem, enable_seqscan…) não chega ao plano | o experimento de tuning não muda nada |
| E4 | a consulta de um mês na auditoria particionada lê todas as partições (pruning quebrado) | particionar não serviu para nada |
| E5 | o plano de execução não vem traduzido em passos simples, nem com a comparação antes × depois do índice | índice continua um mistério |
| E6 | o experimento não diz a pergunta de negócio, o que acontece sem índice e com índice | o aluno roda EXPLAIN sem saber o que procurar |

## H. Laboratório de MVCC e VACUUM (Fase 4, tópico 8.7)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| H1 | um UPDATE em massa não aparece como tuplas mortas, ou o VACUUM não as remove | o MVCC fica invisível |
| H2 | o VACUUM comum devolve espaço ao disco, ou o VACUUM FULL não devolve | a diferença entre os dois some |
| H3 | atualizar a coluna sem índice não gera HOT update com fillfactor folgado | a otimização HOT não é demonstrada |

## P. Laboratório de Particionamento e Expurgo (Fase 4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| P1 | DROP PARTITION não é mais barato que DELETE (tempo e WAL), ou o DELETE não deixa tuplas mortas | a lição do expurgo não aparece |
| P2 | o expurgo apaga um mês que não era o escolhido | dados perdidos |

## N. Laboratório de Conexões e PgBouncer (Fase 4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| N1 | abrir uma conexão nova por requisição não sai mais caro que o pool | o custo da conexão fica invisível |
| N2 | com o PgBouncer, o PostgreSQL ainda vê uma conexão por cliente | o pooler não multiplexa |
| N3 | muitos clientes diretos não esbarram no max_connections | o limite do servidor não é demonstrado |

## R. Laboratório de Cache (Redis · Fase 4)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| R1 | leituras com cache não são mais rápidas que direto no MongoDB, ou não há acertos | o cache-aside não se justifica |

## S. Réplica por streaming (PostgreSQL · Fase 5, tópico 8.10)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| S1 | a réplica não acompanha o primário: o que é gravado no primário nunca chega a ela | relatórios congelados no passado |
| S2 | a réplica aceita escrita (não está em recuperação) | duas "verdades" divergentes |
| S3 | o relatório, lido da réplica, não mostra a compra logo depois do REFRESH (o *read-your-writes* quebra) | "comprei e o relatório não mudou" |
| S4 | o painel não mostra a réplica, o atraso (bytes e tempo), o slot nem o arquivamento do WAL | o DBA não vê o WAL acumulando nem a réplica parada |
| S5 | o Laboratório de Replicação mente: com `remote_apply` a linha não está na réplica logo após o COMMIT, ou com `local`/`off` o COMMIT esperou a réplica | a garantia de cada modo fica errada |
| S6 | a réplica fora do ar faz um COMMIT síncrono esperar para sempre e a loja trava (integração: `internal/laboratorio/aplicacao`) | loja congelada por causa do laboratório |
| S7 | com a réplica parada (desconectada ou presa), o Laboratório de Replicação espera 2 s por transação: 50 transações levam 100 s, o servidor corta a requisição em 60 s e a tela gira e falha sem dizer por quê (integração: `internal/laboratorio/aplicacao`) | "o laboratório não funciona" |
| S8 | o primário é recriado (ex.: `docker compose up --build api`) e a réplica fica presa numa conexão fantasma — o receptor diz `streaming`, mas nada chega e ela nunca se reconecta (verificação manual: recriar o primário e conferir `pg_stat_replication` em até 1 min) | réplica congelada até alguém reiniciá-la |

## T. Backup e PITR (pgBackRest · Fase 5, tópico 8.10)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| T1 | o WAL não é arquivado (`archive_command` falhando) | PITR impossível; o painel precisa acusar |
| T2 | um backup full, diferencial ou incremental não aparece na lista, ou o incremental copia tanto quanto o full | não dá para ver a diferença entre os tipos |
| T3 | o PITR restaura um ponto depois do `DROP` (a tabela continua sumida) ou antes do alvo (perde linhas que existiam) | recuperação errada |
| T4 | a restauração mexe no banco da loja (restaura por cima do primário) | os dados reais somem |

## U. Alta disponibilidade (perfil `ha` · Fase 5, tópico 8.11)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| U1 | depois que o líder do Patroni cai, a escrita pelo HAProxy não volta (não há eleição) | o "failover automático" não acontece |
| U2 | com `synchronous_mode` ligado, uma escrita confirmada some depois do failover | RPO maior que zero onde deveria ser zero |
| U3 | o antigo líder volta como um segundo primário (*split-brain*) em vez de réplica | escritas divergentes |
| U4 | MongoDB: o primário cai e o replica set não elege outro, ou a escrita com `w: "majority"` não retoma | catálogo sem escrita |
| U5 | Redis: o Sentinel não promove a réplica, ou o cliente continua escrevendo no antigo primário | carrinho perde escrita |
| U6 | com o perfil `ha` desligado, o laboratório mostra um erro técnico em vez de dizer como subir os clusters (unidade: `internal/laboratorio/aplicacao`) | o aluno não sabe o que fazer |

## F. Relatórios (Fase 2)

| id | Como quebra | O que o usuário vê |
|---|---|---|
| F1 | o total geral do CUBE não bate com a soma das UFs | relatório contraditório |
| F2 | uma compra nova não aparece depois do REFRESH da materialized view | relatório parado |

## G. Painel do DBA

| id | Como quebra | O que o usuário vê |
|---|---|---|
| G1 | um banco do núcleo aparece fora do ar — desde a Fase 7, Cassandra e Neo4j fazem parte do núcleo e têm de aparecer "up" | alarme falso (ou silêncio) no painel |
| G2 | uma compra não gera trilha na auditoria de dados | auditoria cega |
| G3 | o painel não mostra o estado do Redis (chaves por prefixo, acertos de cache) e do MongoDB (coleções e índices) | sem visão dos bancos NoSQL |
| G4 | o painel não mostra tamanho, tuplas mortas e último autovacuum de cada tabela, nem os índices nunca usados | manutenção às cegas |
| G5 | o painel não mostra o que ocupa o shared_buffers (pg_buffercache) | o cache do PostgreSQL vira caixa-preta |
| G6 | os gráficos de métricas não se movem quando há carga | painel parado |
| G7 | o painel não mostra os pools do PgBouncer | sem visão do pooler |
