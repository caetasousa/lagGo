// Package migrations embute os arquivos SQL de migração no binário da API.
// Formato: goose (https://pressly.github.io/goose/). Crie uma nova com:
//
//	make migration name=cria_tabela_clientes
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
