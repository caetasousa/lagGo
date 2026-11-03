package dominio

import "slices"

// Laboratório de MVCC e VACUUM (Fase 4, docs/06): a tabela lab.inchaco, com
// autovacuum desligado de propósito.

// LinhasDoInchaco: o tamanho da tabela do experimento.
const LinhasDoInchaco = 20000

var AcoesMVCC = []string{"recriar", "atualizar", "atualizar_indexada", "vacuum", "vacuum_full"}

func ValidarAcaoMVCC(acao string, fillfactor int) error {
	if !slices.Contains(AcoesMVCC, acao) {
		return ErrValidacao{"ação desconhecida"}
	}
	if acao == "recriar" && fillfactor != 100 && fillfactor != 70 {
		return ErrValidacao{"fillfactor deve ser 100 ou 70"}
	}
	return nil
}

type EstadoMVCC struct {
	Fillfactor   int     `json:"fillfactor"`
	BytesTabela  int64   `json:"bytes_tabela"`
	BytesIndices int64   `json:"bytes_indices"`
	TuplasVivas  int64   `json:"tuplas_vivas"` // pgstattuple: contagem exata, lendo a tabela
	TuplasMortas int64   `json:"tuplas_mortas"`
	EspacoLivre  int64   `json:"bytes_livres"` // espaço marcado como reutilizável
	PctLivre     float64 `json:"pct_livre"`
	Linha1       string  `json:"linha_1"` // ctid (página, posição), xmin, xmax da linha id = 1
}

type ResultadoMVCC struct {
	Acao        string     `json:"acao"`
	DuracaoMS   float64    `json:"duracao_ms"`
	WALBytes    int64      `json:"wal_bytes"`
	Atualizadas int64      `json:"atualizadas,omitempty"`
	HOT         int64      `json:"hot,omitempty"` // updates que ficaram na mesma página, sem tocar índice
	Antes       EstadoMVCC `json:"antes"`
	Depois      EstadoMVCC `json:"depois"`
	// Horizonte: a transação aberta mais antiga quando o VACUUM terminou com
	// tuplas mortas sobrando. Versão morta que ALGUMA transação ainda pode ver
	// não pode ser removida — o VACUUM só limpa o que ficou "antes do horizonte".
	Horizonte string `json:"horizonte,omitempty"`
}
