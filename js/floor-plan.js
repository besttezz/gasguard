(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardFloorPlan = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  // 2D floor plan with stove / LPG tank / sensor pins and a gas heat map drawn from live readings.
  // The drawing lives in a 1000 x 700 SVG; pins and labels are HTML on top so text stays readable on phones.
  const W = 1000, H = 700;

  // ---- Templates (coordinates in the 1000 x 700 plan space) --------------------------------------
  // door: opening on a wall. axis 'h' = horizontal wall at y, opening x..x+len; 'v' = vertical wall at x, opening y..y+len.
  //       side = which way the leaf swings (+1 = towards +y / +x). hinge 'a' = start of the opening, 'b' = end.
  //       open: true = opening without a leaf. main: true = entrance (gets the entry marker).
  const TEMPLATES = Object.freeze([
    {
      id: 'kitchen', name: 'ห้องครัว (ห้องเดียว)', desc: 'ครัวในบ้านหรือห้องครัวแยก',
      rooms: [{ x: 150, y: 110, w: 700, h: 470, label: 'ห้องครัว', floor: 'tile', lx: 560, ly: 285 }],
      doors: [{ axis: 'h', x: 250, y: 580, len: 90, side: -1, hinge: 'a', main: true }],
      windows: [{ axis: 'v', x: 850, y: 260, len: 150 }, { axis: 'h', x: 300, y: 110, len: 120 }],
      furniture: [
        { t: 'counter', x: 162, y: 122, w: 600, h: 64 }, { t: 'counter', x: 162, y: 186, w: 64, h: 250 },
        { t: 'sink', x: 430, y: 130, w: 90, h: 48 }, { t: 'fridge', x: 772, y: 122, w: 66, h: 76 },
        { t: 'table', x: 480, y: 340, w: 200, h: 110, chairs: 6 }, { t: 'plant', x: 812, y: 545 }
      ],
      pins: [{ type: 'stove', x: 300, y: 154 }, { type: 'tank', x: 194, y: 300 },
        { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 196, y: 462 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 520, y: 220 },
        { type: 'sensor', label: 'C', sensorId: '', x: 700, y: 510 }]
    },
    {
      id: 'house', name: 'บ้านชั้นเดียว 2 ห้องนอน', desc: 'ห้องนั่งเล่นเปิดโล่งต่อกับครัว',
      rooms: [
        { x: 100, y: 90, w: 300, h: 210, label: 'ห้องนอน 1', floor: 'carpet', lx: 320, ly: 250 },
        { x: 400, y: 90, w: 300, h: 210, label: 'ห้องนอน 2', floor: 'carpet', lx: 470, ly: 250 },
        { x: 700, y: 90, w: 200, h: 210, label: 'ห้องน้ำ', floor: 'bath', lx: 800, ly: 240 },
        { x: 100, y: 300, w: 420, h: 320, label: 'ห้องนั่งเล่น', floor: 'wood', lx: 200, ly: 360 },
        { x: 520, y: 300, w: 380, h: 320, label: 'ห้องครัว', floor: 'tile', lx: 720, ly: 590 }
      ],
      doors: [
        { axis: 'h', x: 260, y: 620, len: 100, side: -1, hinge: 'a', main: true },
        { axis: 'v', x: 900, y: 500, len: 80, side: -1, hinge: 'b', label: 'ประตูหลัง' },
        { axis: 'h', x: 320, y: 300, len: 64, side: -1, hinge: 'b' }, { axis: 'h', x: 420, y: 300, len: 64, side: -1, hinge: 'a' },
        { axis: 'h', x: 720, y: 300, len: 60, side: -1, hinge: 'a' }, { axis: 'v', x: 520, y: 330, len: 120, open: true }
      ],
      windows: [{ axis: 'h', x: 170, y: 90, len: 120 }, { axis: 'h', x: 490, y: 90, len: 120 }, { axis: 'h', x: 770, y: 90, len: 60 },
        { axis: 'v', x: 100, y: 400, len: 120 }, { axis: 'h', x: 640, y: 620, len: 140 }],
      furniture: [
        { t: 'bed', x: 130, y: 115, w: 130, h: 150 }, { t: 'bed', x: 545, y: 115, w: 130, h: 150 },
        { t: 'toilet', x: 850, y: 112 }, { t: 'basin', x: 728, y: 100, w: 54, h: 34 },
        { t: 'sofa', x: 300, y: 410, w: 160, h: 56 }, { t: 'table', x: 335, y: 492, w: 90, h: 46 }, { t: 'tv', x: 300, y: 312, w: 160, h: 10 },
        { t: 'plant', x: 135, y: 590 },
        { t: 'counter', x: 600, y: 312, w: 288, h: 60 }, { t: 'counter', x: 828, y: 372, w: 60, h: 110 },
        { t: 'sink', x: 640, y: 318, w: 80, h: 46 }, { t: 'fridge', x: 532, y: 470, w: 62, h: 70 },
        { t: 'table', x: 640, y: 440, w: 140, h: 86, chairs: 4 }
      ],
      pins: [{ type: 'stove', x: 760, y: 342 }, { type: 'tank', x: 858, y: 430 },
        { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 800, y: 540 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 690, y: 395 },
        { type: 'sensor', label: 'C', sensorId: '', x: 230, y: 540 }]
    },
    {
      id: 'condo', name: 'ห้องชุด / คอนโด', desc: 'ครัวเล็กใกล้ประตู มีระเบียง',
      rooms: [
        { x: 200, y: 80, w: 200, h: 200, label: 'ห้องน้ำ', floor: 'bath', lx: 300, ly: 160 },
        { x: 200, y: 280, w: 200, h: 340, label: 'ครัว / ทางเดิน', floor: 'tile', lx: 330, ly: 590 },
        { x: 400, y: 80, w: 370, h: 540, label: 'ห้องนอน / นั่งเล่น', floor: 'wood', lx: 585, ly: 380 },
        { x: 770, y: 80, w: 110, h: 540, label: 'ระเบียง', floor: 'deck', lx: 825, ly: 380 }
      ],
      doors: [
        { axis: 'v', x: 200, y: 500, len: 90, side: 1, hinge: 'b', main: true },
        { axis: 'h', x: 300, y: 280, len: 64, side: -1, hinge: 'a' }, { axis: 'v', x: 400, y: 330, len: 140, open: true }
      ],
      windows: [{ axis: 'h', x: 600, y: 80, len: 140 }, { axis: 'v', x: 770, y: 200, len: 260, slide: true }],
      furniture: [
        { t: 'toilet', x: 232, y: 100 }, { t: 'basin', x: 330, y: 96, w: 50, h: 34 }, { t: 'shower', x: 216, y: 190, w: 76, h: 76 },
        { t: 'counter', x: 212, y: 292, w: 60, h: 180 }, { t: 'sink', x: 218, y: 360, w: 48, h: 56 }, { t: 'fridge', x: 336, y: 292, w: 52, h: 60 },
        { t: 'wardrobe', x: 420, y: 92, w: 140, h: 46 }, { t: 'bed', x: 580, y: 110, w: 170, h: 200 },
        { t: 'desk', x: 420, y: 524, w: 140, h: 50 }, { t: 'sofa', x: 600, y: 490, w: 140, h: 56 },
        { t: 'plant', x: 830, y: 120 }, { t: 'chair', x: 825, y: 540 }
      ],
      pins: [{ type: 'stove', x: 242, y: 320 }, { type: 'tank', x: 242, y: 445 },
        { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 300, y: 470 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 310, y: 335 },
        { type: 'sensor', label: 'C', sensorId: '', x: 560, y: 420 }]
    },
    {
      id: 'restaurant', name: 'ร้านอาหาร', desc: 'ครัวหลังร้าน ห้องเก็บถังแก๊สแยก',
      rooms: [
        { x: 80, y: 90, w: 560, h: 240, label: 'ครัว', floor: 'tile', lx: 230, ly: 300 },
        { x: 640, y: 90, w: 280, h: 240, label: 'ห้องเก็บถังแก๊ส', floor: 'plain', lx: 780, ly: 236 },
        { x: 80, y: 330, w: 840, h: 300, label: 'พื้นที่รับประทานอาหาร', floor: 'wood', lx: 500, ly: 395 }
      ],
      doors: [
        { axis: 'h', x: 440, y: 630, len: 120, side: -1, hinge: 'a', main: true },
        { axis: 'h', x: 180, y: 90, len: 80, side: 1, hinge: 'a', label: 'ประตูหลัง' },
        { axis: 'h', x: 540, y: 330, len: 80, side: 1, hinge: 'b' }, { axis: 'v', x: 640, y: 236, len: 70, side: -1, hinge: 'b' }
      ],
      windows: [{ axis: 'h', x: 150, y: 630, len: 200 }, { axis: 'h', x: 650, y: 630, len: 200 }, { axis: 'v', x: 920, y: 420, len: 140 }],
      furniture: [
        { t: 'counter', x: 280, y: 102, w: 348, h: 60 }, { t: 'counter', x: 92, y: 190, w: 60, h: 128 },
        { t: 'island', x: 300, y: 212, w: 200, h: 58 }, { t: 'sink', x: 540, y: 108, w: 70, h: 48 },
        { t: 'shelf', x: 652, y: 102, w: 256, h: 36 },
        { t: 'round', x: 175, y: 450 }, { t: 'round', x: 320, y: 450 }, { t: 'round', x: 680, y: 450 }, { t: 'round', x: 825, y: 450 },
        { t: 'round', x: 175, y: 560 }, { t: 'round', x: 825, y: 560 }, { t: 'counter', x: 620, y: 540, w: 120, h: 40, label: 'แคชเชียร์' }
      ],
      pins: [{ type: 'stove', x: 380, y: 132 }, { type: 'tank', x: 760, y: 190 },
        { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 800, y: 292 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 440, y: 186 },
        { type: 'sensor', label: 'C', sensorId: '', x: 320, y: 560 }]
    },
    {
      id: 'townhouse', name: 'ทาวน์เฮาส์ (ชั้นล่าง)', desc: 'บ้านแคบลึก ครัวอยู่หลังบ้าน',
      rooms: [
        { x: 300, y: 50, w: 260, h: 200, label: 'ครัว', floor: 'tile', lx: 505, ly: 188 },
        { x: 560, y: 50, w: 140, h: 200, label: 'ห้องน้ำ', floor: 'bath', lx: 630, ly: 215 },
        { x: 300, y: 250, w: 400, h: 260, label: 'ห้องนั่งเล่น', floor: 'wood', lx: 560, ly: 380 },
        { x: 300, y: 510, w: 400, h: 140, label: 'ลานจอดรถ', floor: 'deck', lx: 640, ly: 630 }
      ],
      doors: [
        { axis: 'h', x: 460, y: 510, len: 90, side: -1, hinge: 'a', main: true },
        { axis: 'h', x: 340, y: 50, len: 70, side: 1, hinge: 'a', label: 'ประตูหลัง' },
        { axis: 'h', x: 460, y: 250, len: 70, side: -1, hinge: 'b' }, { axis: 'h', x: 600, y: 250, len: 60, side: -1, hinge: 'a' },
        { axis: 'h', x: 330, y: 650, len: 340, open: true }
      ],
      windows: [{ axis: 'v', x: 300, y: 320, len: 120 }, { axis: 'v', x: 700, y: 320, len: 120 }],
      furniture: [
        { t: 'counter', x: 430, y: 62, w: 118, h: 56 }, { t: 'counter', x: 312, y: 128, w: 56, h: 110 }, { t: 'sink', x: 470, y: 66, w: 60, h: 44 },
        { t: 'toilet', x: 650, y: 70 }, { t: 'basin', x: 576, y: 66, w: 46, h: 32 },
        { t: 'tv', x: 330, y: 262, w: 140, h: 10 }, { t: 'sofa', x: 330, y: 420, w: 150, h: 54 }, { t: 'table', x: 360, y: 350, w: 90, h: 44 },
        { t: 'plant', x: 672, y: 480 }, { t: 'car', x: 370, y: 528, w: 230, h: 100 }
      ],
      pins: [{ type: 'stove', x: 500, y: 90 }, { type: 'tank', x: 340, y: 190 },
        { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 390, y: 225 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 420, y: 140 },
        { type: 'sensor', label: 'C', sensorId: '', x: 600, y: 440 }]
    }
  ]);
  const PIN_TYPES = Object.freeze({ stove: 'เตาแก๊ส', tank: 'ถังแก๊ส', sensor: 'เซ็นเซอร์' });
  const templateById = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function defaultPlan(templateId) {
    const t = templateById(templateId);
    return { version: 1, template: t.id, image: null, pins: t.pins.map((p, i) => ({ id: `p${i + 1}`, ...p })) };
  }

  function normalizePlan(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pins)) return defaultPlan();
    const plan = { version: 1, template: templateById(raw.template).id, image: typeof raw.image === 'string' && raw.image.startsWith('data:image/') ? raw.image : null, pins: [] };
    for (const p of raw.pins) {
      if (!p || !PIN_TYPES[p.type]) continue;
      plan.pins.push({ id: String(p.id || `p${plan.pins.length + 1}`), type: p.type, label: p.type === 'sensor' ? String(p.label || '').slice(0, 3) : undefined,
        sensorId: p.type === 'sensor' ? String(p.sensorId || '') : undefined, x: clamp(Number(p.x) || 0, 0, W), y: clamp(Number(p.y) || 0, 0, H) });
    }
    return plan;
  }

  function nextSensorLabel(pins) {
    const used = new Set(pins.filter(p => p.type === 'sensor').map(p => p.label));
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(ch)) return ch;
    return '?';
  }

  // Heat radius grows with log(ppm): ~90 at 100 ppm, ~300 at 6000 ppm.
  function heatRadius(ppm) {
    if (!Number.isFinite(ppm) || ppm <= 0) return 0;
    return Math.round(90 + 210 * clamp(Math.log10(ppm / 100) / Math.log10(60), 0, 1));
  }

  // ---- SVG drawing --------------------------------------------------------------------------------
  const FLOOR = { tile: 'url(#fp-tile)', wood: 'url(#fp-wood)', carpet: 'url(#fp-carpet)', bath: 'url(#fp-bath)', deck: 'url(#fp-deck)', plain: '#f4f1ea' };

  const defs = () => `<defs>
    <pattern id="fp-paper" width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="#fbfaf7"/><path d="M25 0H0V25" fill="none" stroke="#efece5" stroke-width="1"/></pattern>
    <pattern id="fp-tile" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="#f3f4f6"/><path d="M28 0H0V28" fill="none" stroke="#e1e4e9" stroke-width="1.2"/></pattern>
    <pattern id="fp-bath" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#eef5f7"/><path d="M16 0H0V16" fill="none" stroke="#d8e7ec" stroke-width="1"/></pattern>
    <pattern id="fp-wood" width="120" height="22" patternUnits="userSpaceOnUse"><rect width="120" height="22" fill="#f6eee2"/><path d="M0 21.5H120M70 0V22" stroke="#eadcc6" stroke-width="1"/></pattern>
    <pattern id="fp-carpet" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#f1f3f8"/><circle cx="5" cy="5" r=".9" fill="#dde2ec"/></pattern>
    <pattern id="fp-deck" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#f2efe8"/><path d="M0 17.5H18" stroke="#e4ded2" stroke-width="1.4"/></pattern>
  </defs>`;

  function opening(o, pad = 0) {
    return o.axis === 'h' ? { x: o.x - pad, y: o.y - 9, w: o.len + pad * 2, h: 18 } : { x: o.x - 9, y: o.y - pad, w: 18, h: o.len + pad * 2 };
  }

  function door(d) {
    if (d.open) return '';
    const a = d.axis === 'h' ? [d.x, d.y] : [d.x, d.y];
    const b = d.axis === 'h' ? [d.x + d.len, d.y] : [d.x, d.y + d.len];
    const [hinge, other] = d.hinge === 'b' ? [b, a] : [a, b];
    const leaf = d.axis === 'h' ? [hinge[0], hinge[1] + d.side * d.len] : [hinge[0] + d.side * d.len, hinge[1]];
    const ang = p => Math.atan2(p[1] - hinge[1], p[0] - hinge[0]);
    let delta = ang(other) - ang(leaf);
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const sweep = delta > 0 ? 1 : 0;
    return `<path d="M${leaf[0]},${leaf[1]} A${d.len},${d.len} 0 0 ${sweep} ${other[0]},${other[1]}" fill="none" stroke="#9aa3b2" stroke-width="1.4" stroke-dasharray="4 4"/>
      <line x1="${hinge[0]}" y1="${hinge[1]}" x2="${leaf[0]}" y2="${leaf[1]}" stroke="#3b4453" stroke-width="4" stroke-linecap="round"/>`;
  }

  function windowMark(w) {
    const o = opening(w);
    const lines = w.axis === 'h'
      ? `<line x1="${w.x}" y1="${w.y - 3}" x2="${w.x + w.len}" y2="${w.y - 3}"/><line x1="${w.x}" y1="${w.y + 3}" x2="${w.x + w.len}" y2="${w.y + 3}"/>`
      : `<line x1="${w.x - 3}" y1="${w.y}" x2="${w.x - 3}" y2="${w.y + w.len}"/><line x1="${w.x + 3}" y1="${w.y}" x2="${w.x + 3}" y2="${w.y + w.len}"/>`;
    return `<rect x="${o.x}" y="${o.y + 2}" width="${o.w}" height="${o.h - 4}" fill="#e8f2fa" stroke="#6b7c93" stroke-width="1.5"/><g stroke="#6b7c93" stroke-width="1.2">${lines}</g>${w.slide ? `<text x="${w.x + 20}" y="${w.y + w.len / 2}" class="fp-svg-note" transform="rotate(90 ${w.x + 20} ${w.y + w.len / 2})" text-anchor="middle">ประตูบานเลื่อน</text>` : ''}`;
  }

  function entryMarker(d) {
    const cx = d.axis === 'h' ? d.x + d.len / 2 : d.x;
    const cy = d.axis === 'h' ? d.y : d.y + d.len / 2;
    const out = -d.side; // the leaf swings inward, so outside is the opposite side
    const [dx, dy] = d.axis === 'h' ? [0, out] : [out, 0];
    const tip = [cx + dx * 18, cy + dy * 18], tail = [cx + dx * 54, cy + dy * 54];
    const head = d.axis === 'h'
      ? `${tip[0] - 9},${tip[1] + dy * 11} ${tip[0]},${tip[1]} ${tip[0] + 9},${tip[1] + dy * 11}`
      : `${tip[0] + dx * 11},${tip[1] - 9} ${tip[0]},${tip[1]} ${tip[0] + dx * 11},${tip[1] + 9}`;
    return `<g class="fp-entry"><line x1="${tail[0]}" y1="${tail[1]}" x2="${tip[0]}" y2="${tip[1]}" stroke="#2563c9" stroke-width="3.5" stroke-linecap="round"/><polyline points="${head}" fill="none" stroke="#2563c9" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }

  function chairsAround(f) {
    const n = f.chairs || 0, out = [];
    const perSide = Math.ceil(n / 2);
    for (let i = 0; i < perSide; i++) {
      const cx = f.x + (f.w * (i + 1)) / (perSide + 1);
      out.push(`<rect x="${cx - 13}" y="${f.y - 22}" width="26" height="16" rx="5"/>`);
      if (out.length < n) out.push(`<rect x="${cx - 13}" y="${f.y + f.h + 6}" width="26" height="16" rx="5"/>`);
    }
    return `<g fill="#efe6d8" stroke="#c4b192" stroke-width="1.2">${out.join('')}</g>`;
  }

  function furniture(f) {
    switch (f.t) {
      case 'counter': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="3" fill="#ebe7df" stroke="#bdb5a6" stroke-width="1.4"/>${f.label ? `<text x="${f.x + f.w / 2}" y="${f.y + f.h / 2 + 4}" text-anchor="middle" class="fp-svg-note">${esc(f.label)}</text>` : ''}`;
      case 'island': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" fill="#ebe7df" stroke="#bdb5a6" stroke-width="1.4"/>`;
      case 'shelf': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2" fill="#ece8e0" stroke="#bdb5a6" stroke-width="1.2"/><path d="M${f.x} ${f.y + f.h / 2}H${f.x + f.w}" stroke="#cfc7b8"/>`;
      case 'sink': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="#e3edf4" stroke="#8ea4b8" stroke-width="1.4"/><rect x="${f.x + 7}" y="${f.y + 7}" width="${f.w - 14}" height="${f.h - 14}" rx="6" fill="#f4f8fb" stroke="#a9bccc"/><circle cx="${f.x + f.w / 2}" cy="${f.y + f.h / 2}" r="3" fill="#8ea4b8"/>`;
      case 'fridge': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="4" fill="#eef1f5" stroke="#9aa6b6" stroke-width="1.4"/><path d="M${f.x + 5} ${f.y + f.h * 0.38}H${f.x + f.w - 5}" stroke="#b6c0cc"/>`;
      case 'table': return `${chairsAround(f)}<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="#ead9bf" stroke="#bf9f74" stroke-width="1.4"/>`;
      case 'round': return `<g fill="#efe6d8" stroke="#c4b192" stroke-width="1.2">${[0, 1, 2, 3].map(i => { const a = (Math.PI / 2) * i + Math.PI / 4; return `<circle cx="${r1(f.x + Math.cos(a) * 46)}" cy="${r1(f.y + Math.sin(a) * 46)}" r="11"/>`; }).join('')}</g><circle cx="${f.x}" cy="${f.y}" r="32" fill="#ead9bf" stroke="#bf9f74" stroke-width="1.4"/>`;
      case 'bed': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" fill="#f7f8fb" stroke="#a7b1c2" stroke-width="1.4"/><rect x="${f.x + 10}" y="${f.y + 10}" width="${(f.w - 30) / 2}" height="26" rx="6" fill="#e6ebf3" stroke="#b9c3d3"/><rect x="${f.x + 20 + (f.w - 30) / 2}" y="${f.y + 10}" width="${(f.w - 30) / 2}" height="26" rx="6" fill="#e6ebf3" stroke="#b9c3d3"/><path d="M${f.x} ${f.y + f.h * 0.42}H${f.x + f.w}" stroke="#c3cad8" stroke-width="1.4"/><rect x="${f.x}" y="${f.y + f.h * 0.42}" width="${f.w}" height="${f.h * 0.58}" rx="5" fill="#dfe6f2" opacity=".7"/>`;
      case 'sofa': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="12" fill="#dde3ec" stroke="#99a6ba" stroke-width="1.4"/><rect x="${f.x + 14}" y="${f.y + 14}" width="${f.w - 28}" height="${f.h - 14}" rx="8" fill="#e9edf3" stroke="#b3bdcc"/>`;
      case 'tv': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2" fill="#3b4453"/>`;
      case 'desk': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="3" fill="#ead9bf" stroke="#bf9f74" stroke-width="1.4"/><circle cx="${f.x + f.w / 2}" cy="${f.y - 16}" r="13" fill="#efe6d8" stroke="#c4b192"/>`;
      case 'wardrobe': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2" fill="#ece8e0" stroke="#bdb5a6" stroke-width="1.4"/><path d="M${f.x + f.w / 2} ${f.y}V${f.y + f.h}" stroke="#cfc7b8"/>`;
      case 'toilet': return `<rect x="${f.x - 16}" y="${f.y}" width="32" height="12" rx="3" fill="#f6f9fb" stroke="#97a9b8" stroke-width="1.3"/><ellipse cx="${f.x}" cy="${f.y + 32}" rx="14" ry="19" fill="#f6f9fb" stroke="#97a9b8" stroke-width="1.3"/>`;
      case 'basin': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="10" fill="#f6f9fb" stroke="#97a9b8" stroke-width="1.3"/><ellipse cx="${f.x + f.w / 2}" cy="${f.y + f.h / 2}" rx="${f.w / 2 - 8}" ry="${f.h / 2 - 7}" fill="#e7f0f5" stroke="#b7c7d3"/>`;
      case 'shower': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="#e7f0f5" stroke="#97a9b8" stroke-width="1.3" stroke-dasharray="5 4"/><circle cx="${f.x + f.w / 2}" cy="${f.y + f.h / 2}" r="5" fill="#97a9b8"/>`;
      case 'plant': return `<circle cx="${f.x}" cy="${f.y}" r="17" fill="#cfe3c8" stroke="#8fb486" stroke-width="1.3"/><circle cx="${f.x - 5}" cy="${f.y - 4}" r="7" fill="#b9d6ae"/><circle cx="${f.x + 6}" cy="${f.y + 4}" r="6" fill="#b9d6ae"/>`;
      case 'chair': return `<circle cx="${f.x}" cy="${f.y}" r="15" fill="#efe6d8" stroke="#c4b192" stroke-width="1.2"/>`;
      case 'car': return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="26" fill="none" stroke="#a8b0bd" stroke-width="1.6" stroke-dasharray="7 5"/><text x="${f.x + f.w / 2}" y="${f.y + f.h / 2 + 4}" text-anchor="middle" class="fp-svg-note">ที่จอดรถ</text>`;
      default: return '';
    }
  }

  function templateSvg(t) {
    const all = [...t.doors, ...t.windows];
    const outline = t.rooms.reduce((b, r) => ({ x1: Math.min(b.x1, r.x), y1: Math.min(b.y1, r.y), x2: Math.max(b.x2, r.x + r.w), y2: Math.max(b.y2, r.y + r.h) }), { x1: W, y1: H, x2: 0, y2: 0 });
    const mask = `<mask id="fp-wall-mask-${t.id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${all.map(o => { const r = opening(o, 0); return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`; }).join('')}</mask>`;
    return `${mask}
      <g class="fp-floors">${t.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${FLOOR[r.floor] || FLOOR.plain}"/>`).join('')}</g>
      <g class="fp-furniture">${t.furniture.map(furniture).join('')}</g>
      <g class="fp-walls" mask="url(#fp-wall-mask-${t.id})" fill="none" stroke="#2b3340" stroke-linejoin="miter">
        ${t.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" stroke-width="7"/>`).join('')}
        <rect x="${outline.x1}" y="${outline.y1}" width="${outline.x2 - outline.x1}" height="${outline.y2 - outline.y1}" stroke-width="13"/>
      </g>
      <g class="fp-openings">${t.windows.map(windowMark).join('')}${t.doors.map(door).join('')}${t.doors.filter(d => d.main).map(entryMarker).join('')}</g>`;
  }

  function compass() {
    return `<g transform="translate(958 46)" class="fp-compass"><circle r="20" fill="#fff" stroke="#d5d9e0"/><path d="M0 -14 L6 4 L0 0 L-6 4Z" fill="#2b3340"/><text y="16" text-anchor="middle" font-size="10" font-weight="700" fill="#2b3340">N</text></g>`;
  }

  // ---- IDW heat map ------------------------------------------------------------------------------
  // Like a Wi-Fi heat map, but the "signal" is gas ppm. Every cell gets an Inverse Distance Weighted
  // estimate from all sensors: v = Σ(w·ppm) / Σw with w = 1/d². A clean-air background term (0 ppm at
  // IDW_BACKGROUND_D) makes values fade away from sensors instead of spreading the average everywhere,
  // and a sensor in another room counts less (IDW_OTHER_ROOM) because walls slow gas down.
  // This is an estimate for display, not a gas-dispersion simulation.
  const IDW_CELL = 12.5;
  const IDW_POWER = 2;
  const IDW_BACKGROUND_D = 150;
  const IDW_OTHER_ROOM = 0.3;
  const IDW_SMOOTH2 = 100; // avoids division by zero right at a sensor
  const FALLBACK_LEVELS = [
    { min: 3600, color: '#d32f2f' }, { min: 1800, color: '#ef6c00' }, { min: 900, color: '#e0a400' }, { min: 0, color: '#1f9d55' }
  ];

  function levelBands() {
    const logic = (typeof globalThis !== 'undefined' && globalThis.GasGuardSafetyLogic) || null;
    if (!logic) return FALLBACK_LEVELS;
    const T = logic.THRESHOLDS, L = logic.LEVELS;
    return [{ min: T.danger, color: L.danger.color }, { min: T.warning, color: L.warning.color }, { min: T.watch, color: L.watch.color }, { min: 0, color: L.safe.color }];
  }

  const roomIndex = (rooms, x, y) => rooms.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

  function knownSensors(plan, readings) {
    return plan.pins.filter(p => p.type === 'sensor' && p.sensorId && readings[p.sensorId] && Number.isFinite(readings[p.sensorId].ppm)
      && readings[p.sensorId].level && readings[p.sensorId].level.rank >= 0).map(p => ({ x: p.x, y: p.y, v: Math.max(0, readings[p.sensorId].ppm) }));
  }

  function idwValue(x, y, points, rooms) {
    const cellRoom = rooms ? roomIndex(rooms, x, y) : -1;
    let num = 0, den = 1 / Math.pow(IDW_BACKGROUND_D, IDW_POWER);
    for (const p of points) {
      let w = 1 / Math.pow((x - p.x) ** 2 + (y - p.y) ** 2 + IDW_SMOOTH2, IDW_POWER / 2);
      if (rooms && cellRoom !== p.room) w *= IDW_OTHER_ROOM;
      num += w * p.v; den += w;
    }
    return num / den;
  }

  function idwGrid(plan, readings) {
    const rooms = plan.image ? null : templateById(plan.template).rooms;
    const points = knownSensors(plan, readings || {}).map(p => ({ ...p, room: rooms ? roomIndex(rooms, p.x, p.y) : -1 }));
    const cols = Math.ceil(W / IDW_CELL), rows = Math.ceil(H / IDW_CELL);
    const values = new Float32Array(cols * rows).fill(NaN);
    if (!points.length) return { cols, rows, cell: IDW_CELL, values, points, scope: plan.image ? 'image' : plan.template };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * IDW_CELL, y = (j + 0.5) * IDW_CELL;
      if (rooms && roomIndex(rooms, x, y) < 0) continue;
      values[j * cols + i] = idwValue(x, y, points, rooms);
    }
    return { cols, rows, cell: IDW_CELL, values, points, scope: plan.image ? 'image' : plan.template };
  }

  // Colour by level band; transparency grows with concentration so clean air stays a light tint.
  function heatColor(v, bands = levelBands()) {
    const band = bands.find(b => v >= b.min) || bands[bands.length - 1];
    const n = parseInt(band.color.slice(1), 16);
    // Clean air stays a faint tint so the plan shows through; each band above it gets clearly stronger.
    const i = bands.indexOf(band), top = bands.length - 1;
    const alpha = i === top ? 0.04 + 0.18 * Math.min(1, v / bands[top - 1].min) : [0.6, 0.48, 0.36][i] || 0.36;
    return [n >> 16, (n >> 8) & 255, n & 255, alpha, band.color];
  }

  let heatCache = { key: '', href: '' };
  function heatImage(grid) {
    const key = `${grid.scope}:${grid.points.map(p => `${p.x},${p.y},${Math.round(p.v)}`).join(';')}`;
    if (heatCache.key === key) return heatCache.href;
    const canvas = document.createElement('canvas');
    canvas.width = grid.cols; canvas.height = grid.rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(grid.cols, grid.rows), bands = levelBands();
    for (let k = 0; k < grid.values.length; k++) {
      const v = grid.values[k];
      if (Number.isNaN(v)) continue;
      const [r, g, b, a] = heatColor(v, bands);
      img.data.set([r, g, b, Math.round(a * 255)], k * 4);
    }
    ctx.putImageData(img, 0, 0);
    heatCache = { key, href: canvas.toDataURL('image/png') };
    return heatCache.href;
  }

  // Heat layer only (redrawn on every reading). readings: { [sensorId]: { ppm, level: {key,color} } }
  function heatSvg(plan, readings) {
    readings = readings || {};
    const grid = idwGrid(plan, readings);
    let field = '';
    if (grid.points.length) {
      if (typeof document !== 'undefined' && document.createElement) {
        // A low-resolution bitmap stretched over the plan; the browser's smoothing blends the cells.
        field = `<image class="fp-idw" href="${heatImage(grid)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
      } else {
        const bands = levelBands(), cells = [];
        for (let k = 0; k < grid.values.length; k++) {
          const v = grid.values[k];
          if (Number.isNaN(v)) continue;
          const [, , , a, color] = heatColor(v, bands);
          cells.push(`<rect x="${(k % grid.cols) * grid.cell}" y="${Math.floor(k / grid.cols) * grid.cell}" width="${grid.cell}" height="${grid.cell}" fill="${color}" fill-opacity="${a.toFixed(2)}"/>`);
        }
        field = cells.join('');
      }
    }
    const rings = plan.pins.filter(p => p.type === 'sensor').map(p => {
      const r = p.sensorId ? readings[p.sensorId] : null;
      if (!r || !Number.isFinite(r.ppm) || !r.level || r.level.rank < 0) {
        return `<circle cx="${p.x}" cy="${p.y}" r="34" fill="none" stroke="#9aa3b2" stroke-width="2" stroke-dasharray="5 6" opacity=".7"/>`;
      }
      if (r.level.key !== 'danger' && r.level.key !== 'warning') return '';
      return `<circle class="fp-pulse${r.level.key === 'danger' ? ' is-danger' : ''}" cx="${p.x}" cy="${p.y}" r="${Math.round(heatRadius(r.ppm) * 0.55)}" fill="none" stroke="${r.level.color}" stroke-width="3"/>`;
    }).join('');
    return `<g class="fp-heat" data-sensors="${grid.points.length}">${field}</g><g>${rings}</g>`;
  }

  function stageSvg(plan, readings) {
    const t = templateById(plan.template);
    // Gas cannot be drawn outside the building: clip the heat layer to the rooms of the template.
    const clip = plan.image ? '' : `<clipPath id="fp-clip">${t.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join('')}</clipPath>`;
    const base = plan.image
      ? `<rect width="${W}" height="${H}" fill="#fbfaf7"/><image href="${esc(plan.image)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`
      : `<rect width="${W}" height="${H}" fill="url(#fp-paper)"/>${templateSvg(t)}${compass()}`;
    return `<svg class="fp-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="แปลน ${esc(plan.image ? 'ที่อัปโหลด' : t.name)} พร้อมแผนที่ความเข้มข้นแก๊ส">${defs()}${base}${clip}<g data-fp-heat${plan.image ? '' : ' clip-path="url(#fp-clip)"'}>${heatSvg(plan, readings || {})}</g></svg>`;
  }

  // ---- 3D view (isometric "dollhouse" built from the same template) ------------------------------
  // Floor-level content is drawn in plan coordinates under an affine iso matrix, so floor patterns, door
  // swings and the heat map project exactly. Walls and furniture are extruded boxes ordered back to front.
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const ISO = `matrix(${C30.toFixed(5)} ${S30} ${(-C30).toFixed(5)} ${S30} 0 0)`;
  const isoAt = z => (z ? `translate(0 ${-z}) ${ISO}` : ISO);
  const P = (x, y, z = 0) => [(x - y) * C30, (x + y) * S30 - z];
  const poly = (points, fill, extra = '') => `<polygon points="${points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="${fill}"${extra}/>`;
  const WALL = { top: '#2b3340', front: '#e4e0d8', side: '#cfcac0' };
  const FURN3D = {
    counter: [46, '#ebe7df'], island: [46, '#ebe7df'], shelf: [95, '#ece8e0'], fridge: [98, '#eef1f5'], table: [36, '#ead9bf'],
    desk: [36, '#ead9bf'], wardrobe: [105, '#ece8e0'], tv: [22, '#d8c3a2'], bed: [26, '#f7f8fb'], sofa: [34, '#dde3ec'], basin: [40, '#f6f9fb']
  };

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * f));
    return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // An axis-aligned box: footprint x,y,w,h from z0 to z1. Only the faces the viewer can see (+x, +y, top).
  function boxSvg(b, colors, topDecal = '') {
    const { x, y, w, h, z0 = 0, z1 } = b;
    const op = colors.opacity ? ` opacity="${colors.opacity}"` : '';
    const edge = ' stroke="#2b3340" stroke-opacity=".18" stroke-width="1" stroke-linejoin="round"';
    return `<g${op}>${poly([P(x, y + h, z0), P(x + w, y + h, z0), P(x + w, y + h, z1), P(x, y + h, z1)], colors.front, edge)}`
      + `${poly([P(x + w, y, z0), P(x + w, y + h, z0), P(x + w, y + h, z1), P(x + w, y, z1)], colors.side, edge)}`
      + `${poly([P(x, y, z1), P(x + w, y, z1), P(x + w, y + h, z1), P(x, y + h, z1)], colors.top, edge)}`
      + `${topDecal ? `<g transform="${isoAt(z1)}">${topDecal}</g>` : ''}</g>`;
  }

  function cylinderSvg(cx, cy, r, z0, z1, color, topColor) {
    const rx = r * Math.SQRT2 * C30, ry = r * Math.SQRT2 * S30;
    const [bx, by] = P(cx, cy, z0), [tx, ty] = P(cx, cy, z1);
    return `<g><ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${shade(color, 0.82)}"/>`
      + `<rect x="${(bx - rx).toFixed(1)}" y="${ty.toFixed(1)}" width="${(2 * rx).toFixed(1)}" height="${(by - ty).toFixed(1)}" fill="${shade(color, 0.9)}"/>`
      + `<ellipse cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${topColor || color}" stroke="#2b3340" stroke-opacity=".18"/></g>`;
  }

  // Wall segments from room edges, cut at doors and windows.
  function wallBoxes(t) {
    const o = t.rooms.reduce((b, r) => ({ x1: Math.min(b.x1, r.x), y1: Math.min(b.y1, r.y), x2: Math.max(b.x2, r.x + r.w), y2: Math.max(b.y2, r.y + r.h) }), { x1: W, y1: H, x2: 0, y2: 0 });
    const seen = new Set(), out = [];
    const edges = [];
    for (const r of t.rooms) {
      edges.push({ axis: 'h', c: r.y, a: r.x, b: r.x + r.w }, { axis: 'h', c: r.y + r.h, a: r.x, b: r.x + r.w },
        { axis: 'v', c: r.x, a: r.y, b: r.y + r.h }, { axis: 'v', c: r.x + r.w, a: r.y, b: r.y + r.h });
    }
    for (const e of edges) {
      const key = `${e.axis}${e.c}:${e.a}-${e.b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const front = (e.axis === 'h' && e.c === o.y2) || (e.axis === 'v' && e.c === o.x2);
      const back = (e.axis === 'h' && e.c === o.y1) || (e.axis === 'v' && e.c === o.x1);
      const height = front ? 16 : back ? 112 : 70;
      const cuts = [...t.doors.map(d => ({ ...d, kind: 'door' })), ...t.windows.map(w => ({ ...w, kind: 'window' }))]
        .filter(d => d.axis === e.axis && Math.abs((d.axis === 'h' ? d.y : d.x) - e.c) < 1)
        .map(d => { const s = d.axis === 'h' ? d.x : d.y; return { s: Math.max(e.a, s), f: Math.min(e.b, s + d.len), kind: d.kind }; })
        .filter(c => c.f > c.s).sort((p, q) => p.s - q.s);
      let pos = e.a;
      const pushPart = (a, b, z0, z1, kind) => {
        if (b - a < 0.5 || z1 <= z0) return;
        const box = e.axis === 'h' ? { x: a, y: e.c - 4, w: b - a, h: 8, z0, z1 } : { x: e.c - 4, y: a, w: 8, h: b - a, z0, z1 };
        out.push({ box, kind });
      };
      for (const c of cuts) {
        pushPart(pos, c.s, 0, height, 'wall');
        if (c.kind === 'window') {
          if (height >= 90) { pushPart(c.s, c.f, 0, 34, 'wall'); pushPart(c.s, c.f, 34, 86, 'glass'); pushPart(c.s, c.f, 86, height, 'wall'); }
          else pushPart(c.s, c.f, 0, Math.min(height, 34), 'wall');
        }
        pos = Math.max(pos, c.f);
      }
      pushPart(pos, e.b, 0, height, 'wall');
    }
    return out;
  }

  function furnitureItems(t) {
    const items = [];
    const counters = t.furniture.filter(f => f.t === 'counter' || f.t === 'island');
    const onCounter = (x, y) => counters.some(c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    for (const f of t.furniture) {
      const spec = FURN3D[f.t];
      if (spec) {
        const [h, color] = spec;
        const decal = f.t === 'table' || f.t === 'desk' ? `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="${color}" stroke="#bf9f74" stroke-width="1.4"/>` : f.t === 'tv' ? '' : furniture({ ...f, chairs: 0 });
        items.push({ box: { x: f.x, y: f.y, w: f.w, h: f.h, z1: h }, svg: boxSvg({ x: f.x, y: f.y, w: f.w, h: f.h, z1: h }, { top: color, front: shade(color, 0.86), side: shade(color, 0.76) }, decal) });
        if (f.t === 'table' && f.chairs) {
          const per = Math.ceil(f.chairs / 2);
          let n = 0;
          for (let i = 0; i < per && n < f.chairs; i++) {
            const cx = f.x + (f.w * (i + 1)) / (per + 1);
            for (const cy of [f.y - 22, f.y + f.h + 6]) {
              if (n++ >= f.chairs) break;
              const b = { x: cx - 13, y: cy, w: 26, h: 16, z1: 22 };
              items.push({ box: b, svg: boxSvg(b, { top: '#efe6d8', front: '#d9cdb8', side: '#cbbda5' }) });
            }
          }
        }
        if (f.t === 'tv') { const b = { x: f.x + 12, y: f.y + 2, w: f.w - 24, h: 5, z0: 22, z1: 62 }; items.push({ box: { ...b, y: f.y + f.h + 1, h: 0.5 }, svg: boxSvg(b, { top: '#2b3340', front: '#1f252f', side: '#181d25' }) }); }
        if (f.t === 'desk') items.push({ box: { x: f.x + f.w / 2 - 13, y: f.y - 29, w: 26, h: 26, z1: 22 }, svg: cylinderSvg(f.x + f.w / 2, f.y - 16, 13, 0, 22, '#efe6d8') });
      } else if (f.t === 'sink') {
        const z = onCounter(f.x + f.w / 2, f.y + f.h / 2) ? 46 : 0;
        items.push({ box: { x: f.x, y: f.y, w: f.w, h: f.h, z1: z + 1 }, svg: `<g transform="${isoAt(z + 0.5)}">${furniture(f)}</g>`, decal: true });
      } else if (f.t === 'round') {
        [0, 1, 2, 3].forEach(i => {
          const a = (Math.PI / 2) * i + Math.PI / 4, cx = f.x + Math.cos(a) * 46, cy = f.y + Math.sin(a) * 46;
          items.push({ box: { x: cx - 11, y: cy - 11, w: 22, h: 22, z1: 22 }, svg: cylinderSvg(cx, cy, 11, 0, 22, '#efe6d8') });
        });
        items.push({ box: { x: f.x - 32, y: f.y - 32, w: 64, h: 64, z1: 36 }, svg: cylinderSvg(f.x, f.y, 32, 0, 36, '#ead9bf') });
      } else if (f.t === 'toilet') {
        const b = { x: f.x - 16, y: f.y, w: 32, h: 12, z1: 36 };
        items.push({ box: b, svg: boxSvg(b, { top: '#f6f9fb', front: '#dfe6ec', side: '#cfd8e0' }) });
        items.push({ box: { x: f.x - 14, y: f.y + 13, w: 28, h: 38, z1: 20 }, svg: cylinderSvg(f.x, f.y + 32, 14, 0, 20, '#f6f9fb') });
      } else if (f.t === 'plant') {
        const [tx, ty] = P(f.x, f.y, 44);
        items.push({ box: { x: f.x - 12, y: f.y - 12, w: 24, h: 24, z1: 50 }, svg: `${cylinderSvg(f.x, f.y, 11, 0, 20, '#b9876b')}<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="21" fill="#8fbf7f"/><circle cx="${(tx - 6).toFixed(1)}" cy="${(ty - 7).toFixed(1)}" r="10" fill="#a9d29a"/>` });
      } else if (f.t === 'chair') {
        items.push({ box: { x: f.x - 15, y: f.y - 15, w: 30, h: 30, z1: 22 }, svg: cylinderSvg(f.x, f.y, 15, 0, 22, '#efe6d8') });
      }
    }
    return items;
  }

  // Back-to-front order for axis-aligned boxes: A is behind B when it lies entirely at smaller x or smaller y.
  function depthSort(items) {
    const behind = (a, b) => a.box.x + a.box.w <= b.box.x + 0.01 || a.box.y + a.box.h <= b.box.y + 0.01
      || (a.decal !== true && b.decal === true && overlaps(a.box, b.box));
    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const out = [], state = new Map();
    const visit = item => {
      if (state.get(item) === 2) return;
      if (state.get(item) === 1) return; // cycle: keep current order
      state.set(item, 1);
      for (const other of items) if (other !== item && behind(other, item) && !behind(item, other)) visit(other);
      state.set(item, 2);
      out.push(item);
    };
    items.forEach(visit);
    return out;
  }

  function sensorZ(t, p) {
    const c = t.furniture.find(f => (f.t === 'counter' || f.t === 'island') && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);
    return c ? 46 : 0;
  }

  function pin3d(t, p, readings) {
    if (p.type === 'tank') {
      const [tx, ty] = P(p.x, p.y, 66);
      return `${cylinderSvg(p.x, p.y, 15, 0, 58, '#2f6fd0', '#4b86de')}<rect x="${(tx - 5).toFixed(1)}" y="${(ty - 2).toFixed(1)}" width="10" height="10" rx="2" fill="#9aa3b2"/><text x="${tx.toFixed(1)}" y="${(ty + 40).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">LPG</text>`;
    }
    if (p.type === 'stove') {
      const z = sensorZ(t, p);
      const b = { x: p.x - 26, y: p.y - 18, w: 52, h: 36, z0: z, z1: z + 6 };
      const burners = `<rect x="${b.x}" y="${b.y}" width="52" height="36" rx="4" fill="#2b3340"/><circle cx="${p.x - 12}" cy="${p.y}" r="9" fill="none" stroke="#ff7a2f" stroke-width="3"/><circle cx="${p.x + 12}" cy="${p.y}" r="9" fill="none" stroke="#ff7a2f" stroke-width="3"/>`;
      return boxSvg(b, { top: '#2b3340', front: '#1f252f', side: '#181d25' }, burners);
    }
    const r = p.sensorId ? readings[p.sensorId] : null;
    const known = r && Number.isFinite(r.ppm) && r.level && r.level.rank >= 0;
    const color = known ? r.level.color : '#8a94a6';
    const z = sensorZ(t, p) + 22;
    const body = boxSvg({ x: p.x - 9, y: p.y - 9, w: 18, h: 18, z0: z, z1: z + 14 }, { top: '#ffffff', front: '#e7eaef', side: '#d5dae2' });
    const [lx, ly] = P(p.x, p.y, z + 14), [cx, cy] = P(p.x, p.y, z + 120);
    const text = `${p.label} · ${!p.sensorId ? 'ยังไม่ผูก' : known ? `${fmtPpm(r.ppm)} ppm` : 'ไม่มีข้อมูล'}`;
    const w = Math.round(text.length * 10.5 + 34);
    return `${body}<circle cx="${lx.toFixed(1)}" cy="${(ly - 2).toFixed(1)}" r="6" fill="${color}"${known && r.level.key === 'danger' ? ' class="fp-led-blink"' : ''}/>`
      + `<line x1="${lx.toFixed(1)}" y1="${(ly - 8).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy + 15).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-dasharray="3 4"/>`
      + `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})"><rect x="${-w / 2}" y="-15" width="${w}" height="30" rx="15" fill="#fff" stroke="${color}" stroke-width="2"/><circle cx="${-w / 2 + 15}" cy="0" r="6" fill="${color}"/><text x="${-w / 2 + 27}" y="5.5" font-size="15" font-weight="700" fill="#24303f">${esc(text)}</text></g>`;
  }

  function isoSvg(plan, readings) {
    const t = templateById(plan.template);
    const pins = plan.pins;
    let floor, items = [], labels = '', bounds;
    if (plan.image) {
      floor = `<image href="${esc(plan.image)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`;
      bounds = { x1: 0, y1: 0, x2: W, y2: H };
    } else {
      bounds = t.rooms.reduce((b, r) => ({ x1: Math.min(b.x1, r.x), y1: Math.min(b.y1, r.y), x2: Math.max(b.x2, r.x + r.w), y2: Math.max(b.y2, r.y + r.h) }), { x1: W, y1: H, x2: 0, y2: 0 });
      const clip = `<clipPath id="fp-clip3d">${t.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join('')}</clipPath>`;
      floor = `${clip}<rect x="${bounds.x1 - 40}" y="${bounds.y1 - 40}" width="${bounds.x2 - bounds.x1 + 80}" height="${bounds.y2 - bounds.y1 + 80}" rx="24" fill="#efece5"/>`
        + t.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${FLOOR[r.floor] || FLOOR.plain}"/>`).join('')
        + t.furniture.filter(f => f.t === 'shower' || f.t === 'car').map(furniture).join('')
        + t.doors.map(door).join('') + t.doors.filter(d => d.main).map(entryMarker).join('');
      items = [...wallBoxes(t).map(wb => ({ box: wb.box, svg: wb.kind === 'glass' ? boxSvg(wb.box, { top: '#cfe6f5', front: '#bcdcf0', side: '#a9cde6', opacity: 0.6 }) : boxSvg(wb.box, WALL) })), ...furnitureItems(t)];
      labels = t.rooms.map(r => { const [x, y] = P(r.lx ?? r.x + r.w / 2, r.ly ?? r.y + r.h / 2, 0); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="fp-iso-label">${esc(r.label)}</text>`; }).join('');
    }
    const heat = heatSvg(plan, readings || {});
    const ordered = depthSort(items).map(i => i.svg).join('');
    const corners = [[bounds.x1, bounds.y1], [bounds.x2, bounds.y1], [bounds.x1, bounds.y2], [bounds.x2, bounds.y2]];
    const xs = corners.map(([x, y]) => P(x, y)[0]), ys = corners.map(([x, y]) => P(x, y)[1]);
    const pad = 60, minX = Math.min(...xs) - pad - 40, maxX = Math.max(...xs) + pad + 40, minY = Math.min(...ys) - 112 - 150, maxY = Math.max(...ys) + pad;
    const pinSvg = pins.filter(p => p.type !== 'sensor').map(p => pin3d(t, p, readings || {})).join('') + pins.filter(p => p.type === 'sensor').map(p => pin3d(t, p, readings || {})).join('');
    return `<svg class="fp-svg fp-iso" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ภาพจำลอง 3 มิติของ ${esc(plan.image ? 'แปลนที่อัปโหลด' : t.name)} พร้อมค่าแก๊ส">${defs()}
      <g transform="${ISO}">${floor}<g${plan.image ? '' : ' clip-path="url(#fp-clip3d)"'}>${heat}</g></g>
      ${ordered}${labels}${pinSvg}
      <text x="${(minX + 18).toFixed(0)}" y="${(maxY - 18).toFixed(0)}" class="fp-iso-note">ภาพจำลอง 3 มิติจากแปลน (ไม่ใช่ภาพถ่ายจริง)</text></svg>`;
  }

  // ---- HTML overlay (room labels, entry label, pins) ----------------------------------------------
  const pct = (v, total) => `${r1((v / total) * 100)}%`;
  const fmtPpm = v => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('th-TH'));
  const ICONS = {
    stove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c2.6 3 5 5.4 5 9a5 5 0 0 1-10 0c0-2 1-3.4 2.2-4.6.2 1.5.9 2.4 1.9 2.8C11 8.6 11.3 5.8 12 3Z" fill="currentColor"/></svg>',
    tank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v2.2c2.8.6 4.5 2.4 4.5 5V19a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V9.2c0-2.6 1.7-4.4 4.5-5Z" fill="currentColor"/><path d="M8 11h8M8 15h8" stroke="#fff" stroke-width="1.4" opacity=".75"/></svg>'
  };

  function overlayHtml(plan, readings, ui) {
    const t = templateById(plan.template);
    const labels = plan.image ? '' : t.rooms.map(r => `<span class="fp-room" style="left:${pct(r.lx ?? r.x + r.w / 2, W)};top:${pct(r.ly ?? r.y + r.h / 2, H)}">${esc(r.label)}</span>`).join('')
      + t.doors.filter(d => d.main || d.label).map(d => {
        const out = -(d.side || 1);
        const cx = d.axis === 'h' ? d.x + d.len / 2 : d.x + (d.main ? out * 80 : out * 34);
        const cy = d.axis === 'h' ? d.y + (d.main ? out * 74 : out * 30) : d.y + d.len / 2;
        return `<span class="fp-door-tag${d.main ? ' is-main' : ''}" style="left:${pct(clamp(cx, 60, W - 60), W)};top:${pct(clamp(cy, 14, H - 14), H)}">${d.main ? 'ทางเข้า-ออก' : esc(d.label)}</span>`;
      }).join('');
    const pins = plan.pins.map(p => {
      const sel = ui.selected === p.id ? ' is-selected' : '';
      const style = `left:${pct(p.x, W)};top:${pct(p.y, H)}`;
      if (p.type !== 'sensor') {
        return `<button type="button" class="fp-pin fp-pin-${p.type}${sel}" data-pin="${esc(p.id)}" style="${style}" aria-label="${PIN_TYPES[p.type]}" title="${PIN_TYPES[p.type]}">${ICONS[p.type]}</button>`;
      }
      const r = p.sensorId ? readings[p.sensorId] : null;
      const known = r && Number.isFinite(r.ppm) && r.level && r.level.rank >= 0;
      const color = known ? r.level.color : '#8a94a6';
      const chip = !p.sensorId ? 'ยังไม่ผูก' : known ? `${fmtPpm(r.ppm)} ppm · ${esc(r.level.label)}` : 'ไม่มีข้อมูล';
      return `<button type="button" class="fp-pin fp-pin-sensor${sel}${p.x > 640 ? ' chip-left' : ''}${known && r.level.key === 'danger' ? ' is-danger' : ''}" data-pin="${esc(p.id)}" style="${style};--pin:${color}" aria-label="เซ็นเซอร์ ${esc(p.label)} ${esc(chip)}"><span class="fp-pin-dot">${esc(p.label)}</span><span class="fp-pin-chip">${chip}</span></button>`;
    }).join('');
    return labels + pins;
  }

  // ---- Interactive controller (browser only) ------------------------------------------------------
  function loadPlan(key) {
    try { const raw = localStorage.getItem(key); return raw ? normalizePlan(JSON.parse(raw)) : defaultPlan(); } catch (e) { return defaultPlan(); }
  }
  function savePlan(key, plan) {
    try { localStorage.setItem(key, JSON.stringify(plan)); return true; } catch (e) { return false; }
  }

  function shrinkImage(file, maxSide = 1400) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('not an image'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function mount(container, options = {}) {
    if (!container) return null;
    const key = options.storageKey || 'gasguard.floorplan.v1';
    const sensorOptions = options.sensorOptions || (() => []);
    let plan = loadPlan(key);
    let readings = {};
    const ui = { editing: false, tool: null, selected: null, dragging: null, message: '', view: '2d' };

    container.innerHTML = `
      <div class="fp-toolbar">
        <label class="fp-field"><span>แบบแปลน</span><select data-fp-template>${TEMPLATES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}<option value="__upload">อัปโหลดรูปแปลนบ้านเอง…</option></select></label>
        <div class="sg-segment fp-view" role="group" aria-label="มุมมอง"><button type="button" class="is-active" data-fp-view="2d">แปลน 2D</button><button type="button" data-fp-view="3d">ภาพจำลอง 3D</button></div>
        <input type="file" accept="image/*" data-fp-file hidden>
        <button type="button" class="button button-secondary fp-edit-toggle" data-fp-edit>แก้ไขตำแหน่ง</button>
      </div>
      <div class="fp-editbar" data-fp-editbar hidden>
        <span class="fp-editbar-label">เพิ่มหมุด:</span>
        <button type="button" class="fp-tool" data-fp-tool="stove">${ICONS.stove}<span>เตา</span></button>
        <button type="button" class="fp-tool" data-fp-tool="tank">${ICONS.tank}<span>ถังแก๊ส</span></button>
        <button type="button" class="fp-tool" data-fp-tool="sensor"><i class="fp-tool-dot">A</i><span>เซ็นเซอร์</span></button>
        <span class="fp-editbar-spacer"></span>
        <button type="button" class="fp-link" data-fp-reset>คืนค่าเริ่มต้น</button>
      </div>
      <p class="fp-hint" data-fp-hint hidden></p>
      <div class="fp-stage" data-fp-stage><div class="fp-svg-host" data-fp-svg></div><div class="fp-overlay" data-fp-overlay></div></div>
      <div class="fp-inspector" data-fp-inspector hidden></div>`;

    const $ = sel => container.querySelector(sel);
    const stage = $('[data-fp-stage]'), svgHost = $('[data-fp-svg]'), overlay = $('[data-fp-overlay]');
    const select = $('[data-fp-template]'), file = $('[data-fp-file]'), hint = $('[data-fp-hint]'), inspector = $('[data-fp-inspector]');

    // options.lockSensors: rooms, stove and tank can be moved, sensor points stay where the technician put them
    // (they drive the heat map). Template changes and reset keep the existing sensor points.
    const lockSensors = Boolean(options.lockSensors);
    const isLockedPin = id => lockSensors && plan.pins.some(p => p.id === id && p.type === 'sensor');
    const keepSensors = next => (lockSensors ? { ...next, pins: next.pins.filter(p => p.type !== 'sensor').concat(plan.pins.filter(p => p.type === 'sensor')) } : next);

    // Local copy first (instant, works offline); options.store, when given, keeps the shared copy in the database.
    let saveTimer = null;
    function persist() {
      const local = savePlan(key, plan);
      if (options.onChange) options.onChange(plan);
      if (!options.store) { if (!local) setHint('บันทึกแปลนไม่ได้ (พื้นที่เก็บในเบราว์เซอร์เต็ม ลองใช้รูปที่เล็กลง)'); return; }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        Promise.resolve(options.store.save(plan)).then(ok => { if (ok === false) setHint('บันทึกแปลนขึ้นระบบไม่ได้ จะลองใหม่เมื่อแก้ไขครั้งถัดไป'); })
          .catch(() => setHint('บันทึกแปลนขึ้นระบบไม่ได้ (ตรวจอินเทอร์เน็ต) แปลนยังอยู่ในเครื่องนี้'));
      }, 600);
    }
    function setHint(text) { hint.textContent = text || ''; hint.hidden = !text; }

    function drawAll() {
      if (ui.view === '3d') { svgHost.innerHTML = isoSvg(plan, readings); overlay.innerHTML = ''; inspector.hidden = true; select.value = plan.image ? '__upload' : plan.template; return; }
      svgHost.innerHTML = stageSvg(plan, readings);
      drawOverlay();
      select.value = plan.image ? '__upload' : plan.template;
    }
    function drawHeat() {
      if (ui.view === '3d') { svgHost.innerHTML = isoSvg(plan, readings); return; }
      const g = svgHost.querySelector('[data-fp-heat]');
      if (g) g.innerHTML = heatSvg(plan, readings); else svgHost.innerHTML = stageSvg(plan, readings);
    }
    function drawOverlay(withInspector = true) {
      overlay.innerHTML = overlayHtml(plan, readings, ui);
      stage.classList.toggle('is-editing', ui.editing);
      stage.classList.toggle('is-placing', Boolean(ui.tool));
      container.querySelectorAll('[data-fp-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.fpTool === ui.tool));
      if (withInspector) drawInspector(); // live updates leave the inspector alone so an open <select> is not closed
    }
    function drawInspector() {
      const pin = plan.pins.find(p => p.id === ui.selected);
      if (!ui.editing || !pin) { inspector.hidden = true; inspector.innerHTML = ''; return; }
      const opts = [{ id: '', name: 'ยังไม่ผูก' }, ...sensorOptions()];
      if (pin.sensorId && !opts.some(o => o.id === pin.sensorId)) opts.push({ id: pin.sensorId, name: pin.sensorId });
      inspector.hidden = false;
      inspector.innerHTML = `<strong>${pin.type === 'sensor' ? `เซ็นเซอร์ ${esc(pin.label)}` : PIN_TYPES[pin.type]}</strong>
        ${pin.type === 'sensor' ? `<label class="fp-field"><span>รับค่าจาก</span><select data-fp-bind>${opts.map(o => `<option value="${esc(o.id)}"${o.id === pin.sensorId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : '<span class="fp-muted">ลากหมุดเพื่อย้ายตำแหน่ง</span>'}
        <button type="button" class="fp-link is-danger" data-fp-delete>ลบหมุดนี้</button>`;
    }

    function toPlan(evt) {
      const rect = stage.getBoundingClientRect();
      return { x: clamp(((evt.clientX - rect.left) / rect.width) * W, 0, W), y: clamp(((evt.clientY - rect.top) / rect.height) * H, 0, H) };
    }

    container.addEventListener('change', async evt => {
      if (evt.target === select) {
        if (select.value === '__upload') { file.click(); select.value = plan.image ? '__upload' : plan.template; return; }
        const keepPins = plan.image != null;
        plan = keepPins ? { ...plan, template: select.value, image: null } : keepSensors(defaultPlan(select.value));
        ui.selected = null;
        persist(); drawAll();
      } else if (evt.target === file && file.files && file.files[0]) {
        try {
          setHint('กำลังเตรียมรูป…');
          plan = { ...plan, image: await shrinkImage(file.files[0]) };
          persist(); drawAll();
          setHint('ใช้รูปแปลนของคุณแล้ว กด "แก้ไขตำแหน่ง" เพื่อลากหมุดเตา ถังแก๊ส และเซ็นเซอร์ให้ตรงกับบ้านจริง');
        } catch (e) { setHint('เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG'); }
        file.value = '';
      } else if (evt.target.matches('[data-fp-bind]')) {
        const pin = plan.pins.find(p => p.id === ui.selected);
        if (pin) { pin.sensorId = evt.target.value; persist(); drawHeat(); drawOverlay(); }
      }
    });

    container.addEventListener('click', evt => {
      const target = evt.target.closest('button');
      if (!target || !container.contains(target)) return;
      if (target.matches('[data-fp-view]')) {
        ui.view = target.dataset.fpView; ui.editing = false; ui.tool = null; ui.selected = null;
        container.querySelectorAll('[data-fp-view]').forEach(b => b.classList.toggle('is-active', b === target));
        const edit = $('[data-fp-edit]');
        edit.hidden = ui.view === '3d' || Boolean(options.readOnly); edit.textContent = 'แก้ไขตำแหน่ง'; edit.classList.remove('is-active');
        $('[data-fp-editbar]').hidden = true; setHint('');
        stage.classList.toggle('is-3d', ui.view === '3d');
        drawAll();
      } else if (target.matches('[data-fp-edit]')) {
        ui.editing = !ui.editing; ui.tool = null; ui.selected = null;
        target.textContent = ui.editing ? 'เสร็จสิ้น' : 'แก้ไขตำแหน่ง';
        target.classList.toggle('is-active', ui.editing);
        $('[data-fp-editbar]').hidden = !ui.editing;
        setHint(!ui.editing ? '' : lockSensors ? 'ลากหมุดเตาหรือถังแก๊สเพื่อย้าย หรือเลือก "เพิ่มหมุด" แล้วแตะบนแปลน · ตำแหน่งเซ็นเซอร์ช่างเป็นคนวาง'
          : 'ลากหมุดเพื่อย้าย หรือเลือก "เพิ่มหมุด" แล้วแตะบนแปลน แตะเซ็นเซอร์เพื่อเลือกว่ารับค่าจากตัวไหน');
        drawOverlay();
      } else if (target.matches('[data-fp-tool]')) {
        ui.tool = ui.tool === target.dataset.fpTool ? null : target.dataset.fpTool;
        setHint(ui.tool ? `แตะบนแปลนตรงจุดที่ต้องการวาง${PIN_TYPES[ui.tool]}` : '');
        drawOverlay();
      } else if (target.matches('[data-fp-reset]')) {
        plan = keepSensors({ ...defaultPlan(plan.template), image: plan.image });
        ui.selected = null; persist(); drawAll();
      } else if (target.matches('[data-fp-delete]')) {
        plan.pins = plan.pins.filter(p => p.id !== ui.selected);
        ui.selected = null; persist(); drawHeat(); drawOverlay();
      }
    });

    stage.addEventListener('pointerdown', evt => {
      if (!ui.editing) return;
      const pinEl = evt.target.closest('[data-pin]');
      if (pinEl && isLockedPin(pinEl.dataset.pin)) { setHint('ตำแหน่งเซ็นเซอร์ช่างเป็นคนวาง เพราะมีผลกับ heat map ถ้าต้องย้ายให้ติดต่อช่าง'); return; }
      if (pinEl) {
        ui.selected = pinEl.dataset.pin;
        ui.dragging = { id: pinEl.dataset.pin, el: pinEl, moved: false };
        pinEl.setPointerCapture(evt.pointerId);
        evt.preventDefault();
        overlay.querySelectorAll('[data-pin]').forEach(el => el.classList.toggle('is-selected', el === pinEl));
        drawInspector();
        return;
      }
      if (ui.tool) {
        const at = toPlan(evt);
        const id = `p${Date.now().toString(36)}`;
        const pin = { id, type: ui.tool, x: Math.round(at.x), y: Math.round(at.y) };
        if (ui.tool === 'sensor') Object.assign(pin, { label: nextSensorLabel(plan.pins), sensorId: '' });
        plan.pins.push(pin);
        ui.tool = null; ui.selected = id;
        setHint(pin.type === 'sensor' ? 'เลือกด้านล่างว่าเซ็นเซอร์จุดนี้รับค่าจากตัวไหน' : '');
        persist(); drawHeat(); drawOverlay();
      } else if (ui.selected) { ui.selected = null; drawOverlay(); }
    });
    stage.addEventListener('pointermove', evt => {
      const d = ui.dragging;
      if (!d) return;
      const at = toPlan(evt);
      const pin = plan.pins.find(p => p.id === d.id);
      if (!pin) return;
      pin.x = Math.round(at.x); pin.y = Math.round(at.y); d.moved = true;
      d.el.style.left = pct(pin.x, W); d.el.style.top = pct(pin.y, H);
      if (pin.type === 'sensor') drawHeat();
    });
    const endDrag = () => { if (ui.dragging) { const moved = ui.dragging.moved; ui.dragging = null; if (moved) persist(); } };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    drawAll();
    if (options.readOnly) { $('[data-fp-edit]').hidden = true; select.closest('.fp-field').hidden = true; }
    if (lockSensors) $('[data-fp-tool="sensor"]').hidden = true;
    if (options.store) {
      Promise.resolve(options.store.load()).then(remote => {
        if (!remote || ui.dragging || ui.editing) return;
        plan = normalizePlan(remote);
        savePlan(key, plan);
        if (options.onChange) options.onChange(plan);
        drawAll();
      }).catch(() => { /* offline: keep the local copy */ });
    }

    return {
      update(next) {
        readings = next || {};
        if (ui.dragging) return;
        drawHeat();
        if (ui.view === '2d') drawOverlay(false);
      },
      plan: () => plan
    };
  }

  return Object.freeze({ W, H, TEMPLATES, PIN_TYPES, defaultPlan, normalizePlan, loadPlan, nextSensorLabel, heatRadius, idwGrid, idwValue, heatColor, stageSvg, heatSvg, isoSvg, overlayHtml, mount });
});
