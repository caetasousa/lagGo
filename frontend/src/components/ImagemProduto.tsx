// "Foto" do produto gerada (SVG): ícone da categoria sobre um gradiente cuja
// cor vem do nome. Sem imagens externas — o catálogo é fictício.

const ICONES: Record<string, string> = {
  Notebooks: '💻', Monitores: '🖥️', Periféricos: '⌨️', Celulares: '📱', Áudio: '🎧',
  Cozinha: '🍳', Móveis: '🛋️', Masculino: '👕', Feminino: '👗', Ficção: '📖',
  'Bancos de Dados': '🗄️', Programação: '👩‍💻',
}

function matiz(texto: string) {
  let h = 0
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function iconeCategoria(categoria: string) {
  return ICONES[categoria] ?? '📦'
}

export function ImagemProduto({ nome, categoria }: { nome: string; categoria: string }) {
  const h = nome.startsWith('Console') ? 280 : matiz(categoria + nome.slice(0, 3))
  const id = `g${matiz(nome)}${nome.length}`
  return (
    <svg className="imagem-produto" viewBox="0 0 400 300" role="img" aria-label={`Imagem ilustrativa de ${nome}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 70% 92%)`} />
          <stop offset="1" stopColor={`hsl(${(h + 40) % 360} 60% 80%)`} />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#${id})`} />
      <text x="200" y="175" textAnchor="middle" fontSize="110">{nome.startsWith('Console') ? '🎮' : iconeCategoria(categoria)}</text>
    </svg>
  )
}
