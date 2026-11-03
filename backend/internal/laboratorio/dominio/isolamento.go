package dominio

// Laboratório de Isolamento e Deadlock (Fase 4, docs/03): um roteiro é uma
// sequência fixa de comandos de duas transações (T1 e T2), executada em duas
// conexões de verdade. Os roteiros (com o SQL) moram no adaptador postgres.

// NiveisDeIsolamento: o nome que a tela usa → o do SQL.
var NiveisDeIsolamento = map[string]string{
	"read_uncommitted": "READ UNCOMMITTED",
	"read_committed":   "READ COMMITTED",
	"repeatable_read":  "REPEATABLE READ",
	"serializable":     "SERIALIZABLE",
}

type Passo struct {
	T    int    `json:"t"` // 1 ou 2
	SQL  string `json:"sql"`
	Nota string `json:"nota,omitempty"`
}

type Roteiro struct {
	ID       string   `json:"id"`
	Titulo   string   `json:"titulo"`
	Resumo   string   `json:"resumo"`   // a anomalia em uma frase simples
	Pergunta string   `json:"pergunta"` // o que observar
	Preparo  []string `json:"-"`
	Passos   []Passo  `json:"passos"`
	Final    string   `json:"-"` // consulta do estado final
	// Anomalia decide, pelo que cada passo devolveu, se a anomalia do
	// roteiro aconteceu.
	Anomalia func(r []ResultadoPasso, final string) bool `json:"-"`
}

type ResultadoPasso struct {
	Numero    int     `json:"numero"`
	T         int     `json:"t"`
	SQL       string  `json:"sql"`
	Nota      string  `json:"nota,omitempty"`
	Resultado string  `json:"resultado"`
	Erro      string  `json:"erro,omitempty"`
	Codigo    string  `json:"codigo,omitempty"` // SQLSTATE: 40001 serialização, 40P01 deadlock
	Bloqueou  bool    `json:"bloqueou"`         // ficou esperando um lock
	EsperouMS float64 `json:"esperou_ms"`
}

type ResultadoIsolamento struct {
	Roteiro     string           `json:"roteiro"`
	Nivel       string           `json:"nivel"`
	Passos      []ResultadoPasso `json:"passos"`
	EstadoFinal string           `json:"estado_final"`
	Anomalia    bool             `json:"anomalia"` // a anomalia do roteiro aconteceu?
}
