/* Espaço Liminar — player de música
   Interface do motor de trilhas generativas (js/ambiente.js → window.Ambiente).
   - botão compacto na barra do topo + painel com faixa atual, anterior/tocar/próxima, volume e a lista das 4 trilhas;
   - o navegador só libera áudio depois de um clique: nada toca sozinho, e tudo aqui nasce de um gesto da pessoa;
   - lembra a faixa e o volume (localStorage, chave espaco-liminar-ambiente-v1);
   - se o navegador não tiver Web Audio, a interface inteira some em vez de mostrar botões mortos. */
(function () {
  "use strict";
  var A = window.Ambiente;
  var root = document.getElementById("player");
  var heroBtn = document.getElementById("btnTrilha");

  if (!A || !A.supported) {
    if (root) root.hidden = true;
    if (heroBtn) heroBtn.hidden = true;
    return;
  }
  if (!root) return;

  var $ = function (id) { return document.getElementById(id); };
  var toggle = $("playerToggle"), panel = $("playerPanel"), btnClose = $("ppClose");
  var elIcon = $("ppIcon"), elTitle = $("ppTitle"), elDesc = $("ppDesc");
  var btnPrev = $("ppPrev"), btnPlay = $("ppPlay"), btnNext = $("ppNext");
  var elVol = $("ppVol"), elVolOut = $("ppVolOut"), elLive = $("ppLive");
  var heroTxt = $("btnTrilhaText");
  var rows = Array.prototype.slice.call(root.querySelectorAll(".pp-track"));
  var KEY = "espaco-liminar-ambiente-v1";

  var DEFS = {};
  A.tracks.forEach(function (t) { DEFS[t.id] = t; });
  rows.forEach(function (b) { if (!DEFS[b.getAttribute("data-track")]) b.parentNode.hidden = true; });

  function toast(msg) { if (window.EspacoLiminar) window.EspacoLiminar.toast(msg); }

  /* ── preferências ── */
  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  var saved = { track: null, volume: null };
  function savePrefs(s) {
    if (saved.track === s.track && saved.volume === s.volume) return;
    saved = { track: s.track, volume: s.volume };
    try { localStorage.setItem(KEY, JSON.stringify({ track: s.track, volume: s.volume })); } catch (e) { /* sem localStorage */ }
  }

  /* ── interface ← estado do motor ── */
  var last = { track: null, playing: null };
  function say(msg) {            // leitores de tela: anuncia só o que a pessoa acabou de mudar
    if (!elLive) return;
    elLive.textContent = "";
    setTimeout(function () { elLive.textContent = msg; }, 30);
  }
  function render(s) {
    var def = DEFS[s.track] || A.tracks[0];
    var pct = Math.round(s.volume * 100);
    root.classList.toggle("is-playing", !!s.playing);
    toggle.setAttribute("aria-label", s.playing ? "Trilha sonora, tocando: " + def.nome : "Trilha sonora");
    toggle.title = s.playing ? "Tocando: " + def.nome : "Trilha sonora";
    elIcon.textContent = def.icone;
    elTitle.textContent = def.nome;
    elDesc.textContent = def.descricao;
    btnPlay.setAttribute("aria-label", s.playing ? "Pausar" : "Tocar");
    rows.forEach(function (b) {
      var on = b.getAttribute("data-track") === s.track;
      b.classList.toggle("is-current", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (Number(elVol.value) !== pct) elVol.value = String(pct);
    elVol.style.setProperty("--pct", pct + "%");
    elVol.setAttribute("aria-valuetext", pct + "%");
    elVolOut.textContent = pct + "%";
    if (heroBtn) {
      heroBtn.setAttribute("aria-pressed", String(!!s.playing));
      if (heroTxt) heroTxt.textContent = s.playing ? "Pausar a trilha" : "Ouvir a trilha";
    }
    if (last.track !== null && (last.track !== s.track || last.playing !== s.playing)) {
      say((s.playing ? "Tocando: " : "Pausado: ") + def.nome);
    }
    last = { track: s.track, playing: !!s.playing };
    savePrefs(s);
    if (s.error) toast(s.error + ". Tente de novo com um toque no botão de tocar.");
  }

  /* ── painel (popover) ── */
  function isOpen() { return !panel.hidden; }
  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }
  function closePanel(giveFocusBack) {
    if (!isOpen()) return;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (giveFocusBack) toggle.focus();
  }
  toggle.addEventListener("click", function () { if (isOpen()) closePanel(false); else openPanel(); });
  if (btnClose) btnClose.addEventListener("click", function () { closePanel(true); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { closePanel(true); }
  });
  document.addEventListener("pointerdown", function (e) {
    if (isOpen() && !root.contains(e.target)) closePanel(false);
  }, true);

  /* ── controles (cada um roda dentro do clique da pessoa, como o navegador exige) ── */
  btnPlay.addEventListener("click", function () { A.toggle(); });
  btnPrev.addEventListener("click", function () { A.prev(); });
  btnNext.addEventListener("click", function () { A.next(); });
  rows.forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-track");
      if (A.playing && A.current === id) A.pause(); else A.play(id);
    });
  });
  elVol.addEventListener("input", function () { A.setVolume(Number(elVol.value) / 100); });

  if (heroBtn) heroBtn.addEventListener("click", function () {
    var wasPlaying = A.playing;
    A.toggle();
    if (!wasPlaying && A.playing) {
      var def = DEFS[A.current];
      toast("\u266A " + (def ? def.nome : "Trilha") + " \u2014 o volume e as outras trilhas ficam no player, no topo.");
    }
  });

  /* ── arranque: restaura faixa e volume (sem tocar nada) ── */
  var p = readPrefs();
  if (typeof p.volume === "number" && isFinite(p.volume)) A.setVolume(p.volume);
  if (p.track && DEFS[p.track]) A.select(p.track);
  saved = { track: A.current, volume: A.volume };   // só grava de novo quando a pessoa mudar alguma coisa
  A.on(render);
  render({ playing: A.playing, track: A.current, volume: A.volume, error: null });
})();
