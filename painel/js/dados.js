// =====================================================================
// Camada de dados
//
// Todo o resto do painel fala com este modulo, nunca com o Firebase
// diretamente. Isso mantem a interface independente do backend e
// permite o modo demonstracao offline.
// =====================================================================

import { firebaseConfig, MODO_DEMO } from "./config.js";

const CDN = "https://www.gstatic.com/firebasejs/10.12.2";

let db = null;
let auth = null;
let fb = {};        // funcoes do SDK, carregadas sob demanda

// ---------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------

export async function iniciar() {
  if (MODO_DEMO) {
    demo.semear();
    return { demo: true };
  }

  const [app, firestore, autenticacao] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-firestore.js`),
    import(`${CDN}/firebase-auth.js`)
  ]);

  const instancia = app.initializeApp(firebaseConfig);
  db = firestore.getFirestore(instancia);
  auth = autenticacao.getAuth(instancia);
  fb = { ...firestore, ...autenticacao };

  return { demo: false };
}

// ---------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------

export function observarLogin(callback) {
  if (MODO_DEMO) {
    callback({ email: "demonstracao@local", demo: true });
    return () => {};
  }
  return fb.onAuthStateChanged(auth, callback);
}

export async function entrar(email, senha) {
  if (MODO_DEMO) return { email, demo: true };
  const cred = await fb.signInWithEmailAndPassword(auth, email, senha);
  return cred.user;
}

export async function sair() {
  if (MODO_DEMO) return;
  await fb.signOut(auth);
}

// ---------------------------------------------------------------------
// Agendamentos: escuta em tempo real
// Devolve uma funcao para cancelar a escuta.
// ---------------------------------------------------------------------

export function observarAgendamentos(deData, ateData, callback) {
  if (MODO_DEMO) return demo.observar(deData, ateData, callback);

  const q = fb.query(
    fb.collection(db, "agendamentos"),
    fb.where("inicio", ">=", fb.Timestamp.fromDate(deData)),
    fb.where("inicio", "<=", fb.Timestamp.fromDate(ateData)),
    fb.orderBy("inicio", "asc")
  );

  return fb.onSnapshot(q, (snap) => {
    callback(snap.docs.map(paraObjeto));
  }, (erro) => {
    console.error("Falha ao escutar agendamentos:", erro);
    callback([], erro);
  });
}

function paraObjeto(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    clienteNome: d.clienteNome || "",
    clienteContato: d.clienteContato || "",
    servicoNome: d.servicoNome || "",
    duracaoMin: d.duracaoMin || 60,
    inicio: d.inicio?.toDate ? d.inicio.toDate() : new Date(d.inicio),
    fim: d.fim?.toDate ? d.fim.toDate() : new Date(d.fim),
    status: d.status || "pendente",
    observacoes: d.observacoes || "",
    origem: d.origem || "painel",
    precoCentavos: d.precoCentavos || 0,
    lembreteMin: d.lembreteMin || 0,
    lembreteEnviadoEm: d.lembreteEnviadoEm?.toDate ? d.lembreteEnviadoEm.toDate() : null
  };
}

// ---------------------------------------------------------------------
// Criar agendamento
//
// Usa transacao para garantir que dois pedidos simultaneos nunca
// ocupem o mesmo horario. Esta e a protecao real contra overbooking.
// ---------------------------------------------------------------------

export async function criarAgendamento(dados) {
  if (MODO_DEMO) return demo.criar(dados);

  const inicio = dados.inicio;
  const fim = new Date(inicio.getTime() + dados.duracaoMin * 60000);

  // janela de busca: qualquer agendamento que possa se sobrepor
  const margem = 4 * 60 * 60000;
  const janelaInicio = new Date(inicio.getTime() - margem);
  const janelaFim = new Date(fim.getTime() + margem);

  return fb.runTransaction(db, async (tx) => {
    const q = fb.query(
      fb.collection(db, "agendamentos"),
      fb.where("inicio", ">=", fb.Timestamp.fromDate(janelaInicio)),
      fb.where("inicio", "<=", fb.Timestamp.fromDate(janelaFim))
    );

    const existentes = await fb.getDocs(q);
    const conflito = existentes.docs.some((d) => {
      const a = d.data();
      if (a.status === "cancelado") return false;
      const ai = a.inicio.toDate().getTime();
      const af = a.fim.toDate().getTime();
      return ai < fim.getTime() && af > inicio.getTime();
    });

    if (conflito) {
      const e = new Error("HORARIO_OCUPADO");
      e.codigo = "HORARIO_OCUPADO";
      throw e;
    }

    const ref = fb.doc(fb.collection(db, "agendamentos"));
    tx.set(ref, {
      clienteNome: dados.clienteNome.trim(),
      clienteContato: (dados.clienteContato || "").trim(),
      servicoNome: dados.servicoNome,
      duracaoMin: dados.duracaoMin,
      inicio: fb.Timestamp.fromDate(inicio),
      fim: fb.Timestamp.fromDate(fim),
      status: dados.status || "pendente",
      observacoes: (dados.observacoes || "").trim(),
      origem: dados.origem || "painel",
      // preco congelado no momento do agendamento: mudar a tabela
      // depois nao altera o historico de faturamento
      precoCentavos: Number(dados.precoCentavos) || 0,
      // quantos minutos antes o cliente quer ser lembrado (0 = nao quer)
      lembreteMin: Number(dados.lembreteMin) || 0,
      criadoEm: fb.serverTimestamp()
    });

    return ref.id;
  });
}

// ---------------------------------------------------------------------
// Alterar status / remarcar / excluir
// ---------------------------------------------------------------------

export async function mudarStatus(id, status) {
  if (MODO_DEMO) return demo.mudarStatus(id, status);
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    status,
    atualizadoEm: fb.serverTimestamp()
  });
}

export async function remarcar(id, novoInicio, duracaoMin) {
  if (MODO_DEMO) return demo.remarcar(id, novoInicio, duracaoMin);
  const fim = new Date(novoInicio.getTime() + duracaoMin * 60000);
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    inicio: fb.Timestamp.fromDate(novoInicio),
    fim: fb.Timestamp.fromDate(fim),
    atualizadoEm: fb.serverTimestamp()
  });
}

export async function excluir(id) {
  if (MODO_DEMO) return demo.excluir(id);
  await fb.deleteDoc(fb.doc(db, "agendamentos", id));
}

// ---------------------------------------------------------------------
// Bloqueios: dias em que a profissional nao atende
// ---------------------------------------------------------------------

export function observarBloqueios(callback) {
  if (MODO_DEMO) return demo.observarBloqueios(callback);

  return fb.onSnapshot(
    fb.collection(db, "bloqueios"),
    (snap) => {
      callback(snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          inicio: x.inicio?.toDate ? x.inicio.toDate() : new Date(x.inicio),
          fim: x.fim?.toDate ? x.fim.toDate() : new Date(x.fim),
          motivo: x.motivo || "",
          diaTodo: x.diaTodo !== false
        };
      }));
    },
    () => callback([])
  );
}

export async function bloquearDia(data, motivo = "") {
  const inicio = new Date(data); inicio.setHours(0, 0, 0, 0);
  const fim = new Date(data); fim.setHours(23, 59, 59, 999);
  return gravarBloqueio(inicio, fim, motivo, true);
}

// Bloqueia so uma faixa do dia (almoco, uma tarde, etc)
export async function bloquearFaixa(data, horaInicio, horaFim, motivo = "") {
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFim.split(":").map(Number);

  const inicio = new Date(data); inicio.setHours(hi, mi, 0, 0);
  const fim = new Date(data); fim.setHours(hf, mf, 0, 0);

  if (fim <= inicio) {
    const e = new Error("FAIXA_INVALIDA");
    e.codigo = "FAIXA_INVALIDA";
    throw e;
  }
  return gravarBloqueio(inicio, fim, motivo, false);
}

async function gravarBloqueio(inicio, fim, motivo, diaTodo) {
  if (MODO_DEMO) return demo.bloquear(inicio, fim, motivo, diaTodo);

  const ref = await fb.addDoc(fb.collection(db, "bloqueios"), {
    inicio: fb.Timestamp.fromDate(inicio),
    fim: fb.Timestamp.fromDate(fim),
    motivo,
    diaTodo,
    criadoEm: fb.serverTimestamp()
  });
  return ref.id;
}

export async function desbloquear(id) {
  if (MODO_DEMO) return demo.desbloquear(id);
  await fb.deleteDoc(fb.doc(db, "bloqueios", id));
}

// ---------------------------------------------------------------------
// Configuracao da agenda (horario de funcionamento)
// ---------------------------------------------------------------------

export const CONFIG_PADRAO = {
  abreEm: "08:00",
  fechaEm: "22:00",
  intervaloMin: 60,        // de quanto em quanto tempo comeca um atendimento
  antecedenciaMin: 60,     // nao aceita horario colado na hora atual
  diasMaxFuturo: 21,
  diasSemana: [0, 1, 2, 3, 4, 5, 6]   // 0 = domingo
};

export function observarConfig(callback) {
  if (MODO_DEMO) return demo.observarConfig(callback);

  return fb.onSnapshot(
    fb.doc(db, "configuracao", "agenda"),
    (snap) => callback(snap.exists() ? { ...CONFIG_PADRAO, ...snap.data() } : CONFIG_PADRAO),
    () => callback(CONFIG_PADRAO)
  );
}

export async function lerConfig() {
  if (MODO_DEMO) return demo.lerConfig();
  try {
    const snap = await fb.getDoc(fb.doc(db, "configuracao", "agenda"));
    return snap.exists() ? { ...CONFIG_PADRAO, ...snap.data() } : CONFIG_PADRAO;
  } catch {
    return CONFIG_PADRAO;
  }
}

export async function salvarConfig(config) {
  if (MODO_DEMO) return demo.salvarConfig(config);
  await fb.setDoc(fb.doc(db, "configuracao", "agenda"), {
    ...config,
    atualizadoEm: fb.serverTimestamp()
  }, { merge: true });
}

// ---------------------------------------------------------------------
// Servicos: criar, editar e remover pelo painel
// ---------------------------------------------------------------------

export function observarServicos(callback) {
  if (MODO_DEMO) return demo.observarServicos(callback);

  return fb.onSnapshot(
    fb.collection(db, "servicos"),
    (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.ativo !== false)
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      callback(lista.length ? lista : SERVICOS_PADRAO);
    },
    () => callback(SERVICOS_PADRAO)
  );
}

export async function salvarServico(servico) {
  if (MODO_DEMO) return demo.salvarServico(servico);

  const dados = {
    nome: servico.nome.trim(),
    descricao: (servico.descricao || "").trim(),
    duracaoMin: Number(servico.duracaoMin) || 60,
    precoCentavos: Number(servico.precoCentavos) || 0,
    ordem: Number(servico.ordem) || 99,
    ativo: true
  };

  if (servico.id) {
    await fb.updateDoc(fb.doc(db, "servicos", servico.id), dados);
    return servico.id;
  }
  const ref = await fb.addDoc(fb.collection(db, "servicos"), dados);
  return ref.id;
}

export async function removerServico(id) {
  if (MODO_DEMO) return demo.removerServico(id);
  await fb.deleteDoc(fb.doc(db, "servicos", id));
}

// ---------------------------------------------------------------------
// Lembrete: marca que o cliente ja foi avisado
// ---------------------------------------------------------------------

export async function marcarLembreteEnviado(id) {
  if (MODO_DEMO) return demo.marcarLembrete(id);
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    lembreteEnviadoEm: fb.serverTimestamp()
  });
}

// ---------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------

// Espelho local dos servicos: a lista aparece na hora, sem esperar a rede.
// Se o banco tiver algo diferente, o que vem de la substitui esta lista.
export const SERVICOS_PADRAO = [
  { nome: "Massagem Relaxante", duracaoMin: 60, descricao: "Movimentos amplos e contínuos que soltam a tensão do corpo inteiro." },
  { nome: "Massagem Tântrica",  duracaoMin: 90, descricao: "Ritual de respiração, toque e presença." },
  { nome: "Massagem Nuru",      duracaoMin: 90, descricao: "Contato corpo a corpo com gel específico." },
  { nome: "Massagem Lingam",    duracaoMin: 60, descricao: "Técnica focada, conduzida com calma." },
  { nome: "Spa dos Pés",        duracaoMin: 45, descricao: "Escalda-pés aromático, esfoliação e massagem com pedras quentes." }
];

export async function lerServicos() {
  if (MODO_DEMO) return SERVICOS_PADRAO;
  try {
    const snap = await fb.getDocs(fb.collection(db, "servicos"));
    if (snap.empty) return SERVICOS_PADRAO;
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  } catch {
    return SERVICOS_PADRAO;
  }
}

// =====================================================================
// Modo demonstracao: guarda tudo no proprio navegador.
// Permite usar e avaliar o painel antes de conectar o Firebase.
// =====================================================================

const demo = {
  CHAVE: "agenda_demo_v1",
  ouvintes: new Set(),

  ler() {
    try {
      const cru = localStorage.getItem(this.CHAVE);
      if (!cru) return [];
      return JSON.parse(cru).map((a) => ({
        ...a,
        inicio: new Date(a.inicio),
        fim: new Date(a.fim)
      }));
    } catch { return []; }
  },

  gravar(lista) {
    localStorage.setItem(this.CHAVE, JSON.stringify(lista));
    this.avisar();
  },

  avisar() {
    for (const fn of this.ouvintes) fn();
  },

  observar(de, ate, callback) {
    const emitir = () => {
      const lista = this.ler()
        .filter((a) => a.inicio >= de && a.inicio <= ate)
        .sort((a, b) => a.inicio - b.inicio);
      callback(lista);
    };
    this.ouvintes.add(emitir);
    emitir();
    return () => this.ouvintes.delete(emitir);
  },

  // --- bloqueios no modo demonstracao ---
  CHAVE_BLOQ: "agenda_demo_bloqueios_v1",
  ouvintesBloq: new Set(),

  lerBloqueios() {
    try {
      const cru = localStorage.getItem(this.CHAVE_BLOQ);
      if (!cru) return [];
      return JSON.parse(cru).map((b) => ({
        ...b, inicio: new Date(b.inicio), fim: new Date(b.fim)
      }));
    } catch { return []; }
  },

  gravarBloqueios(lista) {
    localStorage.setItem(this.CHAVE_BLOQ, JSON.stringify(lista));
    for (const fn of this.ouvintesBloq) fn();
  },

  observarBloqueios(callback) {
    const emitir = () => callback(this.lerBloqueios());
    this.ouvintesBloq.add(emitir);
    emitir();
    return () => this.ouvintesBloq.delete(emitir);
  },

  bloquear(inicio, fim, motivo, diaTodo = true) {
    const lista = this.lerBloqueios();
    const id = "bloq_" + Math.random().toString(36).slice(2, 10);
    lista.push({ id, inicio, fim, motivo, diaTodo });
    this.gravarBloqueios(lista);
    return id;
  },

  // --- configuracao no modo demonstracao ---
  CHAVE_CFG: "agenda_demo_config_v1",
  ouvintesCfg: new Set(),

  lerConfig() {
    try {
      const cru = localStorage.getItem(this.CHAVE_CFG);
      return cru ? { ...CONFIG_PADRAO, ...JSON.parse(cru) } : CONFIG_PADRAO;
    } catch { return CONFIG_PADRAO; }
  },

  salvarConfig(cfg) {
    localStorage.setItem(this.CHAVE_CFG, JSON.stringify(cfg));
    for (const fn of this.ouvintesCfg) fn();
  },

  observarConfig(callback) {
    const emitir = () => callback(this.lerConfig());
    this.ouvintesCfg.add(emitir);
    emitir();
    return () => this.ouvintesCfg.delete(emitir);
  },

  // --- servicos no modo demonstracao ---
  CHAVE_SRV: "agenda_demo_servicos_v1",
  ouvintesSrv: new Set(),

  lerServicosDemo() {
    try {
      const cru = localStorage.getItem(this.CHAVE_SRV);
      return cru ? JSON.parse(cru) : SERVICOS_PADRAO.map((s, i) => ({ ...s, id: "srv_" + i, ordem: i + 1 }));
    } catch { return SERVICOS_PADRAO; }
  },

  gravarServicos(lista) {
    localStorage.setItem(this.CHAVE_SRV, JSON.stringify(lista));
    for (const fn of this.ouvintesSrv) fn();
  },

  observarServicos(callback) {
    const emitir = () => callback(this.lerServicosDemo());
    this.ouvintesSrv.add(emitir);
    emitir();
    return () => this.ouvintesSrv.delete(emitir);
  },

  salvarServico(s) {
    const lista = this.lerServicosDemo();
    if (s.id) {
      const i = lista.findIndex((x) => x.id === s.id);
      if (i >= 0) lista[i] = { ...lista[i], ...s };
    } else {
      lista.push({ ...s, id: "srv_" + Math.random().toString(36).slice(2, 8) });
    }
    this.gravarServicos(lista);
    return s.id;
  },

  removerServico(id) {
    this.gravarServicos(this.lerServicosDemo().filter((s) => s.id !== id));
  },

  marcarLembrete(id) {
    const lista = this.ler().map((a) =>
      a.id === id ? { ...a, lembreteEnviadoEm: new Date() } : a);
    this.gravar(lista);
  },

  desbloquear(id) {
    this.gravarBloqueios(this.lerBloqueios().filter((b) => b.id !== id));
  },

  criar(dados) {
    const lista = this.ler();
    const inicio = dados.inicio;
    const fim = new Date(inicio.getTime() + dados.duracaoMin * 60000);

    const conflito = lista.some(
      (a) => a.status !== "cancelado" && a.inicio < fim && a.fim > inicio
    );
    if (conflito) {
      const e = new Error("HORARIO_OCUPADO");
      e.codigo = "HORARIO_OCUPADO";
      throw e;
    }

    const id = "demo_" + Math.random().toString(36).slice(2, 10);
    lista.push({ id, ...dados, inicio, fim, status: dados.status || "pendente" });
    this.gravar(lista);
    return id;
  },

  mudarStatus(id, status) {
    const lista = this.ler().map((a) => (a.id === id ? { ...a, status } : a));
    this.gravar(lista);
  },

  remarcar(id, novoInicio, duracaoMin) {
    const lista = this.ler().map((a) =>
      a.id === id
        ? { ...a, inicio: novoInicio, fim: new Date(novoInicio.getTime() + duracaoMin * 60000) }
        : a
    );
    this.gravar(lista);
  },

  excluir(id) {
    this.gravar(this.ler().filter((a) => a.id !== id));
  },

  // Cria alguns atendimentos de exemplo no primeiro acesso,
  // para o painel nao abrir vazio na demonstracao.
  semear() {
    if (localStorage.getItem(this.CHAVE)) return;

    const hoje = new Date();
    const as = (dia, hora, min = 0) => {
      const d = new Date(hoje);
      d.setDate(d.getDate() + dia);
      d.setHours(hora, min, 0, 0);
      return d;
    };

    const exemplos = [
      { clienteNome: "Marina Salgado", servicoNome: "Massagem Relaxante", duracaoMin: 60, inicio: as(0, 10), status: "confirmado" },
      { clienteNome: "Rafael Tostes",  servicoNome: "Massagem Tântrica",  duracaoMin: 90, inicio: as(0, 14), status: "pendente"   },
      { clienteNome: "Juliana Prado",  servicoNome: "Massagem Nuru",      duracaoMin: 90, inicio: as(0, 17), status: "confirmado" },
      { clienteNome: "Diego Vasques",  servicoNome: "Massagem Relaxante", duracaoMin: 60, inicio: as(1, 9),  status: "pendente"   },
      { clienteNome: "Camila Roldão",  servicoNome: "Massagem Lingam",    duracaoMin: 60, inicio: as(1, 15), status: "confirmado" },
      { clienteNome: "Bruno Meireles", servicoNome: "Massagem Relaxante", duracaoMin: 60, inicio: as(-1, 11), status: "concluido" },
      { clienteNome: "Letícia Andrade",servicoNome: "Massagem Tântrica",  duracaoMin: 90, inicio: as(-1, 16), status: "concluido" },
      { clienteNome: "Paulo Vinhas",   servicoNome: "Massagem Nuru",      duracaoMin: 90, inicio: as(2, 13), status: "pendente"   }
    ];

    const lista = exemplos.map((e, i) => ({
      id: "demo_seed_" + i,
      clienteContato: "",
      observacoes: "",
      origem: i % 3 === 0 ? "site" : "painel",
      ...e,
      fim: new Date(e.inicio.getTime() + e.duracaoMin * 60000)
    }));

    localStorage.setItem(this.CHAVE, JSON.stringify(lista));
  }
};
