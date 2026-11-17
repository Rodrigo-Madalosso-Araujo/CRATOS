#!/bin/sh
# CRATOS 2.0 — gera os PNGs de src/icones a partir dos SVGs desta pasta (fonte única).
# Requer rsvg-convert (librsvg). Rodar a partir da raiz do projeto: sh marca/gerar-icones.sh
set -e
D="$(dirname "$0")"; O="$D/../src/icones"
for s in 48 96 128; do rsvg-convert -w $s -h $s "$D/icone-chapa.svg" -o "$O/cratos-$s.png"; done
for s in 16 32; do
  rsvg-convert -w $s -h $s "$D/raio-chapa.svg" -o "$O/cratos-$s.png"
  rsvg-convert -w $s -h $s "$D/raio-barra-escura.svg" -o "$O/cratos-barra-escura-$s.png"
  rsvg-convert -w $s -h $s "$D/raio-barra-clara.svg" -o "$O/cratos-barra-clara-$s.png"
done
cp "$D/emblema.svg" "$O/cratos-emblema.svg"
echo "ícones gerados em $O"
