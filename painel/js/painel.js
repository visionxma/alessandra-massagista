// =====================================================================
// Painel de agendamentos - logica da interface
// =====================================================================

import { MODO_DEMO } from "./config.js";
import * as dados from "./dados.js";

// ---------------------------------------------------------------------
// Atalhos e utilitarios
// ---------------------------------------------------------------------

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const doisDig = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`;
const chaveDia = (d) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`;
const mesmoDia = (a, b) => chaveDia(a) === chaveDia(b);

const inicioDoDia = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const fimDoDia = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

const ROTULO_STATUS = {
  pendente: "A confirmar",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado"
};

function dataPorExtenso(d) {
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

function saudacao(h) {
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------

const estado = {
  agendamentos: [],
  bloqueios: [],
  abaAtual: "hoje",
  mesVisivel: new Date(),
  diaEscolhido: new Date(),
  filtro: "todos",
  busca: "",
  servicos: dados.SERVICOS_PADRAO,
  servicoEscolhido: 0,
  config: dados.CONFIG_PADRAO,
  periodoCaixa: "dia",
  cancelarEscuta: null,
  cancelarEscutaBloqueios: null,
  cancelarEscutaConfig: null,
  cancelarEscutaServicos: null,
  carregando: true
};

// bloqueio de dia inteiro
const diaBloqueado = (d) =>
  estado.bloqueios.find((b) => b.diaTodo !== false && mesmoDia(b.inicio, d));

// todos os bloqueios que tocam este dia, inclusive faixas
const bloqueiosDoDia = (d) =>
  estado.bloqueios
    .filter((b) => mesmoDia(b.inicio, d))
    .sort((a, b) => a.inicio - b.inicio);

// ---------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------

// recebe CENTAVOS e devolve o valor em reais formatado
const emReais = (centavos) =>
  ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2
  }).replace(/ /g, " ");

// Aceita "150", "150,00", "R$ 1.500,50" e tambem "150.50".
// O separador decimal e o ULTIMO ponto ou virgula; o que vier antes
// e separador de milhar e some.
function paraCentavos(texto) {
  const so = String(texto).replace(/[^\d.,]/g, "");
  if (!so) return 0;

  const ultimoSep = Math.max(so.lastIndexOf(","), so.lastIndexOf("."));
  let inteiros = so, decimais = "";

  if (ultimoSep !== -1) {
    const depois = so.slice(ultimoSep + 1);
    // 1 ou 2 digitos apos o separador = centavos; 3 digitos = milhar
    if (depois.length <= 2 && depois.length > 0) {
      inteiros = so.slice(0, ultimoSep);
      decimais = depois;
    }
  }

  const n = Number(inteiros.replace(/[.,]/g, "")) || 0;
  const c = Number(decimais.padEnd(2, "0")) || 0;
  return n * 100 + c;
}

// ---------------------------------------------------------------------
// Avisos de novo agendamento: som, vibracao e notificacao do sistema
// ---------------------------------------------------------------------

const alertas = {
  ligado: localStorage.getItem("avisos_ligados") === "sim",
  idsConhecidos: new Set(),
  primeiraCarga: true,
  audio: null,

  // Toque gerado na hora: duas notas curtas, sem arquivo externo
  tocar() {
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === "suspended") this.audio.resume();

      const agora = this.audio.currentTime;
      [[880, 0], [1320, 0.16]].forEach(([hz, atraso]) => {
        const osc = this.audio.createOscillator();
        const vol = this.audio.createGain();
        osc.type = "sine";
        osc.frequency.value = hz;
        vol.gain.setValueAtTime(0, agora + atraso);
        vol.gain.linearRampToValueAtTime(0.22, agora + atraso + 0.02);
        vol.gain.exponentialRampToValueAtTime(0.001, agora + atraso + 0.42);
        osc.connect(vol).connect(this.audio.destination);
        osc.start(agora + atraso);
        osc.stop(agora + atraso + 0.45);
      });
    } catch { /* som e um extra: se falhar, o resto do aviso continua */ }
  },

  async pedirPermissao() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  },

  async alternar() {
    if (this.ligado) {
      this.ligado = false;
      localStorage.setItem("avisos_ligados", "nao");
      atualizarSino();
      avisar("Avisos desligados");
      return;
    }

    const ok = await this.pedirPermissao();
    this.ligado = true;
    localStorage.setItem("avisos_ligados", "sim");
    atualizarSino();
    this.tocar();   // confirma que o som funciona
    avisar(ok ? "Avisos ligados" : "Avisos ligados (sem notificação do sistema)", "bom");
  },

  notificar(item) {
    if (!this.ligado) return;

    this.tocar();
    if (navigator.vibrate) navigator.vibrate([90, 60, 90]);

    $("#sino-ponto").hidden = false;
    const sino = $("#btn-sino");
    sino.classList.add("sino--tocando");
    setTimeout(() => sino.classList.remove("sino--tocando"), 800);

    const quando = mesmoDia(item.inicio, new Date())
      ? `hoje às ${hhmm(item.inicio)}`
      : `${item.inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} às ${hhmm(item.inicio)}`;

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Novo agendamento", {
          body: `${item.clienteNome} · ${item.servicoNome}\n${quando}`,
          icon: "icons/icone-192.png",
          badge: "icons/icone-192.png",
          tag: "agendamento-" + item.id
        });
      } catch { /* alguns navegadores exigem service worker */ }
    }

    avisar(`Novo agendamento: ${item.clienteNome}`, "bom");
  },

  // Compara a lista nova com a anterior e avisa sobre o que chegou
  conferir(lista) {
    const novos = lista.filter(
      (a) => !this.idsConhecidos.has(a.id) && a.origem === "site" && a.status === "pendente"
    );

    lista.forEach((a) => this.idsConhecidos.add(a.id));

    // a primeira carga traz o historico inteiro: nao e novidade
    if (this.primeiraCarga) {
      this.primeiraCarga = false;
      return;
    }

    novos.forEach((a) => this.notificar(a));
  }
};

function atualizarSino() {
  const sino = $("#btn-sino");
  sino.classList.toggle("sino--ativo", alertas.ligado);
  sino.setAttribute(
    "aria-label",
    alertas.ligado ? "Desativar avisos de novo agendamento" : "Ativar avisos de novo agendamento"
  );
  sino.title = alertas.ligado ? "Avisos ligados" : "Avisos desligados";
}

// ---------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------

let avisoTimer;
function avisar(texto, tipo = "") {
  const el = $("#aviso");
  el.textContent = texto;
  el.className = "aviso" + (tipo ? ` aviso--${tipo}` : "");
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, 2800);
  if (navigator.vibrate) navigator.vibrate(tipo === "ruim" ? [40, 60, 40] : 18);
}

// ---------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------

async function iniciar() {
  const { demo } = await dados.iniciar();

  if (demo) $("#aviso-demo").hidden = false;

  dados.observarLogin((usuario) => {
    if (usuario) abrirApp();
    else mostrarLogin();
  });

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const senha = $("#login-senha").value;
    const erro = $("#login-erro");
    const botao = $("#btn-entrar");

    erro.hidden = true;
    botao.disabled = true;
    botao.textContent = "Entrando...";

    try {
      await dados.entrar(email, senha);
    } catch (ex) {
      erro.textContent = mensagemLogin(ex);
      erro.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = "Entrar";
    }
  });

  $("#btn-demo")?.addEventListener("click", abrirApp);
  $("#btn-sair").addEventListener("click", async () => {
    await dados.sair();
    if (MODO_DEMO) mostrarLogin();
  });

  $("#btn-sino").addEventListener("click", () => alertas.alternar());

  // ao voltar para o painel, some o ponto de nao lido
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) $("#sino-ponto").hidden = true;
  });

  ligarNavegacao();
  ligarFolhas();
  ligarFormularios();
  ligarFiltros();
  ligarCalendario();
  ligarCaixa();
  ligarAjustes();
  ligarServicos();
  monitorarConexao();
  registrarPWA();
}

function mensagemLogin(ex) {
  const c = ex?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "E-mail ou senha incorretos.";
  if (c.includes("too-many-requests"))
    return "Muitas tentativas. Aguarde alguns minutos.";
  if (c.includes("network"))
    return "Sem conexão. Verifique a internet.";
  return "Não foi possível entrar. Tente novamente.";
}

function mostrarLogin() {
  $("#tela-login").hidden = false;
  $("#app").hidden = true;
  estado.cancelarEscuta?.();
}

async function abrirApp() {
  $("#tela-login").hidden = true;
  $("#app").hidden = false;

  const agora = new Date();
  $("#saudacao").textContent = saudacao(agora.getHours());
  $("#data-hoje").textContent = dataPorExtenso(agora).replace(/^./, (c) => c.toUpperCase());

  atualizarSino();

  estado.servicos = await dados.lerServicos();
  montarServicos();
  escutarPeriodo();
  desenharCalendario();

  setInterval(atualizarContagem, 30000);

  // a fila de lembretes depende da hora atual: reavalia a cada minuto
  setInterval(avisarLembretesPendentes, 60000);
}

// ---------------------------------------------------------------------
// Escuta dos agendamentos (tempo real)
// ---------------------------------------------------------------------

function escutarPeriodo() {
  estado.cancelarEscuta?.();

  // janela ampla: cobre historico recente e agenda futura
  const de = new Date(); de.setMonth(de.getMonth() - 3); de.setHours(0,0,0,0);
  const ate = new Date(); ate.setMonth(ate.getMonth() + 6); ate.setHours(23,59,59,999);

  mostrarEsqueleto();

  estado.cancelarEscuta = dados.observarAgendamentos(de, ate, (lista, erro) => {
    estado.carregando = false;
    if (erro) {
      avisar("Não foi possível carregar a agenda.", "ruim");
      return;
    }
    estado.agendamentos = lista;
    alertas.conferir(lista);
    redesenhar();
  });

  estado.cancelarEscutaBloqueios?.();
  estado.cancelarEscutaBloqueios = dados.observarBloqueios((lista) => {
    estado.bloqueios = lista;
    desenharCalendario();
    desenharDiaEscolhido();
  });

  estado.cancelarEscutaConfig?.();
  estado.cancelarEscutaConfig = dados.observarConfig((cfg) => {
    estado.config = cfg;
    preencherAjustes();
  });

  estado.cancelarEscutaServicos?.();
  estado.cancelarEscutaServicos = dados.observarServicos((lista) => {
    estado.servicos = lista;
    montarServicos();
    desenharListaServicos();
  });
}

function mostrarEsqueleto() {
  const alvo = $("#lista-hoje");
  alvo.innerHTML = Array.from({ length: 3 })
    .map(() => `<div class="esqueleto"></div>`).join("");
}

function redesenhar() {
  desenharHoje();
  desenharCalendario();
  desenharDiaEscolhido();
  desenharClientes();
  desenharCaixa();
}

// ---------------------------------------------------------------------
// Aba: Hoje
// ---------------------------------------------------------------------

function desenharHoje() {
  const hoje = new Date();
  const doDia = estado.agendamentos
    .filter((a) => mesmoDia(a.inicio, hoje))
    .sort((a, b) => a.inicio - b.inicio);

  const ativos = doDia.filter((a) => a.status !== "cancelado");
  $("#kpi-hoje").textContent = ativos.length;
  $("#kpi-pendentes").textContent = doDia.filter((a) => a.status === "pendente").length;
  $("#kpi-concluidos").textContent = doDia.filter((a) => a.status === "concluido").length;

  const agora = new Date();
  const proximo = doDia.find(
    (a) => a.fim > agora && (a.status === "pendente" || a.status === "confirmado")
  );

  const cartao = $("#proximo-cartao");
  if (proximo) {
    cartao.hidden = false;
    cartao.dataset.id = proximo.id;
    $("#proximo-hora").textContent = hhmm(proximo.inicio);
    $("#proximo-nome").textContent = proximo.clienteNome;
    $("#proximo-servico").textContent = proximo.servicoNome;
    atualizarContagem();
  } else {
    cartao.hidden = true;
  }

  $("#lista-hoje").innerHTML = doDia.length
    ? doDia.map(cartaoHTML).join("")
    : vazioHTML("Dia livre", "Nenhum atendimento marcado para hoje.");

  desenharProximos();
}

// ---------------------------------------------------------------------
// Proximos dias: tudo que vem depois de hoje, agrupado por data
// ---------------------------------------------------------------------

function desenharProximos() {
  const amanha = inicioDoDia(new Date());
  amanha.setDate(amanha.getDate() + 1);

  const futuros = estado.agendamentos
    .filter((a) => a.inicio >= amanha && a.status !== "cancelado")
    .sort((a, b) => a.inicio - b.inicio);

  $("#contador-proximos").textContent = futuros.length
    ? `${futuros.length} agendamento${futuros.length > 1 ? "s" : ""}`
    : "";

  avisarLembretesPendentes(futuros);

  if (!futuros.length) {
    $("#lista-proximos").innerHTML = vazioHTML(
      "Agenda livre",
      "Nenhum atendimento marcado para os próximos dias."
    );
    return;
  }

  let html = "";
  let ultimoDia = "";
  for (const a of futuros) {
    const k = chaveDia(a.inicio);
    if (k !== ultimoDia) {
      ultimoDia = k;
      html += `<p class="dia-rotulo">${rotuloDia(a.inicio)}</p>`;
    }
    html += cartaoHTML(a);
  }
  $("#lista-proximos").innerHTML = html;
}

// Fila de lembretes: mostra quem ja entrou na janela pedida pelo cliente
// e ainda nao foi avisado. O disparo e um toque, com a mensagem pronta.
function avisarLembretesPendentes() {
  const alvo = $("#fila-lembretes");
  if (!alvo) return;

  const agora = new Date();

  const naHora = estado.agendamentos
    .filter((a) => {
      if (a.status === "cancelado" || a.status === "concluido") return false;
      if (!a.clienteContato || a.lembreteEnviadoEm) return false;
      if (!a.lembreteMin) return false;             // cliente dispensou
      if (a.inicio <= agora) return false;          // ja passou
      const momento = new Date(a.inicio.getTime() - a.lembreteMin * 60000);
      return agora >= momento;                       // entrou na janela
    })
    .sort((a, b) => a.inicio - b.inicio);

  alvo.hidden = !naHora.length;
  if (!naHora.length) return;

  $("#fila-lembretes-texto").textContent = naHora.length === 1
    ? "1 lembrete para enviar"
    : `${naHora.length} lembretes para enviar`;

  $("#fila-lembretes-lista").innerHTML = naHora.map((a) => {
    const quando = mesmoDia(a.inicio, agora)
      ? `hoje às ${hhmm(a.inicio)}`
      : `${a.inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} às ${hhmm(a.inicio)}`;
    return `
      <div class="lembrete-linha">
        <span>
          <span class="lembrete-linha__nome">${escapar(a.clienteNome)}</span>
          <span class="lembrete-linha__quando">${a.servicoNome} · ${quando}</span>
        </span>
        <button class="btn-enviar" data-lembrar="${a.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.67c2.2 0 4.26.86 5.82 2.42a8.2 8.2 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23a8.2 8.2 0 0 1-4.19-1.15l-.3-.17-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c.01-4.54 3.7-8.24 8.25-8.24m-3.53 4.4c-.16 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1 2.56.13.17 1.76 2.67 4.25 3.73.59.27 1.05.42 1.41.53.59.19 1.13.16 1.56.1.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28-.25-.13-1.46-.72-1.69-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.96-.14.17-.29.19-.53.06-.25-.12-1.05-.38-1.99-1.22-.74-.66-1.23-1.47-1.38-1.72-.14-.24-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.55-1.35-.77-1.84-.2-.48-.4-.42-.55-.43z"/></svg>
          Enviar
        </button>
      </div>`;
  }).join("");
}

// Monta a mensagem do lembrete e abre a conversa com o cliente
async function dispararLembrete(a) {
  const mesmoDiaHoje = mesmoDia(a.inicio, new Date());
  const quando = mesmoDiaHoje
    ? `hoje às ${hhmm(a.inicio)}`
    : `${a.inicio.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}, às ${hhmm(a.inicio)}`;

  const texto =
    `Olá, ${a.clienteNome.split(" ")[0]}! Passando para lembrar do seu horário:\n\n` +
    `${a.servicoNome}\n${quando}\n` +
    `Rua Lagoa Santa, 11 - Carlos Prates\n\n` +
    `Qualquer imprevisto, é só avisar. Até lá!`;

  const so = (a.clienteContato || "").replace(/\D/g, "");
  if (so.length >= 10) {
    const numero = so.length <= 11 ? "55" + so : so;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  } else {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Mensagem copiada", "bom");
    } catch {
      avisar("Não foi possível copiar", "ruim");
    }
  }

  try {
    await dados.marcarLembreteEnviado(a.id);
    avisar("Lembrete marcado como enviado", "bom");
  } catch { /* o envio ja aconteceu */ }
}

function rotuloDia(d) {
  const hoje = inicioDoDia(new Date());
  const alvo = inicioDoDia(d);
  const dias = Math.round((alvo - hoje) / 86400000);

  if (dias === 1) return "Amanhã";
  if (dias < 7) return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function atualizarContagem() {
  const cartao = $("#proximo-cartao");
  if (cartao.hidden) return;
  const item = estado.agendamentos.find((a) => a.id === cartao.dataset.id);
  if (!item) return;

  const min = Math.round((item.inicio - new Date()) / 60000);
  const alvo = $("#proximo-contagem");

  if (min < -1) alvo.textContent = "Em andamento";
  else if (min <= 1) alvo.textContent = "Agora";
  else if (min < 60) alvo.textContent = `Em ${min} minutos`;
  else {
    const h = Math.floor(min / 60);
    const m = min % 60;
    alvo.textContent = m ? `Em ${h}h${doisDig(m)}` : `Em ${h}h`;
  }
}

// ---------------------------------------------------------------------
// Cartoes
// ---------------------------------------------------------------------

function escapar(t) {
  return String(t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cartaoHTML(a) {
  return `
    <button class="cartao cartao--${a.status}" data-id="${a.id}">
      <span class="cartao__hora">${hhmm(a.inicio)}</span>
      <span class="cartao__meio">
        <span class="cartao__nome">${escapar(a.clienteNome)}</span>
        <span class="cartao__servico">${escapar(a.servicoNome)}</span>
      </span>
      <span class="etiqueta etiqueta--${a.status}">${ROTULO_STATUS[a.status]}</span>
    </button>`;
}

function vazioHTML(titulo, texto) {
  return `<div class="vazio">
    <p class="vazio__titulo">${titulo}</p>
    <p class="vazio__texto">${texto}</p>
  </div>`;
}

// ---------------------------------------------------------------------
// Aba: Agenda (calendario)
// ---------------------------------------------------------------------

function desenharCalendario() {
  const base = estado.mesVisivel;
  const rotuloMes = base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("#mes-nome").textContent = rotuloMes.replace(/^./, (c) => c.toUpperCase());

  const ano = base.getFullYear();
  const mes = base.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const comeco = new Date(primeiro);
  comeco.setDate(comeco.getDate() - primeiro.getDay());

  // agrupa por dia para marcar os pontos
  const porDia = new Map();
  for (const a of estado.agendamentos) {
    if (a.status === "cancelado") continue;
    const k = chaveDia(a.inicio);
    if (!porDia.has(k)) porDia.set(k, new Set());
    porDia.get(k).add(a.status);
  }

  const hoje = new Date();
  let html = "";

  for (let i = 0; i < 42; i++) {
    const d = new Date(comeco);
    d.setDate(comeco.getDate() + i);

    const fora = d.getMonth() !== mes;
    const ehHoje = mesmoDia(d, hoje);
    const escolhido = mesmoDia(d, estado.diaEscolhido);
    const bloqueado = !!diaBloqueado(d);
    const status = porDia.get(chaveDia(d));

    const pontos = status
      ? [...status].slice(0, 3).map((s) => `<i class="dia__ponto dia__ponto--${s}"></i>`).join("")
      : "";

    html += `<button class="dia${fora ? " dia--fora" : ""}${ehHoje ? " dia--hoje" : ""}${escolhido ? " dia--escolhido" : ""}${bloqueado ? " dia--bloqueado" : ""}"
      data-data="${chaveDia(d)}" aria-label="${d.getDate()} de ${d.toLocaleDateString("pt-BR",{month:"long"})}${bloqueado ? ", sem atendimento" : ""}">
      <span>${d.getDate()}</span>
      <span class="dia__pontos">${pontos}</span>
    </button>`;
  }

  $("#calendario").innerHTML = html;
}

function desenharDiaEscolhido() {
  const d = estado.diaEscolhido;
  const hoje = mesmoDia(d, new Date());
  $("#dia-escolhido-titulo").textContent = hoje
    ? "Hoje"
    : dataPorExtenso(d).replace(/^./, (c) => c.toUpperCase());

  const lista = estado.agendamentos
    .filter((a) => mesmoDia(a.inicio, d))
    .sort((a, b) => a.inicio - b.inicio);

  // bloqueios do dia: dia inteiro e/ou faixas
  const bloqueios = bloqueiosDoDia(d);
  const diaInteiro = bloqueios.find((b) => b.diaTodo !== false);

  $("#faixa-bloqueio").hidden = !bloqueios.length;
  $("#faixa-bloqueio").innerHTML = bloqueios.map((b) => `
    <span class="faixa-bloqueio__linha">
      <span>${b.diaTodo !== false
        ? "Dia sem atendimento"
        : `Bloqueado das ${hhmm(b.inicio)} às ${hhmm(b.fim)}`}${b.motivo ? " · " + escapar(b.motivo) : ""}</span>
      <button class="link-mini" data-liberar="${b.id}">Liberar</button>
    </span>`).join("");

  $("#btn-bloquear").textContent = diaInteiro ? "Dia bloqueado" : "Bloquear";
  $("#btn-bloquear").disabled = !!diaInteiro;

  $("#lista-dia").innerHTML = lista.length
    ? lista.map(cartaoHTML).join("")
    : vazioHTML(
        diaInteiro ? "Dia sem atendimento" : "Nenhum atendimento",
        diaInteiro ? "Este dia está bloqueado na agenda." : "Toque no + para marcar um horário."
      );
}

function ligarCalendario() {
  $("#mes-anterior").addEventListener("click", () => {
    estado.mesVisivel = new Date(estado.mesVisivel.getFullYear(), estado.mesVisivel.getMonth() - 1, 1);
    desenharCalendario();
  });

  $("#mes-proximo").addEventListener("click", () => {
    estado.mesVisivel = new Date(estado.mesVisivel.getFullYear(), estado.mesVisivel.getMonth() + 1, 1);
    desenharCalendario();
  });

  $("#calendario").addEventListener("click", (e) => {
    const btn = e.target.closest(".dia");
    if (!btn) return;
    const [a, m, dd] = btn.dataset.data.split("-").map(Number);
    estado.diaEscolhido = new Date(a, m - 1, dd);
    desenharCalendario();
    desenharDiaEscolhido();
  });

  // abre a folha de bloqueio (dia inteiro ou so uma faixa)
  $("#btn-bloquear").addEventListener("click", () => {
    const d = estado.diaEscolhido;
    $("#bloqueio-dia").textContent = dataPorExtenso(d).replace(/^./, (c) => c.toUpperCase());
    $("#bloq-erro").hidden = true;
    $("#bloq-motivo").value = "";
    escolherTipoBloqueio("dia");
    abrir("#folha-bloqueio");
  });

  // alterna entre dia inteiro e faixa
  $("#bloqueio-tipo").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tipo]");
    if (btn) escolherTipoBloqueio(btn.dataset.tipo);
  });

  $("#btn-confirmar-bloqueio").addEventListener("click", async () => {
    const d = estado.diaEscolhido;
    const tipo = $("#bloqueio-tipo .opcao--escolhida")?.dataset.tipo || "dia";
    const motivo = $("#bloq-motivo").value.trim();
    const erro = $("#bloq-erro");
    const botao = $("#btn-confirmar-bloqueio");
    erro.hidden = true;

    botao.disabled = true;
    botao.textContent = "Bloqueando...";

    try {
      if (tipo === "dia") {
        await dados.bloquearDia(d, motivo);
        avisar("Dia bloqueado", "bom");
      } else {
        await dados.bloquearFaixa(d, $("#bloq-de").value, $("#bloq-ate").value, motivo);
        avisar("Horário bloqueado", "bom");
      }
      fechar("#folha-bloqueio");
    } catch (ex) {
      erro.textContent = ex?.codigo === "FAIXA_INVALIDA"
        ? "O horário final deve ser depois do inicial."
        : "Não foi possível bloquear. Tente de novo.";
      erro.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = "Bloquear";
    }
  });

  // liberar bloqueios do dia (toque na faixa vermelha)
  $("#faixa-bloqueio").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-liberar]");
    if (!btn) return;
    try {
      await dados.desbloquear(btn.dataset.liberar);
      avisar("Horário liberado", "bom");
    } catch {
      avisar("Não foi possível liberar", "ruim");
    }
  });
}

function escolherTipoBloqueio(tipo) {
  $$("#bloqueio-tipo .opcao").forEach((b) =>
    b.classList.toggle("opcao--escolhida", b.dataset.tipo === tipo));
  $("#bloqueio-faixa").hidden = tipo !== "faixa";
}

// ---------------------------------------------------------------------
// Aba: Historico
// ---------------------------------------------------------------------

// (a aba Historico virou lista de Clientes: ver desenharClientes)

function ligarFiltros() {
  let debounce;
  $("#campo-busca").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      estado.busca = e.target.value;
      desenharClientes();
    }, 180);
  });
}

// ---------------------------------------------------------------------
// Faturamento
// ---------------------------------------------------------------------

function periodoAtual() {
  const hoje = new Date();
  const de = inicioDoDia(hoje);
  const ate = fimDoDia(hoje);

  if (estado.periodoCaixa === "semana") {
    de.setDate(de.getDate() - de.getDay());          // domingo
    ate.setDate(de.getDate() + 6);
    ate.setHours(23, 59, 59, 999);
  } else if (estado.periodoCaixa === "mes") {
    de.setDate(1);
    ate.setMonth(ate.getMonth() + 1, 0);
    ate.setHours(23, 59, 59, 999);
  }
  return { de, ate };
}

function desenharCaixa() {
  const { de, ate } = periodoAtual();
  const noPeriodo = estado.agendamentos.filter((a) => a.inicio >= de && a.inicio <= ate);

  const concluidos = noPeriodo.filter((a) => a.status === "concluido");
  const previstos = noPeriodo.filter((a) => a.status === "pendente" || a.status === "confirmado");
  const cancelados = noPeriodo.filter((a) => a.status === "cancelado");

  const precoDe = (a) => a.precoCentavos || precoDoServico(a.servicoNome);
  const total = concluidos.reduce((s, a) => s + precoDe(a), 0);
  const aReceber = previstos.reduce((s, a) => s + precoDe(a), 0);

  const rotulos = { dia: "Hoje", semana: "Esta semana", mes: "Este mês" };
  $("#caixa-rotulo").textContent = rotulos[estado.periodoCaixa];
  $("#caixa-valor").textContent = emReais(total);

  $("#caixa-sub").textContent = concluidos.length
    ? `${concluidos.length} atendimento${concluidos.length > 1 ? "s" : ""} concluído${concluidos.length > 1 ? "s" : ""}` +
      (aReceber ? ` · ${emReais(aReceber)} a realizar` : "")
    : "Nenhum atendimento concluído ainda";

  $("#caixa-concluidos").textContent = concluidos.length;
  $("#caixa-previsto").textContent = previstos.length;
  $("#caixa-cancelados").textContent = cancelados.length;

  // agrupa por servico
  const porServico = new Map();
  for (const a of concluidos) {
    const chave = a.servicoNome || "Outro";
    const atual = porServico.get(chave) || { qtd: 0, total: 0 };
    atual.qtd += 1;
    atual.total += precoDe(a);
    porServico.set(chave, atual);
  }

  const linhas = [...porServico.entries()].sort((a, b) => b[1].total - a[1].total);

  $("#caixa-servicos").innerHTML = linhas.length
    ? linhas.map(([nome, v]) => `
        <div class="linha-servico">
          <span class="linha-servico__nome">${escapar(nome)}</span>
          <span class="linha-servico__valor">${emReais(v.total)}</span>
          <span class="linha-servico__qtd">${v.qtd} atendimento${v.qtd > 1 ? "s" : ""}</span>
        </div>`).join("")
    : vazioHTML("Sem movimento", "Marque atendimentos como concluídos para ver o faturamento.");

  $("#caixa-nota").hidden = !linhas.length;
}

function precoDoServico(nome) {
  const s = estado.servicos.find((x) => x.nome === nome);
  return s?.precoCentavos || 0;
}

function ligarCaixa() {
  $$("[data-periodo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("[data-periodo]").forEach((b) => b.classList.toggle("chip--ativo", b === btn));
      estado.periodoCaixa = btn.dataset.periodo;
      desenharCaixa();
    });
  });
}

// ---------------------------------------------------------------------
// Clientes: agrupa o historico por pessoa
// ---------------------------------------------------------------------

function agruparClientes() {
  const mapa = new Map();

  for (const a of estado.agendamentos) {
    const chave = a.clienteNome.trim().toLowerCase();
    if (!chave) continue;

    const atual = mapa.get(chave) || {
      nome: a.clienteNome.trim(),
      contato: "",
      sessoes: 0,
      cancelados: 0,
      gasto: 0,
      primeira: a.inicio,
      ultima: a.inicio,
      servicos: new Map(),
      observacoes: [],
      itens: []
    };

    atual.itens.push(a);
    if (a.clienteContato && !atual.contato) atual.contato = a.clienteContato;
    if (a.observacoes) atual.observacoes.push(a.observacoes);

    if (a.status === "concluido") {
      atual.sessoes += 1;
      atual.gasto += a.precoCentavos || precoDoServico(a.servicoNome);
      atual.servicos.set(a.servicoNome, (atual.servicos.get(a.servicoNome) || 0) + 1);
    }
    if (a.status === "cancelado") atual.cancelados += 1;

    if (a.inicio < atual.primeira) atual.primeira = a.inicio;
    if (a.inicio > atual.ultima) atual.ultima = a.inicio;

    mapa.set(chave, atual);
  }

  return [...mapa.values()].sort((a, b) => b.ultima - a.ultima);
}

function desenharClientes() {
  const termo = estado.busca.trim().toLowerCase();
  let lista = agruparClientes();

  if (termo) lista = lista.filter((c) => c.nome.toLowerCase().includes(termo));

  const alvo = $("#lista-historico");

  if (!lista.length) {
    alvo.innerHTML = termo
      ? vazioHTML("Nada encontrado", `Nenhum cliente com "${escapar(termo)}".`)
      : vazioHTML("Sem clientes", "Os clientes aparecem aqui depois do primeiro atendimento.");
    return;
  }

  alvo.innerHTML = lista.map((c) => {
    const inicial = c.nome.trim()[0]?.toUpperCase() || "?";
    const quando = mesmoDia(c.ultima, new Date())
      ? "hoje"
      : c.ultima.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    return `
      <button class="cliente-cartao" data-cliente="${escapar(c.nome)}">
        <span class="avatar">${escapar(inicial)}</span>
        <span>
          <span class="cliente-cartao__nome">${escapar(c.nome)}</span>
          <span class="cliente-cartao__meta">Último: ${quando}${c.gasto ? " · " + emReais(c.gasto) : ""}</span>
        </span>
        <span class="selo-sessoes">${c.sessoes}</span>
      </button>`;
  }).join("");
}

function abrirCliente(nome) {
  const c = agruparClientes().find((x) => x.nome === nome);
  if (!c) return;

  $("#cliente-nome").textContent = c.nome;
  $("#cli-sessoes").textContent = c.sessoes;
  $("#cli-gasto").textContent = c.gasto ? emReais(c.gasto) : "—";
  $("#cli-faltas").textContent = c.cancelados;

  $("#cli-linha-contato").hidden = !c.contato;
  $("#cli-contato").textContent = c.contato || "";

  const favorito = [...c.servicos.entries()].sort((a, b) => b[1] - a[1])[0];
  $("#cli-preferido").textContent = favorito ? `${favorito[0]} (${favorito[1]}x)` : "—";

  $("#cli-primeira").textContent = c.primeira.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric"
  });

  const obs = [...new Set(c.observacoes)].join(" · ");
  $("#cli-linha-obs").hidden = !obs;
  $("#cli-obs").textContent = obs;

  $("#cli-historico").innerHTML = c.itens
    .sort((a, b) => b.inicio - a.inicio)
    .slice(0, 20)
    .map(cartaoHTML)
    .join("");

  abrir("#folha-cliente");
}

// ---------------------------------------------------------------------
// Ajustes: horario de funcionamento
// ---------------------------------------------------------------------

const NOMES_DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIAS_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function preencherAjustes() {
  const c = estado.config;
  $("#cfg-abre").value = c.abreEm;
  $("#cfg-fecha").value = c.fechaEm;
  $("#cfg-intervalo").value = String(c.intervaloMin);
  $("#cfg-antecedencia").value = String(c.antecedenciaMin);

  const ativos = c.diasSemana || [0, 1, 2, 3, 4, 5, 6];
  $("#cfg-dias").innerHTML = NOMES_DIAS.map((letra, i) => `
    <button type="button" data-dia="${i}" aria-pressed="${ativos.includes(i)}"
            aria-label="${NOMES_DIAS_LONGO[i]}">${letra}</button>`).join("");
}

function ligarAjustes() {
  // alterna os dias da semana
  $("#cfg-dias").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dia]");
    if (!btn) return;
    const ligado = btn.getAttribute("aria-pressed") === "true";
    btn.setAttribute("aria-pressed", String(!ligado));
    if (navigator.vibrate) navigator.vibrate(8);
  });

  $("#btn-salvar-cfg").addEventListener("click", async () => {
    const dias = $$("#cfg-dias [data-dia]")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => Number(b.dataset.dia));

    if (!dias.length) return avisar("Escolha ao menos um dia", "ruim");

    const abre = $("#cfg-abre").value;
    const fecha = $("#cfg-fecha").value;
    if (!abre || !fecha || fecha <= abre) {
      return avisar("O horário de fechar deve ser depois do de abrir", "ruim");
    }

    const botao = $("#btn-salvar-cfg");
    botao.disabled = true;
    botao.textContent = "Salvando...";

    try {
      await dados.salvarConfig({
        abreEm: abre,
        fechaEm: fecha,
        intervaloMin: Number($("#cfg-intervalo").value),
        antecedenciaMin: Number($("#cfg-antecedencia").value),
        diasSemana: dias,
        diasMaxFuturo: estado.config.diasMaxFuturo || 21
      });
      avisar("Horários salvos", "bom");
    } catch {
      avisar("Não foi possível salvar", "ruim");
    } finally {
      botao.disabled = false;
      botao.textContent = "Salvar horários";
    }
  });
}

// ---------------------------------------------------------------------
// Ajustes: servicos
// ---------------------------------------------------------------------

function desenharListaServicos() {
  const alvo = $("#lista-servicos");
  if (!alvo) return;

  alvo.innerHTML = estado.servicos.length
    ? estado.servicos.map((s, i) => `
        <button class="servico-item" data-servico="${i}">
          <span class="servico-item__nome">${escapar(s.nome)}</span>
          <span class="servico-item__preco">${s.precoCentavos ? emReais(s.precoCentavos) : "sem preço"}</span>
          <span class="servico-item__meta">${s.duracaoMin} min${s.descricao ? " · " + escapar(s.descricao.slice(0, 48)) : ""}</span>
        </button>`).join("")
    : vazioHTML("Nenhum serviço", "Toque em Adicionar para criar o primeiro.");
}

let servicoEmEdicao = null;

function precoDoCampo() {
  return paraCentavos($("#srv-preco").value);
}

function abrirServico(servico = null) {
  servicoEmEdicao = servico;
  $("#titulo-servico").textContent = servico ? "Editar serviço" : "Novo serviço";
  $("#srv-erro").hidden = true;
  $("#btn-excluir-srv").hidden = !servico;

  $("#srv-nome").value = servico?.nome || "";
  $("#srv-desc").value = servico?.descricao || "";
  $("#srv-duracao").value = String(servico?.duracaoMin || 60);
  // valor limpo, so numeros: evita reconverter texto ja formatado
  const c = servico?.precoCentavos || 0;
  $("#srv-preco").value = c ? (c / 100).toFixed(2).replace(".", ",") : "";
  $("#srv-preco-previa").textContent = c ? emReais(c) : "";

  abrir("#folha-servico");
  if (!servico) setTimeout(() => $("#srv-nome").focus(), 320);
}

function ligarServicos() {
  $("#btn-novo-servico").addEventListener("click", () => abrirServico());

  $("#lista-servicos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-servico]");
    if (!btn) return;
    abrirServico(estado.servicos[Number(btn.dataset.servico)]);
  });

  // Sem formatacao automatica no campo: o texto digitado e a unica
  // fonte de verdade, convertido uma unica vez no submit. Formatar
  // durante a edicao criava conversao dupla (180,00 virava 18.000).
  $("#srv-preco").addEventListener("blur", (e) => {
    const c = paraCentavos(e.target.value);
    $("#srv-preco-previa").textContent = c ? emReais(c) : "";
  });

  $("#form-servico").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#srv-erro");
    const botao = $("#btn-salvar-srv");
    erro.hidden = true;

    const nome = $("#srv-nome").value.trim();
    if (nome.length < 2) {
      erro.textContent = "Dê um nome ao serviço.";
      erro.hidden = false;
      return;
    }

    botao.disabled = true;
    botao.textContent = "Salvando...";

    try {
      await dados.salvarServico({
        id: servicoEmEdicao?.id,
        nome,
        descricao: $("#srv-desc").value,
        duracaoMin: Number($("#srv-duracao").value),
        precoCentavos: precoDoCampo(),
        ordem: servicoEmEdicao?.ordem ?? estado.servicos.length + 1
      });
      fechar("#folha-servico");
      avisar(servicoEmEdicao ? "Serviço atualizado" : "Serviço criado", "bom");
    } catch {
      erro.textContent = "Não foi possível salvar. Tente de novo.";
      erro.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = "Salvar";
    }
  });

  $("#btn-excluir-srv").addEventListener("click", () => {
    if (!servicoEmEdicao?.id) return;
    const alvo = servicoEmEdicao;
    fechar("#folha-servico");
    pedirConfirmacao(
      `Excluir ${alvo.nome}?`,
      "O serviço deixa de aparecer no site. Os atendimentos já marcados continuam na agenda.",
      async () => {
        try {
          await dados.removerServico(alvo.id);
          avisar("Serviço excluído", "bom");
        } catch {
          avisar("Não foi possível excluir", "ruim");
        }
      }
    );
  });
}

// ---------------------------------------------------------------------
// Navegacao entre abas
// ---------------------------------------------------------------------

function ligarNavegacao() {
  $$(".barra__item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aba = btn.dataset.aba;
      estado.abaAtual = aba;

      $$(".barra__item").forEach((b) => b.classList.toggle("barra__item--ativo", b === btn));
      $$(".aba").forEach((s) => { s.hidden = s.id !== `aba-${aba}`; });

      window.scrollTo({ top: 0, behavior: "smooth" });
      if (navigator.vibrate) navigator.vibrate(8);
    });
  });

  // abrir ficha ao tocar em qualquer cartao
  document.addEventListener("click", (e) => {
    // botao Enviar da fila de lembretes
    const lembrar = e.target.closest("[data-lembrar]");
    if (lembrar) {
      const item = estado.agendamentos.find((a) => a.id === lembrar.dataset.lembrar);
      if (item) dispararLembrete(item);
      return;
    }

    const cliente = e.target.closest("[data-cliente]");
    if (cliente) return abrirCliente(cliente.dataset.cliente);

    const cartao = e.target.closest(".cartao");
    if (cartao) return abrirDetalhe(cartao.dataset.id);

    const proximo = e.target.closest("#proximo-cartao");
    if (proximo?.dataset.id) abrirDetalhe(proximo.dataset.id);
  });
}

// ---------------------------------------------------------------------
// Folhas
// ---------------------------------------------------------------------

function abrir(id) {
  $(id).hidden = false;
  document.body.style.overflow = "hidden";
}

function fechar(id) {
  $(id).hidden = true;
  document.body.style.overflow = "";
}

function ligarFolhas() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-fechar]")) {
      const folha = e.target.closest(".folha");
      if (folha) fechar("#" + folha.id);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $$(".folha").forEach((f) => { if (!f.hidden) fechar("#" + f.id); });
  });
}

// ---------------------------------------------------------------------
// Ficha do atendimento
// ---------------------------------------------------------------------

let itemAberto = null;

function abrirDetalhe(id) {
  const a = estado.agendamentos.find((x) => x.id === id);
  if (!a) return;
  itemAberto = a;

  $("#detalhe-status").textContent = ROTULO_STATUS[a.status];
  $("#detalhe-status").className = `etiqueta etiqueta--${a.status}`;
  $("#detalhe-nome").textContent = a.clienteNome;

  const dia = mesmoDia(a.inicio, new Date())
    ? "Hoje"
    : a.inicio.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });
  $("#detalhe-quando").textContent = `${dia}, ${hhmm(a.inicio)} às ${hhmm(a.fim)}`;
  $("#detalhe-servico").textContent = `${a.servicoNome} · ${a.duracaoMin} min`;

  $("#linha-contato").hidden = !a.clienteContato;
  $("#detalhe-contato").textContent = a.clienteContato || "";

  $("#linha-obs").hidden = !a.observacoes;
  $("#detalhe-obs").textContent = a.observacoes || "";

  $("#detalhe-acoes").innerHTML = acoesPara(a);
  abrir("#folha-detalhe");
}

function acoesPara(a) {
  const b = (classe, acao, texto) =>
    `<button class="btn ${classe}" data-acao="${acao}">${texto}</button>`;

  // lembrete: so faz sentido para atendimento futuro com contato
  const futuro = a.inicio > new Date();
  const lembrete = (futuro && a.clienteContato && a.status !== "cancelado")
    ? b("btn--fantasma", "lembrar", a.lembreteEnviadoEm ? "Lembrete já enviado" : "Enviar lembrete")
    : "";

  if (a.status === "pendente")
    return b("btn--principal", "confirmar", "Confirmar atendimento")
         + lembrete
         + `<div class="acoes acoes--dupla">
              ${b("btn--fantasma", "remarcar", "Remarcar")}
              ${b("btn--neutro", "cancelar", "Cancelar")}
            </div>`;

  if (a.status === "confirmado")
    return b("btn--principal", "concluir", "Marcar como concluído")
         + lembrete
         + `<div class="acoes acoes--dupla">
              ${b("btn--fantasma", "remarcar", "Remarcar")}
              ${b("btn--neutro", "cancelar", "Cancelar")}
            </div>`;

  if (a.status === "cancelado")
    return b("btn--fantasma", "reativar", "Reativar atendimento")
         + b("btn--neutro", "excluir", "Excluir definitivamente");

  return b("btn--fantasma", "reabrir", "Reabrir atendimento");
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-acao]");
  if (!btn || !itemAberto) return;

  const acao = btn.dataset.acao;
  const a = itemAberto;

  if (acao === "remarcar") {
    fechar("#folha-detalhe");
    return abrirNovo(a);
  }

  // Lembrete: monta a mensagem e abre o app de conversa.
  // O envio e manual porque um site estatico nao roda tarefas sozinho.
  if (acao === "lembrar") {
    const quando = a.inicio.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    const texto =
      `Olá, ${a.clienteNome.split(" ")[0]}! Passando para lembrar do seu horário:\n\n` +
      `${a.servicoNome}\n${quando}, às ${hhmm(a.inicio)}\n` +
      `Rua Lagoa Santa, 11 - Carlos Prates\n\n` +
      `Qualquer imprevisto, é só avisar. Até lá!`;

    const so = (a.clienteContato || "").replace(/\D/g, "");
    const ehTelefone = so.length >= 10;

    if (ehTelefone) {
      const numero = so.length <= 11 ? "55" + so : so;
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    } else {
      try {
        await navigator.clipboard.writeText(texto);
        avisar("Mensagem copiada", "bom");
      } catch {
        avisar("Não foi possível copiar", "ruim");
      }
    }

    try { await dados.marcarLembreteEnviado(a.id); } catch { /* nao bloqueia o envio */ }
    fechar("#folha-detalhe");
    return;
  }

  if (acao === "cancelar" || acao === "excluir") {
    const excluir = acao === "excluir";
    return pedirConfirmacao(
      excluir ? "Excluir definitivamente?" : "Cancelar atendimento?",
      excluir
        ? `O registro de ${a.clienteNome} será apagado e não poderá ser recuperado.`
        : `O horário de ${a.clienteNome} às ${hhmm(a.inicio)} ficará livre.`,
      async () => {
        try {
          if (excluir) await dados.excluir(a.id);
          else await dados.mudarStatus(a.id, "cancelado");
          fechar("#folha-detalhe");
          avisar(excluir ? "Registro excluído" : "Atendimento cancelado", "bom");
        } catch {
          avisar("Não foi possível concluir", "ruim");
        }
      }
    );
  }

  const novoStatus = {
    confirmar: "confirmado",
    concluir: "concluido",
    reativar: "confirmado",
    reabrir: "confirmado"
  }[acao];

  if (!novoStatus) return;

  try {
    btn.disabled = true;
    await dados.mudarStatus(a.id, novoStatus);
    fechar("#folha-detalhe");
    avisar(
      { confirmado: "Atendimento confirmado", concluido: "Marcado como concluído" }[novoStatus]
        || "Atualizado",
      "bom"
    );
  } catch {
    avisar("Não foi possível atualizar", "ruim");
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Confirmacao
// ---------------------------------------------------------------------

let aoConfirmar = null;

function pedirConfirmacao(titulo, texto, callback) {
  $("#confirma-titulo").textContent = titulo;
  $("#confirma-texto").textContent = texto;
  aoConfirmar = callback;
  abrir("#folha-confirma");
}

$("#btn-confirma-sim").addEventListener("click", async () => {
  const fn = aoConfirmar;
  aoConfirmar = null;
  fechar("#folha-confirma");
  await fn?.();
});

// ---------------------------------------------------------------------
// Novo agendamento / remarcacao
// ---------------------------------------------------------------------

let remarcando = null;

function montarServicos() {
  $("#novo-servicos").innerHTML = estado.servicos.map((s, i) => `
    <button type="button" class="opcao${i === estado.servicoEscolhido ? " opcao--escolhida" : ""}"
            data-indice="${i}">
      <span class="opcao__nome">${escapar(s.nome)}</span>
      <span class="opcao__tempo">${s.duracaoMin} min</span>
    </button>`).join("");
}

function abrirNovo(paraRemarcar = null) {
  remarcando = paraRemarcar;
  $("#titulo-novo").textContent = paraRemarcar ? "Remarcar atendimento" : "Novo agendamento";
  $("#btn-salvar").textContent = paraRemarcar ? "Remarcar" : "Salvar";
  $("#novo-erro").hidden = true;

  const base = paraRemarcar ? paraRemarcar.inicio : proximoHorarioRedondo();

  $("#novo-nome").value = paraRemarcar ? paraRemarcar.clienteNome : "";
  $("#novo-nome").disabled = !!paraRemarcar;
  $("#novo-obs").value = paraRemarcar ? paraRemarcar.observacoes : "";
  $("#novo-data").value = chaveDia(paraRemarcar ? base : estado.diaEscolhido);
  $("#novo-hora").value = hhmm(base);

  if (paraRemarcar) {
    const i = estado.servicos.findIndex((s) => s.nome === paraRemarcar.servicoNome);
    estado.servicoEscolhido = i >= 0 ? i : 0;
  }
  montarServicos();

  abrir("#folha-novo");
  if (!paraRemarcar) setTimeout(() => $("#novo-nome").focus(), 320);
}

function proximoHorarioRedondo() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  const m = d.getMinutes();
  d.setMinutes(m < 30 ? 30 : 60, 0, 0);
  return d;
}

function ligarFormularios() {
  $("#btn-novo").addEventListener("click", () => abrirNovo());

  $("#novo-servicos").addEventListener("click", (e) => {
    const op = e.target.closest(".opcao");
    if (!op) return;
    estado.servicoEscolhido = Number(op.dataset.indice);
    montarServicos();
  });

  $("#form-novo").addEventListener("submit", async (e) => {
    e.preventDefault();

    const erro = $("#novo-erro");
    const botao = $("#btn-salvar");
    erro.hidden = true;

    const nome = $("#novo-nome").value.trim();
    const dia = $("#novo-data").value;
    const hora = $("#novo-hora").value;
    const servico = estado.servicos[estado.servicoEscolhido];

    if (!remarcando && nome.length < 2) return falhar("Informe o nome do cliente.");
    if (!dia || !hora) return falhar("Escolha o dia e o horário.");

    const [ano, mes, d] = dia.split("-").map(Number);
    const [h, mi] = hora.split(":").map(Number);
    const inicio = new Date(ano, mes - 1, d, h, mi, 0, 0);

    if (isNaN(inicio)) return falhar("Data ou hora inválida.");
    if (inicio < new Date()) return falhar("Esse horário já passou.");

    botao.disabled = true;
    botao.textContent = remarcando ? "Remarcando..." : "Salvando...";

    try {
      if (remarcando) {
        // valida conflito manualmente na remarcacao
        const fim = new Date(inicio.getTime() + servico.duracaoMin * 60000);
        const conflito = estado.agendamentos.some(
          (a) => a.id !== remarcando.id && a.status !== "cancelado" &&
                 a.inicio < fim && a.fim > inicio
        );
        if (conflito) throw Object.assign(new Error(), { codigo: "HORARIO_OCUPADO" });

        await dados.remarcar(remarcando.id, inicio, servico.duracaoMin);
        avisar("Atendimento remarcado", "bom");
      } else {
        await dados.criarAgendamento({
          clienteNome: nome,
          servicoNome: servico.nome,
          duracaoMin: servico.duracaoMin,
          precoCentavos: servico.precoCentavos || 0,
          inicio,
          observacoes: $("#novo-obs").value,
          status: "confirmado",
          origem: "painel"
        });
        avisar("Agendamento criado", "bom");
      }

      fechar("#folha-novo");
      estado.diaEscolhido = inicio;
      redesenhar();
    } catch (ex) {
      if (ex?.codigo === "HORARIO_OCUPADO" || /HORARIO_OCUPADO/.test(ex?.message || ""))
        falhar("Já existe um atendimento nesse horário. Escolha outro.");
      else falhar("Não foi possível salvar. Tente novamente.");
    } finally {
      botao.disabled = false;
      botao.textContent = remarcando ? "Remarcar" : "Salvar";
    }

    function falhar(msg) {
      erro.textContent = msg;
      erro.hidden = false;
      botao.disabled = false;
      botao.textContent = remarcando ? "Remarcar" : "Salvar";
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    }
  });
}

// ---------------------------------------------------------------------
// Conexao
// ---------------------------------------------------------------------

function monitorarConexao() {
  const alvo = $("#aviso-offline");
  const ver = () => { alvo.hidden = navigator.onLine; };
  window.addEventListener("online", ver);
  window.addEventListener("offline", ver);
  ver();
}

// ---------------------------------------------------------------------
// PWA
// ---------------------------------------------------------------------

function registrarPWA() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------------------------------------------------------------------

iniciar();
