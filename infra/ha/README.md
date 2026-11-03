# Alta disponibilidade (Fase 5)

Em vez de um compose separado, os clusters de laboratório ficam no
`docker-compose.yml` principal, no **perfil `ha`** (`make up-ha`, ~600 MB):

| Componente | Configuração |
|---|---|
| **etcd** (3 nós) | no próprio compose (`etcd1`–`etcd3`) |
| **Patroni** (2 nós PostgreSQL) | [`../patroni/`](../patroni/) |
| **HAProxy** (5000 escrita, 5001 leitura, 7000 estatísticas) | [`../haproxy/haproxy.cfg`](../haproxy/haproxy.cfg) |
| **MongoDB replica set** `rsha` (3 nós, keyfile) | [`../mongo-ha/`](../mongo-ha/) |
| **Redis** primário/réplica + **Sentinel** (3) | [`../redis-ha/`](../redis-ha/) |

São só de laboratório: a loja segue com um primário e uma réplica. O
Laboratório de Alta Disponibilidade está em [`backend/internal/laboratorio/adaptadores/ha`](../../backend/internal/laboratorio/adaptadores/ha).

Explicações e fontes: [docs/09-alta-disponibilidade.md](../../docs/09-alta-disponibilidade.md) · resultados: [docs/fases/fase-5.md](../../docs/fases/fase-5.md).
