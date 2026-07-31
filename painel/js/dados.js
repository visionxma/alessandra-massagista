// =====================================================================
// Camada de dados
//
// Todo o resto do painel fala com este modulo, nunca com o Firebase
// diretamente. Isso mantem a interface independente do backend e
// permite o modo demonstracao offline.
// =====================================================================

import { firebaseConfig, MODO_DEMO } from "./config.js?v=9";

const CDN = "https://www.gstatic.com/firebasejs/10.12.2";

let db = null;
let auth = null;
let fb = {};        // funcoes do SDK, carregadas sob demanda

// ---------------------------------------------------------------------
// Cache leve com TTL para reduzir consumo do Firestore.
//
// So aplicado a leituras publicas (agendar/), onde o usuario:
//  - abre a pagina, escolhe servico, volta, muda dia -> re-consulta
//  - fecha e reabre em minutos -> re-consulta
//
// TTL curto (60s) evita mostrar horario ja tomado como "livre".
// Chave por range de datas (deData|ateData) para consultas de janela.
// ---------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheChave(prefixo, ...partes) {
  return prefixo + "|" + partes.map((p) => (p instanceof Date ? p.getTime() : String(p))).join("|");
}

function cacheGet(chave) {
  const item = cache.get(chave);
  if (!item) return null;
  if (performance.now() - item.em > CACHE_TTL_MS) {
    cache.delete(chave);
    return null;
  }
  return item.valor;
}

function cacheSet(chave, valor) {
  cache.set(chave, { valor, em: performance.now() });
  // limita o cache a 40 entradas (rotativo, LRU aproximado)
  if (cache.size > 40) {
    const primeira = cache.keys().next().value;
    cache.delete(primeira);
  }
}

// invalida entradas por prefixo (chamado apos criar/mudar/excluir agendamento)
function cacheInvalidar(prefixo) {
  for (const chave of cache.keys()) {
    if (chave.startsWith(prefixo + "|")) cache.delete(chave);
  }
}

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

  // A checagem de conflito le o ESPELHO anonimo, nunca a colecao com
  // dados pessoais. Assim o visitante do site nao precisa de permissao
  // para ler nome ou telefone de ninguem.
  return fb.runTransaction(db, async (tx) => {
    const q = fb.query(
      fb.collection(db, "ocupados"),
      fb.where("inicio", ">=", fb.Timestamp.fromDate(janelaInicio)),
      fb.where("inicio", "<=", fb.Timestamp.fromDate(janelaFim))
    );

    const existentes = await fb.getDocs(q);
    const conflito = existentes.docs.some((d) => {
      const a = d.data();
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

    // espelho com o MESMO id: facilita manter os dois em sincronia
    const refEspelho = fb.doc(db, "ocupados", ref.id);

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

    // SO horario: nenhum dado pessoal atravessa para o lado publico
    tx.set(refEspelho, {
      inicio: fb.Timestamp.fromDate(inicio),
      fim: fb.Timestamp.fromDate(fim)
    });

    // novo horario tomado invalida qualquer cache de "ocupados"
    cacheInvalidar("ocupados");
    return ref.id;
  });
}

// Mantem o espelho em sincronia quando o agendamento muda de estado.
// Cancelado ou excluido libera o horario; remarcado move o bloqueio.
async function sincronizarEspelho(id, { inicio, fim, liberar } = {}) {
  if (MODO_DEMO) return;
  const ref = fb.doc(db, "ocupados", id);
  try {
    if (liberar) {
      await fb.deleteDoc(ref);
    } else if (inicio && fim) {
      await fb.setDoc(ref, {
        inicio: fb.Timestamp.fromDate(inicio),
        fim: fb.Timestamp.fromDate(fim)
      });
    }
    cacheInvalidar("ocupados");
  } catch {
    // o espelho e um indice auxiliar: falhar aqui nao invalida a operacao
  }
}

// ---------------------------------------------------------------------
// Alterar status / remarcar / excluir
// ---------------------------------------------------------------------

export async function mudarStatus(id, status) {
  if (MODO_DEMO) return demo.mudarStatus(id, status);

  const ref = fb.doc(db, "agendamentos", id);
  await fb.updateDoc(ref, { status, atualizadoEm: fb.serverTimestamp() });

  // cancelado libera o horario; reativado volta a ocupar
  if (status === "cancelado") {
    await sincronizarEspelho(id, { liberar: true });
  } else {
    try {
      const snap = await fb.getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        await sincronizarEspelho(id, { inicio: d.inicio.toDate(), fim: d.fim.toDate() });
      }
    } catch { /* espelho e auxiliar */ }
  }
}

export async function remarcar(id, novoInicio, duracaoMin) {
  if (MODO_DEMO) return demo.remarcar(id, novoInicio, duracaoMin);
  const fim = new Date(novoInicio.getTime() + duracaoMin * 60000);
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    inicio: fb.Timestamp.fromDate(novoInicio),
    fim: fb.Timestamp.fromDate(fim),
    atualizadoEm: fb.serverTimestamp()
  });
  await sincronizarEspelho(id, { inicio: novoInicio, fim });
}

export async function excluir(id) {
  if (MODO_DEMO) return demo.excluir(id);
  await fb.deleteDoc(fb.doc(db, "agendamentos", id));
  await sincronizarEspelho(id, { liberar: true });
}

// ---------------------------------------------------------------------
// Horarios ocupados (espelho publico e anonimo)
//
// Usado pela pagina de agendamento para montar a grade. Contem apenas
// inicio e fim: nenhum dado pessoal fica exposto ao visitante.
// ---------------------------------------------------------------------

export function observarOcupados(deData, ateData, callback) {
  if (MODO_DEMO) {
    return demo.observar(deData, ateData, (lista) =>
      callback(lista
        .filter((a) => a.status !== "cancelado")
        .map((a) => ({ inicio: a.inicio, fim: a.fim }))));
  }

  // cache-first: entrega imediato do cache (se fresco), snapshot atualiza depois
  const chave = cacheChave("ocupados", deData, ateData);
  const cached = cacheGet(chave);
  if (cached) callback(cached);

  const q = fb.query(
    fb.collection(db, "ocupados"),
    fb.where("inicio", ">=", fb.Timestamp.fromDate(deData)),
    fb.where("inicio", "<=", fb.Timestamp.fromDate(ateData))
  );

  return fb.onSnapshot(q, (snap) => {
    const lista = snap.docs.map((d) => {
      const x = d.data();
      return {
        inicio: x.inicio?.toDate ? x.inicio.toDate() : new Date(x.inicio),
        fim: x.fim?.toDate ? x.fim.toDate() : new Date(x.fim)
      };
    });
    cacheSet(chave, lista);
    callback(lista);
  }, () => callback([]));
}

// ---------------------------------------------------------------------
// Auto-cleanup: remove ocupados antigos para nao crescer sem limite.
//
// O espelho 'ocupados' e consultado pelo site publico toda vez que
// alguem abre /agendar/. Se nunca for limpo, cada consulta le tambem
// horarios de meses atras que ja nao interessam a ninguem.
//
// Roda so uma vez por dia (guardado em localStorage) e so quando o
// painel autenticado abre. Segue silencioso se falhar - o Firestore
// tem limite de 500 deletes por batch, aqui usamos 200 por seguranca.
// ---------------------------------------------------------------------

const CHAVE_ULTIMO_CLEANUP = "ocupados_cleanup_ultimo";
const CHAVE_MIGRACAO_SERVICOS = "servicos_migracao_v2_aplicada";
const DIAS_MANTER_OCUPADOS = 60;

// Migracao unica dos servicos legados: adiciona slug, ativo=true, e
// atualiza precoCentavos dos que estao no padrao para o valor oficial
// (R$ 400 nas modalidades individuais, R$ 800 no casais). Roda so uma
// vez por conta autenticada, silencioso. Nao mexe em servicos criados
// pelo painel que nao tenham correspondencia no padrao.
export async function migrarServicosSePreciso() {
  if (MODO_DEMO) return { pulado: true, demo: true };
  if (!auth?.currentUser) return { pulado: true, semLogin: true };

  try {
    if (localStorage.getItem(CHAVE_MIGRACAO_SERVICOS) === "1") {
      return { pulado: true, jaFeita: true };
    }
  } catch { /* sem localStorage: tenta rodar */ }

  try {
    const snap = await fb.getDocs(fb.collection(db, "servicos"));
    if (snap.empty) {
      try { localStorage.setItem(CHAVE_MIGRACAO_SERVICOS, "1"); } catch {}
      return { atualizados: 0 };
    }

    let atualizados = 0;
    const batch = fb.writeBatch(db);

    for (const doc of snap.docs) {
      const atual = doc.data();
      const padrao = SERVICOS_PADRAO.find((p) => p.nome === atual.nome);
      const patch = {};

      // slug: gera do nome, so se faltar
      if (!atual.slug) {
        patch.slug = slugDo(atual.nome || "");
      }

      // ativo: garante que existe (default true)
      if (atual.ativo === undefined) {
        patch.ativo = true;
      }

      // preco: se ha padrao com precoTexto oficial e o atual esta
      // diferente, atualiza pro oficial (corrige os R$ 180/220/250 etc)
      if (padrao?.precoTexto) {
        const centavosPadrao = centavosDoTexto(padrao.precoTexto);
        if (centavosPadrao && atual.precoCentavos !== centavosPadrao) {
          patch.precoCentavos = centavosPadrao;
        }
      }

      // descricaoLonga e beneficios: comeca vazio, dono preenche
      if (atual.descricaoLonga === undefined) patch.descricaoLonga = "";
      if (atual.beneficios === undefined) patch.beneficios = [];

      if (Object.keys(patch).length) {
        batch.update(doc.ref, patch);
        atualizados++;
      }
    }

    if (atualizados) await batch.commit();
    try { localStorage.setItem(CHAVE_MIGRACAO_SERVICOS, "1"); } catch {}
    return { atualizados };
  } catch (erro) {
    console.warn("Falha na migracao de servicos:", erro);
    return { erro: erro?.code };
  }
}

// helpers locais da migracao
function slugDo(nome) {
  return String(nome)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

function centavosDoTexto(texto) {
  // "R$ 400" -> 40000
  const so = String(texto).replace(/[^\d,\.]/g, "").replace(",", ".");
  const n = parseFloat(so);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export async function limparOcupadosAntigos() {
  if (MODO_DEMO) return { removidos: 0, demo: true };
  if (!auth?.currentUser) return { removidos: 0, semLogin: true };

  // executa no maximo uma vez por dia
  try {
    const ultimo = Number(localStorage.getItem(CHAVE_ULTIMO_CLEANUP)) || 0;
    if (Date.now() - ultimo < 24 * 60 * 60 * 1000) return { removidos: 0, pulado: true };
  } catch { /* localStorage indisponivel: segue */ }

  const corte = new Date();
  corte.setDate(corte.getDate() - DIAS_MANTER_OCUPADOS);

  try {
    const q = fb.query(
      fb.collection(db, "ocupados"),
      fb.where("fim", "<", fb.Timestamp.fromDate(corte)),
      fb.limit(200)
    );
    const snap = await fb.getDocs(q);
    if (snap.empty) {
      try { localStorage.setItem(CHAVE_ULTIMO_CLEANUP, String(Date.now())); } catch {}
      return { removidos: 0 };
    }

    // apaga em batch (transacional)
    const batch = fb.writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    try { localStorage.setItem(CHAVE_ULTIMO_CLEANUP, String(Date.now())); } catch {}
    return { removidos: snap.size };
  } catch (erro) {
    // falhar aqui nao invalida o painel: e apenas manutencao
    console.warn("Falha na limpeza de ocupados antigos:", erro);
    return { removidos: 0, erro: erro?.code };
  }
}

// ---------------------------------------------------------------------
// Bloqueios: dias em que a profissional nao atende
// ---------------------------------------------------------------------

export function observarBloqueios(callback) {
  if (MODO_DEMO) return demo.observarBloqueios(callback);

  const chave = "bloqueios|todos";
  const cached = cacheGet(chave);
  if (cached) callback(cached);

  return fb.onSnapshot(
    fb.collection(db, "bloqueios"),
    async (snap) => {
      const lista = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          inicio: x.inicio?.toDate ? x.inicio.toDate() : new Date(x.inicio),
          fim: x.fim?.toDate ? x.fim.toDate() : new Date(x.fim),
          motivo: x.motivo || "",   // legado: bloqueios antigos
          diaTodo: x.diaTodo !== false
        };
      });

      cacheSet(chave, lista);
      callback(lista);

      // Os motivos so chegam para quem esta autenticado. No site publico
      // esta leitura falha silenciosamente, como deve ser.
      try {
        const privados = await fb.getDocs(fb.collection(db, "bloqueiosPrivados"));
        if (privados.empty) return;
        const mapa = new Map(privados.docs.map((d) => [d.id, d.data().motivo || ""]));
        const comMotivo = lista.map((b) => ({ ...b, motivo: mapa.get(b.id) || b.motivo }));
        if (comMotivo.some((b, i) => b.motivo !== lista[i].motivo)) callback(comMotivo);
      } catch { /* visitante nao le motivos: comportamento esperado */ }
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

  // publico: apenas quando nao ha atendimento
  const ref = await fb.addDoc(fb.collection(db, "bloqueios"), {
    inicio: fb.Timestamp.fromDate(inicio),
    fim: fb.Timestamp.fromDate(fim),
    diaTodo,
    criadoEm: fb.serverTimestamp()
  });

  // privado: o motivo e assunto so da profissional
  if (motivo) {
    try {
      await fb.setDoc(fb.doc(db, "bloqueiosPrivados", ref.id), { motivo });
    } catch { /* o bloqueio ja valeu; o motivo e complementar */ }
  }
  cacheInvalidar("bloqueios");
  return ref.id;
}

export async function desbloquear(id) {
  if (MODO_DEMO) return demo.desbloquear(id);
  await fb.deleteDoc(fb.doc(db, "bloqueios", id));
  try {
    await fb.deleteDoc(fb.doc(db, "bloqueiosPrivados", id));
  } catch { /* pode nao existir motivo */ }
  cacheInvalidar("bloqueios");
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

  const chave = "config|agenda";
  const cached = cacheGet(chave);
  if (cached) callback(cached);

  return fb.onSnapshot(
    fb.doc(db, "configuracao", "agenda"),
    (snap) => {
      const cfg = snap.exists() ? { ...CONFIG_PADRAO, ...snap.data() } : CONFIG_PADRAO;
      cacheSet(chave, cfg);
      callback(cfg);
    },
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
      const doBanco = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.ativo !== false)
        .filter((s) => !s.excluidoEm)   // esconde itens da lixeira
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      callback(mesclarComPadrao(doBanco).map(normalizarServico));
    },
    () => callback(SERVICOS_PADRAO)
  );
}

// Escuta apenas servicos na lixeira (com excluidoEm). Callback recebe
// lista ordenada pelo mais recente exclusao primeiro.
export function observarLixeira(callback) {
  if (MODO_DEMO) return demo.observarLixeiraServicos?.(callback) || (() => {});

  return fb.onSnapshot(
    fb.collection(db, "servicos"),
    (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.excluidoEm)
        .map((s) => ({
          ...s,
          excluidoEm: s.excluidoEm?.toDate ? s.excluidoEm.toDate() : new Date(s.excluidoEm)
        }))
        .sort((a, b) => b.excluidoEm - a.excluidoEm);
      callback(lista);
    },
    () => callback([])
  );
}

export async function salvarServico(servico) {
  if (MODO_DEMO) return demo.salvarServico(servico);

  const dados = {
    nome: servico.nome.trim(),
    // slug travado: gerado uma vez na criacao, nunca alterado depois.
    // Protege as URLs ja indexadas pelo Google.
    slug: (servico.slug || "").trim(),
    descricao: (servico.descricao || "").trim(),
    descricaoLonga: (servico.descricaoLonga || "").trim(),
    beneficios: Array.isArray(servico.beneficios)
      ? servico.beneficios.map((b) => String(b).trim()).filter(Boolean).slice(0, 6)
      : [],
    duracaoMin: Number(servico.duracaoMin) || 60,
    precoCentavos: Number(servico.precoCentavos) || 0,
    ordem: Number(servico.ordem) || 99,
    ativo: servico.ativo !== false,
    atualizadoEm: fb.serverTimestamp()
  };

  if (servico.id) {
    await fb.updateDoc(fb.doc(db, "servicos", servico.id), dados);
    return servico.id;
  }
  const ref = await fb.addDoc(fb.collection(db, "servicos"), dados);
  return ref.id;
}

// Soft delete: move o servico para a lixeira mantendo o registro no
// banco. A UI trata como excluido (some da LP e do agendamento), mas
// e recuperavel pela tela de Lixeira.
export async function removerServico(id) {
  if (MODO_DEMO) return demo.removerServico?.(id);
  await fb.updateDoc(fb.doc(db, "servicos", id), {
    excluidoEm: fb.serverTimestamp(),
    ativo: false
  });
}

// Restaura um servico da lixeira: limpa o marcador de exclusao e o
// deixa ativo novamente.
export async function restaurarDaLixeira(id) {
  if (MODO_DEMO) return demo.restaurarServico?.(id);
  await fb.updateDoc(fb.doc(db, "servicos", id), {
    excluidoEm: fb.deleteField(),
    ativo: true
  });
}

// Apaga definitivamente do banco. So chamada quando o servico ja esta
// na lixeira e o dono confirma a exclusao permanente.
export async function excluirPermanente(id) {
  if (MODO_DEMO) return demo.excluirServicoPermanente?.(id);
  await fb.deleteDoc(fb.doc(db, "servicos", id));
}

// Migracao manual: forca a atualizacao dos precos padroes agora, sem
// esperar o boot automatico. Serve pro botao "Atualizar precos padrao"
// no painel. Ignora o marker de localStorage.
export async function forcarMigracaoServicos() {
  if (MODO_DEMO) return { pulado: true, demo: true };
  if (!auth?.currentUser) return { pulado: true, semLogin: true };
  // remove marker antigo, se existir, para migrarServicosSePreciso rodar
  try { localStorage.removeItem(CHAVE_MIGRACAO_SERVICOS); } catch {}
  return migrarServicosSePreciso();
}

// ---------------------------------------------------------------------
// Lembrete: marca que o cliente ja foi avisado
// ---------------------------------------------------------------------

// Congela o preco no agendamento (aplicado pela profissional ao
// concluir). So autenticado consegue, pela regra do Firestore.
export async function definirPreco(id, precoCentavos) {
  if (MODO_DEMO) {
    const lista = demo.ler().map((a) =>
      a.id === id ? { ...a, precoCentavos } : a);
    demo.gravar(lista);
    return;
  }
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    precoCentavos: Number(precoCentavos) || 0
  });
}

export async function marcarLembreteEnviado(id) {
  if (MODO_DEMO) return demo.marcarLembrete(id);
  await fb.updateDoc(fb.doc(db, "agendamentos", id), {
    lembreteEnviadoEm: fb.serverTimestamp()
  });
}

// ---------------------------------------------------------------------
// Trilha de auditoria (imutavel pela regra do Firestore).
//
// Registra QUE evento aconteceu, nunca o CONTEUDO sensivel: sem nome de
// cliente, telefone, senha ou token. Serve para investigar acessos e
// alteracoes suspeitas. Falhar aqui nunca bloqueia a operacao principal.
// ---------------------------------------------------------------------

// Le os ultimos eventos de auditoria (so a profissional autenticada).
export async function lerAuditoria(limite = 50) {
  if (MODO_DEMO) return [];
  try {
    const q = fb.query(
      fb.collection(db, "auditoria"),
      fb.orderBy("em", "desc"),
      fb.limit(limite)
    );
    const snap = await fb.getDocs(q);
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        evento: x.evento || "",
        detalhe: x.detalhe || "",
        em: x.em?.toDate ? x.em.toDate() : null
      };
    });
  } catch {
    return [];
  }
}

// Exporta toda a agenda para backup local. Le tudo de uma vez (so
// autenticado consegue) e devolve um objeto pronto para virar arquivo.
export async function exportarTudo() {
  if (MODO_DEMO) {
    return { demo: true, agendamentos: demo.ler(), servicos: demo.lerServicosDemo() };
  }

  const colecoes = ["agendamentos", "servicos", "bloqueios", "bloqueiosPrivados", "configuracao"];
  const saida = { exportadoEm: new Date().toISOString(), versao: 1 };

  for (const nome of colecoes) {
    const snap = await fb.getDocs(fb.collection(db, nome));
    saida[nome] = snap.docs.map((d) => {
      const x = d.data();
      // converte timestamps para texto legivel
      const limpo = {};
      for (const [k, v] of Object.entries(x)) {
        limpo[k] = v?.toDate ? v.toDate().toISOString() : v;
      }
      return { id: d.id, ...limpo };
    });
  }
  return saida;
}

export async function auditar(evento, detalhe = "") {
  if (MODO_DEMO) return;
  if (!auth?.currentUser) return;
  try {
    await fb.addDoc(fb.collection(db, "auditoria"), {
      evento: String(evento).slice(0, 40),
      detalhe: String(detalhe).slice(0, 200),
      em: fb.serverTimestamp(),
      uid: auth.currentUser.uid
    });
  } catch { /* auditoria e complementar, nunca critica */ }
}

// ---------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------

// Espelho local dos servicos: a lista aparece na hora, sem esperar a rede.
// Se o banco tiver algo diferente, o que vem de la substitui esta lista.
export const SERVICOS_PADRAO = [
  { nome: "Massagem Relaxante",       duracaoMin: 60,  precoTexto: "R$ 400", descricao: "Movimentos amplos e contínuos que soltam a tensão do corpo inteiro." },
  { nome: "Massagem Tântrica",        duracaoMin: 90,  precoTexto: "R$ 400", descricao: "Ritual de respiração, toque e presença." },
  { nome: "Massagem Nuru",            duracaoMin: 90,  precoTexto: "R$ 400", descricao: "Contato corpo a corpo com gel específico." },
  { nome: "Massagem Lingam",          duracaoMin: 60,  precoTexto: "R$ 400", descricao: "Técnica focada, conduzida com calma." },
  { nome: "Massagem Mix",             duracaoMin: 120, precoTexto: "R$ 400", descricao: "Escolha 2 ou 3 técnicas (Relaxante, Nuru, Tântrica) numa única sessão." },
  { nome: "Spa dos Pés",              duracaoMin: 45,  precoTexto: "R$ 400", descricao: "Escalda-pés aromático, esfoliação e massagem com pedras quentes." },
  { nome: "Tântrica para Casais",     duracaoMin: 120, precoTexto: "R$ 800", descricao: "Ritual tântrico conduzido para o casal (a dois)." }
];

export async function lerServicos() {
  if (MODO_DEMO) return SERVICOS_PADRAO;
  try {
    const snap = await fb.getDocs(fb.collection(db, "servicos"));
    if (snap.empty) return SERVICOS_PADRAO;
    const doBanco = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.ativo !== false)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    return mesclarComPadrao(doBanco).map(normalizarServico);
  } catch {
    return SERVICOS_PADRAO;
  }
}

// ---------------------------------------------------------------------
// Servicos: normalizacao e mesclagem
//
// O banco pode nao ter os campos novos (precoTexto, Mix, Casais) porque
// foi cadastrado antes. Estas duas funcoes garantem que a lista final
// sempre tenha preco visivel e todos os servicos ofertados hoje, mesmo
// sem editar cada um pelo painel.
// ---------------------------------------------------------------------

// Preenche precoTexto e descricao. Prioridade:
//   1. Se existe padrao com o mesmo nome, o padrao vence (fonte da
//      verdade dos precos oficiais). Isso protege contra dados antigos
//      no banco com precoCentavos desatualizado.
//   2. Se nao ha padrao (servico novo criado pelo painel), usa o que
//      esta no banco: precoTexto explicito ou derivado de precoCentavos.
// Preenche precoTexto e descricao. Prioridade:
//   1. Dados do banco (o painel edita e vale imediatamente).
//   2. Fallback: padrao pelo nome do servico.
// Servicos com ativo=false sao filtrados fora ANTES de chegar aqui.
function normalizarServico(s) {
  const padrao = SERVICOS_PADRAO.find((p) => p.nome === s.nome);

  const precoTexto = s.precoTexto
    || (s.precoCentavos ? formatarPrecoDeCentavos(s.precoCentavos) : null)
    || padrao?.precoTexto
    || "";

  return {
    ...s,
    precoTexto,
    descricao: s.descricao || padrao?.descricao || ""
  };
}

// Se o banco nao tiver um servico do padrao (Mix, Casais recentes),
// injeta ele na lista para o cliente ainda poder agendar.
function mesclarComPadrao(doBanco) {
  const nomesNoBanco = new Set(doBanco.map((s) => s.nome));
  const faltantes = SERVICOS_PADRAO.filter((p) => !nomesNoBanco.has(p.nome));
  return [...doBanco, ...faltantes];
}

function formatarPrecoDeCentavos(centavos) {
  const reais = Math.round(Number(centavos) / 100);
  return `R$ ${reais}`;
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
      const lista = cru ? JSON.parse(cru) : SERVICOS_PADRAO.map((s, i) => ({ ...s, id: "srv_" + i, ordem: i + 1 }));
      // aplica a mesma normalizacao/mesclagem que o modo Firebase usa
      return mesclarComPadrao(lista).map(normalizarServico);
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
