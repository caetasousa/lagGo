package mongo

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/nosqlgo/marketplace/internal/loja/dominio"
)

var limitesPreco = bson.A{0, 100, 500, 1000, 2500, 5000}

// Buscar monta UM pipeline de agregação: $match (texto + categoria + preço) e
// um $facet que, na mesma passada, devolve a página de itens, o total e as
// contagens por categoria e por faixa de preço.
func (s *Catalogo) Buscar(ctx context.Context, f dominio.FiltroBusca) (dominio.ResultadoBusca, error) {
	match := bson.D{}
	if f.Texto != "" {
		// $text precisa estar no PRIMEIRO $match e usa o índice busca_texto.
		match = append(match, bson.E{Key: "$text", Value: bson.D{{Key: "$search", Value: f.Texto}}})
	}
	if f.Categoria > 0 {
		// categorias = [raiz, ..., folha]: igualdade num array casa com
		// qualquer elemento → filtrar pela raiz pega todas as descendentes.
		match = append(match, bson.E{Key: "categorias", Value: f.Categoria})
	}
	preco := bson.D{}
	if f.PrecoDe > 0 {
		preco = append(preco, bson.E{Key: "$gte", Value: f.PrecoDe})
	}
	if f.PrecoAte > 0 {
		preco = append(preco, bson.E{Key: "$lt", Value: f.PrecoAte})
	}
	if len(preco) > 0 {
		match = append(match, bson.E{Key: "preco_min", Value: preco})
	}

	ordem := bson.D{{Key: "nota_media", Value: -1}, {Key: "qtd_avaliacoes", Value: -1}}
	switch {
	case f.Ordenar == "preco_asc":
		ordem = bson.D{{Key: "preco_min", Value: 1}}
	case f.Ordenar == "preco_desc":
		ordem = bson.D{{Key: "preco_min", Value: -1}}
	case f.Texto != "" && (f.Ordenar == "" || f.Ordenar == "relevancia"):
		ordem = bson.D{{Key: "relevancia", Value: bson.D{{Key: "$meta", Value: "textScore"}}}}
	}
	ordem = append(ordem, bson.E{Key: "_id", Value: 1}) // desempate estável para paginar

	projecao := bson.D{
		{Key: "nome", Value: 1}, {Key: "marca", Value: 1}, {Key: "categoria", Value: 1},
		{Key: "preco_min", Value: 1}, {Key: "nota_media", Value: 1}, {Key: "qtd_avaliacoes", Value: 1},
		{Key: "qtd_ofertas", Value: bson.D{{Key: "$size", Value: "$skus"}}},
	}
	if f.Texto != "" {
		projecao = append(projecao, bson.E{Key: "relevancia", Value: bson.D{{Key: "$meta", Value: "textScore"}}})
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: match}},
		{{Key: "$facet", Value: bson.D{
			{Key: "itens", Value: bson.A{
				bson.D{{Key: "$sort", Value: ordem}},
				bson.D{{Key: "$skip", Value: (f.Pagina - 1) * f.PorPagina}},
				bson.D{{Key: "$limit", Value: f.PorPagina}},
				bson.D{{Key: "$project", Value: projecao}},
			}},
			{Key: "total", Value: bson.A{bson.D{{Key: "$count", Value: "n"}}}},
			{Key: "categorias", Value: bson.A{
				bson.D{{Key: "$group", Value: bson.D{
					{Key: "_id", Value: bson.D{{Key: "id", Value: "$categoria.id"}, {Key: "nome", Value: "$categoria.nome"}}},
					{Key: "total", Value: bson.D{{Key: "$sum", Value: 1}}},
				}}},
				bson.D{{Key: "$sort", Value: bson.D{{Key: "total", Value: -1}, {Key: "_id.nome", Value: 1}}}},
			}},
			{Key: "precos", Value: bson.A{
				bson.D{{Key: "$bucket", Value: bson.D{
					{Key: "groupBy", Value: "$preco_min"},
					{Key: "boundaries", Value: limitesPreco},
					{Key: "default", Value: 5000},
					{Key: "output", Value: bson.D{{Key: "total", Value: bson.D{{Key: "$sum", Value: 1}}}}},
				}}},
			}},
		}}},
	}

	cur, err := s.db.Collection(colecaoProdutos).Aggregate(ctx, pipeline)
	if err != nil {
		return dominio.ResultadoBusca{}, err
	}
	var saida []struct {
		Itens []produtoResumoDoc `bson:"itens"`
		Total []struct {
			N int32 `bson:"n"`
		}
		Categorias []struct {
			ID struct {
				ID   int32
				Nome string
			} `bson:"_id"`
			Total int32 `bson:"total"`
		} `bson:"categorias"`
		Precos []struct {
			ID    float64 `bson:"_id"`
			Total int32   `bson:"total"`
		} `bson:"precos"`
	}
	if err := cur.All(ctx, &saida); err != nil {
		return dominio.ResultadoBusca{}, err
	}

	r := dominio.ResultadoBusca{Pagina: f.Pagina, PorPagina: f.PorPagina, Itens: []dominio.ProdutoResumo{},
		Categorias: []dominio.FacetaCategoria{}, FaixasPreco: []dominio.FacetaPreco{}}
	if len(saida) == 1 {
		o := saida[0]
		for _, it := range o.Itens {
			r.Itens = append(r.Itens, it.paraDominio())
		}
		if len(o.Total) == 1 {
			r.Total = o.Total[0].N
		}
		for _, c := range o.Categorias {
			r.Categorias = append(r.Categorias, dominio.FacetaCategoria{ID: c.ID.ID, Nome: c.ID.Nome, Total: c.Total})
		}
		for _, p := range o.Precos {
			ate := 0.0
			for i, l := range limitesPreco {
				if float64(l.(int)) == p.ID && i+1 < len(limitesPreco) {
					ate = float64(limitesPreco[i+1].(int))
				}
			}
			r.FaixasPreco = append(r.FaixasPreco, dominio.FacetaPreco{De: p.ID, Ate: ate, Total: p.Total})
		}
	}
	r.Consulta, _ = bson.MarshalExtJSON(bson.D{{Key: "pipeline", Value: pipeline}}, false, false)
	return r, nil
}
