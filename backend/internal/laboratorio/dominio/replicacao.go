package dominio

import (
	"slices"
	"strings"
)

// Laboratório de Replicação (Fase 5, docs/08). Cada transação grava UMA linha
// no primário com um valor de synchronous_commit e, logo depois do COMMIT, a
// linha é procurada na réplica:
//
//	off           o COMMIT nem espera o WAL ir para o disco local
//	local         espera o disco local; não espera a réplica (padrão do projeto)
//	remote_write  espera a réplica RECEBER e entregar ao sistema operacional
//	on            espera a réplica gravar no DISCO dela (durável lá)
//	remote_apply  espera a réplica APLICAR: a linha já é visível nela
//
// Só remote_apply garante ler na réplica o que acabou de ser gravado.

var ModosSync = []string{"off", "local", "remote_write", "on", "remote_apply"}

// ModosQueEsperam: fazem o COMMIT esperar a réplica (e travariam sem ela: S6).
var ModosQueEsperam = []string{"remote_write", "on", "remote_apply"}

func ValidarReplicacao(modo string, transacoes int) error {
	if !slices.Contains(ModosSync, modo) {
		return ErrValidacao{"modo deve ser um de: " + strings.Join(ModosSync, ", ")}
	}
	if transacoes < 1 || transacoes > 200 {
		return ErrValidacao{"transações entre 1 e 200"}
	}
	return nil
}

type ResultadoReplicacao struct {
	Modo           string  `json:"modo"`
	Transacoes     int     `json:"transacoes"`
	ComCarga       bool    `json:"com_carga"`
	CommitP50MS    float64 `json:"commit_p50_ms"`
	CommitP95MS    float64 `json:"commit_p95_ms"`
	VisiveisNaHora int     `json:"visiveis_na_hora"` // já estavam na réplica logo após o COMMIT
	AteAparecerP50 float64 `json:"ate_aparecer_p50_ms"`
	AteAparecerMax float64 `json:"ate_aparecer_max_ms"`
	NaoApareceram  int     `json:"nao_apareceram"`   // nem depois de 2 s
	AtrasoMaxBytes int64   `json:"atraso_max_bytes"` // maior distância enviado → aplicado vista
	EstadoReplica  string  `json:"estado_replica"`   // pg_stat_replication: state / sync_state
}
