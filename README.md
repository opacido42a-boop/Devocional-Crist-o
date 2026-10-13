# Espaço Liminar — Devocional Cristão

Um espaço quieto, com estética de **espaço liminar** (corredores vazios, luz
fluorescente suave, silêncio), para ler, grifar e meditar no **Livro de Salmos
inteiro**.

## O que tem aqui

- **Os 150 Salmos completos** — 2.461 versículos, texto da Almeida Revista e
  Corrigida (ARC), em `js/psalms-data.js` (gerado a partir de
  [thiagobodruk/bible](https://github.com/thiagobodruk/bible), MIT).
- **Categorias por sentimento** — cada Salmo mora em uma ou mais “salas”:
  Culpa & arrependimento · Coragem & medo · Bálsamo & restauração ·
  Ansiedade & paz · Gratidão & louvor · Luto, espera & esperança ·
  Proteção & refúgio · Justiça & confiança · Solidão & presença ·
  Sabedoria & caminho. Curadoria em `js/data.js` (`PSALM_CATS`), com
  60 versículos-âncora (6 por sala) na página **Por sentimento**.
- **Explicações dos clássicos** — 28 Salmos famosos (1, 8, 19, 23, 27, 32,
  34, 37, 40, 42, 46, 51, 63, 84, 90, 91, 100, 103, 116, 121, 126, 127,
  130, 131, 139, 145, 147, 150) trazem um textinho “em palavras simples”
  + *quando ler*.
- **Marca-texto** — azul, lilás, verde e amarelo (+ borracha). Dentro do
  Salmo, escolha a cor e toque no versículo para grifar.
- **Marcar como lido** — com barra de progresso (x / 150) no topo.
- **Reflexões** — caderno ao fim de cada Salmo, com perguntas-guia;
  tudo reunido no **Diário**, com exportação em Markdown (`.md`).
- **Salmo do dia** e **continuar de onde parou**.
- Busca por número, palavra ou trecho (ex.: “nada me faltará”).
- **Trilha ambiente** — player na barra superior com quatro trilhas
  **generativas e originais**, sintetizadas no próprio navegador (Web Audio
  API; nenhum arquivo de áudio): *jazz noturno*, *louvor sereno*,
  *acústico calmo* e *sala & chuva*. Cada vez que toca, a trilha nasce com
  outra semente, então nunca soa igual duas vezes. O som começa só com um
  toque seu.
- **Slideshow no Início** — imagens liminares (corredor, capela, escadaria,
  jardim e quarto) trocando devagar, em loop contínuo. Respeita a opção
  “reduzir movimento” do sistema.

Tudo (lidos, grifos, reflexões) é salvo **apenas no navegador**
(`localStorage`) — sem conta, sem servidor, sem nuvem.

## Como rodar

É um site estático, sem build:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify…).

## Estrutura

```
index.html          páginas (Início · Salmos · Leitura · Por sentimento · Diário)
css/styles.css      estética liminar
js/psalms-data.js   os 150 Salmos (texto integral ARC)
js/data.js          categorias, títulos, explicações e versículos-âncora
js/app.js           leitura, grifos, reflexões, progresso (localStorage)
js/ambiente.js     trilhas generativas (Web Audio), player e slideshow do Início
assets/             imagens liminares (corredor, capela, escadaria, jardim, quarto)
```
