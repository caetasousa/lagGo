package storage

import (
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
)

// NewNeo4j cria o driver do Neo4j. O driver não abre conexão na criação;
// use VerifyConnectivity para testar. Retorna ErrDisabled se uri for vazia.
func NewNeo4j(uri, user, password string) (neo4j.Driver, error) {
	if uri == "" {
		return nil, ErrDisabled
	}
	return neo4j.NewDriver(uri, neo4j.BasicAuth(user, password, ""))
}
