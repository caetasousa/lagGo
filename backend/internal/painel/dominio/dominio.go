// Package dominio do Painel do DBA: o que um administrador de banco OLHA
// (sessões, locks, saúde das tabelas, replicação, Redis, MongoDB, PgBouncer)
// e as poucas regras do que ele pode FAZER pelo painel (manutenção).
//
// Sem banco nem HTTP aqui: os tipos descrevem o que é mostrado; quem os
// preenche são os adaptadores, cada um com as consultas do seu banco.
package dominio

import (
	"encoding/json"
	"time"
)

// ErrRequisicao: o pedido em si é inválido (ação que não existe, limites
// fora da faixa) — HTTP 400.
type ErrRequisicao struct{ Msg string }

func (e ErrRequisicao) Error() string { return e.Msg }

// ErrValidacao: o pedido é bem formado, mas aponta para algo que não pode
// (uma tabela fora dos esquemas da aplicação) — HTTP 422.
type ErrValidacao struct{ Msg string }

func (e ErrValidacao) Error() string { return e.Msg }

// ErrIndisponivel: o que o painel quer olhar não está configurado ou no ar.
type ErrIndisponivel struct{ Msg string }

func (e ErrIndisponivel) Error() string { return e.Msg }

// AcoesDeManutencao: o que o painel deixa rodar numa tabela. VACUUM FULL,
// que trava a tabela, fica só no Laboratório de MVCC.
var AcoesDeManutencao = []string{"vacuum", "analyze"}

// ValidarCancelamento: os limites do botão "cancelar pedidos expirados".
func ValidarCancelamento(idadeHoras, lote int) error {
	if idadeHoras < 1 || lote < 1 || lote > 10000 {
		return ErrRequisicao{"idade_horas >= 1 e lote entre 1 e 10000"}
	}
	return nil
}

type ResultadoManutencao struct {
	Acao      string `json:"acao"`
	Tabela    string `json:"tabela"`
	DuracaoMS int64  `json:"duracao_ms"`
}

type ResultadoCancelamento struct {
	Cancelados int32 `json:"cancelados"`
	Lotes      int   `json:"lotes"`
	DuracaoMS  int64 `json:"duracao_ms"`
}

// EstadoPgBouncer: SHOW POOLS/STATS/CONFIG como linhas coluna → valor (as
// colunas mudam entre versões do PgBouncer; não vale fixá-las numa struct).
type EstadoPgBouncer map[string][]map[string]any

type VisaoGeral struct {
	Version        string    `json:"version"`
	StartedAt      time.Time `json:"started_at"`
	DatabaseBytes  int64     `json:"database_bytes"`
	Connections    int64     `json:"connections"`
	MaxConnections int64     `json:"max_connections"`
	CacheHitRatio  *float64  `json:"cache_hit_ratio"` // % de leituras atendidas pelo shared_buffers
	InRecovery     bool      `json:"in_recovery"`     // true = réplica (docs/08)
}

type ConsultaCara struct {
	QueryID       string  `json:"query_id"`
	Query         string  `json:"query"`
	Calls         int64   `json:"calls"`
	TotalExecMS   float64 `json:"total_exec_ms"`
	MeanExecMS    float64 `json:"mean_exec_ms"`
	Rows          int64   `json:"rows"`
	SharedBlksHit int64   `json:"shared_blks_hit"`
	SharedBlksRd  int64   `json:"shared_blks_read"`
}

type Sessao struct {
	PID           int32    `json:"pid"`
	User          *string  `json:"user"`
	Application   string   `json:"application"`
	State         *string  `json:"state"`
	WaitEventType *string  `json:"wait_event_type"`
	WaitEvent     *string  `json:"wait_event"`
	DurationMS    *float64 `json:"duration_ms"`
	BlockedBy     []int32  `json:"blocked_by"`
	Query         string   `json:"query"`
}

type Lock struct {
	PID       int32    `json:"pid"`
	LockType  string   `json:"locktype"`
	Mode      string   `json:"mode"`
	Granted   bool     `json:"granted"`
	Relation  *string  `json:"relation"`
	TxID      *string  `json:"transaction_id"`
	State     *string  `json:"state"`
	WaitMS    *float64 `json:"wait_ms"`
	BlockedBy []int32  `json:"blocked_by"`
	Query     string   `json:"query"`
}

type SaudeTabela struct {
	Nome           string     `json:"nome"`
	Particionada   bool       `json:"particionada"`
	Particoes      int64      `json:"particoes"`
	BytesTabela    int64      `json:"bytes_tabela"`
	BytesIndices   int64      `json:"bytes_indices"`
	BytesTotal     int64      `json:"bytes_total"`
	TuplasVivas    int64      `json:"tuplas_vivas"`
	TuplasMortas   int64      `json:"tuplas_mortas"`
	Updates        int64      `json:"updates"`
	UpdatesHOT     int64      `json:"updates_hot"`
	SeqScans       int64      `json:"seq_scans"`
	IdxScans       int64      `json:"idx_scans"`
	UltimoVacuum   *time.Time `json:"ultimo_vacuum"`
	UltimoAutovac  *time.Time `json:"ultimo_autovacuum"`
	UltimoAnalyze  *time.Time `json:"ultimo_analyze"`
	UltimoAutoanal *time.Time `json:"ultimo_autoanalyze"`
	Autovacuums    int64      `json:"autovacuums"`
	Opcoes         []string   `json:"opcoes"` // reloptions: fillfactor, autovacuum_*
}

type SaudeIndice struct {
	Tabela    string `json:"tabela"`
	Nome      string `json:"nome"`
	Usos      int64  `json:"usos"`
	Bytes     int64  `json:"bytes"`
	Unico     bool   `json:"unico"`
	Primario  bool   `json:"primario"`
	Definicao string `json:"definicao"`
	// Candidato a remoção: nunca usado desde o último reset das estatísticas
	// e não garante unicidade (PK e UNIQUE "trabalham" mesmo sem ser lidos).
	Candidato bool `json:"candidato_remocao"`
}

type RelacaoNoCache struct {
	Nome       string  `json:"nome"`
	Tipo       string  `json:"tipo"` // tabela | índice | …
	Buffers    int64   `json:"buffers"`
	Sujos      int64   `json:"sujos"` // alterados na memória, ainda não gravados em disco
	UsoMedio   float64 `json:"uso_medio"`
	PctDoCache float64 `json:"pct_do_cache"`
}

type EstadoCache struct {
	TotalBuffers int64            `json:"total_buffers"` // shared_buffers / 8 KB
	Usados       int64            `json:"usados"`
	Relacoes     []RelacaoNoCache `json:"relacoes"`
}

type Metricas struct {
	Em            time.Time `json:"em"`
	Commits       int64     `json:"commits"`
	Rollbacks     int64     `json:"rollbacks"`
	TuplasLidas   int64     `json:"tuplas_lidas"`
	TuplasEscr    int64     `json:"tuplas_escritas"` // insert + update + delete
	BlocosDisco   int64     `json:"blocos_disco"`
	BlocosCache   int64     `json:"blocos_cache"`
	Deadlocks     int64     `json:"deadlocks"`
	BytesTemp     int64     `json:"bytes_temp"`
	ConexoesAtiv  int64     `json:"conexoes_ativas"`
	ConexoesTotal int64     `json:"conexoes_total"`
}

type Particao struct {
	Nome   string `json:"nome"`
	Faixa  string `json:"faixa"`
	Linhas int64  `json:"linhas_estimadas"` // reltuples: estatística do último ANALYZE
	Bytes  int64  `json:"bytes"`
}

type RegistroAuditoria struct {
	ID        int64           `json:"id"`
	Tabela    string          `json:"tabela"`
	Operacao  string          `json:"operacao"`
	Chave     *string         `json:"chave"`
	Usuario   string          `json:"usuario"`
	Transacao int64           `json:"transacao"`
	Em        time.Time       `json:"em"`
	Antes     json.RawMessage `json:"antes"`
	Depois    json.RawMessage `json:"depois"`
}

type RegistroDDL struct {
	ID         int64     `json:"id"`
	Em         time.Time `json:"em"`
	Usuario    string    `json:"usuario"`
	Comando    string    `json:"comando"`
	TipoObjeto *string   `json:"tipo_objeto"`
	Objeto     *string   `json:"objeto"`
}

type EstadoRedis struct {
	Info           map[string]string `json:"info"`
	HitRatio       *float64          `json:"hit_ratio"` // % de GETs que acharam a chave
	ChavesPorTipo  map[string]int    `json:"chaves_por_prefixo"`
	ChavesVarridas int               `json:"chaves_varridas"`
	VarreduraParou bool              `json:"varredura_parou"` // true = parou no limite
	Stream         []map[string]any  `json:"stream_pedidos"`
	TamanhoStream  int64             `json:"tamanho_stream"`
}

type IndiceMongo struct {
	Nome    string `json:"nome"`
	Chave   string `json:"chave"`
	Unico   bool   `json:"unico"`
	Tamanho int64  `json:"bytes"`
}

type ColecaoMongo struct {
	Nome          string        `json:"nome"`
	Documentos    int64         `json:"documentos"`
	TamanhoDados  int64         `json:"bytes_dados"`       // tamanho lógico (BSON)
	Armazenamento int64         `json:"bytes_armazenados"` // em disco (WiredTiger, comprimido)
	TamanhoMedio  int64         `json:"bytes_por_documento"`
	Indices       []IndiceMongo `json:"indices"`
	Validacao     bool          `json:"tem_validacao"`
}

type EstadoMongo struct {
	Versao     string         `json:"versao"`
	Conexoes   int64          `json:"conexoes"`
	Operacoes  map[string]any `json:"operacoes"` // opcounters desde o início do servidor
	ReplicaSet string         `json:"replica_set"`
	Membros    []string       `json:"membros"`
	Colecoes   []ColecaoMongo `json:"colecoes"`
}

type ReplicaVista struct {
	Nome        string   `json:"nome"` // application_name (cluster_name da réplica)
	Endereco    string   `json:"endereco"`
	Estado      string   `json:"estado"`      // startup | catchup | streaming
	Sincronismo string   `json:"sincronismo"` // async | potential | sync | quorum
	Enviado     string   `json:"enviado_lsn"`
	Gravado     string   `json:"gravado_lsn"`
	Duravel     string   `json:"duravel_lsn"`
	Aplicado    string   `json:"aplicado_lsn"`
	AtrasoBytes int64    `json:"atraso_bytes"` // enviado → aplicado
	AtrasoGrav  *float64 `json:"atraso_gravacao_ms"`
	AtrasoDur   *float64 `json:"atraso_disco_ms"`
	AtrasoApl   *float64 `json:"atraso_aplicacao_ms"` // nulo = sem tráfego recente (em dia)
}

type Slot struct {
	Nome        string `json:"nome"`
	Ativo       bool   `json:"ativo"`
	EstadoWAL   string `json:"estado_wal"` // reserved | extended | unreserved | lost
	RetidoBytes int64  `json:"retido_bytes"`
	Invalidado  string `json:"invalidado,omitempty"`
}

type Arquivamento struct {
	Modo        string `json:"modo"`
	Arquivados  int64  `json:"arquivados"`
	UltimoWAL   string `json:"ultimo_wal"`
	UltimoEm    string `json:"ultimo_em"`
	Falhas      int64  `json:"falhas"`
	UltimaFalha string `json:"ultima_falha,omitempty"` // só se depois do último sucesso (T1)
}

type LadoReplica struct {
	EmRecuperacao bool     `json:"em_recuperacao"`
	Recebido      string   `json:"recebido_lsn"`
	Aplicado      string   `json:"aplicado_lsn"`
	UltimaTransac string   `json:"ultima_transacao_aplicada"`
	Receptor      string   `json:"receptor"` // status do walreceiver
	Origem        string   `json:"origem"`   // host do primário
	SlotUsado     string   `json:"slot_usado"`
	AtrasoS       *float64 `json:"atraso_s"`
}

type EstadoReplicacao struct {
	LSNAtual     string         `json:"lsn_atual"`
	Replicas     []ReplicaVista `json:"replicas"`
	Slots        []Slot         `json:"slots"`
	Arquivamento Arquivamento   `json:"arquivamento"`
	Replica      *LadoReplica   `json:"replica"`
	ReplicaErro  string         `json:"replica_erro,omitempty"`
	SyncNomes    string         `json:"synchronous_standby_names"`
	SyncPadrao   string         `json:"synchronous_commit"`
}
