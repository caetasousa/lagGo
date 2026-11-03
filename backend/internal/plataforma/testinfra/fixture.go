//go:build integration

package testinfra

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SkuLaboratorio é o mesmo id que o seed usa para o SKU disputado.
var SkuLaboratorio = uuid.MustParse("11111111-1111-1111-1111-111111111111")

type Cliente struct {
	ID         uuid.UUID
	EnderecoID uuid.UUID
	Nome       string
}

type Sku struct {
	ID        uuid.UUID
	Preco     string
	Estoque   int32
	Categoria string
}

// Loja é o mínimo para exercitar checkout, relatórios e catálogo: uma árvore
// de categorias, 2 vendedores, 20 clientes com endereço e 12 SKUs (mais o do
// laboratório). O seed de desenvolvimento (100 mil pedidos) é grande demais
// para teste e não precisa ser: cada teste cria o que vai medir.
type Loja struct {
	Clientes []Cliente
	Skus     []Sku
	SkuLab   uuid.UUID
}

func SemearLoja(t *testing.T, pool *pgxpool.Pool) Loja {
	t.Helper()
	ctx := context.Background()
	const sql = `
WITH raiz AS (
    INSERT INTO categoria (nome) VALUES ('Eletrônicos') RETURNING id
), info AS (
    INSERT INTO categoria (nome, pai_id) SELECT 'Informática', id FROM raiz RETURNING id
), folhas AS (
    INSERT INTO categoria (nome, pai_id)
    SELECT n, info.id FROM info, unnest(ARRAY['Notebooks', 'Monitores']) n RETURNING id, nome
), vendedores AS (
    INSERT INTO vendedor (razao_social, cnpj)
    VALUES ('Loja Teste A', '00000000000191'), ('Loja Teste B', '00000000000272') RETURNING id
), skus AS (
    INSERT INTO sku (vendedor_id, categoria_id, descricao, preco)
    SELECT (SELECT id FROM vendedores ORDER BY id LIMIT 1 OFFSET g % 2),
           (SELECT id FROM folhas ORDER BY id LIMIT 1 OFFSET g % 2),
           'SKU de teste ' || g, 100 + g * 10
      FROM generate_series(1, 12) g
    RETURNING id
)
INSERT INTO estoque (sku_id, quantidade) SELECT id, 50 FROM skus`
	if _, err := pool.Exec(ctx, sql); err != nil {
		t.Fatalf("semeando categorias e skus: %v", err)
	}
	_, err := pool.Exec(ctx, `
INSERT INTO sku (id, vendedor_id, categoria_id, descricao, preco)
SELECT $1, (SELECT min(id::text)::uuid FROM vendedor), (SELECT id FROM categoria WHERE nome = 'Notebooks'),
       'Console Edição Limitada (laboratório)', 3999.00;
`, SkuLaboratorio)
	if err == nil {
		_, err = pool.Exec(ctx, `INSERT INTO estoque (sku_id, quantidade) VALUES ($1, 1)`, SkuLaboratorio)
	}
	if err == nil {
		_, err = pool.Exec(ctx, `
WITH c AS (
    INSERT INTO cliente (nome, email)
    SELECT 'Cliente ' || g, 'cliente' || g || '@teste.com' FROM generate_series(1, 20) g
    RETURNING id
)
INSERT INTO endereco (cliente_id, cep, logradouro, numero, cidade, uf)
SELECT id, '80000000', 'Rua Teste', '1', 'Curitiba', 'PR' FROM c`)
	}
	if err != nil {
		t.Fatalf("semeando clientes: %v", err)
	}

	var l Loja
	l.SkuLab = SkuLaboratorio
	rows, _ := pool.Query(ctx, `
SELECT c.id, e.id, c.nome FROM cliente c JOIN endereco e ON e.cliente_id = c.id ORDER BY c.email`)
	if l.Clientes, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Cliente]); err != nil {
		t.Fatal(err)
	}
	rows, _ = pool.Query(ctx, `
SELECT s.id, s.preco::text, e.quantidade, c.nome
  FROM sku s JOIN estoque e ON e.sku_id = s.id JOIN categoria c ON c.id = s.categoria_id
 WHERE s.id <> $1 ORDER BY s.descricao`, SkuLaboratorio)
	if l.Skus, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Sku]); err != nil {
		t.Fatal(err)
	}
	return l
}
