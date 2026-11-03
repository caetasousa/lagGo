import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Gráficos seguindo o método da skill de visualização: uma série por gráfico
// de linha (nunca dois eixos), linhas finas, grade discreta, tooltip no hover;
// barras com rótulo direto (a cor aqua fica abaixo de 3:1 de contraste, então
// o valor aparece escrito) e cor que segue a ENTIDADE, nunca a posição.

const EIXO = { fontSize: 11, fill: 'var(--texto-2)' }
// Tooltip no tema escuro: texto em tinta de texto, nunca na cor da série.
const DICA = {
  contentStyle: { background: 'var(--superficie-2)', border: '1px solid var(--borda-forte)', borderRadius: 8, color: 'var(--texto)' },
  labelStyle: { color: 'var(--texto-2)' },
  itemStyle: { color: 'var(--texto)' },
}

export type Ponto = { t: string; v: number }

export function Linha({ titulo, dados, unidade, cor = 'var(--serie-1)' }: {
  titulo: string; dados: Ponto[]; unidade: string; cor?: string
}) {
  const atual = dados.at(-1)?.v
  return (
    <figure className="grafico" aria-label={titulo}>
      <h3>{titulo} <span>agora: <strong data-testid="valor-atual">{atual == null ? '—' : fmt(atual)}</strong> {unidade}</span></h3>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={dados} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grade)" vertical={false} />
          <XAxis dataKey="t" tick={EIXO} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))} ${unidade}`, titulo]} {...DICA} />
          <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  )
}

export type Barra = { nome: string; v: number; cor: string }

export function Barras({ titulo, dados, unidade }: { titulo: string; dados: Barra[]; unidade: string }) {
  return (
    <figure className="grafico" aria-label={titulo}>
      <h3>{titulo}</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={dados} margin={{ top: 22, right: 8, bottom: 0, left: -12 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--grade)" vertical={false} />
          <XAxis dataKey="nome" tick={EIXO} tickLine={false} axisLine={false} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))} ${unidade}`, titulo]} cursor={{ fill: 'rgba(157, 123, 255, 0.08)' }} {...DICA} />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {dados.map((d) => <Cell key={d.nome} fill={d.cor} stroke="var(--superficie)" strokeWidth={2} />)}
            <LabelList dataKey="v" position="top" formatter={(v) => fmt(Number(v))} style={{ fontSize: 12, fill: 'var(--texto)', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })
}
