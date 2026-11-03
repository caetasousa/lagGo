package dominio

import (
	"slices"
	"time"
)

// Laboratório de Backup e PITR (Fase 5, docs/08).

var TiposDeBackup = []string{"full", "diff", "incr"}

func ValidarTipoDeBackup(tipo string) error {
	if !slices.Contains(TiposDeBackup, tipo) {
		return ErrValidacao{"tipo deve ser full, diff ou incr"}
	}
	return nil
}

// Os dois instantes-alvo do ensaio de PITR e quantas linhas cada um deve trazer.
const (
	LinhasDoLote1 = 1000
	LinhasDoLote2 = 500
)

func LinhasEsperadasNoAlvo(alvo string) (int, error) {
	switch alvo {
	case "antes-do-drop":
		return LinhasDoLote1 + LinhasDoLote2, nil
	case "antes-do-lote2":
		return LinhasDoLote1, nil
	}
	return 0, ErrValidacao{"alvo deve ser antes-do-drop ou antes-do-lote2"}
}

type Backup struct {
	Rotulo       string    `json:"rotulo"`
	Tipo         string    `json:"tipo"`
	Inicio       time.Time `json:"inicio"`
	Fim          time.Time `json:"fim"`
	Referencia   []string  `json:"referencia,omitempty"` // backups de que este depende
	TamanhoBanco int64     `json:"tamanho_banco"`        // tamanho do cluster no momento
	Copiado      int64     `json:"copiado"`              // o que ESTE backup copiou (delta)
	NoRepo       int64     `json:"no_repositorio"`       // ocupado no repositório (comprimido)
	WALInicio    string    `json:"wal_inicio"`
	WALFim       string    `json:"wal_fim"`
}

type InfoBackup struct {
	Status      string   `json:"status"`
	Backups     []Backup `json:"backups"`
	WALMin      string   `json:"wal_min"`
	WALMax      string   `json:"wal_max"`
	Arquivados  int64    `json:"wal_arquivados"`
	FalhasWAL   int64    `json:"falhas_arquivamento"`
	UltimoWAL   string   `json:"ultimo_wal_arquivado"`
	UltimaFalha string   `json:"ultima_falha,omitempty"` // só se for mais recente que o último sucesso (T1)
}

type ResultadoBackup struct {
	Tipo    string     `json:"tipo"`
	Duracao float64    `json:"duracao_ms"`
	Saida   []string   `json:"saida"`
	Novo    *Backup    `json:"novo"`
	Info    InfoBackup `json:"info"`
}

type EtapaPITR struct {
	Nome    string  `json:"nome"`
	MS      float64 `json:"ms"`
	Detalhe string  `json:"detalhe"`
}

type ResultadoPITR struct {
	Alvo          string      `json:"alvo"`
	AlvoEm        string      `json:"alvo_em"`
	Lote1         int         `json:"lote1"`
	Lote2         int         `json:"lote2"`
	Esperadas     int         `json:"esperadas"` // quantas o alvo escolhido deve trazer
	Restauradas   int         `json:"restauradas"`
	NoPrimario    bool        `json:"tabela_no_primario"` // a tabela continua apagada no primário (T4)
	BackupUsado   string      `json:"backup_usado"`
	Etapas        []EtapaPITR `json:"etapas"`
	RecuperacaoMS float64     `json:"recuperacao_ms"` // restore + subir a instância: o RTO deste ensaio
}
