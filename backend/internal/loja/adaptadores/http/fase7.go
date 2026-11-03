package http

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// Fase 7: "vistos recentemente" (Cassandra) e recomendações (Neo4j).

// Vistos: GET /api/conta/vistos — os últimos produtos distintos abertos.
func (h *Handlers) Vistos(w http.ResponseWriter, r *http.Request) {
	v, err := h.historico.Recentes(r.Context(), contaDe(r))
	if err != nil {
		indisponivel(w, "Cassandra", err)
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

// Recomendacoes: GET /api/catalogo/produtos/{id}/recomendacoes
func (h *Handlers) Recomendacoes(w http.ResponseWriter, r *http.Request) {
	d, err := h.catalogo.Detalhe(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		erro(w, err)
		return
	}
	rec, err := h.recomendacoes.ParaProduto(r.Context(), d.Produto)
	if err != nil {
		indisponivel(w, "Neo4j", err)
		return
	}
	if rec == nil {
		rec = []dominio.Recomendacao{}
	}
	httpx.JSON(w, http.StatusOK, rec)
}

// EstadoDoGrafo: GET /api/recomendacoes/grafo
func (h *Handlers) EstadoDoGrafo(w http.ResponseWriter, r *http.Request) {
	e, err := h.recomendacoes.Estado(r.Context())
	if err != nil {
		indisponivel(w, "Neo4j", err)
		return
	}
	httpx.JSON(w, http.StatusOK, e)
}

// ReconstruirGrafo: POST /api/recomendacoes/grafo/reconstruir — apaga e
// refaz o grafo a partir dos pedidos do PostgreSQL.
func (h *Handlers) ReconstruirGrafo(w http.ResponseWriter, r *http.Request) {
	e, err := h.recomendacoes.Reconstruir(r.Context())
	if err != nil {
		indisponivel(w, "Neo4j", err)
		return
	}
	httpx.JSON(w, http.StatusOK, e)
}

// indisponivel: o banco secundário (Cassandra, Neo4j) está fora — 503 com o
// motivo, e a tela mostra o bloco como indisponível, sem quebrar a página.
func indisponivel(w http.ResponseWriter, banco string, err error) {
	slog.Warn("banco secundário indisponível", "banco", banco, "err", err)
	httpx.Error(w, http.StatusServiceUnavailable, banco+" indisponível: "+err.Error())
}
