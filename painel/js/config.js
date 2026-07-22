// =====================================================================
// Credenciais do Firebase
//
// Substitua os valores abaixo pelo bloco que o Console do Firebase
// mostra em: Configuracoes do projeto > Seus apps > Web.
// Passo a passo completo em firebase/CONFIGURAR.md
// =====================================================================

export const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "COLE_AQUI",
  projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};

// Enquanto as credenciais nao forem preenchidas, o painel roda em modo
// demonstracao: os dados ficam so no navegador e nada e enviado.
export const MODO_DEMO = firebaseConfig.apiKey === "COLE_AQUI";

// Fuso usado para montar a grade de horarios
export const FUSO = "America/Sao_Paulo";
