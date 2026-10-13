/* Espaço Liminar — Devocional · trilhas sonoras generativas (js/ambiente.js)
   ───────────────────────────────────────────────────────────────────────────
   Quatro trilhas ORIGINAIS, compostas e sintetizadas ao vivo no navegador com a
   Web Audio API. Não há arquivos de áudio, amostras nem músicas de terceiros:
   a cada execução o motor sorteia tom, andamento, progressão e notas — por isso
   a trilha nunca se repete igual e o site continua sendo só HTML/CSS/JS.

     jazz      Jazz — trio de madrugada: piano elétrico, contrabaixo, vassourinhas e vibrafone
     louvor    Louvor sereno — pads de acordes abertos, piano macio com eco e sinos
     acustico  Acústico calmo — violão dedilhado (corda sintetizada) e harmônicos
     chuva     Sala & chuva — chuva na vidraça, zumbido da sala, trovão e um piano distante

   API pública: window.Ambiente (veja o fim do arquivo). A interface do player
   fica em js/player.js. Navegadores só liberam áudio depois de um gesto do
   usuário (clique/toque): por isso nada toca sozinho. */
(function (global) {
  "use strict";

  const AC = global.AudioContext || global.webkitAudioContext;
  const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;

  /* ═══ 1 · utilidades ══════════════════════════════════════════════════════ */
  const TAU = Math.PI * 2;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const lerp = (a, b, k) => a + (b - a) * k;
  // leva uma nota MIDI (ou classe de altura 0–11) para dentro da faixa [lo, hi], por oitavas
  const fitRange = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
  // nota MIDI com a classe de altura `pc` mais próxima de `ref`
  const nearestPc = (pc, ref) => ref + ((((pc - ref) % 12) + 18) % 12) - 6;

  // gerador pseudo-aleatório com semente (mulberry32): mesma semente, mesma música
  function makeRng(seed) {
    let s = seed >>> 0;
    const f = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      f,
      range: (a, b) => a + (b - a) * f(),
      int: (a, b) => a + Math.floor((b - a + 1) * f()),
      chance: (p) => f() < p,
      pick: (arr) => arr[Math.floor(f() * arr.length)],
      weighted(items, weights) {
        let sum = 0;
        for (const w of weights) sum += w;
        let r = f() * sum;
        for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
        return items[items.length - 1];
      },
      gauss() { let u = 0; while (u === 0) u = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * f()); },
      jitter(amt) { let u = 0; while (u === 0) u = f(); return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * f()), -2, 2) * amt; },
      exp: (mean) => -Math.log(1 - f()) * mean,
    };
  }
  const newSeed = () => ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0) || 1;

  /* ═══ 2 · síntese ═════════════════════════════════════════════════════════ */
  const caches = new WeakMap();
  function cacheOf(ctx) {
    let c = caches.get(ctx);
    if (!c) { c = {}; caches.set(ctx, c); }
    return c;
  }

  // ruído branco/rosa/marrom em loop sem "estalo" (emenda com fade de potência igual)
  function noiseBuffer(ctx, kind, secs, channels) {
    const c = cacheOf(ctx), key = "n:" + kind + ":" + secs + ":" + channels;
    if (c[key]) return c[key];
    const sr = ctx.sampleRate, n = Math.floor(secs * sr), xf = Math.floor(0.25 * sr);
    const buf = ctx.createBuffer(channels, n, sr);
    for (let ch = 0; ch < channels; ch++) {
      const r = makeRng(9001 + ch * 7919 + kind.length * 31), raw = new Float32Array(n + xf);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = r.f() * 2 - 1;
        if (kind === "white") raw[i] = w * 0.6;
        else if (kind === "pink") {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else { br = (br + 0.02 * w) / 1.02; raw[i] = br * 3.5; }
      }
      const out = buf.getChannelData(ch);
      out.set(raw.subarray(0, n));
      for (let i = 0; i < xf; i++) { const k = i / xf; out[i] = raw[i] * Math.sqrt(k) + raw[n + i] * Math.sqrt(1 - k); }
    }
    return (c[key] = buf);
  }

  // reverberação por convolução com uma resposta ao impulso sintética (cauda escura que decai)
  function makeReverb(ctx, dest, o) {
    const sr = ctx.sampleRate, n = Math.floor(sr * o.rt60 * 1.15), pre = Math.floor(sr * (o.pre || 0.014));
    const ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch), r = makeRng(1234 + ch * 977);
      let lp = 0, slow = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp((-6.9 * t) / o.rt60);
        lp += ((r.f() * 2 - 1) - lp) * lerp(0.85, o.dark, Math.min(1, t / o.rt60)); // mais escuro com o tempo
        slow += (lp - slow) * 0.012;                                                // tira os graves da cauda
        d[i] = (lp - slow) * env;
      }
    }
    const conv = ctx.createConvolver(), input = ctx.createGain(), wet = ctx.createGain();
    conv.buffer = ir;
    wet.gain.value = o.wet;
    input.connect(conv); conv.connect(wet); wet.connect(dest);
    return { input, conv, wet };
  }

  // canal de instrumento: [filtros] → [tremolo] → fader → (pan) → saída, com envio para o reverb
  function makeChannel(ctx, dest, rv, o, track) {
    o = o || {};
    const input = ctx.createGain();
    let tail = input;
    (o.filters || []).forEach((spec) => {
      const f = ctx.createBiquadFilter();
      f.type = spec[0]; f.frequency.value = spec[1]; f.Q.value = spec[2] == null ? 0.7 : spec[2];
      if (spec[3] != null) f.gain.value = spec[3];
      tail.connect(f); tail = f;
    });
    if (o.trem) { // tremolo de amplitude (rotor do vibrafone)
      const tg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      tg.gain.value = 1 - o.trem.depth / 2;
      lfo.frequency.value = o.trem.rate; lg.gain.value = o.trem.depth / 2;
      lfo.connect(lg); lg.connect(tg.gain); lfo.start();
      tail.connect(tg); tail = tg;
      if (track) track.srcs.push(lfo);
    }
    const fader = ctx.createGain();
    fader.gain.value = o.level == null ? 1 : o.level;
    tail.connect(fader);
    let outNode = fader;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = o.pan;
      fader.connect(p); outNode = p;
    }
    outNode.connect(dest);
    let send = null;
    if (rv && o.send > 0) { send = ctx.createGain(); send.gain.value = o.send; outNode.connect(send); send.connect(rv.input); }
    return { input, fader, send };
  }

  // liga `node` a `dest` com panorâmica opcional; devolve o último nó da cadeia
  function route(ctx, node, dest, pan) {
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p); p.connect(dest);
      return p;
    }
    node.connect(dest);
    return node;
  }
  // quando a fonte termina, solta os nós da cadeia (o grafo não acumula nós mortos)
  function done(src, ...nodes) {
    src.onended = () => { nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* já solto */ } }); };
  }

  /* ── vozes (cada função toca UMA nota no instante t) ───────────────────── */

  // piano elétrico (FM, estilo Rhodes): ataque brilhante que amacia no sustain
  function vEPiano(ctx, dest, t, midi, vel, dur, pan) {
    const f = mtof(midi), tau = 1.7 * Math.pow(0.5, (midi - 55) / 22), hold = Math.max(dur, 0.06), end = t + hold + 1.1;
    const car = ctx.createOscillator(), m1 = ctx.createOscillator(), m2 = ctx.createOscillator();
    const g1 = ctx.createGain(), g2 = ctx.createGain(), amp = ctx.createGain(), lp = ctx.createBiquadFilter();
    car.frequency.value = f; m1.frequency.value = f; m2.frequency.value = f * 14;
    const idx = f * (0.45 + vel * 1.3);
    g1.gain.setValueAtTime(idx, t); g1.gain.setTargetAtTime(idx * 0.12, t + 0.01, tau * 0.4);
    g2.gain.setValueAtTime(f * 9 * vel, t); g2.gain.setTargetAtTime(0, t + 0.002, 0.02);
    m1.connect(g1); g1.connect(car.frequency); m2.connect(g2); g2.connect(car.frequency);
    lp.type = "lowpass"; lp.frequency.value = 2200 + vel * 3500; lp.Q.value = 0.5;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.3 * vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.004, tau); amp.gain.setTargetAtTime(0, t + hold, 0.13);
    car.connect(amp); amp.connect(lp);
    const out = route(ctx, lp, dest, pan);
    car.start(t); m1.start(t); m2.start(t); car.stop(end); m1.stop(end); m2.stop(end);
    done(car, g1, g2, amp, lp, out);
  }

  // contrabaixo acústico: fundamental + 2º e 3º harmônicos (audível em alto-falantes pequenos) e sopro de dedo
  function vBass(ctx, dest, t, midi, vel, dur) {
    const f = mtof(midi), hold = Math.max(dur, 0.12), end = t + hold + 0.5;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = "triangle"; o2.type = "sine"; o3.type = "sine";
    o1.frequency.setValueAtTime(f * 1.012, t); o1.frequency.setTargetAtTime(f, t, 0.025);
    o2.frequency.setValueAtTime(f * 2.024, t); o2.frequency.setTargetAtTime(f * 2, t, 0.025);
    o3.frequency.value = f * 3;
    const g2 = ctx.createGain(), g3 = ctx.createGain(), lp = ctx.createBiquadFilter(), amp = ctx.createGain();
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.5 + 0.3 * vel, t + 0.008); g2.gain.setTargetAtTime(0, t + 0.008, 0.2);
    g3.gain.setValueAtTime(0, t); g3.gain.linearRampToValueAtTime(0.22 * vel, t + 0.006); g3.gain.setTargetAtTime(0, t + 0.006, 0.08);
    lp.type = "lowpass"; lp.frequency.value = 600 + vel * 500; lp.Q.value = 0.7;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.36 * vel, t + 0.01);
    amp.gain.setTargetAtTime(0, t + 0.01, 0.42); amp.gain.setTargetAtTime(0, t + hold * 0.9, 0.06);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(amp); amp.connect(dest);
    o1.start(t); o2.start(t); o3.start(t); o1.stop(end); o2.stop(end); o3.stop(end);
    const nz = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    nz.buffer = noiseBuffer(ctx, "white", 2, 1);
    nf.type = "bandpass"; nf.frequency.value = 650; nf.Q.value = 1.1;
    ng.gain.setValueAtTime(0.08 * vel, t); ng.gain.setTargetAtTime(0, t + 0.002, 0.012);
    nz.connect(nf); nf.connect(ng); ng.connect(dest);
    nz.start(t, 0.05 + (midi % 7) * 0.2, 0.06);
    done(o1, g2, g3, lp, amp, nf, ng);
  }

  // vibrafone: barras de metal com parciais 1 : 4 : 10 (o tremolo vem do canal)
  function vVibes(ctx, dest, t, midi, vel, pan) {
    const f = mtof(midi), tau = Math.min(2.4, 1.9 * Math.pow(0.55, (midi - 72) / 12));
    const sum = ctx.createGain();
    sum.gain.value = 0.34 * vel;
    let first = null, longest = 0;
    [[1, 1, 1], [4, 0.22, 0.28], [10.2, 0.05, 0.08]].forEach((p) => {
      if (f * p[0] > 14000) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), end = t + 0.003 + tau * p[2] * 7.5 + 0.05;
      o.frequency.value = f * p[0];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, tau * p[2]);
      o.connect(g); g.connect(sum); o.start(t); o.stop(end);
      if (end > longest) { longest = end; first = o; }
    });
    const out = route(ctx, sum, dest, pan);
    if (first) done(first, sum, out);
  }

  // piano macio: parciais com decaimento próprio (agudos morrem antes) + leve inarmonicidade
  function vSoftPiano(ctx, dest, t, midi, vel, dur, pan, brightness) {
    const f = mtof(midi), tau = 3.2 * Math.pow(0.5, (midi - 60) / 18), hold = Math.max(dur, 0.1), end = t + hold + 1.8;
    const amp = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = (brightness || 2400) + vel * 1800; lp.Q.value = 0.3;
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.5 * vel, t + 0.006);
    amp.gain.setTargetAtTime(0, t + hold, 0.3);
    let first = null;
    for (let k = 1; k <= 6; k++) {
      const fk = f * k * Math.sqrt(1 + 0.00025 * k * k);
      if (fk > 9000) break;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = fk;
      g.gain.setValueAtTime([1, 0.5, 0.26, 0.14, 0.08, 0.04][k - 1], t);
      g.gain.setTargetAtTime(0, t + 0.01, tau / (1 + 0.9 * (k - 1)));
      o.connect(g); g.connect(amp); o.start(t); o.stop(end);
      if (!first) first = o;
    }
    amp.connect(lp);
    const out = route(ctx, lp, dest, pan);
    done(first, amp, lp, out);
  }

  // sino / carrilhão (parciais inarmônicas de metal) — `pure` deixa só harmônicos puros (harmônico de violão)
  function vBell(ctx, dest, t, midi, vel, pan, pure) {
    const f = mtof(midi), tau = Math.min(3.2, 2.4 * Math.pow(0.6, (midi - 76) / 12));
    const sum = ctx.createGain();
    sum.gain.value = 0.3 * vel;
    let first = null, longest = 0;
    (pure ? [[1, 1, 1], [2, 0.12, 0.4]] : [[1, 1, 1], [2.756, 0.32, 0.45], [5.404, 0.12, 0.2], [8.933, 0.05, 0.1]]).forEach((p) => {
      if (f * p[0] > 12000) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), end = t + 0.003 + tau * p[2] * 7.5 + 0.05;
      o.frequency.value = f * p[0];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, tau * p[2]);
      o.connect(g); g.connect(sum); o.start(t); o.stop(end);
      if (end > longest) { longest = end; first = o; }
    });
    const out = route(ctx, sum, dest, pan);
    if (first) done(first, sum, out);
  }

  // pad de louvor: serras levemente desafinadas num passa-baixas que "respira" + oitava de triângulo
  function vPad(ctx, dest, t, midis, dur, o) {
    const end = t + dur + o.rel * 2.6 + 0.2, hold = Math.max(dur, o.atk + 0.05);
    const lp = ctx.createBiquadFilter(), amp = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    lp.type = "lowpass"; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(o.cutoff * 0.45, t);
    lp.frequency.setTargetAtTime(o.cutoff, t, o.atk / 2.5);
    lp.frequency.setTargetAtTime(o.cutoff * 0.5, t + hold, o.rel / 2);
    lfo.frequency.value = 0.07 + (midis[0] % 5) * 0.012; lg.gain.value = o.cutoff * 0.12;
    lfo.connect(lg); lg.connect(lp.frequency);
    amp.gain.setValueAtTime(0, t); amp.gain.setTargetAtTime(o.peak, t, o.atk / 3); amp.gain.setTargetAtTime(0, t + hold, o.rel / 3);
    // fundamental e quinta pesam mais: o pad ganha corpo no grave-médio em vez de ficar só nas vozes agudas
    const wts = midis.map((_, k) => (k === 0 ? 2.2 : k === 1 ? 1.6 : 0.6)), wsum = wts.reduce((a, b) => a + b, 0);
    midis.forEach((m, k) => {
      [-8, 0, 8].forEach((c) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = "sawtooth"; osc.frequency.value = mtof(m); osc.detune.value = c + (k % 2 ? 2 : -2);
        g.gain.value = wts[k] / (wsum * 3);   // a soma continua 1: só muda a divisão entre as vozes
        osc.connect(g); g.connect(lp); osc.start(t); osc.stop(end);
      });
      if (o.up && k >= midis.length - 2) { // um sopro de oitava acima nas vozes agudas
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = "triangle"; osc.frequency.value = mtof(m + 12); g.gain.value = 0.7 / (midis.length * 3);
        osc.connect(g); g.connect(lp); osc.start(t); osc.stop(end);
      }
    });
    lfo.start(t); lfo.stop(end);
    lp.connect(amp); amp.connect(dest);
    done(lfo, lg, lp, amp);
  }

  // sub-grave senoidal que sustenta a fundamental
  function vSub(ctx, dest, t, midi, dur, peak, atk, rel) {
    const o = ctx.createOscillator(), g = ctx.createGain(), hold = Math.max(dur, atk + 0.05), end = t + hold + rel * 2.6 + 0.2;
    o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(peak, t, atk / 3); g.gain.setTargetAtTime(0, t + hold, rel / 3);
    o.connect(g); g.connect(dest); o.start(t); o.stop(end); done(o, g);
  }

  /* ── violão: síntese de corda dedilhada (Karplus–Strong com afinação fracionária) ── */
  function ksBuffer(ctx, midi) {
    const c = cacheOf(ctx), key = "ks:" + midi;
    if (c[key]) return c[key];
    const sr = ctx.sampleRate, f = mtof(midi);
    const secs = clamp(4.4 - (midi - 38) * 0.055, 1.9, 4.4);   // graves soam mais tempo
    const n = Math.floor(secs * sr), out = new Float32Array(n);
    const target = sr / f - 0.5;                                // 0,5 amostra vem da média de 2 pontos
    let N = Math.floor(target), frac = target - N;
    if (frac < 0.1) { N -= 1; frac += 1; }
    const C = (1 - frac) / (1 + frac);                          // passa-tudo para a parte fracionária
    // excitação: ruído suave com posição da palheta (filtro em pente)
    const r = makeRng(4242 + midi * 13), noise = new Float32Array(N), line = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { prev += ((r.f() * 2 - 1) - prev) * 0.36; noise[i] = prev; }
    const P = Math.max(1, Math.floor(N * 0.17));
    let mean = 0, pw = 0;
    for (let i = 0; i < N; i++) { line[i] = noise[i] - noise[(i - P + N) % N]; mean += line[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) { line[i] -= mean; pw += line[i] * line[i]; }
    const gain = 0.3 / Math.sqrt(pw / N + 1e-9);
    for (let i = 0; i < N; i++) line[i] *= gain;
    const t60 = clamp(7.2 - (midi - 40) * 0.085, 2.3, 7.2);
    const rho = Math.pow(0.001, 1 / (t60 * f));                 // perda por volta ⇒ −60 dB em t60 s
    let idx = 0, px = 0, ax = 0, ay = 0;
    for (let i = 0; i < n; i++) {
      const x = line[idx];
      const y1 = 0.5 * (x + px); px = x;
      const y2 = C * y1 + ax - C * ay; ax = y1; ay = y2;
      line[idx] = y2 * rho;
      if (++idx >= N) idx = 0;
      out[i] = x;
    }
    // iguala a "força" percebida entre notas e fecha o final com um fade
    const m = Math.min(n, Math.floor(0.12 * sr));
    let e = 0;
    for (let i = 0; i < m; i++) e += out[i] * out[i];
    const norm = clamp(0.2 / Math.sqrt(e / m + 1e-9), 0.2, 6);
    const fade = Math.floor(0.3 * sr);
    for (let i = 0; i < n; i++) out[i] *= norm * (i > n - fade ? (n - i) / fade : 1);
    const buf = ctx.createBuffer(1, n, sr);
    buf.getChannelData(0).set(out);
    return (c[key] = buf);
  }
  function vGuitar(ctx, dest, t, midi, vel, pan) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = ksBuffer(ctx, midi);
    if (s.detune) s.detune.value = (((t * 997) % 1) - 0.5) * 6;
    g.gain.value = vel;
    s.connect(g);
    const out = route(ctx, g, dest, pan);
    s.start(t);
    done(s, g, out);
  }

  /* ── percussão (vassourinhas) ──────────────────────────────────────────── */
  function rideBuffer(ctx) { // prato de condução: 32 parciais inarmônicas espalhadas + "estalo" da baqueta + brilho de ruído
    const c = cacheOf(ctx);
    if (c.ride) return c.ride;
    const sr = ctx.sampleRate, n = Math.floor(sr * 1.2), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = makeRng(77), parts = [];
    for (let k = 0; k < 32; k++) { // muitos parciais aleatórios: soa como metal, não como um apito de altura fixa
      parts.push({ w: (TAU * 2800 * Math.pow(12000 / 2800, r.f())) / sr, ph: r.f() * TAU, e: 0.4 + 0.6 * r.f(), dk: Math.exp(-(2.5 + 6 * r.f()) / sr) });
    }
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < parts.length; k++) { const q = parts[k]; s += q.e * Math.sin(q.w * i + q.ph); q.e *= q.dk; }
      const w = r.f() * 2 - 1, hp = w - prev, t = i / sr;
      prev = w;
      d[i] = (s * 0.05 + hp * (0.14 * Math.exp(-t * 7) + 0.3 * Math.exp(-t * 60))) * Math.min(1, t * 1500);
    }
    return (c.ride = buf);
  }
  function vRide(ctx, dest, t, vel) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = rideBuffer(ctx); s.playbackRate.value = 0.97 + ((t * 31.7) % 1) * 0.06;
    g.gain.value = vel * 0.55;
    s.connect(g); g.connect(dest); s.start(t); done(s, g);
  }
  function vChick(ctx, dest, t, vel) { // pedal do chimbal
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer(ctx, "white", 2, 1);
    hp.type = "highpass"; hp.frequency.value = 6200; hp.Q.value = 0.8;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, 0.014);
    s.connect(hp); hp.connect(g); g.connect(dest); s.start(t, (t * 13.37) % 1.4, 0.12); done(s, hp, g);
  }
  function vKick(ctx, dest, t, vel) { // bumbo "pena": mais sentido do que ouvido
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.07);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.06);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.5); done(o, g);
  }
  function vGhost(ctx, dest, t, vel) { // nota-fantasma de vassourinha na caixa
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer(ctx, "pink", 3, 1);
    bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.6;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.012); g.gain.setTargetAtTime(0, t + 0.012, 0.035);
    s.connect(bp); bp.connect(g); g.connect(dest); s.start(t, (t * 7.7) % 2, 0.35); done(s, bp, g);
  }

  /* ═══ 3 · base das trilhas ════════════════════════════════════════════════ */
  // Cada trilha gera eventos "à frente" do relógio de áudio: run(until) compõe e agenda
  // tudo o que começa antes de `until` (em segundos do relógio do AudioContext).
  class Track {
    constructor(ctx, bus, rnd) {
      this.ctx = ctx; this.rnd = rnd; this.srcs = [];
      this.out = ctx.createGain();
      this.out.gain.value = this.constructor.trim || 1;
      this.out.connect(bus);
    }
    start(t0) { this.t = t0; this.onStart(t0); }
    schedule(until, now) {
      if (now != null && this.t < now) this.t = now + 0.08;  // atraso (ex.: aba dormiu): pula o tempo perdido
      this.run(until, now);
    }
    dispose() {
      this.srcs.forEach((s) => { try { s.stop(); } catch (e) { /* já parou */ } });
      try { this.out.disconnect(); } catch (e) { /* já solto */ }
    }
  }
  const nearestIndex = (arr, v) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[b] - v)) b = i; return b; };
  // índice mais próximo de `idx` cuja nota pertence ao conjunto de classes de altura `set`
  const snapIndex = (arr, idx, set) => {
    for (const d of [0, 1, -1, 2, -2]) { const j = idx + d; if (j >= 0 && j < arr.length && set.has(arr[j] % 12)) return j; }
    return idx;
  };

  /* ═══ 4 · trilha JAZZ — trio de madrugada ═════════════════════════════════ */
  // qualidades de acorde: tons (3ª, 5ª/13ª, 7ª, 9ª) para o piano, acorde-base e escala para a melodia
  const JQ = {
    maj7: { tones: [4, 7, 11, 14], chord: [0, 4, 7, 11], scale: [0, 2, 4, 6, 7, 9, 11] },
    maj6: { tones: [4, 7, 9, 14], chord: [0, 4, 7, 9], scale: [0, 2, 4, 5, 7, 9, 11] },
    m7: { tones: [3, 7, 10, 14], chord: [0, 3, 7, 10], scale: [0, 2, 3, 5, 7, 9, 10] },
    m6: { tones: [3, 7, 9, 14], chord: [0, 3, 7, 9], scale: [0, 2, 3, 5, 7, 9, 11] },
    d7: { tones: [4, 9, 10, 14], chord: [0, 4, 7, 10], scale: [0, 2, 4, 5, 7, 9, 10] },
    d7b9: { tones: [4, 8, 10, 13], chord: [0, 4, 7, 10], scale: [0, 1, 4, 5, 7, 8, 10] },
    ø7: { tones: [3, 6, 10, 14], chord: [0, 3, 6, 10], scale: [0, 2, 3, 5, 6, 8, 10] },
  };
  // progressões: [grau em semitons, qualidade, tempos]
  const JPROGS = [
    { modo: "maj", seg: [[2, "m7", 4], [7, "d7", 4], [0, "maj7", 8]] },                                                  // ii–V–I
    { modo: "maj", seg: [[0, "maj7", 4], [9, "m7", 4], [2, "m7", 4], [7, "d7", 4]] },                                    // I–vi–ii–V
    { modo: "maj", seg: [[4, "m7", 4], [9, "d7", 4], [2, "m7", 4], [7, "d7", 4], [0, "maj6", 8]] },                      // iii–VI–ii–V–I
    { modo: "maj", seg: [[2, "m7", 4], [1, "d7", 4], [0, "maj7", 8]] },                                                  // ii–bII (trítono)–I
    { modo: "maj", seg: [[2, "m7", 4], [7, "d7", 4], [0, "maj7", 4], [5, "maj7", 4], [11, "ø7", 4], [4, "d7b9", 4], [9, "m7", 8]] }, // ciclo longo
    { modo: "min", seg: [[2, "ø7", 4], [7, "d7b9", 4], [0, "m7", 4], [0, "m6", 4]] },                                    // ii°–V–i
    { modo: "maj", seg: [[0, "maj7", 4], [5, "maj7", 4], [4, "m7", 4], [9, "d7", 4], [2, "m7", 4], [7, "d7", 4], [0, "maj6", 8]] },
  ];
  // células rítmicas de acompanhamento (tempo, duração, velocidade, tipo)
  const JCELLS = [
    { w: 3, hits: [[0, 3.2, 0.62]] },
    { w: 3, hits: [[0, 1.3, 0.6], [1.5, 2.2, 0.5]] },                    // Charleston
    { w: 2, hits: [[0.5, 1.2, 0.45], [2.5, 1.4, 0.55]] },
    { w: 2, hits: [[1, 1.2, 0.5], [2.5, 1.3, 0.55]] },
    { w: 2, hits: [[0, 2.2, 0.58], [3.5, 0.6, 0.42, "ant"]] },           // antecipa o próximo acorde
    { w: 1, hits: [] },                                                  // compasso de respiro
  ];
  const JRHY = [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [1.5, 0.5, 2], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 2], [2, 1, 1], [1, 0.5, 0.5, 2], [0.5, 1, 0.5, 2]];
  const PERMS4 = (function () {
    const out = [];
    (function p(a, rest) { if (!rest.length) { out.push(a); return; } rest.forEach((x, i) => p(a.concat(x), rest.slice(0, i).concat(rest.slice(i + 1)))); })([], [0, 1, 2, 3]);
    return out;
  })();

  // condução de vozes: escolhe a inversão do acorde que se move menos em relação à anterior
  function leadVoicing(seg, prev) {
    const pcs = JQ[seg.q].tones.map((i) => (seg.root + i) % 12);
    if (!prev) return pcs.map((pc) => nearestPc(pc, 61)).sort((a, b) => a - b);
    let best = null;
    PERMS4.forEach((perm) => {
      const notes = perm.map((p, j) => nearestPc(pcs[p], prev[j]));
      let cost = 0;
      notes.forEach((n, j) => { cost += Math.abs(n - prev[j]); });
      const s = notes.slice().sort((a, b) => a - b);
      cost += Math.abs((s[0] + s[1] + s[2] + s[3]) / 4 - 63) * 0.6;
      for (let k = 1; k < 4; k++) if (s[k] - s[k - 1] < 3) cost += 4;
      if (s[0] < 52 || s[3] > 76) cost += 20;
      if (!best || cost < best.cost) best = { cost, notes: s };
    });
    return best.notes;
  }

  class JazzTrack extends Track {
    onStart() {
      const { ctx, rnd } = this;
      this.bpm = rnd.range(64, 74); this.beat = 60 / this.bpm; this.swing = 0.63;
      this.key = rnd.pick([5, 10, 3, 0, 7, 8]);        // F, Sib, Mib, C, G, Láb
      this.queue = []; this.cycles = 0; this.lastProg = -1; this.beatCount = 0;
      this.voicing = null; this.pending = null; this.lastBass = 40; this.lastMel = 76; this.melRest = 1;
      this.rv = makeReverb(ctx, this.out, { rt60: 1.9, dark: 0.35, wet: 0.5 });
      const ch = (o) => makeChannel(ctx, this.out, this.rv, o, this);
      this.chKeys = ch({ level: 1.0, send: 0.3, filters: [["peaking", 2600, 0.8, 4], ["lowpass", 5500, 0.5]] });
      this.chBass = ch({ level: 0.5, send: 0.05, filters: [["highpass", 45, 0.7], ["lowpass", 1800, 0.6]] });
      this.chVibes = ch({ level: 1.3, send: 0.5, filters: [["highpass", 200, 0.7]], trem: { rate: 4.6, depth: 0.35 } });
      this.chRide = ch({ level: 0.8, send: 0.2, pan: 0.15, filters: [["highpass", 2200, 0.7], ["lowpass", 9000, 0.6]] });
      this.chKit = ch({ level: 0.7, send: 0.15 });
      rideBuffer(ctx); // calcula o prato antes do primeiro toque
    }
    at(t0, b) { // instante da posição `b` (em tempos) com swing nas colcheias
      const i = Math.floor(b + 1e-6), fr = b - i;
      return t0 + (i + (fr > 0.01 ? this.swing * (fr / 0.5) : 0)) * this.beat;
    }
    refill() {
      const rnd = this.rnd;
      while (this.queue.length < 3) {
        if (this.cycles > 0 && rnd.chance(0.45)) this.key = (this.key + rnd.pick([5, 7, 7, 10, 2, 5])) % 12; // 4ª, 5ª ou tom
        let pi = rnd.int(0, JPROGS.length - 1);
        if (pi === this.lastProg) pi = (pi + 1) % JPROGS.length;
        this.lastProg = pi;
        const p = JPROGS[pi];
        p.seg.forEach((s) => this.queue.push({ root: (this.key + s[0]) % 12, q: s[1], b: s[2], modo: p.modo }));
        this.cycles++;
      }
    }
    run(until) {
      while (this.t < until) this.step();
    }
    step() {
      this.refill();
      const seg = this.queue.shift(), nxt = this.queue[0], t0 = this.t;
      this.bassLine(seg, nxt, t0); this.comp(seg, nxt, t0); this.drums(seg, t0); this.melody(seg, t0);
      this.t += seg.b * this.beat; this.beatCount += seg.b;
    }
    // baixo caminhando: fundamental, grau da escala, 5ª/3ª e nota de aproximação do próximo acorde
    bassLine(seg, nxt, t0) {
      const { ctx, rnd, beat } = this, Q = JQ[seg.q], bars = seg.b / 4;
      const near = (pc, ref) => fitRange(nearestPc(pc, ref), 31, 50);
      let prev = this.lastBass;
      for (let bar = 0; bar < bars; bar++) {
        const last = bar === bars - 1, tb = t0 + bar * 4 * beat;
        const play = (b, m, vel, dur) => vBass(ctx, this.chBass.input, tb + b * beat + rnd.jitter(0.005), m, vel * (0.9 + 0.2 * rnd.f()), dur * beat);
        const n1 = near(seg.root, prev);
        if (rnd.chance(0.2)) { // "dois por compasso": semínimas só nos tempos 1 e 3
          const n3 = near(seg.root + 7, n1);
          play(0, n1, 0.9, 1.9); play(2, n3, 0.78, 1.9);
          prev = n3;
          continue;
        }
        const n2 = near(seg.root + rnd.weighted([2, Q.chord[1], 7], [25, 45, 30]), n1);
        let n3 = near(seg.root + rnd.pick([Q.chord[1], 7, Q.chord[3]]), n2);
        if (n3 === n2) n3 = near(seg.root + 7, n2);
        const target = near(last && nxt ? nxt.root : seg.root, n3);
        const n4 = clamp(target + (rnd.chance(0.55) ? -1 : 1), 30, 51);
        play(0, n1, 0.9, 0.95); play(1, n2, 0.74, 0.92); play(2, n3, 0.8, 0.92); play(3, n4, 0.72, 0.9);
        prev = n4;
      }
      this.lastBass = prev;
    }
    // piano: células rítmicas sobre vozes conduzidas suavemente (acordes sem fundamental)
    comp(seg, nxt, t0) {
      const { ctx, rnd, beat } = this, bars = seg.b / 4;
      this.voicing = this.pending || leadVoicing(seg, this.voicing);
      this.pending = null;
      for (let bar = 0; bar < bars; bar++) {
        const last = bar === bars - 1, tb = t0 + bar * 4 * beat;
        const cell = rnd.weighted(JCELLS, JCELLS.map((c) => c.w));
        cell.hits.forEach((h) => {
          let v = this.voicing;
          if (h[3] === "ant") {
            if (!last || !nxt) return;
            if (!this.pending) this.pending = leadVoicing(nxt, this.voicing);
            v = this.pending;
          }
          const t = this.at(tb, h[0]);
          v.forEach((m, k) => vEPiano(ctx, this.chKeys.input, t + k * 0.011 + rnd.jitter(0.004), m, h[2] * (0.9 + 0.2 * rnd.f()), h[1] * beat, (k - 1.5) * 0.18));
        });
      }
    }
    // vassourinhas: prato "spang-a-lang", pedal do chimbal nos tempos 2 e 4, bumbo pena
    drums(seg, t0) {
      const { ctx, rnd, beat, swing } = this;
      for (let i = 0; i < seg.b; i++) {
        const bi = (this.beatCount + i) % 4, t = t0 + i * beat;
        vRide(ctx, this.chRide.input, t + rnd.jitter(0.005), bi % 2 ? 0.55 : 0.45);
        if (bi % 2 === 1) {
          vRide(ctx, this.chRide.input, t + swing * beat + rnd.jitter(0.006), 0.32);
          vChick(ctx, this.chKit.input, t + rnd.jitter(0.004), 0.5);
        }
        vKick(ctx, this.chKit.input, t + rnd.jitter(0.006), 0.055 + 0.03 * rnd.f());
        if (rnd.chance(0.1)) vGhost(ctx, this.chKit.input, t + swing * beat + rnd.jitter(0.006), 0.25);
      }
    }
    // solo esparso de vibrafone: frases curtas, notas fortes nos tons do acorde
    melody(seg, t0) {
      const { ctx, rnd } = this, units = seg.b / 4, Q = JQ[seg.q];
      for (let u = 0; u < units; u++) {
        if (this.melRest > 0) { this.melRest--; continue; }
        if (!rnd.chance(0.55)) continue;
        const notes = this.phrase(seg, Q);
        notes.forEach((n) => vVibes(ctx, this.chVibes.input, this.at(t0, u * 4 + n.pos), n.midi, n.vel, 0.12));
        this.melRest = rnd.int(0, 1) + (notes.length > 4 ? 1 : 0);
      }
    }
    phrase(seg, Q) {
      const rnd = this.rnd, scale = [];
      for (let m = 64; m <= 89; m++) if (Q.scale.some((s) => (seg.root + s) % 12 === m % 12)) scale.push(m);
      const strong = new Set(Q.chord.concat([Q.tones[3]]).map((s) => (seg.root + s) % 12));
      const tpl = rnd.pick(JRHY);
      let pos = rnd.pick([0, 0, 0.5, 1]), dir = rnd.chance(0.5) ? 1 : -1;
      let idx = snapIndex(scale, nearestIndex(scale, this.lastMel + rnd.int(-3, 3)), strong);
      const out = [];
      for (let k = 0; k < tpl.length && pos < 4; k++) {
        const d = tpl[k], last = k === tpl.length - 1 || pos + d >= 4;
        if (k > 0) {
          if (rnd.chance(0.35)) dir = -dir;
          idx = clamp(idx + dir * rnd.weighted([1, 2, 3, 4], [50, 32, 13, 5]), 0, scale.length - 1);
          if (idx === 0 || idx === scale.length - 1) dir = -dir;
        }
        if ((pos % 1 === 0 && d >= 1) || last) idx = snapIndex(scale, idx, strong);
        out.push({ pos, midi: scale[idx], vel: (k === 0 ? 0.5 : 0.4) + 0.15 * rnd.f() - (last ? 0.05 : 0), dur: d });
        pos += d;
      }
      this.lastMel = out.length ? out[out.length - 1].midi : this.lastMel;
      return out;
    }
  }
  JazzTrack.trim = 0.74;

  /* ═══ 5 · trilha LOUVOR — louvor sereno ═══════════════════════════════════ */
  // acordes abertos de "pad": fundamental, 5ª, 9ª e 3ª (M), 3ª menor (m) ou 4ª suspensa (S)
  const LV = { M: [0, 7, 14, 16], m: [0, 7, 14, 15], S: [0, 7, 14, 17] };
  const LPROGS = [
    [[0, "M"], [7, "M"], [9, "m"], [5, "M"]],   // I–V–vi–IV
    [[0, "M"], [5, "M"], [9, "m"], [7, "S"]],   // I–IV–vi–Vsus
    [[9, "m"], [5, "M"], [0, "M"], [7, "M"]],   // vi–IV–I–V
    [[0, "M"], [4, "m"], [5, "M"], [7, "S"]],   // I–iii–IV–Vsus
    [[5, "M"], [0, "M"], [7, "M"], [9, "m"]],   // IV–I–V–vi
    [[0, "M"], [9, "m"], [5, "M"], [0, "M"]],   // I–vi–IV–I
  ];
  class LouvorTrack extends Track {
    onStart() {
      const { ctx, rnd } = this;
      this.bpm = rnd.range(56, 63); this.beat = 60 / this.bpm;
      this.key = rnd.pick([0, 2, 3, 5, 7, 9]);          // C, D, Mib, F, G, Lá
      this.queue = []; this.cycles = 0; this.lastProg = -1;
      this.rv = makeReverb(ctx, this.out, { rt60: 4.8, dark: 0.45, wet: 0.8 });
      // eco de colcheia pontuada, escuro: o "brilho" repetido do louvor contemporâneo
      const dly = ctx.createDelay(3), fb = ctx.createGain(), dl = ctx.createBiquadFilter(), dw = ctx.createGain();
      dly.delayTime.value = this.beat * 0.75; fb.gain.value = 0.42;
      dl.type = "lowpass"; dl.frequency.value = 3200; dw.gain.value = 0.5;
      dly.connect(dl); dl.connect(fb); fb.connect(dly); dl.connect(dw); dw.connect(this.out); dw.connect(this.rv.input);
      const ch = (o) => makeChannel(ctx, this.out, this.rv, o, this);
      this.chPad = ch({ level: 0.62, send: 0.45, filters: [["highpass", 85, 0.7]] });
      this.chSub = ch({ level: 0.3, send: 0 });
      this.chPiano = ch({ level: 0.75, send: 0.5 });
      this.chBell = ch({ level: 1.2, send: 0.6 });
      [this.chPiano, this.chBell].forEach((c) => { const s = ctx.createGain(); s.gain.value = 0.55; c.fader.connect(s); s.connect(dly); });
    }
    refill() {
      const rnd = this.rnd;
      if (this.cycles > 0 && rnd.chance(0.35)) this.key = (this.key + rnd.pick([2, 5, 7])) % 12;
      let pi = rnd.int(0, LPROGS.length - 1);
      if (pi === this.lastProg) pi = (pi + 1) % LPROGS.length;
      this.lastProg = pi;
      LPROGS[pi].forEach((c) => this.queue.push({ d: c[0], q: c[1] }));
      this.cycles++;
    }
    run(until) {
      while (this.t < until) this.step();
    }
    step() { // um acorde = 8 tempos (cerca de 8 s)
      if (!this.queue.length) this.refill();
      const { ctx, rnd, beat } = this, ch = this.queue.shift(), t0 = this.t, dur = 8 * beat;
      const root = fitRange(36 + ((this.key + ch.d) % 12), 45, 56);
      const notes = LV[ch.q].map((i) => root + i);
      vPad(ctx, this.chPad.input, t0, notes, dur + 0.3, { atk: 2.2, rel: 3.0, cutoff: 3800, peak: 0.55, up: true });
      vSub(ctx, this.chSub.input, t0, root - 12, dur + 0.3, 0.12, 1.6, 2.6);
      // arpejo de piano macio em semínimas, com colcheias de passagem e pausas
      const pcs = notes.map((m) => m % 12), pool = [];
      for (let m = 57; m <= 79; m++) if (pcs.indexOf(m % 12) >= 0) pool.push(m);
      const lo = Math.max(0, pool.findIndex((m) => m >= 64)), pat = rnd.pick([[0, 2, 1, 3, 2, 1, 3, 2], [0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 3, 2, 1, 2, 3, 4]]);
      const noteAt = (k) => pool[clamp(lo + k, 0, pool.length - 1)];
      for (let i = 0; i < 8; i++) {
        const t = t0 + i * beat;
        if (!rnd.chance(0.16)) vSoftPiano(ctx, this.chPiano.input, t + rnd.jitter(0.012), noteAt(pat[i]), (i === 0 ? 0.3 : 0.17) + 0.12 * rnd.f(), 3.2 * beat, rnd.range(-0.25, 0.25), 3600);
        if (rnd.chance(0.28)) vSoftPiano(ctx, this.chPiano.input, t + 0.5 * beat + rnd.jitter(0.012), noteAt(pat[(i + 1) % 8] + 1), 0.12 + 0.1 * rnd.f(), 2.4 * beat, rnd.range(-0.25, 0.25), 3600);
      }
      // sinos distantes nas notas do acorde, bem no alto
      const high = [];
      for (let m = 76; m <= 91; m++) if (pcs.indexOf(m % 12) >= 0) high.push(m);
      if (rnd.chance(0.65)) vBell(ctx, this.chBell.input, t0 + beat * rnd.pick([0, 1, 2]), rnd.pick(high), 0.3 + 0.2 * rnd.f(), rnd.range(-0.4, 0.4));
      if (rnd.chance(0.4)) vBell(ctx, this.chBell.input, t0 + beat * rnd.pick([4, 5, 6]), rnd.pick(high), 0.25 + 0.2 * rnd.f(), rnd.range(-0.4, 0.4));
      this.t += dur;
    }
  }
  LouvorTrack.trim = 0.9;

  /* ═══ 6 · trilha ACÚSTICO — violão calmo ══════════════════════════════════ */
  const GQ = { M: [0, 4, 7], m: [0, 3, 7], add9: [0, 4, 7, 14], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7] };
  const GPROGS = [
    [[0, "add9"], [7, "M"], [9, "m7"], [5, "maj7"]],
    [[0, "M"], [9, "m"], [5, "add9"], [7, "sus4"]],
    [[9, "m7"], [5, "maj7"], [0, "add9"], [7, "M"]],
    [[0, "add9"], [5, "M"], [0, "add9"], [7, "sus4"]],
    [[0, "M"], [4, "m7"], [5, "maj7"], [7, "M"]],
  ];
  // padrões de dedilhado em 8 colcheias: B = baixo, A = baixo alternado, 0/1/2 = cordas agudas, - = pausa
  const GPATS = [
    ["B", 0, 1, 2, "A", 0, 1, 2],
    ["B", 1, 2, 1, "A", 1, 2, 1],
    ["B", 0, 1, 0, 2, 1, 0, 1],
    ["B", "-", 1, 2, "A", "-", 1, 2],
    ["B", 1, 0, 2, "A", 1, 2, 1],
  ];
  // posição de mão esquerda "de violão": baixo, baixo alternado e três notas agudas
  function guitarShape(rootPc, q) {
    const iv = GQ[q], pcs = iv.map((i) => (rootPc + i) % 12), bass = fitRange(rootPc, 40, 51), pool = [];
    for (let m = 55; m <= 72; m++) if (pcs.indexOf(m % 12) >= 0) pool.push(m);
    const m0 = pool[0], m1 = pool.find((m) => m >= m0 + 3), m2 = pool.find((m) => m >= m1 + 3) || m1 + 12;
    return { bass, alt: bass + 7, mids: [m0, m1, m2], pcs: new Set(pcs) };
  }
  class AcusticoTrack extends Track {
    onStart() {
      const { ctx, rnd } = this;
      this.bpm = rnd.range(64, 74); this.beat = 60 / this.bpm; this.eighth = this.beat / 2;
      this.key = (rnd.pick([7, 0, 2, 9, 4]) + rnd.pick([0, 0, 2, 3, 5])) % 12; // tons de violão + capotraste
      this.queue = []; this.cycles = 0; this.lastProg = -1; this.pat = rnd.pick(GPATS); this.motif = null; this.lastMel = 72; this.bar = 0;
      this.scale = [];
      for (let m = 62; m <= 84; m++) if ([0, 2, 4, 7, 9].some((s) => (this.key + s) % 12 === m % 12)) this.scale.push(m);
      this.rv = makeReverb(ctx, this.out, { rt60: 2.4, dark: 0.3, wet: 0.45 });
      // caixa do violão: realces nas ressonâncias do corpo, sem agudos ásperos
      this.chGt = makeChannel(ctx, this.out, this.rv, {
        level: 0.9, send: 0.4,
        filters: [["highpass", 70, 0.7], ["peaking", 105, 1.4, 3.5], ["peaking", 230, 1.6, 2.5], ["peaking", 520, 1.2, 1], ["lowpass", 5200, 0.6]],
      }, this);
      this.chCh = makeChannel(ctx, this.out, this.rv, { level: 0.7, send: 0.7 }, this);
      this.refill();
      this.warm();
    }
    warm() { // calcula as primeiras cordas antes de tocar, para não pesar no meio da música
      this.queue.slice(0, 2).forEach((c) => { const g = guitarShape((this.key + c.d) % 12, c.q); [g.bass, g.alt].concat(g.mids).forEach((m) => ksBuffer(this.ctx, m)); });
    }
    refill() {
      const rnd = this.rnd;
      if (this.cycles > 0 && rnd.chance(0.3)) this.key = (this.key + rnd.pick([2, 5, 7])) % 12;
      if (this.cycles > 0) {
        this.scale = [];
        for (let m = 62; m <= 84; m++) if ([0, 2, 4, 7, 9].some((s) => (this.key + s) % 12 === m % 12)) this.scale.push(m);
      }
      let pi = rnd.int(0, GPROGS.length - 1);
      if (pi === this.lastProg) pi = (pi + 1) % GPROGS.length;
      this.lastProg = pi;
      GPROGS[pi].forEach((c) => this.queue.push({ d: c[0], q: c[1] }));
      this.cycles++;
    }
    run(until) {
      while (this.t < until) this.step();
    }
    step() { // um acorde = um compasso (8 colcheias)
      if (this.queue.length < 2) this.refill();
      const { ctx, rnd, eighth } = this, c = this.queue.shift(), t0 = this.t, g = guitarShape((this.key + c.d) % 12, c.q);
      if (rnd.chance(0.3)) this.pat = rnd.pick(GPATS);
      this.pat.forEach((tok, i) => {
        if (tok === "-") return;
        const t = t0 + i * eighth + rnd.jitter(0.005);
        if (tok === "B") vGuitar(ctx, this.chGt.input, t, g.bass, 0.62 + 0.08 * rnd.f(), -0.2);
        else if (tok === "A") vGuitar(ctx, this.chGt.input, t, g.alt, 0.5 + 0.08 * rnd.f(), -0.15);
        else vGuitar(ctx, this.chGt.input, t, g.mids[tok], 0.34 + 0.12 * rnd.f() + (i % 4 === 0 ? 0.04 : 0), 0.1 + tok * 0.08);
      });
      this.melody(g, t0);
      if (rnd.chance(0.18)) { // harmônico "de oitava" cintilando no fim do compasso
        const hi = fitRange(g.mids[1], 79, 91);
        vBell(ctx, this.chCh.input, t0 + 6.5 * eighth, hi, 0.35 + 0.15 * rnd.f(), rnd.range(-0.3, 0.3), true);
      }
      this.bar++; this.t += 8 * eighth;
    }
    melody(g, t0) { // melodia simples em pentatônica, com motivos que voltam levemente variados
      const { ctx, rnd, beat } = this;
      if (!rnd.chance(this.bar % 2 === 0 ? 0.5 : 0.35)) return;
      if (!this.motif || rnd.chance(0.45)) {
        const pos = rnd.pick([[0, 1.5, 2.5], [0, 1, 2, 3], [0.5, 2], [0, 2], [1, 2.5, 3], [0, 1.5, 2, 3]]);
        let d = 0;
        this.motif = { pos, rel: pos.map((p, i) => { if (i) d += rnd.weighted([-2, -1, 1, 2], [15, 30, 30, 15]); return d; }) };
      }
      const idx = snapIndex(this.scale, nearestIndex(this.scale, this.lastMel), g.pcs);
      this.motif.pos.forEach((p, i) => {
        const m = this.scale[clamp(idx + this.motif.rel[i], 0, this.scale.length - 1)];
        vGuitar(ctx, this.chGt.input, t0 + p * beat + rnd.jitter(0.006), m, 0.5 + 0.12 * rnd.f(), 0.18);
        this.lastMel = m;
      });
    }
  }
  AcusticoTrack.trim = 1.18;

  /* ═══ 7 · trilha CHUVA — sala & chuva ═════════════════════════════════════ */
  class ChuvaTrack extends Track {
    onStart(t0) {
      const { ctx, rnd } = this;
      this.rv = makeReverb(ctx, this.out, { rt60: 2.8, dark: 0.3, wet: 0.5 });
      const loop = (kind, secs, chans, dest, filters, gain) => {
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = noiseBuffer(ctx, kind, secs, chans); s.loop = true;
        let tail = s;
        filters.forEach((spec) => {
          const f = ctx.createBiquadFilter();
          f.type = spec[0]; f.frequency.value = spec[1]; f.Q.value = spec[2] == null ? 0.7 : spec[2];
          if (spec[3] != null) f.gain.value = spec[3];
          tail.connect(f); tail = f;
        });
        g.gain.value = gain; tail.connect(g); g.connect(dest);
        s.start(t0, rnd.range(0, secs * 0.8));
        this.srcs.push(s);
        return g;
      };
      // chuva na vidraça: ruído rosa estéreo com realce nos médios-agudos + corpo grave
      this.bed = loop("pink", 9, 2, this.out, [["highpass", 260, 0.7], ["peaking", 2400, 0.7, 4], ["lowpass", 9000, 0.7]], 0.3);
      this.body = loop("brown", 8, 1, this.out, [["highpass", 70, 0.7], ["lowpass", 520, 0.7]], 0.16);
      loop("white", 5, 1, this.out, [["highpass", 6000, 0.7]], 0.012);   // chuvisco fino
      loop("brown", 7, 1, this.out, [["highpass", 50, 0.7], ["lowpass", 200, 0.7]], 0.07); // ar da sala
      // zumbido de lâmpada fluorescente (rede de 60 Hz ⇒ 120 Hz dominante), bem baixinho
      const hum = ctx.createGain(), flick = ctx.createOscillator(), fg = ctx.createGain();
      hum.gain.value = 0.011; flick.frequency.value = 0.17; fg.gain.value = 0.0013;
      flick.connect(fg); fg.connect(hum.gain); flick.start(t0); this.srcs.push(flick);
      [[60, 0.5], [120, 1], [180, 0.35], [240, 0.45], [360, 0.12]].forEach((p) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = p[0]; g.gain.value = p[1]; o.connect(g); g.connect(hum); o.start(t0); this.srcs.push(o);
      });
      hum.connect(this.out);
      // canais de eventos
      this.chDrop = makeChannel(ctx, this.out, this.rv, { level: 1, send: 0.35 }, this);
      this.chPiano = makeChannel(ctx, this.out, this.rv, { level: 0.55, send: 1.1, filters: [["lowpass", 1100, 0.6], ["highpass", 90, 0.7]] }, this);
      this.chThunder = makeChannel(ctx, this.out, this.rv, { level: 1, send: 0.6 }, this);
      // cinco "pistas" fixas de panorâmica: cada gota usa uma delas (um nó a menos por gota)
      this.lanes = [-0.85, -0.45, 0, 0.45, 0.85].map((pn) => { const g = ctx.createGain(); route(ctx, g, this.chDrop.input, pn); return g; });
      // estado dos eventos
      this.inten = 0.8; this.nMod = t0 + 2; this.nDrop = t0; this.nPing = t0 + 1; this.nDrip = t0 + 2;
      this.nThunder = t0 + rnd.range(18, 40);
      this.base = { bed: 0.3, body: 0.16 };
      // piano em outro cômodo: "laços de fita" de períodos diferentes, notas de uma pentatônica
      const key = rnd.pick([0, 2, 5, 7, 9, 10]), pool = [];
      for (let m = 40; m <= 76; m++) if ([0, 2, 4, 7, 9].some((s) => (key + s) % 12 === m % 12)) pool.push(m);
      this.pool = pool;
      this.loops = [11.3, 14.9, 17.7, 21.1, 26.3].map((p, i) => ({ period: p, next: t0 + 4 + i * 3.7 + rnd.range(0, 3), note: rnd.pick(pool) }));
    }
    schedule(until, now) {
      if (now != null) { // se a aba dormiu, recomeça os eventos a partir de agora
        const n = now + 0.05;
        ["nMod", "nDrop", "nPing", "nDrip"].forEach((k) => { if (this[k] < now) this[k] = n + this.rnd.range(0, 0.5); });
        if (this.nThunder < now) this.nThunder = n + this.rnd.range(10, 30);
        this.loops.forEach((l) => { if (l.next < now) l.next = n + this.rnd.range(1, 6); });
      }
      this.run(until);
    }
    run(until) {
      const { rnd } = this;
      while (this.nMod < until) { // a chuva "respira": a intensidade deriva devagar
        this.inten = clamp(lerp(this.inten, rnd.range(0.55, 1), 0.7), 0.5, 1);
        this.bed.gain.setTargetAtTime(this.base.bed * (0.75 + 0.3 * this.inten), this.nMod, 3);
        this.body.gain.setTargetAtTime(this.base.body * (0.7 + 0.4 * this.inten), this.nMod, 3.5);
        this.nMod += rnd.range(6, 11);
      }
      while (this.nDrop < until) { this.drop(this.nDrop); this.nDrop += rnd.exp(1 / (14 * this.inten)); }
      while (this.nPing < until) { this.ping(this.nPing); this.nPing += rnd.exp(1 / (1.1 * this.inten)); }
      while (this.nDrip < until) { this.drip(this.nDrip); this.nDrip += rnd.exp(1 / (0.5 * this.inten)); }
      while (this.nThunder < until) { this.thunder(this.nThunder); this.nThunder += rnd.range(45, 110); }
      this.loops.forEach((l) => {
        while (l.next < until) {
          if (rnd.chance(0.82)) {
            if (rnd.chance(0.3)) l.note = rnd.pick(this.pool);
            vSoftPiano(this.ctx, this.chPiano.input, l.next, l.note, 0.2 + 0.2 * rnd.f(), 3 + 2 * rnd.f(), rnd.range(-0.5, 0.5), 1500);
          }
          l.next += l.period * rnd.range(0.92, 1.08);
        }
      });
      this.t = until;
    }
    drop(t) { // pingo seco na vidraça: estalinho de ruído filtrado
      const { ctx, rnd } = this, dur = rnd.range(0.006, 0.02);
      const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuffer(ctx, "white", 5, 1);
      bp.type = "bandpass"; bp.frequency.value = rnd.range(1500, 6800); bp.Q.value = rnd.range(1.5, 6);
      g.gain.setValueAtTime(rnd.range(0.01, 0.07) * (rnd.chance(0.12) ? 2.2 : 1), t); g.gain.setTargetAtTime(0, t + 0.001, dur / 2.5);
      s.connect(bp); bp.connect(g);
      g.connect(rnd.pick(this.lanes));
      s.start(t, rnd.range(0, 4.5), dur + 0.03);
      done(s, bp, g);
    }
    ping(t) { // gota no parapeito de metal
      const { ctx, rnd } = this, f = rnd.range(1800, 3600), tau = rnd.range(0.03, 0.09);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), a = rnd.range(0.008, 0.026);
      o.frequency.value = f; o2.frequency.value = f * 2.41;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.001); g.gain.setTargetAtTime(0, t + 0.001, tau);
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      o.connect(g); o2.connect(g2); g2.connect(g);
      const end = t + tau * 8 + 0.02;
      g.connect(rnd.pick(this.lanes));
      o.start(t); o2.start(t); o.stop(end); o2.stop(end);
      done(o, g2, g);
    }
    drip(t) { // pingo d'água na calha: tom que sobe rapidinho
      const { ctx, rnd } = this, f = rnd.range(500, 1100);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.55, t + 0.045);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rnd.range(0.02, 0.05), t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, 0.03);
      o.connect(g); g.connect(rnd.pick(this.lanes));
      o.start(t); o.stop(t + 0.35); done(o, g);
    }
    thunder(t) { // trovão ao longe: ruído marrom que varre para o grave, com ondas de ribombo
      const { ctx, rnd } = this, dur = rnd.range(6, 10);
      const s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuffer(ctx, "brown", 8, 1); s.loop = true;
      lp.type = "lowpass"; lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(420, t); lp.frequency.exponentialRampToValueAtTime(90, t + dur);
      const N = 64, curve = new Float32Array(N), ph = rnd.range(0, TAU), peak = rnd.range(0.35, 0.6);
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        curve[i] = peak * Math.pow(Math.sin(Math.PI * Math.pow(x, 0.55)), 1.6) * (0.65 + 0.35 * Math.sin(x * TAU * 3 + ph));
      }
      g.gain.value = 0; g.gain.setValueCurveAtTime(curve, t, dur);
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 45; hp.Q.value = 0.7;
      s.connect(hp); hp.connect(lp); lp.connect(g);
      const out = route(ctx, g, this.chThunder.input, rnd.range(-0.6, 0.6));
      s.start(t, rnd.range(0, 5)); s.stop(t + dur + 0.1);
      done(s, hp, lp, g, out);
    }
  }
  ChuvaTrack.trim = 1.0;

  /* ═══ 8 · motor: contexto, mixagem, fades, volume ═════════════════════════ */
  const TRACKS = [
    { id: "jazz", nome: "Jazz", curta: "trio de madrugada", icone: "🎷", Classe: JazzTrack, fade: 0.6,
      descricao: "Piano elétrico, contrabaixo caminhando e vassourinhas num andamento lento — com um solo de vibrafone de vez em quando." },
    { id: "louvor", nome: "Louvor sereno", curta: "pads, piano e sinos", icone: "🕊️", Classe: LouvorTrack, fade: 1.1,
      descricao: "Acordes abertos que respiram devagar, piano macio com eco e sinos ao longe — para orar sem pressa." },
    { id: "acustico", nome: "Acústico calmo", curta: "violão dedilhado", icone: "🎸", Classe: AcusticoTrack, fade: 0.7,
      descricao: "Violão dedilhado em compasso tranquilo, uma melodia simples que volta variada e harmônicos cintilando." },
    { id: "chuva", nome: "Sala & chuva", curta: "chuva na janela", icone: "🌧️", Classe: ChuvaTrack, fade: 1.6,
      descricao: "Chuva na vidraça, o zumbido baixo de uma sala vazia, trovão ao longe e um piano em outro cômodo." },
  ];
  const DEF = {};
  TRACKS.forEach((t) => { DEF[t.id] = t; });

  const LOOKAHEAD = 1.8, TICK_MS = 100;
  const SOFTCLIP = (function () { // limitador final: linear até 0,7 e curva suave até ~0,92
    const n = 2049, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      c[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
    }
    return c;
  })();
  const volGain = (v) => v * v;  // curva perceptiva: o controle de volume fica mais "natural"

  // mixagem final: passa-altas → compressor suave → limitador → volume
  function buildChain(c, gain) {
    const hp = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), shaper = c.createWaveShaper(), master = c.createGain();
    hp.type = "highpass"; hp.frequency.value = 28; hp.Q.value = 0.6;
    comp.threshold.value = -14; comp.knee.value = 16; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.4;
    shaper.curve = SOFTCLIP; shaper.oversample = "2x";
    master.gain.value = gain;
    hp.connect(comp); comp.connect(shaper); shaper.connect(master); master.connect(c.destination);
    return { input: hp, master };
  }

  let ctx = null, chain = null, cur = null, playing = false, hasRun = false;
  let selected = TRACKS[0].id, volume = 0.7, timer = null, suspendTimer = null;
  const listeners = [];
  const snapshot = () => ({ playing, track: selected, volume, supported: !!AC, error: null });
  function emit(extra) {
    const s = Object.assign(snapshot(), extra || {});
    listeners.slice().forEach((fn) => { try { fn(s); } catch (e) { /* um ouvinte com erro não derruba os outros */ } });
  }

  function ensureContext() {
    if (ctx) return ctx;
    try { if (global.navigator && global.navigator.audioSession) global.navigator.audioSession.type = "playback"; } catch (e) { /* iOS 16.4+ apenas */ }
    try { ctx = new AC({ latencyHint: "playback" }); } catch (e) { ctx = new AC(); }
    chain = buildChain(ctx, volGain(volume));
    ctx.onstatechange = () => {
      if (ctx.state === "running") { hasRun = true; return; }
      // o navegador/SO interrompeu o áudio por conta própria (ligação, política de economia…)
      if (playing && (ctx.state === "interrupted" || (hasRun && ctx.state === "suspended" && !suspendTimer))) {
        playing = false; stopTimer(); emit();
      }
    };
    return ctx;
  }
  function startTimer() { stopTimer(); timer = setInterval(tick, TICK_MS); tick(); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function tick() {
    if (!cur || !ctx) return;
    try {
      const now = ctx.currentTime;
      cur.track.schedule(now + LOOKAHEAD, now);
    } catch (e) {
      if (global.console) global.console.error("[Ambiente]", e);
      stopTimer(); playing = false; emit({ error: "falha ao gerar a trilha" });
    }
  }
  function startTrack(id) {
    const def = DEF[id], bus = ctx.createGain(), now = ctx.currentTime;
    bus.gain.value = 0; bus.connect(chain.input);
    const track = new def.Classe(ctx, bus, makeRng(newSeed()));
    track.start(now + 0.12);
    bus.gain.setValueAtTime(0, now); bus.gain.setTargetAtTime(1, now + 0.05, def.fade);
    return { id, track, bus };
  }
  function retire(t, sec) { // some com um fade e só então desmonta os nós
    const now = ctx.currentTime;
    t.bus.gain.cancelScheduledValues(now);
    t.bus.gain.setValueAtTime(t.bus.gain.value, now);
    t.bus.gain.setTargetAtTime(0, now, sec / 4);
    setTimeout(() => { try { t.track.dispose(); t.bus.disconnect(); } catch (e) { /* já desmontado */ } }, sec * 1000 + 700);
  }

  function play(id) {
    if (!AC) return false;
    const target = id && DEF[id] ? id : selected;
    try {
      const c = ensureContext();
      if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
      if (c.state !== "running") { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } // dentro do gesto do usuário
      if (cur && cur.id === target) {
        if (!playing) { // retoma a mesma trilha, de onde parou
          const now = c.currentTime;
          cur.bus.gain.cancelScheduledValues(now);
          cur.bus.gain.setValueAtTime(cur.bus.gain.value, now);
          cur.bus.gain.setTargetAtTime(1, now + 0.03, 0.45);
        }
      } else {
        if (cur) retire(cur, 1.4);
        cur = startTrack(target);
      }
      selected = target; playing = true;
      startTimer(); emit();
      return true;
    } catch (e) {
      if (global.console) global.console.error("[Ambiente]", e);
      playing = false; emit({ error: "não foi possível iniciar o áudio" });
      return false;
    }
  }
  function pause() {
    if (!playing || !ctx || !cur) return;
    playing = false; stopTimer();
    const now = ctx.currentTime;
    cur.bus.gain.cancelScheduledValues(now);
    cur.bus.gain.setValueAtTime(cur.bus.gain.value, now);
    cur.bus.gain.setTargetAtTime(0, now, 0.18);
    suspendTimer = setTimeout(() => { // depois do fade, congela o relógio de áudio (poupa CPU e bateria)
      suspendTimer = null;
      if (!playing && ctx && ctx.state === "running") { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
    }, 900);
    emit();
  }
  const toggle = () => (playing ? (pause(), true) : play());
  function step(dir) {
    const i = TRACKS.findIndex((t) => t.id === selected);
    return play(TRACKS[(i + dir + TRACKS.length) % TRACKS.length].id);
  }
  function select(id) { // escolhe a trilha; se já estiver tocando, troca com crossfade
    if (!DEF[id]) return false;
    if (playing) return play(id);
    selected = id; emit();
    return true;
  }
  function setVolume(v) {
    v = Number(v);
    if (!isFinite(v)) return; // valor inválido: ignora em vez de zerar o som
    volume = clamp(v, 0, 1);
    if (chain && ctx) chain.master.gain.setTargetAtTime(volGain(volume), ctx.currentTime, 0.05);
    emit();
  }

  // renderiza uma trilha "de uma vez" num OfflineAudioContext (testes, medições, exportação)
  function renderOffline(id, seconds, opts) {
    opts = opts || {};
    if (!OAC || !DEF[id]) return Promise.reject(new Error("trilha ou OfflineAudioContext indisponível"));
    const sr = opts.sampleRate || 44100, octx = new OAC(2, Math.ceil(seconds * sr), sr);
    const c = buildChain(octx, opts.gain == null ? 1 : opts.gain), bus = octx.createGain();
    bus.connect(c.input);
    const track = new DEF[id].Classe(octx, bus, makeRng(opts.seed || 1));
    track.start(0.05);
    if (opts.progressive) { // agenda aos poucos, como no tempo real (serve para medir o custo real de CPU)
      track.schedule(LOOKAHEAD, 0);
      for (let s = 1; s < seconds; s++) octx.suspend(s).then(() => { track.schedule(s + LOOKAHEAD, s); octx.resume(); });
    } else track.schedule(seconds + 0.5);
    return octx.startRendering();
  }

  global.Ambiente = {
    versao: "1.0",
    supported: !!AC,
    tracks: TRACKS.map((t) => ({ id: t.id, nome: t.nome, curta: t.curta, icone: t.icone, descricao: t.descricao })),
    get playing() { return playing; },
    get current() { return selected; },
    get volume() { return volume; },
    play, pause, toggle, select, setVolume, renderOffline,
    next: () => step(1),
    prev: () => step(-1),
    on(fn) { listeners.push(fn); },
    off(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    _internals: {
      JazzTrack, LouvorTrack, AcusticoTrack, ChuvaTrack, makeRng, leadVoicing, JQ, mtof, ksBuffer, buildChain,
      ctxInfo: () => (ctx ? { state: ctx.state, time: ctx.currentTime, sampleRate: ctx.sampleRate } : null),
    },
  };
})(window);
