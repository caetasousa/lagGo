import { Tutorial, type Passo } from './Tutorial'

// "Índices do zero": o tutorial que abre o Laboratório de Índices. Cada passo
// é curto, com uma ilustração, uma ligação com um experimento do laboratório
// e as fontes de onde a explicação saiu.

const PASSOS: Passo[] = [
  {
    titulo: '1. O problema',
    corpo: (
      <>
        <p>Uma tabela é guardada em <strong>páginas de 8 KB</strong>, na ordem em que as linhas chegaram. A tabela de pedidos tem 100 mil linhas em ~1.400 páginas.</p>
        <p>Para responder "quais os pedidos da cliente Ana?", sem nenhuma ajuda, o banco só tem um jeito: <strong>ler todas as páginas</strong> e testar linha por linha. Isso se chama <strong>Seq Scan</strong> (leitura sequencial).</p>
        <IlustracaoSeqScan />
        <p className="muted small">Analogia: procurar um nome numa caixa com 100 mil fichas soltas, sem ordem nenhuma.</p>
      </>
    ),
    fontes: ['pg_pagina', 'pg_explain', 'utl_anatomia'],
  },
  {
    titulo: '2. O índice',
    corpo: (
      <>
        <p>Um índice é uma <strong>estrutura separada, mantida em ordem</strong> por uma ou mais colunas. Cada entrada guarda o valor e o <strong>endereço da linha</strong> na tabela (página, posição).</p>
        <p>O tipo padrão é a <strong>B-tree</strong>: uma árvore em que cada nível divide as faixas de valores. Com 100 mil linhas ela tem 3 níveis; com 1 bilhão, uns 5. Achar a Ana = descer 3 páginas da árvore + ler as páginas dos pedidos dela.</p>
        <IlustracaoBTree />
        <p className="muted small">Analogia: o índice remissivo no fim de um livro — "Ana: páginas 12, 87, 340". Você não lê o livro para achar a Ana.</p>
      </>
    ),
    fontes: ['pg_indices', 'pg_btree', 'utl_anatomia', 'bayer_btree', 'comer_btree'],
  },
  {
    titulo: '3. O preço',
    corpo: (
      <>
        <p>Índice não é de graça:</p>
        <ul>
          <li><strong>Ocupa espaço</strong> — às vezes tanto quanto a própria tabela.</li>
          <li><strong>Deixa as escritas mais lentas</strong>: todo INSERT, e todo UPDATE/DELETE que mexe na coluna, precisa atualizar <em>cada</em> índice da tabela.</li>
          <li><strong>Precisa de manutenção</strong> (incha com o tempo, igual à tabela).</li>
        </ul>
        <p>Por isso não se indexa "tudo": cria-se índice para as <strong>perguntas que a aplicação faz com frequência</strong>. O Painel do DBA → PostgreSQL lista os índices que nunca foram usados.</p>
      </>
    ),
    fontes: ['pg_indices', 'pg_examinar', 'ddia_indices'],
  },
  {
    titulo: '4. Quem decide é o planejador',
    corpo: (
      <>
        <p>Ter um índice não obriga o banco a usá-lo. Antes de executar, o <strong>planejador</strong> estima quantas linhas a condição vai devolver (usando estatísticas coletadas pelo <code>ANALYZE</code>) e compara o custo dos caminhos possíveis.</p>
        <ul>
          <li>A condição devolve <strong>poucas linhas</strong> (alta seletividade: um cliente entre 10 mil)? Índice.</li>
          <li>Devolve <strong>boa parte da tabela</strong> (baixa seletividade: 80% dos pedidos estão ENTREGUES)? Ler tudo em sequência é mais barato do que pular de página em página — e o planejador ignora o índice <em>de propósito</em>.</li>
        </ul>
        <p>É por isso que, em tabelas pequenas, o plano às vezes mostra Seq Scan mesmo com índice: ler 3 páginas inteiras custa menos que consultar o índice.</p>
      </>
    ),
    fontes: ['pg_estatisticas', 'pg_examinar', 'pg_planejador_cfg', 'interdb_planejador'],
  },
  {
    titulo: '5. Quando o índice não serve',
    corpo: (
      <>
        <p>As armadilhas mais comuns, todas com um experimento aqui:</p>
        <dl>
          <dt>Ordem das colunas</dt><dd>Índice (cliente, data) é uma lista telefônica ordenada por sobrenome e nome: ótima para "sobrenome = Silva", inútil para "nome = Ana" sozinho. → experimento 3.</dd>
          <dt>Função na coluna</dt><dd><code>WHERE lower(nome) = …</code> não usa índice em <code>nome</code>; precisa de índice em <code>lower(nome)</code>. → experimento 5.</dd>
          <dt>Curinga no começo</dt><dd><code>LIKE '%abc'</code> não usa B-tree (ela é ordenada pelo começo do texto); precisa de trigramas (GIN). → experimento 6.</dd>
          <dt>Pergunta sobre tudo</dt><dd>Relatório que soma a tabela inteira não melhora com índice. → experimento 7.</dd>
        </dl>
      </>
    ),
    fontes: ['pg_multicoluna', 'pg_expressao', 'pg_trgm', 'utl_composto', 'utl_funcoes', 'utl_like'],
  },
  {
    titulo: '6. Os tipos de índice',
    corpo: (
      <table aria-label="Tipos de índice">
        <thead><tr><th>Tipo</th><th>Como é por dentro</th><th>Serve para</th><th>Aqui</th></tr></thead>
        <tbody>
          <tr><td><strong>B-tree</strong> (padrão)</td><td>árvore ordenada</td><td><code>=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>BETWEEN</code>, <code>ORDER BY</code>, <code>LIKE 'abc%'</code></td><td>exp. 1, 2, 3</td></tr>
          <tr><td><strong>Composto</strong></td><td>B-tree com várias colunas, na ordem dada</td><td>filtro na 1ª coluna (+ ordenação pela 2ª)</td><td>exp. 1</td></tr>
          <tr><td><strong>Parcial</strong></td><td>B-tree só com as linhas de um <code>WHERE</code></td><td>consultas que sempre filtram o mesmo valor raro</td><td>exp. 4</td></tr>
          <tr><td><strong>De expressão</strong></td><td>B-tree do resultado de uma função</td><td><code>lower(email)</code>, <code>date(criado_em)</code></td><td>exp. 5</td></tr>
          <tr><td><strong>GIN</strong></td><td>índice invertido: para cada "pedaço", as linhas que o contêm</td><td>texto (<code>%abc%</code>, busca textual), JSONB, arrays</td><td>exp. 6</td></tr>
          <tr><td><strong>BRIN</strong></td><td>só o mínimo e o máximo de cada bloco de páginas</td><td>tabelas enormes gravadas em ordem (datas)</td><td>exp. 3</td></tr>
          <tr><td><strong>Partição</strong></td><td>não é índice: a tabela é dividida em pedaços por faixa</td><td>dados por período; apagar períodos antigos</td><td>exp. 8, 9</td></tr>
        </tbody>
      </table>
    ),
    fontes: ['pg_tipos_indice', 'pg_parcial', 'pg_gin', 'pg_brin', 'pg_pruning'],
  },
  {
    titulo: '7. Como ler o plano',
    corpo: (
      <>
        <p><code>EXPLAIN ANALYZE</code> executa a consulta e mostra o caminho escolhido. O plano é uma árvore: as linhas mais recuadas (de baixo) acontecem primeiro e entregam linhas para as de cima. O laboratório traduz cada passo para você, mas os nomes que mais importam são:</p>
        <dl>
          <dt>Seq Scan</dt><dd>leu a tabela inteira.</dd>
          <dt>Index Scan</dt><dd>desceu o índice e buscou cada linha na tabela.</dd>
          <dt>Index Only Scan</dt><dd>respondeu só com o índice, sem abrir a tabela (o melhor caso).</dd>
          <dt>Bitmap Index + Heap Scan</dt><dd>marcou no índice as páginas certas e depois leu só elas, em ordem — o meio-termo para "algumas centenas de linhas".</dd>
          <dt>rows=</dt><dd>quantas linhas o planejador <em>achou</em> que viriam × quantas vieram de verdade (<code>actual</code>). Diferença grande = estatística ruim.</dd>
          <dt>Buffers</dt><dd>páginas de 8 KB lidas — <code>hit</code> da memória, <code>read</code> do disco. É a medida mais estável para comparar: o tempo muda com o cache, as páginas não.</dd>
        </dl>
      </>
    ),
    fontes: ['pg_explain', 'pg_index_only', 'utl_explain', 'dalibo'],
  },
  {
    titulo: '8. Como usar o laboratório',
    corpo: (
      <ol>
        <li>Escolha um experimento à esquerda e leia <strong>a pergunta</strong> que ele responde.</li>
        <li>Remova os índices dele (se houver) e clique em <strong>EXPLAIN ANALYZE</strong>: veja o caminho sem ajuda.</li>
        <li>Crie o índice sugerido e rode de novo.</li>
        <li>Compare o quadro <strong>antes × depois</strong> (páginas lidas e tempo) e leia o plano em português.</li>
        <li>Responda: por que o banco mudou (ou não mudou) de caminho?</li>
      </ol>
    ),
    fontes: ['pg_explain', 'pg_examinar'],
  },
]

export function TutorialIndices() {
  return <Tutorial titulo="Índices do zero" passos={PASSOS} />
}

// ---------------------------------------------------------------- ilustrações (SVG)

function IlustracaoSeqScan() {
  const paginas = Array.from({ length: 14 }, (_, k) => k)
  return (
    <svg className="ilustracao" viewBox="0 0 760 150" role="img" aria-label="Seq Scan: o banco lê todas as páginas da tabela">
      <text x="0" y="16" fontSize="13" fill="var(--il-cinza)">Tabela pedido — ~1.400 páginas (14 desenhadas). O banco lê TODAS:</text>
      {paginas.map((k) => (
        <g key={k} transform={`translate(${k * 53}, 28)`}>
          <rect width="46" height="62" rx="4" fill={k === 4 || k === 11 ? 'var(--il-ok-fundo)' : 'var(--il-ruim-fundo)'} stroke={k === 4 || k === 11 ? 'var(--il-ok)' : 'var(--il-ruim)'} />
          {[0, 1, 2, 3, 4].map((l) => <rect key={l} x="6" y={8 + l * 10} width="34" height="5" rx="2" fill={(k === 4 && l === 2) || (k === 11 && l === 0) ? 'var(--il-ok)' : 'var(--il-linha)'} />)}
        </g>
      ))}
      <path d="M 10 105 H 735" stroke="var(--il-ruim)" strokeWidth="2" markerEnd="url(#seta)" />
      <defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--il-ruim)" /></marker></defs>
      <text x="0" y="132" fontSize="13" fill="var(--il-texto)">Vermelho = página lida à toa. Verde = as 2 linhas da Ana. Lidas: 14 de 14 páginas.</text>
    </svg>
  )
}

function IlustracaoBTree() {
  const caixa = (x: number, y: number, w: number, texto: string, destaque = false) => (
    <g>
      <rect x={x} y={y} width={w} height="30" rx="5" fill={destaque ? 'var(--il-destaque-fundo)' : 'var(--il-fundo)'} stroke={destaque ? 'var(--il-destaque)' : 'var(--il-borda)'} strokeWidth={destaque ? 2 : 1} />
      <text x={x + w / 2} y={y + 20} fontSize="12" textAnchor="middle" fill="var(--il-texto)">{texto}</text>
    </g>
  )
  const linha = (x1: number, y1: number, x2: number, y2: number, destaque = false) =>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={destaque ? 'var(--il-destaque)' : 'var(--il-linha)'} strokeWidth={destaque ? 2.5 : 1.5} />
  return (
    <svg className="ilustracao" viewBox="0 0 760 270" role="img" aria-label="B-tree: o banco desce três níveis da árvore até a Ana">
      {linha(380, 40, 150, 90, true)}{linha(380, 40, 380, 90)}{linha(380, 40, 610, 90)}
      {caixa(300, 10, 160, 'raiz: A–H | I–Q | R–Z', true)}
      {caixa(80, 90, 140, 'A–C | D–F | G–H', true)}
      {caixa(310, 90, 140, 'I–K | L–N | O–Q')}
      {caixa(540, 90, 140, 'R–T | U–W | X–Z')}
      {linha(150, 120, 110, 170, true)}{linha(150, 120, 230, 170)}{linha(150, 120, 300, 170)}
      {caixa(20, 170, 180, 'Abel, Ana Lima, Ana Silva', true)}{caixa(210, 170, 50, '…')}{caixa(270, 170, 110, 'Gil, Hugo…')}
      {linha(110, 200, 470, 245, true)}
      <rect x="470" y="230" width="60" height="30" rx="4" fill="var(--il-ok-fundo)" stroke="var(--il-ok)" />
      <text x="500" y="250" fontSize="11" textAnchor="middle">pág. 87</text>
      <text x="545" y="242" fontSize="12" fill="var(--il-cinza)">Folhas: valor → endereço</text>
      <text x="545" y="258" fontSize="12" fill="var(--il-cinza)">da linha (página, posição)</text>
      <text x="0" y="225" fontSize="13" fill="var(--il-texto)">Azul = caminho percorrido:</text>
      <text x="0" y="243" fontSize="13" fill="var(--il-texto)">3 páginas do índice + 1 da</text>
      <text x="0" y="261" fontSize="13" fill="var(--il-texto)">tabela, em vez de 1.400.</text>
    </svg>
  )
}
