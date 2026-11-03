// Package http é o ADAPTADOR DE ENTRADA da loja: transforma requisições HTTP
// em chamadas aos casos de uso (aplicacao) e os resultados — e os erros do
// domínio — em respostas JSON. Não tem regra de negócio nem fala com banco.
package http

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/aplicacao"
	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// Handlers da loja. Cada um recebe só os casos de uso de que precisa.
type Handlers struct {
	checkout   *aplicacao.Checkout
	carrinho   *aplicacao.Carrinho
	catalogo   *aplicacao.Catalogo
	vitrine    *aplicacao.Vitrine
	relatorios *aplicacao.Relatorios
	contas     *aplicacao.Contas
}

func NovosHandlers(checkout *aplicacao.Checkout, carrinho *aplicacao.Carrinho, catalogo *aplicacao.Catalogo,
	vitrine *aplicacao.Vitrine, relatorios *aplicacao.Relatorios, contas *aplicacao.Contas) *Handlers {
	return &Handlers{checkout: checkout, carrinho: carrinho, catalogo: catalogo, vitrine: vitrine, relatorios: relatorios, contas: contas}
}

// Rotas registra as rotas da loja (debaixo de /api).
func (h *Handlers) Rotas(r chi.Router, limite func(nome string) func(http.Handler) http.Handler) {
	// Loja (Fase 1, PostgreSQL)
	r.Get("/loja/skus", h.Skus)
	r.Get("/loja/categorias", h.Categorias)
	r.With(h.autenticado).Post("/checkout", h.FinalizarCheckout)

	// Conta (Fase 6): cadastro, login, sessão no Redis, pedidos com RLS, LGPD.
	// A lista pública de clientes e o pedido aberto por id saíram (Q5).
	r.With(limite("cadastro")).Post("/conta/cadastro", h.Cadastrar)
	r.With(limite("entrar")).Post("/conta/entrar", h.Entrar)
	r.Post("/conta/sair", h.Sair)
	r.Group(func(r chi.Router) {
		r.Use(h.autenticado)
		r.Get("/conta/eu", h.Eu)
		r.Delete("/conta", h.ExcluirConta)
		r.Get("/conta/pedidos", h.MeusPedidos)
		r.Get("/conta/pedidos/{id}", h.MeuPedido)
	})

	// Relatórios (Fase 2; da réplica desde a Fase 5)
	r.Get("/relatorios/vendas-mensais", h.VendasMensais)
	r.Get("/relatorios/receita-diaria", h.ReceitaDiaria)
	r.Get("/relatorios/curva-abc", h.CurvaABC)
	r.Get("/relatorios/atualizacao", h.StatusAtualizacao)
	r.Post("/relatorios/atualizar", h.Atualizar)

	// Catálogo (Fase 3, MongoDB + cache no Redis)
	r.Get("/catalogo/produtos", h.Buscar)
	r.Get("/catalogo/produtos/{id}", h.Detalhe)
	r.With(limite("avaliacoes"), h.autenticado).Post("/catalogo/produtos/{id}/avaliacoes", h.Avaliar)
	r.Get("/catalogo/mais-vendidos", h.MaisVendidos)

	// Carrinho (Fase 3, Redis)
	r.Get("/carrinho", h.VerCarrinho)
	r.Put("/carrinho/itens/{sku}", h.DefinirItem)
	r.Delete("/carrinho", h.Esvaziar)
	r.With(limite("finalizar"), h.autenticado).Post("/carrinho/finalizar", h.FinalizarCarrinho)
}

// erro traduz os erros do domínio em status HTTP.
func erro(w http.ResponseWriter, err error) {
	var v dominio.ErrValidacao
	switch {
	case errors.Is(err, dominio.ErrProdutoNaoEncontrado), errors.Is(err, dominio.ErrPedidoNaoEncontrado):
		httpx.Error(w, http.StatusNotFound, err.Error())
	case errors.As(err, &v), errors.Is(err, dominio.ErrSkuInvalido), errors.Is(err, dominio.ErrClienteNaoEncontrado):
		httpx.Error(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, dominio.ErrCredenciais), errors.Is(err, dominio.ErrNaoAutenticado):
		httpx.Error(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, dominio.ErrSemEstoque):
		httpx.Error(w, http.StatusConflict, err.Error())
	default:
		slog.Error("loja", "err", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
}

// chaveDeIdempotencia lê o cabeçalho Idempotency-Key (opcional).
func chaveDeIdempotencia(w http.ResponseWriter, r *http.Request) (*uuid.UUID, bool) {
	k := r.Header.Get("Idempotency-Key")
	if k == "" {
		return nil, true
	}
	c, err := uuid.Parse(k)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "Idempotency-Key deve ser um UUID")
		return nil, false
	}
	return &c, true
}

// sessao: um UUID gerado pelo navegador e enviado no cabeçalho X-Sessao. É o
// carrinho de quem ainda NÃO entrou: dá para montar o carrinho deslogado; o
// login só é exigido para finalizar (Fase 6).
func sessao(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	s, err := uuid.Parse(r.Header.Get("X-Sessao"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "header X-Sessao ausente ou inválido (precisa ser um UUID)")
		return uuid.Nil, false
	}
	return s, true
}

func idDaURL(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "id inválido")
		return uuid.Nil, false
	}
	return id, true
}

func statusDaCompra(res dominio.Resultado) int {
	if res.Reaproveitado {
		return http.StatusOK
	}
	return http.StatusCreated
}

func comOrigem(w http.ResponseWriter, origem dominio.Origem) {
	if origem != "" {
		w.Header().Set("X-Origem-Leitura", string(origem))
	}
}

func numero(r *http.Request, nome string) float64 {
	v, _ := strconv.ParseFloat(r.URL.Query().Get(nome), 64)
	return max(v, 0)
}
