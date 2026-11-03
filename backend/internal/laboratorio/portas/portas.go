// Package portas do LABORATÓRIO: o que cada experimento precisa de fora.
//
// Repare na diferença de "grão" entre as portas: onde a aplicação orquestra
// (concorrência, replicação, conexões, cache, alta disponibilidade), a porta
// faz UMA operação e a aplicação repete, mede e decide. Onde o experimento é
// um roteiro do banco (isolamento, MVCC, expurgo, backup, EXPLAIN), a porta
// executa o roteiro inteiro — o SQL dele é o próprio assunto da aula.
package portas

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// ------------------------------------------------------------ concorrência

// EstoqueDoLaboratorio: o SKU disputado e quem pode comprá-lo (PostgreSQL).
type EstoqueDoLaboratorio interface {
	// Redefinir põe o estoque do SKU no valor (ErrValidacao se ele não existir).
	Redefinir(ctx context.Context, sku uuid.UUID, quantidade int32) error
	Ler(ctx context.Context, sku uuid.UUID) (int32, error)
	Compradores(ctx context.Context, n int) ([]dominio.Comprador, error)
}

// Loja: o checkout DA LOJA, usado pelo laboratório (outro contexto, por um
// adaptador). Vende 1 unidade; devolve quantas tentativas foram necessárias.
type Loja interface {
	// Comprar devolve ErrSemEstoque (o deste pacote) quando não havia estoque.
	Comprar(ctx context.Context, c dominio.Comprador, sku uuid.UUID, estrategia string, atraso time.Duration) (tentativas int, err error)
	// EstrategiaValida devolve a estratégia (vazio = a padrão da loja) ou erro.
	EstrategiaValida(estrategia string) (string, error)
}

// ------------------------------------------------------------ roteiros do banco

type Isolamento interface {
	Roteiros() []dominio.Roteiro
	Rodar(ctx context.Context, roteiro, nivel string) (dominio.ResultadoIsolamento, error)
}

type MVCC interface {
	Estado(ctx context.Context) (dominio.EstadoMVCC, error)
	Executar(ctx context.Context, acao string, fillfactor int) (dominio.ResultadoMVCC, error)
}

type Expurgo interface {
	Expurgar(ctx context.Context, metodo string, linhas int) (dominio.ResultadoExpurgo, error)
}

type Backup interface {
	Info(ctx context.Context) (dominio.InfoBackup, error)
	Fazer(ctx context.Context, tipo string) (dominio.ResultadoBackup, error)
	PITR(ctx context.Context, alvo string, esperadas int) (dominio.ResultadoPITR, error)
}

type Indices interface {
	Experimentos(ctx context.Context) ([]dominio.ExperimentoComEstado, error)
	Explain(ctx context.Context, id, workMem string, ajustes map[string]string) (dominio.ResultadoExplain, error)
	Criar(ctx context.Context, nome string) (time.Duration, error)
	Remover(ctx context.Context, nome string) error
}

// ------------------------------------------------------------ operações medidas pela aplicação

// Conexoes: uma consulta curta por um caminho (direto, pgbouncer ou pool).
type Conexoes interface {
	MaxConnections(ctx context.Context) (int64, error)
	// Preparar devolve a operação que cada "cliente" repete e uma função para
	// liberar o que foi aberto (o pool, no modo pool).
	Preparar(ctx context.Context, modo string) (op func(context.Context) error, fechar func(), err error)
	// ProcessosDoExperimento: quantos processos do experimento o PostgreSQL tem agora.
	ProcessosDoExperimento(ctx context.Context, modo string) (int64, error)
	// Mensagem traduz o erro do banco ("53300: too many clients…").
	Mensagem(err error) string
}

// Replicacao: o primário e a réplica, uma operação por vez.
type Replicacao interface {
	Configurada() bool
	// EstadoDaReplica: "streaming / sync", ou "desconectada".
	EstadoDaReplica(ctx context.Context) (string, error)
	// Gravar faz uma transação com o synchronous_commit pedido e mede o COMMIT.
	Gravar(ctx context.Context, rodada uuid.UUID, modo string) (id int64, commit time.Duration, err error)
	NaReplica(ctx context.Context, id int64) (bool, error)
	// Carga grava um bloco grande de WAL (outra conexão, ao mesmo tempo).
	Carga(ctx context.Context) error
	AtrasoEmBytes(ctx context.Context) (int64, error)
	// Limpar apaga as rodadas anteriores (a tabela não cresce sem fim).
	Limpar(ctx context.Context, rodada uuid.UUID) error
}

// CatalogoParaCache: o mesmo produto lido direto do banco e pelo cache.
type CatalogoParaCache interface {
	PrimeiroProduto(ctx context.Context) (id, nome string, err error)
	LerDoBanco(ctx context.Context, id string) ([]byte, error)
	LerDoCache(ctx context.Context, id string) ([]byte, bool, error)
	GravarNoCache(ctx context.Context, id string, doc []byte) error
	ApagarDoCache(ctx context.Context, id string) error
	// NoCache: quanto a cópia ocupa e quanto falta para expirar.
	NoCache(ctx context.Context, id string) (bytes int64, ttl time.Duration)
}

// ClusterHA: o que cada tecnologia de alta disponibilidade sabe fazer.
type ClusterHA interface {
	Estado(ctx context.Context) dominio.EstadoCluster
	// Preparar liga ou desliga a garantia (synchronous_mode, w: majority, WAIT 1)
	// e devolve o que foi feito, para o registro do ensaio.
	Preparar(ctx context.Context, rodada uuid.UUID, garantia bool) (string, error)
	Escrever(ctx context.Context, rodada uuid.UUID, n int, garantia bool) error
	Derrubar(ctx context.Context, lider string) (string, error)
	Planejada(ctx context.Context, lider string) (string, error)
	// Conferir: quantas das escritas confirmadas estão no novo líder.
	Conferir(ctx context.Context, rodada uuid.UUID, confirmadas []int) (int, error)
}

// ------------------------------------------------------------ Fase 7

// Consistencia: o Cassandra, uma escrita e uma leitura com o nível pedido.
type Consistencia interface {
	Preparar(ctx context.Context, rf int) (keyspace string, err error)
	Tentar(ctx context.Context, keyspace, nivel string) dominio.Tentativa
	NosVivos(ctx context.Context) (int, error)
}

// GrafoLab: a pergunta respondida no Neo4j (Cypher).
type GrafoLab interface {
	TambemCompraram(ctx context.Context, sku string) (dominio.Medida, error)
	Alcance(ctx context.Context, sku string) (dominio.Medida, error)
}

// SQLDoGrafo: a MESMA pergunta respondida no PostgreSQL (self-joins).
type SQLDoGrafo interface {
	TambemCompraram(ctx context.Context, sku string) (dominio.Medida, error)
	Alcance(ctx context.Context, sku string) (dominio.Medida, error)
	SkusParaOGrafo(ctx context.Context) ([]dominio.SkuParaOGrafo, error)
}
