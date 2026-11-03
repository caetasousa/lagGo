package dominio

// Laboratório de Conexões e PgBouncer (Fase 4, docs/06). Cada "cliente" faz,
// em loop, uma consulta curta:
//
//	direto     abre uma conexão NOVA no PostgreSQL, consulta, fecha — como
//	           uma aplicação sem pool. Cada conexão = um processo + SCRAM.
//	pgbouncer  o mesmo, mas a conexão nova é no PgBouncer, que reaproveita
//	           um punhado de conexões já abertas com o PostgreSQL.
//	pool       pool dentro da aplicação (10 conexões) — o que a API usa.

func ValidarConexoes(modo string, clientes, segundos int) error {
	if clientes < 1 || clientes > 150 || segundos < 1 || segundos > 10 {
		return ErrValidacao{"clientes entre 1 e 150, segundos entre 1 e 10"}
	}
	switch modo {
	case "direto", "pgbouncer", "pool":
		return nil
	}
	return ErrValidacao{"modo deve ser direto, pgbouncer ou pool"}
}

type ResultadoConexoes struct {
	Modo           string  `json:"modo"`
	Clientes       int     `json:"clientes"`
	Segundos       int     `json:"segundos"`
	Operacoes      int     `json:"operacoes"`
	OpsPorSegundo  float64 `json:"ops_por_segundo"`
	P50MS          float64 `json:"p50_ms"`
	P95MS          float64 `json:"p95_ms"`
	Erros          int     `json:"erros"`
	PrimeiroErro   string  `json:"primeiro_erro,omitempty"`
	MaxConexoesPG  int64   `json:"max_conexoes_postgres"` // pico de processos de cliente no servidor
	MaxConnections int64   `json:"max_connections"`
}
