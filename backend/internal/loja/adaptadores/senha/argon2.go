// Package senha é o adaptador de hash de senha da loja: argon2id (RFC 9106),
// o algoritmo que a OWASP recomenda primeiro para guardar senhas.
//
// Por que não SHA-256? Porque ele é RÁPIDO: uma placa de vídeo testa bilhões
// por segundo. O argon2id é lento de propósito e gasta MEMÓRIA a cada
// tentativa — é a memória que torna caro atacar em paralelo. O sal (16 bytes
// aleatórios por senha) faz duas senhas iguais virarem hashes diferentes e
// inutiliza tabelas pré-calculadas.
package senha

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Parâmetros: o mínimo da OWASP para argon2id (19 MiB, 2 passadas, 1 fio).
// Ficam DENTRO do hash gravado (formato PHC), então dá para subir os números
// no futuro sem invalidar as senhas antigas.
const (
	memoriaKiB = 19 * 1024
	passadas   = 2
	paralelo   = 1
	tamSal     = 16
	tamHash    = 32
)

// Argon2 implementa portas.Senhas.
type Argon2 struct{ falso string }

func Novo() *Argon2 {
	a := &Argon2{}
	// Hash de uma senha aleatória que ninguém sabe: serve só para gastar o
	// mesmo tempo quando o e-mail do login não existe.
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	a.falso, _ = a.Gerar(base64.RawStdEncoding.EncodeToString(b))
	return a
}

func (a *Argon2) HashFalso() string { return a.falso }

// Gerar devolve "$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>".
func (a *Argon2) Gerar(senha string) (string, error) {
	sal := make([]byte, tamSal)
	if _, err := rand.Read(sal); err != nil {
		return "", err
	}
	h := argon2.IDKey([]byte(senha), sal, passadas, memoriaKiB, paralelo, tamHash)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, memoriaKiB, passadas, paralelo,
		base64.RawStdEncoding.EncodeToString(sal), base64.RawStdEncoding.EncodeToString(h)), nil
}

// Conferir refaz o hash com o sal e os parâmetros gravados e compara em tempo
// constante (subtle): uma comparação comum pararia no primeiro byte diferente,
// e o tempo da resposta vazaria quantos bytes acertaram.
func (a *Argon2) Conferir(senha, hash string) (bool, error) {
	partes := strings.Split(hash, "$") // "", argon2id, v=19, m=..,t=..,p=.., sal, hash
	if len(partes) != 6 || partes[1] != "argon2id" {
		return false, errors.New("hash de senha em formato desconhecido")
	}
	var v int
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(partes[2], "v=%d", &v); err != nil || v != argon2.Version {
		return false, errors.New("versão do argon2 não suportada")
	}
	if _, err := fmt.Sscanf(partes[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, err
	}
	sal, err1 := base64.RawStdEncoding.DecodeString(partes[4])
	esperado, err2 := base64.RawStdEncoding.DecodeString(partes[5])
	if err1 != nil || err2 != nil {
		return false, errors.New("hash de senha corrompido")
	}
	h := argon2.IDKey([]byte(senha), sal, t, m, p, uint32(len(esperado)))
	return subtle.ConstantTimeCompare(h, esperado) == 1, nil
}
