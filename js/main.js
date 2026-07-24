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

toggle.addEventListener("click", () => {
  const open = mobileMenu.classList.toggle("is-open");
  mobileMenu.hidden = false;
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  if (!nav.classList.contains("is-scrolled")) nav.classList.toggle("is-scrolled", open);
});

mobileMenu.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  })
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

