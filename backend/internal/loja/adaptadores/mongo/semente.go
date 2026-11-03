package mongo

import (
	"context"
	"fmt"
	"hash/fnv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	lojaredis "github.com/nosqlgo/marketplace/internal/loja/adaptadores/redis"
	"github.com/nosqlgo/marketplace/internal/loja/dominio"
	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

type ResumoSemente struct {
	Produtos   int `json:"produtos"`
	Avaliacoes int `json:"avaliacoes"`
	Ranking    int `json:"ranking"`
}

// Semear monta o catálogo do MongoDB A PARTIR do PostgreSQL (fonte da verdade
// dos SKUs) e reconstrói os dados derivados do Redis. Apaga o que havia.
//
// É chamado pelo `make seed` (cmd/seed-catalogo) e pelos testes de integração.
// Determinístico: o mesmo PostgreSQL gera o mesmo catálogo (hash do id do SKU,
// não números aleatórios) — exceto os ObjectIDs.
func Semear(ctx context.Context, pg *pgxpool.Pool, db *mongo.Database, rdb *redis.Client) (ResumoSemente, error) {
	var r ResumoSemente
	q := sqlcdb.New(pg)
	if err := GarantirEsquema(ctx, db); err != nil {
		return r, err
	}

	cats, err := q.CategoriasComAncestrais(ctx)
	if err != nil {
		return r, err
	}
	porID := map[int32]sqlcdb.CategoriasComAncestraisRow{}
	for _, c := range cats {
		porID[c.ID] = c
	}
	skus, err := q.SkusParaCatalogo(ctx)
	if err != nil {
		return r, err
	}

	// 1. Agrupa os SKUs (já ordenados por categoria) em produtos de 1 a 3
	//    ofertas: num marketplace, vários vendedores vendem o mesmo produto.
	var produtos []produtoDoc
	agora := time.Now().UTC().Truncate(time.Millisecond)
	for i := 0; i < len(skus); {
		cat := skus[i].CategoriaID
		tam := 1 + int(hashDe(skus[i].ID.String())%3)
		if skus[i].ID == skuLaboratorio {
			tam = 1 // o SKU disputado do laboratório é um produto sozinho
		}
		grupo := []sqlcdb.SkusParaCatalogoRow{skus[i]}
		for j := i + 1; j < len(skus) && len(grupo) < tam && skus[j].CategoriaID == cat && skus[j].ID != skuLaboratorio; j++ {
			grupo = append(grupo, skus[j])
		}
		i += len(grupo)
		produtos = append(produtos, montarProduto(grupo, porID[cat], agora))
	}

	coll := db.Collection(colecaoProdutos)
	if _, err := coll.DeleteMany(ctx, bson.D{}); err != nil {
		return r, err
	}
	if _, err := db.Collection(colecaoAvaliacoes).DeleteMany(ctx, bson.D{}); err != nil {
		return r, err
	}
	docs := make([]any, len(produtos))
	for i := range produtos {
		docs[i] = produtos[i]
	}
	if _, err := coll.InsertMany(ctx, docs); err != nil {
		return r, fmt.Errorf("inserindo produtos: %w", err)
	}
	r.Produtos = len(produtos)

	// 2. Grava em cada SKU do PostgreSQL o produto do MongoDB (sku.produto_id).
	if err := ligarSkus(ctx, pg, produtos); err != nil {
		return r, err
	}

	// 3. Avaliações + resumo calculado por agregação.
	if r.Avaliacoes, err = semearAvaliacoes(ctx, q, db, produtos, agora); err != nil {
		return r, err
	}

	// 4. Redis: dados DERIVADOS, reconstruídos da fonte da verdade.
	r.Ranking, err = reconstruirRedis(ctx, q, rdb)
	return r, err
}

var skuLaboratorio = uuid.MustParse("11111111-1111-1111-1111-111111111111")

func ligarSkus(ctx context.Context, pg *pgxpool.Pool, produtos []produtoDoc) error {
	var skuIDs []uuid.UUID
	var prodIDs []string
	for _, p := range produtos {
		for _, s := range p.Skus {
			skuIDs = append(skuIDs, uuid.MustParse(s.SkuID))
			prodIDs = append(prodIDs, p.ID.Hex())
		}
	}
	return pgx.BeginFunc(ctx, pg, func(tx pgx.Tx) error {
		// Carga em massa sem os triggers de auditoria (mesmo motivo do seed.sql).
		if _, err := tx.Exec(ctx, "SET LOCAL session_replication_role = replica"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
UPDATE sku s SET produto_id = v.produto_id
  FROM unnest($1::uuid[], $2::text[]) AS v(sku_id, produto_id)
 WHERE s.id = v.sku_id`, skuIDs, prodIDs)
		return err
	})
}

func semearAvaliacoes(ctx context.Context, q *sqlcdb.Queries, db *mongo.Database, produtos []produtoDoc, agora time.Time) (int, error) {
	clientes, err := q.ClientesParaAvaliacoes(ctx, 3000)
	if err != nil || len(clientes) == 0 {
		return 0, err
	}
	var docs []any
	for _, p := range produtos {
		h := hashDe(p.ID.Hex() + p.Nome)
		n := int(h%26) - 6 // ~25% dos produtos ficam sem avaliação
		for k := 0; k < n; k++ {
			hk := hashDe(fmt.Sprintf("%s#%d", p.Nome, k))
			c := clientes[int(hk%uint64(len(clientes)))]
			nota := notaPonderada(hk)
			docs = append(docs, avaliacaoDoc{
				ID: bson.NewObjectID(), ProdutoID: p.ID, ClienteID: c.ID.String(), ClienteNome: dominio.NomePublico(c.Nome),
				Nota: nota, Texto: textoAvaliacao(nota, hk),
				Em: agora.Add(-time.Duration(hk%(365*24)) * time.Hour),
			})
		}
	}
	if len(docs) == 0 {
		return 0, nil
	}
	if _, err := db.Collection(colecaoAvaliacoes).InsertMany(ctx, docs); err != nil {
		return 0, fmt.Errorf("inserindo avaliações: %w", err)
	}

	// Padrão COMPUTED: média, quantidade e as 3 mais recentes calculadas no
	// servidor por um pipeline de agregação e GRAVADAS no produto com $merge.
	// $topN (MongoDB 5.2+) pega as N primeiras de cada grupo numa ordenação.
	pipeline := mongo.Pipeline{
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$produto_id"},
			{Key: "nota_media", Value: bson.D{{Key: "$avg", Value: "$nota"}}},
			{Key: "qtd_avaliacoes", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "avaliacoes_recentes", Value: bson.D{{Key: "$topN", Value: bson.D{
				{Key: "n", Value: 3},
				{Key: "sortBy", Value: bson.D{{Key: "em", Value: -1}}},
				{Key: "output", Value: bson.D{{Key: "cliente_nome", Value: "$cliente_nome"},
					{Key: "nota", Value: "$nota"}, {Key: "texto", Value: "$texto"}, {Key: "em", Value: "$em"}}},
			}}}},
		}}},
		{{Key: "$set", Value: bson.D{{Key: "nota_media", Value: bson.D{{Key: "$round", Value: bson.A{"$nota_media", 2}}}}}}},
		{{Key: "$merge", Value: bson.D{
			{Key: "into", Value: colecaoProdutos},
			{Key: "on", Value: "_id"},
			{Key: "whenMatched", Value: "merge"},
			{Key: "whenNotMatched", Value: "discard"},
		}}},
	}
	cur, err := db.Collection(colecaoAvaliacoes).Aggregate(ctx, pipeline)
	if err != nil {
		return 0, fmt.Errorf("calculando o resumo das avaliações: %w", err)
	}
	_ = cur.Close(ctx)
	return len(docs), nil
}

func reconstruirRedis(ctx context.Context, q *sqlcdb.Queries, rdb *redis.Client) (int, error) {
	vendidos, err := q.VendidosPorSkuDesde(ctx, 30)
	if err != nil {
		return 0, err
	}
	// Apaga o cache de produtos: SCAN em lotes (KEYS travaria o Redis, que
	// executa um comando por vez) + UNLINK (DEL assíncrono).
	iter := rdb.Scan(ctx, 0, lojaredis.PrefixoCache+"*", 500).Iterator()
	var lote []string
	for iter.Next(ctx) {
		lote = append(lote, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return 0, err
	}
	_, err = rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		if len(lote) > 0 {
			p.Unlink(ctx, lote...)
		}
		p.Del(ctx, lojaredis.ChaveRanking)
		membros := make([]redis.Z, len(vendidos))
		for i, v := range vendidos {
			membros[i] = redis.Z{Score: float64(v.Vendidos), Member: v.SkuID.String()}
		}
		if len(membros) > 0 {
			p.ZAdd(ctx, lojaredis.ChaveRanking, membros...)
		}
		return nil
	})
	return len(vendidos), err
}

func hashDe(s string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return h.Sum64()
}
