import { Link } from 'react-router'
import { Tutorial, type Passo } from './Tutorial'
import { IlustracaoBackups, IlustracaoCache, IlustracaoConexoes, IlustracaoParticoes, IlustracaoQuorum, IlustracaoReplicacao, IlustracaoTopologiaHA, IlustracaoVersoes, LinhaDoTempo } from './Ilustracoes'
import { IlustracaoAnel, IlustracaoGrafoCompras, IlustracaoJoins, IlustracaoParticao } from './IlustracoesFase7'

// Os tutoriais "do zero" dos laboratórios (cenário K4), no mesmo formato do
// de Índices: passos curtos, uma ilustração, uma ligação com o laboratório e
// as fontes de cada afirmação (cenário K3, catálogo em fontes.tsx).

// ======================================================================== Concorrência

const CONCORRENCIA: Passo[] = [
  {
    titulo: '1. Transação',
    corpo: (
      <>
        <p>Uma compra mexe em várias tabelas: cria o pedido, os itens, o pagamento e baixa o estoque. Uma <strong>transação</strong> junta esses comandos num bloco <strong>"tudo ou nada"</strong>: <code>BEGIN</code> abre, <code>COMMIT</code> confirma tudo, <code>ROLLBACK</code> desfaz tudo.</p>
        <p>As quatro garantias são o <strong>ACID</strong>: <em>Atomicidade</em> (tudo ou nada), <em>Consistência</em> (as regras — como <code>CHECK (quantidade &gt;= 0)</code> — valem no fim), <em>Isolamento</em> (transações simultâneas não se atrapalham… até certo ponto) e <em>Durabilidade</em> (confirmado não se perde, nem se o servidor cair).</p>
        <p>Este laboratório é sobre o <strong>I</strong>: o que acontece quando muitas transações disputam a mesma linha.</p>
      </>
    ),
    fontes: ['pg_transacoes', 'pg_wal', 'elmasri_transacoes'],
  },
  {
    titulo: '2. Duas compras ao mesmo tempo',
    corpo: (
      <>
        <p>O código "ingênuo" faz três coisas: <strong>lê</strong> o estoque, <strong>decide</strong> no Go ("tem 1, posso vender") e <strong>grava</strong> o número calculado. Se duas compras leem antes de qualquer uma gravar, as duas decidem "pode":</p>
        <LinhaDoTempo rotulo="Lost update: duas transações leem 1 e as duas gravam 0" colunas={6} faixas={['T1', 'T2', 'estoque']}
          eventos={[
            { faixa: 0, col: 0, texto: 'SELECT\nquantidade → 1' },
            { faixa: 1, col: 1, texto: 'SELECT\nquantidade → 1' },
            { faixa: 0, col: 2, texto: 'Go: 1 ≥ 1\nnovo = 0' },
            { faixa: 1, col: 2, texto: 'Go: 1 ≥ 1\nnovo = 0' },
            { faixa: 0, col: 3, texto: 'UPDATE … = 0\nCOMMIT', tom: 'ok' },
            { faixa: 1, col: 4, texto: 'UPDATE … = 0\nCOMMIT', tom: 'ruim' },
            { faixa: 2, col: 0, texto: '1' },
            { faixa: 2, col: 3, texto: '0 (1 venda)' },
            { faixa: 2, col: 4, texto: '0 (2 vendas!)', tom: 'ruim' },
          ]}
          notas={['A segunda gravação escreveu por cima da primeira: duas vendas, um console.']} />
        <p>Isso é a <strong>atualização perdida</strong> (<em>lost update</em>), uma <strong>condição de corrida</strong>: o resultado depende de quem chegou primeiro em cada passo.</p>
      </>
    ),
    fontes: ['berenson', 'ddia_transacoes', 'pg_rc'],
  },
  {
    titulo: '3. Por que o banco deixou?',
    corpo: (
      <>
        <p>O nível padrão do PostgreSQL é o <strong>READ COMMITTED</strong>: cada comando enxerga o que já estava confirmado quando <em>ele</em> começou. Os dois <code>SELECT</code> viram 1 — e estavam certos naquele instante.</p>
        <p>O <code>UPDATE … SET quantidade = 0</code> grava um <strong>valor absoluto</strong> calculado fora do banco. Quando T2 grava, o banco não sabe que aquele 0 veio de uma leitura velha. E nenhuma regra é violada: 0 ≥ 0 passa no <code>CHECK</code>.</p>
        <p>Moral: o banco protege as <strong>regras que conhece</strong>. "Não vender além do estoque", decidido no código a partir de uma leitura, ele não conhece — é preciso fechar o intervalo entre ler e gravar. Há três jeitos (os próximos passos).</p>
      </>
    ),
    fontes: ['pg_rc', 'pg_update', 'pg_app_consistencia'],
  },
  {
    titulo: '4. Jeito 1: travar a linha',
    corpo: (
      <>
        <p><code>SELECT … FOR UPDATE</code> lê <strong>e trava</strong> a linha até o fim da transação. Quem pedir a mesma trava <strong>espera na fila</strong>. É o <em>lock pessimista</em>: "vou mexer, ninguém mais mexe".</p>
        <LinhaDoTempo rotulo="FOR UPDATE: a segunda transação espera a primeira terminar e lê o valor novo" colunas={6} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'SELECT … FOR\nUPDATE → 1\n(trava a linha)', tom: 'destaque' },
            { faixa: 1, col: 1, texto: 'SELECT … FOR UPDATE\nespera a trava', tom: 'espera', span: 2 },
            { faixa: 0, col: 1, texto: 'UPDATE\nq = q − 1' },
            { faixa: 0, col: 2, texto: 'COMMIT\n(solta a trava)', tom: 'ok' },
            { faixa: 1, col: 3, texto: '→ 0\n(o valor novo)' },
            { faixa: 1, col: 4, texto: 'sem estoque\nROLLBACK', tom: 'ok' },
          ]}
          notas={['Correto, mas a trava dura a transação inteira: com "atraso" alto, a fila aparece no Painel do DBA.']} />
      </>
    ),
    fontes: ['pg_locks_linha', 'pg_for_update', 'ddia_transacoes'],
  },
  {
    titulo: '5. Jeito 2: um comando só',
    corpo: (
      <>
        <p>Em vez de ler e depois gravar, peça ao banco: "tire 1 <strong>se</strong> ainda houver". <code>UPDATE estoque SET quantidade = quantidade − 1 WHERE sku_id = $1 AND quantidade &gt;= 1</code>.</p>
        <LinhaDoTempo rotulo="UPDATE condicional: o segundo UPDATE espera, reavalia o WHERE e não altera nada" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'UPDATE … − 1\nWHERE q >= 1\n→ 1 linha', tom: 'ok' },
            { faixa: 1, col: 1, texto: 'UPDATE … − 1\nWHERE q >= 1\nespera…', tom: 'espera' },
            { faixa: 0, col: 2, texto: 'COMMIT', tom: 'ok' },
            { faixa: 1, col: 3, texto: 'reavalia: q = 0\n→ 0 linhas', tom: 'ok' },
            { faixa: 1, col: 4, texto: 'sem estoque' },
          ]}
          notas={['Em READ COMMITTED, o UPDATE que esperou relê a versão nova da linha e testa o WHERE de novo.']} />
        <p>A trava dura só aquele comando — por isso é o jeito mais rápido, e o que o checkout da loja usa. "0 linhas afetadas" quer dizer "não havia estoque".</p>
      </>
    ),
    fontes: ['pg_rc', 'pg_update', 'pg_locks_linha'],
  },
  {
    titulo: '6. Jeito 3: o banco detecta',
    corpo: (
      <>
        <p>Com <code>BEGIN ISOLATION LEVEL SERIALIZABLE</code>, ninguém espera para ler. Quando T2 tenta alterar a linha que T1 já alterou e confirmou, o PostgreSQL <strong>aborta T2</strong> com o erro <code>40001</code> (<em>serialization_failure</em>).</p>
        <LinhaDoTempo rotulo="SERIALIZABLE: o banco aborta a segunda transação e a aplicação repete" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'BEGIN SERIALIZABLE\nSELECT → 1' },
            { faixa: 1, col: 1, texto: 'BEGIN SERIALIZABLE\nSELECT → 1' },
            { faixa: 0, col: 2, texto: 'UPDATE = 0\nCOMMIT', tom: 'ok' },
            { faixa: 1, col: 3, texto: 'UPDATE = 0\n✕ 40001', tom: 'ruim' },
            { faixa: 1, col: 4, texto: 'repete do zero:\nSELECT → 0\nsem estoque', tom: 'ok' },
          ]}
          notas={['O código é o MESMO da ingênua: quem corrige é o banco. Mas a aplicação PRECISA repetir a transação abortada.']} />
        <p>A API repete até 5 vezes. Com muita disputa, algumas compras esgotam as tentativas e recebem erro — ninguém compra a mais, mas há trabalho jogado fora.</p>
      </>
    ),
    fontes: ['pg_ser', 'pg_rr', 'pg_erros', 'ssi_artigo'],
  },
  {
    titulo: '7. Várias linhas: deadlock',
    corpo: (
      <>
        <p>Um carrinho com vários itens trava várias linhas de estoque. Se T1 trava A e depois B, e T2 trava B e depois A, cada uma fica esperando a outra para sempre: um <strong>deadlock</strong>.</p>
        <LinhaDoTempo rotulo="Deadlock: cada transação espera a trava que a outra segura" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'trava SKU A' },
            { faixa: 1, col: 0, texto: 'trava SKU B' },
            { faixa: 0, col: 1, texto: 'quer SKU B\nespera por T2', tom: 'espera', span: 2 },
            { faixa: 1, col: 1, texto: 'quer SKU A\nespera por T1', tom: 'espera', span: 2 },
            { faixa: 1, col: 3, texto: '✕ 40P01\nvítima', tom: 'ruim' },
            { faixa: 0, col: 3, texto: 'pega B\nCOMMIT', tom: 'ok' },
          ]}
          notas={['Depois de deadlock_timeout (1 s), o PostgreSQL procura ciclos de espera e aborta uma das transações.']} />
        <p>A prevenção é travar <strong>sempre na mesma ordem</strong>: o checkout ordena os itens por SKU antes de baixar o estoque. O Laboratório de Isolamento provoca um deadlock de propósito.</p>
      </>
    ),
    fontes: ['pg_deadlocks', 'pg_deadlock_timeout', 'pg_erros'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Rode a <strong>ingênua</strong> com 50 compradores e estoque 5: conte as vendas a mais.</li>
        <li>Aumente o <strong>atraso</strong>: o intervalo entre ler e gravar cresce e o erro piora.</li>
        <li>Rode as três estratégias corretas com os mesmos números e compare <strong>duração</strong> e <strong>retentativas</strong>.</li>
        <li>Com atraso de 500 ms e FOR UPDATE, abra o <Link to="/dba?aba=postgres">Painel do DBA</Link> e veja a fila de locks.</li>
        <li>Leia a conclusão e responda as perguntas do fim da página.</li>
      </ol>
    ),
    fontes: ['hermitage', 'ddia_transacoes'],
  },
]

export function TutorialConcorrencia() {
  return <Tutorial titulo="Concorrência do zero" passos={CONCORRENCIA} />
}

// ======================================================================== Isolamento

const ISOLAMENTO: Passo[] = [
  {
    titulo: '1. O que é isolamento',
    corpo: (
      <>
        <p>O ideal seria cada transação rodar <strong>como se estivesse sozinha</strong>, uma depois da outra, em fila. Isso se chama <strong>serializável</strong>. Mas fila é lenta: os bancos deixam transações rodarem ao mesmo tempo e oferecem <strong>níveis de isolamento</strong> — quanto mais baixo, mais rápido e mais "surpresas" possíveis.</p>
        <p>Essas surpresas têm nome: as <strong>anomalias</strong>. Cada nível é definido pelas anomalias que ele impede.</p>
      </>
    ),
    fontes: ['pg_isolamento', 'elmasri_transacoes', 'berenson'],
  },
  {
    titulo: '2. A fotografia (snapshot)',
    corpo: (
      <>
        <p>O PostgreSQL usa <strong>MVCC</strong>: cada linha pode ter várias versões, e cada transação lê as versões da sua <strong>fotografia</strong> do banco — o que estava confirmado num certo instante. Ler nunca bloqueia escrever, e vice-versa.</p>
        <p>A diferença entre os níveis é <strong>quando</strong> a fotografia é tirada:</p>
        <LinhaDoTempo rotulo="Snapshot: em READ COMMITTED cada comando tem fotografia nova; em REPEATABLE READ a transação inteira usa a primeira" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'BEGIN\nSELECT saldo\n→ 100' },
            { faixa: 1, col: 1, texto: 'UPDATE saldo\n= 200\nCOMMIT', tom: 'ok' },
            { faixa: 0, col: 2, texto: 'SELECT saldo\nRC → 200\nRR → 100', tom: 'destaque', span: 2 },
            { faixa: 0, col: 4, texto: 'COMMIT' },
          ]}
          notas={['READ COMMITTED: fotografia nova a cada COMANDO (vê o 200).', 'REPEATABLE READ e SERIALIZABLE: uma fotografia para a TRANSAÇÃO, tirada no primeiro comando (continua vendo 100).']} />
      </>
    ),
    fontes: ['pg_mvcc', 'pg_rc', 'pg_rr', 'interdb_concorrencia'],
  },
  {
    titulo: '3. As anomalias',
    corpo: (
      <dl>
        <dt>Leitura suja</dt><dd>ler o que outra transação alterou e <em>ainda não confirmou</em>. Se ela desistir, você usou um valor que nunca existiu.</dd>
        <dt>Leitura não repetível</dt><dd>ler a mesma linha duas vezes e ver valores diferentes (outra transação alterou e confirmou no meio).</dd>
        <dt>Fantasma</dt><dd>repetir uma consulta com filtro e aparecer (ou sumir) uma linha que outra transação inseriu (ou apagou).</dd>
        <dt>Atualização perdida</dt><dd>duas transações leem, calculam e gravam a mesma linha; a segunda apaga o efeito da primeira.</dd>
        <dt>Write skew</dt><dd>cada uma lê um conjunto, decide e altera uma linha <em>diferente</em>; juntas quebram uma regra que nenhuma quebraria sozinha.</dd>
      </dl>
    ),
    fontes: ['berenson', 'pg_isolamento', 'ddia_transacoes'],
  },
  {
    titulo: '4. O padrão × o PostgreSQL',
    corpo: (
      <>
        <p>O padrão SQL define quatro níveis pelo que cada um <strong>proíbe</strong>. O PostgreSQL é mais estrito que o mínimo exigido:</p>
        <ul>
          <li><strong>READ UNCOMMITTED</strong> é aceito, mas se comporta como READ COMMITTED: leitura suja <strong>nunca</strong> acontece.</li>
          <li><strong>READ COMMITTED</strong> (padrão): impede leitura suja.</li>
          <li><strong>REPEATABLE READ</strong>: com a fotografia da transação, impede também leitura não repetível <strong>e fantasmas</strong> (o padrão permitiria fantasmas).</li>
          <li><strong>SERIALIZABLE</strong>: impede tudo, inclusive write skew.</li>
        </ul>
        <p>Cuidado na prova: a pergunta pode ser sobre o <em>padrão</em> ou sobre um <em>banco</em>. A tabela no fim da página mostra o comportamento do PostgreSQL; o projeto Hermitage compara vários bancos.</p>
      </>
    ),
    fontes: ['pg_isolamento', 'berenson', 'hermitage'],
  },
  {
    titulo: '5. Esperar ou abortar',
    corpo: (
      <>
        <p>Ler não trava, mas <strong>duas escritas na mesma linha</strong> sempre fazem a segunda esperar a primeira terminar. O que acontece depois depende do nível:</p>
        <ul>
          <li><strong>READ COMMITTED</strong>: a segunda relê a versão nova e segue (por isso o "UPDATE condicional" funciona).</li>
          <li><strong>REPEATABLE READ / SERIALIZABLE</strong>: se a primeira confirmou, a segunda é <strong>abortada</strong> com <code>40001</code> — a fotografia dela ficou velha.</li>
        </ul>
        <p>Abortar não é bug: a aplicação deve <strong>repetir a transação inteira</strong>. Nível alto sem retentativa vira erro para o usuário.</p>
      </>
    ),
    fontes: ['pg_rc', 'pg_rr', 'pg_erros'],
  },
  {
    titulo: '6. Write skew e o SERIALIZABLE',
    corpo: (
      <>
        <p>Regra do hospital: <strong>ao menos um médico de plantão</strong>. Ana e Bruno estão; cada um pede para sair ao mesmo tempo:</p>
        <LinhaDoTempo rotulo="Write skew: cada transação lê dois de plantão e tira um médico diferente" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'SELECT count(*)\nde plantão → 2' },
            { faixa: 1, col: 1, texto: 'SELECT count(*)\nde plantão → 2' },
            { faixa: 0, col: 2, texto: 'Ana sai\nCOMMIT', tom: 'ok' },
            { faixa: 1, col: 3, texto: 'Bruno sai\nCOMMIT', tom: 'ruim' },
            { faixa: 1, col: 4, texto: 'SERIALIZABLE:\naqui dá 40001', tom: 'destaque' },
          ]}
          notas={['Linhas diferentes: nenhum lock conflita e ninguém sobrescreve ninguém. Em REPEATABLE READ, ninguém fica de plantão.']} />
        <p>O SERIALIZABLE do PostgreSQL (<strong>SSI</strong>) acompanha <em>quem leu o quê</em>. Quando percebe que cada uma leu algo que a outra mudou (um ciclo que nenhuma ordem em fila explicaria), aborta uma com <code>40001</code>.</p>
      </>
    ),
    fontes: ['pg_ser', 'ssi_artigo', 'pg_app_consistencia', 'ddia_transacoes'],
  },
  {
    titulo: '7. Deadlock',
    corpo: (
      <>
        <p>Deadlock não é anomalia de isolamento: é um <strong>ciclo de espera</strong> por travas, e acontece em qualquer nível.</p>
        <LinhaDoTempo rotulo="Deadlock: T1 tem A e quer B, T2 tem B e quer A" colunas={5} faixas={['T1', 'T2']}
          eventos={[
            { faixa: 0, col: 0, texto: 'UPDATE conta A\n(trava A)' },
            { faixa: 1, col: 0, texto: 'UPDATE conta B\n(trava B)' },
            { faixa: 0, col: 1, texto: 'UPDATE conta B\nespera por T2', tom: 'espera', span: 2 },
            { faixa: 1, col: 1, texto: 'UPDATE conta A\nespera por T1', tom: 'espera', span: 2 },
            { faixa: 1, col: 3, texto: '✕ 40P01\nvítima', tom: 'ruim' },
            { faixa: 0, col: 3, texto: 'pega B\nCOMMIT', tom: 'ok' },
          ]}
          notas={['Quem espera mais que deadlock_timeout (1 s) dispara a busca por ciclos; o PostgreSQL aborta uma transação.']} />
        <p>Prevenção: travar os recursos sempre na <strong>mesma ordem</strong>.</p>
      </>
    ),
    fontes: ['pg_deadlocks', 'pg_deadlock_timeout', 'pg_erros'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Escolha uma <strong>situação</strong> e leia o "Sobre esta opção".</li>
        <li>Rode em <strong>READ COMMITTED</strong> e veja a anomalia acontecer (ou não).</li>
        <li>Suba o nível e rode de novo: a anomalia some, ou uma transação é abortada (<code>40001</code>)?</li>
        <li>Passos em amarelo esperaram uma trava da outra transação — repare quanto tempo.</li>
        <li>Confira o resultado na tabela "que cai em prova".</li>
      </ol>
    ),
    fontes: ['hermitage', 'pg_isolamento'],
  },
]

export function TutorialIsolamento() {
  return <Tutorial titulo="Isolamento do zero" passos={ISOLAMENTO} />
}

// ======================================================================== MVCC

const MVCC: Passo[] = [
  {
    titulo: '1. Páginas e tuplas',
    corpo: (
      <>
        <p>No disco, uma tabela é um arquivo dividido em <strong>páginas de 8 KB</strong>. Cada página guarda várias <strong>tuplas</strong> (as linhas) e um pouco de espaço livre.</p>
        <p>Toda tupla tem um endereço físico, o <code>ctid</code> = <strong>(página, posição)</strong>, e colunas ocultas que você pode consultar: <code>xmin</code> (a transação que <em>criou</em> esta versão) e <code>xmax</code> (a que a <em>apagou</em> ou substituiu; 0 = ninguém).</p>
        <pre className="sql">SELECT ctid, xmin, xmax, * FROM lab.inchaco LIMIT 3;</pre>
      </>
    ),
    fontes: ['pg_pagina', 'pg_colunas_sistema', 'interdb_concorrencia'],
  },
  {
    titulo: '2. UPDATE grava uma versão nova',
    corpo: (
      <>
        <p>O PostgreSQL <strong>nunca sobrescreve</strong> uma linha no lugar. Um UPDATE grava uma <strong>versão nova</strong> e marca a antiga com <code>xmax</code>; um DELETE só marca. Isso é o <strong>MVCC</strong> (controle de concorrência com múltiplas versões).</p>
        <IlustracaoVersoes modo="versoes" />
      </>
    ),
    fontes: ['pg_mvcc', 'pg_colunas_sistema', 'interdb_concorrencia'],
  },
  {
    titulo: '3. Quem enxerga o quê',
    corpo: (
      <>
        <p>Cada transação tem uma <strong>fotografia</strong> (snapshot): a lista de transações já confirmadas quando ela começou. Uma versão é visível se foi criada por uma transação da fotografia (<code>xmin</code> confirmado) e ainda não foi apagada por outra da fotografia (<code>xmax</code>).</p>
        <p>Por isso <strong>leitor não espera escritor</strong>: quem começou antes continua lendo a versão antiga. O preço são as <strong>tuplas mortas</strong> — versões que ninguém mais consegue enxergar, mas que ainda ocupam espaço na página.</p>
      </>
    ),
    fontes: ['pg_mvcc', 'interdb_concorrencia', 'pg_vacuum_rotina'],
  },
  {
    titulo: '4. HOT e fillfactor',
    corpo: (
      <>
        <p>Se o UPDATE <strong>não muda coluna indexada</strong> e há <strong>espaço livre na mesma página</strong>, a versão nova fica ao lado e o índice nem é tocado: é o <strong>HOT</strong> (<em>heap-only tuple</em>).</p>
        <IlustracaoVersoes modo="hot" />
        <p>Se muda coluna indexada (ou a página está cheia), cada índice ganha uma entrada nova:</p>
        <IlustracaoVersoes modo="sem-hot" />
        <p>O <code>fillfactor</code> (padrão 100%) diz até quanto o INSERT enche cada página. Com 70%, sobram 30% para as versões dos UPDATEs. A tabela <code>estoque</code> da loja usa 80 por isso.</p>
      </>
    ),
    fontes: ['pg_hot', 'pg_fillfactor', 'interdb_hot'],
  },
  {
    titulo: '5. VACUUM',
    corpo: (
      <>
        <p>O <strong>VACUUM</strong> percorre a tabela e remove as tuplas mortas que nenhuma transação aberta ainda pode ver. O espaço vira <strong>livre para reutilizar</strong> dentro das páginas. Ele também atualiza o <em>visibility map</em> (que permite o <em>index-only scan</em>) e "congela" transações antigas.</p>
        <p>Roda <strong>junto com</strong> leituras e escritas, sem travá-las. Mas o arquivo <strong>não encolhe</strong> (só páginas vazias no fim podem ser cortadas): o espaço fica para os próximos INSERTs e UPDATEs.</p>
      </>
    ),
    fontes: ['pg_vacuum_rotina', 'pg_vacuum_cmd', 'pg_pgstattuple', 'interdb_vacuum'],
  },
  {
    titulo: '6. VACUUM FULL',
    corpo: (
      <>
        <p>O <strong>VACUUM FULL</strong> copia só as tuplas vivas para um arquivo novo e apaga o antigo: <strong>devolve o espaço ao disco</strong>. Em troca, segura um lock <strong>exclusivo</strong> — nem leitura nem escrita — enquanto copia, e gera muito WAL.</p>
        <p>Em produção, para tabelas grandes, usa-se a extensão <strong>pg_repack</strong>, que reconstrói a tabela sem segurar o lock exclusivo durante a cópia.</p>
      </>
    ),
    fontes: ['pg_vacuum_cmd', 'pg_vacuum_rotina', 'pg_repack'],
  },
  {
    titulo: '7. O horizonte',
    corpo: (
      <>
        <p>O VACUUM só remove o que <strong>nenhuma</strong> transação aberta pode enxergar. Uma única sessão esquecida com a fotografia antiga segura o "horizonte" de todo o banco:</p>
        <LinhaDoTempo rotulo="Horizonte do VACUUM: uma transação aberta impede a remoção das versões mortas" colunas={6} faixas={['esquecida', 'UPDATE', 'VACUUM']}
          eventos={[
            { faixa: 0, col: 0, texto: 'BEGIN + SELECT\nem REPEATABLE\nREAD (foto)', tom: 'espera' },
            { faixa: 0, col: 1, texto: '… aberta, parada …', tom: 'espera', span: 3 },
            { faixa: 1, col: 1, texto: 'UPDATE 2.000\nlinhas → 2.000\nmortas' },
            { faixa: 2, col: 2, texto: 'VACUUM:\nnão pode remover\n(ela ainda vê)', tom: 'ruim' },
            { faixa: 0, col: 4, texto: 'COMMIT', tom: 'ok' },
            { faixa: 2, col: 5, texto: 'VACUUM:\nremove as\n2.000', tom: 'ok' },
          ]}
          notas={['Ache a culpada em pg_stat_activity (backend_xmin mais antigo). Proteção: idle_in_transaction_session_timeout.']} />
      </>
    ),
    fontes: ['pg_vacuum_rotina', 'pg_idle_tx', 'pg_mvcc'],
  },
  {
    titulo: '8. Autovacuum e WAL',
    corpo: (
      <>
        <p>Em produção ninguém roda VACUUM à mão: o <strong>autovacuum</strong> dispara sozinho quando as tuplas mortas passam de <code>autovacuum_vacuum_threshold</code> + <code>autovacuum_vacuum_scale_factor</code> × linhas. Com os padrões (50 + 20%), numa tabela de 20 mil linhas: 50 + 4.000 = <strong>4.050 mortas</strong>. Na <code>lab.inchaco</code> ele está <strong>desligado</strong>, para você ver o efeito.</p>
        <p>Toda alteração também é escrita antes no <strong>WAL</strong> (o diário do banco, base da durabilidade e da réplica). Por isso o laboratório mede o WAL: HOT gera menos (não mexe nos índices) e VACUUM FULL gera muito (reescreve tudo).</p>
      </>
    ),
    fontes: ['pg_autovacuum', 'pg_autovacuum_cfg', 'pg_wal', 'interdb_wal'],
  },
  {
    titulo: '9. Como usar o laboratório',
    corpo: (
      <ol>
        <li><strong>Recriar com fillfactor 100</strong> e rode <strong>UPDATE coluna sem índice</strong>: quantos HOT? A tabela cresceu?</li>
        <li><strong>Recriar com fillfactor 70</strong> e repita: compare HOT, tamanho e WAL.</li>
        <li>Rode <strong>UPDATE coluna indexada</strong>: o HOT some mesmo com espaço livre. Por quê?</li>
        <li><strong>VACUUM</strong>: mortas → 0, tamanho igual. <strong>VACUUM FULL</strong>: tamanho volta ao compacto.</li>
        <li>Abra um <code>BEGIN; SELECT 1;</code> num <code>psql</code> e deixe aberto: o VACUUM para de limpar e o laboratório mostra quem segura o horizonte.</li>
      </ol>
    ),
    fontes: ['pg_pgstattuple', 'pg_hot', 'pg_vacuum_rotina'],
  },
]

export function TutorialMvcc() {
  return <Tutorial titulo="MVCC e VACUUM do zero" passos={MVCC} />
}

// ======================================================================== Expurgo / particionamento

const EXPURGO: Passo[] = [
  {
    titulo: '1. Tabelas que só crescem',
    corpo: (
      <>
        <p>Auditoria, logs, eventos, leituras de sensor: tabelas em que se <strong>insere sempre e quase nunca se altera</strong>. Crescem para sempre — a menos que exista uma <strong>política de retenção</strong> ("guardar 12 meses").</p>
        <p>Retenção não é só economia de disco: a LGPD manda eliminar dados pessoais quando o tratamento termina. O problema é <strong>como</strong> apagar milhões de linhas antigas sem atrapalhar a loja.</p>
      </>
    ),
    fontes: ['lgpd', 'pg_particionamento'],
  },
  {
    titulo: '2. Partições',
    corpo: (
      <>
        <p>Uma tabela <strong>particionada</strong> é dividida em tabelas menores — as <strong>partições</strong> —, cada uma com uma faixa de valores da <strong>chave de partição</strong>. Aqui: uma partição por mês da coluna <code>em</code> (quando a operação aconteceu) (<code>PARTITION BY RANGE</code>).</p>
        <IlustracaoParticoes modo="estrutura" />
        <p>Detalhes que caem em prova: a chave primária precisa <strong>conter a chave de partição</strong> (aqui, <code>(id, em)</code>); os tipos são <strong>RANGE</strong>, <strong>LIST</strong> e <strong>HASH</strong>.</p>
      </>
    ),
    fontes: ['pg_particionamento'],
  },
  {
    titulo: '3. Partition pruning',
    corpo: (
      <>
        <p>Com um filtro na chave de partição, o planejador <strong>descarta</strong> as partições que não podem ter a resposta: lê 1 mês em vez de 18.</p>
        <IlustracaoParticoes modo="pruning" />
        <p>Armadilha: <code>WHERE date_trunc('month', em) = …</code> esconde a coluna dentro de uma função e o planejador não consegue comparar com as faixas — lê todas. Os experimentos 8 e 9 do <Link to="/indices">Laboratório de Índices</Link> mostram os dois casos.</p>
      </>
    ),
    fontes: ['pg_pruning', 'pg_explain'],
  },
  {
    titulo: '4. Apagar com DELETE',
    corpo: (
      <>
        <p>Sem partições, apagar um mês é <code>DELETE … WHERE em &lt; …</code>. Pelo MVCC, cada linha ganha <code>xmax</code> e vira tupla morta; cada alteração vai para o <strong>WAL</strong> (e para as réplicas).</p>
        <IlustracaoParticoes modo="delete" />
        <p>O custo cresce com o <strong>número de linhas</strong>, a transação fica longa (segurando o horizonte do VACUUM) e o espaço só é recuperado depois do VACUUM.</p>
      </>
    ),
    fontes: ['pg_vacuum_rotina', 'pg_wal', 'pg_mvcc'],
  },
  {
    titulo: '5. Apagar com DROP',
    corpo: (
      <>
        <p>Com partições, apagar um mês é <strong>remover a partição</strong>: <code>ALTER TABLE … DETACH PARTITION</code> a transforma numa tabela comum e <code>DROP TABLE</code> apaga o arquivo.</p>
        <IlustracaoParticoes modo="drop" />
        <p>O custo <strong>não depende do número de linhas</strong>: é uma mudança no catálogo e um arquivo apagado. É o que a procedure <code>auditoria.expurgar()</code> faz.</p>
      </>
    ),
    fontes: ['pg_particionamento', 'pg_alter_table'],
  },
  {
    titulo: '6. Partições do futuro e a DEFAULT',
    corpo: (
      <>
        <p>Uma linha cuja data não cabe em nenhuma partição cai na <strong>DEFAULT</strong> (<code>log_padrao</code>) — sem ela, o INSERT daria erro. Mas a DEFAULT deve ficar <strong>vazia</strong>: criar depois a partição de um mês que já tem linhas na DEFAULT falha.</p>
        <p>Por isso a API, ao subir, chama <code>CALL auditoria.garantir_particoes(1, 3)</code>: cria o mês passado, o atual e os 3 próximos. Em produção, a extensão <strong>pg_partman</strong> automatiza criação e retenção.</p>
      </>
    ),
    fontes: ['pg_particionamento', 'pg_partman'],
  },
  {
    titulo: '7. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Escolha <strong>quantas linhas</strong> o mês de teste (18 meses atrás) terá; o laboratório o gera de novo a cada expurgo.</li>
        <li>Expurgue com <strong>DELETE</strong>: anote tempo, WAL e tuplas mortas.</li>
        <li>Expurgue com <strong>DROP PARTITION</strong> e compare no gráfico.</li>
        <li>Aumente as linhas e repita: o DELETE cresce junto; o DROP não. O que aconteceria com 30 milhões de linhas?</li>
      </ol>
    ),
    fontes: ['pg_particionamento', 'pg_wal'],
  },
]

export function TutorialExpurgo() {
  return <Tutorial titulo="Particionamento do zero" passos={EXPURGO} />
}

// ======================================================================== Conexões

const CONEXOES: Passo[] = [
  {
    titulo: '1. Uma conexão = um processo',
    corpo: (
      <>
        <p>O PostgreSQL usa o modelo <strong>um processo por conexão</strong>: o processo principal (<em>postmaster</em>) cria um processo novo (<em>backend</em>) para cada cliente que conecta, e ele vive até o cliente desconectar.</p>
        <IlustracaoConexoes modo="direto" />
        <p>Processo tem memória própria e o banco precisa considerar todas as conexões ao montar cada fotografia (snapshot): muitas conexões custam caro mesmo paradas.</p>
      </>
    ),
    fontes: ['pg_conexao', 'freund_conexoes'],
  },
  {
    titulo: '2. O custo de conectar',
    corpo: (
      <>
        <p>Abrir uma conexão: conexão TCP, criar o processo, <strong>autenticar</strong> (SCRAM-SHA-256: troca de mensagens e milhares de rodadas de hash, de propósito, para dificultar ataque de força bruta) e carregar o catálogo.</p>
        <p>Um <code>SELECT</code> por chave primária leva bem menos de 1 ms. Abrir a conexão para ele pode custar dezenas de vezes mais. Aplicação que conecta a cada requisição passa a maior parte do tempo conectando.</p>
      </>
    ),
    fontes: ['pg_scram', 'pg_conexao', 'pg_pgbench'],
  },
  {
    titulo: '3. O limite: max_connections',
    corpo: (
      <>
        <p><code>max_connections</code> (padrão 100; aqui também 100) é o número máximo de conexões simultâneas. Acima dele, o servidor recusa com <code>53300 too_many_connections</code>. Mudar exige <strong>reiniciar</strong> o servidor.</p>
        <p>Aumentar o limite não resolve: mais processos disputando CPU e memória deixam todo mundo mais lento. A saída é fazer <strong>muitos clientes dividirem poucas conexões</strong>.</p>
      </>
    ),
    fontes: ['pg_max_conexoes', 'pg_erros', 'freund_conexoes'],
  },
  {
    titulo: '4. Pool dentro da aplicação',
    corpo: (
      <>
        <p>Um <strong>pool</strong> abre algumas conexões uma vez e as <strong>empresta</strong>: a consulta pega uma livre, usa e devolve. A API da loja faz isso com o <code>pgxpool</code> (no laboratório, 10 conexões).</p>
        <IlustracaoConexoes modo="pool" />
        <p>Limite: o pool é <strong>de cada processo</strong> da aplicação. Com 50 réplicas da API × 10 conexões, são 500 conexões — acima do <code>max_connections</code>.</p>
      </>
    ),
    fontes: ['pgxpool', 'freund_conexoes'],
  },
  {
    titulo: '5. PgBouncer',
    corpo: (
      <>
        <p>O <strong>PgBouncer</strong> é um pool <strong>fora</strong> da aplicação, que fala o protocolo do PostgreSQL. Os clientes conectam nele (barato: sem processo novo no banco) e ele mantém poucas conexões reais — aqui <code>default_pool_size = 20</code>.</p>
        <IlustracaoConexoes modo="pgbouncer" />
        <p>Ele <strong>não</strong> torna a conexão mais rápida que um pool na aplicação; ele deixa <strong>muitos</strong> clientes (de muitas aplicações) dividirem poucas conexões.</p>
      </>
    ),
    fontes: ['pgbouncer_uso', 'pgbouncer_config'],
  },
  {
    titulo: '6. Os modos de pool',
    corpo: (
      <>
        <dl>
          <dt>session</dt><dd>a conexão real fica com o cliente até ele desconectar. Tudo funciona, mas reaproveita pouco.</dd>
          <dt>transaction</dt><dd>a conexão real volta ao pool <strong>ao fim de cada transação</strong>. É o modo do projeto.</dd>
          <dt>statement</dt><dd>volta a cada comando: transação com vários comandos não funciona.</dd>
        </dl>
        <p>No modo <strong>transaction</strong>, a próxima transação do mesmo cliente pode cair em outra conexão real. Por isso não funcionam: <code>SET</code> de sessão, <code>LISTEN</code>, cursores <code>WITH HOLD</code>, <code>PREPARE</code> em SQL e advisory locks de sessão. (Prepared statements no nível do protocolo funcionam com <code>max_prepared_statements</code>.)</p>
      </>
    ),
    fontes: ['pgbouncer_uso', 'pgbouncer_recursos', 'pgbouncer_config'],
  },
  {
    titulo: '7. Como medir',
    corpo: (
      <>
        <p>Média engana. O laboratório mostra a <strong>mediana (p50)</strong> — a requisição típica — e o <strong>p95</strong> — 95% das requisições foram mais rápidas que isso; mostra a cauda lenta que o usuário sente.</p>
        <p>Também conta o <strong>pico de processos</strong> que o PostgreSQL viu (pelo <code>pg_stat_activity</code>) e as <strong>recusas</strong> <code>53300</code>. O <code>make pgbench</code> faz a mesma comparação com o <code>pgbench -C</code> (conexão nova a cada transação).</p>
      </>
    ),
    fontes: ['pg_pgbench', 'pg_erros'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Rode os três modos com <strong>20 clientes</strong>: compare consultas/s e p50.</li>
        <li>Suba para <strong>120 clientes</strong>: o modo direto passa de <code>max_connections</code> e recebe recusas.</li>
        <li>Compare o <strong>pico de processos</strong>: direto ≈ clientes; PgBouncer ≤ 20; pool = 10.</li>
        <li>Veja o estado do PgBouncer (<code>SHOW POOLS</code>) no fim da página.</li>
      </ol>
    ),
    fontes: ['pgbouncer_uso', 'pg_pgbench'],
  },
]

export function TutorialConexoes() {
  return <Tutorial titulo="Conexões do zero" passos={CONEXOES} />
}

// ======================================================================== Cache

const CACHE: Passo[] = [
  {
    titulo: '1. Por que cache',
    corpo: (
      <>
        <p>Ler da <strong>memória</strong> custa nanossegundos; uma ida e volta pela <strong>rede</strong> até um banco, frações de milissegundo; ler do <strong>disco</strong>, ainda mais. Se o mesmo dado é lido muitas vezes e muda pouco, vale guardar uma <strong>cópia num lugar mais rápido</strong>: um cache.</p>
        <p>Aqui a cópia é do <strong>documento do produto</strong> (que mora no MongoDB) na memória do <strong>Redis</strong>.</p>
      </>
    ),
    fontes: ['latencias', 'aws_cache'],
  },
  {
    titulo: '2. Redis em 1 minuto',
    corpo: (
      <>
        <p>O Redis guarda tudo <strong>em memória</strong>, como <strong>chave → valor</strong>, e executa os comandos um de cada vez (cada comando é atômico). O valor pode ser de vários tipos — e cada tipo serve a um uso deste projeto:</p>
        <dl>
          <dt>String</dt><dd><code>cache:produto:{'{id}'}</code> — o JSON do produto (este laboratório).</dd>
          <dt>Hash</dt><dd><code>carrinho:{'{sessão}'}</code> — SKU → quantidade.</dd>
          <dt>Sorted set</dt><dd><code>ranking:mais_vendidos</code> — placar por pontuação.</dd>
          <dt>Stream</dt><dd><code>stream:pedidos</code> — fila de eventos.</dd>
          <dt>String + INCR</dt><dd><code>rl:…</code> — contador do limite de requisições.</dd>
        </dl>
      </>
    ),
    fontes: ['redis_strings', 'redis_hashes', 'redis_sorted_sets', 'redis_streams', 'redis_incr'],
  },
  {
    titulo: '3. Cache-aside: a falha',
    corpo: (
      <>
        <p>No <strong>cache-aside</strong> ("cache ao lado") a aplicação cuida de tudo; o Redis e o MongoDB não sabem um do outro. Na primeira leitura não há cópia — é uma <strong>falha</strong> (<em>miss</em>):</p>
        <IlustracaoCache caminho="falha" />
      </>
    ),
    fontes: ['aws_cache', 'redis_strings', 'mongo_findone'],
  },
  {
    titulo: '4. O acerto',
    corpo: (
      <>
        <p>Nas leituras seguintes, a cópia está lá: é um <strong>acerto</strong> (<em>hit</em>). O MongoDB nem é consultado.</p>
        <IlustracaoCache caminho="acerto" />
        <p>A <strong>taxa de acerto</strong> (acertos ÷ leituras) é o número que importa: um cache com poucos acertos só acrescenta uma ida ao Redis.</p>
      </>
    ),
    fontes: ['aws_cache'],
  },
  {
    titulo: '5. TTL e invalidação',
    corpo: (
      <>
        <p>A cópia pode ficar <strong>velha</strong>. Há duas defesas, e o projeto usa as duas:</p>
        <ul>
          <li><strong>TTL</strong>: <code>SET … EX 300</code> — a chave some sozinha em 5 minutos. É o limite de quanto tempo uma cópia velha pode durar.</li>
          <li><strong>Invalidação</strong>: quando o produto muda (entra uma avaliação), a API apaga a chave (<code>DEL</code>). Apagar é mais seguro que atualizar: a próxima leitura repõe a versão nova.</li>
        </ul>
        <IlustracaoCache caminho="invalidacao" />
      </>
    ),
    fontes: ['redis_expire', 'aws_cache', 'memcache_fb'],
  },
  {
    titulo: '6. Quando a memória acaba',
    corpo: (
      <>
        <p>O Redis do projeto tem <code>maxmemory 256mb</code>. Ao chegar no limite, a <strong>política de despejo</strong> (<em>eviction</em>) decide o que sai. Aqui é <code>allkeys-lru</code>: sai a chave usada há mais tempo, de qualquer tipo.</p>
        <p>Outras políticas: <code>noeviction</code> (recusa escritas), <code>allkeys-lfu</code> (sai a menos usada), <code>volatile-*</code> (só entre chaves com TTL), <code>volatile-ttl</code> (a que expira antes). Atenção: com <code>allkeys-*</code>, um carrinho também pode ser despejado — o Redis aqui guarda dados que podem ser perdidos ou reconstruídos.</p>
      </>
    ),
    fontes: ['redis_eviction'],
  },
  {
    titulo: '7. O que NÃO vai para o cache',
    corpo: (
      <>
        <p>Cache troca <strong>consistência</strong> por <strong>velocidade</strong>. Só vale para dado que pode ficar alguns minutos velho sem estrago: descrição, fotos, resumo das avaliações.</p>
        <p><strong>Preço e estoque nunca vão para o cache</strong>: vêm sempre do PostgreSQL. Um preço velho vira cobrança errada; um estoque velho, venda sem produto.</p>
        <p>Em escala há outros problemas: muitas falhas ao mesmo tempo para a mesma chave (<em>thundering herd</em>) e corridas entre invalidar e repor. O artigo do Facebook sobre o memcache é a leitura clássica.</p>
      </>
    ),
    fontes: ['memcache_fb', 'aws_cache'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Rode com <strong>200 leituras</strong>: 1 falha e 199 acertos.</li>
        <li>Compare o <strong>p50</strong> (a leitura típica) e o <strong>p95</strong> (a cauda lenta) com e sem cache.</li>
        <li>Rode com 10 leituras: a falha pesa mais na média. Por quê?</li>
        <li>Veja no Painel do DBA → MongoDB e Redis as chaves <code>cache:produto:*</code> e o TTL delas.</li>
      </ol>
    ),
    fontes: ['aws_cache', 'redis_expire'],
  },
]

export function TutorialCache() {
  return <Tutorial titulo="Cache do zero" passos={CACHE} />
}

// ======================================================================== Replicação (Fase 5)

const REPLICACAO: Passo[] = [
  {
    titulo: '1. Por que replicar',
    corpo: (
      <>
        <p><strong>Replicar</strong> é manter uma cópia do banco em outro servidor, atualizada continuamente. Serve para três coisas:</p>
        <ul>
          <li><strong>escalar leitura</strong>: consultas pesadas (relatórios) vão para a cópia e o primário fica livre para as compras;</li>
          <li><strong>disponibilidade</strong>: se o primário morrer, a cópia pode assumir (o failover, no Laboratório de Failover);</li>
          <li><strong>proximidade</strong>: uma cópia perto de cada região.</li>
        </ul>
        <p>No PostgreSQL, quem recebe as escritas é o <strong>primário</strong>; as cópias são as <strong>réplicas</strong> (ou <em>standbys</em>). Aqui: <code>postgres</code> e <code>postgres-replica</code>.</p>
      </>
    ),
    fontes: ['pg_alta_disp', 'ddia_replicacao'],
  },
  {
    titulo: '2. O WAL viaja',
    corpo: (
      <>
        <p>Toda alteração é escrita primeiro no <strong>WAL</strong>, o diário do banco. A réplica recebe esse diário por uma conexão contínua (<strong>streaming</strong>) e o <strong>reaplica</strong>, byte a byte: vira uma cópia física idêntica do cluster inteiro (todos os bancos, mesma versão).</p>
        <IlustracaoReplicacao modo="local" />
        <p>Do lado do primário, um processo <em>walsender</em> envia; na réplica, um <em>walreceiver</em> recebe e o processo de recuperação aplica.</p>
      </>
    ),
    fontes: ['pg_streaming', 'pg_wal', 'interdb_streaming'],
  },
  {
    titulo: '3. Como a réplica nasce',
    corpo: (
      <>
        <p>A réplica começa com uma <strong>cópia física</strong> do primário, feita com <code>pg_basebackup</code>. Com <code>-R</code>, a cópia já sai configurada como réplica (<code>standby.signal</code> + <code>primary_conninfo</code>): ao subir, ela entra em recuperação e pede o WAL que veio depois da cópia.</p>
        <pre className="sql">pg_basebackup -h postgres -U replicador -D … -R -X stream -C -S replica1</pre>
        <p><code>-S replica1</code> usa um <strong>replication slot</strong>: o primário guarda o WAL que a réplica ainda não recebeu, mesmo que ela fique fora um tempo. Sem limite, uma réplica parada encheria o disco do primário — por isso <code>max_slot_wal_keep_size = 1GB</code> aqui. É o que o <code>infra/postgres/entrypoint.sh</code> faz no primeiro boot.</p>
      </>
    ),
    fontes: ['pg_basebackup', 'pg_slots', 'pg_max_slot_wal'],
  },
  {
    titulo: '4. Só leitura',
    corpo: (
      <>
        <p>A réplica aceita <code>SELECT</code> enquanto reaplica o WAL (<strong>hot standby</strong>), mas recusa escrita: <code>cannot execute INSERT in a read-only transaction</code>. Uma "réplica" que aceita escrita deixou de ser réplica — o painel acusa (cenário S2).</p>
        <p>Um conflito típico: o VACUUM do primário remove versões que uma consulta longa na réplica ainda lê, e a réplica cancela a consulta. <code>hot_standby_feedback = on</code> faz a réplica avisar o primário — ao custo de algum inchaço lá.</p>
      </>
    ),
    fontes: ['pg_hot_standby', 'pg_hs_feedback', 'pg_funcoes_recuperacao'],
  },
  {
    titulo: '5. Assíncrona: o atraso',
    corpo: (
      <>
        <p>Por padrão, o COMMIT no primário <strong>não espera</strong> a réplica: ela fica alguns milissegundos para trás (o <strong>atraso de replicação</strong>). Quase sempre não importa — até a aplicação gravar no primário e, em seguida, ler da réplica:</p>
        <LinhaDoTempo rotulo="Read-your-writes quebrado: a leitura na réplica chega antes do WAL" colunas={5} faixas={['API', 'primário', 'réplica']}
          eventos={[
            { faixa: 1, col: 0, texto: 'INSERT pedido\nCOMMIT', tom: 'ok' },
            { faixa: 0, col: 1, texto: 'próxima tela:\nlê da réplica' },
            { faixa: 2, col: 1, texto: 'SELECT … →\n0 linhas', tom: 'ruim' },
            { faixa: 2, col: 3, texto: 'aplica o WAL\ndo pedido', tom: 'ok' },
            { faixa: 0, col: 4, texto: '"cadê meu\npedido?"', tom: 'ruim' },
          ]}
          notas={['Isso é quebrar o "ler as próprias escritas" (read-your-writes): o dado existe, só não chegou ainda.']} />
        <p>O painel mostra o atraso em <strong>bytes</strong> (quanto WAL falta aplicar) e em <strong>tempo</strong> em cada estágio (<code>write_lag</code>, <code>flush_lag</code>, <code>replay_lag</code>).</p>
      </>
    ),
    fontes: ['ddia_replicacao', 'pg_stat_replicacao', 'pg_stat_receptor'],
  },
  {
    titulo: '6. Os cinco synchronous_commit',
    corpo: (
      <>
        <p>O parâmetro <code>synchronous_commit</code> diz <strong>até onde o COMMIT espera</strong> — e pode mudar a cada transação (<code>SET LOCAL</code>). Para ele valer, a réplica precisa estar em <code>synchronous_standby_names</code> (aqui, <code>'replica1'</code>).</p>
        <IlustracaoReplicacao modo="remote_apply" />
        <dl>
          <dt>off</dt><dd>nem espera o disco local (pode perder a última fração de segundo se o servidor cair).</dd>
          <dt>local</dt><dd>espera o disco local. Padrão deste projeto.</dd>
          <dt>remote_write</dt><dd>espera a réplica receber.</dd>
          <dt>on</dt><dd>espera a réplica gravar no disco dela.</dd>
          <dt>remote_apply</dt><dd>espera a réplica aplicar: a linha já é visível lá.</dd>
        </dl>
      </>
    ),
    fontes: ['pg_sync_commit', 'pg_sync_rep', 'pg_sync_nomes', 'pg_wal_writer'],
  },
  {
    titulo: '7. O preço e o perigo',
    corpo: (
      <>
        <p>Cada etapa a mais é uma ida e volta pela rede e um disco a mais: o COMMIT fica mais lento. Sob carga, a réplica precisa aplicar <em>tudo</em> o que veio antes, e o <code>remote_apply</code> sente primeiro.</p>
        <p>O perigo: se a única réplica síncrona cair, todo COMMIT que espera por ela <strong>fica parado para sempre</strong>. Por isso este projeto deixa o padrão em <code>local</code> e só o laboratório pede espera — e recusa os modos que esperam se a réplica não estiver conectada (cenário S6). Em produção usa-se <code>ANY 1 (r1, r2)</code> com várias réplicas, ou o modo síncrono do Patroni, que se ajusta sozinho.</p>
      </>
    ),
    fontes: ['pg_sync_rep', 'pg_sync_nomes', 'ddia_replicacao'],
  },
  {
    titulo: '8. Read-your-writes na loja',
    corpo: (
      <>
        <p>Os <Link to="/relatorios">relatórios</Link> agora são lidos da réplica (o selo diz de onde veio). O botão "Atualizar" grava no primário (REFRESH) e a tela relê logo em seguida — o caso do passo 5.</p>
        <p>A solução usada: depois da escrita, a API anota a posição do WAL no primário (<code>pg_current_wal_lsn()</code>) e espera a réplica chegar nela (<code>pg_last_wal_replay_lsn()</code>) antes de responder. Só essa leitura espera; as outras seguem livres. Se a réplica demorar mais de 3 s, lê do primário.</p>
      </>
    ),
    fontes: ['pg_funcoes_backup', 'pg_funcoes_recuperacao', 'ddia_replicacao'],
  },
  {
    titulo: '9. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Rode <strong>local</strong> com 50 transações: quantas linhas já estavam na réplica logo depois do COMMIT?</li>
        <li>Rode <strong>remote_apply</strong>: 50 de 50 — e quanto o COMMIT ficou mais lento?</li>
        <li>Rode <strong>off</strong> e repare no tempo até a linha aparecer na réplica. Por que ~200 ms?</li>
        <li>Ligue a <strong>carga</strong> e repita local e remote_apply: o que acontece com o atraso e com o p95 do COMMIT?</li>
        <li>Abra o <Link to="/dba?aba=replicacao">Painel do DBA → Replicação</Link> e veja os LSNs e o slot.</li>
      </ol>
    ),
    fontes: ['pg_stat_replicacao', 'pg_sync_commit'],
  },
]

export function TutorialReplicacao() {
  return <Tutorial titulo="Replicação do zero" passos={REPLICACAO} />
}

// ======================================================================== Backup e PITR (Fase 5)

const BACKUP: Passo[] = [
  {
    titulo: '1. Réplica não é backup',
    corpo: (
      <>
        <p>Um <code>DROP TABLE</code> por engano vai para a réplica em milissegundos: ela copia os erros também. <strong>Backup</strong> é outra coisa: uma cópia de um momento passado, para <em>voltar</em> no tempo.</p>
        <dl>
          <dt>RPO</dt><dd>quanto dado se aceita perder (ex.: 5 minutos).</dd>
          <dt>RTO</dt><dd>quanto tempo se aceita ficar fora do ar até recuperar (ex.: 30 minutos).</dd>
          <dt>3-2-1</dt><dd>3 cópias, em 2 mídias, 1 fora do local. (Aqui o repositório fica no mesmo host: serve para estudar, não para produção.)</dd>
        </dl>
        <p>Em 2017 a GitLab apagou o diretório de dados do primário por engano; a réplica não salvou e vários backups não funcionavam. Backup que nunca foi restaurado é só esperança.</p>
      </>
    ),
    fontes: ['pg_backup', 'gitlab_2017'],
  },
  {
    titulo: '2. Lógico × físico',
    corpo: (
      <>
        <dl>
          <dt>Lógico (<code>pg_dump</code>)</dt><dd>gera os comandos SQL que recriam os dados. Portável (outra versão, outro servidor), seletivo (uma tabela) e lento em bancos grandes. Volta só ao momento do dump.</dd>
          <dt>Físico (<code>pg_basebackup</code>, pgBackRest)</dt><dd>copia os arquivos do cluster. Rápido de restaurar, sempre o cluster inteiro, mesma versão. Junto com o WAL arquivado, volta a <strong>qualquer instante</strong>.</dd>
        </dl>
        <p>Este laboratório usa o <strong>pgBackRest</strong>, a ferramenta de backup físico mais usada com PostgreSQL.</p>
      </>
    ),
    fontes: ['pg_backup', 'pg_dump', 'pgbackrest_guia'],
  },
  {
    titulo: '3. Full, diferencial, incremental',
    corpo: (
      <>
        <IlustracaoBackups modo="tipos" />
        <p>Uma estratégia comum: full no domingo, diferencial no meio da semana e incremental todo dia. O pgBackRest guarda a referência de cada backup e apaga os antigos pela <strong>retenção</strong> (aqui: os 2 últimos full e o que depende deles).</p>
      </>
    ),
    fontes: ['pgbackrest_tipos', 'pgbackrest_guia', 'pgbackrest_comandos'],
  },
  {
    titulo: '4. Arquivamento contínuo do WAL',
    corpo: (
      <>
        <p>Entre um backup e outro, o WAL guarda <em>tudo</em> o que aconteceu. Com <code>archive_mode = on</code>, cada segmento completo (16 MB) é entregue ao <code>archive_command</code> — aqui, <code>pgbackrest archive-push</code>, que o copia ao repositório.</p>
        <p>Se o comando falhar, o PostgreSQL <strong>não apaga</strong> o segmento e tenta de novo: nada se perde, mas o disco enche. O painel mostra o último segmento arquivado e as falhas (cenário T1). <code>archive_timeout = 300</code> força a troca de segmento a cada 5 minutos — é o RPO se o disco do primário morrer.</p>
      </>
    ),
    fontes: ['pg_arquivamento', 'pg_archive_command', 'pg_archive_timeout', 'pg_stat_arquivador'],
  },
  {
    titulo: '5. PITR: voltar a um instante',
    corpo: (
      <>
        <p><strong>PITR</strong> (<em>point-in-time recovery</em>): restaura o último backup antes do alvo e reaplica o WAL arquivado <strong>até o instante escolhido</strong> — por exemplo, um minuto antes do DROP.</p>
        <IlustracaoBackups modo="pitr" />
        <pre className="sql">{`pgbackrest restore --type=time --target="2026-11-05 14:31:00-03" --target-action=promote`}</pre>
        <p>Escolher o alvo é escolher o que se perde: tudo depois dele some, inclusive o que era bom.</p>
      </>
    ),
    fontes: ['pg_pitr', 'pg_alvo', 'interdb_pitr', 'pgbackrest_comandos'],
  },
  {
    titulo: '6. Restaurar ao lado, nunca por cima',
    corpo: (
      <>
        <p>Restaurar por cima do primário apagaria tudo o que aconteceu depois do alvo — inclusive as compras de quem nada teve a ver com o acidente. O caminho seguro é restaurar numa <strong>instância à parte</strong> e copiar de volta só o que se perdeu.</p>
        <p>O laboratório restaura em <code>/var/lib/postgresql/pitr</code>, sobe essa instância na porta <strong>5433</strong> (o primário segue na 5432), confere a tabela, e desliga e apaga tudo. Num caso real, o passo seguinte seria <code>pg_dump -t</code> da instância restaurada → <code>pg_restore</code> no primário.</p>
      </>
    ),
    fontes: ['pg_ctl', 'pg_dump', 'pg_pitr'],
  },
  {
    titulo: '7. Como a API dispara o pgBackRest',
    corpo: (
      <>
        <p>O pgBackRest roda no servidor do banco (é lá que estão os arquivos). A API o dispara com <code>COPY … FROM PROGRAM 'pgbackrest …'</code>: o PostgreSQL executa o comando como o usuário do sistema <code>postgres</code> e devolve a saída como linhas.</p>
        <p>Isso só é possível porque a API é <strong>superusuária</strong> — e mostra o tamanho do risco: quem tem <code>COPY FROM PROGRAM</code> tem um shell no servidor. Aqui os comandos são fixos e só recebem valores validados; a <strong>Fase 6</strong> tira esse poder da API (menor privilégio, <code>pg_execute_server_program</code>).</p>
      </>
    ),
    fontes: ['pg_copy', 'pg_papeis'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Faça um backup <strong>full</strong>; depois um <strong>incr</strong> e um <strong>diff</strong>. Compare o que cada um copiou e de quem depende.</li>
        <li>Rode o PITR com alvo <strong>antes do DROP</strong>: quantas linhas voltaram? Quanto tempo levou (o RTO deste ensaio)?</li>
        <li>Rode com alvo <strong>entre os lotes</strong>: o lote 2 some — de propósito.</li>
        <li>Confira que a tabela continua apagada no primário: a restauração não tocou nele.</li>
        <li>No <Link to="/dba?aba=replicacao">painel</Link>, veja o arquivamento do WAL.</li>
      </ol>
    ),
    fontes: ['pgbackrest_guia', 'pg_pitr'],
  },
]

export function TutorialBackup() {
  return <Tutorial titulo="Backup e PITR do zero" passos={BACKUP} />
}

// ======================================================================== Alta disponibilidade (Fase 5)

const HA: Passo[] = [
  {
    titulo: '1. Os noves',
    corpo: (
      <>
        <p><strong>Alta disponibilidade</strong> é continuar funcionando quando uma peça falha. Mede-se em "noves": 99,9% de disponibilidade permite 8,8 horas fora do ar por ano; 99,99%, 53 minutos; 99,999%, 5 minutos.</p>
        <p>Cada nove a mais custa caro (mais máquinas, mais automação, mais testes). O objetivo certo depende do negócio — e nunca é 100%.</p>
        <p>Dois números guiam o projeto, os mesmos do backup: <strong>RTO</strong> (quanto tempo fora até voltar) e <strong>RPO</strong> (quanto dado se perde na troca).</p>
      </>
    ),
    fontes: ['sre_risco', 'pg_alta_disp'],
  },
  {
    titulo: '2. Redundância e failover',
    corpo: (
      <>
        <p>A receita: <strong>eliminar o ponto único de falha</strong> (ter réplicas), <strong>detectar</strong> a falha e fazer o <strong>failover</strong> — promover uma réplica a líder e mandar o tráfego para ela.</p>
        <dl>
          <dt>Failover</dt><dd>automático, quando o líder cai. Ninguém avisou: é preciso perceber pela falta de sinal.</dd>
          <dt>Switchover</dt><dd>planejado (manutenção, upgrade): o líder entrega o posto de forma ordenada. Mais rápido e sem perda.</dd>
        </dl>
        <p>A parte difícil é a detecção: "o líder morreu" ou "a rede até ele está lenta"? Errar para um lado deixa a loja fora; errar para o outro cria dois líderes.</p>
      </>
    ),
    fontes: ['ddia_consenso', 'pg_alta_disp'],
  },
  {
    titulo: '3. Split-brain e quórum',
    corpo: (
      <>
        <p><strong>Split-brain</strong>: a rede se parte, cada lado acha que o outro morreu e os dois aceitam escrita. Os dados divergem e não há como juntar.</p>
        <IlustracaoQuorum />
        <p>A solução é o <strong>quórum</strong>: só quem fala com a <strong>maioria</strong> pode ser líder. É o que algoritmos de <strong>consenso</strong> como o Raft garantem — e por que esses clusters têm número ímpar de membros.</p>
      </>
    ),
    fontes: ['raft', 'raft_site', 'etcd_faq', 'ddia_consenso'],
  },
  {
    titulo: '4. PostgreSQL: Patroni + etcd + HAProxy',
    corpo: (
      <>
        <p>O PostgreSQL replica, mas <strong>não faz failover sozinho</strong>. O <strong>Patroni</strong> é um agente em cada nó: ele guarda no <strong>etcd</strong> (um banco chave-valor com consenso Raft) uma <strong>chave de líder com validade</strong> (TTL).</p>
        <IlustracaoTopologiaHA tec="patroni" />
        <p>O <strong>HAProxy</strong> esconde a troca da aplicação: ela sempre conecta em <code>haproxy:5000</code>, e o HAProxy encaminha para o nó cujo Patroni diz "sou o primário".</p>
      </>
    ),
    fontes: ['patroni_docs', 'patroni_rest', 'haproxy_docs', 'etcd_faq'],
  },
  {
    titulo: '5. A chave de líder expira',
    corpo: (
      <>
        <LinhaDoTempo rotulo="Failover no Patroni: o líder para de renovar a chave, ela expira e a réplica se elege" colunas={6} faixas={['patroni1', 'patroni2', 'etcd', 'API']}
          eventos={[
            { faixa: 0, col: 0, texto: 'renova a chave\na cada 5 s', tom: 'ok' },
            { faixa: 0, col: 1, texto: '✕ cai', tom: 'ruim' },
            { faixa: 3, col: 1, texto: 'escritas\nfalham', tom: 'ruim', span: 3 },
            { faixa: 2, col: 2, texto: 'chave vale\naté o TTL', tom: 'espera', span: 2 },
            { faixa: 2, col: 4, texto: 'chave\nexpirou' },
            { faixa: 1, col: 4, texto: 'pega a chave:\npromovido', tom: 'ok' },
            { faixa: 3, col: 5, texto: 'HAProxy\nmuda: escreve', tom: 'ok' },
          ]}
          notas={['O RTO fica perto do ttl (aqui, 20 s). Menor = troca mais rápida, mas mais falsos alarmes numa rede lenta.',
            'Quando o antigo líder volta, encontra outro dono da chave e vira réplica (pg_rewind acerta o histórico).']} />
      </>
    ),
    fontes: ['patroni_config', 'pg_rewind', 'patroni_docs'],
  },
  {
    titulo: '6. Perder ou não o que foi confirmado',
    corpo: (
      <>
        <p>Com replicação <strong>assíncrona</strong>, o líder confirma o COMMIT antes de a réplica receber. Se ele cair nesse instante, a réplica promovida não tem aquela escrita: <strong>RPO maior que zero</strong>. O Patroni limita o estrago (<code>maximum_lag_on_failover</code>), mas não zera.</p>
        <p>Com <code>synchronous_mode</code>, o Patroni mantém uma réplica <strong>síncrona</strong> e só promove ela: toda escrita confirmada já estava lá. RPO zero, ao custo da latência do COMMIT (o Laboratório de Replicação mede esse custo).</p>
        <p>Na prática, a perda é rara num laboratório local (a réplica recebe em milissegundos) — mas o risco existe, e é o tipo de coisa que análises como as do Jepsen encontram.</p>
      </>
    ),
    fontes: ['patroni_sync', 'pg_sync_rep', 'ddia_consenso'],
  },
  {
    titulo: '7. MongoDB: o replica set se vira sozinho',
    corpo: (
      <>
        <p>No MongoDB o failover é <strong>nativo</strong>: os membros trocam heartbeats a cada 2 s; sem notícias do primário por <code>electionTimeoutMillis</code> (10 s), um secundário pede votos e, com a maioria, vira primário. O driver descobre o novo primário e repete a escrita que falhou (<em>retryable writes</em>).</p>
        <IlustracaoTopologiaHA tec="mongo" />
        <p><code>w: 1</code> confirma quando só o primário gravou: se ele cair antes de repassar, a escrita é desfeita quando ele volta (<em>rollback</em>). <code>w: "majority"</code> confirma quando a maioria tem — sobrevive a qualquer eleição.</p>
        <p>Detalhe medido aqui: um <code>shutdown</code> comum faz <em>election handoff</em> (o primário indica o sucessor) e a troca leva milissegundos. Para simular uma queda de verdade, o laboratório desliga o handoff antes.</p>
      </>
    ),
    fontes: ['mongo_eleicoes', 'mongo_wc', 'mongo_rollback', 'mongo_retry', 'mongo_stepdown'],
  },
  {
    titulo: '8. Redis: Sentinel',
    corpo: (
      <>
        <p>O <strong>Sentinel</strong> é um processo à parte que vigia o primário do Redis. Três sentinels; primário mudo por 5 s: cada um o marca como fora (<em>SDOWN</em>); com o quórum (2) concordando, vira <em>ODOWN</em>, um sentinel é eleito e promove a réplica.</p>
        <IlustracaoTopologiaHA tec="redis" />
        <p>A replicação do Redis é <strong>sempre assíncrona</strong>. <code>WAIT 1</code> faz a escrita esperar uma réplica receber — melhora, mas não garante nada no disco nem numa partição de rede (o Jepsen mostrou escritas confirmadas sumindo).</p>
      </>
    ),
    fontes: ['redis_sentinel', 'redis_replicacao', 'redis_wait', 'jepsen_redis'],
  },
  {
    titulo: '9. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Suba os clusters: <code>make up-ha</code> (~600 MB; ficam fora do dia a dia).</li>
        <li>Escolha a tecnologia, a ação (<strong>queda</strong> ou <strong>troca planejada</strong>) e a garantia, e inicie o ensaio.</li>
        <li>Acompanhe o gráfico: a escrita para, o cluster elege outro líder, a escrita volta. O tempo parado é o <strong>RTO</strong>.</li>
        <li>Na conclusão: quantas escritas confirmadas sumiram (<strong>RPO</strong>)?</li>
        <li>Espere ~1 minuto e veja o antigo líder voltar como réplica na tabela de membros (não há dois líderes).</li>
        <li>Compare: queda × troca planejada; Patroni × MongoDB × Redis.</li>
      </ol>
    ),
    fontes: ['patroni_rest', 'mongo_eleicoes', 'redis_sentinel'],
  },
]

export function TutorialHA() {
  return <Tutorial titulo="Alta disponibilidade do zero" passos={HA} />
}

// ======================================================================== Consistência ajustável (Fase 7, Cassandra)

const CONSISTENCIA: Passo[] = [
  {
    titulo: '1. Sem mestre: o anel',
    corpo: (
      <>
        <IlustracaoAnel />
        <p>No Cassandra não existe primário. Os nós formam um <strong>anel</strong>: a chave da partição vira um número (token) e cai num ponto do anel; o dado é copiado nos próximos nós, tantos quanto o <strong>fator de replicação</strong> (RF). Qualquer nó aceita leitura e escrita e repassa às réplicas.</p>
        <dl>
          <dt>RF</dt><dd>quantas cópias de cada dado existem (aqui, 1 ou 3).</dd>
          <dt>Coordenador</dt><dd>o nó que recebeu a requisição e fala com as réplicas.</dd>
        </dl>
      </>
    ),
    fontes: ['cass_dynamo', 'dynamo_artigo', 'cassandra_artigo'],
  },
  {
    titulo: '2. Quantas réplicas precisam responder?',
    corpo: (
      <>
        <p>Cada leitura e cada escrita escolhem o seu <strong>nível de consistência</strong>: quantas réplicas o coordenador espera antes de responder.</p>
        <dl>
          <dt>ONE</dt><dd>1 réplica basta — o mais rápido e o mais disponível.</dd>
          <dt>QUORUM</dt><dd>a maioria: RF/2 + 1 (com RF=3, 2 réplicas).</dd>
          <dt>ALL</dt><dd>todas as RF — a mais forte e a mais frágil: uma réplica fora derruba a operação.</dd>
        </dl>
      </>
    ),
    fontes: ['cass_consistencia', 'cass_cqlsh'],
  },
  {
    titulo: '3. R + W > RF',
    corpo: (
      <>
        <p>Se as réplicas que a <strong>leitura</strong> consulta (R) mais as que a <strong>escrita</strong> esperou (W) somam mais que RF, as duas <em>sempre se cruzam</em> em pelo menos uma réplica — e a leitura vê a última escrita. Com RF=3: QUORUM + QUORUM = 2 + 2 &gt; 3 ✔; ONE + ONE = 2 ✘ (pode ler uma réplica que ainda não recebeu).</p>
        <p>É o mesmo raciocínio de quórum do Dynamo (N, R, W), de onde o Cassandra herdou o desenho.</p>
      </>
    ),
    fontes: ['cass_escolher', 'dynamo_artigo', 'ddia_modelos'],
  },
  {
    titulo: '4. O preço: disponibilidade',
    corpo: (
      <>
        <IlustracaoAnel vivos={1} nivel="QUORUM" />
        <p>Se não houver réplicas vivas suficientes, o Cassandra <strong>recusa</strong> a operação (<code>Unavailable</code>) em vez de responder com dado possivelmente velho. É o teorema <strong>CAP</strong> na prática: numa falha, escolher entre consistência (recusar) e disponibilidade (responder com o que tiver).</p>
        <p><strong>PACELC</strong> completa: mesmo sem falha, esperar mais réplicas custa <em>latência</em>.</p>
      </>
    ),
    fontes: ['cap_artigo', 'pacelc_artigo', 'cass_escolher'],
  },
  {
    titulo: '5. Modelar pela consulta',
    corpo: (
      <>
        <IlustracaoParticao />
        <p>No Cassandra não há JOIN: cria-se <strong>uma tabela por pergunta</strong>. "Vistos recentemente" é <code>vistos_por_cliente</code>: partição = cliente (tudo dele junto, num nó), clustering = instante decrescente (já vem em ordem). O nome do produto vai copiado na linha (desnormalização). Cada linha tem <strong>TTL</strong>: some sozinha em 30 dias.</p>
        <p>Escrever é barato porque o Cassandra só acrescenta (commit log + memtable → SSTables imutáveis, uma árvore LSM).</p>
      </>
    ),
    fontes: ['cass_modelagem', 'cass_ttl', 'cass_lsm'],
  },
  {
    titulo: '6. Como usar o laboratório',
    corpo: (
      <>
        <p>O cluster de estudo tem <strong>um nó</strong> (três não caberiam na memória). O truque: um keyspace com <strong>RF=3</strong> nesse nó único — para o Cassandra, é um anel em que só 1 das 3 réplicas existe, como se dois nós estivessem fora.</p>
        <ol>
          <li>Rode com <strong>RF=1</strong>: os três níveis funcionam (1 réplica, e ela está viva).</li>
          <li>Rode com <strong>RF=3</strong>: ONE funciona; QUORUM e ALL falham — e a mensagem do Cassandra diz quantas réplicas faltaram.</li>
          <li>Repita à mão: <code>make cqlsh</code>, <code>CONSISTENCY QUORUM;</code> e um <code>SELECT</code> em <code>lab_rf3.contas</code>.</li>
        </ol>
      </>
    ),
    fontes: ['cass_cqlsh', 'cass_consistencia'],
  },
]

export function TutorialConsistencia() {
  return <Tutorial titulo="Consistência ajustável do zero" passos={CONSISTENCIA} />
}

// ======================================================================== Grafos (Fase 7, Neo4j)

const GRAFO: Passo[] = [
  {
    titulo: '1. Nós e relacionamentos',
    corpo: (
      <>
        <IlustracaoGrafoCompras />
        <p>Um <strong>grafo de propriedades</strong> tem <strong>nós</strong> (com rótulos, como <code>:Cliente</code> e <code>:Sku</code>) e <strong>relacionamentos</strong> com tipo e direção (<code>-[:COMPROU]-&gt;</code>), os dois com propriedades (<code>unidades</code>).</p>
        <p>Aqui o grafo nasce dos pedidos do PostgreSQL: cada par (cliente, SKU) comprado vira uma aresta.</p>
      </>
    ),
    fontes: ['neo4j_cypher', 'neo4j_modelagem'],
  },
  {
    titulo: '2. Cypher: desenhar o padrão',
    corpo: (
      <>
        <p>Em <strong>Cypher</strong> a consulta é um desenho do caminho procurado:</p>
        <pre className="sql">{`MATCH (:Sku {id: $x})<-[:COMPROU]-(c:Cliente)-[:COMPROU]->(outro:Sku)
RETURN outro.id, count(DISTINCT c) AS forca
ORDER BY forca DESC LIMIT 10`}</pre>
        <p>"Do SKU X, volte para quem o comprou, e daí vá para o que eles também compraram." O Cypher é a base do <strong>GQL</strong>, o padrão ISO de 2024 para consultas a grafos.</p>
      </>
    ),
    fontes: ['neo4j_match', 'neo4j_gql'],
  },
  {
    titulo: '3. A mesma pergunta em SQL',
    corpo: (
      <>
        <IlustracaoJoins />
        <p>No relacional, "andar uma aresta" é um <strong>JOIN</strong> — e aqui cada salto passa por duas tabelas (<code>item_pedido</code> → <code>pedido</code>). Dois saltos: quatro tabelas, e as linhas intermediárias se multiplicam antes do <code>GROUP BY</code>.</p>
      </>
    ),
    fontes: ['pg_joins', 'livro_grafos'],
  },
  {
    titulo: '4. Index-free adjacency',
    corpo: (
      <>
        <p>No Neo4j, cada nó guarda <strong>ponteiros diretos</strong> para os seus relacionamentos. Ir de um cliente às compras dele não consulta índice nenhum: segue o ponteiro. O custo de um salto depende de <em>quantos vizinhos</em> o nó tem, não do tamanho do banco.</p>
        <p>No SQL, cada JOIN consulta um índice (ou varre a tabela) — custo que cresce com o tamanho das tabelas e se repete a cada salto.</p>
      </>
    ),
    fontes: ['livro_grafos', 'ddia_modelos'],
  },
  {
    titulo: '5. Dado derivado e MERGE',
    corpo: (
      <>
        <IlustracaoGrafoCompras saltos={3} />
        <p>O grafo é uma <strong>cópia derivada</strong> dos pedidos: depois do COMMIT no PostgreSQL, a compra vai para o Neo4j com <code>MERGE</code> (cria só o que falta; repetir não duplica). Se o Neo4j estiver fora, a compra vale assim mesmo — e o botão "Reconstruir" refaz o grafo inteiro a partir dos pedidos, em lotes (<code>CALL … IN TRANSACTIONS</code>).</p>
        <p>A restrição de unicidade em <code>Cliente.id</code> e <code>Sku.id</code> cria o índice que o MERGE usa para achar o nó.</p>
      </>
    ),
    fontes: ['neo4j_merge', 'neo4j_restricoes', 'neo4j_em_lotes'],
  },
  {
    titulo: '6. Como usar o laboratório',
    corpo: (
      <>
        <ol>
          <li><strong>Reconstrua o grafo</strong> a partir dos pedidos (se ele estiver vazio ou desatualizado).</li>
          <li>Escolha um SKU e a pergunta: "também comprou" (2 saltos) ou "alcance" (3 saltos: quem <em>não</em> comprou X, mas comprou o que os compradores de X compraram).</li>
          <li>Compare tempo e resposta. As duas têm de <strong>bater</strong> — senão a comparação de desempenho não vale.</li>
        </ol>
        <p>Cuidado com a semântica: num <code>MATCH</code> o mesmo relacionamento não se repete no caminho; num self-join do SQL, sim. Por isso o "alcance" exclui quem comprou X — assim as duas perguntas são a mesma.</p>
      </>
    ),
    fontes: ['neo4j_unicidade', 'pg_with'],
  },
]

export function TutorialGrafo() {
  return <Tutorial titulo="Grafos do zero" passos={GRAFO} />
}
