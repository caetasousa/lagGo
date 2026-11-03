package storage

import (
	"errors"
	"sync"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// ErrDisabled indica que o banco opcional não foi configurado
// (o serviço só sobe com `docker compose --profile nosql`).
var ErrDisabled = errors.New("desabilitado (suba com --profile nosql)")

// Cassandra conecta de forma preguiçosa (lazy): o Cassandra demora ~1 min
// para subir, então a API não pode depender dele para iniciar.
type Cassandra struct {
	hosts []string

	mu      sync.Mutex
	session *gocql.Session
}

func NewCassandra(hosts []string) *Cassandra {
	return &Cassandra{hosts: hosts}
}

func (c *Cassandra) Session() (*gocql.Session, error) {
	if len(c.hosts) == 0 {
		return nil, ErrDisabled
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.session != nil && !c.session.Closed() {
		return c.session, nil
	}

	cluster := gocql.NewCluster(c.hosts...)
	cluster.Consistency = gocql.LocalQuorum
	cluster.ConnectTimeout = 3 * time.Second
	cluster.Timeout = 3 * time.Second
	session, err := cluster.CreateSession()
	if err != nil {
		return nil, err
	}
	c.session = session
	return session, nil
}

func (c *Cassandra) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.session != nil {
		c.session.Close()
	}
}
