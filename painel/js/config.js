// =====================================================================
// Credenciais do Firebase
//
// Substitua os valores abaixo pelo bloco que o Console do Firebase
// mostra em: Configuracoes do projeto > Seus apps > Web.
// Passo a passo completo em firebase/CONFIGURAR.md
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDORhokbVBQFeydz4pG5FRKCaWBB8_6bOo",
  authDomain: "alessandra-massagista.firebaseapp.com",
  projectId: "alessandra-massagista",
  storageBucket: "alessandra-massagista.firebasestorage.app",
  messagingSenderId: "310032943442",
  appId: "1:310032943442:web:296ceb566b98aaf8d4928b"
};

// Enquanto as credenciais nao forem preenchidas, o painel roda em modo
// demonstracao: os dados ficam so no navegador e nada e enviado.
export const MODO_DEMO = firebaseConfig.apiKey === "COLE_AQUI";

// Fuso usado para montar a grade de horarios
export const FUSO = "America/Sao_Paulo";
