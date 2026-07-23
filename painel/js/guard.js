// Anti-clickjacking / frame-busting.
// frame-ancestors e X-Frame-Options so funcionam via header HTTP, que o
// GitHub Pages nao permite definir. Este guard impede que o painel seja
// exibido dentro de um iframe de outro site (UI redressing).
(function () {
  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location;
    } catch (e) {
      // se nem redirecionar for possivel, esconde tudo
      document.documentElement.style.display = "none";
    }
  }
})();
