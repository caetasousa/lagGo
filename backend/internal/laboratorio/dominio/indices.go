package dominio

import (
	"regexp"
	"slices"
	"strconv"
)

// Laboratório de Índices (Fases 2 e 4, docs/04). O catálogo de experimentos
// (com o SQL) mora no adaptador postgres; aqui ficam os tipos e as regras do
// que o aluno pode ajustar.

// WorkMemPermitidos: os valores de work_mem que a tela oferece ("" = padrão).
var WorkMemPermitidos = []string{"", "64kB", "1MB", "4MB", "16MB", "64MB"}

// AjustesPermitidos: parâmetros de sessão que o laboratório aceita (SET LOCAL):
// só do PLANEJADOR, com valores fixos. shared_buffers não está aqui porque
// exige reiniciar o servidor (docs/06).
var AjustesPermitidos = map[string][]string{
	"random_page_cost":         {"1.1", "4"},
	"enable_seqscan":           {"on", "off"},
	"enable_indexscan":         {"on", "off"},
	"enable_bitmapscan":        {"on", "off"},
	"enable_partition_pruning": {"on", "off"},
	"jit":                      {"on", "off"},
}

// ErrNaoEncontrado: experimento ou índice fora do catálogo.
type ErrNaoEncontrado struct{ Msg string }

func (e ErrNaoEncontrado) Error() string { return e.Msg }

// ErrRequisicao: ajuste ou work_mem fora do permitido (HTTP 400).
type ErrRequisicao struct{ Msg string }

func (e ErrRequisicao) Error() string { return e.Msg }

func ValidarAjustes(workMem string, ajustes map[string]string) error {
	if !slices.Contains(WorkMemPermitidos, workMem) {
		return ErrRequisicao{"work_mem inválido"}
	}
	for k, v := range ajustes {
		if !slices.Contains(AjustesPermitidos[k], v) {
			return ErrRequisicao{"ajuste não permitido: " + k + "=" + v}
		}
	}
	return nil
}

var (
	reTempoPlanejamento = regexp.MustCompile(`Planning Time: ([\d.]+) ms`)
	reTempoExecucao     = regexp.MustCompile(`Execution Time: ([\d.]+) ms`)
	reBuffers           = regexp.MustCompile(`Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?`)
)

// LerPlano tira do texto do EXPLAIN (ANALYZE, BUFFERS) os tempos e as páginas.
// A primeira linha "Buffers:" é a do nó raiz, que acumula a dos filhos.
func (r *ResultadoExplain) LerPlano() {
	for _, linha := range r.Plano {
		if m := reTempoPlanejamento.FindStringSubmatch(linha); m != nil {
			r.PlanejamentoMS, _ = strconv.ParseFloat(m[1], 64)
		}
		if m := reTempoExecucao.FindStringSubmatch(linha); m != nil {
			r.ExecucaoMS, _ = strconv.ParseFloat(m[1], 64)
		}
	}
	for _, linha := range r.Plano {
		if m := reBuffers.FindStringSubmatch(linha); m != nil {
			r.BuffersHit, _ = strconv.ParseInt(m[1], 10, 64)
			r.BuffersRead, _ = strconv.ParseInt(m[2], 10, 64)
			break
		}
	}
}

type Indice struct {
	Nome       string `json:"nome"`
	Tabela     string `json:"tabela"`
	Tipo       string `json:"tipo"`
	Criar      string `json:"criar"`
	DaMigracao bool   `json:"da_migracao"` // criado pela migração 00004 (recomendado manter)
	Explicacao string `json:"explicacao"`  // o que este índice guarda, em linguagem simples
}

type Experimento struct {
	ID        string   `json:"id"`
	Titulo    string   `json:"titulo"`
	Conceito  string   `json:"conceito"`
	Descricao string   `json:"descricao"`
	SQL       string   `json:"sql"`
	Parametro string   `json:"parametro_sql,omitempty"` // consulta que escolhe o valor de $1
	Indices   []Indice `json:"indices"`

	// Didática (experimentos_didatica.go): a mesma estrutura em todos.
	Pergunta  string `json:"pergunta"`   // a pergunta de negócio que a consulta responde
	SemIndice string `json:"sem_indice"` // o que o banco faz sem o índice
	ComIndice string `json:"com_indice"` // o que muda com o índice
	Observe   string `json:"observe"`    // o que olhar no plano
}

type EstadoIndice struct {
	Indice
	Existe    bool   `json:"existe"`
	Valido    bool   `json:"valido"` // CREATE INDEX CONCURRENTLY que falhou deixa índice INVALID
	Bytes     int64  `json:"bytes"`
	Usos      int64  `json:"usos"` // pg_stat_user_indexes.idx_scan
	Definicao string `json:"definicao,omitempty"`
}

type ExperimentoComEstado struct {
	Experimento
	Indices []EstadoIndice `json:"indices"`
}

type ResultadoExplain struct {
	Experimento      string            `json:"experimento"`
	Parametro        *string           `json:"parametro"`
	WorkMem          string            `json:"work_mem"`
	Ajustes          map[string]string `json:"ajustes,omitempty"`
	IndicesPresentes []string          `json:"indices_presentes"`
	Plano            []string          `json:"plano"`
	PlanejamentoMS   float64           `json:"planejamento_ms"`
	ExecucaoMS       float64           `json:"execucao_ms"`
	BuffersHit       int64             `json:"buffers_hit"`  // páginas de 8 KB achadas no shared_buffers
	BuffersRead      int64             `json:"buffers_read"` // páginas lidas do SO/disco
}
