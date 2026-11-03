// Package dominio é o CENTRO da loja na arquitetura hexagonal: as entidades
// (Pedido, Carrinho, Produto, Oferta…), as regras de negócio (normalizar um
// pedido, validar uma avaliação, o nome público do cliente) e os erros que o
// negócio conhece (sem estoque, produto inexistente…).
//
// A regra de dependência: este pacote NÃO importa banco (pgx, mongo, redis),
// nem HTTP, nem nenhum outro pacote do projeto. Tudo depende dele; ele não
// depende de nada. O teste internal/app/arquitetura_test.go confere isso.
//
// As etiquetas `json:"…"` ficam aqui de propósito: são metadados (não uma
// dependência) e mantêm a resposta da API igual à de antes da refatoração.
package dominio
