//go:build integration

package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// navegador: um cliente HTTP com cookies, como um navegador de verdade.
type navegador struct {
	t   *testing.T
	url string
	c   *http.Client
}

func novoNavegador(t *testing.T, s *servidor) *navegador {
	jar, _ := cookiejar.New(nil)
	return &navegador{t: t, url: s.url, c: &http.Client{Jar: jar}}
}

func (n *navegador) req(metodo, caminho string, corpo, out any) (int, *http.Response) {
	n.t.Helper()
	var body io.Reader
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		body = bytes.NewReader(b)
	}
	r, _ := http.NewRequest(metodo, n.url+caminho, body)
	r.Header.Set("Content-Type", "application/json")
	resp, err := n.c.Do(r)
	if err != nil {
		n.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			n.t.Fatalf("%s %s (%d): %s", metodo, caminho, resp.StatusCode, raw)
		}
	}
	return resp.StatusCode, resp
}

func cadastro(email, cpf string) map[string]any {
	return map[string]any{"nome": "Bia Souza", "email": email, "senha": "uma senha bem longa", "cpf": cpf,
		"endereco": map[string]any{"cep": "01310-100", "logradouro": "Av. Paulista", "numero": "1000", "cidade": "São Paulo", "uf": "SP"}}
}

type contaResp struct {
	ClienteID      string `json:"cliente_id"`
	Nome           string `json:"nome"`
	EmailMascarado string `json:"email_mascarado"`
	CPFMascarado   string `json:"cpf_mascarado"`
	EnderecoID     string `json:"endereco_id"`
}

type erroResp struct{ Error string }

// Como quebra (Q1, Q2, Q3, Q7): cadastro aceita duplicado ou inválido; o
// cookie não é HttpOnly; "sair" não mata a sessão no servidor; a mensagem do
// login conta quem tem conta; a senha ou o token ficam legíveis no banco.
func TestCadastroLoginESessao(t *testing.T) {
	s := novoServidor(t)
	nav := novoNavegador(t, s)
	ctx := context.Background()

	var eu contaResp
	st, resp := nav.req("POST", "/api/conta/cadastro", cadastro("Bia@Exemplo.com", "529.982.247-25"), &eu)
	if st != 201 || eu.ClienteID == "" {
		t.Fatalf("[Q1] cadastro: %d %+v", st, eu)
	}
	var token string
	for _, ck := range resp.Cookies() {
		if ck.Name == "nosqlgo_sessao" {
			token = ck.Value
			if !ck.HttpOnly || ck.SameSite != http.SameSiteLaxMode || ck.Path != "/api" {
				t.Fatalf("[Q2] cookie sem HttpOnly/SameSite/Path: %+v", ck)
			}
		}
	}
	if token == "" {
		t.Fatal("[Q2] o cadastro não abriu a sessão")
	}
	if eu.CPFMascarado != "***.***.***-25" || eu.EmailMascarado != "B***@Exemplo.com" {
		t.Fatalf("[Q6] dados não mascarados: %+v", eu)
	}

	// Q1: e-mail repetido (citext: maiúsculas não importam) e CPF repetido.
	outro := novoNavegador(t, s)
	for nome, c := range map[string]map[string]any{
		"e-mail repetido": cadastro("bia@exemplo.com", "390.533.447-05"),
		"CPF repetido":    cadastro("outra@exemplo.com", "52998224725"),
		"CPF inválido":    cadastro("outra@exemplo.com", "52998224726"),
	} {
		var e erroResp
		if st, _ := outro.req("POST", "/api/conta/cadastro", c, &e); st != 422 || e.Error == "" {
			t.Errorf("[Q1] %s: %d %+v", nome, st, e)
		}
	}

	// Q7: no banco, só o hash argon2id; no Redis, só o hash do token.
	var hash string
	if err := s.pg.QueryRow(ctx, "SELECT senha_hash FROM conta.credencial WHERE cliente_id = $1", eu.ClienteID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") || strings.Contains(hash, "uma senha") {
		t.Fatalf("[Q7] senha_hash: %s", hash)
	}
	if _, err := s.pg.Exec(ctx, "UPDATE conta.credencial SET senha_hash = 'texto puro' WHERE cliente_id = $1", eu.ClienteID); err == nil {
		t.Fatal("[Q7] a CHECK deixou gravar senha que não é hash argon2id")
	}
	var chaves []string
	iter := s.rdb.Scan(ctx, 0, "sessao:*", 100).Iterator() // SCAN, nunca KEYS (CLAUDE.md)
	for iter.Next(ctx) {
		chaves = append(chaves, iter.Val())
	}
	for _, k := range chaves {
		v, _ := s.rdb.Get(ctx, k).Result()
		if strings.Contains(k, token) || strings.Contains(v, token) {
			t.Fatalf("[Q7] o token da sessão está legível no Redis (%s)", k)
		}
	}
	if ttl := s.rdb.TTL(ctx, chaves[0]).Val(); ttl <= 0 {
		t.Fatalf("[Q7] sessão sem TTL: %v", ttl)
	}

	// Q3: senha errada e e-mail inexistente: mesmo status, mesma mensagem.
	var e1, e2 erroResp
	st1, _ := outro.req("POST", "/api/conta/entrar", map[string]string{"email": "bia@exemplo.com", "senha": "errada errada"}, &e1)
	st2, _ := outro.req("POST", "/api/conta/entrar", map[string]string{"email": "ninguem@exemplo.com", "senha": "errada errada"}, &e2)
	if st1 != 401 || st2 != 401 || e1.Error != e2.Error {
		t.Fatalf("[Q3] respostas diferentes: %d %q × %d %q", st1, e1.Error, st2, e2.Error)
	}
	if st, _ := outro.req("POST", "/api/conta/entrar", map[string]string{"email": "BIA@exemplo.com", "senha": "uma senha bem longa"}, nil); st != 200 {
		t.Fatalf("[Q2] entrar com a senha certa: %d", st)
	}

	// Q2: sair apaga a sessão NO SERVIDOR — o token antigo não vale mais.
	if st, _ := nav.req("POST", "/api/conta/sair", nil, nil); st != 204 {
		t.Fatalf("[Q2] sair: %d", st)
	}
	velho, _ := http.NewRequest("GET", s.url+"/api/conta/eu", nil)
	velho.AddCookie(&http.Cookie{Name: "nosqlgo_sessao", Value: token})
	r, _ := http.DefaultClient.Do(velho)
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatalf("[Q2] o cookie antigo continua valendo depois de sair: %d", r.StatusCode)
	}
}

// Como quebra (Q6, W3): "excluir a conta" deixa dados pessoais (nome, e-mail,
// CPF, nome nas avaliações), apaga os pedidos (que a lei manda guardar) ou
// mantém as sessões abertas; o CPF fica em texto no banco.
func TestExcluirContaAnonimizaEMantemPedidos(t *testing.T) {
	s := novoServidor(t)
	s.semearCatalogo()
	nav := novoNavegador(t, s)
	ctx := context.Background()

	var eu contaResp
	nav.req("POST", "/api/conta/cadastro", cadastro("carla@exemplo.com", "390.533.447-05"), &eu)

	// W3: o CPF está cifrado; só a chave o devolve.
	var cifrado []byte
	var decifrado string
	if err := s.pg.QueryRow(ctx, `SELECT cpf_cifrado, pgp_sym_decrypt(cpf_cifrado, 'chave-de-teste') FROM cliente WHERE id = $1`,
		eu.ClienteID).Scan(&cifrado, &decifrado); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(cifrado, []byte("39053344705")) || decifrado != "39053344705" {
		t.Fatalf("[W3] CPF em claro no banco, ou a chave não o devolve (%q)", decifrado)
	}

	// Compra e avaliação, para ver o que fica e o que some.
	var b busca
	s.req("GET", "/api/catalogo/produtos", nil, &b)
	var ped struct {
		PedidoID string `json:"pedido_id"`
	}
	if st, _ := nav.req("POST", "/api/checkout", map[string]any{"metodo_pagamento": "PIX",
		"itens": []map[string]any{{"sku_id": s.loja.Skus[0].ID, "quantidade": 1}}}, &ped); st != 201 {
		t.Fatalf("compra da conta nova: %d", st)
	}
	if st, _ := nav.req("POST", "/api/catalogo/produtos/"+b.Itens[0].ID+"/avaliacoes", map[string]any{"nota": 5, "texto": "ótimo"}, nil); st != 201 {
		t.Fatalf("avaliação da conta nova: %d", st)
	}

	// Põe o produto no cache (Redis) ANTES de excluir: a cópia em cache tem o
	// nome nas avaliações recentes e também precisa sair.
	var antes detalhe
	s.req("GET", "/api/catalogo/produtos/"+b.Itens[0].ID, nil, &antes)
	s.req("GET", "/api/catalogo/produtos/"+b.Itens[0].ID, nil, &antes)
	if antes.Cache != "hit" || antes.Produto.AvaliacoesRecentes[0].ClienteNome != "Bia S." {
		t.Fatalf("preparação: produto deveria estar no cache com o nome: %+v", antes)
	}
	if st, _ := nav.req("DELETE", "/api/conta", nil, nil); st != 204 {
		t.Fatalf("[Q6] excluir conta: %d", st)
	}
	if st, _ := nav.req("GET", "/api/conta/eu", nil, nil); st != 401 {
		t.Fatalf("[Q6] a sessão sobreviveu à exclusão: %d", st)
	}
	if st, _ := novoNavegador(t, s).req("POST", "/api/conta/entrar", map[string]string{"email": "carla@exemplo.com", "senha": "uma senha bem longa"}, nil); st != 401 {
		t.Fatalf("[Q6] ainda dá para entrar na conta excluída: %d", st)
	}
	var nome, email string
	var cpf []byte
	var pedidos int
	if err := s.pg.QueryRow(ctx, `SELECT nome, email::text, cpf_cifrado, (SELECT count(*) FROM pedido WHERE cliente_id = c.id)
		FROM cliente c WHERE id = $1`, eu.ClienteID).Scan(&nome, &email, &cpf, &pedidos); err != nil {
		t.Fatal(err)
	}
	if nome != "Cliente removido" || strings.Contains(email, "carla") || cpf != nil {
		t.Fatalf("[Q6] dado pessoal ficou: %s %s %v", nome, email, cpf)
	}
	if pedidos != 1 {
		t.Fatalf("[Q6] o pedido (obrigação fiscal) deveria ficar: %d", pedidos)
	}
	var av struct {
		ClienteNome string `bson:"cliente_nome"`
	}
	if err := s.mg.Collection("avaliacoes").FindOne(ctx, bson.D{{Key: "cliente_id", Value: eu.ClienteID}}).Decode(&av); err != nil || av.ClienteNome != "Cliente removido" {
		t.Fatalf("[Q6] o nome ficou na avaliação: %+v %v", av, err)
	}
	var d detalhe
	s.req("GET", "/api/catalogo/produtos/"+b.Itens[0].ID, nil, &d)
	if d.Produto.AvaliacoesRecentes[0].ClienteNome != "Cliente removido" {
		t.Fatalf("[Q6] o nome ficou na cópia da avaliação dentro do produto: %+v", d.Produto.AvaliacoesRecentes[0])
	}
}

// Como quebra (W1, W2): sem RLS, o papel do cliente enxerga pedidos que não
// são dele (basta um WHERE esquecido); o papel dos relatórios consegue apagar.
func TestRLSEPapeisComMenorPrivilegio(t *testing.T) {
	s := novoServidor(t)
	ctx := context.Background()
	a, b := s.loja.Clientes[0], s.loja.Clientes[1]
	s.req("POST", "/api/checkout", s.pedido(a, s.loja.Skus[0].ID, 1), nil)
	s.req("POST", "/api/checkout", s.pedido(b, s.loja.Skus[1].ID, 1), nil)

	contar := func(papel, cliente string) (int, error) {
		tx, err := s.pg.Begin(ctx)
		if err != nil {
			return 0, err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, "SET LOCAL ROLE "+papel); err != nil {
			return 0, err
		}
		if cliente != "" {
			tx.Exec(ctx, "SELECT set_config('app.cliente_id', $1, true)", cliente)
		}
		var n int
		// SEM WHERE de propósito: quem filtra é a policy.
		err = tx.QueryRow(ctx, "SELECT count(*) FROM pedido").Scan(&n)
		return n, err
	}
	var total, deA int
	s.pg.QueryRow(ctx, "SELECT count(*), count(*) FILTER (WHERE cliente_id = $1) FROM pedido", a.ID).Scan(&total, &deA)

	if n, err := contar("loja_cliente", a.ID.String()); err != nil || n != deA || n == total {
		t.Fatalf("[W1] loja_cliente como A viu %d pedidos (dele: %d, total: %d) %v", n, deA, total, err)
	}
	if n, err := contar("loja_cliente", ""); err != nil || n != 0 {
		t.Fatalf("[W1] sem cliente na sessão o papel viu %d pedidos (esperado 0) %v", n, err)
	}
	if n, err := contar("relatorio_leitura", ""); err != nil || n != total {
		t.Fatalf("[W2] relatorio_leitura deveria ler todos os %d pedidos: %d %v", total, n, err)
	}

	// W2: o papel dos relatórios não escreve.
	tx, _ := s.pg.Begin(ctx)
	defer tx.Rollback(ctx)
	tx.Exec(ctx, "SET LOCAL ROLE relatorio_leitura")
	_, err := tx.Exec(ctx, "DELETE FROM item_pedido")
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != "42501" {
		t.Fatalf("[W2] relatorio_leitura conseguiu (ou falhou de outro jeito) apagar: %v", err)
	}

	// E os relatórios continuam funcionando com o papel menor.
	if st := s.req("GET", "/api/relatorios/curva-abc", nil, nil); st != 200 {
		t.Fatalf("[W2] relatório com relatorio_leitura: %d", st)
	}
}
