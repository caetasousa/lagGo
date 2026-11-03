package senha

import (
	"strings"
	"testing"
)

// Como quebra (Q7): o "hash" guarda a senha (ou algo reversível), duas senhas
// iguais dão o mesmo hash (sem sal), ou a senha certa não confere.
func TestArgon2idComSalEConferencia(t *testing.T) {
	a := Novo()
	h1, err := a.Gerar("uma senha longa")
	if err != nil {
		t.Fatal(err)
	}
	h2, _ := a.Gerar("uma senha longa")
	if !strings.HasPrefix(h1, "$argon2id$v=19$m=19456,t=2,p=1$") || strings.Contains(h1, "uma senha") {
		t.Fatalf("[Q7] formato inesperado: %s", h1)
	}
	if h1 == h2 {
		t.Fatal("[Q7] mesma senha, mesmo hash: falta o sal")
	}
	if ok, _ := a.Conferir("uma senha longa", h1); !ok {
		t.Fatal("a senha certa não conferiu")
	}
	if ok, _ := a.Conferir("uma senha longA", h1); ok {
		t.Fatal("a senha errada conferiu")
	}
	if ok, _ := a.Conferir("qualquer", a.HashFalso()); ok {
		t.Fatal("o hash falso aceitou uma senha")
	}
}
