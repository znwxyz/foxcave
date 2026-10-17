import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHarness } from './apps-script-harness.mjs';

// Local browser fixture. Executes production Code.gs with simulated Google services.
// All emails stay in memory. Never deploy this development server.
const root = fileURLToPath(new URL('../', import.meta.url));
let env;
let mode;
let missingConfig;
let requests;
let testMonth;
const results = new Map();
function reset(nextMode = 'normal', missing = false) {
  env = createHarness({ now: new Date().toISOString() }); env.setup();
  const future = new Date(Date.now() + 2 * 86400000);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(future);
  testMonth = date.slice(0, 7);
  if (['weekly', 'daily'].includes(nextMode)) env.run('enableWeeklyEveningSchedule');
  else { env.addSlot(date, '19:30'); env.addSlot(date, '14:00'); }
  mode = nextMode; missingConfig = missing; requests = []; results.clear();
  if (mode === 'mail-fail') env.mailFails = true;
}
reset();
const readBody = async (req) => { let value = ''; for await (const chunk of req) { value += chunk; if (value.length > 30000) throw new Error('Too large'); } return value; };
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };

const apiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4174');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/result/')) { json(res, results.get(url.pathname)); results.delete(url.pathname); return; }
  requests.push({ method: req.method, url: req.url, contentType: req.headers['content-type'] });
  if (req.method === 'OPTIONS') { json(res, { error: 'Preflight is intentionally unsupported, like Apps Script' }, 405); return; }
  if (req.method === 'POST' && mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>Google login required</html>'); return; }
  let result;
  try { result = req.method === 'POST' ? env.post(JSON.parse(await readBody(req))) : env.get(Object.fromEntries(url.searchParams)); }
  catch { json(res, { error: 'Mock server error' }, 500); return; }
  if (req.method === 'POST' && mode === 'disconnect-after-save') { req.socket.destroy(); return; }
  if (req.method === 'POST' && mode === 'wrong-receipt' && result.receipt) result.receipt.id = randomUUID();
  const route = '/result/' + randomUUID(); results.set(route, result);
  // Simulate ContentService's redirect and make the browser read a real JSON response.
  if (mode === 'slow' && req.method === 'POST') await new Promise((resolve) => setTimeout(resolve, 750));
  res.writeHead(302, { Location: 'http://127.0.0.1:4174' + route }); res.end();
});

const siteServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4173');
  try {
    if (url.pathname === '/__test/reset' && req.method === 'POST') {
      const options = JSON.parse(await readBody(req)); reset(options.mode, options.missingConfig); json(res, { ok: true }); return;
    }
    if (url.pathname === '/__test/mode' && req.method === 'POST') { mode = JSON.parse(await readBody(req)).mode; json(res, { ok: true }); return; }
    if (url.pathname === '/__test/state') { json(res, { rows: env.requests(), mails: env.mail, requests, slots: env.get({ action: 'slots', month: testMonth }) }); return; }
    if (url.pathname === '/site/booking-config.json') { json(res, { webAppUrl: missingConfig ? '' : 'http://127.0.0.1:4174/exec' }); return; }
    let target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!target.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.otf': 'font/otf' };
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(target));
  } catch { res.writeHead(404); res.end('Not found'); }
});
apiServer.listen(4174, '127.0.0.1');
siteServer.listen(4173, '127.0.0.1', () => process.stdout.write('Local fixture: http://127.0.0.1:4173/booking/ — NO real emails\n'));
process.on('SIGINT', () => { apiServer.close(); siteServer.close(); });
