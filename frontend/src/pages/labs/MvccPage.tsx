import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, type EstadoMVCC, type ResultadoMVCC } from '../../api/client'
import { Async } from '../../components/Async'
import { Conceito, Conclusao, Explicacao, SobreOpcao, Stat, Titulo, bytes, inteiro, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes, type IdFonte } from '../../components/fontes'
import { TutorialMvcc } from '../../components/tutoriais'

// Laboratório de MVCC e VACUUM (Fase 4, tópico 8.7). Tabela lab.inchaco,
// 20 mil linhas, autovacuum desligado de propósito.

type Acao = { id: string; rotulo: string; fillfactor?: number; grupo: number; resumo: string; conceito: string; comando: string; espere: string; fontes: IdFonte[] }

const ACOES: Acao[] = [
  { id: 'recriar', rotulo: 'Recriar com fillfactor 100', fillfactor: 100, grupo: 1,
    resumo: 'Páginas 100% cheias.',
    conceito: 'Apaga tudo e insere 20 mil linhas de novo, enchendo cada página até 100%. Não sobra espaço livre dentro das páginas.',
    comando: `ALTER TABLE lab.inchaco SET (fillfactor = 100);
TRUNCATE lab.inchaco;
INSERT INTO lab.inchaco SELECT g, 0, g, repeat('x', 150) FROM generate_series(1, 20000) g;`,
    espere: 'Tabela compacta (~3,8 MB), zero tuplas mortas, ~1,6% livre.',
    fontes: ['pg_fillfactor', 'pg_pagina'] },
  { id: 'recriar', rotulo: 'Recriar com fillfactor 70', fillfactor: 70, grupo: 1,
    resumo: 'Cada página fica 30% vazia, reservada para versões novas.',
    conceito: 'O fillfactor diz até quanto cada página é enchida num INSERT. Com 70%, sobram 30% em cada página para as versões novas que os UPDATEs vão criar — é isso que permite o HOT update.',
    comando: `ALTER TABLE lab.inchaco SET (fillfactor = 70);
TRUNCATE lab.inchaco;
INSERT INTO lab.inchaco SELECT g, 0, g, repeat('x', 150) FROM generate_series(1, 20000) g;`,
    espere: 'Tabela ~40% maior (~5,4 MB), com ~30% de espaço livre. Agora rode o UPDATE em coluna sem índice.',
    fontes: ['pg_fillfactor', 'pg_hot'] },
  { id: 'atualizar', rotulo: 'UPDATE coluna sem índice (10%)', grupo: 2,
    resumo: 'Altera "valor", que não tem índice, em 2 mil linhas.',
    conceito: 'Cada linha alterada ganha uma VERSÃO NOVA; a antiga vira tupla morta. Se a coluna não tem índice e há espaço na mesma página, a versão nova fica ali ao lado (HOT): nenhum índice precisa ser atualizado.',
    comando: `UPDATE lab.inchaco SET valor = valor + 1 WHERE id % 10 = 0;  -- 2.000 linhas`,
    espere: 'Fillfactor 100: 0 HOT e a tabela cresce. Fillfactor 70: 2.000 de 2.000 HOT, a tabela não cresce e o WAL é ~6× menor.',
    fontes: ['pg_hot', 'pg_mvcc', 'interdb_hot', 'pg_wal'] },
  { id: 'atualizar_indexada', rotulo: 'UPDATE coluna indexada (10%)', grupo: 2,
    resumo: 'Altera "indexada", que tem índice, em 2 mil linhas.',
    conceito: 'Se a coluna alterada tem índice, o índice precisa apontar para a versão nova — então o HOT nunca acontece, mesmo com espaço livre na página.',
    comando: `UPDATE lab.inchaco SET indexada = indexada + 1 WHERE id % 10 = 0;  -- 2.000 linhas`,
    espere: '0 HOT, sempre. 2.000 tuplas mortas novas e mais WAL (a tabela e o índice foram alterados).',
    fontes: ['pg_hot', 'interdb_hot'] },
  { id: 'vacuum', rotulo: 'VACUUM', grupo: 3,
    resumo: 'Recolhe as tuplas mortas; o arquivo não encolhe.',
    conceito: 'O VACUUM percorre a tabela, remove as versões mortas que nenhuma transação aberta ainda pode ver e marca o espaço como reutilizável. Não trava leituras nem escritas. O arquivo continua do mesmo tamanho: o espaço fica para os próximos INSERTs/UPDATEs.',
    comando: `VACUUM lab.inchaco;`,
    espere: 'Tuplas mortas → 0, tamanho igual, espaço livre maior. Se sobrarem mortas, uma transação aberta está segurando o "horizonte" — o laboratório mostra qual.',
    fontes: ['pg_vacuum_rotina', 'pg_vacuum_cmd', 'interdb_vacuum'] },
  { id: 'vacuum_full', rotulo: 'VACUUM FULL', grupo: 3,
    resumo: 'Reescreve a tabela inteira; devolve espaço ao disco.',
    conceito: 'Copia só as linhas vivas para um arquivo novo e apaga o antigo. Devolve o espaço ao sistema operacional, mas trava a tabela (nem leitura, nem escrita) enquanto copia. Em produção usa-se pg_repack, que faz o mesmo sem travar.',
    comando: `VACUUM FULL lab.inchaco;`,
    espere: 'Tamanho volta ao compacto (~3,8 MB) e espaço livre ~0%. Gera bastante WAL (reescreveu tudo).',
    fontes: ['pg_vacuum_cmd', 'pg_repack'] },
]

export function MvccPage() {
  const qc = useQueryClient()
  const estado = useQuery({ queryKey: ['mvcc'], queryFn: () => api<EstadoMVCC>('/lab/mvcc') })
  const [historico, setHistorico] = useState<ResultadoMVCC[]>([])
  const acao = useMutation({
    mutationFn: (a: { acao: string; fillfactor?: number }) => post<ResultadoMVCC>('/lab/mvcc', a),
    onSuccess: (r) => { setHistorico((h) => [r, ...h].slice(0, 20)); qc.setQueryData(['mvcc'], r.depois) },
  })
  const ultimo = historico[0]
  const [acaoVista, setAcaoVista] = useState<Acao>(ACOES[0])

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de MVCC e VACUUM" />
      <Explicacao frase={<>No PostgreSQL, um <strong>UPDATE não apaga a linha antiga</strong>: grava uma versão nova e deixa a velha "morta" para quem ainda estiver lendo. O <strong>VACUUM</strong> recolhe as mortas — e só o VACUUM FULL devolve o espaço ao disco.</>}
                  topico="8.7 · 8.4" doc="docs/06-postgresql-admin.md §3">
        <p><strong>MVCC</strong> (controle de concorrência por múltiplas versões): leitores não bloqueiam escritores porque cada um vê a versão certa para o seu momento. O custo são as versões mortas.</p>
        <p><strong>HOT update</strong>: se a coluna alterada não tem índice <em>e</em> há espaço livre na mesma página, a versão nova fica ao lado da velha e os índices nem são tocados. O <code>fillfactor</code> reserva esse espaço.</p>
        <p><strong>VACUUM</strong> marca o espaço das mortas como reutilizável (rápido, sem travar). <strong>VACUUM FULL</strong> reescreve a tabela inteira (devolve espaço, mas trava leituras e escritas enquanto roda). A linha 1 mostra o <code>ctid</code> (página, posição) e o <code>xmin</code> (transação que criou a versão).</p>
      </Explicacao>

      <Conceito>
        <p>Imagine que o PostgreSQL nunca apaga nem sobrescreve uma linha na hora. Um <strong>UPDATE</strong> grava uma <strong>versão nova</strong> e marca a antiga como "morta a partir da transação X". Um <strong>DELETE</strong> só marca. Isso é o <strong>MVCC</strong> (controle de concorrência com múltiplas versões): quem começou a ler antes continua vendo a versão antiga, sem travar ninguém.</p>
        <p>O preço: as versões mortas ocupam espaço até alguém limpar. Esse alguém é o <strong>VACUUM</strong> (que o <em>autovacuum</em> roda sozinho em produção — aqui está desligado para você ver o efeito).</p>
        <dl>
          <dt>Página</dt><dd>bloco de 8 KB onde as linhas ficam gravadas.</dd>
          <dt>Tupla</dt><dd>uma versão de uma linha. "Viva" = a atual; "morta" = substituída ou apagada.</dd>
          <dt>ctid</dt><dd>endereço físico da tupla: (página, posição). Muda quando o UPDATE cria a versão nova em outro lugar.</dd>
          <dt>xmin / xmax</dt><dd>número da transação que criou / que "matou" aquela versão.</dd>
          <dt>fillfactor</dt><dd>até quanto cada página é enchida num INSERT (o resto fica reservado para UPDATEs).</dd>
          <dt>HOT update</dt><dd>versão nova na mesma página, sem mexer em nenhum índice (o caso barato).</dd>
          <dt>WAL</dt><dd>o diário de alterações que vai para o disco antes de tudo (e para réplicas e backup). Mais alteração = mais WAL.</dd>
        </dl>
      </Conceito>
      <TutorialMvcc />
      <Ficha usos={['pg-lab']}>
        Tabela lab.inchaco: 20 mil linhas de ~190 bytes, com índice só na coluna "indexada" e autovacuum desligado. As contagens de tuplas vêm da extensão pgstattuple (exatas: ela lê a tabela inteira).
      </Ficha>

      <h2>Estado de <code>lab.inchaco</code></h2>
      <Async query={estado}>
        {(e) => (
          <dl className="stats" aria-label="Estado da tabela">
            <Stat rotulo="fillfactor" valor={`${e.fillfactor}%`} />
            <Stat rotulo="Tamanho da tabela" valor={bytes(e.bytes_tabela)} />
            <Stat rotulo="Tuplas vivas" valor={inteiro(e.tuplas_vivas)} />
            <Stat rotulo="Tuplas mortas" valor={inteiro(e.tuplas_mortas)} />
            <Stat rotulo="Espaço livre" valor={`${e.pct_livre.toFixed(1)}%`} detalhe={bytes(e.bytes_livres)} />
            <Stat rotulo="Linha 1" valor={<code className="small">{e.linha_1}</code>} />
          </dl>
        )}
      </Async>

      <div className="passos">
        {[1, 2, 3].map((g) => (
          <div className="passo" key={g}>
            <span className="numero">{g}</span>
            <h3>{['', 'Prepare a tabela', 'Atualize linhas', 'Limpe'][g]}</h3>
            <div className="form-linha">
              {ACOES.filter((a) => a.grupo === g).map((a) => (
                <div key={a.rotulo}>
                  <button disabled={acao.isPending} onMouseEnter={() => setAcaoVista(a)} onFocus={() => setAcaoVista(a)}
                          onClick={() => { setAcaoVista(a); acao.mutate({ acao: a.id, fillfactor: a.fillfactor }) }}>{a.rotulo}</button>
                  <div className="muted small">{a.resumo}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {acao.isError && <p className="error">{acao.error.message}</p>}
      <SobreOpcao titulo={acaoVista.rotulo} conceito={acaoVista.conceito} comando={acaoVista.comando} espere={acaoVista.espere} fontes={acaoVista.fontes} />
      {ultimo && <ConclusaoMVCC r={ultimo} />}

      {historico.length > 0 && (
        <table aria-label="Histórico de ações">
          <thead><tr><th>Ação</th><th>Tamanho</th><th>Mortas</th><th>HOT</th><th>WAL gerado</th><th>Duração</th><th>Linha 1</th></tr></thead>
          <tbody>
            {historico.map((r, i) => (
              <tr key={i}>
                <td>{r.acao}{r.acao === 'recriar' ? ` (ff ${r.depois.fillfactor})` : ''}</td>
                <td className="num">{bytes(r.antes.bytes_tabela)} → {bytes(r.depois.bytes_tabela)}</td>
                <td className="num">{inteiro(r.antes.tuplas_mortas)} → {inteiro(r.depois.tuplas_mortas)}</td>
                <td className="num">{r.atualizadas ? `${inteiro(r.hot ?? 0)} de ${inteiro(r.atualizadas)}` : '—'}</td>
                <td className="num">{bytes(r.wal_bytes)}</td>
                <td className="num">{ms(r.duracao_ms)}</td>
                <td><code className="small">{r.depois.linha_1}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Depois do UPDATE, por que a tabela cresceu se o número de linhas é o mesmo?</li>
        <li>Com fillfactor 100, quantos updates foram HOT? E com 70? Por quê?</li>
        <li>Rode VACUUM e depois o mesmo UPDATE de novo: a tabela cresce outra vez?</li>
        <li>Por que o autovacuum existe, se o VACUUM manual funciona?</li>
      </ol>

      <Fontes doc="06-postgresql-admin" ids={['pg_mvcc', 'pg_pagina', 'pg_colunas_sistema', 'pg_hot', 'pg_fillfactor', 'pg_vacuum_rotina', 'pg_vacuum_cmd', 'pg_autovacuum',
        'pg_autovacuum_cfg', 'pg_pgstattuple', 'pg_idle_tx', 'pg_wal', 'interdb_concorrencia', 'interdb_vacuum', 'interdb_hot', 'interdb_wal', 'pg_repack']} />
    </section>
  )
}

function ConclusaoMVCC({ r }: { r: ResultadoMVCC }) {
  const a = r.antes, d = r.depois
  switch (r.acao) {
    case 'recriar':
      return <Conclusao tipo="neutra" titulo={`Tabela recriada com ${inteiro(d.tuplas_vivas)} linhas e fillfactor ${d.fillfactor}%.`}>
        Cada página foi preenchida até {d.fillfactor}%{d.fillfactor < 100 ? `, sobrando ${100 - d.fillfactor}% para versões novas` : ' — sem espaço sobrando'}. Tamanho: {bytes(d.bytes_tabela)}.
      </Conclusao>
    case 'atualizar':
    case 'atualizar_indexada': {
      const hot = r.hot ?? 0, total = r.atualizadas ?? 0
      return <Conclusao tipo={hot === total ? 'boa' : 'ruim'} titulo={`${inteiro(total)} linhas atualizadas → ${inteiro(d.tuplas_mortas - a.tuplas_mortas)} tuplas mortas novas; ${inteiro(hot)} foram HOT.`}>
        {r.acao === 'atualizar_indexada'
          ? 'A coluna alterada tem índice: todo índice precisa apontar para a versão nova, então nenhum update pode ser HOT.'
          : hot === total ? 'Havia espaço livre na própria página: a versão nova ficou ao lado da velha, sem tocar os índices e sem crescer a tabela.'
            : 'As páginas estavam cheias: as versões novas foram para outras páginas (e os índices tiveram de ser atualizados).'}
        {' '}A tabela foi de {bytes(a.bytes_tabela)} para {bytes(d.bytes_tabela)}; o WAL recebeu {bytes(r.wal_bytes)}.
      </Conclusao>
    }
    case 'vacuum':
      if (d.tuplas_mortas > 0) {
        return <Conclusao tipo="ruim" titulo={`VACUUM recolheu ${inteiro(a.tuplas_mortas - d.tuplas_mortas)}, mas ${inteiro(d.tuplas_mortas)} versões mortas ainda não puderam ser removidas.`}>
          Alguma transação aberta começou antes do UPDATE e ainda pode precisar enxergar as versões antigas (o "horizonte" do VACUUM).
          {r.horizonte && <> Transação mais antiga agora: <code>{r.horizonte}</code>.</>} Rode o VACUUM de novo daqui a pouco — transações longas
          são o motivo mais comum de tabelas inchadas em produção.
        </Conclusao>
      }
      return <Conclusao tipo="neutra" titulo={`VACUUM: ${inteiro(a.tuplas_mortas)} tuplas mortas recolhidas; o tamanho continua ${bytes(d.bytes_tabela)}.`}>
        O espaço virou "livre para reuso" ({d.pct_livre.toFixed(0)}% da tabela) — o próximo UPDATE usa esse espaço em vez de crescer. O arquivo não encolhe.
      </Conclusao>
    default:
      return <Conclusao tipo="neutra" titulo={`VACUUM FULL: tabela reescrita de ${bytes(a.bytes_tabela)} para ${bytes(d.bytes_tabela)} em ${ms(r.duracao_ms)}.`}>
        Devolveu o espaço ao disco, mas segurou um lock exclusivo durante a reescrita: ninguém leu nem escreveu na tabela nesse tempo. Em produção, prefira <code>pg_repack</code>.
      </Conclusao>
  }
}
