//go:build integration

package app_test

import (
	"os"
	"testing"

	"github.com/nosqlgo/marketplace/internal/plataforma/testinfra"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testinfra.Encerrar()
	os.Exit(code)
}
