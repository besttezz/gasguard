/* ============================================================
   GasGuard — เซิร์ฟเวอร์รับค่าจากอุปกรณ์ (ทางเลือกสำหรับโหมด REST API)
   ใช้เฉพาะโมดูลมาตรฐานของ Node.js ไม่ต้อง npm install

   รันด้วย:   node server.js
   พอร์ตเริ่มต้น 3000 (เปลี่ยนได้ด้วย PORT=8080 node server.js)

   ปลายทางที่มีให้:
     POST /api/readings   ← อุปกรณ์ส่งค่าเข้ามา  {"id":"kitchen-01","ppm":142,"temp":31,"humidity":60}
     GET  /api/readings   ← เว็บ GasGuard ดึงค่าล่าสุดของทุกอุปกรณ์ (ตั้ง URL นี้ในหน้าตั้งค่า)
     GET  /api/history?id=kitchen-01&limit=200
     GET  /health
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'gasguard-demo-key';   // ตั้งเป็นค่าอื่นก่อนใช้จริง
const DATA_FILE = path.join(__dirname, 'data.json');
const MAX_HISTORY = 5000;

let state = { latest: {}, history: [] };
try {
  if (fs.existsSync(DATA_FILE)) state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.warn('อ่านไฟล์ข้อมูลเดิมไม่ได้ เริ่มใหม่'); }

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(state), err => err && console.error('บันทึกไฟล์ไม่สำเร็จ', err));
  }, 2000);
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { reject(new Error('payload ใหญ่เกินไป')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (url.pathname === '/health') return send(res, 200, { ok: true, devices: Object.keys(state.latest).length });

  if (url.pathname === '/api/readings' && req.method === 'GET') {
    return send(res, 200, Object.values(state.latest));
  }

  if (url.pathname === '/api/readings' && req.method === 'POST') {
    const key = req.headers['x-api-key'];
    if (API_KEY && key !== API_KEY) return send(res, 401, { error: 'API key ไม่ถูกต้อง' });
    try {
      const raw = await readBody(req);
      let items = JSON.parse(raw);
      if (!Array.isArray(items)) items = [items];
      const now = Date.now();
      items.forEach(item => {
        const id = item.id || item.deviceId || item.device_id;
        const ppm = Number(item.ppm != null ? item.ppm : item.value);
        if (!id || isNaN(ppm)) return;
        const rec = {
          id: String(id), ppm: Math.round(ppm),
          temp: item.temp != null ? Number(item.temp) : (item.temperature != null ? Number(item.temperature) : null),
          humidity: item.humidity != null ? Number(item.humidity) : (item.hum != null ? Number(item.hum) : null),
          t: now
        };
        state.latest[rec.id] = rec;
        state.history.push(rec);
      });
      if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
      saveSoon();
      return send(res, 200, { ok: true, stored: items.length });
    } catch (e) {
      return send(res, 400, { error: 'JSON ไม่ถูกต้อง: ' + e.message });
    }
  }

  if (url.pathname === '/api/history' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 500, MAX_HISTORY);
    const rows = state.history.filter(r => !id || r.id === id).slice(-limit);
    return send(res, 200, rows);
  }

  send(res, 404, { error: 'ไม่พบปลายทางนี้' });
});

server.listen(PORT, () => {
  console.log(`GasGuard server พร้อมใช้งานที่ http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/api/readings   (header: X-API-Key: ${API_KEY})`);
  console.log(`  GET  http://localhost:${PORT}/api/readings   ← ใส่ URL นี้ในหน้าตั้งค่าของเว็บ`);
});
