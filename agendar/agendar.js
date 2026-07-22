// =====================================================================
// Agendamento online - fluxo do cliente
// Tres passos curtos: servico -> horario -> dados.
// =====================================================================

import { MODO_DEMO } from "../painel/js/config.js";
import * as dados from "../painel/js/dados.js";

const $ = (s) => document.querySelector(s);
const doisDig = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`;

// Horario de funcionamento e granularidade da grade
const ABRE = 8;
const FECHA = 22;
const PASSO_MIN = 60;
const ANTECEDENCIA_MIN = 60;   // nao aceita horario colado na hora atual
const DIAS_VISIVEIS = 14;

const estado = {
  passo: 1,
  servicos: [],
  servico: null,
  dia: null,
  hora: null,
  ocupados: []
};

// ---------------------------------------------------------------------

async function iniciar() {
  await dados.iniciar();
  estado.servicos = await dados.lerServicos();
  montarServicos();
  montarDias();
  ligarNavegacao();
  ligarFormulario();
}

// ---------------------------------------------------------------------
// Passo 1: servico
// ---------------------------------------------------------------------

function montarServicos() {
  $("#servicos").innerHTML = estado.servicos.map((s, i) => `
    <button type="button" class="servico" data-i="${i}">
      <span>
        <span class="servico__nome">${esc(s.nome)}</span>
        ${s.descricao ? `<span class="servico__desc">${esc(s.descricao)}</span>` : ""}
      </span>
      <span class="servico__tempo">${s.duracaoMin} min</span>
    </button>`).join("");

  $("#servicos").addEventListener("click", (e) => {
    const btn = e.target.closest(".servico");
    if (!btn) return;
    estado.servico = estado.servicos[Number(btn.dataset.i)];
    [...$("#servicos").children].forEach((c) =>
      c.classList.toggle("servico--escolhido", c === btn));
    $("#btn-avancar").disabled = false;
    if (navigator.vibrate) navigator.vibrate(12);
  });
}

// ---------------------------------------------------------------------
// Passo 2: dia e horario
// ---------------------------------------------------------------------

function montarDias() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  let html = "";

  for (let i = 0; i < DIAS_VISIVEIS; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const semana = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    const mes = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    html += `
      <button type="button" class="dia" data-data="${d.toISOString()}">
        <span class="dia__semana">${i === 0 ? "hoje" : semana}</span>
        <span class="dia__num">${d.getDate()}</span>
        <span class="dia__mes">${mes}</span>
      </button>`;
  }

  $("#dias").innerHTML = html;

  $("#dias").addEventListener("click", async (e) => {
    const btn = e.target.closest(".dia");
    if (!btn) return;
    estado.dia = new Date(btn.dataset.data);
    estado.hora = null;
    [...$("#dias").children].forEach((c) =>
      c.classList.toggle("dia--escolhido", c === btn));
    $("#btn-avancar").disabled = true;
    await montarHorarios();
  });
}

async function montarHorarios() {
  const alvo = $("#horarios");
  alvo.innerHTML = `<p class="carregando">Carregando horários...</p>`;

  const dia = estado.dia;
  const de = new Date(dia); de.setHours(0, 0, 0, 0);
  const ate = new Date(dia); ate.setHours(23, 59, 59, 999);

  // le os horarios ja tomados
  estado.ocupados = await lerOcupados(de, ate);

  const agora = new Date();
  const limite = new Date(agora.getTime() + ANTECEDENCIA_MIN * 60000);
  const duracao = estado.servico?.duracaoMin || 60;

  let html = "";
  let disponiveis = 0;

  for (let h = ABRE; h < FECHA; h++) {
    for (let m = 0; m < 60; m += PASSO_MIN) {
      const inicio = new Date(dia);
      inicio.setHours(h, m, 0, 0);
      const fim = new Date(inicio.getTime() + duracao * 60000);

      // nao pode terminar depois do fechamento
      const fechamento = new Date(dia);
      fechamento.setHours(FECHA, 0, 0, 0);
      if (fim > fechamento) continue;

      const passou = inicio < limite;
      const ocupado = estado.ocupados.some(
        (o) => inicio < o.fim && fim > o.inicio
      );

      const indisponivel = passou || ocupado;
      if (!indisponivel) disponiveis++;

      html += `<button type="button"
        class="hora${indisponivel ? " hora--ocupada" : ""}"
        data-hora="${inicio.toISOString()}"
        ${indisponivel ? "disabled" : ""}>${hhmm(inicio)}</button>`;
    }
  }

  alvo.innerHTML = disponiveis
    ? html
    : `<p class="sem-horario">Não há horários livres neste dia.<br>Escolha outra data.</p>`;
}

async function lerOcupados(de, ate) {
  return new Promise((resolve) => {
    // Leitura pontual: escuta e cancela em seguida.
    // 'parar' e declarado antes porque o callback pode disparar de forma
    // sincrona (modo demo), antes da atribuicao acontecer.
    let parar = null;
    let respondido = false;

    const responder = (lista) => {
      if (respondido) return;
      respondido = true;
      parar?.();
      resolve(lista);
    };

    parar = dados.observarAgendamentos(de, ate, (lista) => {
      responder(
        (lista || [])
          .filter((a) => a.status !== "cancelado")
          .map((a) => ({ inicio: a.inicio, fim: a.fim }))
      );
    });

    // se ja respondeu de forma sincrona, cancela a escuta agora
    if (respondido) parar?.();

    setTimeout(() => responder([]), 6000);
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".hora");
  if (!btn || btn.disabled) return;
  estado.hora = new Date(btn.dataset.hora);
  document.querySelectorAll(".hora").forEach((h) =>
    h.classList.toggle("hora--escolhida", h === btn));
  $("#btn-avancar").disabled = false;
  if (navigator.vibrate) navigator.vibrate(12);
});

// ---------------------------------------------------------------------
// Passo 3: dados e envio
// ---------------------------------------------------------------------

function montarResumo() {
  const d = estado.hora;
  const dia = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  $("#resumo").innerHTML = `
    <div class="resumo__linha"><span class="resumo__rot">Serviço</span>
      <span class="resumo__val">${esc(estado.servico.nome)}</span></div>
    <div class="resumo__linha"><span class="resumo__rot">Dia</span>
      <span class="resumo__val">${dia}</span></div>
    <div class="resumo__linha"><span class="resumo__rot">Horário</span>
      <span class="resumo__val">${hhmm(d)} · ${estado.servico.duracaoMin} min</span></div>`;
}

function ligarFormulario() {
  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#erro");
    const botao = $("#enviar");
    erro.hidden = true;

    const nome = $("#nome").value.trim();
    if (nome.length < 2) {
      erro.textContent = "Por favor, informe seu nome.";
      erro.hidden = false;
      return;
    }

    botao.disabled = true;
    botao.textContent = "Reservando...";

    try {
      await dados.criarAgendamento({
        clienteNome: nome,
        clienteContato: $("#contato").value.trim(),
        servicoNome: estado.servico.nome,
        duracaoMin: estado.servico.duracaoMin,
        inicio: estado.hora,
        observacoes: $("#obs").value.trim(),
        status: "pendente",
        origem: "site"
      });
      mostrarSucesso(nome);
    } catch (ex) {
      const ocupado = ex?.codigo === "HORARIO_OCUPADO"
        || /HORARIO_OCUPADO/.test(ex?.message || "");
      erro.textContent = ocupado
        ? "Esse horário acabou de ser reservado. Escolha outro, por favor."
        : "Não foi possível concluir. Verifique sua conexão e tente de novo.";
      erro.hidden = false;
      botao.disabled = false;
      botao.textContent = "Confirmar agendamento";
      if (ocupado) setTimeout(() => irPara(2), 1600);
    }
  });
}

function mostrarSucesso(nome) {
  document.querySelectorAll(".passo").forEach((p) => (p.hidden = true));
  $("#rodape").hidden = true;
  $("#passo-ok").hidden = false;

  const d = estado.hora;
  const dia = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  $("#ok-texto").textContent = `${nome.split(" ")[0]}, seu horário está reservado.`;
  $("#ok-detalhe").innerHTML = `
    <div class="resumo__linha"><span class="resumo__rot">Serviço</span>
      <span class="resumo__val">${esc(estado.servico.nome)}</span></div>
    <div class="resumo__linha"><span class="resumo__rot">Quando</span>
      <span class="resumo__val">${dia}, ${hhmm(d)}</span></div>
    <div class="resumo__linha"><span class="resumo__rot">Onde</span>
      <span class="resumo__val">Rua Lagoa Santa, 11<br>Carlos Prates</span></div>`;

  window.scrollTo({ top: 0, behavior: "smooth" });
  if (navigator.vibrate) navigator.vibrate([20, 60, 30]);
}

// ---------------------------------------------------------------------
// Navegacao entre passos
// ---------------------------------------------------------------------

function irPara(n) {
  estado.passo = n;
  document.querySelectorAll(".passo").forEach((p) => (p.hidden = true));
  $(`#passo-${n}`).hidden = false;

  document.querySelectorAll(".trilha__item").forEach((t) => {
    const p = Number(t.dataset.passo);
    t.classList.toggle("trilha__item--ativo", p === n);
    t.classList.toggle("trilha__item--feito", p < n);
  });

  $("#rodape").hidden = false;
  $("#btn-voltar").hidden = n === 1;

  const avancar = $("#btn-avancar");
  if (n === 1) {
    avancar.textContent = "Continuar";
    avancar.disabled = !estado.servico;
  } else if (n === 2) {
    avancar.textContent = "Continuar";
    avancar.disabled = !estado.hora;
  } else {
    $("#rodape").hidden = true;   // o passo 3 tem o proprio botao
    montarResumo();
    setTimeout(() => $("#nome").focus(), 250);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function ligarNavegacao() {
  $("#btn-avancar").addEventListener("click", () => {
    if (estado.passo === 1 && estado.servico) irPara(2);
    else if (estado.passo === 2 && estado.hora) irPara(3);
  });

  $("#btn-voltar").addEventListener("click", () => {
    if (estado.passo > 1) irPara(estado.passo - 1);
  });

  irPara(1);
}

// ---------------------------------------------------------------------

function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

iniciar();
