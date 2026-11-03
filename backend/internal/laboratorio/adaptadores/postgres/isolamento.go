package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Um roteiro é uma sequência fixa de comandos de duas transações (T1 e T2),
// executada em duas conexões de verdade. Um passo que não termina em
// `esperaBloqueio` é marcado como BLOQUEADO (esperando um lock) e o roteiro
// segue com a outra transação — exatamente como você faria em dois terminais.

const esperaBloqueio = 400 * time.Millisecond

var roteiros = []dominio.Roteiro{
	{
		ID: "leitura-suja", Titulo: "Leitura suja (dirty read)",
		Resumo:   "T2 consegue ver um saldo que T1 alterou mas ainda não confirmou (e depois desfez)?",
		Pergunta: "O passo 4 mostra 0 (o valor não confirmado) ou 100?",
		Preparo:  preparoContas,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "UPDATE lab.conta SET saldo = 0 WHERE id = 'A'", Nota: "T1 zera o saldo, sem confirmar"},
			{T: 2, SQL: "BEGIN", Nota: ""},
			{T: 2, SQL: "SELECT saldo FROM lab.conta WHERE id = 'A'", Nota: "T2 lê enquanto T1 está aberta"},
			{T: 1, SQL: "ROLLBACK", Nota: "T1 desiste: o 0 nunca existiu"},
			{T: 2, SQL: "COMMIT", Nota: ""},
		},
		Final:    "SELECT id, saldo FROM lab.conta ORDER BY id",
		Anomalia: func(r []dominio.ResultadoPasso, _ string) bool { return strings.Contains(r[3].Resultado, "saldo=0") },
	},
	{
		ID: "leitura-nao-repetivel", Titulo: "Leitura não repetível",
		Resumo:   "T1 lê o mesmo saldo duas vezes e recebe valores diferentes, porque T2 alterou no meio.",
		Pergunta: "Os passos 2 e 4 (a mesma consulta, na mesma transação) devolvem o mesmo valor?",
		Preparo:  preparoContas,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "SELECT saldo FROM lab.conta WHERE id = 'A'", Nota: "primeira leitura"},
			{T: 2, SQL: "UPDATE lab.conta SET saldo = 50 WHERE id = 'A'", Nota: "T2 altera e confirma (autocommit)"},
			{T: 1, SQL: "SELECT saldo FROM lab.conta WHERE id = 'A'", Nota: "segunda leitura, mesma transação"},
			{T: 1, SQL: "COMMIT", Nota: ""},
		},
		Final:    "SELECT id, saldo FROM lab.conta ORDER BY id",
		Anomalia: func(r []dominio.ResultadoPasso, _ string) bool { return r[1].Resultado != r[3].Resultado },
	},
	{
		ID: "fantasma", Titulo: "Leitura fantasma (phantom read)",
		Resumo:   "A mesma contagem muda dentro da transação porque T2 inseriu uma linha nova que entra no filtro.",
		Pergunta: "A contagem do passo 4 é igual à do passo 2?",
		Preparo:  preparoContas,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "SELECT count(*) AS contas_ricas FROM lab.conta WHERE saldo >= 100", Nota: "primeira contagem"},
			{T: 2, SQL: "INSERT INTO lab.conta VALUES ('C', 'Carla', 300)", Nota: "T2 insere e confirma"},
			{T: 1, SQL: "SELECT count(*) AS contas_ricas FROM lab.conta WHERE saldo >= 100", Nota: "segunda contagem"},
			{T: 1, SQL: "COMMIT", Nota: ""},
		},
		Final:    "SELECT id, saldo FROM lab.conta ORDER BY id",
		Anomalia: func(r []dominio.ResultadoPasso, _ string) bool { return r[1].Resultado != r[3].Resultado },
	},
	{
		ID: "lost-update", Titulo: "Atualização perdida (lost update)",
		Resumo:   "Duas transações leem o saldo 100 e gravam 'o que leram + depósito'. Um dos depósitos some.",
		Pergunta: "O saldo final é 130 (os dois depósitos), 120 (perdeu o de T1) ou T2 foi abortada?",
		Preparo:  preparoContas,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 2, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "SELECT saldo FROM lab.conta WHERE id = 'A'", Nota: "T1 lê 100 para depositar 10"},
			{T: 2, SQL: "SELECT saldo FROM lab.conta WHERE id = 'A'", Nota: "T2 lê 100 para depositar 20"},
			{T: 1, SQL: "UPDATE lab.conta SET saldo = 110 WHERE id = 'A'", Nota: "T1 grava 100 + 10"},
			{T: 2, SQL: "UPDATE lab.conta SET saldo = 120 WHERE id = 'A'", Nota: "T2 grava 100 + 20 — a linha está travada por T1"},
			{T: 1, SQL: "COMMIT", Nota: "T1 confirma e libera a linha"},
			{T: 2, SQL: "COMMIT", Nota: ""},
		},
		Final:    "SELECT id, saldo FROM lab.conta WHERE id = 'A'",
		Anomalia: func(_ []dominio.ResultadoPasso, final string) bool { return strings.Contains(final, "saldo=120") },
	},
	{
		ID: "write-skew", Titulo: "Write skew (plantão médico)",
		Resumo:   "Regra: pelo menos um médico de plantão. Ana e Bruno verificam (há 2) e cada um sai — linhas DIFERENTES, nenhum lock conflita.",
		Pergunta: "No fim sobra alguém de plantão?",
		Preparo:  preparoPlantao,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 2, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "SELECT count(*) AS de_plantao FROM lab.plantao WHERE de_plantao", Nota: "Ana confere: 2, posso sair"},
			{T: 2, SQL: "SELECT count(*) AS de_plantao FROM lab.plantao WHERE de_plantao", Nota: "Bruno confere: 2, posso sair"},
			{T: 1, SQL: "UPDATE lab.plantao SET de_plantao = false WHERE medico = 'Ana'", Nota: ""},
			{T: 2, SQL: "UPDATE lab.plantao SET de_plantao = false WHERE medico = 'Bruno'", Nota: ""},
			{T: 1, SQL: "COMMIT", Nota: ""},
			{T: 2, SQL: "COMMIT", Nota: ""},
		},
		Final:    "SELECT count(*) AS de_plantao FROM lab.plantao WHERE de_plantao",
		Anomalia: func(_ []dominio.ResultadoPasso, final string) bool { return strings.Contains(final, "de_plantao=0") },
	},
	{
		ID: "deadlock", Titulo: "Deadlock",
		Resumo:   "T1 trava a conta A e quer a B; T2 trava a B e quer a A. Uma espera a outra para sempre — até o PostgreSQL abortar uma delas.",
		Pergunta: "Qual transação o PostgreSQL escolheu como vítima (erro 40P01), e quanto tempo levou?",
		Preparo:  preparoContas,
		Passos: []dominio.Passo{
			{T: 1, SQL: "BEGIN", Nota: ""},
			{T: 2, SQL: "BEGIN", Nota: ""},
			{T: 1, SQL: "UPDATE lab.conta SET saldo = saldo - 10 WHERE id = 'A'", Nota: "T1 trava A"},
			{T: 2, SQL: "UPDATE lab.conta SET saldo = saldo - 10 WHERE id = 'B'", Nota: "T2 trava B"},
			{T: 1, SQL: "UPDATE lab.conta SET saldo = saldo + 10 WHERE id = 'B'", Nota: "T1 quer B: espera T2"},
			{T: 2, SQL: "UPDATE lab.conta SET saldo = saldo + 10 WHERE id = 'A'", Nota: "T2 quer A: espera T1 — ciclo!"},
			{T: 1, SQL: "COMMIT", Nota: ""},
			{T: 2, SQL: "COMMIT", Nota: ""},
		},
		Final: "SELECT id, saldo FROM lab.conta ORDER BY id",
		Anomalia: func(r []dominio.ResultadoPasso, _ string) bool {
			for _, p := range r {
				if p.Codigo == "40P01" {
					return true
				}
			}
			return false
		},
	},
}

var preparoContas = []string{
	"TRUNCATE lab.conta",
	"INSERT INTO lab.conta VALUES ('A', 'Ana', 100), ('B', 'Bruno', 100)",
}
var preparoPlantao = []string{
	"TRUNCATE lab.plantao",
	"INSERT INTO lab.plantao VALUES ('Ana', true), ('Bruno', true)",
}

// Isolamento implementa portas.Isolamento.
type Isolamento struct{ pool *pgxpool.Pool }

func NovoIsolamento(pool *pgxpool.Pool) *Isolamento { return &Isolamento{pool: pool} }

func (a *Isolamento) Roteiros() []dominio.Roteiro { return roteiros }

// isolamentoMu: um roteiro por vez — dois usuários rodando ao mesmo tempo
// misturariam as tabelas do laboratório.
var isolamentoMu sync.Mutex

func (a *Isolamento) Rodar(ctx context.Context, id, nivel string) (dominio.ResultadoIsolamento, error) {
	pool := a.pool
	var rot *dominio.Roteiro
	for i := range roteiros {
		if roteiros[i].ID == id {
			rot = &roteiros[i]
		}
	}
	nivelSQL, ok := dominio.NiveisDeIsolamento[nivel]
	if rot == nil || !ok {
		return dominio.ResultadoIsolamento{}, dominio.ErrValidacao{Msg: "roteiro ou nível de isolamento desconhecido"}
	}
	isolamentoMu.Lock()
	defer isolamentoMu.Unlock()

	for _, sql := range rot.Preparo {
		if _, err := pool.Exec(ctx, sql); err != nil {
			return dominio.ResultadoIsolamento{}, err
		}
	}

	var conns [3]*pgxpool.Conn
	for t := 1; t <= 2; t++ {
		c, err := pool.Acquire(ctx)
		if err != nil {
			return dominio.ResultadoIsolamento{}, err
		}
		defer func() {
			// Garante que nenhuma transação fica aberta na conexão devolvida ao pool.
			_, _ = c.Exec(context.Background(), "ROLLBACK")
			c.Release()
		}()
		conns[t] = c
	}

	type saida struct {
		res string
		err error
		dur time.Duration
	}
	res := dominio.ResultadoIsolamento{Roteiro: rot.ID, Nivel: nivel}
	pendente := map[int]struct {
		ch     chan saida
		indice int
	}{}
	registrar := func(i int, s saida) {
		p := &res.Passos[i]
		p.Resultado, p.EsperouMS = s.res, float64(s.dur.Microseconds())/1000
		if s.err != nil {
			var pgErr *pgconn.PgError
			if errors.As(s.err, &pgErr) {
				p.Erro, p.Codigo = pgErr.Message, pgErr.Code
			} else {
				p.Erro = s.err.Error()
			}
		}
	}
	esperarPendente := func(t int) {
		if pd, ok := pendente[t]; ok {
			select {
			case s := <-pd.ch:
				registrar(pd.indice, s)
			case <-time.After(10 * time.Second):
				res.Passos[pd.indice].Erro = "não terminou em 10 s"
			}
			delete(pendente, t)
		}
	}

	for i, p := range rot.Passos {
		sql := p.SQL
		if sql == "BEGIN" {
			sql = "BEGIN ISOLATION LEVEL " + nivelSQL
		}
		res.Passos = append(res.Passos, dominio.ResultadoPasso{Numero: i + 1, T: p.T, SQL: sql, Nota: p.Nota})
		esperarPendente(p.T) // a mesma transação não executa dois comandos ao mesmo tempo

		ch := make(chan saida, 1)
		c := conns[p.T]
		go func() {
			inicio := time.Now()
			r, err := executar(ctx, c, sql)
			ch <- saida{r, err, time.Since(inicio)}
		}()
		select {
		case s := <-ch:
			registrar(i, s)
		case <-time.After(esperaBloqueio):
			res.Passos[i].Bloqueou = true
			pendente[p.T] = struct {
				ch     chan saida
				indice int
			}{ch, i}
		}
	}
	esperarPendente(1)
	esperarPendente(2)

	final, err := executar(ctx, conns[1], rot.Final)
	if err != nil {
		// T1 pode ter ficado numa transação abortada: limpa e tenta de novo.
		_, _ = conns[1].Exec(ctx, "ROLLBACK")
		final, err = executar(ctx, conns[1], rot.Final)
	}
	res.EstadoFinal = final
	res.Anomalia = rot.Anomalia(res.Passos, final)
	return res, err
}

// executar roda um comando e devolve as linhas como texto ("saldo=100").
func executar(ctx context.Context, c *pgxpool.Conn, sql string) (string, error) {
	rows, err := c.Query(ctx, sql, pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var linhas []string
	campos := rows.FieldDescriptions()
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return "", err
		}
		var partes []string
		for i, v := range vals {
			partes = append(partes, fmt.Sprintf("%s=%v", campos[i].Name, v))
		}
		linhas = append(linhas, strings.Join(partes, ", "))
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(campos) == 0 {
		return rows.CommandTag().String(), nil
	}
	return strings.Join(linhas, " · "), nil
}
