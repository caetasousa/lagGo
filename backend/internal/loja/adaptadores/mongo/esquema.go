package mongo

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// O MongoDB é "schema-less", mas não precisa ser "schema-nenhum": a validação
// por $jsonSchema recusa no servidor o documento que viola as regras, mesmo
// que venha de outra aplicação ou do mongosh. A aplicação valida antes (para
// devolver uma mensagem boa); o banco é a última barreira — como o CHECK do
// PostgreSQL.

const regexUUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

var inteiro = bson.A{"int", "long"}

var esquemaProdutos = bson.M{"$jsonSchema": bson.M{
	"bsonType": "object",
	"required": bson.A{"nome", "categoria", "categorias", "skus", "preco_min", "nota_media", "qtd_avaliacoes"},
	"properties": bson.M{
		"nome":       bson.M{"bsonType": "string", "minLength": 3},
		"categorias": bson.M{"bsonType": "array", "minItems": 1, "items": bson.M{"bsonType": inteiro}},
		"skus": bson.M{"bsonType": "array", "minItems": 1, "items": bson.M{
			"bsonType": "object",
			"required": bson.A{"sku_id", "preco"},
			"properties": bson.M{
				"sku_id": bson.M{"bsonType": "string", "pattern": regexUUID},
				"preco":  bson.M{"bsonType": "decimal"},
			},
		}},
		"preco_min":           bson.M{"bsonType": "decimal"},
		"nota_media":          bson.M{"bsonType": bson.A{"double", "int"}, "minimum": 0, "maximum": 5},
		"qtd_avaliacoes":      bson.M{"bsonType": inteiro, "minimum": 0},
		"avaliacoes_recentes": bson.M{"bsonType": "array", "maxItems": 3},
	},
}}

var esquemaAvaliacoes = bson.M{"$jsonSchema": bson.M{
	"bsonType": "object",
	"required": bson.A{"produto_id", "cliente_id", "nota", "texto", "em"},
	"properties": bson.M{
		"produto_id": bson.M{"bsonType": "objectId"},
		"cliente_id": bson.M{"bsonType": "string", "pattern": regexUUID},
		"nota":       bson.M{"bsonType": inteiro, "minimum": 1, "maximum": 5},
		"texto":      bson.M{"bsonType": "string", "minLength": 3, "maxLength": 1000},
		"em":         bson.M{"bsonType": "date"},
	},
}}

var indicesProdutos = []mongo.IndexModel{
	{
		// Índice de TEXTO (um por coleção): busca por palavras com stemming
		// em português. Os pesos fazem o nome valer mais que a descrição.
		Keys: bson.D{{Key: "nome", Value: "text"}, {Key: "marca", Value: "text"},
			{Key: "categoria.nome", Value: "text"}, {Key: "descricao", Value: "text"}},
		Options: options.Index().SetName("busca_texto").SetDefaultLanguage("portuguese").
			SetWeights(bson.D{{Key: "nome", Value: 10}, {Key: "marca", Value: 5},
				{Key: "categoria.nome", Value: 3}, {Key: "descricao", Value: 1}}),
	},
	{
		// Regra ESR (Equality, Sort, Range): igualdade em categorias, depois
		// ordenação/faixa de preço. categorias é array → índice MULTIKEY.
		Keys:    bson.D{{Key: "categorias", Value: 1}, {Key: "preco_min", Value: 1}},
		Options: options.Index().SetName("categoria_preco"),
	},
	{
		// Um SKU pertence a UM produto: unique num campo de array vale entre
		// documentos diferentes.
		Keys:    bson.D{{Key: "skus.sku_id", Value: 1}},
		Options: options.Index().SetName("sku_unico").SetUnique(true),
	},
}

var indicesAvaliacoes = []mongo.IndexModel{
	{Keys: bson.D{{Key: "produto_id", Value: 1}, {Key: "em", Value: -1}}, Options: options.Index().SetName("produto_recentes")},
}

// GarantirEsquema cria as coleções com validação e os índices. É idempotente:
// roda a cada subida da API (o MongoDB não tem "migração" como o goose).
func GarantirEsquema(ctx context.Context, db *mongo.Database) error {
	for _, c := range []struct {
		nome      string
		validador bson.M
		indices   []mongo.IndexModel
	}{
		{colecaoProdutos, esquemaProdutos, indicesProdutos},
		{colecaoAvaliacoes, esquemaAvaliacoes, indicesAvaliacoes},
	} {
		nomes, err := db.ListCollectionNames(ctx, bson.D{{Key: "name", Value: c.nome}})
		if err != nil {
			return err
		}
		if len(nomes) == 0 {
			err = db.CreateCollection(ctx, c.nome, options.CreateCollection().
				SetValidator(c.validador).SetValidationLevel("strict").SetValidationAction("error"))
		} else {
			// collMod: atualiza a validação de uma coleção que já existe.
			err = db.RunCommand(ctx, bson.D{{Key: "collMod", Value: c.nome},
				{Key: "validator", Value: c.validador}, {Key: "validationLevel", Value: "strict"}}).Err()
		}
		if err != nil {
			return fmt.Errorf("coleção %s: %w", c.nome, err)
		}
		if _, err := db.Collection(c.nome).Indexes().CreateMany(ctx, c.indices); err != nil {
			return fmt.Errorf("índices de %s: %w", c.nome, err)
		}
	}
	return nil
}
