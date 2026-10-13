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
- **Trilha sonora ao vivo** — quatro músicas originais, geradas no próprio
  navegador (sem arquivos de áudio): **Jazz**, **Louvor sereno**,
  **Acústico calmo** e **Sala & chuva**, com player na barra do topo.
- **Imagens que passam** no menu principal — um slideshow contínuo de
  espaços liminares (corredor, escadaria, capela, jardim e quarto), cada um
  com o versículo de um Salmo.

Tudo (lidos, grifos, reflexões) é salvo **apenas no navegador**
(`localStorage`) — sem conta, sem servidor, sem nuvem.

## Trilha sonora (player)

O botão **♪ Trilha** (barra do topo) e o botão **Ouvir a trilha** (menu
principal) abrem/controlam o player: anterior · tocar/pausar · próxima,
volume e a lista das quatro faixas. A faixa e o volume escolhidos ficam
salvos no navegador (`espaco-liminar-ambiente-v1`).

| Faixa | O que é |
|---|---|
| 🎷 **Jazz** | trio de madrugada: piano elétrico (FM), contrabaixo caminhando e vassourinhas em andamento lento; de vez em quando, um solo de vibrafone |
| 🕊️ **Louvor sereno** | pads em acordes abertos, piano macio com eco em colcheia pontuada e sinos ao longe |
| 🎸 **Acústico calmo** | violão dedilhado (corda sintetizada por Karplus–Strong, afinada com precisão), melodia simples que volta variada e harmônicos |
| 🌧️ **Sala & chuva** | chuva na vidraça, zumbido baixo de uma sala vazia, trovão distante e um piano em outro cômodo |

Como funciona, em `js/ambiente.js`:

- **Tudo é síntese em tempo real** (Web Audio API): nenhum arquivo de áudio é
  baixado. As músicas são **geradas**, então nenhuma execução soa igual à
  outra (a semente muda a cada vez que a faixa começa).
- Um agendador olha ~1,8 s à frente e só cria as notas que vão tocar logo em
  seguida; os nós de áudio são desmontados quando terminam, então a
  reprodução pode durar horas sem acumular memória.
- Cadeia final comum: passa-altas → compressor suave → limitador → volume.
  As quatro faixas foram niveladas em torno de **−17 LUFS** (medido em
  renderização offline), então trocar de faixa não dá susto no volume.
- **Os navegadores só liberam áudio depois de um clique**: por isso nada
  toca sozinho; a música começa quando a pessoa aperta *tocar*. Trocar de faixa
  faz um *crossfade*, e pausar suspende o relógio de áudio (poupa bateria).
- Se o navegador não tiver Web Audio, os botões do player somem.

API para quem quiser mexer (`window.Ambiente`):

```js
Ambiente.play("jazz");        // jazz | louvor | acustico | chuva (precisa de um gesto do usuário)
Ambiente.pause(); Ambiente.next(); Ambiente.prev();
Ambiente.setVolume(0.5);      // 0–1
Ambiente.on((e) => console.log(e)); // { playing, track, volume, supported, error }
Ambiente.renderOffline("chuva", 60, { seed: 1 }); // Promise<AudioBuffer> — testes e medições
```

## Imagens do menu principal

O hero da página **Início** é um slideshow contínuo (`js/slideshow.js`):
a imagem nova entra *por cima* da anterior, com uma aproximação lenta, a cada
~8 s. Ele **pausa sozinho** quando o menu sai da tela ou a aba fica em
segundo plano, tem botão de pausa (lembrado no navegador), pontinhos para
escolher a imagem e respeita `prefers-reduced-motion`. Só a primeira imagem
vem com a página; as outras são baixadas depois do carregamento.

| Imagem | Versículo da legenda |
|---|---|
| `liminal-corridor.jpg` — corredor | Sl 119:105 |
| `liminal-staircase.jpg` — escadaria | Sl 121:1 |
| `liminal-chapel.jpg` — capela | Sl 122:1 |
| `liminal-garden.jpg` — jardim | Sl 23:2 |
| `liminal-room.jpg` — quarto | Sl 4:8 |

> **Créditos das imagens:** a escadaria, a capela e o jardim foram **geradas
> por IA** (1376×768, foto analógica 35 mm, bege dessaturado, simetria, sem
> pessoas) para combinar com o corredor e o quarto. Os versículos das legendas
> vêm do próprio `js/psalms-data.js` (ARC).

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
js/ambiente.js      motor das trilhas generativas (Web Audio): jazz, louvor sereno, acústico calmo, sala & chuva
js/player.js        player de música (botão na barra do topo + painel; faixa e volume salvos)
js/slideshow.js     slideshow contínuo do menu principal (legenda com versículo, pausa, pontinhos)
assets/             imagens liminares (corredor, escadaria, capela, jardim e quarto)
```
