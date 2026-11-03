package dominio

import (
	"errors"
	"net/mail"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Conta, cadastro e login (Fase 6, docs/10, cenários Q). A senha nunca fica
// aqui depois do cadastro: vira hash argon2id no adaptador e some.

// ValidadeDaSessao: quanto tempo o login vale sem uso (o TTL da chave no Redis).
const ValidadeDaSessao = 7 * 24 * time.Hour

// Limites da senha. Mínimo de 10 (NIST SP 800-63B pede ≥ 8; aqui, uma folga);
// máximo só para não deixar um texto de megabytes chegar ao argon2.
const (
	SenhaMinima = 10
	SenhaMaxima = 128
)

var (
	// ErrCredenciais: e-mail inexistente OU senha errada — a mesma mensagem
	// para os dois, senão a tela conta quem tem conta (cenário Q3).
	ErrCredenciais = errors.New("e-mail ou senha incorretos")
	// ErrNaoAutenticado: a operação exige login (sessão ausente ou vencida).
	ErrNaoAutenticado = errors.New("entre na sua conta para continuar")
	ErrEmailEmUso     = ErrValidacao{"este e-mail já tem uma conta"}
	ErrCpfEmUso       = ErrValidacao{"este CPF já tem uma conta"}
)

// UFs válidas: a CHECK do banco só confere o formato (duas letras).
var UFs = []string{"AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB",
	"PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"}

type Endereco struct {
	CEP         string  `json:"cep"`
	Logradouro  string  `json:"logradouro"`
	Numero      string  `json:"numero"`
	Complemento *string `json:"complemento,omitempty"`
	Cidade      string  `json:"cidade"`
	UF          string  `json:"uf"`
}

type Cadastro struct {
	Nome     string   `json:"nome"`
	Email    string   `json:"email"`
	Senha    string   `json:"senha"`
	CPF      string   `json:"cpf"`
	Endereco Endereco `json:"endereco"`
}

// Validar normaliza (espaços, só dígitos no CPF e no CEP, UF maiúscula) e
// confere o cadastro (cenário Q1).
func (c *Cadastro) Validar() error {
	c.Nome = strings.Join(strings.Fields(c.Nome), " ")
	c.Email = strings.TrimSpace(c.Email)
	c.CPF = SoDigitos(c.CPF)
	e := &c.Endereco
	e.CEP = SoDigitos(e.CEP)
	e.Logradouro, e.Numero, e.Cidade = strings.TrimSpace(e.Logradouro), strings.TrimSpace(e.Numero), strings.TrimSpace(e.Cidade)
	e.UF = strings.ToUpper(strings.TrimSpace(e.UF))
	if e.Complemento != nil {
		if s := strings.TrimSpace(*e.Complemento); s == "" {
			e.Complemento = nil
		} else {
			e.Complemento = &s
		}
	}

	switch {
	case utf8.RuneCountInString(c.Nome) < 3 || utf8.RuneCountInString(c.Nome) > 120:
		return ErrValidacao{"nome entre 3 e 120 letras"}
	case !EmailValido(c.Email):
		return ErrValidacao{"e-mail inválido"}
	case utf8.RuneCountInString(c.Senha) < SenhaMinima:
		return ErrValidacao{"a senha precisa de pelo menos 10 caracteres"}
	case utf8.RuneCountInString(c.Senha) > SenhaMaxima:
		return ErrValidacao{"senha longa demais (máximo 128 caracteres)"}
	case strings.Contains(strings.ToLower(c.Senha), strings.ToLower(strings.Split(c.Email, "@")[0])):
		return ErrValidacao{"a senha não pode conter o seu e-mail"}
	case !CPFValido(c.CPF):
		return ErrValidacao{"CPF inválido"}
	case len(e.CEP) != 8:
		return ErrValidacao{"CEP precisa de 8 dígitos"}
	case e.Logradouro == "" || e.Numero == "" || e.Cidade == "":
		return ErrValidacao{"endereço incompleto (logradouro, número e cidade)"}
	case !slices.Contains(UFs, e.UF):
		return ErrValidacao{"UF inválida"}
	}
	return nil
}

// EmailValido: um endereço só (sem "Nome <x@y>"), com domínio que tem ponto.
func EmailValido(s string) bool {
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || len(s) > 254 {
		return false
	}
	dominio := s[strings.LastIndex(s, "@")+1:]
	return strings.Contains(dominio, ".") && !strings.HasSuffix(dominio, ".")
}

// CPFValido confere os dois dígitos verificadores (módulo 11) e recusa os
// "CPFs" de dígitos todos iguais, que passam na conta mas não existem.
func CPFValido(cpf string) bool {
	if len(cpf) != 11 || strings.Count(cpf, cpf[:1]) == 11 {
		return false
	}
	d := make([]int, 11)
	for i, r := range cpf {
		if r < '0' || r > '9' {
			return false
		}
		d[i] = int(r - '0')
	}
	for _, n := range []int{9, 10} { // posição do dígito verificador
		soma := 0
		for i := 0; i < n; i++ {
			soma += d[i] * (n + 1 - i)
		}
		dv := soma * 10 % 11 % 10
		if dv != d[n] {
			return false
		}
	}
	return true
}

func SoDigitos(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

// Conta: o que a pessoa logada vê de si mesma — com e-mail e CPF mascarados
// (cenário Q6). EnderecoID é o endereço ativo, usado no checkout.
type Conta struct {
	ClienteID      uuid.UUID `json:"cliente_id"`
	Nome           string    `json:"nome"`
	Email          string    `json:"email"`
	EmailMascarado string    `json:"email_mascarado"`
	CPFMascarado   string    `json:"cpf_mascarado,omitempty"`
	EnderecoID     uuid.UUID `json:"endereco_id"`
	Cidade         string    `json:"cidade"`
	Uf             string    `json:"uf"`
}

// Entrada: o resultado de cadastrar ou entrar — a conta e o token da sessão
// (que vai para o cookie, nunca para o corpo da resposta).
type Entrada struct {
	Conta Conta
	Token string
}

// ErrOutroCliente: o corpo da requisição pediu um cliente que não é o logado.
var ErrOutroCliente = ErrValidacao{"a compra e a avaliação são sempre de quem está logado"}

// DaConta faz do pedido um pedido DA CONTA logada (cenário Q4): o cliente vem
// da sessão, nunca do corpo da requisição. Um cliente_id diferente no corpo é
// recusado (em vez de ignorado), para o erro aparecer; sem endereço, usa o
// ativo da conta. Endereço de outra pessoa a FK composta do banco recusa.
func (p *Pedido) DaConta(c Conta) error {
	if p.ClienteID != uuid.Nil && p.ClienteID != c.ClienteID {
		return ErrOutroCliente
	}
	p.ClienteID = c.ClienteID
	if p.EnderecoID == uuid.Nil {
		p.EnderecoID = c.EnderecoID
	}
	return nil
}

// DaConta: a avaliação também é sempre de quem está logado.
func (a *NovaAvaliacao) DaConta(c Conta) error {
	if a.ClienteID != uuid.Nil && a.ClienteID != c.ClienteID {
		return ErrOutroCliente
	}
	a.ClienteID = c.ClienteID
	return nil
}
