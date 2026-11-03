import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post, type Particao, type ResultadoExpurgo } from '../../api/client'
import { Async } from '../../components/Async'
import { Barras } from '../../components/Graficos'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Titulo, bytes, inteiro, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes } from '../../components/fontes'
import { TutorialExpurgo } from '../../components/tutoriais'

const METODOS = {
  delete: {
    titulo: 'Expurgar com DELETE',
    conceito: 'Apaga as linhas do mês uma a uma. Por causa do MVCC, cada linha vira uma tupla morta, e cada remoção é registrada no WAL (o diário que vai para o disco, para as réplicas e para o backup). O arquivo da partição continua do mesmo tamanho até o VACUUM.',
    comando: `DELETE FROM auditoria.log
 WHERE em >= '2025-05-01 00:00-03' AND em < '2025-06-01 00:00-03';`,
    espere: 'Tempo e WAL proporcionais ao número de linhas; N tuplas mortas; arquivo do mesmo tamanho.',
    fontes: ['pg_vacuum_rotina', 'pg_wal'] as const,
  },
  drop: {
    titulo: 'Expurgar com DROP PARTITION',
    conceito: 'Desliga a partição da tabela-mãe (DETACH) e apaga o arquivo inteiro (DROP). O banco não olha linha por linha: o custo não depende de quantas linhas o mês tinha, quase nada vai para o WAL e não sobra tupla morta.',
    comando: `ALTER TABLE auditoria.log DETACH PARTITION auditoria.log_202505;
DROP TABLE auditoria.log_202505;`,
    espere: 'WAL dezenas de vezes menor, arquivo removido, zero tuplas mortas — com qualquer volume.',
    fontes: ['pg_particionamento', 'pg_alter_table'] as const,
  },
}

// Laboratório de Particionamento e Expurgo (Fase 4, tópico 8.7).

const COR = { delete: 'var(--serie-1)', drop: 'var(--serie-2)' } // cor segue o método, sempre

export function ExpurgoPage() {
  const qc = useQueryClient()
  const [linhas, setLinhas] = useState(30000)
  const [ultimos, setUltimos] = useState<Partial<Record<'delete' | 'drop', ResultadoExpurgo>>>({})
  const particoes = useQuery({ queryKey: ['particoes'], queryFn: () => api<Particao[]>('/dba/postgres/particoes') })
  const expurgo = useMutation({
    mutationFn: (metodo: 'delete' | 'drop') => post<ResultadoExpurgo>('/lab/expurgo', { metodo, linhas }),
    onSuccess: (r) => { setUltimos((u) => ({ ...u, [r.metodo]: r })); qc.invalidateQueries({ queryKey: ['particoes'] }) },
  })
  const d = ultimos.delete, p = ultimos.drop

  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Particionamento e Expurgo" />
      <Explicacao frase={<>A auditoria só cresce. Ela está <strong>dividida em uma tabela por mês</strong> (partições). Apagar um mês antigo pode ser um <strong>DELETE</strong> linha a linha — ou jogar fora a partição inteira com <strong>DROP</strong>.</>}
                  topico="8.7" doc="docs/06-postgresql-admin.md §6">
        <p>O experimento usa um mês de 18 meses atrás, numa partição criada e preenchida só para ele — o histórico da loja não é tocado (a coluna "outras linhas" confirma).</p>
        <p><strong>DELETE:</strong> cada linha vira uma tupla morta e um registro no WAL (o log que a réplica e o backup leem). O arquivo continua do mesmo tamanho até o VACUUM.</p>
        <p><strong>DETACH + DROP PARTITION:</strong> remove o arquivo. O custo não depende do número de linhas e quase nada vai para o WAL.</p>
        <p>Particionar também acelera consultas por período: veja os experimentos "Auditoria de um mês" no <Link to="/indices">Laboratório de Índices</Link> (partition pruning).</p>
      </Explicacao>

      <Conceito>
        <p><strong>Particionar</strong> é dividir uma tabela grande em tabelas menores por uma regra — aqui, <strong>uma por mês</strong> (<code>auditoria.log_202611</code>, <code>log_202612</code>…). Para quem consulta, continua sendo uma tabela só (<code>auditoria.log</code>); por baixo, cada linha mora na partição do seu mês.</p>
        <p>Dois ganhos: (1) uma consulta "do mês X" lê só a partição do mês X (<em>partition pruning</em> — veja os experimentos 8 e 9 do Laboratório de Índices); (2) apagar um mês inteiro vira apagar um arquivo.</p>
        <p><strong>Expurgo</strong> é apagar dados velhos por política de retenção ("guardar 12 meses de auditoria"). Este laboratório compara os dois jeitos de expurgar um mês com o mesmo volume.</p>
      </Conceito>
      <TutorialExpurgo />
      <Ficha usos={['pg-auditoria']}>
        O experimento cria e enche uma partição de 18 meses atrás (fora do histórico da loja, que vai até 13 meses), com linhas sintéticas. A coluna "Outras linhas" (meses já fechados, fora o testado) confirma que os outros meses ficaram intactos.
      </Ficha>

      <div className="passos">
        <div className="passo">
          <span className="numero">1</span><h3>Quantas linhas no mês</h3>
          <div className="form-linha">
            <label>Linhas <input type="number" min={1000} max={200000} step={10000} value={linhas} onChange={(e) => setLinhas(Number(e.target.value))} /></label>
          </div>
        </div>
        <div className="passo">
          <span className="numero">2</span><h3>Expurgue dos dois jeitos</h3>
          <div className="form-linha">
            <button disabled={expurgo.isPending} onClick={() => expurgo.mutate('delete')}>Expurgar com DELETE</button>
            <button disabled={expurgo.isPending} onClick={() => expurgo.mutate('drop')}>Expurgar com DROP PARTITION</button>
            <Banco nome="PostgreSQL" />
          </div>
          {expurgo.isPending && <p className="muted small">Gerando o mês e expurgando…</p>}
          {expurgo.isError && <p className="error">{expurgo.error.message}</p>}
        </div>
      </div>

      <div className="duas-colunas">
        <SobreOpcao titulo={METODOS.delete.titulo} conceito={METODOS.delete.conceito} comando={METODOS.delete.comando} espere={METODOS.delete.espere} fontes={METODOS.delete.fontes} />
        <SobreOpcao titulo={METODOS.drop.titulo} conceito={METODOS.drop.conceito} comando={METODOS.drop.comando} espere={METODOS.drop.espere} fontes={METODOS.drop.fontes} />
      </div>

      {d && p && (
        <>
          <Conclusao tipo="boa" titulo={`DROP PARTITION gerou ${Math.max(1, Math.round(d.wal_bytes / Math.max(p.wal_bytes, 1)))}× menos WAL e foi ${Math.max(1, Math.round(d.duracao_ms / Math.max(p.duracao_ms, 0.01)))}× mais rápido.`}>
            O DELETE deixou {inteiro(d.tuplas_mortas)} tuplas mortas e o arquivo com {bytes(d.bytes_depois)} até o próximo VACUUM; o DROP simplesmente removeu o arquivo.
            Nos dois casos os outros meses já fechados ficaram intactos ({inteiro(d.outras_linhas_depois)} linhas; o mês corrente fica de fora da conta porque a loja continua gravando nele).
          </Conclusao>
          <div className="legenda"><span><i style={{ background: COR.delete }} />DELETE</span><span><i style={{ background: COR.drop }} />DROP PARTITION</span></div>
          <div className="graficos">
            <Barras titulo="WAL gerado (KB)" unidade="KB" dados={[
              { nome: 'DELETE', v: d.wal_bytes / 1024, cor: COR.delete }, { nome: 'DROP', v: p.wal_bytes / 1024, cor: COR.drop }]} />
            <Barras titulo="Duração (ms)" unidade="ms" dados={[
              { nome: 'DELETE', v: d.duracao_ms, cor: COR.delete }, { nome: 'DROP', v: p.duracao_ms, cor: COR.drop }]} />
          </div>
        </>
      )}
      {(d || p) && (
        <table aria-label="Resultados do expurgo">
          <thead><tr><th>Método</th><th>Partição</th><th>Linhas</th><th>Duração</th><th>WAL</th><th>Arquivo antes → depois</th><th>Tuplas mortas</th><th>Outras linhas (meses fechados)</th></tr></thead>
          <tbody>
            {[d, p].filter(Boolean).map((r) => (
              <tr key={r!.metodo}>
                <td>{r!.metodo === 'delete' ? 'DELETE' : 'DROP PARTITION'}</td>
                <td><code>{r!.particao}</code></td>
                <td className="num">{inteiro(r!.linhas_removidas)}</td>
                <td className="num">{ms(r!.duracao_ms)}</td>
                <td className="num">{bytes(r!.wal_bytes)}</td>
                <td className="num">{bytes(r!.bytes_antes)} → {r!.metodo === 'drop' ? 'removido' : bytes(r!.bytes_depois)}</td>
                <td className="num">{inteiro(r!.tuplas_mortas)}</td>
                <td className="num">{inteiro(r!.outras_linhas_antes)} → {inteiro(r!.outras_linhas_depois)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Partições de <code>auditoria.log</code> <Banco nome="PostgreSQL" /></h2>
      <Async query={particoes}>
        {(ps) => (
          <table aria-label="Partições">
            <thead><tr><th>Partição</th><th>Faixa</th><th>Linhas (estatística)</th><th>Tamanho</th></tr></thead>
            <tbody>
              {ps.map((x) => (
                <tr key={x.nome}><td><code>{x.nome}</code></td><td><code className="small">{x.faixa}</code></td><td className="num">{inteiro(x.linhas_estimadas)}</td><td className="num">{bytes(x.bytes)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Async>

      <Fontes doc="06-postgresql-admin" ids={['pg_particionamento', 'pg_pruning', 'pg_alter_table', 'pg_vacuum_rotina', 'pg_wal', 'pg_mvcc', 'pg_partman', 'lgpd']} />
    </section>
  )
}
