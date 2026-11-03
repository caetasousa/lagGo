// Package catalogo: o adaptador do Laboratório de Cache. Lê o MESMO produto
// do catálogo da loja direto do MongoDB (pelo adaptador da própria loja) e
// pelo Redis, na mesma chave e no mesmo formato que a loja usa
// (cache:produto:{id}, o JSON do produto) — a loja continua lendo a cópia
// que o laboratório deixa. Implementa portas.CatalogoParaCache.
package catalogo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
	lojamongo "github.com/nosqlgo/marketplace/internal/loja/adaptadores/mongo"
	lojadominio "github.com/nosqlgo/marketplace/internal/loja/dominio"
)

const (
	colecaoProdutos = "produtos"
	prefixoCache    = "cache:produto:" // o mesmo da loja (loja/adaptadores/redis)
	tempoDeCache    = 5 * time.Minute
)

var errSemProduto = dominio.ErrNaoEncontrado{Msg: "produto não encontrado"}

type Catalogo struct {
	db   *mongo.Database
	loja *lojamongo.Catalogo
	rdb  *goredis.Client
}

func Novo(cliente *mongo.Client, banco string, rdb *goredis.Client) *Catalogo {
	return &Catalogo{db: cliente.Database(banco), loja: lojamongo.NovoCatalogo(cliente, banco), rdb: rdb}
}

func (c *Catalogo) PrimeiroProduto(ctx context.Context) (string, string, error) {
	var p struct {
		ID   bson.ObjectID `bson:"_id"`
		Nome string        `bson:"nome"`
	}
	err := c.db.Collection(colecaoProdutos).FindOne(ctx, bson.D{}, options.FindOne().SetSort(bson.D{{Key: "_id", Value: 1}})).Decode(&p)
	if err != nil {
		return "", "", errSemProduto
	}
	return p.ID.Hex(), p.Nome, nil
}

// LerDoBanco: o produto lido do MongoDB e convertido em JSON — exatamente o
// trabalho que a página do produto faz numa falha de cache.
func (c *Catalogo) LerDoBanco(ctx context.Context, id string) ([]byte, error) {
	p, err := c.loja.Produto(ctx, id)
	if errors.Is(err, lojadominio.ErrProdutoNaoEncontrado) {
		return nil, errSemProduto
	}
	if err != nil {
		return nil, err
	}
	return json.Marshal(p)
}

func (c *Catalogo) LerDoCache(ctx context.Context, id string) ([]byte, bool, error) {
	b, err := c.rdb.Get(ctx, prefixoCache+id).Bytes()
	if errors.Is(err, goredis.Nil) {
		return nil, false, nil
	}
	return b, err == nil, err
}

func (c *Catalogo) GravarNoCache(ctx context.Context, id string, doc []byte) error {
	return c.rdb.Set(ctx, prefixoCache+id, doc, tempoDeCache).Err()
}

func (c *Catalogo) ApagarDoCache(ctx context.Context, id string) error {
	return c.rdb.Del(ctx, prefixoCache+id).Err()
}

func (c *Catalogo) NoCache(ctx context.Context, id string) (int64, time.Duration) {
	bytes, _ := c.rdb.MemoryUsage(ctx, prefixoCache+id).Result()
	ttl, _ := c.rdb.TTL(ctx, prefixoCache+id).Result()
	return bytes, ttl
}
