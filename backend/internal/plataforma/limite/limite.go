// Package limite — rate limit por IP com Redis (Fase 3).
//
// Janela FIXA de um minuto: a chave rl:{nome}:{ip}:{minuto} recebe INCR a cada
// requisição e expira sozinha. Simples e barato (uma ida ao Redis), com um
// defeito conhecido: no virar do minuto o cliente pode fazer até 2× o limite.
// A janela DESLIZANTE com sorted set resolve isso — exercício da fase.
package limite

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nosqlgo/marketplace/internal/plataforma/httpx"
)

// PorIP limita cada IP a porMinuto requisições. porMinuto <= 0 desliga.
func PorIP(rdb *redis.Client, nome string, porMinuto int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if porMinuto <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			agora := time.Now()
			ip := r.RemoteAddr // o middleware RealIP já trocou pelo X-Forwarded-For, se houver
			if host, _, err := net.SplitHostPort(ip); err == nil {
				ip = host
			}
			chave := fmt.Sprintf("rl:%s:%s:%d", nome, ip, agora.Unix()/60)

			var incr *redis.IntCmd
			_, err := rdb.TxPipelined(r.Context(), func(p redis.Pipeliner) error {
				incr = p.Incr(r.Context(), chave)
				p.ExpireNX(r.Context(), chave, 2*time.Minute) // NX: só na primeira (Redis 7+)
				return nil
			})
			if err != nil {
				// Fail-open: com o Redis fora, melhor atender sem limite do que
				// derrubar a loja. (Uma API de pagamento escolheria fail-closed.)
				slog.Warn("rate limit indisponível", "err", err)
				next.ServeHTTP(w, r)
				return
			}
			restante := int64(porMinuto) - incr.Val()
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(porMinuto))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(max(restante, 0), 10))
			if restante < 0 {
				w.Header().Set("Retry-After", strconv.FormatInt(60-agora.Unix()%60, 10))
				httpx.Error(w, http.StatusTooManyRequests, "muitas requisições; tente de novo em instantes")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
