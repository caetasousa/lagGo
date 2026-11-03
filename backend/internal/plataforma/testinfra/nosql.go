//go:build integration

package testinfra

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nosqlgo/marketplace/internal/plataforma/storage"
)

// Cassandra e Neo4j (Fase 7). As imagens são as do compose, com a mesma
// memória reduzida. Os dois são JVM e lentos para subir (~1 min): um de cada
// por pacote de teste, como os outros bancos.

// ------------------------------------------------------------ Cassandra

var (
	csUmaVez sync.Once
	csSrv    testcontainers.Container
	csHost   string
	csErr    error
	csProx   atomic.Int64
)

// Cassandra devolve a conexão e um keyspace NOVO para o teste (o Cassandra
// também não tem "CREATE DATABASE": o isolamento é por keyspace).
func Cassandra(t *testing.T) (*storage.Cassandra, string) {
	t.Helper()
	csUmaVez.Do(subirCassandra)
	if csErr != nil {
		t.Fatalf("não consegui subir o Cassandra de teste: %v", csErr)
	}
	c := storage.NewCassandra([]string{csHost})
	t.Cleanup(c.Close)
	return c, fmt.Sprintf("teste_%d", csProx.Add(1))
}

func subirCassandra() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	csSrv, csErr = testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        imagemCassandra,
			Env:          map[string]string{"MAX_HEAP_SIZE": "384M", "HEAP_NEWSIZE": "96M", "CASSANDRA_CLUSTER_NAME": "teste"},
			ExposedPorts: []string{"9042/tcp"},
			WaitingFor:   wait.ForLog("Starting listening for CQL clients").WithStartupTimeout(4 * time.Minute),
		},
		Started: true,
	})
	if csErr != nil {
		return
	}
	host, err := csSrv.Host(ctx)
	if err != nil {
		csErr = err
		return
	}
	porta, err := csSrv.MappedPort(ctx, "9042/tcp")
	if err != nil {
		csErr = err
		return
	}
	csHost = fmt.Sprintf("%s:%s", host, porta.Port())
}

// ------------------------------------------------------------ Neo4j

var (
	n4UmaVez sync.Once
	n4Srv    testcontainers.Container
	n4URI    string
	n4Err    error
	n4Mu     sync.Mutex
)

const senhaNeo4j = "senha-de-teste"

// Neo4j devolve o driver com o grafo VAZIO. A edição Community tem um banco
// só, então o isolamento é apagar tudo no começo — testes com Neo4j não usam
// t.Parallel() (como os com Redis).
func Neo4j(t *testing.T) neo4j.Driver {
	t.Helper()
	n4UmaVez.Do(subirNeo4j)
	if n4Err != nil {
		t.Fatalf("não consegui subir o Neo4j de teste: %v", n4Err)
	}
	d, err := neo4j.NewDriver(n4URI, neo4j.BasicAuth("neo4j", senhaNeo4j, ""))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close(context.Background()) })
	n4Mu.Lock()
	defer n4Mu.Unlock()
	if _, err := neo4j.ExecuteQuery(context.Background(), d, "MATCH (n) DETACH DELETE n", nil, neo4j.EagerResultTransformer); err != nil {
		t.Fatalf("limpando o Neo4j do teste: %v", err)
	}
	return d
}

func subirNeo4j() {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	n4Srv, n4Err = testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image: imagemNeo4j,
			Env: map[string]string{"NEO4J_AUTH": "neo4j/" + senhaNeo4j,
				"NEO4J_server_memory_heap_initial__size": "192m", "NEO4J_server_memory_heap_max__size": "256m",
				"NEO4J_server_memory_pagecache_size": "96m"},
			ExposedPorts: []string{"7687/tcp"},
			WaitingFor:   wait.ForLog("Started.").WithStartupTimeout(3 * time.Minute),
		},
		Started: true,
	})
	if n4Err != nil {
		return
	}
	host, err := n4Srv.Host(ctx)
	if err != nil {
		n4Err = err
		return
	}
	porta, err := n4Srv.MappedPort(ctx, "7687/tcp")
	if err != nil {
		n4Err = err
		return
	}
	n4URI = fmt.Sprintf("neo4j://%s:%s", host, porta.Port())
}

func encerrarNoSQL() {
	for _, c := range []testcontainers.Container{csSrv, n4Srv} {
		if c != nil {
			_ = c.Terminate(context.Background())
		}
	}
	csSrv, n4Srv = nil, nil
}
