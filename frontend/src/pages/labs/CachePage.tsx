import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { post, type ResultadoLabCache } from '../../api/client'
import { Barras } from '../../components/Graficos'
import { Banco, Conceito, Conclusao, Explicacao, SobreOpcao, Stat, Titulo, bytes, ms } from '../../components/ui'
import { Ficha } from '../../components/usos'
import { Fontes } from '../../components/fontes'
import { TutorialCache } from '../../components/tutoriais'

// Laboratório de Cache (Fase 4, tópico 8.8).

export function CachePage() {
  const [leituras, setLeituras] = useState(200)
  const rodar = useMutation({ mutationFn: () => post<ResultadoLabCache>('/lab/cache', { leituras }) })
  const r = rodar.data
  return (
    <section>
      <p className="small"><Link to="/labs">← Laboratórios</Link></p>
      <Titulo titulo="Laboratório de Cache" />
      <Explicacao frase={<>O mesmo produto lido muitas vezes: direto do <strong>MongoDB</strong> e pelo <strong>cache no Redis</strong>. A primeira leitura com cache é uma "falha" (vai ao banco e guarda a cópia); as seguintes são "acertos".</>}
                  topico="8.8" doc="docs/07-nosql.md (Redis) · docs/fases/fase-3.md">
        <p><strong>Cache-aside:</strong> <code>GET cache:produto:id</code>; se não existir, lê o MongoDB e faz <code>SET … EX 300</code>. A cópia expira sozinha em 5 minutos (TTL) e é apagada quando o produto muda.</p>
        <p>O cache troca <em>consistência</em> por <em>velocidade</em>: a cópia pode ficar velha até expirar. Por isso a loja nunca põe preço e estoque em cache.</p>
      </Explicacao>
      <Conceito>
        <p>Um <strong>cache</strong> é uma cópia de um dado num lugar mais rápido. Aqui: o documento do produto (que mora no MongoDB) copiado na memória do Redis, para a página do produto não ir ao MongoDB a cada visita.</p>
        <p>O padrão usado é o <strong>cache-aside</strong> ("cache ao lado"): a aplicação cuida de tudo, os bancos não sabem um do outro.</p>
        <ol>
          <li><strong>Procura no cache:</strong> <code>GET cache:produto:{'{id}'}</code>.</li>
          <li><strong>Achou (acerto / hit)?</strong> Usa a cópia. Fim.</li>
          <li><strong>Não achou (falha / miss)?</strong> Lê do MongoDB e guarda a cópia por 5 minutos: <code>SET cache:produto:{'{id}'} … EX 300</code>.</li>
          <li><strong>Quando o produto muda</strong> (entra uma avaliação), a cópia é apagada (<code>DEL</code>): a próxima leitura é uma falha e busca a versão nova.</li>
        </ol>
        <p>O preço do cache é a <strong>consistência</strong>: entre a mudança e a invalidação, a cópia pode estar velha. Por isso preço e estoque <em>nunca</em> vão para o cache — vêm sempre do PostgreSQL.</p>
      </Conceito>
      <TutorialCache />
      <Ficha usos={['redis-cache', 'mongo-catalogo']}>
        Este laboratório testa SÓ o uso do Redis como cache de produto. Ele lê o mesmo produto N vezes direto do MongoDB e depois N vezes pelo cache-aside, começando com o cache vazio.
      </Ficha>
      <Ficha titulo="O Redis neste projeto: 5 usos diferentes" usos={['redis-cache', 'redis-carrinho', 'redis-ranking', 'redis-rate-limit', 'redis-stream']}>
        O mesmo Redis guarda dados com estruturas e tempos de vida diferentes, separados pelo prefixo da chave. O Painel do DBA → MongoDB e Redis mostra quantas chaves há de cada um.
      </Ficha>
      <SobreOpcao titulo="Comparar" conceito="Fase 1: N leituras do documento direto no MongoDB (FindOne + conversão para JSON). Fase 2: apaga a chave e faz N leituras pelo cache-aside — a primeira é falha, as outras são acertos."
                  comando={`fase 1:  N × db.produtos.findOne({ _id })
fase 2:  DEL cache:produto:{id}
         N × GET cache:produto:{id}  →  (falha) findOne + SET … EX 300`}
                  espere="1 falha e N−1 acertos; a leitura típica (p50) com cache bem mais rápida. Repare que o p95 também cai: o cache reduz a variação."
                  fontes={['aws_cache', 'redis_strings', 'redis_expire', 'mongo_findone']} />

      <div className="form-linha">
        <label>Leituras <input type="number" min={10} max={2000} step={50} value={leituras} onChange={(e) => setLeituras(Number(e.target.value))} /></label>
        <button className="primario" disabled={rodar.isPending} onClick={() => rodar.mutate()}>{rodar.isPending ? 'Lendo…' : 'Comparar'}</button>
        <Banco nome="MongoDB" /> <Banco nome="Redis" />
      </div>
      {rodar.isError && <p className="error">{rodar.error.message}</p>}
      {r && (
        <>
          <Conclusao tipo="boa" titulo={`Com cache, a leitura típica caiu de ${ms(r.sem_cache.p50_ms)} para ${ms(r.com_cache.p50_ms)} (${(r.sem_cache.p50_ms / Math.max(r.com_cache.p50_ms, 0.001)).toFixed(1)}× mais rápida).`}>
            {r.falhas} falha (a primeira leitura, que foi ao MongoDB) e {r.acertos} acertos. A cópia ocupa {bytes(r.bytes_no_redis)} no Redis e expira em {r.ttl_segundos} s.
          </Conclusao>
          <dl className="stats">
            <Stat rotulo="Produto" valor={<span className="small">{r.produto}</span>} />
            <Stat rotulo="Direto no MongoDB (p50 / p95)" valor={`${ms(r.sem_cache.p50_ms)}`} detalhe={`p95 ${ms(r.sem_cache.p95_ms)}`} />
            <Stat rotulo="Com cache (p50 / p95)" valor={`${ms(r.com_cache.p50_ms)}`} detalhe={`p95 ${ms(r.com_cache.p95_ms)}`} />
            <Stat rotulo="Acertos / falhas" valor={`${r.acertos} / ${r.falhas}`} />
          </dl>
          <div className="graficos">
            <Barras titulo={`Tempo total de ${r.sem_cache.leituras} leituras (ms)`} unidade="ms" dados={[
              { nome: 'MongoDB direto', v: r.sem_cache.total_ms, cor: 'var(--serie-1)' },
              { nome: 'Redis (cache)', v: r.com_cache.total_ms, cor: 'var(--serie-2)' }]} />
          </div>
        </>
      )}

      <Fontes doc="07-nosql" ids={['aws_cache', 'redis_strings', 'redis_expire', 'redis_eviction', 'redis_hashes', 'redis_sorted_sets', 'redis_streams', 'redis_incr',
        'mongo_findone', 'latencias', 'memcache_fb']} />
    </section>
  )
}
