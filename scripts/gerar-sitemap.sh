#!/usr/bin/env bash
# Gera o sitemap.xml com o lastmod REAL de cada pagina: a data do ultimo
# commit que mexeu no index.html dela (nao uma data fixa).
# /agendar/ fica de fora de proposito (tem noindex).
# Uso: scripts/gerar-sitemap.sh   (na raiz do repositorio)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="https://alessandramassagista.com"
# caminho | arquivo da pagina | changefreq | priority
PAGINAS=(
  "/|index.html|weekly|1.0"
  "/massagem-relaxante/|massagem-relaxante/index.html|monthly|0.9"
  "/massagem-tantrica/|massagem-tantrica/index.html|monthly|0.9"
  "/massagem-nuru/|massagem-nuru/index.html|monthly|0.9"
  "/massagem-lingam/|massagem-lingam/index.html|monthly|0.9"
  "/massagem-mix/|massagem-mix/index.html|monthly|0.9"
  "/spa-dos-pes/|spa-dos-pes/index.html|monthly|0.9"
  "/massagem-para-casais/|massagem-para-casais/index.html|monthly|0.9"
)

# imagens da pagina inicial (bloco image:image preservado do sitemap anterior)
IMAGENS_HOME='    <image:image>
      <image:loc>'$BASE'/assets/img/alessandra-retrato.jpeg</image:loc>
      <image:title>Alessandra, massagista em Belo Horizonte</image:title>
      <image:caption>Massagista no bairro Carlos Prates, Belo Horizonte</image:caption>
    </image:image>
    <image:image>
      <image:loc>'$BASE'/assets/img/alessandra-espaco.webp</image:loc>
      <image:title>Espaço de massagem no bairro Carlos Prates</image:title>
      <image:caption>Ambiente reservado para massagem em Belo Horizonte</image:caption>
    </image:image>
    <image:image>
      <image:loc>'$BASE'/assets/img/tantrica-casais.jpg</image:loc>
      <image:title>Sessão tântrica para casais em Belo Horizonte</image:title>
    </image:image>
    <image:image>
      <image:loc>'$BASE'/assets/img/spa-pes.jpg</image:loc>
      <image:title>Spa dos pés em Belo Horizonte</image:title>
    </image:image>
    <image:image>
      <image:loc>'$BASE'/assets/img/momento-4.jpg</image:loc>
      <image:title>Alessandra, massagista no Carlos Prates</image:title>
    </image:image>
    <image:image>
      <image:loc>'$BASE'/assets/img/momento-6.jpg</image:loc>
      <image:title>Alessandra em ambiente descontraído, massagista em Belo Horizonte</image:title>
    </image:image>'

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
  echo '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
  for linha in "${PAGINAS[@]}"; do
    IFS='|' read -r caminho arquivo freq prio <<<"$linha"
    data=$(git log -1 --format=%cs -- "$arquivo" 2>/dev/null || true)
    [ -n "$data" ] || data=$(date +%F)   # arquivo ainda sem commit: hoje
    echo '  <url>'
    echo "    <loc>$BASE$caminho</loc>"
    echo "    <lastmod>$data</lastmod>"
    echo "    <changefreq>$freq</changefreq>"
    echo "    <priority>$prio</priority>"
    [ "$caminho" = "/" ] && echo "$IMAGENS_HOME"
    echo '  </url>'
  done
  echo '</urlset>'
} > sitemap.xml
echo "sitemap.xml gerado: $(grep -c '<loc>' sitemap.xml) paginas"
