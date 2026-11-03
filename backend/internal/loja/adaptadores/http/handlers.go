package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// ------------------------------------------------------------ checkout e carrinho

// FinalizarCheckout: POST /api/checkout?estrategia=condicional (exige login)
// Cabeçalho opcional: Idempotency-Key: <uuid>. O cliente é o da sessão.
func (h *Handlers) FinalizarCheckout(w http.ResponseWriter, r *http.Request) {
	var p dominio.Pedido
	if err := httpx.Decode(w, r, &p); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := p.DaConta(contaDe(r)); err != nil {
		erro(w, err)
		return
	}
	var ok bool
	if p.Chave, ok = chaveDeIdempotencia(w, r); !ok {
		return
	}
	res, err := h.checkout.Finalizar(r.Context(), p, dominio.Opcoes{Estrategia: dominio.Estrategia(r.URL.Query().Get("estrategia"))})
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, statusDaCompra(res), res)
}

// VerCarrinho: GET /api/carrinho
func (h *Handlers) VerCarrinho(w http.ResponseWriter, r *http.Request) {
	s, ok := sessao(w, r)
	if !ok {
		return
	}
	c, err := h.carrinho.Ver(r.Context(), s)
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

// DefinirItem: PUT /api/carrinho/itens/{sku}  {"quantidade": 2}   (0 remove)
func (h *Handlers) DefinirItem(w http.ResponseWriter, r *http.Request) {
	s, ok := sessao(w, r)
	if !ok {
		return
	}
	sku, err := uuid.Parse(chi.URLParam(r, "sku"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "sku inválido")
		return
	}
	var body struct {
		Quantidade int `json:"quantidade"`
	}
	if err := httpx.Decode(w, r, &body); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	c, err := h.carrinho.DefinirItem(r.Context(), s, sku, body.Quantidade)
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

// Esvaziar: DELETE /api/carrinho
func (h *Handlers) Esvaziar(w http.ResponseWriter, r *http.Request) {
	s, ok := sessao(w, r)
	if !ok {
		return
	}
	if err := h.carrinho.Esvaziar(r.Context(), s); err != nil {
		erro(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// FinalizarCarrinho: POST /api/carrinho/finalizar + cabeçalho Idempotency-Key
// {"metodo_pagamento", "endereco_id" (opcional)} — exige login; o cliente é o
// da sessão (Fase 6).
func (h *Handlers) FinalizarCarrinho(w http.ResponseWriter, r *http.Request) {
	s, ok := sessao(w, r)
	if !ok {
		return
	}
	var p dominio.Pedido
	if err := httpx.Decode(w, r, &p); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(p.Itens) > 0 {
		httpx.Error(w, http.StatusBadRequest, "os itens vêm do carrinho, não do corpo da requisição")
		return
	}
	if err := p.DaConta(contaDe(r)); err != nil {
		erro(w, err)
		return
	}
	if p.Chave, ok = chaveDeIdempotencia(w, r); !ok {
		return
	}
	res, err := h.carrinho.Finalizar(r.Context(), s, p)
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, statusDaCompra(res), res)
}

// ------------------------------------------------------------ catálogo

// Buscar: GET /api/catalogo/produtos?busca=&categoria=&preco_de=&preco_ate=&ordenar=&pagina=
func (h *Handlers) Buscar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	res, err := h.catalogo.Buscar(r.Context(), dominio.FiltroBusca{
		Texto:     q.Get("busca"),
		Categoria: int32(httpx.QueryInt(r, "categoria", 0, 1, 1<<30)),
		PrecoDe:   numero(r, "preco_de"),
		PrecoAte:  numero(r, "preco_ate"),
		Ordenar:   q.Get("ordenar"),
		Pagina:    httpx.QueryInt(r, "pagina", 1, 1, 1000),
		PorPagina: httpx.QueryInt(r, "por_pagina", 12, 1, 60),
	})
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

// Detalhe: GET /api/catalogo/produtos/{id}
func (h *Handlers) Detalhe(w http.ResponseWriter, r *http.Request) {
	d, err := h.catalogo.Detalhe(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		erro(w, err)
		return
	}
	w.Header().Set("X-Cache", d.Cache)
	httpx.JSON(w, http.StatusOK, d)
}

// Avaliar: POST /api/catalogo/produtos/{id}/avaliacoes
func (h *Handlers) Avaliar(w http.ResponseWriter, r *http.Request) {
	var a dominio.NovaAvaliacao
	if err := httpx.Decode(w, r, &a); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.DaConta(contaDe(r)); err != nil {
		erro(w, err)
		return
	}
	res, err := h.catalogo.Avaliar(r.Context(), chi.URLParam(r, "id"), a)
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, res)
}

// MaisVendidos: GET /api/catalogo/mais-vendidos?limite=8
func (h *Handlers) MaisVendidos(w http.ResponseWriter, r *http.Request) {
	res, err := h.catalogo.MaisVendidos(r.Context(), int64(httpx.QueryInt(r, "limite", 8, 1, 50)))
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

// ------------------------------------------------------------ vitrine

// Categorias: GET /api/loja/categorias (árvore com caminho e contagem de SKUs)
func (h *Handlers) Categorias(w http.ResponseWriter, r *http.Request) {
	res, err := h.vitrine.Categorias(r.Context())
	responder(w, res, err)
}

// Skus: GET /api/loja/skus?busca=notebook&categoria=3&limite=50
func (h *Handlers) Skus(w http.ResponseWriter, r *http.Request) {
	res, err := h.vitrine.Skus(r.Context(), dominio.FiltroSkus{
		Busca:     r.URL.Query().Get("busca"),
		Categoria: int32(httpx.QueryInt(r, "categoria", 0, 1, 1<<30)),
		Limite:    int32(httpx.QueryInt(r, "limite", 50, 1, 500)),
	})
	responder(w, res, err)
}

// ------------------------------------------------------------ relatórios

// VendasMensais: GET /api/relatorios/vendas-mensais?meses=6
func (h *Handlers) VendasMensais(w http.ResponseWriter, r *http.Request) {
	res, origem, err := h.relatorios.VendasMensais(r.Context(), int32(httpx.QueryInt(r, "meses", 6, 1, 24)))
	comOrigem(w, origem)
	responder(w, res, err)
}

// ReceitaDiaria: GET /api/relatorios/receita-diaria?dias=30
func (h *Handlers) ReceitaDiaria(w http.ResponseWriter, r *http.Request) {
	res, origem, err := h.relatorios.ReceitaDiaria(r.Context(), int32(httpx.QueryInt(r, "dias", 30, 1, 730)))
	comOrigem(w, origem)
	responder(w, res, err)
}

// CurvaABC: GET /api/relatorios/curva-abc?dias=365
func (h *Handlers) CurvaABC(w http.ResponseWriter, r *http.Request) {
	res, origem, err := h.relatorios.CurvaABC(r.Context(), int32(httpx.QueryInt(r, "dias", 365, 1, 730)))
	comOrigem(w, origem)
	responder(w, res, err)
}

// StatusAtualizacao: GET /api/relatorios/atualizacao
func (h *Handlers) StatusAtualizacao(w http.ResponseWriter, r *http.Request) {
	res, origem, err := h.relatorios.StatusAtualizacao(r.Context())
	comOrigem(w, origem)
	responder(w, res, err)
}

// Atualizar: POST /api/relatorios/atualizar (REFRESH + releitura já atualizada)
func (h *Handlers) Atualizar(w http.ResponseWriter, r *http.Request) {
	res, origem, err := h.relatorios.Atualizar(r.Context())
	comOrigem(w, origem)
	responder(w, res, err)
}

func responder[T any](w http.ResponseWriter, rows []T, err error) {
	if err != nil {
		erro(w, err)
		return
	}
	if rows == nil {
		rows = []T{}
	}
	httpx.JSON(w, http.StatusOK, rows)
}
