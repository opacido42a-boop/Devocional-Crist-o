/* Espaço Liminar — slideshow contínuo do menu principal (hero da página Início)
   Imagens liminares que passam devagar, cada uma com o versículo do Salmo que lhe corresponde.

   - a primeira imagem vem no HTML; as outras só são baixadas depois que a página terminou de carregar;
   - a imagem nova entra POR CIMA da anterior (nunca há "buraco" no meio do fade) e dá uma aproximação lenta;
   - pausa sozinho quando o hero sai da tela ou a aba fica em segundo plano (poupa CPU e bateria);
   - botão de pausa (lembrado no navegador), pontinhos para escolher a imagem, setas ← → no cartão;
   - respeita prefers-reduced-motion (sem zoom, transição curta). */
(function () {
  "use strict";
  var hero = document.getElementById("hero");
  var box = document.getElementById("heroSlides");
  if (!hero || !box) return;
  var slides = Array.prototype.slice.call(box.querySelectorAll(".hero-slide"));
  if (!slides.length) return;

  var HOLD = 8000;          // tempo entre uma troca e outra (ms)
  var FADE = 2400;          // duração da transição automática
  var FADE_MANUAL = 900;    // quando a pessoa escolhe a imagem
  var FADE_REDUCED = 700;   // prefers-reduced-motion
  var KEY = "espaco-liminar-slides-v1";
  var PSALMS = window.PSALMS || [];
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  var $ = function (id) { return document.getElementById(id); };
  var deck = $("heroDeck"), elNum = $("deckNum"), elPlace = $("deckPlace"), elVerse = $("deckVerse"),
      elRef = $("deckRef"), elDots = $("deckDots"), elPause = $("deckPause");

  var cur = 0, z = 1, seq = 0, wasRunning = false, inView = true;
  var timer = null, cleanTimer = null, swapA = null, swapB = null;
  var userPaused = readPaused();

  function readPaused() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}").paused === true; } catch (e) { return false; }
  }
  function writePaused() {
    try { localStorage.setItem(KEY, JSON.stringify({ paused: userPaused })); } catch (e) { /* sem localStorage */ }
  }
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function running() { return slides.length > 1 && !userPaused && inView && !document.hidden; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ── legenda: lugar + versículo exato do Salmo (texto ARC do próprio site) ── */
  function verseOf(s) {
    var n = Number(s.getAttribute("data-psalm")), v = Number(s.getAttribute("data-verse")), p = PSALMS[n - 1];
    var raw = p && p.verses && p.verses[v - 1];
    // a fonte do texto traz espaço antes de "!" e "," em alguns trechos ("Senhor ,"): arruma só a pontuação
    return raw ? { n: n, v: v, text: String(raw).replace(/\s+([!?,.;:])/g, "$1").trim() } : null;
  }
  function paintCaption(i) {
    var s = slides[i], v = verseOf(s);
    if (elNum) elNum.textContent = pad(i + 1) + " / " + pad(slides.length);
    if (elPlace) elPlace.textContent = s.getAttribute("data-place") || "";
    if (!elVerse || !elRef) return;
    if (v) {
      elVerse.textContent = "\u201C" + v.text + "\u201D";
      elRef.textContent = "Salmo " + v.n + ":" + v.v + " \u2192";
      elRef.setAttribute("data-psalm", String(v.n));
      elRef.setAttribute("aria-label", "Abrir o Salmo " + v.n);
      elRef.hidden = false;
    } else {
      elVerse.textContent = "";
      elRef.hidden = true;
    }
  }
  // a legenda some um instante, troca o texto e volta — no meio do crossfade, não antes dele
  function swapCaption(i, delay) {
    clearTimeout(swapA); clearTimeout(swapB);
    if (!deck) return;
    swapA = setTimeout(function () { deck.classList.add("is-swapping"); }, Math.max(0, delay - 300));
    swapB = setTimeout(function () { paintCaption(i); deck.classList.remove("is-swapping"); }, delay);
  }

  /* ── pontinhos ── */
  function buildDots() {
    if (!elDots) return;
    elDots.innerHTML = "";
    slides.forEach(function (s, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "deck-dot";
      b.setAttribute("aria-label", "Imagem " + (i + 1) + " de " + slides.length + ": " + (s.getAttribute("data-place") || ""));
      b.addEventListener("click", function () { go(i, true); });
      elDots.appendChild(b);
    });
    markDot(cur);
  }
  function markDot(i) {
    if (!elDots) return;
    Array.prototype.forEach.call(elDots.children, function (b, k) {
      b.classList.toggle("is-current", k === i);
      if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }

  /* ── carregamento das imagens ── */
  function imgOf(s) { return s.querySelector("img"); }
  // garante que a imagem esteja baixada e decodificada antes de começar o fade (sem "pisca" ao entrar)
  function ready(s, cb) {
    var img = imgOf(s);
    if (!img) return cb(false);
    var fail = function () { s.setAttribute("data-broken", "1"); cb(false); };
    var ok = function () { if (img.decode) img.decode().then(function () { cb(true); }, function () { cb(true); }); else cb(true); };
    if (!img.getAttribute("src") && img.getAttribute("data-src")) img.src = img.getAttribute("data-src");
    if (img.complete && img.naturalWidth > 0) return ok();
    if (img.complete && img.getAttribute("src")) return fail();
    img.addEventListener("load", ok, { once: true });
    img.addEventListener("error", fail, { once: true });
  }
  // depois do load da página, baixa as demais imagens uma de cada vez, sem competir com o resto
  function prefetchRest() {
    var queue = slides.slice(1);
    (function next() {
      var s = queue.shift();
      if (!s) return;
      var img = imgOf(s), src = img && !img.getAttribute("src") && img.getAttribute("data-src");
      if (!src) return next();
      var step = function () { setTimeout(next, 250); };
      img.addEventListener("load", step, { once: true });
      img.addEventListener("error", step, { once: true });
      img.src = src;
    })();
  }
  function afterLoad(fn) {
    if (document.readyState === "complete") setTimeout(fn, 600);
    else window.addEventListener("load", function () { setTimeout(fn, 600); });
  }

  /* ── troca de imagem ── */
  function nextWorking(from) {
    for (var k = 1; k <= slides.length; k++) {
      var j = (from + k) % slides.length;
      if (!slides[j].hasAttribute("data-broken")) return j;
    }
    return -1;
  }
  function go(i, manual) {
    var n = slides.length;
    i = ((i % n) + n) % n;
    if (i === cur) { schedule(); return; }
    var token = ++seq;
    ready(slides[i], function (ok) {
      if (token !== seq) return;                       // veio outro pedido enquanto a imagem carregava
      if (!ok) {                                       // imagem com erro: pula para a próxima que funcione
        var alt = nextWorking(i);
        if (alt !== -1 && alt !== cur) go(alt, manual); else schedule();
        return;
      }
      show(i, manual);
    });
  }
  function show(i, manual) {
    var prev = slides[cur], next = slides[i];
    var fade = reduced() ? FADE_REDUCED : manual ? FADE_MANUAL : FADE;
    hero.style.setProperty("--fade", fade + "ms");
    next.style.zIndex = String(++z);                   // entra por cima; a anterior segue opaca por baixo até o fim
    next.classList.remove("is-kb");
    void next.offsetWidth;                             // reinicia a animação de aproximação
    next.classList.add("is-kb");
    next.removeAttribute("aria-hidden");
    next.classList.add("is-in");
    prev.setAttribute("aria-hidden", "true");
    cur = i;
    markDot(i);
    swapCaption(i, manual ? 120 : Math.round(fade * 0.38));
    clearTimeout(cleanTimer);
    cleanTimer = setTimeout(function () {              // fade concluído: desmonta as camadas que ficaram por baixo
      slides.forEach(function (s, k) {
        if (k !== cur) { s.classList.remove("is-in", "is-kb"); s.style.zIndex = ""; }
      });
    }, fade + 150);
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!running()) return;
    timer = setTimeout(function () { go(cur + 1, false); }, HOLD);
  }

  /* ── pausa: botão, visibilidade da aba e rolagem ── */
  function update() {
    var r = running();
    hero.classList.toggle("is-paused", !r);
    if (elPause) {
      elPause.classList.toggle("is-paused", userPaused);
      elPause.setAttribute("aria-pressed", String(userPaused));
      elPause.setAttribute("aria-label", userPaused ? "Retomar a passagem das imagens" : "Pausar a passagem das imagens");
    }
    if (r && !wasRunning) schedule();
    if (!r) clearTimeout(timer);
    wasRunning = r;
  }

  /* ── arranque ── */
  buildDots();
  paintCaption(0);
  slides.forEach(function (s, k) { if (k !== 0) s.setAttribute("aria-hidden", "true"); });
  slides[0].classList.add("is-in", "is-kb");

  if (elPause) elPause.addEventListener("click", function () { userPaused = !userPaused; writePaused(); update(); });
  if (elRef) elRef.addEventListener("click", function () {
    var n = Number(elRef.getAttribute("data-psalm"));
    if (n && window.EspacoLiminar) window.EspacoLiminar.openPsalm(n);
  });
  if (deck) deck.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1, true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1, true); }
  });
  document.addEventListener("visibilitychange", update);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      update();
    }, { threshold: 0.12 }).observe(hero);
  }
  afterLoad(prefetchRest);
  update();
})();
