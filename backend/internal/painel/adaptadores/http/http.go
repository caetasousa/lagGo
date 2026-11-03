// Package http é o adaptador de entrada do Painel do DBA: rotas /api/dba/*.
package http

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nosqlgo/marketplace/internal/painel/aplicacao"
	"github.com/nosqlgo/marketplace/internal/painel/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

type Handlers struct{ p *aplicacao.Painel }

func NovosHandlers(p *aplicacao.Painel) *Handlers { return &Handlers{p: p} }

// Rotas registra as rotas do painel (debaixo de /api).
func (h *Handlers) Rotas(r chi.Router) {
	r.Route("/dba/postgres", func(r chi.Router) {
		r.Get("/overview", ler(h.p.VisaoGeral))
		r.Get("/top-queries", func(w http.ResponseWriter, r *http.Request) {
			v, err := h.p.ConsultasCaras(r.Context(), httpx.QueryInt(r, "limit", 10, 1, 100))
			responder(w, v, err)
		})
		r.Get("/activity", ler(h.p.Sessoes))
		r.Get("/locks", ler(h.p.Locks))
		// Fase 4: administração
		r.Get("/tabelas", ler(h.p.Tabelas))
		r.Get("/indices", ler(h.p.Indices))
		r.Get("/cache", ler(h.p.Cache))
		r.Get("/metricas", ler(h.p.Metricas))
		r.Get("/particoes", ler(h.p.Particoes))
		r.Post("/manutencao", h.Manutencao)
	})
	r.Get("/dba/pgbouncer", ler(h.p.PgBouncer))
	r.Get("/dba/replicacao", ler(h.p.Replicacao))
	r.Get("/dba/redis", ler(h.p.Redis))
	r.Get("/dba/mongo", ler(h.p.Mongo))

	// Auditoria e manutenção (Fase 2, docs/05)
	r.Get("/dba/auditoria", func(w http.ResponseWriter, r *http.Request) {
		v, err := h.p.Auditoria(r.Context(), httpx.QueryInt(r, "limite", 30, 1, 200))
		responder(w, v, err)
	})
	r.Get("/dba/auditoria/ddl", func(w http.ResponseWriter, r *http.Request) {
		v, err := h.p.AuditoriaDDL(r.Context(), httpx.QueryInt(r, "limite", 20, 1, 200))
		responder(w, v, err)
	})
	r.Post("/dba/manutencao/cancelar-expirados", h.CancelarExpirados)
}

// Manutencao: POST /api/dba/postgres/manutencao  {"acao": "vacuum", "tabela": "public.pedido"}
func (h *Handlers) Manutencao(w http.ResponseWriter, r *http.Request) {
	var b struct{ Acao, Tabela string }
	if err := httpx.Decode(w, r, &b); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	v, err := h.p.ManterTabela(r.Context(), b.Acao, b.Tabela)
	responder(w, v, err)
}

// CancelarExpirados: POST /api/dba/manutencao/cancelar-expirados {"idade_horas": 48, "lote": 500}
func (h *Handlers) CancelarExpirados(w http.ResponseWriter, r *http.Request) {
	body := struct {
		IdadeHoras int `json:"idade_horas"`
		Lote       int `json:"lote"`
	}{IdadeHoras: 48, Lote: 500}
	if r.ContentLength > 0 {
		if err := httpx.Decode(w, r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	v, err := h.p.CancelarExpirados(r.Context(), body.IdadeHoras, body.Lote)
	responder(w, v, err)
}

// ler adapta uma leitura sem parâmetros a um handler.
func ler[T any](f func(context.Context) (T, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := f(r.Context())
		responder(w, v, err)
	}
}

func responder(w http.ResponseWriter, v any, err error) {
	var req dominio.ErrRequisicao
	var val dominio.ErrValidacao
	var ind dominio.ErrIndisponivel
	switch {
	case err == nil:
		httpx.JSON(w, http.StatusOK, v)
	case errors.As(err, &req):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &val):
		httpx.Error(w, http.StatusUnprocessableEntity, err.Error())
	case errors.As(err, &ind):
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
	default:
		slog.Error("painel do DBA", "err", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
}
