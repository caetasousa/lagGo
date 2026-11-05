import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, type EstadoDoGrafo, type PerguntaGrafo, type ResultadoGrafo, type SkuParaOGrafo } from '../../api/client'
import { Barras } from '../../components/Graficos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { IlustracaoGrafoCompras } from '../../components/IlustracoesFase7'
import { TutorialGrafo } from '../../components/tutoriais'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, ms } from '../../components/ui'
import { Ficha, UsoSelo } from '../../components/usos'

// Laboratório Grafo × SQL (Fase 7, Neo4j e PostgreSQL, tópico 8.8, docs/07).

const PERGUNTAS: { id: PerguntaGrafo; rotulo: string; frase: string }[] = [
  { id: 'tambem_comprou', rotulo: 'Quem comprou também comprou (2 saltos)', frase: 'os SKUs mais comprados por quem comprou este' },
  { id: 'alcance', rotulo: 'Alcance em 3 saltos', frase: 'quantos clientes NÃO compraram este, mas compraram o que os compradores dele compraram' },
]

const SOBRE: Record<PerguntaGrafo, { conceito: string; analogia: string; espere: string; fontes: IdFonte[] }> = {
  tambem_comprou: {
    conceito: 'Do SKU, volte para os clientes que o compraram e daí vá para tudo o que eles compraram; conte quantos clientes distintos levam a cada SKU (a força). No grafo, dois saltos por ponteiros; no SQL, quatro tabelas ligadas por JOIN e um GROUP BY.',
    analogia: 'Perguntar a cada pessoa da fila do caixa o que mais ela levou — o grafo já tem a lista na mão de cada pessoa; o SQL precisa procurar cada uma no arquivo.',
    espere: 'Os dois devolvem a mesma lista. Com poucos saltos e índices bons, o PostgreSQL costuma ser competitivo — às vezes mais rápido.',
    fontes: ['neo4j_match', 'pg_joins', 'livro_grafos'],
  },
  alcance: {
    conceito: 'Um salto a mais: de quem comprou X, para o que essas pessoas compraram, para quem mais comprou essas coisas (sem quem já comprou X). No SQL, mais JOINs — e as linhas intermediárias se multiplicam a cada um.',
    analogia: 'Os amigos dos amigos: cada salto multiplica quantas pessoas entram na conversa.',
    espere: 'A mesma contagem nos dois. O tempo do SQL cresce mais que o do grafo à medida que os saltos aumentam.',
    fontes: ['neo4j_unicidade', 'pg_with', 'livro_grafos'],
  },
}

export function GrafoPage() {
  const qc = useQueryClient()
  const [pergunta, setPergunta] = useState<PerguntaGrafo>('tambem_comprou')
  const skus = useQuery({ queryKey: ['grafo-skus'], queryFn: () => api<SkuParaOGrafo[]>('/lab/grafo/skus') })
  const [sku, setSku] = useState('')
  const escolhido = sku || skus.data?.[0]?.id || ''
  const estado = useQuery({ queryKey: ['grafo-estado'], queryFn: () => api<EstadoDoGrafo>('/recomendacoes/grafo'), retry: false })
  const reconstruir = useMutation({
    mutationFn: () => post<EstadoDoGrafo>('/recomendacoes/grafo/reconstruir', {}),
    onSuccess: (e) => qc.setQueryData(['grafo-estado'], e),
  })
  const rodar = useMutation({ mutationFn: () => post<ResultadoGrafo>('/lab/grafo', { pergunta, sku_id: escolhido }) })
  // Durante uma nova pergunta, o resultado anterior some (não confunde a leitura).
  const r = rodar.isPending ? undefined : rodar.data
  // O grafo e o SQL só conhecem o id do SKU; o nome que a pessoa reconhece
  // (produto · vendedor) está no catálogo do MongoDB e vem junto da resposta (Y5).
  const rotuloDaPartida = (s: SkuParaOGrafo) => s.nome || s.descricao
  const nomeDoSku = (id: string) => r?.nomes?.[id] || skus.data?.find((s) => s.id === id)?.nome || id.slice(0, 8)
  const e = reconstruir.data ?? estado.data

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório Grafo × SQL" />
      <Explicacao frase={<>A mesma pergunta — <em>"quem comprou isto também comprou…"</em> — feita a um banco de <strong>grafo</strong> (Neo4j, Cypher) e a um <strong>relacional</strong> (PostgreSQL, SQL), com o tempo e a resposta lado a lado.</>}
                  topico="8.8" doc="docs/07-nosql.md">
        <p>O grafo <code>(:Cliente)-[:COMPROU]-&gt;(:Sku)</code> é derivado dos pedidos do PostgreSQL. A API roda primeiro o SQL e depois o Cypher, um de cada vez, e confere se as duas respostas batem.</p>
      </Explicacao>

      <Conceito>
        <p>Num banco de <strong>grafo</strong>, os dados são nós ligados por relacionamentos, e cada nó aponta diretamente para os seus vizinhos. Perguntas sobre <em>conexões</em> — vizinhos dos vizinhos, caminhos, recomendações — são caminhar por esses ponteiros.</p>
        <p>No <strong>relacional</strong>, a mesma caminhada é feita com <code>JOIN</code>s: cada salto cruza tabelas, e o trabalho cresce com o tamanho delas e com o número de saltos.</p>
        <dl>
          <dt>Nó / relacionamento</dt><dd><code>(:Cliente)</code>, <code>(:Sku)</code> / <code>-[:COMPROU]-&gt;</code>.</dd>
          <dt>Salto</dt><dd>atravessar um relacionamento (no SQL, um ou mais JOINs).</dd>
          <dt>Força</dt><dd>quantos clientes distintos ligam o SKU escolhido a outro.</dd>
          <dt>Dado derivado</dt><dd>o grafo é uma cópia dos pedidos: pode ser apagado e refeito.</dd>
        </dl>
      </Conceito>
      <TutorialGrafo />
      <Ficha usos={['neo4j-grafo', 'pg-pedidos', 'mongo-catalogo']}>
        O lado grafo lê o Neo4j (serviço <code>neo4j</code>); o lado SQL lê <code>pedido</code> e <code>item_pedido</code> no PostgreSQL. Depois de medir, o nome de cada produto vem do catálogo no MongoDB (fora do tempo medido). O SKU do Laboratório de Concorrência fica de fora dos dois (as compras dele não passam pelo grafo).
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Grafo em dia</h3>
          <p className="small" role="status" aria-label="Estado do grafo">
            {e ? <>{e.clientes.toLocaleString('pt-BR')} clientes, {e.skus.toLocaleString('pt-BR')} SKUs e <strong>{e.compras.toLocaleString('pt-BR')} relacionamentos COMPROU</strong>{e.duracao_ms ? <> — reconstruído em {ms(e.duracao_ms)} a partir de {e.lidas_do_postgres?.toLocaleString('pt-BR')} linhas do PostgreSQL</> : null}.</>
              : estado.isError ? <span className="error">{estado.error.message}</span> : 'Lendo o grafo…'}
          </p>
          <button disabled={reconstruir.isPending} onClick={() => reconstruir.mutate()}>
            {reconstruir.isPending ? 'Reconstruindo (pode levar ~1 min)…' : 'Reconstruir o grafo a partir dos pedidos'}
          </button> <Banco nome="Neo4j" />
          {reconstruir.isError && <p className="error">{reconstruir.error.message}</p>}
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Pergunte</h3>
          <div className="estrategias" role="radiogroup" aria-label="Pergunta">
            {PERGUNTAS.map((p) => (
              <label key={p.id} className={`estrategia ${pergunta === p.id ? 'ativa' : ''}`}>
                <input type="radio" name="pergunta" checked={pergunta === p.id} onChange={() => setPergunta(p.id)} />
                <strong>{p.rotulo}</strong>
                <span className="muted small">{p.frase}</span>
              </label>
            ))}
          </div>
          <div className="form-linha">
            <label>SKU de partida
              <select value={escolhido} onChange={(ev) => setSku(ev.target.value)}>
                {skus.data?.map((s) => <option key={s.id} value={s.id}>{rotuloDaPartida(s)} · {s.compradores} compradores</option>)}
              </select>
            </label>
          </div>
          {/* Durante a reconstrução o grafo está pela metade: comparar agora daria "não batem" (Y3). */}
          <button className="primario" disabled={!escolhido || rodar.isPending || reconstruir.isPending} onClick={() => rodar.mutate()}>
            {rodar.isPending ? 'Perguntando…' : 'Perguntar aos dois bancos'}
          </button> <Banco nome="Neo4j" /> <Banco nome="PostgreSQL" />
          {rodar.isError && <p className="error">{rodar.error.message}</p>}
        </div>
      </div>

      <SobreOpcao titulo={PERGUNTAS.find((p) => p.id === pergunta)!.rotulo} {...SOBRE[pergunta]}
                  comando={r?.pergunta === pergunta ? `-- Cypher (Neo4j)\n${r.grafo.consulta}\n\n-- SQL (PostgreSQL)\n${r.sql.consulta}` : 'Rode para ver as duas consultas exatas.'} />
      <IlustracaoGrafoCompras saltos={pergunta === 'alcance' ? 3 : 2} />

      {r && (
        <>
          <ConclusaoGrafo r={r} nome={nomeDoSku} />
          <div className="graficos">
            <Barras titulo="Tempo da consulta (ms)" unidade="ms"
                    dados={[{ nome: 'Neo4j', v: r.grafo.ms, cor: 'var(--serie-1)' }, { nome: 'PostgreSQL', v: r.sql.ms, cor: 'var(--serie-2)' }]} />
          </div>
          {r.pergunta === 'tambem_comprou' && <TambemComprou r={r} nome={nomeDoSku} />}
          {r.pergunta === 'alcance' && r.explicacao && <ComoOAlcanceSeForma r={r} nome={nomeDoSku} />}
        </>
      )}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Quantos JOINs o SQL precisou para 2 saltos? E para 3? Por que dois por salto?</li>
        <li>Em qual das duas perguntas a diferença de tempo foi maior? O que isso diz sobre o custo de cada salto em cada banco?</li>
        <li>Por que o "alcance" exclui quem já comprou X? (Dica: unicidade de relacionamento no MATCH.)</li>
        <li>Se o Neo4j cair durante uma compra, o que acontece com o pedido? E com a recomendação?</li>
        <li>O PostgreSQL também tem <code>WITH RECURSIVE</code>. Quando ele bastaria, e quando um banco de grafo compensa?</li>
      </ol>

      <Fontes doc="07-nosql" ids={['neo4j_cypher', 'neo4j_match', 'neo4j_merge', 'neo4j_unicidade', 'neo4j_restricoes', 'neo4j_em_lotes',
        'neo4j_modelagem', 'neo4j_gql', 'pg_joins', 'pg_with', 'livro_grafos', 'ddia_modelos']} />
    </section>
  )
}

function ConclusaoGrafo({ r, nome }: { r: ResultadoGrafo; nome: (sku: string) => string }) {
  const forte = r.grafo.linhas[0]
  const maisRapido = r.grafo.ms <= r.sql.ms ? 'Neo4j' : 'PostgreSQL'
  const fator = Math.max(r.grafo.ms, r.sql.ms) / Math.max(Math.min(r.grafo.ms, r.sql.ms), 0.001)
  if (!r.iguais) {
    return (
      <Conclusao tipo="ruim" titulo="As respostas NÃO batem: a comparação de tempo não vale.">
        O grafo provavelmente está desatualizado (uma compra não chegou ao Neo4j, ou ele foi reconstruído antes de pedidos novos). Clique em "Reconstruir o grafo a partir dos pedidos" e pergunte de novo.
      </Conclusao>
    )
  }
  return (
    <Conclusao tipo="boa" titulo={`Os dois bancos deram a mesma resposta; o ${maisRapido} foi ${fator.toFixed(1)}× mais rápido.`}>
      {r.pergunta === 'alcance'
        ? <>{r.grafo.total.toLocaleString('pt-BR')} clientes alcançados em 3 saltos. </>
        : forte
          ? <>Quem comprou <strong>{nome(r.sku_id)}</strong> também comprou, antes de tudo, <strong>{nome(forte.sku_id)}</strong> ({forte.forca} {forte.forca === 1 ? 'cliente levou' : 'clientes levaram'} os dois) — e a lista dos 10 mais fortes é idêntica nos dois bancos. </>
          : <>Ninguém que comprou <strong>{nome(r.sku_id)}</strong> comprou outro produto — as duas listas vêm vazias. </>}
      Neo4j: {ms(r.grafo.ms)} · PostgreSQL: {ms(r.sql.ms)}. Como o grafo é pequeno (cabe na memória dos dois), a diferença vem de <em>como</em> cada um anda: ponteiros entre vizinhos no Neo4j, JOINs com índices no PostgreSQL. Rode as duas perguntas e veja qual cresce mais com o salto extra.
    </Conclusao>
  )
}

// O nome vem como "produto · vendedor": o produto em destaque, o vendedor
// menor (ele só desempata dois SKUs do mesmo produto). O " · " continua no
// texto (leitor de tela, testes), mas some da tela.
function NomeDoSku({ nome }: { nome: string }) {
  const i = nome.lastIndexOf(' · ')
  if (i < 0) return <strong>{nome}</strong>
  return <><strong>{nome.slice(0, i)}</strong><span className="vendedor"><span className="sep"> · </span>{nome.slice(i + 3)}</span></>
}

type Barra = { chave: string; nome: string; v: number; rotulo: string; frase: string }

// Barras horizontais em HTML: uma série só (uma cor, sem legenda — o título
// a nomeia), o número escrito na ponta, a frase inteira na dica (title).
function ListaDeBarras({ rotulo, barras }: { rotulo: string; barras: Barra[] }) {
  const max = Math.max(...barras.map((b) => b.v), 1)
  return (
    <ol className="barras-h" aria-label={rotulo}>
      {barras.map((b) => (
        <li key={b.chave} title={b.frase}>
          <span className="barras-h-nome"><NomeDoSku nome={b.nome} /></span>
          <span className="barras-h-trilho" aria-hidden="true"><span style={{ width: `${(b.v / max) * 100}%` }} /></span>
          <span className="barras-h-valor">{b.rotulo}</span>
        </li>
      ))}
    </ol>
  )
}

const clientes = (n: number, novos = false) => `${n.toLocaleString('pt-BR')} ${n === 1 ? (novos ? 'cliente novo' : 'cliente') : (novos ? 'clientes novos' : 'clientes')}`

// 2 saltos: a recomendação como se lê numa loja, e a tabela que confere os dois bancos.
function TambemComprou({ r, nome }: { r: ResultadoGrafo; nome: (sku: string) => string }) {
  const partida = nome(r.sku_id)
  return (
    <>
      <figure className="painel resposta-grafo" aria-label="Quem comprou também comprou">
        <h3>Quem comprou <NomeDoSku nome={partida} /> também comprou…</h3>
        {r.grafo.linhas.length === 0 ? <p className="muted">Ninguém que comprou este SKU comprou outro.</p> : (
          <ListaDeBarras rotulo="Quem comprou também comprou" barras={r.grafo.linhas.map((l) => ({
            chave: l.sku_id, nome: nome(l.sku_id), v: l.forca, rotulo: clientes(l.forca),
            frase: `Quem comprou ${partida} também comprou ${nome(l.sku_id)} — ${l.forca} ${l.forca === 1 ? 'cliente levou' : 'clientes levaram'} os dois.`,
          }))} />
        )}
        <figcaption className="small muted">
          A barra é a <strong>força</strong>: quantos clientes compraram os dois (resposta do Neo4j). Os bancos só conhecem o id do SKU; nome e vendedor vêm do catálogo. <UsoSelo id="mongo-catalogo" />
        </figcaption>
      </figure>
      <table aria-label="Resposta dos dois bancos" className="tabela-compacta">
        <caption className="small muted">A mesma lista nos dois bancos (clientes que compraram os dois)</caption>
        <thead><tr><th>#</th><th>Produto</th><th className="num">Neo4j</th><th className="num">PostgreSQL</th></tr></thead>
        <tbody>
          {r.grafo.linhas.map((l, i) => {
            const q = r.sql.linhas[i]
            const bate = q?.sku_id === l.sku_id && q?.forca === l.forca
            return (
              <tr key={i} className={bate ? undefined : 'ruim'}>
                <td>{i + 1}</td><td className="produto">{nome(l.sku_id)}</td><td className="num">{l.forca}</td>
                <td className="num">{!q ? '—' : q.sku_id === l.sku_id ? q.forca : `${q.forca} (${nome(q.sku_id)})`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

// 3 saltos: o total sozinho não ensina; o funil mostra cada salto e por
// quais produtos do meio se chega aos clientes novos.
function ComoOAlcanceSeForma({ r, nome }: { r: ResultadoGrafo; nome: (sku: string) => string }) {
  const e = r.explicacao!
  const partida = nome(r.sku_id)
  return (
    <figure className="painel resposta-grafo" aria-label="Como o alcance se forma">
      <h3>Quem comprou <NomeDoSku nome={partida} /> alcança, em 3 saltos, {clientes(r.grafo.total, true)}</h3>
      <ol className="funil-grafo" aria-label="Os três saltos">
        <li><span className="salto">1º salto</span><strong>{clientes(e.compradores)}</strong><span>compraram este produto</span></li>
        <li><span className="salto">2º salto</span><strong>{e.intermediarios.toLocaleString('pt-BR')} {e.intermediarios === 1 ? 'outro produto' : 'outros produtos'}</strong><span>que esses clientes também compraram</span></li>
        <li><span className="salto">3º salto</span><strong>{clientes(r.grafo.total, true)}</strong><span>compraram algum desses produtos sem nunca ter comprado este</span></li>
      </ol>
      {e.caminhos.length > 0 && <>
        <h4>Por onde o alcance passa: os {e.caminhos.length} caminhos mais fortes</h4>
        <table aria-label="Caminhos do alcance" className="tabela-compacta">
          <thead><tr><th>Produto do meio (2º salto)</th><th className="num">Compradores deste que o levaram</th><th className="num">Clientes novos que ele alcança</th></tr></thead>
          <tbody>
            {e.caminhos.map((c) => (
              <tr key={c.sku_id} title={`Quem comprou ${partida} também comprou ${nome(c.sku_id)} (${clientes(c.forca)}); e ${nome(c.sku_id)} foi comprado por ${clientes(c.novos)} que nunca compraram ${partida}.`}>
                <td><NomeDoSku nome={nome(c.sku_id)} /></td><td className="num">{c.forca.toLocaleString('pt-BR')}</td><td className="num">{c.novos.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
      <figcaption className="small muted">
        Leia cada linha como: quem comprou este também comprou o produto do meio; e o produto do meio foi comprado por clientes que nunca compraram este. Um cliente novo pode chegar por mais de um caminho: por isso a soma passa do total. Nomes do catálogo. <UsoSelo id="mongo-catalogo" />
      </figcaption>
    </figure>
  )
}
