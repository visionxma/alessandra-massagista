// =====================================================================
// Service worker
//
// Estrategia: o app (interface) e servido do cache para abrir instantaneo
// mesmo sem rede. Os DADOS nunca sao cacheados aqui: quem cuida disso e o
// proprio Firestore, que ja tem persistencia offline e sincroniza sozinho.
// =====================================================================

// Subir esta versao a cada mudanca no painel: o service worker
// descarta o cache antigo e serve os arquivos novos.
const VERSAO = "agenda-v7";

const ESSENCIAIS = [
  "./",
  "./index.html",
  "./css/painel.css",
  "./js/painel.js",
  "./js/dados.js",
  "./js/config.js",
  "./manifest.webmanifest",
  "./icons/icone-192.png",
  "./icons/icone-512.png"
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Chamadas ao Firebase/Google sempre vao para a rede.
  // Cachear isso quebraria o tempo real e a autenticacao.
  if (!url.origin.includes(self.location.origin)) return;

  // Navegacao: rede primeiro, cache como reserva (funciona offline)
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
          return resp;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Demais arquivos: cache primeiro, atualizando em segundo plano
  evento.respondWith(
    caches.match(req).then((cacheado) => {
      const rede = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copia = resp.clone();
            caches.open(VERSAO).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => cacheado);

      return cacheado || rede;
    })
  );
});
