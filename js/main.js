/* ==========================================================================
   Alessandra Massoterapia
   ========================================================================== */

// Numero do WhatsApp (formato internacional, somente digitos). Troque aqui uma
// unica vez e todos os botoes da pagina passam a usar o novo numero.
const WHATSAPP_NUMERO = "5531987135506";
const WHATSAPP_MENSAGEM = "Olá, Alessandra! Gostaria de agendar um horário.";

const WHATSAPP_URL =
  "https://wa.me/" + WHATSAPP_NUMERO + "?text=" + encodeURIComponent(WHATSAPP_MENSAGEM);

document.querySelectorAll("[data-whatsapp]").forEach((el) => {
  el.href = WHATSAPP_URL;
  el.target = "_blank";
  el.rel = "noopener";
});

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

/* ---------- revelacao no scroll ---------- */

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

