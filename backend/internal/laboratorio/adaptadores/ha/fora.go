package ha

import (
	"errors"
	"net"
	"strings"
)

// foraDoAr traduz "o perfil ha não está de pé" (nome não existe no DNS do
// Docker, conexão recusada) numa instrução, em vez de um erro técnico (U6).
func foraDoAr(err error) string {
	var dns *net.DNSError
	s := err.Error()
	if errors.As(err, &dns) || strings.Contains(s, "no such host") || strings.Contains(s, "server misbehaving") ||
		strings.Contains(s, "connection refused") || strings.Contains(s, "não configurada") {
		return "perfil ha desligado — suba os clusters de laboratório com: make up-ha"
	}
	return s
}
