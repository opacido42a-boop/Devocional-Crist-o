/* Espaço Liminar — Devocional · lógica da aplicação (sem servidor, tudo no navegador) */
(function () {
  "use strict";
  const PSALMS = window.PSALMS || [];
  const CATS = window.CATEGORIES || {};
  const PCATS = window.PSALM_CATS || {};
  const TITLES = window.PSALM_TITLES || {};
  const EXPL = window.EXPLANATIONS || {};
  const ANCHORS = window.ANCHORS || {};
  const KEY = "espaco-liminar-devocional-v1";
  const MARKERS = [
    { id: "azul", nome: "Azul", cor: "#8fb3e8" },
    { id: "lilas", nome: "Lilás", cor: "#bda3e3" },
    { id: "verde", nome: "Verde", cor: "#93c48d" },
    { id: "amarelo", nome: "Amarelo", cor: "#ecd35f" },
  ];
  const PROMPTS = [
    "O que Deus falou comigo neste Salmo?",
    "Qual versículo vou guardar no bolso hoje?",
    "O que preciso entregar, confessar ou agradecer?",
    "Como este Salmo muda minha oração de amanhã?",
  ];

  /* ── estado (localStorage) ─────────────────────────── */
  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign({ read: {}, reflections: {}, highlights: {}, lastPsalm: null }, JSON.parse(raw));
    } catch (e) { /* sem dados ainda */ }
    return { read: {}, reflections: {}, highlights: {}, lastPsalm: null };
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast("Não foi possível salvar neste navegador."); }
      renderProgress();
    }, 120);
  }

  /* ── utilidades ────────────────────────────────────── */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const psalm = (n) => PSALMS[n - 1];
  const verseText = (n, v) => (psalm(n) && psalm(n).verses[v - 1]) || "";
  const catsOf = (n) => PCATS[n] || [];
  const isRead = (n) => !!state.read[n];
  const hasReflection = (n) => !!(state.reflections[n] && state.reflections[n].text.trim());
  const hlCount = (n) => Object.keys(state.highlights).filter((k) => k.startsWith(n + "-")).length;
  const todayPsalmNumber = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const day = Math.floor((now - start) / 864e5);
    return ((day - 1) % 150) + 1;
  };
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ── navegação ─────────────────────────────────────── */
  let currentView = "home";
  let currentPsalm = null;
  let activeMarker = "amarelo";
  let activeCat = "todas";
  function show(view, opts) {
    opts = opts || {};
    currentView = view;
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
    $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.nav === view || (view === "reader" && b.dataset.nav === "psalms")));
    if (view === "psalms") renderPsalmGrid();
    if (view === "feelings") renderFeelings(opts.cat);
    if (view === "diary") renderDiary();
    if (view === "home") renderHome();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    if (opts.cat && view === "feelings") {
      setTimeout(() => { const el = document.getElementById("room-" + opts.cat); if (el) el.scrollIntoView({ behavior: "smooth" }); }, 80);
    }
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { show(nav.dataset.nav); }
  });

  /* ── progresso ─────────────────────────────────────── */
  function renderProgress() {
    const readCount = Object.keys(state.read).length;
    $("#progressLabel").textContent = readCount + " / 150 lidos";
    $("#progressFill").style.width = (readCount / 150 * 100).toFixed(1) + "%";
  }

  /* ── início ────────────────────────────────────────── */
  function renderHome() {
    const n = todayPsalmNumber();
    const p = psalm(n);
    // versículo de hoje: gira pelos versículos do Salmo do dia
    const day = Math.floor(Date.now() / 864e5);
    const vIdx = p ? day % p.verses.length : 0;
    $("#todayCard").innerHTML = `
      <p class="mono-label">✦ Salmo de hoje · dia ${day % 365} do ano</p>
      <h3>Salmo ${n} — ${esc(TITLES[n] || "")}</h3>
      <p class="today-verse">“${esc(p ? p.verses[vIdx] : "")}”</p>
      <p class="today-ref">Salmos ${n}:${vIdx + 1} · Almeida Revista e Corrigida</p>
      ${EXPL[n] ? `<p style="color:var(--ink-soft);font-size:.93rem;margin-top:14px"><strong>Em palavras simples:</strong> ${esc(EXPL[n].resumo)}</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
        <button class="btn btn-solid btn-sm" data-open="${n}">Ler o Salmo ${n} inteiro →</button>
        <button class="btn btn-ghost btn-sm" data-nav="feelings">Estou precisando de…</button>
      </div>`;

    const readCount = Object.keys(state.read).length;
    const next = state.lastPsalm && !isRead(state.lastPsalm) ? state.lastPsalm
      : (PSALMS.find((x) => !isRead(x.n)) || {}).n || 150;
    $("#continueText").innerHTML = state.lastPsalm
      ? `Sua última parada foi o <strong>Salmo ${state.lastPsalm}</strong> (${esc(TITLES[state.lastPsalm] || "")}). A próxima porta aberta é o <strong>Salmo ${next}</strong>.`
      : `Você ainda não começou a travessia. A porta do <strong>Salmo 1</strong> está aberta — “Bem-aventurado…”.`;
    $("#btnContinue").onclick = () => openPsalm(next);
    $("#statsRow").innerHTML = `
      <div class="stat"><b>${readCount}</b><span>Salmos lidos</span></div>
      <div class="stat"><b>${Object.keys(state.highlights).length}</b><span>versículos grifados</span></div>
      <div class="stat"><b>${Object.values(state.reflections).filter((r) => r.text.trim()).length}</b><span>reflexões</span></div>
      <div class="stat"><b>${Math.round(readCount / 150 * 100)}%</b><span>da travessia</span></div>`;

    $("#doorsGrid").innerHTML = Object.entries(CATS).map(([id, c]) => {
      const count = PSALMS.filter((x) => catsOf(x.n).includes(id)).length;
      return `<button class="door" data-door="${id}">
        <span class="door-emoji">${c.emoji}</span>
        <h3>${esc(c.nome)}</h3><p>${esc(c.desc)}</p>
        <span class="door-count">${count} Salmos nesta sala →</span></button>`;
    }).join("");
    $$("#doorsGrid [data-door]").forEach((b) => b.addEventListener("click", () => show("feelings", { cat: b.dataset.door })));

    $("#famousRow").innerHTML = Array.from(window.FAMOUS || []).slice(0, 8).map((n) => `
      <button class="famous-card" data-open="${n}">
        <span class="famous-tag">✦ clássico</span>
        <span class="f-num">${n}</span>
        <h3>${esc(TITLES[n] || "Salmo " + n)}</h3>
        <p>${esc(EXPL[n].resumo)}</p>
      </button>`).join("");
    bindOpenButtons($("#todayCard").parentElement);
  }
  function bindOpenButtons(scope) {
    $$("[data-open]", scope).forEach((b) => b.addEventListener("click", () => openPsalm(Number(b.dataset.open))));
  }

  /* ── lista de Salmos ───────────────────────────────── */
  function renderCatChips() {
    const chips = [{ id: "todas", nome: "Todas as salas" }].concat(Object.entries(CATS).map(([id, c]) => ({ id, nome: c.emoji + " " + c.nome })));
    $("#catChips").innerHTML = chips.map((c) =>
      `<button class="chip ${activeCat === c.id ? "is-active" : ""}" data-chip="${c.id}">${esc(c.nome)}</button>`).join("");
    $$("#catChips [data-chip]").forEach((b) => b.addEventListener("click", () => { activeCat = b.dataset.chip; renderCatChips(); renderPsalmGrid(); }));
  }
  function filteredPsalms() {
    const q = norm($("#searchInput").value.trim());
    const status = $("#statusFilter").value;
    return PSALMS.filter((p) => {
      if (activeCat !== "todas" && !catsOf(p.n).includes(activeCat)) return false;
      if (status === "lidos" && !isRead(p.n)) return false;
      if (status === "nao-lidos" && isRead(p.n)) return false;
      if (status === "famosos" && !(window.FAMOUS && window.FAMOUS.has(p.n))) return false;
      if (status === "grifados" && hlCount(p.n) === 0) return false;
      if (status === "reflexao" && !hasReflection(p.n)) return false;
      if (q) {
        const inTitle = norm(TITLES[p.n]).includes(q) || String(p.n) === q.replace(/\D/g, "") && q.replace(/\D/g, "") !== "";
        const inText = p.verses.some((v) => norm(v).includes(q));
        if (!inTitle && !inText) return false;
        p._snippet = p.verses.find((v) => norm(v).includes(q)) || "";
      } else p._snippet = "";
      return true;
    });
  }
  function renderPsalmGrid() {
    renderCatChips();
    const list = filteredPsalms();
    $("#resultCount").textContent = list.length + (list.length === 1 ? " Salmo encontrado" : " Salmos encontrados");
    $("#emptyMsg").hidden = list.length > 0;
    $("#psalmGrid").innerHTML = list.map((p) => `
      <button class="psalm-card ${isRead(p.n) ? "is-read" : ""}" data-open="${p.n}">
        <span class="p-top"><span class="p-num">${p.n}</span>
          ${isRead(p.n) ? '<span class="p-read-badge">✓ lido</span>' : (window.FAMOUS && window.FAMOUS.has(p.n) ? '<span class="p-star" title="Salmo clássico">✦</span>' : "")}
        </span>
        <h3>${esc(TITLES[p.n] || "")}</h3>
        <span class="p-meta">${p.verses.length} versículos</span>
        <span class="p-tags">${catsOf(p.n).map((c) => `<span class="tag">${esc(CATS[c].nome)}</span>`).join("")}</span>
        ${p._snippet ? `<span class="p-snippet">“…${esc(p._snippet)}”</span>` : ""}
        <span class="p-marks">
          ${hlCount(p.n) ? `<span>🎨 ${hlCount(p.n)} grifo${hlCount(p.n) > 1 ? "s" : ""}</span>` : ""}
          ${hasReflection(p.n) ? `<span>✎ reflexão</span>` : ""}
        </span>
      </button>`).join("");
    bindOpenButtons($("#psalmGrid"));
  }
  $("#searchInput").addEventListener("input", renderPsalmGrid);
  $("#statusFilter").addEventListener("change", renderPsalmGrid);

  /* ── leitura ───────────────────────────────────────── */
  function openPsalm(n) {
    currentPsalm = n;
    state.lastPsalm = n; save();
    renderReader();
    show("reader");
  }
  function renderReader() {
    const n = currentPsalm, p = psalm(n);
    if (!p) return;
    const expl = EXPL[n];
    $("#readerBody").innerHTML = `
      <div class="reader-head">
        <p class="mono-label">livro de Salmos · Almeida revista e corrigida</p>
        <div class="p-num-big">${n}</div>
        <h2>${esc(TITLES[n] || "Salmo " + n)}</h2>
        <p class="mono-label">${p.verses.length} versículos ${window.FAMOUS && window.FAMOUS.has(n) ? "· ✦ Salmo clássico" : ""}</p>
        <div class="reader-tags">${catsOf(n).map((c) => `<span class="tag">${CATS[c].emoji} ${esc(CATS[c].nome)}</span>`).join("")}</div>
      </div>

      ${expl ? `<div class="explain-box">
        <p class="mono-label">✦ em palavras simples</p>
        <h3>Do que fala o Salmo ${n}?</h3>
        <p>${esc(expl.resumo)}</p>
        <p class="when"><strong>Quando ler:</strong> ${esc(expl.quando)}</p>
      </div>` : ""}

      <div class="reader-actions">
        <button class="btn ${isRead(n) ? "btn-read is-done" : "btn-solid"} btn-read" id="btnRead">
          ${isRead(n) ? "✓ Lido — toque para desmarcar" : "Marcar como lido"}</button>
        <button class="btn btn-ghost" id="btnCopyPsalm">⧉ Copiar Salmo</button>
      </div>

      <div class="highlighter" role="group" aria-label="Marca-texto">
        <span class="mono-label">marca-texto</span>
        ${MARKERS.map((m) => `<button class="marker-btn ${activeMarker === m.id ? "is-active" : ""}" data-marker="${m.id}">
          <span class="dot" style="background:${m.cor}"></span>${m.nome}</button>`).join("")}
        <button class="marker-btn marker-eraser ${activeMarker === "borracha" ? "is-active" : ""}" data-marker="borracha">⌫ Borracha</button>
      </div>
      <p class="hint">Escolha uma cor e <strong>toque num versículo</strong> para grifar. Toque de novo (ou use a borracha) para apagar. O botão ⧉ copia o versículo.</p>

      <div class="verses">
        ${p.verses.map((v, i) => {
          const color = state.highlights[n + "-" + (i + 1)];
          return `<div class="verse ${color ? "is-hl-" + color : ""}" data-verse="${i + 1}" role="button" tabindex="0"
                     aria-label="Versículo ${i + 1}${color ? ", grifado de " + color : ""}">
            <span class="v-num">${i + 1}</span><span class="v-text">${esc(v)}</span>
            <button class="v-copy" data-copy="${i + 1}" title="Copiar versículo" aria-label="Copiar versículo ${i + 1}">⧉</button></div>`;
        }).join("")}
      </div>

      <div class="reader-nav">
        <button class="btn btn-ghost" id="btnPrev" ${n <= 1 ? "disabled style='opacity:.4'" : ""}>← Salmo ${n - 1}</button>
        <button class="btn btn-ghost" id="btnNext" ${n >= 150 ? "disabled style='opacity:.4'" : ""}>Salmo ${n + 1} →</button>
      </div>

      <div class="reflection">
        <p class="mono-label">caderno · só você lê isto</p>
        <h3>✎ Minha reflexão — Salmo ${n}</h3>
        <p style="color:var(--ink-soft);margin:0">O que Deus falou com você nesta leitura? Escreva livremente; salva sozinho, neste navegador.</p>
        <div class="reflection-prompts">${PROMPTS.map((pr) => `<button class="prompt-chip" data-prompt="${esc(pr)}">${esc(pr)}</button>`).join("")}</div>
        <textarea id="reflectionText" placeholder="Hoje, neste Salmo, Deus me lembrou que…">${esc(state.reflections[n] ? state.reflections[n].text : "")}</textarea>
        <div class="reflection-foot">
          <span class="save-state" id="saveState">${state.reflections[n] && state.reflections[n].updated ? "salvo · " + new Date(state.reflections[n].updated).toLocaleString("pt-BR") : "nada escrito ainda"}</span>
          <span style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="btnClearReflection">Limpar</button>
            <button class="btn btn-solid btn-sm" id="btnReadBottom">${isRead(n) ? "✓ Lido" : "Marcar como lido e continuar →"}</button>
          </span>
        </div>
      </div>`;

    /* interações do leitor */
    $$("#readerBody [data-marker]").forEach((b) => b.addEventListener("click", () => {
      activeMarker = b.dataset.marker;
      $$("#readerBody [data-marker]").forEach((x) => x.classList.toggle("is-active", x === b));
    }));
    const applyHl = (verseEl) => {
      const key = n + "-" + verseEl.dataset.verse;
      if (activeMarker === "borracha" || state.highlights[key] === activeMarker) delete state.highlights[key];
      else state.highlights[key] = activeMarker;
      verseEl.className = "verse" + (state.highlights[key] ? " is-hl-" + state.highlights[key] : "");
      save();
    };
    $$("#readerBody .verse").forEach((el) => {
      el.addEventListener("click", (e) => { if (!e.target.closest("[data-copy]")) applyHl(el); });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyHl(el); } });
    });
    $$("#readerBody [data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const txt = `“${verseText(n, Number(b.dataset.copy))}” — Salmos ${n}:${b.dataset.copy} (ARC)`;
      try { await navigator.clipboard.writeText(txt); toast("versículo copiado ✓"); }
      catch (e) { toast(txt); }
    }));
    const toggleRead = (goNext) => {
      if (isRead(n)) { delete state.read[n]; toast("Salmo " + n + " desmarcado."); }
      else { state.read[n] = Date.now(); toast("Salmo " + n + " marcado como lido ✓ Que bom atravessar esta sala."); }
      save(); renderReader();
      if (goNext && isRead(n) && n < 150) setTimeout(() => openPsalm(n + 1), 450);
      window.scrollTo({ top: 0 });
    };
    $("#btnRead").addEventListener("click", () => toggleRead(false));
    $("#btnReadBottom").addEventListener("click", () => toggleRead(true));
    $("#btnCopyPsalm").addEventListener("click", async () => {
      const txt = `SALMO ${n} — ${TITLES[n] || ""} (Almeida Revista e Corrigida)\n\n` + p.verses.map((v, i) => (i + 1) + ". " + v).join("\n");
      try { await navigator.clipboard.writeText(txt); toast("Salmo " + n + " copiado inteiro ✓"); } catch (e) { toast("Não foi possível copiar."); }
    });
    const prev = $("#btnPrev"), next = $("#btnNext");
    if (prev) prev.addEventListener("click", () => n > 1 && openPsalm(n - 1));
    if (next) next.addEventListener("click", () => n < 150 && openPsalm(n + 1));

    const ta = $("#reflectionText");
    ta.addEventListener("input", () => {
      $("#saveState").textContent = "escrevendo…";
      clearTimeout(ta._t);
      ta._t = setTimeout(() => {
        if (ta.value.trim()) state.reflections[n] = { text: ta.value, updated: Date.now() };
        else delete state.reflections[n];
        save();
        $("#saveState").textContent = ta.value.trim() ? "✓ salvo · " + new Date().toLocaleString("pt-BR") : "nada escrito ainda";
      }, 500);
    });
    $$("#readerBody [data-prompt]").forEach((b) => b.addEventListener("click", () => {
      ta.value = (ta.value ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + b.dataset.prompt + "\n";
      ta.focus(); ta.dispatchEvent(new Event("input"));
    }));
    $("#btnClearReflection").addEventListener("click", () => {
      if (!ta.value || confirm("Apagar a reflexão do Salmo " + n + "?")) { ta.value = ""; ta.dispatchEvent(new Event("input")); }
    });
  }
  $("#btnBack").addEventListener("click", () => show("psalms"));
  $("#btnToday").addEventListener("click", () => openPsalm(todayPsalmNumber()));

  /* ── por sentimento ────────────────────────────────── */
  function renderFeelings() {
    $("#feelingsBody").innerHTML = Object.entries(CATS).map(([id, c]) => {
      const nums = PSALMS.filter((p) => catsOf(p.n).includes(id)).map((p) => p.n);
      const anchors = (ANCHORS[id] || []).map(([n, v]) => ({ n, v, text: verseText(n, v) })).filter((a) => a.text);
      return `<article class="feeling-room" id="room-${id}">
        <p class="mono-label">sala · ${nums.length} Salmos</p>
        <h3>${c.emoji} ${esc(c.nome)}</h3>
        <p class="f-desc">${esc(c.desc)}</p>
        ${anchors.map((a) => `<button class="anchor" data-open="${a.n}"><p>“${esc(a.text)}”</p><span>Salmos ${a.n}:${a.v} — ler o Salmo inteiro →</span></button>`).join("")}
        <div class="room-psalms">${nums.map((n) => `<button class="room-psalm" data-open="${n}">${isRead(n) ? "✓ " : ""}Salmo ${n} <small>· ${esc(TITLES[n] || "")}</small></button>`).join("")}</div>
      </article>`;
    }).join("");
    bindOpenButtons($("#feelingsBody"));
  }

  /* ── diário ────────────────────────────────────────── */
  function renderDiary() {
    const refs = Object.entries(state.reflections).filter(([, r]) => r.text.trim())
      .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
    const hls = Object.entries(state.highlights)
      .map(([k, cor]) => { const [n, v] = k.split("-").map(Number); return { n, v, cor, text: verseText(n, v) }; })
      .filter((h) => h.text).sort((a, b) => a.n - b.n || a.v - b.v);
    const readList = Object.keys(state.read).map(Number).sort((a, b) => a - b);
    const colorName = (id) => (MARKERS.find((m) => m.id === id) || {}).nome || id;

    $("#diaryBody").innerHTML = `
      <div class="diary-section"><h3>✎ Minhas reflexões (${refs.length})</h3>
        ${refs.length ? refs.map(([n, r]) => `<button class="diary-item" data-open="${n}">
            <h4>Salmo ${n} — ${esc(TITLES[n] || "")}</h4>
            <span class="d-date">${r.updated ? new Date(r.updated).toLocaleString("pt-BR") : ""}</span>
            <p>${esc(r.text.length > 320 ? r.text.slice(0, 320) + "…" : r.text)}</p>
            <span class="d-date">toque para continuar escrevendo →</span></button>`).join("")
          : `<p class="diary-empty">Nenhuma reflexão ainda. Abra um Salmo, leia devagar e escreva a primeira linha — ela não precisa ser bonita, só verdadeira. 🌿</p>`}
      </div>
      <div class="diary-section"><h3>🎨 Meus grifos (${hls.length})</h3>
        ${hls.length ? MARKERS.map((m) => {
            const mine = hls.filter((h) => h.cor === m.id);
            if (!mine.length) return "";
            return `<p class="mono-label" style="margin:16px 0 8px"><span class="chip-inline hl-${m.id}">marca-texto ${m.nome.toLowerCase()}</span> · ${mine.length}</p>` +
              mine.map((h) => `<button class="diary-item" data-open="${h.n}"><p><span class="hl-verse-text hl-${h.cor}">“${esc(h.text)}”</span></p>
                <span class="d-date">Salmos ${h.n}:${h.v} — abrir →</span></button>`).join("");
          }).join("")
          : `<p class="diary-empty">Nenhum versículo grifado ainda. No Salmo, escolha uma cor de marca-texto e toque no versículo que falar com você.</p>`}
      </div>
      <div class="diary-section"><h3>✓ Salmos lidos (${readList.length} de 150)</h3>
        ${readList.length ? `<div class="room-psalms">${readList.map((n) => `<button class="room-psalm" data-open="${n}">✓ Salmo ${n}</button>`).join("")}</div>`
          : `<p class="diary-empty">Sua travessia ainda não começou. O Salmo 1 está logo ali, com a porta aberta.</p>`}
      </div>`;
    bindOpenButtons($("#diaryBody"));
  }
  $("#btnExport").addEventListener("click", () => {
    const refs = Object.entries(state.reflections).filter(([, r]) => r.text.trim()).sort((a, b) => Number(a[0]) - Number(b[0]));
    const hls = Object.entries(state.highlights).sort();
    let md = "# Meu Diário — Espaço Liminar Devocional\n\nExportado em " + new Date().toLocaleString("pt-BR") +
      "\nSalmos lidos: " + Object.keys(state.read).length + " de 150\n";
    md += "\n## Reflexões\n";
    md += refs.length ? refs.map(([n, r]) => `\n### Salmo ${n} — ${TITLES[n] || ""}\n*${r.updated ? new Date(r.updated).toLocaleString("pt-BR") : ""}*\n\n${r.text}\n`).join("") : "\n_(nenhuma ainda)_\n";
    md += "\n## versículos grifados\n";
    md += hls.length ? hls.map(([k, cor]) => { const [n, v] = k.split("-"); return `- **[${cor}]** “${verseText(Number(n), Number(v))}” — Salmos ${n}:${v}`; }).join("\n") : "_(nenhum ainda)_";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    a.download = "meu-diario-devocional.md"; a.click(); URL.revokeObjectURL(a.href);
    toast("Diário exportado ✓ Guarde com carinho.");
  });
  $("#btnClear").addEventListener("click", () => {
    if (confirm("Apagar TODOS os dados (lidos, grifos e reflexões) deste navegador? Não dá para desfazer.")) {
      state = { read: {}, reflections: {}, highlights: {}, lastPsalm: null };
      localStorage.removeItem(KEY); renderProgress(); renderDiary(); renderHome();
      toast("Tudo apagado. O espaço ficou vazio de novo — pronto para recomeçar.");
    }
  });

  /* ── arranque ──────────────────────────────────────── */
  renderProgress(); renderHome(); renderCatChips();
  if (!PSALMS.length) toast("Não foi possível carregar os Salmos. Recarregue a página.");
})();
