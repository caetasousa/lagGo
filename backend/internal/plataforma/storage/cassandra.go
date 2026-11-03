package storage

import (
	"errors"
	"sync"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// ErrDisabled indica que o banco secundário não foi configurado (endereço
// vazio — por exemplo, nos testes que sobem só PostgreSQL, MongoDB e Redis).
var ErrDisabled = errors.New("desabilitado (endereço não configurado)")

// Cassandra conecta de forma preguiçosa (lazy): o Cassandra demora ~1 min
// para subir, então a API não pode depender dele para iniciar.
type Cassandra struct {
	hosts []string

	mu      sync.Mutex
	session *gocql.Session
	// Disjuntor simples: depois de uma falha, as próximas chamadas falham na
	// hora por um tempo, em vez de cada requisição esperar o timeout de
	// conexão (3 s) — com o Cassandra fora, a loja não fica lenta (X4).
	falhou   error
	falhouEm time.Time
}

const esperaAposFalha = 10 * time.Second

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
	if c.falhou != nil && time.Since(c.falhouEm) < esperaAposFalha {
		return nil, c.falhou
	}

	cluster := gocql.NewCluster(c.hosts...)
	cluster.Consistency = gocql.LocalQuorum
	cluster.ConnectTimeout = 3 * time.Second
	cluster.Timeout = 3 * time.Second
	// Um nó só (Fase 7): o driver usa exatamente o endereço configurado, sem
	// perguntar ao Cassandra os endereços que ele anuncia — que, num
	// contêiner com porta mapeada (testes), não são alcançáveis de fora.
	cluster.DisableInitialHostLookup = true
	session, err := cluster.CreateSession()
	if err != nil {
		c.falhou, c.falhouEm = err, time.Now()
		return nil, err
	}
	c.falhou = nil
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
