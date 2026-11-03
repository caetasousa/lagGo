package aplicacao_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nosqlgo/marketplace/internal/laboratorio/adaptadores/ha"
	"github.com/nosqlgo/marketplace/internal/laboratorio/aplicacao"
	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Como quebra (U6): com o perfil ha desligado, o laboratório devolve um erro
// técnico ("no such host", "connection refused") em vez de dizer ao aluno
// como subir os clusters. Sem configuração nenhuma, nada vai à rede.
func TestSemClustersDizComoSubir(t *testing.T) {
	lab := aplicacao.NovoHA(ha.NovoPatroni("", nil), ha.NovoMongoRS(""), ha.NovoSentinel(nil))
	for nome, e := range lab.Estado(context.Background()) {
		if e.Disponivel || !strings.Contains(e.Erro, "make up-ha") {
			t.Errorf("[U6] %s: esperado indisponível com instrução, veio %+v", nome, e)
		}
	}
	_, err := lab.Iniciar(context.Background(), "patroni", "queda", false)
	var val dominio.ErrValidacao
	if !errors.As(err, &val) || !strings.Contains(err.Error(), "make up-ha") {
		t.Fatalf("[U6] iniciar sem cluster deveria explicar como subir, veio %v", err)
	}
	if _, err := lab.Iniciar(context.Background(), "cassandra", "queda", false); !errors.As(err, &val) {
		t.Fatalf("tecnologia inválida deveria ser recusada, veio %v", err)
	}
}
