// Package httpx reúne utilitários HTTP compartilhados pelos handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

// Decode lê o corpo JSON recusando campos desconhecidos e corpos > 1 MB.
func Decode(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var syntaxErr *json.SyntaxError
		if errors.As(err, &syntaxErr) {
			return fmt.Errorf("JSON inválido na posição %d", syntaxErr.Offset)
		}
		return fmt.Errorf("JSON inválido: %w", err)
	}
	return nil
}

// QueryInt lê um parâmetro inteiro da URL, usando def se ausente ou fora de [min, max].
func QueryInt(r *http.Request, name string, def, min, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || v < min || v > max {
		return def
	}
	return v
}
