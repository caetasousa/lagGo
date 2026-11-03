package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nosqlgo/marketplace/internal/laboratorio/dominio"
)

// Laboratório de Backup e PITR (Fase 5, docs/08).
//
// O pgBackRest roda DENTRO do container do PostgreSQL (é lá que estão os
// arquivos do cluster e o repositório). A API o dispara com
// COPY ... FROM PROGRAM, que executa um comando no servidor como o usuário do
// sistema "postgres" — um poder que só o SUPERUSUÁRIO tem. É exatamente por
// isso que a Fase 6 tira o superusuário da API: quem tem COPY FROM PROGRAM
// tem um shell no servidor. Aqui os comandos são FIXOS; nada que vem da
// requisição entra neles, só valores validados contra listas.

// Onde a instância restaurada vive: um diretório e uma porta à parte, no
// mesmo container. O primário da loja NUNCA é tocado (cenário T4).
const (
	dirPITR   = "/var/lib/postgresql/pitr"
	portaPITR = "5433"
)

type BackupLab struct {
	pool        *pgxpool.Pool
	urlPrimario string
	mu          sync.Mutex // pgBackRest e a instância do PITR: um de cada vez
}

func NovoBackup(pool *pgxpool.Pool, urlPrimario string) *BackupLab {
	return &BackupLab{pool: pool, urlPrimario: urlPrimario}
}

// programa executa um comando no servidor (COPY ... FROM PROGRAM) e devolve a
// saída, linha a linha. FORMAT csv com delimitador e aspas que nunca aparecem
// = cada linha chega intacta (o formato text interpretaria as barras "\").
func programa(ctx context.Context, conn *pgxpool.Conn, comando string) ([]string, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "CREATE TEMP TABLE saida (n serial, linha text) ON COMMIT DROP"); err != nil {
		return nil, err
	}
	// COPY não aceita parâmetro ($1): o comando vai como literal escapado.
	// Ele só contém texto fixo e valores validados (veja quem chama).
	literal := "'" + strings.ReplaceAll(comando, "'", "''") + "'"
	if _, err := tx.Exec(ctx, `COPY saida (linha) FROM PROGRAM `+literal+
		` WITH (FORMAT csv, DELIMITER E'\x1f', QUOTE E'\x1e')`); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, "SELECT coalesce(linha, '') FROM saida ORDER BY n")
	if err != nil {
		return nil, err
	}
	linhas, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	return linhas, tx.Commit(ctx)
}

// executar roda o comando e falha se ele não terminar com "codigo=0".
func (b *BackupLab) executar(ctx context.Context, comando string) ([]string, error) {
	conn, err := b.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	// A quebra de linha antes do código: a saída pode não terminar com uma
	// (o JSON do pgbackrest info, por exemplo).
	linhas, err := programa(ctx, conn, comando+"; c=$?; echo; echo codigo=$c")
	if err != nil {
		return nil, err
	}
	if len(linhas) == 0 || linhas[len(linhas)-1] != "codigo=0" {
		return linhas, fmt.Errorf("comando falhou: %s", strings.Join(linhas, " | "))
	}
	linhas = linhas[:len(linhas)-1]
	for len(linhas) > 0 && strings.TrimSpace(linhas[len(linhas)-1]) == "" {
		linhas = linhas[:len(linhas)-1]
	}
	return linhas, nil
}

// Info: o que há no repositório (pgbackrest info) + o arquivamento do WAL.
func (b *BackupLab) Info(ctx context.Context) (dominio.InfoBackup, error) {
	var info dominio.InfoBackup
	linhas, err := b.executar(ctx, "pgbackrest --stanza=main --output=json info 2>&1")
	if err != nil {
		return info, err
	}
	var bruto []struct {
		Status  struct{ Message string }    `json:"status"`
		Archive []struct{ Min, Max string } `json:"archive"`
		Backup  []struct {
			Label     string                       `json:"label"`
			Type      string                       `json:"type"`
			Reference []string                     `json:"reference"`
			Timestamp struct{ Start, Stop int64 }  `json:"timestamp"`
			Archive   struct{ Start, Stop string } `json:"archive"`
			Info      struct {
				Size       int64 `json:"size"`
				Delta      int64 `json:"delta"`
				Repository struct {
					Delta int64 `json:"delta"`
				} `json:"repository"`
			} `json:"info"`
		} `json:"backup"`
	}
	if err := json.Unmarshal([]byte(strings.Join(linhas, "\n")), &bruto); err != nil {
		return info, fmt.Errorf("lendo pgbackrest info: %w", err)
	}
	for _, s := range bruto {
		info.Status = s.Status.Message
		for _, a := range s.Archive {
			info.WALMin, info.WALMax = a.Min, a.Max
		}
		for _, x := range s.Backup {
			info.Backups = append(info.Backups, dominio.Backup{
				Rotulo: x.Label, Tipo: x.Type, Referencia: x.Reference,
				Inicio: time.Unix(x.Timestamp.Start, 0), Fim: time.Unix(x.Timestamp.Stop, 0),
				TamanhoBanco: x.Info.Size, Copiado: x.Info.Delta, NoRepo: x.Info.Repository.Delta,
				WALInicio: x.Archive.Start, WALFim: x.Archive.Stop,
			})
		}
	}
	// pg_stat_archiver: o archive_command está dando certo? (cenário T1)
	err = b.pool.QueryRow(ctx, `
		SELECT archived_count, failed_count, coalesce(last_archived_wal, ''),
		       CASE WHEN last_failed_time > coalesce(last_archived_time, '-infinity')
		            THEN last_failed_wal || ' em ' || to_char(last_failed_time, 'DD/MM HH24:MI:SS') ELSE '' END
		  FROM pg_stat_archiver`).Scan(&info.Arquivados, &info.FalhasWAL, &info.UltimoWAL, &info.UltimaFalha)
	return info, err
}

// FazerBackup: full, diff (desde o último full) ou incr (desde o último backup).
func (b *BackupLab) Fazer(ctx context.Context, tipo string) (dominio.ResultadoBackup, error) {
	r := dominio.ResultadoBackup{Tipo: tipo}
	b.mu.Lock()
	defer b.mu.Unlock()
	antes, err := b.Info(ctx)
	if err != nil {
		return r, err
	}
	inicio := time.Now()
	// tipo validado contra TiposBackup: entra no comando sem risco.
	if r.Saida, err = b.executar(ctx, "pgbackrest --stanza=main --type="+tipo+" --log-level-console=warn backup 2>&1"); err != nil {
		return r, err
	}
	r.Duracao = float64(time.Since(inicio).Microseconds()) / 1000
	if r.Info, err = b.Info(ctx); err != nil {
		return r, err
	}
	if n := len(r.Info.Backups); n > len(antes.Backups) || (n > 0 && (len(antes.Backups) == 0 || r.Info.Backups[n-1].Rotulo != antes.Backups[len(antes.Backups)-1].Rotulo)) {
		r.Novo = &r.Info.Backups[n-1]
	}
	return r, nil
}

// O instante-alvo vem do próprio PostgreSQL (clock_timestamp()::text). Mesmo
// assim é conferido antes de entrar no comando.
var instanteValido = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+[+-][0-9:]+$`)

// PITR ensaia a recuperação de um "DROP TABLE sem querer":
//
//  1. cria lab.pitr_clientes com o lote 1 (1.000 linhas);
//  2. grava o lote 2 (500 linhas);
//  3. o acidente: DROP TABLE;
//  4. fecha o segmento de WAL e espera ele ser arquivado;
//  5. restaura o último backup + o WAL até o ALVO numa instância À PARTE
//     (outro diretório, porta 5433) e a sobe;
//  6. conta as linhas lá, e desliga e apaga a instância.
//
// alvo "antes-do-drop": o instante logo antes do acidente (volta tudo: 1.500).
// alvo "antes-do-lote2": o instante entre os lotes (volta só o lote 1: 1.000).
// Escolher o alvo é escolher o que se aceita perder.
func (b *BackupLab) PITR(ctx context.Context, alvo string, esperadas int) (dominio.ResultadoPITR, error) {
	r := dominio.ResultadoPITR{Alvo: alvo, Lote1: dominio.LinhasDoLote1, Lote2: dominio.LinhasDoLote2, Esperadas: esperadas}
	b.mu.Lock()
	defer b.mu.Unlock()
	etapa := func(nome string, f func() (string, error)) error {
		inicio := time.Now()
		detalhe, err := f()
		r.Etapas = append(r.Etapas, dominio.EtapaPITR{Nome: nome, MS: float64(time.Since(inicio).Microseconds()) / 1000, Detalhe: detalhe})
		return err
	}
	// Sem nenhum backup não há de onde restaurar.
	info, err := b.Info(ctx)
	if err != nil {
		return r, err
	}
	if len(info.Backups) == 0 {
		if err := etapa("backup full (não havia nenhum)", func() (string, error) {
			_, err := b.executar(ctx, "pgbackrest --stanza=main --type=full --log-level-console=warn backup 2>&1")
			return "o PITR parte sempre de um backup físico", err
		}); err != nil {
			return r, err
		}
		if info, err = b.Info(ctx); err != nil {
			return r, err
		}
	}
	r.BackupUsado = info.Backups[len(info.Backups)-1].Rotulo

	marcar := func() (string, error) {
		var t string
		err := b.pool.QueryRow(ctx, "SELECT clock_timestamp()::text").Scan(&t)
		time.Sleep(300 * time.Millisecond) // o próximo COMMIT fica claramente DEPOIS do alvo
		return t, err
	}
	if err := etapa("lote 1", func() (string, error) {
		_, err := b.pool.Exec(ctx, `DROP TABLE IF EXISTS lab.pitr_clientes;
			CREATE TABLE lab.pitr_clientes (id int PRIMARY KEY, lote int NOT NULL, criado_em timestamptz NOT NULL DEFAULT clock_timestamp());
			INSERT INTO lab.pitr_clientes (id, lote) SELECT g, 1 FROM generate_series(1, 1000) g`)
		return "CREATE TABLE lab.pitr_clientes + 1.000 linhas", err
	}); err != nil {
		return r, err
	}
	if alvo == "antes-do-lote2" {
		if r.AlvoEm, err = marcar(); err != nil {
			return r, err
		}
	}
	if err := etapa("lote 2", func() (string, error) {
		_, err := b.pool.Exec(ctx, "INSERT INTO lab.pitr_clientes (id, lote) SELECT g, 2 FROM generate_series(1001, 1500) g")
		return "+500 linhas", err
	}); err != nil {
		return r, err
	}
	if alvo == "antes-do-drop" {
		if r.AlvoEm, err = marcar(); err != nil {
			return r, err
		}
	}
	if !instanteValido.MatchString(r.AlvoEm) {
		return r, fmt.Errorf("instante-alvo inesperado: %q", r.AlvoEm)
	}
	if err := etapa("o acidente", func() (string, error) {
		_, err := b.pool.Exec(ctx, "DROP TABLE lab.pitr_clientes")
		return "DROP TABLE lab.pitr_clientes — a réplica apaga junto em milissegundos: réplica não é backup", err
	}); err != nil {
		return r, err
	}
	if err := etapa("arquivar o WAL", func() (string, error) {
		// O DROP está no segmento de WAL atual, ainda aberto. pg_switch_wal()
		// fecha o segmento e o archive_command o leva ao repositório.
		var segmento string
		if err := b.pool.QueryRow(ctx, "SELECT pg_walfile_name(pg_switch_wal())").Scan(&segmento); err != nil {
			return "", err
		}
		prazo := time.Now().Add(30 * time.Second)
		for {
			var ultimo string
			if err := b.pool.QueryRow(ctx, "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver").Scan(&ultimo); err != nil {
				return "", err
			}
			if ultimo >= segmento {
				return "segmento " + segmento + " arquivado", nil
			}
			if time.Now().After(prazo) {
				return "", fmt.Errorf("o segmento %s não foi arquivado em 30 s (archive_command falhando? veja o painel)", segmento)
			}
			time.Sleep(200 * time.Millisecond)
		}
	}); err != nil {
		return r, err
	}

	// A partir daqui a instância à parte pode existir: desligar e apagar SEMPRE.
	defer func() {
		_, _ = b.executar(context.WithoutCancel(ctx), "pg_ctl -D "+dirPITR+" -m fast stop >/dev/null 2>&1; rm -rf "+dirPITR)
	}()
	inicioRecuperacao := time.Now()
	if err := etapa("restaurar", func() (string, error) {
		// --target-action=promote: ao chegar no alvo, a instância sai da
		// recuperação e aceita conexões normais. --archive-mode=off: ela não
		// arquiva WAL no repositório do primário.
		_, err := b.executar(ctx, "rm -rf "+dirPITR+" && pgbackrest --stanza=main --log-level-console=warn --pg1-path="+dirPITR+
			` --type=time "--target=`+r.AlvoEm+`" --target-action=promote --archive-mode=off restore 2>&1`)
		return "pgbackrest restore --type=time --target=\"" + r.AlvoEm + "\" (backup " + r.BackupUsado + " + WAL)", err
	}); err != nil {
		return r, err
	}
	subiuEm := time.Now()
	if err := etapa("subir a instância restaurada", func() (string, error) {
		// Ninguém pode estar na porta: senão a conferência falaria com uma
		// instância velha (de um ensaio anterior) em vez desta.
		if _, err := b.executar(ctx, "! pg_isready -q -h 127.0.0.1 -p "+portaPITR); err != nil {
			return "", fmt.Errorf("já há uma instância na porta %s; desligue-a antes (pg_ctl -D %s stop)", portaPITR, dirPITR)
		}
		// Ela reaplica o WAL até o alvo (restore_command = pgbackrest archive-get).
		// hot_standby=off: sem isso ela aceitaria conexões NO MEIO da
		// recuperação (assim que ficasse consistente) e a contagem veria um
		// ponto qualquer entre o backup e o alvo. Desligado, o pg_ctl -w só
		// volta quando ela chegou ao alvo e foi promovida.
		_, err := b.executar(ctx, ": > /tmp/pitr.log; pg_ctl -D "+dirPITR+` -o "-p `+portaPITR+` -c listen_addresses=0.0.0.0 -c shared_buffers=32MB -c hot_standby=off" -l /tmp/pitr.log -w -t 120 start </dev/null >/dev/null 2>&1`)
		return "pg_ctl start na porta " + portaPITR + " (o primário continua na 5432); ela reaplica o WAL até o alvo e só então aceita conexões", err
	}); err != nil {
		return r, err
	}

	if err := etapa("conferir", func() (string, error) {
		u, err := url.Parse(b.urlPrimario)
		if err != nil {
			return "", err
		}
		u.Host = u.Hostname() + ":" + portaPITR
		// Com hot_standby=off ela recusa conexões (57P03) até terminar a
		// recuperação e ser promovida: tenta de novo até lá.
		var conn *pgx.Conn
		prazo := time.Now().Add(2 * time.Minute)
		for {
			conn, err = pgx.Connect(ctx, u.String())
			if err == nil {
				break
			}
			if time.Now().After(prazo) {
				return "", fmt.Errorf("a instância restaurada não terminou a recuperação em 2 min: %w", err)
			}
			time.Sleep(200 * time.Millisecond)
		}
		defer conn.Close(ctx)
		// RTO deste ensaio: do início do restore até a instância aceitar conexões.
		r.RecuperacaoMS = float64(time.Since(inicioRecuperacao).Microseconds()) / 1000
		// É mesmo a instância que acabou de subir, e ela já terminou a recuperação?
		var emRecuperacao bool
		var subiu time.Time
		if err := conn.QueryRow(ctx, "SELECT pg_is_in_recovery(), pg_postmaster_start_time()").Scan(&emRecuperacao, &subiu); err != nil {
			return "", err
		}
		if emRecuperacao || subiu.Before(subiuEm.Add(-time.Second)) {
			return "", fmt.Errorf("a instância da porta %s não é a recém-restaurada (em recuperação: %v, subiu em %s)", portaPITR, emRecuperacao, subiu)
		}
		if err := conn.QueryRow(ctx, "SELECT count(*) FROM lab.pitr_clientes").Scan(&r.Restauradas); err != nil {
			return "", err
		}
		return fmt.Sprintf("SELECT count(*) na instância restaurada = %d", r.Restauradas), nil
	}); err != nil {
		return r, err
	}
	err = b.pool.QueryRow(ctx, "SELECT to_regclass('lab.pitr_clientes') IS NOT NULL").Scan(&r.NoPrimario)
	return r, err
}
