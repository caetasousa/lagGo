// Package mongo são os ADAPTADORES da loja para o MongoDB: o catálogo
// (busca com $facet, documento do produto, avaliações numa transação
// multi-documento), o esquema ($jsonSchema e índices) e a carga do catálogo
// (semente.go, usada pelo comando seed-catalogo).
package mongo

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

// Catalogo implementa portas.Catalogo.
type Catalogo struct {
	cliente *mongo.Client
	db      *mongo.Database
}

func NovoCatalogo(cliente *mongo.Client, banco string) *Catalogo {
	return &Catalogo{cliente: cliente, db: cliente.Database(banco)}
}

func (s *Catalogo) Produto(ctx context.Context, id string) (dominio.Produto, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return dominio.Produto{}, dominio.ErrProdutoNaoEncontrado
	}
	var p produtoDoc
	if err := s.db.Collection(colecaoProdutos).FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&p); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return dominio.Produto{}, dominio.ErrProdutoNaoEncontrado
		}
		return dominio.Produto{}, err
	}
	return p.paraDominio(), nil
}

// Avaliar grava a avaliação e atualiza o resumo do produto NUMA TRANSAÇÃO
// multi-documento (exige replica set). Sem ela, uma falha entre os dois passos
// deixaria a média contando uma avaliação que não existe (ou o contrário).
func (s *Catalogo) Avaliar(ctx context.Context, a dominio.Avaliacao) (dominio.ResultadoAvaliacao, error) {
	oid, err := bson.ObjectIDFromHex(a.ProdutoID)
	if err != nil {
		return dominio.ResultadoAvaliacao{}, dominio.ErrProdutoNaoEncontrado
	}
	av := avaliacaoDoc{ID: bson.NewObjectID(), ProdutoID: oid, ClienteID: a.ClienteID.String(),
		ClienteNome: a.ClienteNome, Nota: a.Nota, Texto: a.Texto, Em: a.Em}
	resumo := avaliacaoResumoDoc{ClienteNome: av.ClienteNome, Nota: av.Nota, Texto: av.Texto, Em: av.Em}

	sess, err := s.cliente.StartSession()
	if err != nil {
		return dominio.ResultadoAvaliacao{}, err
	}
	defer sess.EndSession(ctx)

	var res struct {
		NotaMedia     float64 `bson:"nota_media"`
		QtdAvaliacoes int32   `bson:"qtd_avaliacoes"`
	}
	_, err = sess.WithTransaction(ctx, func(ctx context.Context) (any, error) {
		if _, err := s.db.Collection(colecaoAvaliacoes).InsertOne(ctx, av); err != nil {
			return nil, err
		}
		// Atualização com PIPELINE: os novos valores são calculados a partir
		// dos atuais no próprio servidor, de forma atômica no documento.
		//   média nova = (média × n + nota) / (n + 1)
		//   recentes   = [nova] + recentes, cortado em 3   (padrão Subset)
		atualizacao := mongo.Pipeline{{{Key: "$set", Value: bson.D{
			{Key: "nota_media", Value: bson.D{{Key: "$round", Value: bson.A{
				bson.D{{Key: "$divide", Value: bson.A{
					bson.D{{Key: "$add", Value: bson.A{bson.D{{Key: "$multiply", Value: bson.A{"$nota_media", "$qtd_avaliacoes"}}}, a.Nota}}},
					bson.D{{Key: "$add", Value: bson.A{"$qtd_avaliacoes", 1}}},
				}}}, 2}}}},
			{Key: "qtd_avaliacoes", Value: bson.D{{Key: "$add", Value: bson.A{"$qtd_avaliacoes", 1}}}},
			{Key: "avaliacoes_recentes", Value: bson.D{{Key: "$slice", Value: bson.A{
				bson.D{{Key: "$concatArrays", Value: bson.A{bson.A{resumo}, "$avaliacoes_recentes"}}}, 3}}}},
		}}}}
		err := s.db.Collection(colecaoProdutos).FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: oid}}, atualizacao,
			options.FindOneAndUpdate().SetReturnDocument(options.After).
				SetProjection(bson.D{{Key: "nota_media", Value: 1}, {Key: "qtd_avaliacoes", Value: 1}})).Decode(&res)
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, dominio.ErrProdutoNaoEncontrado // aborta a transação: a avaliação inserida some
		}
		return nil, err
	})
	return dominio.ResultadoAvaliacao{NotaMedia: res.NotaMedia, QtdAvaliacoes: res.QtdAvaliacoes}, err
}

// ProdutosDosSkus: para cada SKU, o produto que o contém (o índice
// skus.sku_id atende a consulta).
func (s *Catalogo) ProdutosDosSkus(ctx context.Context, skus []string) (map[string]dominio.ProdutoDoSku, error) {
	cur, err := s.db.Collection(colecaoProdutos).Find(ctx,
		bson.D{{Key: "skus.sku_id", Value: bson.D{{Key: "$in", Value: skus}}}},
		options.Find().SetProjection(bson.D{{Key: "nome", Value: 1}, {Key: "skus", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var produtos []produtoDoc
	if err := cur.All(ctx, &produtos); err != nil {
		return nil, err
	}
	out := map[string]dominio.ProdutoDoSku{}
	for _, p := range produtos {
		for _, sk := range p.Skus {
			out[sk.SkuID] = dominio.ProdutoDoSku{ProdutoID: p.ID.Hex(), Nome: p.Nome, Preco: dominio.Dinheiro(sk.Preco.String())}
		}
	}
	return out, nil
}

// NomeAnonimo: o que aparece no lugar do nome depois de "excluir a conta".
const NomeAnonimo = "Cliente removido"

// AnonimizarAutor (LGPD): troca o nome do cliente nas avaliações dele — na
// coleção avaliacoes e na cópia resumida dentro do produto (padrão Subset).
// A nota e o texto ficam: não identificam a pessoa e a média do produto
// continua certa. A cópia no produto não guarda o cliente_id, então cada uma
// é achada pelo instante e pelo nome (arrayFilters).
func (s *Catalogo) AnonimizarAutor(ctx context.Context, cliente uuid.UUID) ([]string, error) {
	filtro := bson.D{{Key: "cliente_id", Value: cliente.String()}, {Key: "cliente_nome", Value: bson.D{{Key: "$ne", Value: NomeAnonimo}}}}
	cur, err := s.db.Collection(colecaoAvaliacoes).Find(ctx, filtro)
	if err != nil {
		return nil, err
	}
	var avs []avaliacaoDoc
	if err := cur.All(ctx, &avs); err != nil {
		return nil, err
	}
	var produtos []string
	for _, a := range avs {
		produtos = append(produtos, a.ProdutoID.Hex())
		_, err := s.db.Collection(colecaoProdutos).UpdateOne(ctx, bson.D{{Key: "_id", Value: a.ProdutoID}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "avaliacoes_recentes.$[r].cliente_nome", Value: NomeAnonimo}}}},
			options.UpdateOne().SetArrayFilters([]any{bson.D{{Key: "r.em", Value: a.Em}, {Key: "r.cliente_nome", Value: a.ClienteNome}}}))
		if err != nil {
			return nil, err
		}
	}
	_, err = s.db.Collection(colecaoAvaliacoes).UpdateMany(ctx, filtro,
		bson.D{{Key: "$set", Value: bson.D{{Key: "cliente_nome", Value: NomeAnonimo}}}})
	return produtos, err
}
