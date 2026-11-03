package dominio

import "slices"

// Laboratório de Consistência ajustável (Fase 7, Cassandra, docs/07).
//
// No Cassandra, cada leitura e cada escrita escolhem QUANTAS réplicas precisam
// responder (consistency level). Com fator de replicação RF:
//
//	ONE     1 réplica
//	QUORUM  RF/2 + 1 (a maioria)
//	ALL     todas as RF
//
// Se R + W > RF (réplicas da leitura + da escrita), a leitura sempre cruza com
// alguma réplica que recebeu a última escrita: consistência forte. O preço é a
// disponibilidade — se não houver réplicas vivas suficientes, a operação falha.

var NiveisDeConsistencia = []string{"ONE", "QUORUM", "ALL"}
var FatoresDeReplicacao = []int{1, 3}

// Necessarias: quantas réplicas o nível exige com este RF.
func Necessarias(nivel string, rf int) int {
	switch nivel {
	case "ONE":
		return 1
	case "QUORUM":
		return rf/2 + 1
	default: // ALL
		return rf
	}
}

func ValidarConsistencia(rf int) error {
	if !slices.Contains(FatoresDeReplicacao, rf) {
		return ErrValidacao{"fator de replicação deve ser 1 ou 3"}
	}
	return nil
}

// Tentativa: uma escrita seguida de uma leitura com o mesmo nível.
type Tentativa struct {
	Nivel       string  `json:"nivel"`
	Necessarias int     `json:"necessarias"`
	Escreveu    bool    `json:"escreveu"`
	ErroEscrita string  `json:"erro_escrita,omitempty"`
	Leu         bool    `json:"leu"`
	ErroLeitura string  `json:"erro_leitura,omitempty"`
	MS          float64 `json:"ms"`
	ForteComEle bool    `json:"forte_com_ele"` // R+W > RF lendo e escrevendo neste nível
}

type ResultadoConsistencia struct {
	RF         int         `json:"rf"`
	Vivas      int         `json:"replicas_vivas"` // nós do cluster no ar (aqui, 1)
	Keyspace   string      `json:"keyspace"`
	Tentativas []Tentativa `json:"tentativas"`
}
