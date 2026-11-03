// Package portas são as INTERFACES que a aplicação da loja precisa do mundo
// lá fora — "portas de saída" da arquitetura hexagonal. A aplicação só conhece
// estas interfaces; quem as implementa são os adaptadores (adaptadores/postgres,
// mongo, redis), escolhidos e ligados em internal/app.
//
// Por que interfaces se cada uma tem uma implementação só? Porque elas dizem,
// em linguagem do negócio, o que a loja pede ao banco ("crie este pedido",
// "leia o carrinho desta sessão"), e deixam o COMO (SQL, comandos do Redis,
// pipeline do MongoDB) inteiro num lugar só: o adaptador. Os testes NÃO usam
// implementações falsas: rodam com os adaptadores de verdade e bancos efêmeros.
package portas

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

// Pedidos: onde os pedidos são gravados (PostgreSQL).
type Pedidos interface {
	// Criar grava pedido, itens, baixa de estoque e pagamento numa transação
	// só — tudo ou nada. Erros possíveis: dominio.ErrSemEstoque,
	// ErrSkuInvalido, ErrValidacao, ErrChaveRepetida e ErrConflito (o banco
	// abortou por concorrência; repetir é seguro).
	Criar(ctx context.Context, p dominio.Pedido, itens []dominio.Item, op dominio.Opcoes) (dominio.Resultado, error)
	// PorChave devolve o pedido já criado com esta Idempotency-Key.
	PorChave(ctx context.Context, chave uuid.UUID) (dominio.Resultado, error)
}

// Ofertas: preço e estoque VIGENTES (PostgreSQL — nunca de cache).
type Ofertas interface {
	DosSkus(ctx context.Context, ids []uuid.UUID) ([]dominio.Oferta, error)
}

// Clientes: o que a loja precisa saber de um cliente fora do PostgreSQL.
type Clientes interface {
	// Nome devolve dominio.ErrClienteNaoEncontrado se ele não existir.
	Nome(ctx context.Context, id uuid.UUID) (string, error)
}

// Carrinhos: a intenção de compra de cada sessão (Redis).
type Carrinhos interface {
	// Ler devolve SKU → quantidade e a validade restante (-2 = não existe).
	Ler(ctx context.Context, sessao uuid.UUID) (map[uuid.UUID]int32, time.Duration, error)
	// Definir grava a quantidade (0 remove) e renova a validade.
	Definir(ctx context.Context, sessao, sku uuid.UUID, quantidade int, validade time.Duration) error
	Esvaziar(ctx context.Context, sessao uuid.UUID) error
}

// EfeitosDoPedido: o que acontece fora do PostgreSQL DEPOIS do COMMIT
// (esvaziar o carrinho, somar no ranking, publicar o evento). Não há
// transação entre bancos: se falhar, o pedido continua válido.
type EfeitosDoPedido interface {
	Confirmado(ctx context.Context, sessao uuid.UUID, r dominio.Resultado, itens []dominio.Item) error
	// Reaproveitado: o pedido já existia (mesma Idempotency-Key); só limpa o carrinho.
	Reaproveitado(ctx context.Context, sessao uuid.UUID) error
}

// Catalogo: os produtos e as avaliações (MongoDB).
type Catalogo interface {
	Buscar(ctx context.Context, f dominio.FiltroBusca) (dominio.ResultadoBusca, error)
	// Produto devolve dominio.ErrProdutoNaoEncontrado se ele não existir.
	Produto(ctx context.Context, id string) (dominio.Produto, error)
	// Avaliar grava a avaliação e atualiza o resumo do produto juntos (uma
	// transação), e devolve o resumo novo.
	Avaliar(ctx context.Context, a dominio.Avaliacao) (dominio.ResultadoAvaliacao, error)
	ProdutosDosSkus(ctx context.Context, skus []string) (map[string]dominio.ProdutoDoSku, error)
	// AnonimizarAutor troca o nome do cliente nas avaliações dele (LGPD) e
	// devolve os produtos mexidos — a cópia deles no cache tem de sair junto.
	AnonimizarAutor(ctx context.Context, cliente uuid.UUID) ([]string, error)
}

// CacheDeProdutos: cópias dos produtos com validade (Redis).
type CacheDeProdutos interface {
	Ler(ctx context.Context, id string) (dominio.Produto, bool, error)
	Gravar(ctx context.Context, id string, p dominio.Produto, validade time.Duration) error
	Apagar(ctx context.Context, id string) error
}

// Ranking: os mais vendidos (Redis).
type Ranking interface {
	Top(ctx context.Context, n int64) ([]dominio.PosicaoNoRanking, error)
}

// Vitrine: as leituras relacionais da loja (PostgreSQL).
type Vitrine interface {
	Categorias(ctx context.Context) ([]dominio.Categoria, error)
	Skus(ctx context.Context, f dominio.FiltroSkus) ([]dominio.Sku, error)
}

// MeusPedidos: os pedidos do cliente LOGADO (Fase 6). O adaptador lê com o
// papel loja_cliente e Row-Level Security: quem filtra "só os seus" é o
// próprio banco, não um WHERE que alguém pode esquecer (cenário W1).
type MeusPedidos interface {
	Lista(ctx context.Context, cliente uuid.UUID, limite int32) ([]dominio.PedidoResumo, error)
	// Detalhe devolve dominio.ErrPedidoNaoEncontrado também quando o pedido
	// existe mas é de OUTRO cliente — para quem pergunta, ele não existe (Q5).
	Detalhe(ctx context.Context, cliente, pedido uuid.UUID) (dominio.PedidoDetalhe, error)
}

// Contas: cadastro e credenciais (PostgreSQL, schema conta).
type Contas interface {
	// Criar grava cliente, endereço e credencial numa transação. Devolve
	// dominio.ErrEmailEmUso ou dominio.ErrCpfEmUso se já houver conta.
	Criar(ctx context.Context, c dominio.Cadastro, senhaHash string) (uuid.UUID, error)
	// Credencial devolve o cliente e o hash da senha; dominio.ErrCredenciais
	// se o e-mail não tiver conta.
	Credencial(ctx context.Context, email string) (uuid.UUID, string, error)
	RegistrarAcesso(ctx context.Context, cliente uuid.UUID) error
	// Conta devolve dominio.ErrNaoAutenticado se o cliente não existir mais.
	Conta(ctx context.Context, cliente uuid.UUID) (dominio.Conta, error)
	// Esquecer anonimiza o cliente (LGPD) e apaga a credencial; os pedidos ficam.
	Esquecer(ctx context.Context, cliente uuid.UUID) error
}

// Senhas: o hash da senha (argon2id). Função pura, mas de biblioteca de
// criptografia — fica num adaptador para a aplicação não depender dela.
type Senhas interface {
	Gerar(senha string) (string, error)
	Conferir(senha, hash string) (bool, error)
	// HashFalso: um hash válido de uma senha qualquer, para conferir contra ele
	// quando o e-mail não existe — o tempo da resposta não pode contar se a
	// conta existe (cenário Q3).
	HashFalso() string
}

// Sessoes: quem está logado (Redis, com TTL).
type Sessoes interface {
	Criar(ctx context.Context, token string, cliente uuid.UUID, validade time.Duration) error
	// Cliente devolve o dono do token e renova a validade; false se não existe.
	Cliente(ctx context.Context, token string, validade time.Duration) (uuid.UUID, bool, error)
	Apagar(ctx context.Context, token string) error
	// ApagarDoCliente encerra TODAS as sessões do cliente (excluir a conta).
	ApagarDoCliente(ctx context.Context, cliente uuid.UUID) error
}

// Relatorios: leem da réplica quando há uma (e caem no primário se ela
// falhar); a origem volta junto para a tela mostrar.
type Relatorios interface {
	VendasMensais(ctx context.Context, meses int32) ([]dominio.VendaMensal, dominio.Origem, error)
	ReceitaDiaria(ctx context.Context, dias int32) ([]dominio.ReceitaDia, dominio.Origem, error)
	CurvaABC(ctx context.Context, dias int32) ([]dominio.ClasseABC, dominio.Origem, error)
	StatusAtualizacao(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error)
	// Atualizar recalcula o resumo (escrita, no primário) e garante que a
	// próxima leitura já o veja (read-your-writes): devolve o status relido.
	Atualizar(ctx context.Context) ([]dominio.Atualizacao, dominio.Origem, error)
}

// ------------------------------------------------------------ Fase 7

// Vistos: "vistos recentemente" (Cassandra). Eventos com TTL, uma partição
// por cliente, do mais novo para o mais antigo.
type Vistos interface {
	Registrar(ctx context.Context, cliente uuid.UUID, v dominio.Visto, retencao time.Duration) error
	// Recentes devolve os últimos eventos (com repetição), o mais novo primeiro.
	Recentes(ctx context.Context, cliente uuid.UUID, limite int) ([]dominio.Visto, error)
	// Apagar remove todo o histórico do cliente ("excluir minha conta", X5).
	Apagar(ctx context.Context, cliente uuid.UUID) error
}

// Grafo: (Cliente)-[:COMPROU]->(Sku) no Neo4j. É dado DERIVADO dos pedidos do
// PostgreSQL: pode ser apagado e reconstruído a qualquer momento.
type Grafo interface {
	// Registrar soma as compras ao grafo (MERGE: repetir não duplica).
	Registrar(ctx context.Context, compras []dominio.Compra) error
	// TambemCompraram: outros SKUs comprados por quem comprou algum dos skus,
	// com a força (clientes distintos), da maior para a menor.
	TambemCompraram(ctx context.Context, skus []string, limite int) ([]dominio.Coocorrencia, error)
	Limpar(ctx context.Context) error
	Estado(ctx context.Context) (dominio.EstadoDoGrafo, error)
}

// HistoricoDeCompras: a fonte do grafo (PostgreSQL) — percorre as compras
// agregadas por (cliente, sku) em lotes.
type HistoricoDeCompras interface {
	Percorrer(ctx context.Context, lote int, f func([]dominio.Compra) error) (int64, error)
}
