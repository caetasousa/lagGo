// Package http é o adaptador de entrada do LABORATÓRIO: as rotas /api/lab/*
// e as do Laboratório de Índices (/api/dba/indices/*, por compatibilidade
// com a tela). Decodifica, chama o caso de uso, serializa.
package http

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nosqlgo/marketplace/internal/laboratorio/aplicacao"
	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// Casos de uso que o adaptador expõe.
type Labs struct {
	Corrida    *aplicacao.Corrida
	Isolamento *aplicacao.Isolamento
	MVCC       *aplicacao.MVCC
	Expurgo    *aplicacao.Expurgo
	Conexoes   *aplicacao.Conexoes
	Replicacao *aplicacao.Replicacao
	Backup     *aplicacao.Backup
	Indices    *aplicacao.Indices
	Cache      *aplicacao.Cache
	HA         *aplicacao.HA
}

type Handlers struct{ l Labs }

func NovosHandlers(l Labs) *Handlers { return &Handlers{l: l} }

// Rotas registra as rotas do laboratório (debaixo de /api). Só para estudo:
// em produção, endpoints destes jamais existiriam.
func (h *Handlers) Rotas(r chi.Router) {
	r.Post("/lab/corrida", h.Corrida)
	r.Get("/lab/isolamento/roteiros", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, h.l.Isolamento.Roteiros())
	})
	r.Post("/lab/isolamento", h.Isolamento)
	r.Get("/lab/mvcc", func(w http.ResponseWriter, r *http.Request) {
		v, err := h.l.MVCC.Estado(r.Context())
		escrever(w, http.StatusOK, v, err)
	})
	r.Post("/lab/mvcc", h.MVCC)
	r.Post("/lab/expurgo", h.Expurgo)
	r.Post("/lab/conexoes", h.Conexoes)
	r.Post("/lab/cache", h.Cache)
	r.Post("/lab/replicacao", h.Replicacao)
	r.Get("/lab/backup", func(w http.ResponseWriter, r *http.Request) {
		v, err := h.l.Backup.Info(r.Context())
		escrever(w, http.StatusOK, v, err)
	})
	r.Post("/lab/backup", h.FazerBackup)
	r.Post("/lab/pitr", h.PITR)
	r.Get("/lab/ha", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{"clusters": h.l.HA.Estado(r.Context()), "ensaio": h.l.HA.Ensaio()})
	})
	r.Post("/lab/ha", h.IniciarHA)

	// Laboratório de Índices (Fases 2 e 4, docs/04)
	r.Get("/dba/indices/experimentos", func(w http.ResponseWriter, r *http.Request) {
		v, err := h.l.Indices.Experimentos(r.Context())
		escrever(w, http.StatusOK, v, err)
	})
	r.Post("/dba/indices/experimentos/{id}/explain", h.Explain)
	r.Post("/dba/indices/{nome}", h.CriarIndice)
	r.Delete("/dba/indices/{nome}", h.RemoverIndice)
}

// decodificar lê o corpo JSON; false = já respondeu 400.
func decodificar(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := httpx.Decode(w, r, v); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func escrever(w http.ResponseWriter, status int, v any, err error) {
	var val dominio.ErrValidacao
	var req dominio.ErrRequisicao
	var nao dominio.ErrNaoEncontrado
	switch {
	case err == nil:
		httpx.JSON(w, status, v)
	case errors.As(err, &req):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &nao):
		httpx.Error(w, http.StatusNotFound, err.Error())
	case errors.As(err, &val):
		httpx.Error(w, http.StatusUnprocessableEntity, err.Error())
	default:
		slog.Error("laboratório", "err", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
}

// Corrida: POST /api/lab/corrida
func (h *Handlers) Corrida(w http.ResponseWriter, r *http.Request) {
	var p dominio.CorridaParams
	if !decodificar(w, r, &p) {
		return
	}
	v, err := h.l.Corrida.Rodar(r.Context(), p)
	escrever(w, http.StatusOK, v, err)
}

// Isolamento: POST /api/lab/isolamento {"roteiro": "lost-update", "nivel": "read_committed"}
func (h *Handlers) Isolamento(w http.ResponseWriter, r *http.Request) {
	var b struct{ Roteiro, Nivel string }
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Isolamento.Rodar(r.Context(), b.Roteiro, b.Nivel)
	escrever(w, http.StatusOK, v, err)
}

// MVCC: POST /api/lab/mvcc {"acao": "recriar", "fillfactor": 70}
func (h *Handlers) MVCC(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Acao       string `json:"acao"`
		Fillfactor int    `json:"fillfactor"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.MVCC.Executar(r.Context(), b.Acao, b.Fillfactor)
	escrever(w, http.StatusOK, v, err)
}

// Expurgo: POST /api/lab/expurgo {"metodo": "drop", "linhas": 30000}
func (h *Handlers) Expurgo(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Metodo string `json:"metodo"`
		Linhas int    `json:"linhas"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Expurgo.Expurgar(r.Context(), b.Metodo, b.Linhas)
	escrever(w, http.StatusOK, v, err)
}

// Conexoes: POST /api/lab/conexoes {"modo": "pgbouncer", "clientes": 50, "segundos": 3}
func (h *Handlers) Conexoes(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Modo     string `json:"modo"`
		Clientes int    `json:"clientes"`
		Segundos int    `json:"segundos"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Conexoes.Rodar(r.Context(), b.Modo, b.Clientes, b.Segundos)
	escrever(w, http.StatusOK, v, err)
}

// Cache: POST /api/lab/cache {"leituras": 200}
func (h *Handlers) Cache(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Leituras int `json:"leituras"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Cache.Rodar(r.Context(), b.Leituras)
	escrever(w, http.StatusOK, v, err)
}

// Replicacao: POST /api/lab/replicacao {"modo": "remote_apply", "transacoes": 50, "com_carga": false}
func (h *Handlers) Replicacao(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Modo       string `json:"modo"`
		Transacoes int    `json:"transacoes"`
		ComCarga   bool   `json:"com_carga"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Replicacao.Rodar(r.Context(), b.Modo, b.Transacoes, b.ComCarga)
	escrever(w, http.StatusOK, v, err)
}

// FazerBackup: POST /api/lab/backup {"tipo": "full" | "diff" | "incr"}
func (h *Handlers) FazerBackup(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Tipo string `json:"tipo"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Backup.Fazer(r.Context(), b.Tipo)
	escrever(w, http.StatusOK, v, err)
}

// PITR: POST /api/lab/pitr {"alvo": "antes-do-drop" | "antes-do-lote2"}
func (h *Handlers) PITR(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Alvo string `json:"alvo"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Backup.PITR(r.Context(), b.Alvo)
	escrever(w, http.StatusOK, v, err)
}

// IniciarHA: POST /api/lab/ha {"tecnologia": "patroni", "acao": "queda", "garantia": true}
// 202: o ensaio roda em segundo plano; a tela acompanha pelo GET.
func (h *Handlers) IniciarHA(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Tecnologia string `json:"tecnologia"`
		Acao       string `json:"acao"`
		Garantia   bool   `json:"garantia"`
	}
	if !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.HA.Iniciar(r.Context(), b.Tecnologia, b.Acao, b.Garantia)
	escrever(w, http.StatusAccepted, v, err)
}

// Explain: POST /api/dba/indices/experimentos/{id}/explain {"work_mem": "4MB", "ajustes": {...}}
func (h *Handlers) Explain(w http.ResponseWriter, r *http.Request) {
	var b struct {
		WorkMem string            `json:"work_mem"`
		Ajustes map[string]string `json:"ajustes"`
	}
	if r.ContentLength > 0 && !decodificar(w, r, &b) {
		return
	}
	v, err := h.l.Indices.Explain(r.Context(), chi.URLParam(r, "id"), b.WorkMem, b.Ajustes)
	escrever(w, http.StatusOK, v, err)
}

// CriarIndice: POST /api/dba/indices/{nome} (só índices do catálogo)
func (h *Handlers) CriarIndice(w http.ResponseWriter, r *http.Request) {
	nome := chi.URLParam(r, "nome")
	d, err := h.l.Indices.Criar(r.Context(), nome)
	escrever(w, http.StatusOK, map[string]any{"nome": nome, "duracao_ms": d.Milliseconds()}, err)
}

// RemoverIndice: DELETE /api/dba/indices/{nome}
func (h *Handlers) RemoverIndice(w http.ResponseWriter, r *http.Request) {
	if err := h.l.Indices.Remover(r.Context(), chi.URLParam(r, "nome")); err != nil {
		escrever(w, 0, nil, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
