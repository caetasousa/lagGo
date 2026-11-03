package postgres

import "testing"

// Como quebra: um experimento novo entra no catálogo sem os textos didáticos
// (cenário E6) e o aluno roda EXPLAIN sem saber o que procurar.
func TestTodoExperimentoTemDidatica(t *testing.T) {
	for _, e := range experimentos {
		if e.Pergunta == "" || e.SemIndice == "" || e.ComIndice == "" || e.Observe == "" {
			t.Errorf("experimento %s sem texto didático", e.ID)
		}
		for _, i := range e.Indices {
			if i.Explicacao == "" {
				t.Errorf("índice %s sem explicação", i.Nome)
			}
		}
	}
}
