# STIPTV — site de planos com WhatsApp e checkout

Landing page profissional para venda de assinaturas de IPTV, com quatro planos
(mensal, trimestral, semestral e anual), botões que abrem o WhatsApp com a mensagem
já preenchida e estrutura pronta para receber pagamentos por PIX, cartão e boleto
via gateway (Mercado Pago) — sem nenhuma dependência externa.

## O que está pronto

- Página inicial responsiva (celular, tablet e desktop), tema escuro com gradientes.
- 4 planos com preço, valor por mês, percentual de economia, telas simultâneas e lista de benefícios.
- Todos os CTAs levam ao WhatsApp com mensagem específica do plano (`wa.me`).
- Seção de pagamento, compatibilidade de aparelhos, depoimentos de recursos, FAQ e rodapé.
- Checkout opcional com Mercado Pago (PIX, cartão em até 12x e boleto).
- Página de retorno do pagamento (`pagamento.html`) e página de termos/privacidade (`termos.html`).
- Servidor Node.js sem dependências: entrega os arquivos e cria a preferência de pagamento.

## Como rodar

Requer Node.js 18 ou superior.

```bash
node server.js
```

Abra <http://localhost:3000>.

> Sem o servidor, o site também abre clicando em `index.html` — nesse caso só o
> checkout online deixa de funcionar; o WhatsApp continua normal.

> Importante: se você visualizar os arquivos dentro de um **preview do chat/editor**,
> os links entre páginas não funcionam (a prévia roda isolada, em um documento `blob:`).
> Para navegar de verdade, abra sempre pelo endereço do servidor:
> <http://localhost:3000>. A `pagamento.html` mostra um aviso amarelo quando detecta
> que está em uma prévia.

---

## 1. Trocar marca, WhatsApp e preços (obrigatório)

Tudo fica em **`js/config.js`**:

| O que | Onde | Observação |
| --- | --- | --- |
| Nome da marca | `marca` | Aparece no logo, mensagens e páginas |
| WhatsApp | `whatsapp` | Somente números, com DDI: `5511987654321` |
| Mensagem padrão | `mensagemPadrao` | Texto que abre na conversa |
| Planos e preços | `planos[]` | `preco`, `meses`, `telas`, `tag`, `itens` |
| Pagamento online | `pagamento.ativo` | `false` = só WhatsApp |

O número de atendimento já está preenchido. Se precisar trocar, use somente números
com DDI 55 + DDD e confira se o link abre a conversa certa no celular e no computador.

### Se você ativar o pagamento

Os preços ficam **duplicados de propósito** em `server.js` (`PLANOS`), porque o valor
cobrado não pode ser decidido pelo navegador. Sempre que mudar um preço em
`js/config.js`, atualize o mesmo valor em `server.js`.

---

## 2. Ativar o pagamento online (Mercado Pago)

1. Crie/acesse sua conta no [Mercado Pago Developers](https://www.mercadopago.com.br/developers).
2. Em **Suas integrações → Credenciais**, copie o **Access Token**
   (comece com as credenciais de teste, que começam com `TEST-`).
3. Copie `.env.example` para `.env` e cole o token:

   ```env
   MP_ACCESS_TOKEN=TEST-0000000000000000-000000-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   BASE_URL=http://localhost:3000
   PORT=3000
   ```

4. Em `js/config.js`, mude `pagamento.ativo` para `true`.
5. Rode `node server.js` e clique em **Pagar com PIX ou cartão** em um plano.

O servidor cria a preferência de pagamento em `/api/criar-pagamento` e redireciona
o cliente para o checkout do Mercado Pago. O token fica **apenas no servidor**.

### Sobre o retorno do pagamento

O Mercado Pago exige uma URL pública (e HTTPS) para devolver o cliente ao site.
Para testar na sua máquina, use um túnel, por exemplo:

```bash
ngrok http 3000
```

E aponte `BASE_URL` para a URL gerada (`https://xxxx.ngrok-free.app`).
Em produção, `BASE_URL` deve ser o seu domínio com HTTPS.

### Testar sem dinheiro

Use as [contas de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/accounts)
e os [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/cards)
do Mercado Pago. PIX de teste também é aprovado automaticamente.

### Webhook (próximo passo)

`POST /api/webhook` já recebe as notificações e registra no console:

```text
[webhook] evento=payment id=123456789
```

Para liberar o acesso automaticamente, o próximo passo é: validar a assinatura
`x-signature`, consultar `GET https://api.mercadopago.com/v1/payments/:id`, salvar o
pedido e enviar o acesso (ou a API do WhatsApp Business). O ponto de partida está
comentado em `receberWebhook()` no `server.js`.

---

## 3. Publicar

**Só site + WhatsApp (sem checkout):** qualquer hospedagem estática serve
(Netlify, Vercel, Cloudflare Pages, Hostinger). Envie `index.html`,
`pagamento.html`, `termos.html`, `css/`, `js/` e `assets/`.

**Com checkout online:** precisa de hospedagem Node.js (Render, Railway, Fly.io,
VPS, Hostinger com Node). Configure as variáveis `MP_ACCESS_TOKEN` e `BASE_URL` no
painel da hospedagem — não suba o `.env` para o GitHub (ele já está no `.gitignore`).

---

## Estrutura de arquivos

```text
├── index.html          Página principal
├── pagamento.html      Retorno do gateway (status do pedido)
├── termos.html         Termos de uso, privacidade e reembolso
├── css/style.css       Todo o visual (tema, componentes, responsivo)
├── js/config.js        >>> marca, WhatsApp, planos e preços <<<
├── js/app.js           Cards dos planos, links do WhatsApp, menu, FAQ, animações
├── js/checkout.js      Chamada ao servidor e redirecionamento ao gateway
├── server.js           Servidor estático + API do Mercado Pago
├── assets/favicon.svg  Ícone do site
├── preview/            Capturas do site (desktop e celular) — não precisa publicar
├── .env.example        Modelo das variáveis de ambiente
└── package.json        Metadados e script "start"
```

## Onde editar cada coisa

| Quero mudar… | Arquivo |
| --- | --- |
| Preços, duração, telas e benefícios | `js/config.js` (e `server.js` se o pagamento estiver ativo) |
| Número do WhatsApp e mensagens | `js/config.js` |
| Textos do hero, vantagens e FAQ | `index.html` |
| Cores e espaçamentos | `css/style.css` (variáveis no topo, em `:root`) |
| Termos, privacidade e reembolso | `termos.html` |
| Regras do gateway | `server.js` |

## Segurança

- O Access Token **nunca** aparece no navegador — só é lido no servidor via `.env`.
- O preço cobrado vem da tabela do servidor, não do formulário do cliente.
- Cabeçalhos de segurança e proteção contra path traversal já estão no `server.js`.
- Ative a verificação de assinatura do webhook antes de liberar acessos em produção.

## Aviso importante

Este projeto é apenas a vitrine, o atendimento e o checkout. A oferta dos canais é
responsabilidade de quem opera o serviço: garanta que você tem os direitos de
distribuição dos conteúdos oferecidos e que os termos de uso refletem a sua operação.
Os textos jurídicos de `termos.html` são um modelo e devem ser revisados por um
advogado.
