/* Espaço Liminar — Devocional · ambiente sonoro e slideshow do início
   ─────────────────────────────────────────────────────────────────────
   • Trilhas GENERATIVAS e ORIGINAIS: sintetizadas em tempo real com a Web Audio API.
     Nenhum arquivo de áudio, sample ou música licenciada. Cada sessão usa uma
     semente aleatória, então a mesma trilha nunca soa exatamente igual duas vezes.
     Trilhas: jazz noturno · louvor sereno · acústico calmo · sala & chuva.
   • Player discreto na barra superior (tocar/pausar, trocar trilha, volume).
     O som só começa com um toque seu (regra de autoplay dos navegadores).
   • Slideshow contínuo no Início: imagens liminares trocando lentamente.
     Respeita “reduzir movimento” do sistema operacional.
*/
(function () {
  "use strict";

  const KEY = "espaco-liminar-ambiente-v1";
  const $ = (s) => document.querySelector(s);

  /* ── utilidades ─────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

  /* ── preferências salvas ────────────────────────────── */
  const saved = { track: "jazz", vol: 0.5 };
  try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* sem dados */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ok */ } }

  /* ── motor de áudio ─────────────────────────────────── */
  let ctx = null, master = null, bus = null, noiseBuf = null;
  let session = null; // sessão de trilha em andamento

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = saved.vol;
    master.connect(ctx.destination);

    // barramento com um pouco de reverberação (sala vazia)
    bus = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 0.7;
    const verb = ctx.createConvolver(); verb.buffer = impulse(3.4, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    bus.connect(dry); dry.connect(master);
    bus.connect(verb); verb.connect(wet); wet.connect(master);

    // ruído branco de 2 s (base de chiado, chuva e escova de bateria)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  /* nota com ataque curto e decaimento exponencial (cordas, marimba, sino) */
  function tone(s, t, o) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.value = o.f;
    osc.detune.value = o.detune || 0;
    const a = o.a || 0.01, tau = o.tau || 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.setTargetAtTime(0, t + a, tau);
    let last = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp;
      g.connect(f); last = f;
    }
    osc.connect(g);
    last.connect(s.out);
    osc.start(t);
    osc.stop(t + a + tau * 5 + 0.05);
  }

  /* acorde sustentado com entrada e saída lentas (pads) */
  function hold(s, t, o) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || "sawtooth";
    osc.frequency.value = o.f;
    osc.detune.value = o.detune || 0;
    const a = o.a || 1.2, r = o.r || 1.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.setValueAtTime(o.gain, t + o.dur);
    g.gain.linearRampToValueAtTime(0, t + o.dur + r);
    let last = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp;
      g.connect(f); last = f;
    }
    osc.connect(g);
    last.connect(s.out);
    osc.start(t);
    osc.stop(t + o.dur + r + 0.1);
  }

  /* ruído filtrado curto (escova de bateria, gotas de chuva) */
  function hiss(s, t, o) {
    const d = o.dur || 0.05;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = o.f; f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.003);
    g.gain.linearRampToValueAtTime(0, t + d);
    src.connect(f); f.connect(g); g.connect(s.out);
    src.start(t, Math.random() * Math.max(0, noiseBuf.duration - d - 0.1), d + 0.05);
  }

  /* ── trilhas (cada uma gera um compasso de 16 semicolcheias por vez) ── */
  const TRACKS = {
    /* Jazz noturno · ii–V–I com sétimas, baixo caminhante, escova e melodia esparsa (Dórico/pentatônica) */
    jazz: {
      nome: "Jazz noturno", bpm: 88,
      prog: [
        { tones: [62, 65, 69, 72], bass: 38 }, // Dm7
        { tones: [67, 71, 74, 77], bass: 43 }, // G7
        { tones: [64, 67, 71, 74], bass: 36 }, // Cmaj7
        { tones: [61, 64, 67, 70], bass: 45 }, // A7
      ],
      scale: [62, 65, 67, 69, 72],
      step(s, n, t, c, nx) {
        const i = n % 16, r = s.rnd;
        if (i % 4 === 0) { // baixo caminhante
          const b = i / 4;
          const note = [c.bass, c.tones[1] - 24, c.tones[2] - 24, nx.bass - 1][b];
          tone(s, t, { type: "triangle", f: hz(note), gain: 0.13, tau: 0.22, a: 0.012, lp: 600 });
        }
        if (i === 2 || i === 10) { // comping de piano elétrico suave
          if (r() < 0.75) c.tones.slice(1).forEach((m) => tone(s, t, { f: hz(m), gain: 0.03, tau: 0.6, a: 0.02, detune: 4, lp: 2400 }));
        }
        if (i % 8 === 4) hiss(s, t, { f: 7000, q: 1.2, gain: 0.05, dur: 0.07 }); // escova nos tempos 2 e 4
        else if (i % 2 === 1 && r() < 0.4) hiss(s, t, { f: 7000, q: 1.2, gain: 0.012, dur: 0.04 });
        if ([0, 6, 10, 12].includes(i) && r() < 0.28) { // melodia esparsa
          const oct = r() < 0.15 ? 12 : 0;
          tone(s, t, { type: "triangle", f: hz(pick(r, this.scale) + oct), gain: 0.07, tau: 0.35, a: 0.01, detune: 3, lp: 3000 });
        }
      },
    },

    /* Louvor sereno · I–V–vi–IV em sol maior, pads lentos, sinos esparsos e baixo de sub */
    louvor: {
      nome: "Louvor sereno", bpm: 60,
      prog: [
        { tones: [55, 59, 62, 67], bass: 43 }, // G
        { tones: [54, 57, 62, 66], bass: 38 }, // D/F#
        { tones: [52, 55, 59, 62], bass: 40 }, // Em7
        { tones: [48, 55, 60, 64], bass: 36 }, // C
      ],
      scale: [67, 69, 71, 74, 76],
      step(s, n, t, c) {
        const i = n % 16, r = s.rnd;
        if (i === 0) {
          const dur = 16 * s.stepDur;
          c.tones.forEach((m) => {
            hold(s, t, { f: hz(m), gain: 0.016, dur, a: 1.8, r: 2.0, lp: 900, detune: -6 });
            hold(s, t, { f: hz(m), gain: 0.016, dur, a: 1.8, r: 2.0, lp: 900, detune: 6 });
          });
          hold(s, t, { type: "sine", f: hz(c.bass), gain: 0.06, dur, a: 0.8, r: 2.0 });
        }
        if ((i === 0 || i === 8) && r() < 0.35 || (i === 4 || i === 12) && r() < 0.2) {
          const f = hz(pick(r, this.scale));
          tone(s, t, { f, gain: 0.05, tau: 1.8, a: 0.01 });
          tone(s, t, { f: f * 2, gain: 0.008, tau: 0.9, a: 0.01 }); // parcial agudo, timbre de sino
        }
      },
    },

    /* Acústico calmo · Am–F–C–G, arpejo de dedilhado (violão/harpa) com variações */
    acustico: {
      nome: "Acústico calmo", bpm: 72,
      prog: [
        { tones: [57, 60, 64, 69], bass: 45 }, // Am
        { tones: [53, 57, 60, 65], bass: 41 }, // F
        { tones: [52, 55, 60, 64], bass: 36 }, // C
        { tones: [55, 59, 62, 67], bass: 43 }, // G
      ],
      step(s, n, t, c) {
        const i = n % 16, r = s.rnd;
        const PAT = [0, 1, 2, 3, 2, 1];
        if (i % 2 === 0 && r() < 0.85) { // arpejo de semicolcheias alternadas
          const k = r() < 0.15 ? Math.floor(r() * 4) : PAT[Math.floor(n / 2) % PAT.length];
          const m = c.tones[k] + (r() < 0.2 ? 12 : 0);
          tone(s, t, { type: "triangle", f: hz(m), gain: 0.06, tau: 0.55, a: 0.005, lp: 3200 });
        }
        if (i === 0) tone(s, t, { f: hz(c.bass), gain: 0.12, tau: 1.2, a: 0.02 }); // baixo do compasso
        if (i === 8 && r() < 0.3) tone(s, t, { f: hz(c.tones[3] + 12), gain: 0.03, tau: 0.9, a: 0.01 }); // harmônico
      },
    },

    /* Sala & chuva · drones lentos, chuva contínua (ruído filtrado com respiração) e gotas esparsas */
    chuva: {
      nome: "Sala & chuva", bpm: 60,
      prog: [
        { tones: [38, 45], bass: 38, fifth: 45 }, // D2 / A2
        { tones: [41, 48], bass: 41, fifth: 48 }, // F2 / C3
        { tones: [36, 43], bass: 36, fifth: 43 }, // C2 / G2
        { tones: [43, 50], bass: 43, fifth: 50 }, // G2 / D3
      ],
      start(s) {
        // chuva: ruído grave com oscilação lenta de intensidade + chiado agudo
        const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 0.4;
        const rg = ctx.createGain(); rg.gain.value = 0.2;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
        const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
        lfo.connect(lfoG); lfoG.connect(rg.gain);
        rain.connect(lp); lp.connect(rg); rg.connect(s.out);

        const hissSrc = ctx.createBufferSource(); hissSrc.buffer = noiseBuf; hissSrc.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4200; bp.Q.value = 0.5;
        const hg = ctx.createGain(); hg.gain.value = 0.04;
        hissSrc.connect(bp); bp.connect(hg); hg.connect(s.out);

        // sala: drone grave e suave
        const d1 = ctx.createOscillator(); d1.type = "sawtooth"; d1.frequency.value = hz(38);
        const d2 = ctx.createOscillator(); d2.type = "sawtooth"; d2.frequency.value = hz(45); d2.detune.value = 3;
        const dl = ctx.createBiquadFilter(); dl.type = "lowpass"; dl.frequency.value = 300;
        const dg = ctx.createGain(); dg.gain.value = 0.035;
        d1.connect(dl); d2.connect(dl); dl.connect(dg); dg.connect(s.out);

        rain.start(); hissSrc.start(); lfo.start(); d1.start(); d2.start();
        s.nodes.push(rain, hissSrc, lfo, d1, d2);
        s.drone = [d1, d2];
      },
      step(s, n, t, c) {
        const i = n % 16, r = s.rnd;
        if (i === 0 && Math.floor(n / 16) % 2 === 0 && s.drone) { // troca de drone a cada 2 compassos
          s.drone[0].frequency.setTargetAtTime(hz(c.bass), t, 0.8);
          s.drone[1].frequency.setTargetAtTime(hz(c.fifth), t, 0.8);
        }
        if (r() < 0.22) hiss(s, t, { f: 2000 + r() * 4000, q: 3, gain: 0.02 + r() * 0.02, dur: 0.03 }); // gotas
        if (r() < 0.035) { // pingo de sino de sala
          tone(s, t, { f: hz(pick(r, [74, 77, 79, 81, 86])), gain: 0.045, tau: 1.4, a: 0.01 });
        }
      },
    },
  };

  /* inicia uma sessão de trilha: agenda notas com antecedência (lookahead) */
  function play(id) {
    if (!ensureCtx()) return false;
    if (ctx.state === "suspended") ctx.resume();
    if (session) stop();
    const def = TRACKS[id] || TRACKS.jazz;
    const now = ctx.currentTime;
    const s = {
      def, out: ctx.createGain(), nodes: [], drone: null, step: 0,
      stepDur: 60 / def.bpm / 4,            // semicolcheia
      rnd: mulberry32((Math.random() * 4294967296) >>> 0), // semente nova = variação nova
      nextT: now + 0.25, timer: null,
    };
    s.out.gain.setValueAtTime(0, now);
    s.out.gain.linearRampToValueAtTime(1, now + 2.5); // entrada suave
    s.out.connect(bus);
    if (def.start) def.start(s);
    s.timer = setInterval(() => {
      while (s.nextT < ctx.currentTime + 0.8) {
        const bar = Math.floor(s.step / 16);
        const c = def.prog[bar % def.prog.length];
        const nx = def.prog[(bar + 1) % def.prog.length];
        def.step(s, s.step, s.nextT, c, nx);
        s.step++;
        s.nextT += s.stepDur;
      }
    }, 100);
    session = s;
    return true;
  }

  /* encerra a sessão com desvanecimento e libera os nós */
  function stop() {
    const s = session;
    if (!s) return;
    session = null;
    clearInterval(s.timer);
    const now = ctx.currentTime;
    s.out.gain.cancelScheduledValues(now);
    s.out.gain.setTargetAtTime(0, now, 0.35);
    setTimeout(() => {
      s.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* já parado */ } });
      s.out.disconnect();
    }, 2800);
  }

  /* ── player na barra superior ───────────────────────── */
  function initPlayer() {
    const btn = $("#ambPlay"), sel = $("#ambTrack"), vol = $("#ambVol");
    if (!btn || !sel || !vol) return;
    if (!(window.AudioContext || window.webkitAudioContext)) {
      btn.disabled = true; btn.title = "Seu navegador não suporta áudio ambiente";
      return;
    }
    sel.value = TRACKS[saved.track] ? saved.track : "jazz";
    vol.value = String(saved.vol);

    const paint = () => {
      const on = !!session;
      btn.textContent = on ? "❚❚" : "▶";
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Pausar trilha ambiente" : "Tocar trilha ambiente");
      btn.title = (on ? "Pausar · " : "Tocar · ") + TRACKS[sel.value].nome;
    };

    btn.addEventListener("click", () => {
      if (session) stop();
      else play(sel.value);
      paint();
    });
    sel.addEventListener("change", () => {
      saved.track = sel.value; save();
      if (session) play(sel.value);
      paint();
    });
    vol.addEventListener("input", () => {
      saved.vol = Number(vol.value); save();
      if (master) master.gain.setTargetAtTime(saved.vol, ctx.currentTime, 0.05);
    });
    paint();
  }

  /* ── slideshow contínuo do Início ───────────────────── */
  function initSlideshow() {
    const slides = Array.from(document.querySelectorAll(".hero-slides .hero-img"));
    if (!slides.length) return;
    const dotsBox = document.getElementById("heroDots");
    let i = 0;

    const dots = slides.map((_, k) => {
      if (!dotsBox) return null;
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "Mostrar imagem " + (k + 1));
      b.addEventListener("click", () => go(k));
      dotsBox.appendChild(b);
      return b;
    });

    function go(k) {
      slides[i].classList.remove("is-on");
      if (dots[i]) dots[i].classList.remove("is-on");
      i = k;
      slides[i].classList.add("is-on");
      if (dots[i]) dots[i].classList.add("is-on");
    }
    go(0);

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || slides.length < 2) return;
    setInterval(() => { if (!document.hidden) go((i + 1) % slides.length); }, 7000);
  }

  initPlayer();
  initSlideshow();
})();
