import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, type InfoBackup, type ResultadoBackup, type ResultadoPITR } from '../../api/client'
import { Async } from '../../components/Async'
import { Fontes, type IdFonte } from '../../components/fontes'
import { TutorialBackup } from '../../components/tutoriais'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, bytes, inteiro, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'

// Laboratório de Backup e PITR (Fase 5, tópico 8.10, docs/08).

type Tipo = 'full' | 'diff' | 'incr'
type Alvo = ResultadoPITR['alvo']

const SOBRE_TIPO: Record<Tipo, { titulo: string; conceito: string; analogia: string; espere: string; fontes: IdFonte[] }> = {
  full: {
    titulo: 'Backup full', conceito: 'Copia todos os arquivos do cluster. Não depende de nenhum outro backup: sozinho (mais o WAL) ele restaura o banco.',
    analogia: 'Fotocopiar o livro inteiro.', espere: 'O maior e o mais demorado — o tamanho do banco (comprimido no repositório).',
    fontes: ['pgbackrest_tipos', 'pg_backup'],
  },
  diff: {
    titulo: 'Backup diferencial', conceito: 'Copia o que mudou desde o último FULL. Para restaurar: o full + este diferencial.',
    analogia: 'Fotocopiar só as páginas alteradas desde a cópia completa.', espere: 'Bem menor que o full; cresce ao longo da semana, até o próximo full.',
    fontes: ['pgbackrest_tipos', 'pgbackrest_comandos'],
  },
  incr: {
    titulo: 'Backup incremental', conceito: 'Copia o que mudou desde o último backup de QUALQUER tipo. Para restaurar: a cadeia inteira até o full.',
    analogia: 'Fotocopiar só as páginas alteradas desde a última fotocópia, qualquer que tenha sido.', espere: 'O menor e o mais rápido; a referência mostra de quem ele depende.',
    fontes: ['pgbackrest_tipos', 'pgbackrest_comandos'],
  },
}

const SOBRE_ALVO: Record<Alvo, { titulo: string; conceito: string; espere: string }> = {
  'antes-do-drop': {
    titulo: 'Alvo: logo antes do DROP',
    conceito: 'O instante-alvo é marcado depois do lote 2 e antes do DROP. A recuperação reaplica o WAL até ali e para: o DROP fica de fora.',
    espere: 'As 1.500 linhas de volta. Perda (RPO) zero para esta tabela.',
  },
  'antes-do-lote2': {
    titulo: 'Alvo: entre os dois lotes',
    conceito: 'O instante-alvo fica entre o lote 1 e o lote 2. Tudo o que veio depois — o lote 2 e o DROP — fica de fora.',
    espere: 'Só as 1.000 linhas do lote 1. As 500 do lote 2 se perdem de propósito: escolher o alvo é escolher o que se perde.',
  },
}

export function BackupPage() {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['backups'], queryFn: () => api<InfoBackup>('/lab/backup') })
  const [tipo, setTipo] = useState<Tipo>('full')
  const [alvo, setAlvo] = useState<Alvo>('antes-do-drop')
  const backup = useMutation({
    mutationFn: () => post<ResultadoBackup>('/lab/backup', { tipo }),
    onSuccess: (r) => qc.setQueryData(['backups'], r.info),
  })
  const pitr = useMutation({
    mutationFn: () => post<ResultadoPITR>('/lab/pitr', { alvo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Backup e PITR" />
      <Explicacao frase={<>A réplica copia os erros também: um <code>DROP TABLE</code> chega nela em milissegundos. <strong>Backup + WAL arquivado</strong> permitem voltar o banco a <strong>qualquer instante</strong> do passado (PITR).</>}
                  topico="8.10" doc="docs/08-replicacao-backup.md §3.2">
        <p>O pgBackRest roda dentro do container do PostgreSQL. A API o dispara com <code>COPY … FROM PROGRAM</code> — um poder de superusuário que a Fase 6 vai tirar dela.</p>
        <p>O PITR acontece numa <strong>instância à parte</strong> (porta 5433) que é desligada e apagada no fim: o banco da loja não é tocado.</p>
      </Explicacao>

      <Conceito>
        <p><strong>Backup</strong> é uma cópia de um momento passado, para voltar no tempo quando algo dá errado — um erro humano, um bug que apaga dados, um disco que morre. Replicação não serve para isso: ela copia o erro junto.</p>
        <p>O PostgreSQL guarda toda alteração no <strong>WAL</strong>. Com um <strong>backup físico</strong> (a cópia dos arquivos) mais o WAL arquivado desde ele, dá para reconstruir o banco em <em>qualquer</em> instante: é o <strong>PITR</strong> (<em>point-in-time recovery</em>).</p>
        <dl>
          <dt>Full / diff / incr</dt><dd>tudo / o que mudou desde o último full / o que mudou desde o último backup.</dd>
          <dt>Arquivamento</dt><dd>cada segmento de WAL de 16 MB copiado para o repositório assim que fica completo.</dd>
          <dt>RPO</dt><dd>quanto dado se perde. RTO: quanto tempo leva para recuperar.</dd>
          <dt>Stanza</dt><dd>no pgBackRest, a configuração de backup de um cluster (aqui, <code>main</code>).</dd>
        </dl>
      </Conceito>
      <TutorialBackup />
      <Ficha usos={['pg-backup', 'pg-lab']}>
        Os backups vão para o repositório do pgBackRest (volume <code>pgbackrest</code>). O PITR cria <code>lab.pitr_clientes</code>, apaga a tabela e a recupera numa instância à parte — nunca no primário.
      </Ficha>

      <h2>1. Backups</h2>
      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha o tipo</h3>
          <div className="estrategias" role="radiogroup" aria-label="Tipo de backup">
            {(Object.keys(SOBRE_TIPO) as Tipo[]).map((t) => (
              <label key={t} className={`estrategia ${tipo === t ? 'ativa' : ''}`}>
                <input type="radio" name="tipo" checked={tipo === t} onChange={() => setTipo(t)} />
                <strong>{t}</strong>
                <span className="muted small">{SOBRE_TIPO[t].analogia}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Faça o backup</h3>
          <button className="primario" disabled={backup.isPending || pitr.isPending} onClick={() => backup.mutate()}>
            {backup.isPending ? 'Copiando…' : `Fazer backup ${tipo}`}
          </button> <Banco nome="PostgreSQL" />
          {backup.isError && <p className="error">{backup.error.message}</p>}
        </div>
      </div>
      <SobreOpcao titulo={SOBRE_TIPO[tipo].titulo} conceito={SOBRE_TIPO[tipo].conceito} analogia={SOBRE_TIPO[tipo].analogia}
                  espere={SOBRE_TIPO[tipo].espere} fontes={SOBRE_TIPO[tipo].fontes}
                  comando={`pgbackrest --stanza=main --type=${tipo} backup
-- disparado pela API com:
COPY saida FROM PROGRAM 'pgbackrest --stanza=main --type=${tipo} backup'`} />
      {backup.data && (
        <Conclusao tipo="boa" titulo={backup.data.novo
          ? `Backup ${backup.data.novo.tipo} ${backup.data.novo.rotulo}: copiou ${bytes(backup.data.novo.copiado)} em ${ms(backup.data.duracao_ms)}.`
          : `Backup feito em ${ms(backup.data.duracao_ms)}.`}>
          {backup.data.novo?.tipo !== backup.data.tipo && <>Foi pedido <code>{backup.data.tipo}</code>, mas sem um full anterior o pgBackRest faz um <strong>full</strong>: não há base para comparar. </>}
          {backup.data.novo && <>O banco tinha {bytes(backup.data.novo.tamanho_banco)}; no repositório o backup ocupa {bytes(backup.data.novo.no_repositorio)} (comprimido).
            {backup.data.novo.referencia?.length ? <> Para restaurar, ele precisa de: {backup.data.novo.referencia.join(', ')}.</> : <> Ele não depende de nenhum outro.</>}</>}
        </Conclusao>
      )}
      <Async query={info}>
        {(i) => <Repositorio i={i} />}
      </Async>

      <h2>2. O acidente e o PITR</h2>
      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Escolha o instante-alvo</h3>
          <div className="estrategias" role="radiogroup" aria-label="Instante-alvo">
            {(Object.keys(SOBRE_ALVO) as Alvo[]).map((a) => (
              <label key={a} className={`estrategia ${alvo === a ? 'ativa' : ''}`}>
                <input type="radio" name="alvo" checked={alvo === a} onChange={() => setAlvo(a)} />
                <strong>{SOBRE_ALVO[a].titulo}</strong>
                <span className="muted small">{SOBRE_ALVO[a].espere}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Provoque o acidente e recupere</h3>
          <button className="primario" disabled={pitr.isPending || backup.isPending} onClick={() => pitr.mutate()}>
            {pitr.isPending ? 'Apagando, restaurando e conferindo…' : 'Apagar a tabela e recuperar (PITR)'}
          </button> <Banco nome="PostgreSQL" />
          {pitr.isPending && <p className="muted small">Restaurar o cluster inteiro leva alguns segundos.</p>}
          {pitr.isError && <p className="error">{pitr.error.message}</p>}
        </div>
      </div>
      <SobreOpcao titulo={SOBRE_ALVO[alvo].titulo} conceito={SOBRE_ALVO[alvo].conceito} espere={SOBRE_ALVO[alvo].espere}
                  fontes={['pg_pitr', 'pg_alvo', 'pgbackrest_comandos', 'pg_ctl']}
                  comando={`CREATE TABLE lab.pitr_clientes …; INSERT … 1.000 linhas   -- lote 1
${alvo === 'antes-do-lote2' ? '-- ALVO = clock_timestamp()\n' : ''}INSERT … 500 linhas                                       -- lote 2
${alvo === 'antes-do-drop' ? '-- ALVO = clock_timestamp()\n' : ''}DROP TABLE lab.pitr_clientes;                             -- o acidente
SELECT pg_switch_wal();                                   -- fecha e arquiva o WAL
pgbackrest restore --pg1-path=/var/lib/postgresql/pitr --type=time --target="<ALVO>" --target-action=promote
pg_ctl -D /var/lib/postgresql/pitr -o "-p 5433" start      -- instância À PARTE
SELECT count(*) FROM lab.pitr_clientes;                   -- na porta 5433`} />
      {pitr.data && <ResultadoRecuperacao r={pitr.data} />}

      <h2>Perguntas para responder</h2>
      <ol className="perguntas">
        <li>Por que a réplica não teria salvado a tabela apagada?</li>
        <li>Faça full, incr e diff. Qual copiou menos? Qual exige mais backups para restaurar?</li>
        <li>No PITR, quanto tempo levou a recuperação? Do que esse tempo depende (pense num banco de 2 TB)?</li>
        <li>Por que restaurar numa instância à parte, e não por cima do primário?</li>
        <li>O que <code>archive_timeout</code> tem a ver com o RPO se o disco do primário morrer?</li>
        <li>Que risco a API corre ao poder executar <code>COPY … FROM PROGRAM</code>?</li>
      </ol>

      <Fontes doc="08-replicacao-backup" ids={['pg_backup', 'pg_arquivamento', 'pg_pitr', 'pg_alvo', 'pg_archive_command', 'pg_archive_timeout',
        'pg_stat_arquivador', 'pg_funcoes_backup', 'pg_copy', 'pg_papeis', 'pg_ctl', 'pg_dump', 'pgbackrest_guia', 'pgbackrest_tipos',
        'pgbackrest_comandos', 'interdb_pitr', 'gitlab_2017', 'pg_wal']} />
    </section>
  )
}

function Repositorio({ i }: { i: InfoBackup }) {
  const backups = [...(i.backups ?? [])].reverse()
  return (
    <>
      <p className="small">
        Repositório: <strong>{i.status}</strong> · WAL arquivado de <code>{i.wal_min || '—'}</code> a <code>{i.wal_max || '—'}</code>
        {' '}({inteiro(i.wal_arquivados)} segmentos desde que o servidor subiu{i.ultima_falha ? '' : ', sem falhas recentes'})
      </p>
      {i.ultima_falha && <p className="error small">O arquivamento está falhando: {i.ultima_falha}. Sem WAL arquivado, não há PITR (cenário T1).</p>}
      {backups.length === 0
        ? <p className="muted">Nenhum backup ainda. Faça um full.</p>
        : (
          <table aria-label="Backups no repositório">
            <thead><tr><th>Backup</th><th>Tipo</th><th>Quando</th><th>Copiou</th><th>No repositório</th><th>Depende de</th><th>WAL</th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.rotulo}>
                  <td><code>{b.rotulo}</code></td><td>{b.tipo}</td>
                  <td>{new Date(b.fim).toLocaleString('pt-BR')}</td>
                  <td className="num">{bytes(b.copiado)}</td><td className="num">{bytes(b.no_repositorio)}</td>
                  <td className="small">{b.referencia?.length ? b.referencia.join(', ') : '—'}</td>
                  <td className="small"><code>{b.wal_inicio}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  )
}

function ResultadoRecuperacao({ r }: { r: ResultadoPITR }) {
  const certo = r.restauradas === r.esperadas
  return (
    <>
      <Conclusao tipo={certo ? 'boa' : 'ruim'}
                 titulo={certo
                   ? `Recuperadas ${inteiro(r.restauradas)} linhas em ${ms(r.recuperacao_ms)} — exatamente o que existia no instante-alvo.`
                   : `A instância restaurada tem ${inteiro(r.restauradas)} linhas; o alvo pedia ${inteiro(r.esperadas)}.`}>
        A recuperação usou o backup <code>{r.backup_usado}</code> (e a cadeia de que ele depende) mais o WAL arquivado até {r.alvo_em}.
        {r.alvo === 'antes-do-lote2' && <> As {inteiro(r.lote2)} linhas do lote 2 ficaram de fora de propósito: elas vieram depois do alvo.</>}
        {' '}{ms(r.recuperacao_ms)} é o <strong>RTO</strong> deste ensaio (restaurar + subir); num banco de 2 TB seriam horas — por isso se mede.
        {' '}{r.tabela_no_primario ? 'Atenção: a tabela existe no primário!' : 'No primário a tabela continua apagada: a restauração não o tocou.'}
      </Conclusao>
      <table aria-label="Etapas do PITR">
        <thead><tr><th>Etapa</th><th>Tempo</th><th>O que aconteceu</th></tr></thead>
        <tbody>
          {r.etapas.map((e) => (
            <tr key={e.nome} className={e.nome === 'o acidente' ? 'ruim' : undefined}>
              <td>{e.nome}</td><td className="num">{ms(e.ms)}</td><td className="small">{e.detalhe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
