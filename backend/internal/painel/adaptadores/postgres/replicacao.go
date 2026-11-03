package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/painel/dominio"
)

// Replicacao implementa portas.Replicacao: as duas pontas da replicação — o
// que o PRIMÁRIO vê sair (pg_stat_replication, slots, arquivamento) e o que a
// RÉPLICA vê chegar (pg_stat_wal_receiver, último WAL reaplicado). docs/08.
type Replicacao struct {
	primario *pgxpool.Pool
	replica  *pgxpool.Pool // nil = sem réplica
}

func NovaReplicacao(primario, replica *pgxpool.Pool) *Replicacao {
	return &Replicacao{primario: primario, replica: replica}
}

func (h *Replicacao) Estado(ctx context.Context) (dominio.EstadoReplicacao, error) {
	var e dominio.EstadoReplicacao
	if err := h.primario.QueryRow(ctx, `SELECT pg_current_wal_lsn()::text,
		current_setting('synchronous_standby_names'), current_setting('synchronous_commit')`).
		Scan(&e.LSNAtual, &e.SyncNomes, &e.SyncPadrao); err != nil {
		return e, err
	}

	// *_lag: quanto tempo o primário espera entre gerar o WAL e a réplica
	// confirmar cada estágio. Fica NULL quando não há tráfego (nada a esperar).
	rows, err := h.primario.Query(ctx, `
		SELECT application_name, coalesce(client_addr::text, 'socket'), state, sync_state,
		       coalesce(sent_lsn::text, ''), coalesce(write_lsn::text, ''), coalesce(flush_lsn::text, ''), coalesce(replay_lsn::text, ''),
		       coalesce(pg_wal_lsn_diff(sent_lsn, replay_lsn), 0)::bigint,
		       extract(epoch FROM write_lag) * 1000, extract(epoch FROM flush_lag) * 1000, extract(epoch FROM replay_lag) * 1000
		  FROM pg_stat_replication ORDER BY application_name`)
	if err != nil {
		return e, err
	}
	if e.Replicas, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (dominio.ReplicaVista, error) {
		var v dominio.ReplicaVista
		err := row.Scan(&v.Nome, &v.Endereco, &v.Estado, &v.Sincronismo, &v.Enviado, &v.Gravado, &v.Duravel, &v.Aplicado,
			&v.AtrasoBytes, &v.AtrasoGrav, &v.AtrasoDur, &v.AtrasoApl)
		return v, err
	}); err != nil {
		return e, err
	}

	// dominio.Slot: quanto WAL o primário está SEGURANDO por causa dele.
	rows, err = h.primario.Query(ctx, `
		SELECT slot_name, active, coalesce(wal_status, ''),
		       coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint,
		       coalesce(invalidation_reason, '')
		  FROM pg_replication_slots ORDER BY slot_name`)
	if err != nil {
		return e, err
	}
	if e.Slots, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (dominio.Slot, error) {
		var s dominio.Slot
		err := row.Scan(&s.Nome, &s.Ativo, &s.EstadoWAL, &s.RetidoBytes, &s.Invalidado)
		return s, err
	}); err != nil {
		return e, err
	}

	if err := h.primario.QueryRow(ctx, `
		SELECT current_setting('archive_mode'), archived_count, coalesce(last_archived_wal, ''),
		       coalesce(to_char(last_archived_time, 'DD/MM HH24:MI:SS'), ''), failed_count,
		       CASE WHEN last_failed_time > coalesce(last_archived_time, '-infinity')
		            THEN last_failed_wal || ' em ' || to_char(last_failed_time, 'DD/MM HH24:MI:SS') ELSE '' END
		  FROM pg_stat_archiver`).Scan(&e.Arquivamento.Modo, &e.Arquivamento.Arquivados, &e.Arquivamento.UltimoWAL,
		&e.Arquivamento.UltimoEm, &e.Arquivamento.Falhas, &e.Arquivamento.UltimaFalha); err != nil {
		return e, err
	}

	if h.replica == nil {
		e.ReplicaErro = "sem réplica configurada (POSTGRES_REPLICA_URL)"
		return e, nil
	}
	// O lado da réplica. Se ela estiver fora, o painel mostra o erro em vez
	// de falhar inteiro: é justamente quando o DBA mais precisa dele.
	var l dominio.LadoReplica
	err = h.replica.QueryRow(ctx, `
		SELECT pg_is_in_recovery(),
		       coalesce(pg_last_wal_receive_lsn()::text, ''), coalesce(pg_last_wal_replay_lsn()::text, ''),
		       coalesce(to_char(pg_last_xact_replay_timestamp(), 'DD/MM HH24:MI:SS'), ''),
		       coalesce((SELECT status FROM pg_stat_wal_receiver), 'parado'),
		       coalesce((SELECT sender_host FROM pg_stat_wal_receiver), ''),
		       coalesce((SELECT slot_name FROM pg_stat_wal_receiver), ''),
		       extract(epoch FROM now() - pg_last_xact_replay_timestamp())`).
		Scan(&l.EmRecuperacao, &l.Recebido, &l.Aplicado, &l.UltimaTransac, &l.Receptor, &l.Origem, &l.SlotUsado, &l.AtrasoS)
	if err != nil {
		e.ReplicaErro = err.Error()
		return e, nil
	}
	e.Replica = &l
	return e, nil
}
