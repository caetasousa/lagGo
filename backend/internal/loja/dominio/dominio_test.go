package dominio

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// As regras do domínio são funções puras: testam-se sem banco nenhum.

func TestNormalizarSomaRepetidosEOrdena(t *testing.T) {
	a := uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	b := uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	p := Pedido{
		ClienteID: uuid.New(), EnderecoID: uuid.New(), MetodoPagamento: "PIX",
		Itens: []Item{{SkuID: b, Quantidade: 1}, {SkuID: a, Quantidade: 2}, {SkuID: b, Quantidade: 3}},
	}
	itens, err := Normalizar(p)
	if err != nil {
		t.Fatal(err)
	}
	want := []Item{{SkuID: a, Quantidade: 2}, {SkuID: b, Quantidade: 4}}
	if len(itens) != len(want) || itens[0] != want[0] || itens[1] != want[1] {
		t.Fatalf("got %v, want %v", itens, want)
	}
}

func TestNormalizarRejeitaEntradaInvalida(t *testing.T) {
	base := func() Pedido {
		return Pedido{ClienteID: uuid.New(), EnderecoID: uuid.New(), MetodoPagamento: "PIX",
			Itens: []Item{{SkuID: uuid.New(), Quantidade: 1}}}
	}
	casos := map[string]func(p *Pedido){
		"sem cliente":       func(p *Pedido) { p.ClienteID = uuid.Nil },
		"metodo invalido":   func(p *Pedido) { p.MetodoPagamento = "DINHEIRO" },
		"sem itens":         func(p *Pedido) { p.Itens = nil },
		"quantidade zero":   func(p *Pedido) { p.Itens[0].Quantidade = 0 },
		"quantidade grande": func(p *Pedido) { p.Itens[0].Quantidade = 1001 },
	}
	for nome, mudar := range casos {
		t.Run(nome, func(t *testing.T) {
			p := base()
			mudar(&p)
			var v ErrValidacao
			if _, err := Normalizar(p); !errors.As(err, &v) {
				t.Fatalf("esperava ErrValidacao, veio %v", err)
			}
		})
	}
}

func TestNomePublicoMinimizaDados(t *testing.T) {
	casos := map[string]string{"Ana Maria Silva": "Ana S.", "Ítalo": "Ítalo", "": "Cliente", "João Ávila": "João Á."}
	for nome, esperado := range casos {
		if got := NomePublico(nome); got != esperado {
			t.Errorf("NomePublico(%q) = %q, esperado %q", nome, got, esperado)
		}
	}
}

func TestAvaliacaoValidaNotaETexto(t *testing.T) {
	for _, a := range []NovaAvaliacao{{Nota: 0, Texto: "bom produto"}, {Nota: 6, Texto: "bom produto"}, {Nota: 5, Texto: "  ok  "}} {
		var v ErrValidacao
		if err := a.Validar(); !errors.As(err, &v) {
			t.Errorf("%+v deveria ser recusada, veio %v", a, err)
		}
	}
	a := NovaAvaliacao{Nota: 4, Texto: "  muito bom  "}
	if err := a.Validar(); err != nil || a.Texto != "muito bom" {
		t.Fatalf("avaliação válida recusada ou texto sem aparar: %v %q", err, a.Texto)
	}
}

// Como quebra (Q1): cadastro com CPF de dígito errado, "CPF" 111.111.111-11
// (passa na conta, não existe), e-mail torto, senha curta ou com o próprio
// e-mail, CEP/UF inválidos.
func TestCadastroRecusaDadosInvalidos(t *testing.T) {
	valido := func() Cadastro {
		return Cadastro{Nome: "  Ana   Lima ", Email: "ana@exemplo.com", Senha: "uma senha longa", CPF: "529.982.247-25",
			Endereco: Endereco{CEP: "01310-100", Logradouro: "Av. Paulista", Numero: "1000", Cidade: "São Paulo", UF: "sp"}}
	}
	c := valido()
	if err := c.Validar(); err != nil {
		t.Fatalf("cadastro válido recusado: %v", err)
	}
	if c.Nome != "Ana Lima" || c.CPF != "52998224725" || c.Endereco.CEP != "01310100" || c.Endereco.UF != "SP" {
		t.Fatalf("normalização errada: %+v", c)
	}
	for nome, mudar := range map[string]func(*Cadastro){
		"CPF com dígito errado":      func(c *Cadastro) { c.CPF = "52998224726" },
		"CPF de dígitos iguais":      func(c *Cadastro) { c.CPF = "11111111111" },
		"e-mail sem domínio":         func(c *Cadastro) { c.Email = "ana@exemplo" },
		"e-mail com nome":            func(c *Cadastro) { c.Email = "Ana <ana@exemplo.com>" },
		"senha curta":                func(c *Cadastro) { c.Senha = "curta" },
		"senha com o próprio e-mail": func(c *Cadastro) { c.Senha = "ana-1234567890" },
		"CEP curto":                  func(c *Cadastro) { c.Endereco.CEP = "0131" },
		"UF inexistente":             func(c *Cadastro) { c.Endereco.UF = "XX" },
		"nome vazio":                 func(c *Cadastro) { c.Nome = "  " },
	} {
		c := valido()
		mudar(&c)
		if err := c.Validar(); err == nil {
			t.Errorf("[Q1] %s deveria ser recusado", nome)
		}
	}
}

// Como quebra (X1): o mesmo produto aparece repetido em "vistos
// recentemente", ou o mais novo não vem primeiro.
func TestDistintosMantemOrdemSemRepetir(t *testing.T) {
	ev := []Visto{{ProdutoID: "c"}, {ProdutoID: "a"}, {ProdutoID: "c"}, {ProdutoID: "b"}, {ProdutoID: "a"}, {ProdutoID: "d"}}
	got := Distintos(ev, 3)
	if len(got) != 3 || got[0].ProdutoID != "c" || got[1].ProdutoID != "a" || got[2].ProdutoID != "b" {
		t.Fatalf("[X1] distintos: %+v", got)
	}
}
