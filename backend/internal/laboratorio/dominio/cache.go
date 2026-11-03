package dominio

import (
	"slices"
	"time"
)

// Laboratório de Cache (Fase 4, docs/07): o mesmo documento lido N vezes
// direto do MongoDB e N vezes pelo cache-aside do Redis.

func ValidarLeituras(n int) error {
	if n < 10 || n > 2000 {
		return ErrValidacao{"leituras deve estar entre 10 e 2000"}
	}
	return nil
}

type Medidas struct {
	Leituras int     `json:"leituras"`
	TotalMS  float64 `json:"total_ms"`
	P50MS    float64 `json:"p50_ms"`
	P95MS    float64 `json:"p95_ms"`
}

type ResultadoLabCache struct {
	Produto      string  `json:"produto"`
	SemCache     Medidas `json:"sem_cache"`
	ComCache     Medidas `json:"com_cache"`
	Acertos      int     `json:"acertos"`
	Falhas       int     `json:"falhas"`
	BytesNoRedis int64   `json:"bytes_no_redis"`
	TTLSegundos  int64   `json:"ttl_segundos"`
}

// Medir resume as latências: total, mediana (p50) e cauda (p95).
func Medir(lat []time.Duration) Medidas {
	m := Medidas{Leituras: len(lat)}
	ord := slices.Clone(lat)
	slices.Sort(ord)
	for _, d := range ord {
		m.TotalMS += float64(d.Microseconds()) / 1000
	}
	if len(ord) > 0 {
		m.P50MS = float64(ord[len(ord)/2].Microseconds()) / 1000
		m.P95MS = float64(ord[int(float64(len(ord)-1)*0.95)].Microseconds()) / 1000
	}
	return m
}
