'use strict';

/* =============================================================
   STIPTV — servidor do site + API de pagamento (Mercado Pago)
   -------------------------------------------------------------
   Sem dependências externas. Rode com:  node server.js
   O Access Token fica só aqui no servidor, lido do arquivo .env
   ============================================================= */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/* ------------------------------- .env ------------------------------- */

function carregarEnv() {
  const arquivo = path.join(__dirname, '.env');
  if (!fs.existsSync(arquivo)) return;

  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;

    const igual = texto.indexOf('=');
    if (igual < 1) continue;

    const chave = texto.slice(0, igual).trim();
    let valor = texto.slice(igual + 1).trim();

    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

carregarEnv();

const PORTA = Number(process.env.PORT) || 3000;
const RAIZ = __dirname;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORTA}`).replace(/\/+$/, '');
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();

/* --------------------------------------------------------------
   Planos no servidor (fonte da verdade dos preços).
   Mantenha os valores iguais aos de js/config.js — o navegador
   nunca decide quanto custa o plano.
   -------------------------------------------------------------- */
const PLANOS = {
  mensal: { nome: 'Mensal', meses: 1, preco: 30 },
  trimestral: { nome: 'Trimestral', meses: 3, preco: 80 },
  semestral: { nome: 'Semestral', meses: 6, preco: 150 },
  anual: { nome: 'Anual', meses: 12, preco: 250 },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------ utilidades ------------------------------ */

function responderJson(res, codigo, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

function lerCorpo(req, limite = 20_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];

    req.on('data', (pedaco) => {
      total += pedaco.length;
      if (total > limite) {
        reject(new Error('Corpo da requisição muito grande.'));
        req.destroy();
        return;
      }
      partes.push(pedaco);
    });

    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function cabecalhosSeguranca() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  };
}

/* ------------------------------ pagamento ------------------------------ */

// Limite simples de tentativas por IP (evita abuso do endpoint).
const tentativasPorIp = new Map();
const LIMITE_POR_MINUTO = 10;

function excedeuLimite(ip) {
  const agora = Date.now();
  const recentes = (tentativasPorIp.get(ip) || []).filter((t) => agora - t < 60_000);
  recentes.push(agora);
  tentativasPorIp.set(ip, recentes);

  if (tentativasPorIp.size > 2_000) {
    for (const [chave, marcas] of tentativasPorIp) {
      if (!marcas.length || agora - marcas[marcas.length - 1] > 120_000) {
        tentativasPorIp.delete(chave);
      }
    }
  }

  return recentes.length > LIMITE_POR_MINUTO;
}

async function criarPagamento(req, res) {
  if (!MP_TOKEN) {
    return responderJson(res, 503, {
      erro: 'Pagamento online ainda não configurado. Defina MP_ACCESS_TOKEN no arquivo .env.',
    });
  }

  const ip = req.socket.remoteAddress || 'desconhecido';
  if (excedeuLimite(ip)) {
    return responderJson(res, 429, {
      erro: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
    });
  }

  let dados;
  try {
    dados = JSON.parse((await lerCorpo(req)) || '{}');
  } catch {
    return responderJson(res, 400, { erro: 'Requisição inválida.' });
  }

  const plano = PLANOS[dados.planoId];
  if (!plano) {
    return responderJson(res, 400, { erro: 'Plano inválido.' });
  }

  const referencia = `${dados.planoId}:${crypto.randomUUID()}`;
  const https = BASE_URL.startsWith('https://');

  const preferencia = {
    items: [
      {
        id: dados.planoId,
        title: `STIPTV — Plano ${plano.nome}`,
        description: `Acesso por ${plano.meses} ${plano.meses === 1 ? 'mês' : 'meses'}`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: plano.preco,
      },
    ],
    payer: {},
    payment_methods: {
      installments: 12,
    },
    back_urls: {
      success: `${BASE_URL}/pagamento.html?status=sucesso&plano=${dados.planoId}`,
      pending: `${BASE_URL}/pagamento.html?status=pendente&plano=${dados.planoId}`,
      failure: `${BASE_URL}/pagamento.html?status=falha&plano=${dados.planoId}`,
    },
    // O Mercado Pago exige HTTPS para o retorno automático.
    ...(https ? { auto_return: 'approved' } : {}),
    external_reference: referencia,
    statement_descriptor: 'STIPTV',
    notification_url: `${BASE_URL}/api/webhook`,
  };

  try {
    const resposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': referencia,
      },
      body: JSON.stringify(preferencia),
      signal: AbortSignal.timeout(20_000),
    });

    const retorno = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      console.error('[pagamento] Mercado Pago recusou a criação:', retorno);
      const semAutorizacao = resposta.status === 401 || resposta.status === 403;
      return responderJson(res, 502, {
        erro: semAutorizacao
          ? 'Pagamento indisponível no momento (credenciais do gateway). Fale com a gente no WhatsApp.'
          : retorno.message ||
            'O gateway recusou a criação do pagamento. Confira as credenciais e tente novamente.',
      });
    }

    console.log(`[pagamento] preferência criada ${retorno.id} (${referencia})`);
    return responderJson(res, 200, {
      id: retorno.id,
      init_point: retorno.init_point,
      sandbox_init_point: retorno.sandbox_init_point || null,
    });
  } catch (erro) {
    console.error('[pagamento] falha ao chamar o Mercado Pago:', erro.message);
    return responderJson(res, 502, {
      erro: 'Não foi possível falar com o gateway de pagamento agora. Tente novamente.',
    });
  }
}

async function consultarPagamento(res, paymentId) {
  if (!MP_TOKEN) return responderJson(res, 503, { erro: 'Gateway não configurado.' });
  if (!/^\d{1,20}$/.test(paymentId)) return responderJson(res, 400, { erro: 'ID inválido.' });

  try {
    const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    });
    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) return responderJson(res, resposta.status, { erro: dados.message || 'Falha na consulta.' });

    return responderJson(res, 200, {
      id: dados.id,
      status: dados.status,
      status_detail: dados.status_detail,
      external_reference: dados.external_reference,
      valor: dados.transaction_amount,
      metodo: dados.payment_method_id,
    });
  } catch (erro) {
    console.error('[status] falha na consulta:', erro.message);
    return responderJson(res, 502, { erro: 'Falha ao consultar o pagamento.' });
  }
}

function receberWebhook(body, query) {
  // Em produção, valide o header x-signature antes de confiar no evento.
  const tipo = query.get('type') || query.get('topic') || (body && body.type) || 'desconhecido';
  const id = query.get('data.id') || query.get('id') || (body && body.data && body.data.id) || '?';

  console.log(`[webhook] evento=${tipo} id=${id}`);

  // Próximo passo (quando quiser automatizar a liberação):
  // consultar /v1/payments/:id, gravar o pedido e enviar o acesso no WhatsApp.
}

/* -------------------------------- estáticos -------------------------------- */

// Arquivos do projeto que nunca devem ser baixados pelo navegador.
const ARQUIVOS_INTERNOS = new Set([
  'server.js',
  'package.json',
  'package-lock.json',
  'readme.md',
  '.env',
  '.env.example',
  '.gitignore',
]);

function pagina404(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...cabecalhosSeguranca() });
  res.end(
    '<!doctype html><meta charset="utf-8"><title>404</title>' +
      '<body style="font-family:system-ui;background:#060711;color:#eef1ff;display:grid;place-items:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><h1>404</h1><p>Página não encontrada.</p>' +
      '<p><a style="color:#a78bfa" href="/">Voltar ao site</a></p></div>'
  );
}

async function servirArquivo(req, res, caminhoUrl) {
  let relativo;
  try {
    relativo = decodeURIComponent(caminhoUrl.split('?')[0]);
  } catch {
    return responderJson(res, 400, { erro: 'Caminho inválido.' });
  }

  const segmentos = relativo.split('/').filter(Boolean);
  const nomeArquivo = (segmentos[segmentos.length - 1] || '').toLowerCase();

  if (segmentos.some((s) => s.startsWith('.')) || ARQUIVOS_INTERNOS.has(nomeArquivo)) {
    return pagina404(res);
  }

  if (relativo.endsWith('/')) relativo += 'index.html';

  const alvo = path.normalize(path.join(RAIZ, relativo));
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + path.sep)) {
    return responderJson(res, 403, { erro: 'Acesso negado.' });
  }

  let info;
  try {
    info = await fsp.stat(alvo);
  } catch {
    return pagina404(res);
  }

  if (info.isDirectory()) {
    return servirArquivo(req, res, path.posix.join(relativo, 'index.html'));
  }

  const extensao = path.extname(alvo).toLowerCase();
  const tipo = MIME[extensao] || 'application/octet-stream';
  // HTML, CSS e JS sempre revalidam: mudanças de preço aparecem na hora.
  const cacheLongo = /\.(svg|png|jpe?g|webp|ico|woff2)$/i.test(alvo);

  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': info.size,
    'Cache-Control': cacheLongo ? 'public, max-age=86400' : 'no-cache',
    ...cabecalhosSeguranca(),
  });

  if (req.method === 'HEAD') return res.end();

  fs.createReadStream(alvo)
    .on('error', () => res.end())
    .pipe(res);
}

/* --------------------------------- servidor --------------------------------- */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rota = url.pathname;
  const metodo = req.method || 'GET';

  if (rota.startsWith('/api/')) {
    if (metodo === 'POST' && rota === '/api/criar-pagamento') return criarPagamento(req, res);

    if (metodo === 'GET' && rota === '/api/status-pagamento') {
      return consultarPagamento(res, url.searchParams.get('payment_id') || '');
    }

    if (metodo === 'POST' && rota === '/api/webhook') {
      let corpo = {};
      try {
        corpo = JSON.parse((await lerCorpo(req)) || '{}');
      } catch {
        corpo = {};
      }
      receberWebhook(corpo, url.searchParams);
      return responderJson(res, 200, { ok: true });
    }

    return responderJson(res, 404, { erro: 'Rota de API não encontrada.' });
  }

  if (metodo !== 'GET' && metodo !== 'HEAD') {
    return responderJson(res, 405, { erro: 'Método não permitido.' });
  }

  return servirArquivo(req, res, rota);
});

servidor.listen(PORTA, () => {
  console.log('');
  console.log('  STIPTV — servidor no ar');
  console.log(`  Site:      ${BASE_URL}`);
  console.log(`  Gateway:   ${MP_TOKEN ? 'Mercado Pago configurado' : 'desativado (defina MP_ACCESS_TOKEN no .env)'}`);
  console.log('  Encerrar:  Ctrl + C');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nServidor encerrado.');
  servidor.close(() => process.exit(0));
});
