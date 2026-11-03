import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

// Renderiza os estados de carregamento/erro de uma query do TanStack Query.
export function Async<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p className="muted">Carregando…</p>
  if (query.isError) return <p className="error">Erro: {query.error.message}</p>
  return <>{children(query.data)}</>
}
