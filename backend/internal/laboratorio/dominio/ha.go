package dominio

// Laboratório de Alta Disponibilidade (Fase 5, docs/09). Três clusters SÓ DE
// LABORATÓRIO (perfil ha do compose): PostgreSQL com Patroni, MongoDB em
// replica set de 3 nós e Redis com Sentinel. O ensaio é o mesmo nos três: um
// escritor grava a cada 100 ms; depois de 3 s o laboratório derruba o líder
// (ou pede uma troca planejada) e o escritor segue até o cluster voltar.

var Tecnologias = []string{"patroni", "mongo", "redis"}

type Membro struct {
	Nome   string   `json:"nome"`
	Papel  string   `json:"papel"`  // líder / réplica / síncrona / fora
	Estado string   `json:"estado"` // como a ferramenta descreve
	Atraso *float64 `json:"atraso,omitempty"`
}

type EstadoCluster struct {
	Tecnologia string   `json:"tecnologia"`
	Disponivel bool     `json:"disponivel"`
	Erro       string   `json:"erro,omitempty"`
	Lider      string   `json:"lider"`
	Membros    []Membro `json:"membros"`
	Detalhe    string   `json:"detalhe,omitempty"` // ex.: synchronous_mode, quórum
}

type Ponto struct {
	T     float64 `json:"t"` // segundos desde o início
	OK    int     `json:"ok"`
	Falha int     `json:"falha"`
}

type Evento struct {
	T     float64 `json:"t"`
	Texto string  `json:"texto"`
}

type Ensaio struct {
	Tecnologia  string   `json:"tecnologia"`
	Acao        string   `json:"acao"`     // queda | planejada
	Garantia    bool     `json:"garantia"` // synchronous_mode / w: majority / WAIT 1
	Rodando     bool     `json:"rodando"`
	Fase        string   `json:"fase"`
	Erro        string   `json:"erro,omitempty"`
	LiderAntes  string   `json:"lider_antes"`
	LiderDepois string   `json:"lider_depois"`
	Tentativas  int      `json:"tentativas"`
	Confirmadas int      `json:"confirmadas"`
	Perdidas    int      `json:"perdidas"` // confirmadas que não estão mais lá (RPO)
	ForaMS      float64  `json:"fora_ms"`  // maior intervalo sem escrita depois da ação (RTO)
	AcaoEm      float64  `json:"acao_em"`  // segundo em que a ação foi disparada
	Pontos      []Ponto  `json:"pontos"`   // agregados a cada 0,5 s
	Eventos     []Evento `json:"eventos"`
}

// MaiorIntervalo: o maior buraco entre dois sucessos seguidos a partir da
// ação — o tempo em que a aplicação não conseguiu escrever.
func MaiorIntervalo(sucessos []float64, desde float64) float64 {
	maior := 0.0
	for i := 1; i < len(sucessos); i++ {
		if sucessos[i] < desde {
			continue
		}
		maior = max(maior, sucessos[i]-sucessos[i-1])
	}
	return maior
}
