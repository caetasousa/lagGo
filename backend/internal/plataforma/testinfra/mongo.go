//go:build integration

package testinfra

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

var (
	mgUmaVez  sync.Once
	mgSrv     *tcmongo.MongoDBContainer
	mgCliente *mongo.Client
	mgErr     error
)

// Mongo devolve o cliente e o nome de um database exclusivo do teste.
// O servidor roda como replica set (rs0), como no compose: sem isso não há
// transação multi-documento.
func Mongo(t *testing.T) (*mongo.Client, string) {
	t.Helper()
	mgUmaVez.Do(subirMongo)
	if mgErr != nil {
		t.Fatalf("não consegui subir o MongoDB de teste: %v", mgErr)
	}
	nome := "t" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	t.Cleanup(func() { _ = mgCliente.Database(nome).Drop(context.Background()) })
	return mgCliente, nome
}

func subirMongo() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if mgSrv, mgErr = tcmongo.Run(ctx, imagemMongo, tcmongo.WithReplicaSet("rs0")); mgErr != nil {
		return
	}
	uri, err := mgSrv.ConnectionString(ctx)
	if err != nil {
		mgErr = err
		return
	}
	mgCliente, mgErr = storage.NewMongo(ctx, uri)
}

func encerrarMongo() {
	if mgCliente != nil {
		_ = mgCliente.Disconnect(context.Background())
		mgCliente = nil
	}
	if mgSrv != nil {
		_ = mgSrv.Terminate(context.Background())
		mgSrv = nil
	}
}
