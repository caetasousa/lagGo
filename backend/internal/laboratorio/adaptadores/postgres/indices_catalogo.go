package postgres

import "github.com/nosqlgo/marketplace/internal/laboratorio/dominio"

// Catálogo do Laboratório de Índices (tela /indices, docs/04).
//
// Só os índices listados aqui podem ser criados/removidos pela API: o nome
// vindo da URL é procurado neste catálogo, nunca concatenado em SQL.

var experimentos = []dominio.Experimento{
	{
		ID:       "pedidos-do-cliente",
		Titulo:   "Últimos pedidos de um cliente",
		Conceito: "Índice em FK · índice composto evita o Sort",
		Descricao: `O PostgreSQL não indexa FKs sozinho. Remova o índice composto e veja o Seq Scan em 100 mil pedidos
(compare os buffers: ~1400 páginas contra ~13).
Repare que, mesmo com o composto, o planner escolhe Bitmap + Sort: cada cliente tem ~10 pedidos e
ordenar 10 linhas é barato. O Index Scan "já na ordem" compensa quando há muitas linhas por cliente —
teste no psql com SET enable_bitmapscan = off e compare o custo estimado.`,
		SQL: `SELECT id, status, total, criado_em
  FROM pedido
 WHERE cliente_id = $1::uuid
 ORDER BY criado_em DESC
 LIMIT 20`,
		Parametro: `SELECT id::text FROM cliente ORDER BY email LIMIT 1 OFFSET (SELECT count(*) / 2 FROM cliente)`,
		Indices: []dominio.Indice{
			{Nome: "idx_pedido_cliente_criado", Tabela: "pedido", Tipo: "B-tree composto", DaMigracao: true,
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedido_cliente_criado ON pedido (cliente_id, criado_em DESC)`},
			{Nome: "idx_lab_pedido_cliente", Tabela: "pedido", Tipo: "B-tree simples",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_pedido_cliente ON pedido (cliente_id)`},
		},
	},
	{
		ID:       "vendas-do-sku",
		Titulo:   "Histórico de vendas de um SKU (JOIN)",
		Conceito: "Índice em FK · algoritmo de junção",
		Descricao: `Sem índice em item_pedido(sku_id), o banco varre ~250 mil itens.
Com o índice, observe também como muda o algoritmo de junção (Hash Join × Nested Loop).`,
		SQL: `SELECT p.criado_em::date AS dia, i.quantidade, i.preco_unitario
  FROM item_pedido i
  JOIN pedido p ON p.id = i.pedido_id
 WHERE i.sku_id = $1::uuid
 ORDER BY p.criado_em DESC`,
		Parametro: `SELECT id::text FROM sku WHERE id <> '11111111-1111-1111-1111-111111111111' ORDER BY descricao LIMIT 1 OFFSET (SELECT count(*) / 20 FROM sku)`,
		Indices: []dominio.Indice{
			{Nome: "idx_item_pedido_sku", Tabela: "item_pedido", Tipo: "B-tree", DaMigracao: true,
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_pedido_sku ON item_pedido (sku_id)`},
		},
	},
	{
		ID:       "faixa-de-datas",
		Titulo:   "Pedidos de um dia (faixa de datas)",
		Conceito: "Regra do prefixo · B-tree × BRIN",
		Descricao: `O índice (cliente_id, criado_em) NÃO ajuda: criado_em não é a primeira coluna.
Teste um B-tree e depois um BRIN em criado_em (um de cada vez) e compare o TAMANHO dos dois.
O BRIN só funciona porque os pedidos estão gravados em ordem cronológica (correlação ≈ 1).`,
		SQL: `SELECT count(*), sum(total)
  FROM pedido
 WHERE criado_em >= $1::timestamptz
   AND criado_em <  $1::timestamptz + interval '1 day'`,
		Parametro: `SELECT (current_date - 100)::text`,
		Indices: []dominio.Indice{
			{Nome: "idx_lab_pedido_criado_btree", Tabela: "pedido", Tipo: "B-tree",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_pedido_criado_btree ON pedido (criado_em)`},
			{Nome: "idx_lab_pedido_criado_brin", Tabela: "pedido", Tipo: "BRIN",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_pedido_criado_brin ON pedido USING brin (criado_em)`},
		},
	},
	{
		ID:       "pendentes",
		Titulo:   "Fila de pedidos pendentes",
		Conceito: "Índice parcial × índice em coluna de baixa seletividade",
		Descricao: `Só ~3% dos pedidos estão PENDENTES. Um índice em status (5 valores) indexa todos os 100 mil;
o índice PARCIAL guarda só as linhas pendentes — compare os tamanhos.
É a consulta que a procedure cancelar_pedidos_expirados() faz (depois de rodá-la não sobra pendente).`,
		SQL: `SELECT id, cliente_id, criado_em
  FROM pedido
 WHERE status = 'PENDENTE'
 ORDER BY criado_em
 LIMIT 50`,
		Indices: []dominio.Indice{
			{Nome: "idx_lab_pedido_status", Tabela: "pedido", Tipo: "B-tree",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_pedido_status ON pedido (status)`},
			{Nome: "idx_lab_pedido_pendentes", Tabela: "pedido", Tipo: "B-tree parcial",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_pedido_pendentes ON pedido (criado_em) WHERE status = 'PENDENTE'`},
		},
	},
	{
		ID:       "nome-sem-caixa",
		Titulo:   "Busca por nome ignorando maiúsculas",
		Conceito: "Índice de expressão",
		Descricao: `Um índice em (nome) não serve para WHERE lower(nome) = ...: a consulta precisa usar
a MESMA expressão do índice. Crie os dois e veja qual o planner escolhe.`,
		SQL: `SELECT id, nome
  FROM cliente
 WHERE lower(nome) = lower($1)`,
		Parametro: `SELECT 'ANA Silva'`,
		Indices: []dominio.Indice{
			{Nome: "idx_lab_cliente_nome", Tabela: "cliente", Tipo: "B-tree",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_cliente_nome ON cliente (nome)`},
			{Nome: "idx_lab_cliente_lower_nome", Tabela: "cliente", Tipo: "B-tree de expressão",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_cliente_lower_nome ON cliente (lower(nome))`},
		},
	},
	{
		ID:       "trecho-email",
		Titulo:   "Busca por trecho do e-mail (LIKE '%...%')",
		Conceito: "GIN + pg_trgm",
		Descricao: `B-tree só serve para LIKE 'abc%' (prefixo). Para '%abc%' é preciso um índice de trigramas
(pedaços de 3 letras) do tipo GIN. Observe o Bitmap Index Scan + Recheck.`,
		SQL: `SELECT id, email
  FROM cliente
 WHERE email::text ILIKE '%' || $1 || '%'`,
		Parametro: `SELECT '4321'`,
		Indices: []dominio.Indice{
			{Nome: "idx_lab_cliente_email_trgm", Tabela: "cliente", Tipo: "GIN (pg_trgm)",
				Criar: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_cliente_email_trgm ON cliente USING gin ((email::text) gin_trgm_ops)`},
		},
	},
	{
		ID:       "curva-abc",
		Titulo:   "Curva ABC (relatório pesado)",
		Conceito: "Nem tudo se resolve com índice · work_mem",
		Descricao: `A consulta precisa ler quase todos os itens: índice não ajuda.
Rode com work_mem 64kB e depois 4MB e compare no plano: Hash "Batches: 16" (a tabela hash não coube
na memória), Sort "external merge Disk" e WindowAgg "Storage: Disk" — contra HashAggregate em memória.
É por isso que os relatórios leem a materialized view em vez de rodar isto a cada acesso.`,
		SQL: `WITH receita_sku AS (
    SELECT i.sku_id, sum(i.quantidade * i.preco_unitario) AS receita
      FROM item_pedido i
      JOIN pedido p ON p.id = i.pedido_id
     WHERE p.status IN ('PAGO', 'ENVIADO', 'ENTREGUE')
       AND p.criado_em >= now() - make_interval(days => $1::int)
     GROUP BY i.sku_id
), acumulado AS (
    SELECT receita,
           sum(receita) OVER (ORDER BY receita DESC ROWS UNBOUNDED PRECEDING)
             / sum(receita) OVER () AS fracao_acumulada
      FROM receita_sku
)
SELECT CASE WHEN fracao_acumulada <= 0.80 THEN 'A'
            WHEN fracao_acumulada <= 0.95 THEN 'B' ELSE 'C' END AS classe,
       count(*), sum(receita)
  FROM acumulado
 GROUP BY 1
 ORDER BY 1`,
		Parametro: `SELECT '365'`,
	},
}

func init() {
	// Fase 4: particionamento da auditoria.
	experimentos = append(experimentos,
		dominio.Experimento{
			ID:       "auditoria-um-mes",
			Titulo:   "Auditoria de um mês (tabela particionada)",
			Conceito: "Partition pruning",
			Descricao: `auditoria.log é particionada por mês. Filtrando pela PRÓPRIA coluna de partição, o
planejador descarta as outras partições ("Subplans Removed" ou só uma partição no plano).
Teste o ajuste enable_partition_pruning = off e compare quantas partições são lidas.`,
			SQL: `SELECT count(*), count(DISTINCT tabela)
  FROM auditoria.log
 WHERE em >= $1::timestamptz
   AND em <  $1::timestamptz + interval '1 month'`,
			Parametro: `SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 months')::text || ' America/Sao_Paulo'`,
		},
		dominio.Experimento{
			ID:       "auditoria-mes-com-funcao",
			Titulo:   "O mesmo mês com date_trunc (pruning quebrado)",
			Conceito: "Função na chave de partição",
			Descricao: `Mesma pergunta, escrita com date_trunc('month', em) = ... O planejador não sabe em que
partição cada linha de "date_trunc(em)" cai e lê TODAS. Compare os buffers com o experimento anterior:
é a mesma lição do índice de expressão — a consulta precisa usar a coluna como ela foi particionada.`,
			SQL: `SELECT count(*), count(DISTINCT tabela)
  FROM auditoria.log
 WHERE date_trunc('month', em AT TIME ZONE 'America/Sao_Paulo') = $1::timestamp`,
			Parametro: `SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 months')::text`,
		},
	)
}

func buscarExperimento(id string) (dominio.Experimento, bool) {
	for _, e := range experimentos {
		if e.ID == id {
			return e, true
		}
	}
	return dominio.Experimento{}, false
}

func buscarIndice(nome string) (dominio.Indice, bool) {
	for _, e := range experimentos {
		for _, i := range e.Indices {
			if i.Nome == nome {
				return i, true
			}
		}
	}
	return dominio.Indice{}, false
}
