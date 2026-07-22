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
  abaAtual: "hoje",
  mesVisivel: new Date(),
  diaEscolhido: new Date(),
  filtro: "todos",
  busca: "",
  servicos: dados.SERVICOS_PADRAO,
  servicoEscolhido: 0,
  cancelarEscuta: null,
  carregando: true
};

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

  ligarNavegacao();
  ligarFolhas();
  ligarFormularios();
  ligarFiltros();
  ligarCalendario();
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

  estado.servicos = await dados.lerServicos();
  montarServicos();
  escutarPeriodo();
  desenharCalendario();

  setInterval(atualizarContagem, 30000);
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
    redesenhar();
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
  desenharHistorico();
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
    const status = porDia.get(chaveDia(d));

    const pontos = status
      ? [...status].slice(0, 3).map((s) => `<i class="dia__ponto dia__ponto--${s}"></i>`).join("")
      : "";

    html += `<button class="dia${fora ? " dia--fora" : ""}${ehHoje ? " dia--hoje" : ""}${escolhido ? " dia--escolhido" : ""}"
      data-data="${chaveDia(d)}" aria-label="${d.getDate()} de ${d.toLocaleDateString("pt-BR",{month:"long"})}">
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

  $("#lista-dia").innerHTML = lista.length
    ? lista.map(cartaoHTML).join("")
    : vazioHTML("Nenhum atendimento", "Toque no + para marcar um horário.");
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
}

// ---------------------------------------------------------------------
// Aba: Historico
// ---------------------------------------------------------------------

function desenharHistorico() {
  const termo = estado.busca.trim().toLowerCase();

  let lista = [...estado.agendamentos].sort((a, b) => b.inicio - a.inicio);

  if (estado.filtro !== "todos") lista = lista.filter((a) => a.status === estado.filtro);
  if (termo) lista = lista.filter((a) => a.clienteNome.toLowerCase().includes(termo));

  const alvo = $("#lista-historico");

  if (!lista.length) {
    alvo.innerHTML = termo
      ? vazioHTML("Nada encontrado", `Nenhum cliente com "${escapar(termo)}".`)
      : vazioHTML("Sem registros", "Os atendimentos aparecem aqui.");
    return;
  }

  // agrupa por dia, com cabecalho
  let html = "";
  let ultimoDia = "";
  for (const a of lista.slice(0, 120)) {
    const k = chaveDia(a.inicio);
    if (k !== ultimoDia) {
      ultimoDia = k;
      const rot = mesmoDia(a.inicio, new Date())
        ? "Hoje"
        : a.inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
      html += `<h3 class="secao-titulo">${rot}</h3>`;
    }
    html += cartaoHTML(a);
  }
  alvo.innerHTML = html;
}

function ligarFiltros() {
  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$(".chip").forEach((c) => c.classList.remove("chip--ativo"));
      chip.classList.add("chip--ativo");
      estado.filtro = chip.dataset.filtro;
      desenharHistorico();
    });
  });

  let debounce;
  $("#campo-busca").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      estado.busca = e.target.value;
      desenharHistorico();
    }, 180);
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

  if (a.status === "pendente")
    return b("btn--principal", "confirmar", "Confirmar atendimento")
         + `<div class="acoes acoes--dupla">
              ${b("btn--fantasma", "remarcar", "Remarcar")}
              ${b("btn--neutro", "cancelar", "Cancelar")}
            </div>`;

  if (a.status === "confirmado")
    return b("btn--principal", "concluir", "Marcar como concluído")
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
