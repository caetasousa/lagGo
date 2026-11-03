package http

import (
	"context"
	"net/http"
	"strings"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// Cadastro, login e conta (Fase 6, cenários Q).
//
// O token da sessão vai num COOKIE:
//   - HttpOnly: o JavaScript da página não lê (um XSS não rouba a sessão);
//   - SameSite=Lax: o navegador não manda o cookie num POST vindo de outro
//     site (defesa contra CSRF);
//   - Secure quando a requisição chegou por HTTPS (atrás do Cloudflare);
//   - Path=/api: só as chamadas à API carregam o cookie.
// O token nunca aparece no corpo da resposta.

const cookieSessao = "nosqlgo_sessao"

type chaveConta struct{}

// contaDe: a conta que o middleware autenticado pôs no contexto.
func contaDe(r *http.Request) dominio.Conta {
	c, _ := r.Context().Value(chaveConta{}).(dominio.Conta)
	return c
}

// autenticado só deixa passar quem tem sessão válida; põe a conta no contexto.
func (h *Handlers) autenticado(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := h.contas.Autenticar(r.Context(), tokenDe(r))
		if err != nil {
			erro(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chaveConta{}, c)))
	})
}

func tokenDe(r *http.Request) string {
	if c, err := r.Cookie(cookieSessao); err == nil {
		return c.Value
	}
	return ""
}

// https: direto (r.TLS) ou atrás de proxy (Cloudflare → cloudflared → nginx).
func https(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" ||
		strings.Contains(r.Header.Get("Cf-Visitor"), `"https"`)
}

func gravarCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: cookieSessao, Value: token, Path: "/api", MaxAge: maxAge,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: https(r)})
}

// Cadastrar: POST /api/conta/cadastro {nome, email, senha, cpf, endereco{…}}
func (h *Handlers) Cadastrar(w http.ResponseWriter, r *http.Request) {
	var c dominio.Cadastro
	if err := httpx.Decode(w, r, &c); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	e, err := h.contas.Cadastrar(r.Context(), c)
	if err != nil {
		erro(w, err)
		return
	}
	gravarCookie(w, r, e.Token, int(dominio.ValidadeDaSessao.Seconds()))
	httpx.JSON(w, http.StatusCreated, e.Conta)
}

// Entrar: POST /api/conta/entrar {email, senha}
func (h *Handlers) Entrar(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email string `json:"email"`
		Senha string `json:"senha"`
	}
	if err := httpx.Decode(w, r, &b); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	e, err := h.contas.Entrar(r.Context(), strings.TrimSpace(b.Email), b.Senha)
	if err != nil {
		erro(w, err)
		return
	}
	gravarCookie(w, r, e.Token, int(dominio.ValidadeDaSessao.Seconds()))
	httpx.JSON(w, http.StatusOK, e.Conta)
}

// Sair: POST /api/conta/sair — apaga a sessão no Redis e o cookie.
func (h *Handlers) Sair(w http.ResponseWriter, r *http.Request) {
	if err := h.contas.Sair(r.Context(), tokenDe(r)); err != nil {
		erro(w, err)
		return
	}
	gravarCookie(w, r, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

// Eu: GET /api/conta/eu — a conta logada (e-mail e CPF mascarados).
func (h *Handlers) Eu(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, contaDe(r))
}

// MeusPedidos: GET /api/conta/pedidos?limite=30
func (h *Handlers) MeusPedidos(w http.ResponseWriter, r *http.Request) {
	res, err := h.contas.MeusPedidos(r.Context(), contaDe(r), int32(httpx.QueryInt(r, "limite", 30, 1, 100)))
	responder(w, res, err)
}

// MeuPedido: GET /api/conta/pedidos/{id} — 404 também para pedido de outra
// pessoa (cenário Q5): o banco, com RLS, simplesmente não o devolve.
func (h *Handlers) MeuPedido(w http.ResponseWriter, r *http.Request) {
	id, ok := idDaURL(w, r)
	if !ok {
		return
	}
	d, err := h.contas.MeuPedido(r.Context(), contaDe(r), id)
	if err != nil {
		erro(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

// ExcluirConta: DELETE /api/conta — "direito ao esquecimento" (LGPD).
func (h *Handlers) ExcluirConta(w http.ResponseWriter, r *http.Request) {
	if err := h.contas.Esquecer(r.Context(), contaDe(r)); err != nil {
		erro(w, err)
		return
	}
	gravarCookie(w, r, "", -1)
	w.WriteHeader(http.StatusNoContent)
}
