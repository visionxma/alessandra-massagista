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
    origem: d.origem || "painel"
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
// Servicos
// ---------------------------------------------------------------------

export const SERVICOS_PADRAO = [
  { nome: "Massagem Relaxante", duracaoMin: 60 },
  { nome: "Massagem Tântrica",  duracaoMin: 90 },
  { nome: "Massagem Nuru",      duracaoMin: 90 },
  { nome: "Massagem Lingam",    duracaoMin: 60 }
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
