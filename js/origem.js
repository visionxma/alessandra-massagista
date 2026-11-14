/* ==========================================================================
   Origem de cada contato no WhatsApp
   A Alessandra conta de onde veio cada cliente na propria conversa, sem
   depender de painel: a mensagem pronta diz a pagina de onde a pessoa
   clicou e, se chegou por um link do Instagram (?utm_source=instagram),
   diz "Vim pelo Instagram". A origem fica em sessionStorage para continuar
   valendo quando a pessoa navega para outras paginas do site.
   Sem JavaScript, o link continua com a mensagem generica do HTML.
   ========================================================================== */
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

(function () {
  var NOMES = {
    "massagem-relaxante": "massagem relaxante",
    "massagem-tantrica": "massagem tântrica",
    "massagem-nuru": "massagem nuru",
    "massagem-lingam": "massagem lingam",
    "massagem-mix": "massagem mix",
    "massagem-para-casais": "massagem para casais",
    "spa-dos-pes": "spa dos pés"
  };

  /* paginas que nao sao de servico: o nome vai inteiro na mensagem */
  var PAGINAS = {
    "massagista-padre-eustaquio": "página do Padre Eustáquio",
    "massagista-lagoinha": "página da Lagoinha",
    "massagista-bonfim": "página do Bonfim",
    "massagista-centro-bh": "página do Centro",
    "artigos": "página de artigos",
    "quanto-custa-massagem-tantrica-em-bh": "artigo sobre o valor da massagem tântrica",
    "diferenca-entre-nuru-e-tantrica": "artigo sobre nuru e tântrica",
    "primeira-sessao-o-que-esperar": "artigo sobre a primeira sessão"
  };

  var origem = "";
  try {
    var utm = new URLSearchParams(location.search).get("utm_source");
    if (utm && utm.toLowerCase() === "instagram") sessionStorage.setItem("origem-contato", "instagram");
    origem = sessionStorage.getItem("origem-contato") || "";
  } catch (e) { /* armazenamento bloqueado: segue sem guardar a origem */ }

  var slug = location.pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
  var pagina = NOMES[slug] ? "página de " + NOMES[slug] : (PAGINAS[slug] || "página inicial");

  var vim = origem === "instagram" ? "Vim pelo Instagram (" + pagina + ")" : "Vim pela " + pagina;
  var texto = "Olá, Alessandra. " + vim + " e gostaria de tirar uma dúvida.";

  document.querySelectorAll('a[href^="https://wa.me/"]').forEach(function (a) {
    var base = a.getAttribute("href").split("?")[0];
    a.setAttribute("href", base + "?text=" + encodeURIComponent(texto));
  });
})();
