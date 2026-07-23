import { initializeApp } from "firebase/app";
import { getFirestore, doc, collection, runTransaction, serverTimestamp, Timestamp, getDocs, query, where } from "firebase/firestore";

const app = initializeApp({
  apiKey: "AIzaSyDORhokbVBQFeydz4pG5FRKCaWBB8_6bOo",
  authDomain: "alessandra-massagista.firebaseapp.com",
  projectId: "alessandra-massagista"
});
const db = getFirestore(app);
const inicio = new Date(Date.now() + 2*24*60*60000);
const fim = new Date(inicio.getTime() + 60*60000);

// replica EXATAMENTE o que dados.js faz
try {
  await runTransaction(db, async (tx) => {
    const jIni = new Date(inicio.getTime() - 4*3600000);
    const jFim = new Date(fim.getTime() + 4*3600000);
    const q = query(collection(db, "ocupados"),
      where("inicio", ">=", Timestamp.fromDate(jIni)),
      where("inicio", "<=", Timestamp.fromDate(jFim)));
    await getDocs(q);
    const ref = doc(collection(db, "agendamentos"));
    const refEsp = doc(db, "ocupados", ref.id);
    tx.set(ref, {
      clienteNome: "Diag SDK", clienteContato: "(31) 99988-7766",
      servicoNome: "Massagem Relaxante", duracaoMin: 60,
      inicio: Timestamp.fromDate(inicio), fim: Timestamp.fromDate(fim),
      status: "pendente", observacoes: "", origem: "site",
      precoCentavos: 0, lembreteMin: 180, criadoEm: serverTimestamp()
    });
    tx.set(refEsp, { inicio: Timestamp.fromDate(inicio), fim: Timestamp.fromDate(fim) });
  });
  console.log("SUCESSO: transacao completou");
} catch (e) {
  console.log("FALHOU:", e.code, "-", e.message.slice(0,150));
}
process.exit(0);
