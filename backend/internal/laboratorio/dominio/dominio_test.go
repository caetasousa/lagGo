package dominio

import (
	"testing"
	"time"
)

// O buraco que ATRAVESSA a ação conta inteiro (do último sucesso antes dela
// ao primeiro depois); buracos antes da ação não contam.
func TestMaiorIntervaloConsideraSoDepoisDaAcao(t *testing.T) {
	sucessos := []float64{0, 0.1, 2.9, 7.7, 7.8, 9, 9.1}
	if got := MaiorIntervalo(sucessos, 3); got < 4.79 || got > 4.81 {
		t.Fatalf("indisponibilidade depois da ação em 3 s = %v, esperado 4,8 (de 2,9 a 7,7)", got)
	}
	if got := MaiorIntervalo([]float64{0, 2, 2.1, 3.1, 3.2}, 3); got < 0.99 || got > 1.01 {
		t.Fatalf("o buraco de 0 a 2 (antes da ação) não deveria contar: %v", got)
	}
}

func TestPercentilEMedidas(t *testing.T) {
	lat := []time.Duration{1 * time.Millisecond, 2 * time.Millisecond, 3 * time.Millisecond, 4 * time.Millisecond, 100 * time.Millisecond}
	if p := Percentil(lat, 0.5); p != 3 {
		t.Fatalf("p50 = %v, esperado 3 ms", p)
	}
	if m := Medir(lat); m.Leituras != 5 || m.TotalMS != 110 || m.P95MS != 4 {
		t.Fatalf("medidas = %+v", m)
	}
}

func TestValidacoesDosLaboratorios(t *testing.T) {
	for nome, err := range map[string]error{
		"modo de replicação":   ValidarReplicacao("talvez", 10),
		"transações demais":    ValidarReplicacao("local", 500),
		"fillfactor estranho":  ValidarAcaoMVCC("recriar", 50),
		"ação de MVCC":         ValidarAcaoMVCC("apagar_tudo", 0),
		"tipo de backup":       ValidarTipoDeBackup("semanal"),
		"modo de conexão":      ValidarConexoes("magia", 5, 1),
		"ajuste do planejador": ValidarAjustes("", map[string]string{"shared_buffers": "1GB"}),
	} {
		if err == nil {
			t.Errorf("%s deveria ser recusado", nome)
		}
	}
	if _, err := LinhasEsperadasNoAlvo("ontem"); err == nil {
		t.Error("alvo do PITR inválido deveria ser recusado")
	}
}
