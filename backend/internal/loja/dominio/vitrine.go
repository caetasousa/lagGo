package dominio

import (
	"time"

	"github.com/google/uuid"
)

// Leituras da vitrine e dos relatórios: modelos de consulta (o que a tela
// mostra), sem regra própria além do formato.

type Categoria struct {
	ID      int32  `json:"id"`
	Nome    string `json:"nome"`
	Caminho string `json:"caminho"`
	Nivel   int32  `json:"nivel"`
	Skus    int64  `json:"skus"`
}

type FiltroSkus struct {
	Busca     string // vazio = sem filtro
	Categoria int32  // 0 = todas (inclui as subcategorias)
	Limite    int32
}

type Sku struct {
	ID        uuid.UUID `json:"id"`
	Descricao string    `json:"descricao"`
	Preco     Dinheiro  `json:"preco"`
	Estoque   int32     `json:"estoque"`
	Vendedor  string    `json:"vendedor"`
	Categoria string    `json:"categoria"`
}

type Cliente struct {
	ID         uuid.UUID `json:"id"`
	Nome       string    `json:"nome"`
	Email      string    `json:"email"`
	EnderecoID uuid.UUID `json:"endereco_id"`
	Cidade     string    `json:"cidade"`
	Uf         string    `json:"uf"`
}

type PedidoResumo struct {
	ID       uuid.UUID `json:"id"`
	Status   string    `json:"status"`
	Total    Dinheiro  `json:"total"`
	CriadoEm time.Time `json:"criado_em"`
	Itens    int32     `json:"itens"`
}

type ItemDoPedido struct {
	Numero        int16     `json:"numero"`
	SkuID         uuid.UUID `json:"sku_id"`
	Descricao     string    `json:"descricao"`
	Quantidade    int32     `json:"quantidade"`
	PrecoUnitario Dinheiro  `json:"preco_unitario"`
	Subtotal      Dinheiro  `json:"subtotal"`
}

type Pagamento struct {
	ID       uuid.UUID `json:"id"`
	Metodo   string    `json:"metodo"`
	Valor    Dinheiro  `json:"valor"`
	Status   string    `json:"status"`
	CriadoEm time.Time `json:"criado_em"`
}

type PedidoDetalhe struct {
	ID         uuid.UUID      `json:"id"`
	Status     string         `json:"status"`
	Total      Dinheiro       `json:"total"`
	CriadoEm   time.Time      `json:"criado_em"`
	Cliente    string         `json:"cliente"`
	Cidade     string         `json:"cidade"`
	Uf         string         `json:"uf"`
	Itens      []ItemDoPedido `json:"itens"`
	Pagamentos []Pagamento    `json:"pagamentos"`
}

// ------------------------------------------------------------ relatórios

// Origem de uma leitura: os relatórios toleram atraso e leem da réplica.
type Origem string

const (
	OrigemReplica  Origem = "replica"
	OrigemPrimario Origem = "primario"
)

type VendaMensal struct {
	Mes     *string  `json:"mes"` // nulo nas linhas de total do CUBE
	Uf      string   `json:"uf"`
	Pedidos int64    `json:"pedidos"`
	Receita Dinheiro `json:"receita"`
	Nivel   int32    `json:"nivel"`
}

type ReceitaDia struct {
	Dia          string    `json:"dia"`
	Pedidos      int64     `json:"pedidos"`
	Receita      Dinheiro  `json:"receita"`
	MediaMovel7d Dinheiro  `json:"media_movel_7d"`
	Variacao     *Dinheiro `json:"variacao"` // nulo no primeiro dia
}

type ClasseABC struct {
	Classe  string   `json:"classe"`
	Skus    int64    `json:"skus"`
	Receita Dinheiro `json:"receita"`
}

type Atualizacao struct {
	Objeto       string    `json:"objeto"`
	AtualizadoEm time.Time `json:"atualizado_em"`
	DuracaoMs    Dinheiro  `json:"duracao_ms"`
}
