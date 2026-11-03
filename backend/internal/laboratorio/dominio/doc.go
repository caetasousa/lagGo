// Package dominio do LABORATÓRIO: os parâmetros e resultados de cada
// experimento, as regras do que o aluno pode pedir (faixas, modos,
// ajustes permitidos) e os cálculos puros (percentil, leitura do plano,
// tempo fora do ar).
//
// Diferente da loja, aqui o "negócio" é o próprio banco: o experimento de
// isolamento É uma sequência de SQL, o de índices É um EXPLAIN. Por isso os
// catálogos de experimentos (com o SQL) moram no adaptador postgres, e a
// aplicação muitas vezes só valida e delega. Onde há orquestração de verdade
// — goroutines disputando, medição de tempo, laços até o cluster voltar —
// ela fica na aplicação.
//
// Regra de dependência: sem banco, sem HTTP, sem os outros contextos.
package dominio

import (
	"errors"
	"time"
)

// ErrSemEstoque: a compra do laboratório não achou estoque (não é falha).
var ErrSemEstoque = errors.New("estoque insuficiente")

// ErrValidacao: pedido inválido (HTTP 422).
type ErrValidacao struct{ Msg string }

func (e ErrValidacao) Error() string { return e.Msg }

// Percentil p (0 a 1) de latências JÁ ORDENADAS, em milissegundos.
func Percentil(xs []time.Duration, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	return float64(xs[int(float64(len(xs)-1)*p)].Microseconds()) / 1000
}
