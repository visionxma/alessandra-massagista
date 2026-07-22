# Configurar o Firebase (uma vez só)

Siga na ordem. Leva cerca de 10 minutos.

---

## 1. Criar o projeto

1. Acesse <https://console.firebase.google.com> e clique em **Adicionar projeto**
2. Nome: `alessandra-agenda`
3. Pode **desativar** o Google Analytics (não é necessário aqui)
4. Clique em **Criar projeto** e aguarde

---

## 2. Criar o banco de dados

1. No menu lateral, vá em **Criar** → **Firestore Database**
2. Clique em **Criar banco de dados**
3. Escolha o modo **produção** (as regras corretas entram no passo 4)
4. Local: **southamerica-east1 (São Paulo)** — importante para a velocidade

---

## 3. Ativar o login da Alessandra

1. Menu lateral → **Criar** → **Authentication** → **Vamos começar**
2. Na aba **Sign-in method**, clique em **E-mail/senha** e **ative** a primeira opção
3. Vá na aba **Users** → **Adicionar usuário**
4. Cadastre o e-mail e a senha que a Alessandra usará para entrar no painel
5. Guarde essa senha: é ela que dá acesso à agenda

---

## 4. Publicar as regras de segurança

1. Vá em **Firestore Database** → aba **Regras**
2. Apague tudo que estiver lá
3. Cole o conteúdo inteiro do arquivo `firestore.rules` (nesta mesma pasta)
4. Clique em **Publicar**

Sem esse passo, ou o site não consegue agendar, ou os dados ficam expostos.

---

## 5. Registrar o aplicativo e pegar as credenciais

1. Clique na engrenagem ⚙️ (ao lado de "Visão geral do projeto") → **Configurações do projeto**
2. Role até **Seus apps** e clique no ícone **`</>`** (Web)
3. Apelido: `painel-agenda`. **Não** marque Firebase Hosting
4. Clique em **Registrar app**
5. Vai aparecer um bloco de código com `const firebaseConfig = { ... }`

**Copie esse bloco inteiro e me envie.** São seis linhas parecidas com:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "alessandra-agenda.firebaseapp.com",
  projectId: "alessandra-agenda",
  storageBucket: "alessandra-agenda.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### Pode enviar sem receio

Essas credenciais são **públicas por natureza** — elas ficam visíveis no código de
qualquer site que usa Firebase. A segurança real está nas regras do passo 4, que
impedem qualquer pessoa de ler os dados dos clientes.

O que **nunca** deve ser compartilhado é a chave privada de conta de serviço
(*service account*), que fica em outra aba e não usamos aqui.

---

## 6. Autorizar o domínio do site

1. Em **Authentication** → aba **Settings** → **Domínios autorizados**
2. Clique em **Adicionar domínio** e inclua:
   - `visionxma.github.io`

Sem isso o login do painel falha quando publicado.

---

## Pronto

Me envie o bloco `firebaseConfig` do passo 5 e eu conecto o painel.
