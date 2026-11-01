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

  // ---- After the event: a short report -------------------------------------------------------------
  // While the level is watch or above the app keeps a running record (track); when the level is back to green it
  // closes it (finish). The report covers what this screen saw; the AI may only reword it.
  const RANK = { watch: 1, warning: 2, danger: 3 };
  const LEVEL_TH = { watch: 'เฝ้าระวัง', warning: 'เตือน', danger: 'อันตราย' };
  const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 6e3) / 10);

  function track(inc, f, now = Date.now()) {
    if (!f) return inc || null;
    const r = inc || {
      started_at: f.minutes ? now - f.minutes * 60e3 : now, start_ppm: f.start_ppm, peak_ppm: -1, peak_lel: null, peak_at: now,
      peak_level: f.level, zone: f.zone, room: f.room, near: f.near, patterns: [], zones: [], escalated: false, simulated: f.simulated
    };
    if (f.ppm != null && f.ppm > r.peak_ppm) Object.assign(r, { peak_ppm: f.ppm, peak_lel: f.lel_percent, peak_at: now, zone: f.zone, room: f.room, near: f.near });
    if (RANK[f.level] > RANK[r.peak_level]) r.peak_level = f.level;
    if ((f.pattern === 'accumulating' || f.pattern === 'spike') && !r.patterns.includes(f.pattern)) r.patterns.push(f.pattern);
    for (const z of [f.zone, ...f.others.filter(o => RANK[o.level]).map(o => o.zone)]) if (!r.zones.includes(z)) r.zones.push(z);
    r.escalated = r.escalated || f.escalated;
    return r;
  }

  function finish(inc, now = Date.now()) {
    if (!inc) return null;
    const clock = new Date(inc.started_at);
    return {
      peak_level: inc.peak_level, peak_ppm: inc.peak_ppm < 0 ? null : inc.peak_ppm, peak_lel: inc.peak_lel,
      zone: inc.zone, room: inc.room, near: inc.near,
      first_pattern: inc.patterns[0] || 'none', patterns: inc.patterns.slice(),
      started_clock: `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`,
      started_at: inc.started_at, ended_at: now,
      minutes_total: minutesBetween(inc.started_at, now), minutes_to_peak: minutesBetween(inc.started_at, inc.peak_at), minutes_to_clear: minutesBetween(inc.peak_at, now),
      start_ppm: inc.start_ppm, zones_affected: inc.zones.length || 1, escalated: inc.escalated, simulated: inc.simulated
    };
  }

  const span = m => (m == null ? '-' : m < 1 ? `${Math.max(1, Math.round(m * 60))} วินาที` : `${Math.round(m * 10) / 10} นาที`);
  const patternTh = r => (r.patterns.length > 1 ? 'เริ่มจากแก๊สค่อย ๆ สะสม แล้วพุ่งขึ้นเร็ว'
    : r.first_pattern === 'spike' ? 'ค่าพุ่งขึ้นเร็วแบบรั่วกระชาก' : r.first_pattern === 'accumulating' ? 'แก๊สค่อย ๆ สะสม' : 'ค่าแก๊สสูงขึ้น');

  function reportText(r) {
    if (!r) return '';
    const where = [r.room, r.near ? `ใกล้${PLACE_TH[r.near]}` : null].filter(Boolean).join(' ');
    const out = [`เหตุการณ์เริ่มเวลา ${r.started_clock} น. ที่จุด ${r.zone}${where ? ` (${where})` : ''} ${patternTh(r)}`];
    out.push(`ขึ้นไปสูงสุด${r.peak_ppm != null ? ` ${fmt(r.peak_ppm)} ppm (${r.peak_lel}% ของจุดติดไฟ)` : ''} ถึงระดับ${LEVEL_TH[r.peak_level]} ภายใน ${span(r.minutes_to_peak)} แล้วกลับเป็นปกติใน ${span(r.minutes_to_clear)} รวม ${span(r.minutes_total)}`);
    if (r.zones_affected > 1) out.push(`แก๊สกระจายไป ${r.zones_affected} จุด`);
    out.push(r.patterns.includes('spike')
      ? 'สาเหตุที่เป็นไปได้คือสายแก๊สหลุดหรือขาด หรือวาล์วและหัวเตาเปิดค้าง'
      : 'สาเหตุที่เป็นไปได้คือรั่วซึมที่ข้อต่อ เกลียววาล์ว หรือสายแก๊สเสื่อม ในห้องที่อากาศไม่ถ่ายเท');
    return out.join(' ');
  }

  function checklist(r) {
    if (!r) return [];
    const out = ['ตรวจรอยรั่วด้วยน้ำสบู่ที่ข้อต่อ วาล์ว และสายแก๊ส ห้ามใช้ไฟแช็กหาจุดรั่ว'];
    if (r.patterns.includes('spike')) out.push('ดูว่าสายแก๊สหลุดหรือขาดไหม และเข็มขัดรัดสายยังแน่นอยู่');
    else out.push('ขันข้อต่อและหัวเตาให้แน่น และเปิดหน้าต่างระหว่างใช้เตาทุกครั้ง');
    if (r.peak_level !== 'watch') out.push('ให้ช่างแก๊สตรวจก่อนใช้งานอีกครั้ง');
    out.push('บอกคนในบ้านให้รู้ และสังเกตว่าเกิดซ้ำหรือไม่');
    return out;
  }

  // ---- Ask GasGuard ----------------------------------------------------------------------------------
  // Ready-made questions answer from the rules at once; the AI may answer in its own words from the same status.
  const PRESETS = Object.freeze([
    { key: 'cook', q: 'ตอนนี้จุดเตาได้ไหม' },
    { key: 'where', q: 'แก๊สมาจากไหน' },
    { key: 'todo', q: 'ตอนนี้ต้องทำอะไร' },
    { key: 'switch', q: 'ทำไมห้ามเปิด-ปิดสวิตช์ไฟ' },
    { key: 'lel', q: '%LEL คืออะไร' }
  ]);
  const CHECK_KEYS = ['online', 'sensors_ok', 'all_green', 'no_trend']; // same order as L.assess checks

  function status(a, opts = {}) {
    return {
      level: a.level.key,
      ready_to_cook: Boolean(a.readyToCook),
      failed_checks: a.checks.map((c, i) => (c.ok ? null : CHECK_KEYS[i])).filter(Boolean),
      sensors: a.sensors.map((s, i) => {
        const p = placeOf(opts.plan, s.id);
        return { zone: p.zone || String.fromCharCode(65 + i), room: p.room, near: p.near, ppm: round(s.ppm), level: s.level.key, pattern: s.trend.key };
      }),
      simulated: Boolean(opts.sim)
    };
  }

  function answer(key, a, opts = {}) {
    const T = L.THRESHOLDS, lel = v => Math.round((v / L.LEL_PPM) * 100);
    if (key === 'cook') {
      if (a.readyToCook) return 'จุดเตาได้ บอร์ดออนไลน์ เซ็นเซอร์ทุกตัวทำงานปกติ ค่าแก๊สทุกจุดเป็นสีเขียว และไม่มีแนวโน้มแก๊สสะสม ใช้เสร็จแล้วอย่าลืมปิดวาล์วถังแก๊ส';
      return `ยังไม่ควรจุดเตา เพราะยังไม่ผ่าน: ${a.checks.filter(c => !c.ok).map(c => c.label).join(', ')}`;
    }
    if (key === 'where') {
      const f = facts(a, opts.history, opts);
      if (f) return explain(f);
      if (!a.worst) return 'ยังไม่มีข้อมูลจากเซ็นเซอร์ จึงยังบอกไม่ได้';
      const z = placeOf(opts.plan, a.worst.id).zone || 'A';
      return `ตอนนี้ไม่พบแก๊สผิดปกติ ค่าสูงสุดอยู่ที่จุด ${z} ${fmt(round(a.worst.ppm))} ppm ซึ่งยังอยู่ในระดับปกติ`;
    }
    if (key === 'todo') return `${a.level.headline} ${a.level.actions.join(' ')}`;
    if (key === 'switch') return 'การเปิด-ปิดสวิตช์ไฟหรือเสียบปลั๊กทำให้เกิดประกายไฟเล็ก ๆ ข้างในสวิตช์ ถ้าในอากาศมีแก๊ส LPG ราว 1.8–9.5% (ช่วงที่ติดไฟได้) ประกายไฟนี้จุดระเบิดได้ทันที จึงต้องระบายอากาศและรอให้ค่ากลับเป็นสีเขียวก่อนแตะสวิตช์ทุกชนิด';
    if (key === 'lel') {
      const now = a.worst && a.worst.lel != null ? ` ตอนนี้ค่าสูงสุดคือ ${Math.round(a.worst.lel * 10) / 10}% LEL` : '';
      return `LEL (Lower Explosive Limit) คือความเข้มข้นต่ำสุดของแก๊สในอากาศที่ติดไฟได้ ของ LPG ประมาณ 1.8% ของอากาศ หรือ ${fmt(L.LEL_PPM)} ppm GasGuard เตือนเป็น % ของค่านี้ คือเฝ้าระวังที่ ${lel(T.watch)}% (${fmt(T.watch)} ppm) เตือนที่ ${lel(T.warning)}% และอันตรายที่ ${lel(T.danger)}% เพื่อให้เตือนก่อนถึงจุดที่ติดไฟได้หลายเท่า${now}`;
    }
    return '';
  }

  return Object.freeze({ facts, explain, storyKey, placeOf, track, finish, reportText, checklist, PRESETS, status, answer, span, LEVEL_TH });
});
