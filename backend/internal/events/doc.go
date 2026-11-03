// Package events — histórico de navegação e eventos (Fase 7).
//
// Banco: Cassandra (wide-column). Tabela modelada por consulta:
// eventos_por_usuario, particionada por (usuario_id, dia). Veja docs/07-nosql.md.
package events
