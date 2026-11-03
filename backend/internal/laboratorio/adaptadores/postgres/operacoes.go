package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Operações de UM passo, que a aplicação repete e mede: o estoque da corrida,
// uma gravação/leitura na réplica, uma consulta por um caminho de conexão.

// ------------------------------------------------------------ concorrência

// Estoque implementa portas.EstoqueDoLaboratorio (SQL em db/queries/checkout.sql).
type Estoque struct{ q *sqlcdb.Queries }

func NovoEstoque(pool *pgxpool.Pool) *Estoque { return &Estoque{q: sqlcdb.New(pool)} }

func (a *Estoque) Redefinir(ctx context.Context, sku uuid.UUID, quantidade int32) error {
	if _, err := a.q.LerEstoque(ctx, sku); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dominio.ErrValidacao{Msg: "SKU sem estoque cadastrado — rode `make seed`"}
		}
		return err
	}
	return a.q.GravarEstoque(ctx, sqlcdb.GravarEstoqueParams{Quantidade: quantidade, SkuID: sku})
}

func (a *Estoque) Ler(ctx context.Context, sku uuid.UUID) (int32, error) {
	return a.q.LerEstoque(ctx, sku)
}

func (a *Estoque) Compradores(ctx context.Context, n int) ([]dominio.Comprador, error) {
	rows, err := a.q.ClientesAleatorios(ctx, int32(n))
	out := make([]dominio.Comprador, len(rows))
	for i, c := range rows {
		out[i] = dominio.Comprador{ClienteID: c.ClienteID, EnderecoID: c.EnderecoID}
	}
	return out, err
}

// ------------------------------------------------------------ replicação

// Replicacao implementa portas.Replicacao: o primário e a réplica.
type Replicacao struct {
	primario *pgxpool.Pool
	replica  *pgxpool.Pool // nil = sem réplica
}

func NovaReplicacao(primario, replica *pgxpool.Pool) *Replicacao {
	return &Replicacao{primario: primario, replica: replica}
}

func (a *Replicacao) Configurada() bool { return a.replica != nil }

func (a *Replicacao) EstadoDaReplica(ctx context.Context) (string, error) {
	var e string
	err := a.primario.QueryRow(ctx, `
		SELECT coalesce((SELECT state || ' / ' || sync_state FROM pg_stat_replication
		                  WHERE application_name = 'replica1' LIMIT 1), 'desconectada')`).Scan(&e)
	return e, err
}

// Gravar faz uma transação com o synchronous_commit pedido e mede o COMMIT.
func (a *Replicacao) Gravar(ctx context.Context, rodada uuid.UUID, modo string) (int64, time.Duration, error) {
	// Prazo: mesmo com a guarda da aplicação, a réplica pode cair no meio da rodada.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := a.primario.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)
	// set_config(..., true) = SET LOCAL: vale só para esta transação. O modo
	// já foi validado contra a lista; mesmo assim vai como parâmetro.
	if _, err := tx.Exec(ctx, "SELECT set_config('synchronous_commit', $1, true)", modo); err != nil {
		return 0, 0, err
	}
	var id int64
	if err := tx.QueryRow(ctx, `INSERT INTO lab.replicacao (rodada, modo, carga)
		VALUES ($1, $2, repeat('x', 200)) RETURNING id`, rodada, modo).Scan(&id); err != nil {
		return 0, 0, err
	}
	inicio := time.Now()
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return id, time.Since(inicio), nil
}

func (a *Replicacao) NaReplica(ctx context.Context, id int64) (bool, error) {
	var existe bool
	err := a.replica.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM lab.replicacao WHERE id = $1)", id).Scan(&existe)
	return existe, err
}

// Carga: ~3 MB de WAL num comando só.
func (a *Replicacao) Carga(ctx context.Context) error {
	_, err := a.primario.Exec(ctx, `
		INSERT INTO lab.replicacao (rodada, modo, carga)
		SELECT gen_random_uuid(), 'carga', repeat(md5(g::text), 30) FROM generate_series(1, 3000) g`)
	return err
}

func (a *Replicacao) AtrasoEmBytes(ctx context.Context) (int64, error) {
	var b int64
	err := a.primario.QueryRow(ctx, `SELECT coalesce(max(pg_wal_lsn_diff(sent_lsn, replay_lsn)), 0)::bigint
		FROM pg_stat_replication WHERE application_name = 'replica1'`).Scan(&b)
	return b, err
}

func (a *Replicacao) Limpar(ctx context.Context, rodada uuid.UUID) error {
	_, err := a.primario.Exec(ctx, "DELETE FROM lab.replicacao WHERE rodada <> $1", rodada)
	return err
}

// ------------------------------------------------------------ conexões

// O SKU consultado pelos "clientes": uma consulta de ~1 ms, para que o custo
// medido seja quase só o da conexão.
var skuConsultado = dominio.SkuLaboratorio.String()

// Conexoes implementa portas.Conexoes.
type Conexoes struct {
	pool         *pgxpool.Pool // da API: só para medir o servidor
	urlDireto    string
	urlPgBouncer string
}

func NovasConexoes(pool *pgxpool.Pool, urlDireto, urlPgBouncer string) *Conexoes {
	return &Conexoes{pool: pool, urlDireto: urlDireto, urlPgBouncer: urlPgBouncer}
}

func (c *Conexoes) MaxConnections(ctx context.Context) (int64, error) {
	var n int64
	err := c.pool.QueryRow(ctx, "SELECT current_setting('max_connections')::bigint").Scan(&n)
	return n, err
}

// Preparar: a operação de cada modo. direto e pgbouncer abrem uma conexão
// NOVA a cada consulta; pool usa 10 conexões já abertas.
func (c *Conexoes) Preparar(ctx context.Context, modo string) (func(context.Context) error, func(), error) {
	url := c.urlDireto
	if modo == "pgbouncer" {
		if c.urlPgBouncer == "" {
			return nil, nil, dominio.ErrValidacao{Msg: "PgBouncer não configurado (PGBOUNCER_URL)"}
		}
		url = c.urlPgBouncer
	}
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return nil, nil, err
	}
	// Sem cache de prepared statement: comparação justa entre os modos e
	// compatível com o PgBouncer em modo transaction.
	cfg.DefaultQueryExecMode = pgx.QueryExecModeExec
	cfg.ConnectTimeout = 3 * time.Second
	cfg.RuntimeParams["application_name"] = "lab-conexoes"

	if modo == "pool" {
		pcfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			return nil, nil, err
		}
		pcfg.ConnConfig = cfg
		pcfg.MaxConns = 10
		p, err := pgxpool.NewWithConfig(ctx, pcfg)
		if err != nil {
			return nil, nil, err
		}
		return func(ctx context.Context) error {
			var x string
			return p.QueryRow(ctx, "SELECT preco::text FROM sku WHERE id = $1", skuConsultado).Scan(&x)
		}, p.Close, nil
	}
	return func(ctx context.Context) error {
		conn, err := pgx.ConnectConfig(ctx, cfg)
		if err != nil {
			return err
		}
		defer conn.Close(context.Background())
		var x string
		return conn.QueryRow(ctx, "SELECT preco::text FROM sku WHERE id = $1", skuConsultado).Scan(&x)
	}, func() {}, nil
}

// ProcessosDoExperimento separa os processos pela ORIGEM da conexão (client_addr):
// direto e pool vêm do mesmo endereço da API; pgbouncer, do endereço do
// PgBouncer. O nome (application_name) não basta: o PgBouncer repassa o do
// cliente, e as conexões reais dele continuam abertas entre experimentos.
func (c *Conexoes) ProcessosDoExperimento(ctx context.Context, modo string) (int64, error) {
	filtro := "client_addr IS NOT DISTINCT FROM inet_client_addr() AND application_name = 'lab-conexoes'"
	if modo == "pgbouncer" {
		filtro = "client_addr IS DISTINCT FROM inet_client_addr() AND application_name <> 'marketplace-api'"
	}
	var n int64
	err := c.pool.QueryRow(ctx, `
SELECT count(*) FROM pg_stat_activity
 WHERE backend_type = 'client backend' AND datname = current_database() AND `+filtro).Scan(&n)
	return n, err
}

func (c *Conexoes) Mensagem(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code + ": " + pgErr.Message
	}
	return err.Error()
}
