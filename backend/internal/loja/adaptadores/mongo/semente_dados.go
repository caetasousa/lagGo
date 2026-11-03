package mongo

import (
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/nosqlgo/marketplace/internal/sqlcdb"
)

// Geradores de dados fictícios do catálogo. Marcas, autores e editoras são
// inventados. O ponto é ter ATRIBUTOS DIFERENTES POR CATEGORIA — o motivo de o
// catálogo morar num banco de documentos.

type modeloCategoria struct {
	prefixo   string
	marcas    []string
	atributos func(h uint64) bson.M
}

func escolher[T any](h uint64, salto int, xs ...T) T {
	return xs[int((h>>uint(salto*5))%uint64(len(xs)))]
}

var marcasTech = []string{"Aurora", "Vértice", "Nimbus", "Órion", "Zênite"}
var marcasCasa = []string{"Lar Nobre", "Casa Viva", "Bem-Estar", "Ferro & Cia"}
var marcasModa = []string{"Trama", "Linho Sul", "Urbana", "Costura Fina"}
var editoras = []string{"Editora Pinhão", "Livros do Cerrado", "Casa das Letras", "Código Aberto Edições"}
var autores = []string{"Helena Prado", "Rui Andrade", "Marta Siqueira", "Otávio Lins", "Beatriz Couto", "Caio Ventura"}

func livro(nivel bool) func(h uint64) bson.M {
	return func(h uint64) bson.M {
		m := bson.M{
			"autor":   escolher(h, 1, autores...),
			"editora": escolher(h, 2, editoras...),
			"paginas": 120 + int(h%600),
			"ano":     2015 + int(h%11),
			"isbn":    fmt.Sprintf("978%010d", h%10_000_000_000),
		}
		if nivel {
			m["nivel"] = escolher(h, 3, "iniciante", "intermediário", "avançado")
		}
		return m
	}
}

func roupa(tipos ...string) func(h uint64) bson.M {
	return func(h uint64) bson.M {
		todos := []string{"PP", "P", "M", "G", "GG"}
		ini := int(h % 2)
		fim := min(ini+3+int((h>>3)%3), len(todos))
		return bson.M{
			"tipo":     escolher(h, 1, tipos...),
			"tamanhos": todos[ini:fim], // ARRAY dentro do documento
			"cor":      escolher(h, 2, "preto", "branco", "azul", "verde", "areia"),
			"material": escolher(h, 3, "algodão", "linho", "poliéster", "viscose"),
		}
	}
}

var modelos = map[string]modeloCategoria{
	"Notebooks": {"Notebook", marcasTech, func(h uint64) bson.M {
		return bson.M{"processador": escolher(h, 1, "N5", "N7", "N9"), "ram_gb": escolher(h, 2, 8, 16, 32),
			"armazenamento_gb": escolher(h, 3, 256, 512, 1024), "tela_pol": escolher(h, 4, 13.3, 14.0, 15.6)}
	}},
	"Monitores": {"Monitor", marcasTech, func(h uint64) bson.M {
		return bson.M{"tela_pol": escolher(h, 1, 24, 27, 32), "resolucao": escolher(h, 2, "1920x1080", "2560x1440", "3840x2160"),
			"taxa_hz": escolher(h, 3, 60, 75, 144, 165), "painel": escolher(h, 4, "IPS", "VA", "OLED")}
	}},
	"Periféricos": {"Periférico", marcasTech, func(h uint64) bson.M {
		return bson.M{"tipo": escolher(h, 1, "teclado", "mouse", "headset", "webcam"),
			"conexao": escolher(h, 2, "USB", "Bluetooth", "sem fio 2.4 GHz")}
	}},
	"Celulares": {"Smartphone", marcasTech, func(h uint64) bson.M {
		return bson.M{"armazenamento_gb": escolher(h, 1, 128, 256, 512), "ram_gb": escolher(h, 2, 6, 8, 12),
			"tela_pol": escolher(h, 3, 6.1, 6.5, 6.7), "rede_5g": h%2 == 0}
	}},
	"Áudio": {"Áudio", marcasTech, func(h uint64) bson.M {
		return bson.M{"tipo": escolher(h, 1, "fone", "caixa de som", "soundbar"), "potencia_w": 5 + int(h%95), "bluetooth": h%3 != 0}
	}},
	"Cozinha": {"Utensílio", marcasCasa, func(h uint64) bson.M {
		return bson.M{"tipo": escolher(h, 1, "panela", "liquidificador", "cafeteira", "fritadeira"),
			"voltagem": escolher(h, 2, "110V", "220V", "bivolt"), "capacidade_l": 1 + int(h%5)}
	}},
	"Móveis": {"Móvel", marcasCasa, func(h uint64) bson.M {
		return bson.M{"tipo": escolher(h, 1, "mesa", "cadeira", "estante", "sofá"), "material": escolher(h, 2, "madeira", "MDF", "metal"),
			"dimensoes_cm": bson.M{"largura": 40 + int(h%160), "altura": 40 + int((h>>8)%160), "profundidade": 30 + int((h>>16)%80)}}
	}},
	"Masculino":       {"Roupa", marcasModa, roupa("camiseta", "calça", "jaqueta", "camisa")},
	"Feminino":        {"Roupa", marcasModa, roupa("vestido", "blusa", "saia", "jaqueta")},
	"Ficção":          {"Livro", editoras, livro(false)},
	"Bancos de Dados": {"Livro", editoras, livro(true)},
	"Programação":     {"Livro", editoras, livro(true)},
}

var titulosTecnicos = []string{"Modelagem de Dados na Prática", "SQL do Zero ao Avançado", "Transações e Concorrência",
	"Índices sem Mistério", "NoSQL para Quem Vem do SQL", "Replicação e Alta Disponibilidade", "Go para Backend", "Arquitetura de Dados"}
var titulosFiccao = []string{"O Último Verão", "Cartas ao Sul", "A Casa da Colina", "Noite de Cerração", "O Rio Sem Nome", "Vento Norte"}

func montarProduto(grupo []sqlcdb.SkusParaCatalogoRow, cat sqlcdb.CategoriasComAncestraisRow, agora time.Time) produtoDoc {
	h := hashDe(grupo[0].ID.String())
	mod, ok := modelos[cat.Nome]
	if !ok {
		mod = modeloCategoria{prefixo: "produtoDoc", marcas: marcasTech, atributos: func(uint64) bson.M { return bson.M{} }}
	}
	marca := escolher(h, 6, mod.marcas...)
	codigo := strings.ToUpper(fmt.Sprintf("%x", h%0xfffff))
	nome := fmt.Sprintf("%s %s %s", mod.prefixo, marca, codigo)
	switch mod.prefixo {
	case "Livro":
		titulos := titulosFiccao
		if cat.Nome != "Ficção" {
			titulos = titulosTecnicos
		}
		nome = fmt.Sprintf("%s (vol. %d)", escolher(h, 6, titulos...), 1+h%9)
	case "Roupa", "Utensílio", "Móvel", "Periférico", "Áudio":
		attrs := mod.atributos(h)
		nome = fmt.Sprintf("%s %s %s", capitalizar(fmt.Sprint(attrs["tipo"])), marca, codigo)
	}
	if grupo[0].ID == skuLaboratorio {
		nome, marca = "Console Edição Limitada", "Zênite"
	}

	attrs := mod.atributos(h)
	p := produtoDoc{
		ID:                 bson.NewObjectID(),
		Nome:               nome,
		Marca:              marca,
		Categoria:          categoriaDoc{ID: cat.ID, Nome: cat.Nome, Caminho: cat.Caminho},
		Categorias:         cat.Ancestrais,
		Atributos:          attrs,
		AvaliacoesRecentes: []avaliacaoResumoDoc{},
		CriadoEm:           agora,
	}
	p.Descricao = descrever(nome, cat.Caminho, attrs)
	menor := ""
	for _, s := range grupo {
		preco := s.Preco
		d, _ := bson.ParseDecimal128(preco)
		p.Skus = append(p.Skus, skuDoc{SkuID: s.ID.String(), Vendedor: s.Vendedor, Preco: d})
		if menor == "" || compararDecimal(preco, menor) < 0 {
			menor = preco
		}
	}
	p.PrecoMin, _ = bson.ParseDecimal128(menor)
	return p
}

func descrever(nome, caminho string, attrs bson.M) string {
	var partes []string
	for k, v := range attrs {
		partes = append(partes, fmt.Sprintf("%s: %v", strings.ReplaceAll(k, "_", " "), v))
	}
	return fmt.Sprintf("%s, da categoria %s. %s.", nome, caminho, strings.Join(partes, "; "))
}

func capitalizar(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func compararDecimal(a, b string) int {
	var x, y float64
	fmt.Sscan(a, &x)
	fmt.Sscan(b, &y) // só para escolher o menor; o valor gravado é o texto exato
	switch {
	case x < y:
		return -1
	case x > y:
		return 1
	}
	return 0
}

func notaPonderada(h uint64) int32 {
	switch x := h % 100; {
	case x < 40:
		return 5
	case x < 70:
		return 4
	case x < 85:
		return 3
	case x < 93:
		return 2
	}
	return 1
}

func textoAvaliacao(nota int32, h uint64) string {
	textos := map[int32][]string{
		5: {"Excelente, superou as expectativas.", "Chegou rápido e funciona perfeitamente.", "Recomendo sem pensar duas vezes."},
		4: {"Muito bom, só a embalagem deixou a desejar.", "Bom custo-benefício.", "Atendeu bem ao que eu precisava."},
		3: {"Razoável, esperava um pouco mais.", "Cumpre o básico.", "Nem bom nem ruim."},
		2: {"Qualidade abaixo do anunciado.", "Demorou muito para chegar.", "Não gostei do acabamento."},
		1: {"Veio com defeito.", "Não corresponde à descrição.", "Péssima experiência."},
	}
	return escolher(h, 4, textos[nota]...)
}
