// Package health verifica, em paralelo, cada banco de dados do projeto.
// É a primeira tela do Painel do DBA.
package health

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

// Probe testa um banco e devolve a versão do servidor.
type Probe struct {
	Name  string
	Model string // modelo de dados: relacional, documento, chave-valor, wide-column, grafo
	Check func(ctx context.Context) (version string, err error)
}

type Status struct {
	Name      string  `json:"name"`
	Model     string  `json:"model"`
	Status    string  `json:"status"` // up | down | disabled
	Version   string  `json:"version,omitempty"`
	LatencyMS float64 `json:"latency_ms"`
	Error     string  `json:"error,omitempty"`
}

type Handler struct {
	probes []Probe
}

func NewHandler(probes ...Probe) *Handler {
	return &Handler{probes: probes}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	results := make([]Status, len(h.probes))
	var wg sync.WaitGroup
	for i, p := range h.probes {
		wg.Go(func() {
			start := time.Now()
			version, err := p.Check(ctx)
			s := Status{
				Name:      p.Name,
				Model:     p.Model,
				Status:    "up",
				Version:   version,
				LatencyMS: float64(time.Since(start).Microseconds()) / 1000,
			}
			switch {
			case errors.Is(err, storage.ErrDisabled), hostNotFound(err):
				s.Status, s.Error = "disabled", storage.ErrDisabled.Error()
			case err != nil:
				s.Status, s.Error = "down", err.Error()
			}
			results[i] = s
		})
	}
	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

// hostNotFound detecta o caso "container do perfil nosql não está rodando":
// o nome do serviço não existe no DNS do Docker. Os drivers nem sempre
// embrulham o *net.DNSError, por isso há também a checagem por texto.
func hostNotFound(err error) bool {
	if err == nil {
		return false
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "no such host") || strings.Contains(msg, "failed to resolve any of the provided hostnames")
}
