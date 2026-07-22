# Painel de agendamentos

- `/painel/` - area da Alessandra (login protegido)
- `/agendar/` - agendamento publico, usado pelos clientes

## Antes de usar em producao

1. Siga `firebase/CONFIGURAR.md`
2. Cole as credenciais em `painel/js/config.js`

Sem as credenciais o sistema roda em **modo demonstracao**: os dados
ficam apenas no navegador, sem sincronizar entre aparelhos.
