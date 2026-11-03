import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { post, ESTRATEGIAS, type CorridaParams, type CorridaResultado, type Estrategia } from '../../api/client'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { TutorialConcorrencia } from '../../components/tutoriais'

// Laboratório de Concorrência (Fase 1, docs/03-transacoes-acid.md).

// O conceito de cada estratégia, mostrado em "Sobre esta opção".
const DETALHES: Record<Estrategia, { conceito: string; analogia: string; comando: string; espere: string; fontes: IdFonte[] }> = {
  ingenua: {
    conceito: 'A aplicação LÊ o estoque, DECIDE no código ("tem 1, pode vender") e GRAVA o número que calculou. Entre ler e gravar, outra compra pode ler o mesmo valor. As duas decidem "pode" e as duas gravam "0": uma venda some da conta. Isso é o lost update (atualização perdida). Está errada de propósito: é o contraexemplo da aula.',
    analogia: 'Dois caixas olham a mesma prateleira com 1 console, os dois dizem "tem!" ao cliente e cada um anota "estoque: 0". Venderam 2 consoles que não existem.',
    comando: `BEGIN; -- READ COMMITTED
SELECT quantidade FROM estoque WHERE sku_id = $1;          -- lê 1
-- (no Go) se 1 >= 1 então novo = 1 - 1
UPDATE estoque SET quantidade = 0 WHERE sku_id = $1;       -- grava o valor calculado
COMMIT;`,
    espere: 'Vendas a mais (vendidos > estoque inicial) e um estoque final que não fecha a conta. Aumente o atraso para piorar.',
    fontes: ['berenson', 'pg_rc', 'ddia_transacoes'],
  },
  for_update: {
    conceito: 'Lock pessimista: o SELECT ... FOR UPDATE trava a linha do estoque até o fim da transação. Quem chega depois ESPERA na fila; quando a primeira confirma, a próxima lê o valor já atualizado.',
    analogia: 'O caixa pega a prateleira para si ("é minha até eu terminar"). Os outros esperam ele devolver e olham de novo.',
    comando: `BEGIN;
SELECT quantidade FROM estoque WHERE sku_id = $1 FOR UPDATE; -- trava a linha
-- (no Go) confere se há estoque
UPDATE estoque SET quantidade = quantidade - 1 WHERE sku_id = $1;
COMMIT;                                                         -- libera a linha`,
    espere: 'Exatamente o estoque inicial vendido. Com atraso alto, a fila de locks aparece no Painel do DBA → PostgreSQL.',
    fontes: ['pg_locks_linha', 'pg_for_update'],
  },
  condicional: {
    conceito: 'A verificação e a escrita viram UM comando: "tire 1 SE ainda houver pelo menos 1". O UPDATE trava a linha só durante ele mesmo e reavalia a condição com o valor mais novo. Se 0 linhas forem afetadas, não havia estoque.',
    analogia: 'Em vez de olhar a prateleira e depois pegar, o caixa estende a mão direto: se tiver produto, pega; se não, a mão volta vazia.',
    comando: `UPDATE estoque
   SET quantidade = quantidade - 1
 WHERE sku_id = $1 AND quantidade >= 1;
-- 0 linhas afetadas = sem estoque`,
    espere: 'Correto e o mais rápido: segura o lock pelo menor tempo possível. É a estratégia que a loja usa.',
    fontes: ['pg_rc', 'pg_update'],
  },
  serializavel: {
    conceito: 'O mesmo código da ingênua, mas em SERIALIZABLE: o PostgreSQL deixa todo mundo ler sem esperar e, ao perceber que duas transações não poderiam ter acontecido uma depois da outra, ABORTA uma delas (erro 40001). A aplicação precisa repetir a transação abortada.',
    analogia: 'Os caixas vendem à vontade, mas um fiscal confere no fechamento; se duas vendas usaram a mesma última unidade, ele cancela uma e manda refazer.',
    comando: `BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT quantidade FROM estoque WHERE sku_id = $1;
UPDATE estoque SET quantidade = 0 WHERE sku_id = $1;
COMMIT;  -- pode falhar com 40001 → a API repete (até 5 vezes)`,
    espere: 'Nunca vende a mais, mas com várias retentativas. Com disputa muito alta, alguns compradores recebem erro depois de esgotar as tentativas.',
    fontes: ['pg_ser', 'pg_erros', 'ssi_artigo'],
  },
}

export function ConcorrenciaPage() {
  const [params, setParams] = useState<CorridaParams>({ estrategia: 'ingenua', compradores: 50, estoque_inicial: 5, atraso_ms: 0 })
  const [historico, setHistorico] = useState<CorridaResultado[]>([])
  const corrida = useMutation({
    mutationFn: (p: CorridaParams) => post<CorridaResultado>('/lab/corrida', p),
    onSuccess: (r) => setHistorico((h) => [r, ...h].slice(0, 30)),
  })
  const num = (campo: keyof CorridaParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setParams((p) => ({ ...p, [campo]: Number(e.target.value) }))
  const ultimo = historico[0]

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Concorrência" />
      <Explicacao frase={<>Várias pessoas tentam comprar <strong>o último item</strong> ao mesmo tempo. Se o código ler o estoque e só depois gravar, duas compras podem ler "1" e as duas vendem — o estoque mente.</>}
                  topico="8.4" doc="docs/03-transacoes-acid.md §9">
        <p>Cada comprador é uma goroutine com a sua transação no PostgreSQL. Todas partem juntas.</p>
        <p>O "atraso" alarga o intervalo entre ler e gravar: com 500 ms, abra o <Link to="/dba?aba=postgres">Painel do DBA</Link> em outra aba e veja a fila de locks.</p>
      </Explicacao>

      <Conceito>
        <p>Quando duas pessoas compram ao mesmo tempo, cada compra roda numa <strong>transação</strong> separada no PostgreSQL. O problema clássico é a <strong>condição de corrida</strong>: o resultado depende de quem chegou primeiro em cada passo.</p>
        <p>O ponto frágil é o intervalo entre <em>ler</em> o estoque e <em>gravar</em> o estoque novo. Se a decisão é tomada com um valor que outra transação já mudou, o banco grava um número errado — sem violar nenhuma regra.</p>
        <p>Há três jeitos corretos de fechar esse intervalo: <strong>travar a linha</strong> antes de ler (FOR UPDATE), <strong>juntar ler e gravar num comando só</strong> (UPDATE condicional) ou deixar o <strong>banco detectar o conflito</strong> e abortar (SERIALIZABLE). Escolha uma estratégia abaixo para ver como cada uma funciona.</p>
      </Conceito>
      <TutorialConcorrencia />
      <Ficha usos={['pg-estoque', 'pg-pedidos']}>
        Cada comprador cria um pedido de verdade para o SKU "Console Edição Limitada" (só ele é disputado; o laboratório redefine o estoque dele a cada corrida).
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha a estratégia</h3>
          <div className="estrategias">
            {ESTRATEGIAS.map((e) => (
              <label key={e.valor} className={`estrategia ${params.estrategia === e.valor ? 'ativa' : ''}`}>
                <input type="radio" name="estrategia" checked={params.estrategia === e.valor}
                       onChange={() => setParams((p) => ({ ...p, estrategia: e.valor as Estrategia }))} />
                <strong>{e.nome}</strong>
                <span className="muted small">{e.descricao}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Monte a disputa e rode</h3>
          <div className="form-linha">
            <label>Compradores <input type="number" min={1} max={200} value={params.compradores} onChange={num('compradores')} /></label>
            <label>Estoque inicial <input type="number" min={0} max={1000} value={params.estoque_inicial} onChange={num('estoque_inicial')} /></label>
            <label>Atraso entre ler e gravar (ms) <input type="number" min={0} max={2000} step={50} value={params.atraso_ms} onChange={num('atraso_ms')} /></label>
          </div>
          <button className="primario" disabled={corrida.isPending} onClick={() => corrida.mutate(params)}>
            {corrida.isPending ? 'Correndo…' : 'Iniciar corrida'}
          </button> <Banco nome="PostgreSQL" />
          {corrida.isError && <p className="error">{corrida.error.message}</p>}
        </div>
      </div>

      <SobreOpcao titulo={ESTRATEGIAS.find((e) => e.valor === params.estrategia)!.nome} {...DETALHES[params.estrategia]} />

      {ultimo && <ConclusaoCorrida r={ultimo} />}

      {historico.length > 0 && (
        <>
          <h2>Histórico das corridas</h2>
          <table aria-label="Resultados das corridas">
            <thead>
              <tr>
                <th>Estratégia</th><th>Compradores</th><th>Estoque inicial</th><th>Atraso</th>
                <th>Vendidos</th><th>Sem estoque</th><th>Erros</th><th>Retentativas</th>
                <th>Estoque final</th><th>Vendas a mais</th><th>Duração</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((r, i) => (
                <tr key={i} className={r.consistente ? undefined : 'blocked'}>
                  <td>{ESTRATEGIAS.find((e) => e.valor === r.estrategia)?.nome}</td>
                  <td className="num">{r.compradores}</td>
                  <td className="num">{r.estoque_inicial}</td>
                  <td className="num">{r.atraso_ms} ms</td>
                  <td className="num"><strong>{r.vendidos}</strong></td>
                  <td className="num">{r.sem_estoque}</td>
                  <td className="num" title={r.primeiro_erro}>{r.erros}</td>
                  <td className="num">{r.retentativas}</td>
                  <td className="num">{r.estoque_final}</td>
                  <td className="num">{r.vendas_a_mais > 0 ? <strong className="error">{r.vendas_a_mais}</strong> : 0}</td>
                  <td className="num">{r.duracao_ms.toFixed(0)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Por que a estratégia ingênua vende mais que o estoque? Que anomalia é essa?</li>
        <li>Na ingênua, por que o estoque final não bate com "inicial − vendidos"?</li>
        <li>FOR UPDATE e UPDATE condicional dão o mesmo resultado. Qual segura o lock por menos tempo?</li>
        <li>Por que o SERIALIZABLE precisa de retentativas? O que acontece se elas se esgotarem?</li>
        <li>Rode a ingênua com 1 comprador. Ela está errada mesmo sem concorrência?</li>
      </ol>

      <Fontes doc="03-transacoes-acid" ids={['pg_transacoes', 'pg_rc', 'pg_locks_linha', 'pg_for_update', 'pg_update', 'pg_ser', 'pg_rr', 'pg_deadlocks', 'pg_erros', 'pg_app_consistencia',
        'ddia_transacoes', 'elmasri_transacoes', 'berenson', 'ssi_artigo', 'hermitage']} />
    </section>
  )
}

function ConclusaoCorrida({ r }: { r: CorridaResultado }) {
  if (r.vendas_a_mais > 0 || !r.consistente) {
    return (
      <Conclusao tipo="ruim" titulo={`${r.vendidos} vendas com ${r.estoque_inicial} em estoque: ${r.vendas_a_mais} a mais.`}>
        Isto é o <strong>lost update</strong>: várias transações leram o mesmo estoque, decidiram "tem" e gravaram por cima umas das outras.
        O estoque final ({r.estoque_final}) nem fecha a conta — e nenhuma regra do banco foi violada.
      </Conclusao>
    )
  }
  return (
    <Conclusao tipo="boa" titulo={`${r.vendidos} vendas para ${r.estoque_inicial} em estoque: correto.`}>
      {r.estrategia === 'serializavel'
        ? <>O PostgreSQL deixou todas lerem e abortou quem conflitou (erro 40001); a API repetiu {r.retentativas} vez(es).</>
        : <>A linha do estoque foi travada: quem chegou depois esperou o COMMIT de quem chegou antes e leu o valor novo.</>}
      {r.erros > 0 && <> {r.erros} comprador(es) receberam erro depois de esgotar as tentativas — mas ninguém comprou a mais.</>}
    </Conclusao>
  )
}
