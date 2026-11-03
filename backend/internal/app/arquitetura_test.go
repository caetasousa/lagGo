package app

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Como quebra: alguém importa o pgx num caso de uso "só desta vez", o
// adaptador HTTP passa a falar direto com o banco, ou a loja passa a depender
// do laboratório. O código continua compilando — e a arquitetura hexagonal
// vira só nome de pasta. Este teste lê os imports de cada pacote e confere a
// REGRA DE DEPENDÊNCIA (docs/12-arquitetura-hexagonal.md):
//
//	dominio    só a biblioteca padrão (e uuid)
//	portas     + o dominio do próprio contexto
//	aplicacao  + as portas do próprio contexto
//	adaptadores/http  nunca um banco nem outro adaptador
//	contextos  a loja e o painel não importam ninguém; o laboratório só fala
//	           com a loja pelos adaptadores-ponte (loja e catalogo)
func TestRegraDeDependencia(t *testing.T) {
	const modulo = "github.com/nosqlgo/marketplace/internal/"
	raiz := ".." // internal/
	permitidosNoNucleo := []string{"github.com/google/uuid"}
	bancos := []string{"github.com/jackc/pgx", "go.mongodb.org/mongo-driver", "github.com/redis/go-redis",
		"database/sql", "github.com/nosqlgo/marketplace/internal/sqlcdb"}

	verificados := 0
	err := filepath.WalkDir(raiz, func(caminho string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(caminho, ".go") || strings.HasSuffix(caminho, "_test.go") {
			return err
		}
		rel, _ := filepath.Rel(raiz, caminho)
		partes := strings.Split(filepath.ToSlash(rel), "/")
		contexto := partes[0]
		if contexto != "loja" && contexto != "laboratorio" && contexto != "painel" {
			return nil
		}
		camada := partes[1]
		adaptador := ""
		if camada == "adaptadores" {
			adaptador = partes[2]
		}
		f, err := parser.ParseFile(token.NewFileSet(), caminho, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		verificados++
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			doProjeto := strings.HasPrefix(p, modulo)
			outro := strings.TrimPrefix(p, modulo)
			biblioteca := !strings.Contains(strings.Split(p, "/")[0], ".")
			falha := func(motivo string) { t.Errorf("%s importa %s: %s", rel, p, motivo) }

			switch camada {
			case "dominio":
				if !biblioteca && !contem(permitidosNoNucleo, p) {
					falha("o domínio só usa a biblioteca padrão")
				}
				if p == "net/http" {
					falha("o domínio não conhece HTTP")
				}
			case "portas", "aplicacao":
				if p == "net/http" || comecaCom(bancos, p) {
					falha(camada + " não conhece banco nem HTTP: isso é trabalho de um adaptador")
				}
				if doProjeto {
					permitido := outro == contexto+"/dominio" || (camada == "aplicacao" && outro == contexto+"/portas")
					if !permitido {
						falha(camada + " só depende do domínio" + map[bool]string{true: " e das portas", false: ""}[camada == "aplicacao"] + " do próprio contexto")
					}
				} else if !biblioteca && !contem(permitidosNoNucleo, p) {
					falha(camada + " só usa a biblioteca padrão (e uuid)")
				}
			case "adaptadores":
				if adaptador == "http" && (comecaCom(bancos, p) || strings.HasPrefix(outro, contexto+"/adaptadores/")) {
					falha("o adaptador HTTP chama os casos de uso, nunca um banco ou outro adaptador")
				}
			}
			if doProjeto && !strings.HasPrefix(outro, contexto+"/") && !strings.HasPrefix(outro, "plataforma/") && outro != "sqlcdb" {
				ponte := contexto == "laboratorio" && camada == "adaptadores" && (adaptador == "loja" || adaptador == "catalogo") && strings.HasPrefix(outro, "loja/")
				if !ponte {
					falha("um contexto não depende de outro (só o laboratório fala com a loja, pelas pontes)")
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if verificados < 30 {
		t.Fatalf("só %d arquivos verificados: o teste não está achando os contextos", verificados)
	}
}

func contem(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

func comecaCom(prefixos []string, s string) bool {
	for _, p := range prefixos {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}
