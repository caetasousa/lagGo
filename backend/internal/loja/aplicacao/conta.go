package aplicacao

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/loja/portas"
)

// Contas: cadastro, login, sessão e o "direito ao esquecimento" (Fase 6).
//
// Três bancos, cada um no que faz melhor:
//
//	PostgreSQL  cliente, endereço e credencial (hash argon2id) — numa transação
//	Redis       a sessão: chave com TTL, some sozinha quando vence
//	MongoDB     o nome do autor nas avaliações (anonimizado ao excluir a conta)
type Contas struct {
	contas      portas.Contas
	senhas      portas.Senhas
	sessoes     portas.Sessoes
	meusPedidos portas.MeusPedidos
	catalogo    portas.Catalogo
	cache       portas.CacheDeProdutos
	vistos      portas.Vistos
}

func NovasContas(contas portas.Contas, senhas portas.Senhas, sessoes portas.Sessoes,
	meusPedidos portas.MeusPedidos, catalogo portas.Catalogo, cache portas.CacheDeProdutos, vistos portas.Vistos) *Contas {
	return &Contas{contas: contas, senhas: senhas, sessoes: sessoes, meusPedidos: meusPedidos, catalogo: catalogo, cache: cache, vistos: vistos}
}

// Cadastrar valida, grava (com a senha já em hash) e abre a sessão.
func (a *Contas) Cadastrar(ctx context.Context, c dominio.Cadastro) (dominio.Entrada, error) {
	if err := c.Validar(); err != nil {
		return dominio.Entrada{}, err
	}
	hash, err := a.senhas.Gerar(c.Senha)
	if err != nil {
		return dominio.Entrada{}, err
	}
	c.Senha = "" // daqui em diante a senha em texto não existe mais
	id, err := a.contas.Criar(ctx, c, hash)
	if err != nil {
		return dominio.Entrada{}, err
	}
	return a.abrirSessao(ctx, id)
}

// Entrar confere e-mail e senha. E-mail sem conta e senha errada dão o MESMO
// erro e levam o MESMO tempo — o argon2 roda contra um hash falso quando o
// e-mail não existe (cenário Q3).
func (a *Contas) Entrar(ctx context.Context, email, senha string) (dominio.Entrada, error) {
	id, hash, err := a.contas.Credencial(ctx, email)
	if errors.Is(err, dominio.ErrCredenciais) {
		_, _ = a.senhas.Conferir(senha, a.senhas.HashFalso())
		return dominio.Entrada{}, dominio.ErrCredenciais
	}
	if err != nil {
		return dominio.Entrada{}, err
	}
	ok, err := a.senhas.Conferir(senha, hash)
	if err != nil {
		return dominio.Entrada{}, err
	}
	if !ok {
		return dominio.Entrada{}, dominio.ErrCredenciais
	}
	if err := a.contas.RegistrarAcesso(ctx, id); err != nil {
		slog.Warn("não registrou o último acesso", "err", err)
	}
	return a.abrirSessao(ctx, id)
}

// abrirSessao gera o token (256 bits aleatórios) e guarda no Redis.
func (a *Contas) abrirSessao(ctx context.Context, cliente uuid.UUID) (dominio.Entrada, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return dominio.Entrada{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	if err := a.sessoes.Criar(ctx, token, cliente, dominio.ValidadeDaSessao); err != nil {
		return dominio.Entrada{}, err
	}
	conta, err := a.contas.Conta(ctx, cliente)
	return dominio.Entrada{Conta: conta, Token: token}, err
}

// Autenticar: de quem é este token? Renova a validade (sessão "deslizante":
// quem usa a loja não é deslogado no meio). ErrNaoAutenticado se não vale.
func (a *Contas) Autenticar(ctx context.Context, token string) (dominio.Conta, error) {
	if token == "" {
		return dominio.Conta{}, dominio.ErrNaoAutenticado
	}
	id, ok, err := a.sessoes.Cliente(ctx, token, dominio.ValidadeDaSessao)
	if err != nil {
		return dominio.Conta{}, err
	}
	if !ok {
		return dominio.Conta{}, dominio.ErrNaoAutenticado
	}
	return a.contas.Conta(ctx, id)
}

// Sair apaga a sessão no servidor: o cookie que sobrar no navegador não vale
// mais nada (cenário Q2).
func (a *Contas) Sair(ctx context.Context, token string) error {
	return a.sessoes.Apagar(ctx, token)
}

func (a *Contas) MeusPedidos(ctx context.Context, c dominio.Conta, limite int32) ([]dominio.PedidoResumo, error) {
	return a.meusPedidos.Lista(ctx, c.ClienteID, limite)
}

func (a *Contas) MeuPedido(ctx context.Context, c dominio.Conta, pedido uuid.UUID) (dominio.PedidoDetalhe, error) {
	return a.meusPedidos.Detalhe(ctx, c.ClienteID, pedido)
}

// Esquecer: "excluir minha conta" (LGPD, art. 18). A ordem falha do lado
// seguro: primeiro o PostgreSQL (dados pessoais e credencial — sem
// credencial, ninguém entra mais), depois as sessões no Redis e o nome nas
// avaliações do MongoDB (e no cache do produto) e, por fim, o histórico de
// navegação no Cassandra (Fase 7). Não há transação entre bancos; se um dos
// últimos passos falhar, repetir é seguro: todos são idempotentes (o
// primeiro, já feito, devolve ErrNaoAutenticado e é ignorado).
func (a *Contas) Esquecer(ctx context.Context, c dominio.Conta) error {
	if err := a.contas.Esquecer(ctx, c.ClienteID); err != nil && !errors.Is(err, dominio.ErrNaoAutenticado) {
		return err
	}
	if err := a.sessoes.ApagarDoCliente(ctx, c.ClienteID); err != nil {
		return err
	}
	produtos, err := a.catalogo.AnonimizarAutor(ctx, c.ClienteID)
	if err != nil {
		return err
	}
	// A cópia do produto no cache (Redis) ainda tem o nome antigo nas
	// avaliações recentes: dado pessoal sobrevivendo num cache também é
	// vazamento. Apagar faz a próxima leitura buscar a versão anônima.
	for _, id := range produtos {
		if err := a.cache.Apagar(ctx, id); err != nil {
			return err
		}
	}
	// O TTL apagaria o histórico em 30 dias; a exclusão é agora (X5). O nó do
	// cliente no grafo (Neo4j) fica: só tem o id, como os pedidos que ficam.
	return a.vistos.Apagar(ctx, c.ClienteID)
}
