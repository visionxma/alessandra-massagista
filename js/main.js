/* ==========================================================================
   Alessandra Massagista
   Os botoes de agendamento apontam direto para /agendar/ no HTML.
   ========================================================================== */

/* ---------- navegacao: fundo ao rolar ---------- */

const nav = document.querySelector(".nav");
const heroSentinel = document.createElement("div");
heroSentinel.style.cssText = "position:absolute;top:24px;height:1px;width:1px;";
document.body.prepend(heroSentinel);

new IntersectionObserver(
  ([entry]) => nav.classList.toggle("is-scrolled", !entry.isIntersecting)
).observe(heroSentinel);

/* ---------- menu mobile ---------- */

const toggle = document.querySelector(".nav__toggle");
const mobileMenu = document.querySelector(".nav__mobile");

function fecharMenu() {
  mobileMenu.classList.remove("is-open");
  toggle.classList.remove("is-open");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Abrir menu");
  document.body.style.overflow = "";
}

toggle.addEventListener("click", () => {
  const open = mobileMenu.classList.toggle("is-open");
  mobileMenu.hidden = false;
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  if (!nav.classList.contains("is-scrolled")) nav.classList.toggle("is-scrolled", open);
  document.body.style.overflow = open ? "hidden" : "";
});

mobileMenu.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", fecharMenu)
);

/* ---------- revelacao no scroll, em cascata ----------
   Cada elemento .reveal surge com um pequeno atraso em relacao ao
   anterior da MESMA secao. Isso cria um ritmo (titulo, texto, itens
   um apos o outro) que conduz o olhar e deixa a rolagem gostosa,
   sem que nada apareça de uma vez so. O atraso e limitado para os
   ultimos itens de listas longas nao demorarem demais. */

const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* pre-calcula o atraso de cada .reveal conforme a ordem dentro do seu
   bloco pai (secao). Guarda em --d, que o CSS ja usa na transicao. */
if (!semMovimento) {
  document.querySelectorAll("section, footer").forEach((bloco) => {
    const itens = bloco.querySelectorAll(".reveal");
    itens.forEach((el, i) => {
      const atraso = Math.min(i * 90, 620); // 90ms entre itens, teto de 620ms
      el.style.setProperty("--d", atraso + "ms");
    });
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

/* ---------- galeria "momentos": esconde o play quando o video toca ---------- */

document.querySelectorAll(".momento--video video").forEach((video) => {
  const card = video.closest(".momento--video");
  video.addEventListener("play", () => card.classList.add("is-playing"));
  video.addEventListener("pause", () => card.classList.remove("is-playing"));
  video.addEventListener("ended", () => card.classList.remove("is-playing"));
});

/* ---------- carrossel Momentos ----------
   Setas navegam por card (1 por clique). Dots refletem o card mais
   visivel no viewport da trilha. O scroll manual (arrastar/deslizar)
   ja funciona nativamente via CSS scroll-snap; aqui so orquestramos
   setas + indicadores. */

(function inicializarCarrosselMomentos() {
  const trilha = document.getElementById("momentos-trilha");
  if (!trilha) return;

  const cards = [...trilha.querySelectorAll(".momento")];
  const setaEsq = document.getElementById("carrossel-esq");
  const setaDir = document.getElementById("carrossel-dir");
  const containerPontos = document.getElementById("carrossel-pontos");

  if (!cards.length) return;

  // monta os dots (um por card)
  cards.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "carrossel__ponto";
    b.setAttribute("aria-label", `Ir para foto ${i + 1}`);
    b.dataset.i = String(i);
    if (i === 0) b.setAttribute("aria-current", "true");
    containerPontos.appendChild(b);
  });
  const pontos = [...containerPontos.querySelectorAll(".carrossel__ponto")];

  // rola ate o card `i` centralizando (block: nearest evita rolar a pagina)
  function irPara(i) {
    const alvo = cards[Math.max(0, Math.min(cards.length - 1, i))];
    if (!alvo) return;
    alvo.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // devolve o indice do card mais proximo do centro da trilha
  function cardAtivo() {
    const centroTrilha = trilha.scrollLeft + trilha.clientWidth / 2;
    let melhor = 0, menorDist = Infinity;
    cards.forEach((c, i) => {
      const centro = c.offsetLeft + c.offsetWidth / 2;
      const d = Math.abs(centro - centroTrilha);
      if (d < menorDist) { menorDist = d; melhor = i; }
    });
    return melhor;
  }

  // atualiza dot ativo + habilita/desabilita setas nas extremidades
  function sincronizar() {
    const atual = cardAtivo();
    pontos.forEach((p, i) => {
      if (i === atual) p.setAttribute("aria-current", "true");
      else p.removeAttribute("aria-current");
    });
    if (setaEsq) setaEsq.hidden = atual === 0;
    if (setaDir) setaDir.hidden = atual === cards.length - 1;
  }

  // debounce simples pra nao rodar sincronizar() a cada pixel de scroll
  let raf = null;
  trilha.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { sincronizar(); raf = null; });
  }, { passive: true });

  setaEsq?.addEventListener("click", () => irPara(cardAtivo() - 1));
  setaDir?.addEventListener("click", () => irPara(cardAtivo() + 1));

  containerPontos.addEventListener("click", (e) => {
    const b = e.target.closest(".carrossel__ponto");
    if (b) irPara(Number(b.dataset.i));
  });

  // teclado: setas navegam quando o carrossel esta em foco
  trilha.setAttribute("tabindex", "0");
  trilha.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); irPara(cardAtivo() - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); irPara(cardAtivo() + 1); }
  });

  sincronizar();
})();

