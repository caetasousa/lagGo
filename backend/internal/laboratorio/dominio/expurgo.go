package dominio

// Laboratório de Particionamento e Expurgo (Fase 4, docs/06): apagar UM MÊS
// da auditoria particionada com DELETE ou com DROP da partição. O mês é de
// 18 meses atrás — fora do histórico do seed, numa partição só do experimento.

const MesesAtrasDoExpurgo = 18

func ValidarExpurgo(metodo string, linhas int) error {
	if metodo != "delete" && metodo != "drop" {
		return ErrValidacao{"método deve ser delete ou drop"}
	}
	if linhas < 1000 || linhas > 200000 {
		return ErrValidacao{"linhas deve estar entre 1000 e 200000"}
	}
	return nil
}

type ResultadoExpurgo struct {
	Metodo          string  `json:"metodo"` // delete | drop
	Particao        string  `json:"particao"`
	LinhasRemovidas int64   `json:"linhas_removidas"`
	DuracaoMS       float64 `json:"duracao_ms"`
	WALBytes        int64   `json:"wal_bytes"`
	BytesAntes      int64   `json:"bytes_antes"`
	BytesDepois     int64   `json:"bytes_depois"`
	TuplasMortas    int64   `json:"tuplas_mortas"` // deixadas para trás (só o DELETE deixa)
	OutrasAntes     int64   `json:"outras_linhas_antes"`
	OutrasDepois    int64   `json:"outras_linhas_depois"` // os outros meses ficaram intactos?
}
