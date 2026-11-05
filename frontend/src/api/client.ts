// Cliente HTTP da API Go. Em dev o Vite faz proxy de /api; em produção o nginx.

export class ApiError extends Error {}

// novoUUID() só existe em "contexto seguro" (HTTPS ou localhost):
// acessando por http://IP-da-máquina ele é undefined e o app quebraria ao
// carregar. getRandomValues existe em qualquer contexto — UUID v4 na mão.
export function novoUUID(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // versão 4
  b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Sessão do CARRINHO (Fase 3): um UUID por navegador, enviado em todo pedido.
// Não é o login: dá para montar o carrinho sem conta. O login (Fase 6) é um
// cookie HttpOnly que o navegador manda sozinho e o JavaScript não lê.
export const sessao = (() => {
  let s = localStorage.getItem('nosqlgo.sessao')
  if (!s) {
    s = novoUUID()
    localStorage.setItem('nosqlgo.sessao', s)
  }
  return s
})()

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { 'X-Sessao': sessao, ...init?.headers } })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(body?.error ?? `HTTP ${res.status}`)
  }
  return body as T
}

export function post<T>(path: string, data: unknown, headers?: Record<string, string>): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })
}

export function del(path: string): Promise<null> {
  return api<null>(path, { method: 'DELETE' })
}

export function put<T>(path: string, data: unknown): Promise<T> {
  return api<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}

export const kb = (bytes: number) => `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export type HealthStatus = {
  name: string
  model: string
  status: 'up' | 'down' | 'disabled'
  version?: string
  latency_ms: number
  error?: string
}

export type PgOverview = {
  version: string
  started_at: string
  database_bytes: number
  connections: number
  max_connections: number
  cache_hit_ratio: number | null
  in_recovery: boolean
}

export type PgTopQuery = {
  query_id: string
  query: string
  calls: number
  total_exec_ms: number
  mean_exec_ms: number
  rows: number
  shared_blks_hit: number
  shared_blks_read: number
}

export type PgActivity = {
  pid: number
  user: string | null
  application: string
  state: string | null
  wait_event_type: string | null
  wait_event: string | null
  duration_ms: number | null
  blocked_by: number[]
  query: string
}

export type PgLock = {
  pid: number
  locktype: string
  mode: string
  granted: boolean
  relation: string | null
  transaction_id: string | null
  state: string | null
  wait_ms: number | null
  blocked_by: number[]
  query: string
}

// ---------------------------------------------------------------- loja / checkout

export type Sku = {
  id: string
  descricao: string
  preco: number
  estoque: number
  vendedor: string
  categoria: string
}

export type Estrategia = 'ingenua' | 'for_update' | 'condicional' | 'serializavel'

export const ESTRATEGIAS: { valor: Estrategia; nome: string; descricao: string }[] = [
  { valor: 'condicional', nome: 'UPDATE condicional', descricao: 'UPDATE ... WHERE quantidade >= x: verificação e escrita num único comando atômico.' },
  { valor: 'for_update', nome: 'SELECT FOR UPDATE', descricao: 'Lock pessimista: trava a linha; quem chega depois espera o COMMIT.' },
  { valor: 'serializavel', nome: 'SERIALIZABLE + retry', descricao: 'Lê e grava sem lock, mas o PostgreSQL (SSI) aborta conflitos com erro 40001 e a API repete.' },
  { valor: 'ingenua', nome: 'Ingênua (com bug)', descricao: 'Lê, decide na aplicação e grava o valor absoluto em READ COMMITTED: lost update.' },
]

export type CheckoutResultado = {
  pedido_id: string
  total: number
  tentativas: number
  reaproveitado: boolean
}

export type PedidoDetalhe = {
  id: string
  status: string
  total: number
  criado_em: string
  cliente: string
  cidade: string
  uf: string
  itens: { numero: number; sku_id: string; descricao: string; quantidade: number; preco_unitario: number; subtotal: number }[]
  pagamentos: { id: string; metodo: string; valor: number; status: string; criado_em: string }[]
}

export type CorridaParams = {
  estrategia: Estrategia
  compradores: number
  estoque_inicial: number
  atraso_ms: number
}

export type CorridaResultado = CorridaParams & {
  sku_id: string
  vendidos: number
  sem_estoque: number
  erros: number
  primeiro_erro?: string
  retentativas: number
  estoque_final: number
  vendas_a_mais: number
  consistente: boolean
  duracao_ms: number
}

// ---------------------------------------------------------------- Fase 2

export type Categoria = { id: number; nome: string; caminho: string; nivel: number; skus: number }

export type VendaMensal = { mes: string | null; uf: string; pedidos: number; receita: number; nivel: number }

export type ReceitaDia = { dia: string; pedidos: number; receita: number; media_movel_7d: number; variacao: number | null }

export type ClasseABC = { classe: string; skus: number; receita: number }

export type Atualizacao = { objeto: string; atualizado_em: string; duracao_ms: number }

export type IndiceLab = {
  nome: string
  tabela: string
  tipo: string
  criar: string
  da_migracao: boolean
  explicacao: string
  existe: boolean
  valido: boolean
  bytes: number
  usos: number
  definicao?: string
}

export type ExperimentoLab = {
  id: string
  titulo: string
  conceito: string
  descricao: string
  sql: string
  parametro_sql?: string
  indices: IndiceLab[]
  pergunta: string
  sem_indice: string
  com_indice: string
  observe: string
}

export type ExplainResultado = {
  experimento: string
  parametro: string | null
  work_mem: string
  ajustes?: Record<string, string>
  indices_presentes: string[] | null
  plano: string[]
  planejamento_ms: number
  execucao_ms: number
  buffers_hit: number
  buffers_read: number
}

export type RegistroAuditoria = {
  id: number
  tabela: string
  operacao: string
  chave: string | null
  usuario: string
  transacao: number
  em: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
}

export type RegistroDDL = { id: number; em: string; usuario: string; comando: string; tipo_objeto: string | null; objeto: string | null }

// ---------------------------------------------------------------- Fase 3

export type ProdutoResumo = {
  id: string
  nome: string
  marca: string
  categoria: { id: number; nome: string }
  preco_min: number
  nota_media: number
  qtd_avaliacoes: number
  qtd_ofertas: number
  relevancia?: number
}

export type Busca = {
  itens: ProdutoResumo[]
  total: number
  pagina: number
  por_pagina: number
  facetas_categorias: { id: number; nome: string; total: number }[]
  facetas_preco: { de: number; ate: number; total: number }[]
  pipeline: unknown
}

export type AvaliacaoResumo = { cliente_nome: string; nota: number; texto: string; em: string }

export type Produto = {
  id: string
  nome: string
  marca: string
  descricao: string
  categoria: { id: number; nome: string; caminho: string }
  categorias: number[]
  atributos: Record<string, unknown>
  skus: { sku_id: string; vendedor: string; preco: number }[]
  preco_min: number
  nota_media: number
  qtd_avaliacoes: number
  avaliacoes_recentes: AvaliacaoResumo[]
}

export type Oferta = {
  id: string
  produto_id: string | null
  descricao: string
  preco: number
  ativo: boolean
  estoque: number
  vendedor: string
}

export type DetalheProduto = { produto: Produto; ofertas: Oferta[]; cache: 'hit' | 'miss' }

export type MaisVendido = { sku_id: string; vendidos: number; produto_id: string; nome: string; preco: number }

export type Carrinho = { itens: (Oferta & { quantidade: number })[]; ttl_segundos: number }

export type EstadoRedis = {
  info: Record<string, string>
  hit_ratio: number | null
  chaves_por_prefixo: Record<string, number>
  chaves_varridas: number
  varredura_parou: boolean
  stream_pedidos: Record<string, string>[] | null
  tamanho_stream: number
}

export type EstadoMongo = {
  versao: string
  conexoes: number
  operacoes: Record<string, number>
  replica_set: string
  membros: string[] | null
  colecoes: {
    nome: string
    documentos: number
    bytes_dados: number
    bytes_armazenados: number
    bytes_por_documento: number
    tem_validacao: boolean
    indices: { nome: string; chave: string; unico: boolean; bytes: number }[]
  }[]
}

// ---------------------------------------------------------------- Fase 4

export type PedidoResumo = { id: string; status: string; total: number; criado_em: string; itens: number }

export type SaudeTabela = {
  nome: string; particionada: boolean; particoes: number
  bytes_tabela: number; bytes_indices: number; bytes_total: number
  tuplas_vivas: number; tuplas_mortas: number; updates: number; updates_hot: number
  seq_scans: number; idx_scans: number
  ultimo_vacuum: string | null; ultimo_autovacuum: string | null
  ultimo_analyze: string | null; ultimo_autoanalyze: string | null
  autovacuums: number; opcoes: string[]
}

export type SaudeIndice = {
  tabela: string; nome: string; usos: number; bytes: number
  unico: boolean; primario: boolean; definicao: string; candidato_remocao: boolean
}

export type EstadoCachePG = {
  total_buffers: number; usados: number
  relacoes: { nome: string; tipo: string; buffers: number; sujos: number; uso_medio: number; pct_do_cache: number }[]
}

export type MetricasPG = {
  em: string; commits: number; rollbacks: number; tuplas_lidas: number; tuplas_escritas: number
  blocos_disco: number; blocos_cache: number; deadlocks: number; bytes_temp: number
  conexoes_ativas: number; conexoes_total: number
}

export type Particao = { nome: string; faixa: string; linhas_estimadas: number; bytes: number }

export type EstadoPgBouncer = Record<'POOLS' | 'STATS' | 'CONFIG', Record<string, string | number>[] | null>

export type Roteiro = {
  id: string; titulo: string; resumo: string; pergunta: string
  passos: { t: number; sql: string; nota?: string }[]
}

export type ResultadoIsolamento = {
  roteiro: string; nivel: string; estado_final: string; anomalia: boolean
  passos: { numero: number; t: number; sql: string; nota?: string; resultado: string; erro?: string; codigo?: string; bloqueou: boolean; esperou_ms: number }[]
}

export type EstadoMVCC = {
  fillfactor: number; bytes_tabela: number; bytes_indices: number
  tuplas_vivas: number; tuplas_mortas: number; bytes_livres: number; pct_livre: number; linha_1: string
}

export type ResultadoMVCC = {
  acao: string; duracao_ms: number; wal_bytes: number; atualizadas?: number; hot?: number
  antes: EstadoMVCC; depois: EstadoMVCC
  horizonte?: string
}

export type ResultadoExpurgo = {
  metodo: 'delete' | 'drop'; particao: string; linhas_removidas: number; duracao_ms: number; wal_bytes: number
  bytes_antes: number; bytes_depois: number; tuplas_mortas: number
  outras_linhas_antes: number; outras_linhas_depois: number
}

export type ResultadoConexoes = {
  modo: 'direto' | 'pgbouncer' | 'pool'; clientes: number; segundos: number; operacoes: number
  ops_por_segundo: number; p50_ms: number; p95_ms: number; erros: number; primeiro_erro?: string
  max_conexoes_postgres: number; max_connections: number
}

export type ResultadoLabCache = {
  produto: string
  sem_cache: { leituras: number; total_ms: number; p50_ms: number; p95_ms: number }
  com_cache: { leituras: number; total_ms: number; p50_ms: number; p95_ms: number }
  acertos: number; falhas: number; bytes_no_redis: number; ttl_segundos: number
}

// ---------------------------------------------------------------- Fase 5: replicação e backup

export type ModoSync = 'off' | 'local' | 'remote_write' | 'on' | 'remote_apply'

export type ResultadoReplicacao = {
  modo: ModoSync; transacoes: number; com_carga: boolean
  commit_p50_ms: number; commit_p95_ms: number
  visiveis_na_hora: number; ate_aparecer_p50_ms: number; ate_aparecer_max_ms: number; nao_apareceram: number
  atraso_max_bytes: number; estado_replica: string
}

export type BackupPg = {
  rotulo: string; tipo: 'full' | 'diff' | 'incr'; inicio: string; fim: string; referencia?: string[]
  tamanho_banco: number; copiado: number; no_repositorio: number; wal_inicio: string; wal_fim: string
}

export type InfoBackup = {
  status: string; backups: BackupPg[] | null; wal_min: string; wal_max: string
  wal_arquivados: number; falhas_arquivamento: number; ultimo_wal_arquivado: string; ultima_falha?: string
}

export type ResultadoBackup = { tipo: string; duracao_ms: number; saida: string[] | null; novo: BackupPg | null; info: InfoBackup }

export type ResultadoPITR = {
  alvo: 'antes-do-drop' | 'antes-do-lote2'; alvo_em: string; lote1: number; lote2: number
  esperadas: number; restauradas: number; tabela_no_primario: boolean; backup_usado: string
  etapas: { nome: string; ms: number; detalhe: string }[]; recuperacao_ms: number
}

export type EstadoReplicacao = {
  lsn_atual: string; synchronous_standby_names: string; synchronous_commit: string
  replicas: {
    nome: string; endereco: string; estado: string; sincronismo: string
    enviado_lsn: string; gravado_lsn: string; duravel_lsn: string; aplicado_lsn: string
    atraso_bytes: number; atraso_gravacao_ms: number | null; atraso_disco_ms: number | null; atraso_aplicacao_ms: number | null
  }[] | null
  slots: { nome: string; ativo: boolean; estado_wal: string; retido_bytes: number; invalidado?: string }[] | null
  arquivamento: { modo: string; arquivados: number; ultimo_wal: string; ultimo_em: string; falhas: number; ultima_falha?: string }
  replica: {
    em_recuperacao: boolean; recebido_lsn: string; aplicado_lsn: string; ultima_transacao_aplicada: string
    receptor: string; origem: string; slot_usado: string; atraso_s: number | null
  } | null
  replica_erro?: string
}

/** Como api(), mas devolve também de onde a API leu (cabeçalho X-Origem-Leitura, Fase 5). */
export async function apiComOrigem<T>(path: string): Promise<{ dados: T; origem: string | null }> {
  const res = await fetch(`/api${path}`, { headers: { 'X-Sessao': sessao } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`)
  return { dados: body as T, origem: res.headers.get('X-Origem-Leitura') }
}

// ---------------------------------------------------------------- Fase 5: alta disponibilidade (perfil ha)

export type TecnologiaHA = 'patroni' | 'mongo' | 'redis'

export type EstadoClusterHA = {
  tecnologia: TecnologiaHA; disponivel: boolean; erro?: string; lider: string; detalhe?: string
  membros: { nome: string; papel: string; estado: string; atraso?: number }[] | null
}

export type EnsaioHA = {
  tecnologia: TecnologiaHA; acao: 'queda' | 'planejada'; garantia: boolean; rodando: boolean; fase: string; erro?: string
  lider_antes: string; lider_depois: string; tentativas: number; confirmadas: number; perdidas: number
  fora_ms: number; acao_em: number
  pontos: { t: number; ok: number; falha: number }[] | null
  eventos: { t: number; texto: string }[] | null
}

export type EstadoHA = { clusters: Record<TecnologiaHA, EstadoClusterHA>; ensaio: EnsaioHA | null }

// ------------------------------------------------------------ Fase 7 (Cassandra e Neo4j)

export type Visto = { produto_id: string; nome: string; em: string }
export type Recomendacao = { produto_id: string; nome: string; preco: number; forca: number }
export type EstadoDoGrafo = { clientes: number; skus: number; compras: number; duracao_ms?: number; lidas_do_postgres?: number }

export type NivelConsistencia = 'ONE' | 'QUORUM' | 'ALL'
export type TentativaConsistencia = {
  nivel: NivelConsistencia; necessarias: number; escreveu: boolean; erro_escrita?: string
  leu: boolean; erro_leitura?: string; ms: number; forte_com_ele: boolean
}
export type ResultadoConsistencia = { rf: number; replicas_vivas: number; keyspace: string; tentativas: TentativaConsistencia[] }

export type PerguntaGrafo = 'tambem_comprou' | 'alcance'
export type LinhaGrafo = { sku_id: string; forca: number }
export type MedidaGrafo = { banco: string; consulta: string; ms: number; linhas: LinhaGrafo[]; total: number }
// nomes: sku → "produto · vendedor", do catálogo (MongoDB), só para rótulo.
export type ResultadoGrafo = { pergunta: PerguntaGrafo; sku_id: string; grafo: MedidaGrafo; sql: MedidaGrafo; iguais: boolean; nomes: Record<string, string> }
export type SkuParaOGrafo = { id: string; descricao: string; nome: string; compradores: number }
