package redis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

// Sessoes implementa portas.Sessoes (Fase 6).
//
//	sessao:{sha256(token)}   STRING  cliente_id      TTL = validade da sessão
//	sessao:cliente:{id}      SET     sha256 de cada sessão do cliente
//
// O Redis guarda o HASH do token, não o token: quem lê um dump do Redis (ou
// o MONITOR) não consegue usar a sessão de ninguém (cenário Q7). O token só
// existe no cookie do navegador. TTL faz a sessão vencer sozinha.
type Sessoes struct{ rdb *goredis.Client }

func NovasSessoes(rdb *goredis.Client) *Sessoes { return &Sessoes{rdb: rdb} }

func chaveDaSessao(token string) (string, string) {
	h := sha256.Sum256([]byte(token))
	id := hex.EncodeToString(h[:])
	return PrefixoSessao + id, id
}

func chaveDoCliente(cliente uuid.UUID) string { return PrefixoSessao + "cliente:" + cliente.String() }

func (a *Sessoes) Criar(ctx context.Context, token string, cliente uuid.UUID, validade time.Duration) error {
	chave, id := chaveDaSessao(token)
	_, err := a.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		p.Set(ctx, chave, cliente.String(), validade)
		p.SAdd(ctx, chaveDoCliente(cliente), id)
		p.Expire(ctx, chaveDoCliente(cliente), validade)
		return nil
	})
	return err
}

// Cliente lê e renova a validade num comando só (GETEX).
func (a *Sessoes) Cliente(ctx context.Context, token string, validade time.Duration) (uuid.UUID, bool, error) {
	chave, _ := chaveDaSessao(token)
	v, err := a.rdb.GetEx(ctx, chave, validade).Result()
	if errors.Is(err, goredis.Nil) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	id, err := uuid.Parse(v)
	if err != nil {
		return uuid.Nil, false, nil
	}
	a.rdb.Expire(ctx, chaveDoCliente(id), validade)
	return id, true, nil
}

func (a *Sessoes) Apagar(ctx context.Context, token string) error {
	chave, id := chaveDaSessao(token)
	v, err := a.rdb.GetDel(ctx, chave).Result()
	if errors.Is(err, goredis.Nil) {
		return nil
	}
	if err != nil {
		return err
	}
	if cliente, err := uuid.Parse(v); err == nil {
		return a.rdb.SRem(ctx, chaveDoCliente(cliente), id).Err()
	}
	return nil
}

func (a *Sessoes) ApagarDoCliente(ctx context.Context, cliente uuid.UUID) error {
	ids, err := a.rdb.SMembers(ctx, chaveDoCliente(cliente)).Result()
	if err != nil {
		return err
	}
	chaves := []string{chaveDoCliente(cliente)}
	for _, id := range ids {
		chaves = append(chaves, PrefixoSessao+id)
	}
	return a.rdb.Del(ctx, chaves...).Err()
}
