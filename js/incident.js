(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./safety-logic.js') : root.GasGuardSafetyLogic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardIncident = api;
})(typeof window === 'undefined' ? globalThis : window, function (L) {
  'use strict';

  // Explains an ongoing gas event in plain Thai: where the gas is, whether it is building up slowly or rose
  // suddenly, how long it has been going on, and what that usually means. The level and the steps always come
  // from the rules in safety-logic.js; this only explains them.
  // facts() is also what the app sends to the AI (/api/v1/site/explain): numbers, level/pattern keys and the
  // short zone labels from the floor plan. No names, emails or addresses.

  const NEAR_PX = 220; // a sensor this close (plan units) to the stove or tank is "near" it
  const PLACE_TH = { stove: 'เตาแก๊ส', tank: 'ถังแก๊ส' };

  const ppmOf = r => (r && r.gasPpm != null && Number.isFinite(Number(r.gasPpm)) ? Number(r.gasPpm) : null);
  const round = v => (v == null ? null : Math.round(v));

  // Where a sensor pin sits on the plan: the room it is in and whether the stove or tank is close by.
  function placeOf(plan, sensorId) {
    const pins = (plan && Array.isArray(plan.pins)) ? plan.pins : [];
    const pin = pins.find(p => p.type === 'sensor' && p.sensorId === sensorId);
    if (!pin) return { zone: null, room: null, near: null };
    const room = ((plan && plan.rooms) || []).find(r => pin.x >= r.x && pin.x <= r.x + r.w && pin.y >= r.y && pin.y <= r.y + r.h);
    let near = null, best = Infinity;
    for (const p of pins) {
      if (p.type !== 'stove' && p.type !== 'tank') continue;
      const d = Math.hypot(p.x - pin.x, p.y - pin.y);
      if (d < best && d <= NEAR_PX) { best = d; near = p.type; }
    }
    return { zone: pin.label || null, room: room ? room.label || null : null, near };
  }

  // How long the sensor has been at watch level or above, and the reading just before that.
  function episodeOf(history, sensorId, now) {
    const rows = (history || []).filter(r => r.sensorId === sensorId && ppmOf(r) != null)
      .map(r => ({ t: Date.parse(r.receivedAt), ppm: ppmOf(r) })).filter(p => Number.isFinite(p.t) && p.t <= now)
      .sort((a, b) => a.t - b.t);
    if (!rows.length) return { minutes: null, startPpm: null };
    let i = rows.length - 1;
    if (rows[i].ppm < L.THRESHOLDS.watch) return { minutes: null, startPpm: null };
    while (i > 0 && rows[i - 1].ppm >= L.THRESHOLDS.watch) i--;
    const before = i > 0 ? rows[i - 1].ppm : null;
    return { minutes: Math.max(0, Math.round((now - rows[i].t) / 60e3)), startPpm: round(before) };
  }

  // a: L.assess(...) result. opts.plan: the floor plan (for zone, room and stove/tank), opts.sim: demo data.
  function facts(a, history, opts = {}) {
    const now = opts.now || Date.now();
    const w = a && a.worst;
    if (!w || w.level.rank < 1) return null;
    const place = placeOf(opts.plan, w.id);
    const zoneOf = (s, i) => placeOf(opts.plan, s.id).zone || String.fromCharCode(65 + i);
    const known = a.sensors.filter(s => s.level.rank >= 0);
    const ep = episodeOf(history, w.id, now);
    return {
      level: w.level.key,
      escalated: Boolean(w.escalated),
      zone: place.zone || String.fromCharCode(65 + Math.max(0, a.sensors.indexOf(w))),
      room: place.room,
      near: place.near,
      ppm: round(w.ppm),
      lel_percent: w.lel == null ? null : Math.round(w.lel * 10) / 10,
      pattern: w.trend.key,
      rate_ppm_per_min: w.trend.ratePerMin == null ? null : round(w.trend.ratePerMin),
      minutes: ep.minutes,
      start_ppm: ep.startPpm,
      sensors_above_watch: known.filter(s => s.level.rank >= 1).length,
      sensors_total: a.sensors.length,
      others: a.sensors.filter(s => s !== w).map(s => ({ zone: zoneOf(s, a.sensors.indexOf(s)), ppm: round(s.ppm), level: s.level.key })),
      simulated: Boolean(opts.sim)
    };
  }

  const fmt = v => Number(v).toLocaleString('th-TH');
  const duration = m => (m == null ? null : m < 1 ? 'ไม่ถึง 1 นาที' : `${m} นาที`);

  // Rule-based explanation, used when the AI is off or does not answer. Same facts, same meaning.
  function explain(f) {
    if (!f) return '';
    const where = [f.room, f.near ? `ใกล้${PLACE_TH[f.near]}` : null].filter(Boolean).join(' ');
    const out = [`ตรวจพบแก๊สที่จุด ${f.zone}${where ? ` (${where})` : ''} ${fmt(f.ppm)} ppm หรือ ${f.lel_percent}% ของจุดติดไฟ`];
    const since = duration(f.minutes);
    if (f.pattern === 'spike') {
      out.push(`ค่าพุ่งขึ้นเร็ว${f.start_ppm != null ? `จาก ${fmt(f.start_ppm)} ppm` : ''}${since ? ` ภายใน${since}` : ''} ลักษณะนี้มักเกิดจากการรั่วทันที เช่น สายแก๊สหลุดหรือวาล์วเปิดค้าง${f.escalated ? ' ระบบจึงเตือนสูงขึ้นหนึ่งระดับ' : ''}`);
    } else if (f.pattern === 'accumulating') {
      out.push(`ค่าค่อย ๆ เพิ่มขึ้นราว ${fmt(f.rate_ppm_per_min)} ppm ต่อนาที${since ? ` มาแล้ว ${since}` : ''} ลักษณะนี้มักเกิดจากการรั่วซึมเล็กน้อยที่ข้อต่อหรือหัวเตา และแก๊สสะสมเพราะอากาศไม่ถ่ายเท`);
    } else if (f.pattern === 'falling') {
      out.push('ค่ากำลังลดลง แสดงว่าการระบายอากาศเริ่มได้ผล ให้ทำตามขั้นตอนต่อจนกว่าค่าจะกลับเป็นสีเขียว');
    } else if (since) {
      out.push(`ค่าอยู่ระดับนี้มาแล้ว ${since} ยังไม่ลดลง`);
    }
    if (f.sensors_total > 1) {
      out.push(f.sensors_above_watch > 1
        ? 'จุดอื่นก็เริ่มพบแก๊สด้วย แสดงว่าแก๊สกำลังกระจายไปทั่วพื้นที่'
        : `จุดอื่นยังปกติ แหล่งรั่วน่าจะอยู่ใกล้จุด ${f.zone}`);
    }
    return out.join(' ');
  }

  // Changes only when the story changes (level, pattern or the zone), so the AI is not asked every tick.
  const storyKey = f => (f ? `${f.level}|${f.pattern}|${f.zone}|${f.sensors_above_watch > 1 ? 'many' : 'one'}` : '');

  return Object.freeze({ facts, explain, storyKey, placeOf });
});
