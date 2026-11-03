package postgres

// Textos didáticos do Laboratório de Índices, separados do catálogo para que
// experimentos.go continue mostrando só a consulta e os índices. Linguagem
// simples primeiro; os termos técnicos aparecem entre parênteses.

type didatica struct {
	pergunta, semIndice, comIndice, observe string
}

var textosExperimentos = map[string]didatica{
	"pedidos-do-cliente": {
		pergunta:  "Quais são os 20 pedidos mais recentes desta cliente? (É a tela \"Meus pedidos\".)",
		semIndice: "O banco não sabe onde estão os pedidos da cliente: lê os 100 mil pedidos, página por página (Seq Scan), joga fora os que são de outras pessoas e ordena o que sobrou.",
		comIndice: "O índice é uma lista ordenada por (cliente, data). O banco desce a árvore até o começo da cliente e lê só as ~10 linhas dela — algo como 13 páginas em vez de 1.400.",
		observe:   "Compare os Buffers (páginas lidas) e o \"Rows Removed by Filter\": sem índice, quase tudo que foi lido é descartado.",
	},
	"vendas-do-sku": {
		pergunta:  "Em quais pedidos este produto foi vendido, do mais recente para o mais antigo?",
		semIndice: "A tabela de itens (250 mil linhas) não está organizada por produto: o banco lê todas para achar as poucas linhas do SKU e depois busca cada pedido.",
		comIndice: "Com o índice em item_pedido(sku_id), o banco vai direto às linhas do produto. Repare que muda também a forma de juntar as tabelas: de Hash Join (monta uma tabela em memória) para Nested Loop (para cada item, busca o pedido pela chave primária).",
		observe:   "O nó de leitura de item_pedido (Seq Scan × Index/Bitmap Scan) e o tipo de junção (Hash Join × Nested Loop).",
	},
	"faixa-de-datas": {
		pergunta:  "Quantos pedidos houve num certo dia e quanto eles somaram?",
		semIndice: "O índice que já existe é (cliente_id, criado_em): ordenado primeiro por cliente. Para achar \"um dia\" ele não serve — como uma lista telefônica ordenada por sobrenome não ajuda a achar todo mundo chamado Ana. Resultado: Seq Scan.",
		comIndice: "B-tree em criado_em: lista ordenada só por data; o banco vai direto ao dia. BRIN: em vez de uma entrada por linha, guarda só o MENOR e o MAIOR valor de cada bloco de páginas — minúsculo, mas só funciona porque os pedidos estão gravados em ordem de data.",
		observe:   "Crie um índice de cada vez. Compare os buffers E o tamanho do índice (no cartão): o BRIN lê um pouco mais, mas ocupa ~90× menos.",
	},
	"pendentes": {
		pergunta:  "Quais pedidos ainda estão PENDENTES, do mais antigo para o mais novo? (É o que a rotina de cancelamento procura.)",
		semIndice: "Só ~3% dos pedidos estão pendentes, mas sem índice o banco lê os 100 mil para achá-los e depois ordena.",
		comIndice: "Índice em status: funciona, mas indexa os 100 mil pedidos (inclusive os ENTREGUES, que ninguém procura). Índice PARCIAL (… WHERE status = 'PENDENTE'): guarda só os pendentes, já em ordem de data — muito menor e sem precisar ordenar.",
		observe:   "O tamanho dos dois índices nos cartões e o nó Sort, que desaparece com o índice parcial.",
	},
	"nome-sem-caixa": {
		pergunta:  "Quem se chama \"Ana Silva\", escrito de qualquer jeito (ANA SILVA, ana silva…)?",
		semIndice: "Para comparar sem diferenciar maiúsculas, a consulta usa lower(nome). O banco precisa calcular lower() de cada um dos 10 mil nomes: Seq Scan.",
		comIndice: "Um índice em (nome) guarda \"Ana Silva\" — não \"ana silva\" — e por isso é IGNORADO. Um índice de EXPRESSÃO em lower(nome) guarda o valor já convertido, e aí o banco consegue usá-lo.",
		observe:   "Crie primeiro só o índice em (nome) e veja que o plano não muda. Depois o de lower(nome).",
	},
	"trecho-email": {
		pergunta:  "Quais e-mails contêm \"4321\" em qualquer posição?",
		semIndice: "Um índice comum (B-tree) é ordenado pelo começo do texto: serve para LIKE 'abc%', não para '%abc%'. Sem ajuda, o banco testa os 10 mil e-mails.",
		comIndice: "O índice de TRIGRAMAS (GIN + pg_trgm) quebra cada e-mail em pedaços de 3 letras (\"cli\", \"lie\", …, \"432\", \"321\") e guarda, para cada pedaço, a lista de linhas que o contêm. A busca vira \"linhas que têm os pedaços 432 e 321\".",
		observe:   "Bitmap Index Scan no índice GIN e o \"Recheck Cond\": os trigramas acham candidatos, e o banco confere cada um de verdade.",
	},
	"curva-abc": {
		pergunta:  "Que produtos respondem por 80% da receita do último ano (curva ABC)?",
		semIndice: "Esta consulta precisa ler quase todos os 250 mil itens: nenhum índice ajuda quando a resposta envolve a tabela inteira.",
		comIndice: "Não há índice a criar. O que muda o desempenho aqui é a MEMÓRIA de trabalho (work_mem) para juntar e agrupar.",
		observe:   "Com work_mem 64kB: \"Batches: 16\" no Hash (não coube na memória) e \"external merge Disk\" no Sort (ordenou usando disco). Com 4MB, tudo em memória e cerca de 2× mais rápido.",
	},
	"auditoria-um-mes": {
		pergunta:  "Quantas alterações a auditoria registrou num certo mês?",
		semIndice: "A auditoria é PARTICIONADA: uma tabela separada por mês. Desligando o pruning, o banco consulta todas as 18 partições.",
		comIndice: "Com o filtro na própria coluna de partição (em), o planejador sabe qual mês contém a resposta e lê só essa partição (partition pruning). Particionar funciona como um índice grosso: separa os dados por faixa.",
		observe:   "Quantas linhas \"on log_…\" aparecem no plano: 1 com pruning, 18 sem.",
	},
	"auditoria-mes-com-funcao": {
		pergunta:  "A mesma pergunta do experimento anterior, escrita com date_trunc('month', em) = …",
		semIndice: "O planejador não consegue saber em qual partição cai \"date_trunc(em)\", então lê todas.",
		comIndice: "A correção é escrever a condição sobre a coluna pura (em >= início AND em < fim). É a mesma lição do índice de expressão: o banco só aproveita a organização se a consulta usar a coluna do jeito que ela foi organizada.",
		observe:   "Compare os buffers com o experimento anterior: ~10× mais páginas lidas para a mesma resposta.",
	},
}

var textosIndices = map[string]string{
	"idx_pedido_cliente_criado":   "Lista ordenada por cliente e, dentro de cada cliente, pela data mais recente. Cada entrada aponta para a linha do pedido na tabela.",
	"idx_lab_pedido_cliente":      "Lista ordenada só por cliente. Acha as linhas da cliente, mas elas saem fora de ordem de data: o banco ainda precisa ordenar.",
	"idx_item_pedido_sku":         "Lista ordenada por produto (SKU): para cada produto, onde estão os itens de pedido que o contêm.",
	"idx_lab_pedido_criado_btree": "Lista ordenada por data, uma entrada por pedido (100 mil entradas).",
	"idx_lab_pedido_criado_brin":  "Resumo por bloco de 128 páginas: só a menor e a maior data de cada bloco. Poucas entradas — só serve se as datas estiverem em ordem no disco.",
	"idx_lab_pedido_status":       "Lista ordenada por status: indexa os 100 mil pedidos, mesmo os que nunca são procurados.",
	"idx_lab_pedido_pendentes":    "Lista ordenada por data contendo SÓ os pedidos pendentes (cláusula WHERE no índice).",
	"idx_lab_cliente_nome":        "Lista ordenada pelo nome como foi gravado (\"Ana Silva\").",
	"idx_lab_cliente_lower_nome":  "Lista ordenada pelo RESULTADO de lower(nome) (\"ana silva\"): serve para consultas que usam a mesma expressão.",
	"idx_lab_cliente_email_trgm":  "Para cada pedaço de 3 letras, a lista de clientes cujo e-mail contém aquele pedaço (índice invertido, tipo GIN).",
}

func init() {
	for i := range experimentos {
		e := &experimentos[i]
		if d, ok := textosExperimentos[e.ID]; ok {
			e.Pergunta, e.SemIndice, e.ComIndice, e.Observe = d.pergunta, d.semIndice, d.comIndice, d.observe
		}
		for j := range e.Indices {
			e.Indices[j].Explicacao = textosIndices[e.Indices[j].Nome]
		}
	}
}
