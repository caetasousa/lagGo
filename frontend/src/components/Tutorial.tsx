import { useState, type ReactNode } from 'react'
import { FontesCurtas, type IdFonte } from './fontes'

// O tutorial "do zero" que abre cada laboratório (cenário K4): passos curtos,
// cada um com uma ideia, de preferência uma ilustração, e as fontes de onde
// a explicação saiu (cenário K3).

export type Passo = { titulo: string; corpo: ReactNode; fontes: readonly IdFonte[] }

export function Tutorial({ titulo, passos }: { titulo: string; passos: Passo[] }) {
  const [i, setI] = useState(0)
  const p = passos[i]
  return (
    <section className="conceito" aria-label={titulo}>
      <h2>{titulo}</h2>
      <div className="tutorial">
        <nav aria-label="Passos do tutorial">
          {passos.map((q, k) => (
            <button key={q.titulo} aria-current={k === i} onClick={() => setI(k)}>{q.titulo}</button>
          ))}
        </nav>
        <div className="conceito-texto">
          <h3>{p.titulo}</h3>
          {p.corpo}
          <FontesCurtas ids={p.fontes} titulo="Fontes deste passo" />
          <div className="form-linha">
            <button disabled={i === 0} onClick={() => setI(i - 1)}>← Anterior</button>
            <button disabled={i === passos.length - 1} onClick={() => setI(i + 1)}>Próximo →</button>
          </div>
        </div>
      </div>
    </section>
  )
}
