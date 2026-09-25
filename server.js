// Servidor da landing page: entrega os arquivos estáticos e repassa eventos
// para a API de Conversões do Meta em POST /api/meta-event.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PIXEL_ID = process.env.META_PIXEL_ID || '1434960325249325';
const CAPI_TOKEN = process.env.META_CAPI_TOKEN;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE; // só para "Testar eventos"
const DEBUG = process.env.META_DEBUG === '1'; // loga IP recebido e resposta do Meta

const ALLOWED_EVENTS = new Set(['PageView', 'Contact']);

// Apenas estes arquivos são públicos (evita expor server.js, Dockerfile etc.).
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/logo.png': ['logo.png', 'image/png'],
};

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleMetaEvent(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400).end();
    return;
  }

  const { event_name, event_id, event_source_url, custom_data } = body;
  if (!ALLOWED_EVENTS.has(event_name) || typeof event_id !== 'string') {
    res.writeHead(400).end();
    return;
  }

  // Responde logo; o envio ao Meta segue em segundo plano.
  res.writeHead(204).end();

  if (!CAPI_TOKEN) {
    console.warn('META_CAPI_TOKEN não configurado; evento ignorado:', event_name);
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  let fbc = cookies._fbc;
  if (!fbc && event_source_url) {
    try {
      const fbclid = new URL(event_source_url).searchParams.get('fbclid');
      if (fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
    } catch {}
  }

  const userData = {
    client_ip_address: clientIp(req),
    client_user_agent: req.headers['user-agent'],
  };
  if (cookies._fbp) userData.fbp = cookies._fbp;
  if (fbc) userData.fbc = fbc;

  const payload = {
    data: [{
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id,
      action_source: 'website',
      event_source_url,
      user_data: userData,
      custom_data: custom_data && typeof custom_data === 'object' ? custom_data : {},
    }],
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  if (DEBUG) {
    console.log('CAPI debug', JSON.stringify({
      event_name,
      ip_enviado: userData.client_ip_address,
      x_forwarded_for: req.headers['x-forwarded-for'] || null,
      x_real_ip: req.headers['x-real-ip'] || null,
      socket: req.socket.remoteAddress,
      tem_user_agent: Boolean(userData.client_user_agent),
      tem_fbp: Boolean(userData.fbp),
      tem_fbc: Boolean(userData.fbc),
    }));
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(CAPI_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    if (!r.ok) console.error('CAPI erro', r.status, await r.text());
    else if (DEBUG) console.log('CAPI resposta', await r.text());
  } catch (err) {
    console.error('CAPI falhou', err.message);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/meta-event') {
    if (req.method !== 'POST') return res.writeHead(405).end();
    handleMetaEvent(req, res);
    return;
  }

  const file = STATIC_FILES[url.pathname];
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end();
    return;
  }
  const [name, type] = file;
  fs.readFile(path.join(__dirname, name), (err, content) => {
    if (err) return res.writeHead(500).end();
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': name === 'index.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT, () => console.log(`Use Dondoka rodando na porta ${PORT}`));
