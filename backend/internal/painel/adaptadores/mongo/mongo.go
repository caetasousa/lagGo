// Package mongo: o adaptador do Painel do DBA para o MongoDB.
package mongo

import (
	"context"
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// Mongo implementa portas.Mongo.
type Mongo struct {
	cliente *mongo.Client
	banco   string
}

func Novo(cliente *mongo.Client, banco string) *Mongo { return &Mongo{cliente: cliente, banco: banco} }

// Estado: serverStatus, o replica set e as coleções ($collStats, índices, validação).
func (a *Mongo) Estado(ctx context.Context) (dominio.EstadoMongo, error) {
	var st struct {
		Version     string                  `bson:"version"`
		Connections struct{ Current int64 } `bson:"connections"`
		Opcounters  map[string]any          `bson:"opcounters"`
	}
	if err := a.cliente.Database("admin").RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&st); err != nil {
		return dominio.EstadoMongo{}, err
	}
	e := dominio.EstadoMongo{Versao: st.Version, Conexoes: st.Connections.Current, Operacoes: st.Opcounters}

	var rs struct {
		Set     string
		Members []struct {
			Name     string
			StateStr string `bson:"stateStr"`
		}
	}
	if err := a.cliente.Database("admin").RunCommand(ctx, bson.D{{Key: "replSetGetStatus", Value: 1}}).Decode(&rs); err == nil {
		e.ReplicaSet = rs.Set
		for _, m := range rs.Members {
			e.Membros = append(e.Membros, m.Name+" ("+m.StateStr+")")
		}
	}

	db := a.cliente.Database(a.banco)
	specs, err := db.ListCollectionSpecifications(ctx, bson.D{})
	if err != nil {
		return dominio.EstadoMongo{}, err
	}
	sort.Slice(specs, func(i, j int) bool { return specs[i].Name < specs[j].Name })
	for _, spec := range specs {
		c, err := estatisticas(ctx, db.Collection(spec.Name))
		if err != nil {
			return dominio.EstadoMongo{}, err
		}
		c.Validacao = spec.Options != nil && strings.Contains(spec.Options.String(), "$jsonSchema")
		e.Colecoes = append(e.Colecoes, c)
	}
	return e, nil
}

// estatisticas usa o estágio $collStats (o comando collStats está obsoleto).
func estatisticas(ctx context.Context, coll *mongo.Collection) (dominio.ColecaoMongo, error) {
	c := dominio.ColecaoMongo{Nome: coll.Name()}
	cur, err := coll.Aggregate(ctx, mongo.Pipeline{{{Key: "$collStats", Value: bson.D{{Key: "storageStats", Value: bson.D{}}}}}})
	if err != nil {
		return c, err
	}
	var out []struct {
		StorageStats struct {
			Count       int64            `bson:"count"`
			Size        int64            `bson:"size"`
			StorageSize int64            `bson:"storageSize"`
			AvgObjSize  int64            `bson:"avgObjSize"`
			IndexSizes  map[string]int64 `bson:"indexSizes"`
		} `bson:"storageStats"`
	}
	if err := cur.All(ctx, &out); err != nil || len(out) == 0 {
		return c, err
	}
	s := out[0].StorageStats
	c.Documentos, c.TamanhoDados, c.Armazenamento, c.TamanhoMedio = s.Count, s.Size, s.StorageSize, s.AvgObjSize

	icur, err := coll.Indexes().List(ctx)
	if err != nil {
		return c, err
	}
	var idx []struct {
		Name   string `bson:"name"`
		Key    bson.Raw
		Unique bool `bson:"unique"`
	}
	if err := icur.All(ctx, &idx); err != nil {
		return c, err
	}
	for _, i := range idx {
		c.Indices = append(c.Indices, dominio.IndiceMongo{Nome: i.Name, Chave: i.Key.String(), Unico: i.Unique, Tamanho: s.IndexSizes[i.Name]})
	}
	return c, nil
}
