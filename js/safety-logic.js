(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardSafetyLogic = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  // Turns gas readings into a colour level, an action message and a trend.
  // THRESHOLDS are a team draft (see docs/SAFETY_LOGIC_DRAFT.md) and must match the firmware buzzer levels.
  // LPG lower explosive limit taken as 1.8 % vol (butane, the lower of propane 2.1 % / butane 1.8 %),
  // so 1 % LEL = 180 ppm.
  const LEL_PPM = 18000;
  const THRESHOLDS = Object.freeze({ watch: 900, warning: 1800, danger: 3600 }); // 5 / 10 / 20 % LEL

  const LEVELS = Object.freeze({
    unknown: { key: 'unknown', rank: -1, label: 'ยังประเมินไม่ได้', short: 'ไม่มีข้อมูล', color: '#8a94a6',
      headline: 'ยังไม่มีค่าแก๊สที่ใช้ประเมินได้',
      actions: ['ตรวจว่าบอร์ดเปิดอยู่และเชื่อมต่อ Wi-Fi', 'ถ้าได้กลิ่นแก๊ส ให้ปิดวาล์วถังและเปิดหน้าต่างทันที'] },
    safe: { key: 'safe', rank: 0, label: 'ปกติ', short: 'ปลอดภัย', color: '#1f9d55',
      headline: 'ปลอดภัย จุดเตาได้',
      actions: ['ใช้งานเตาได้ตามปกติ', 'ปิดวาล์วถังแก๊สทุกครั้งหลังใช้งานเสร็จ'] },
    watch: { key: 'watch', rank: 1, label: 'เฝ้าระวัง', short: 'เฝ้าระวัง', color: '#e0a400',
      headline: 'เริ่มมีแก๊สสะสม ให้ระบายอากาศ',
      actions: ['เปิดประตูและหน้าต่างให้อากาศถ่ายเท', 'ยังไม่ต้องจุดเตาจนกว่าค่าจะกลับเป็นสีเขียว', 'ตรวจหัวเตา สายแก๊ส และข้อต่อว่ามีรอยรั่วหรือไม่'] },
    warning: { key: 'warning', rank: 2, label: 'เตือน', short: 'อันตรายเริ่มต้น', color: '#ef6c00',
      headline: 'ห้ามเปิด-ปิดสวิตช์ไฟ ปิดวาล์วถังแก๊ส',
      actions: ['ห้ามเปิด-ปิดสวิตช์ไฟหรือเสียบปลั๊กไฟ', 'ปิดวาล์วถังแก๊สทันที', 'เปิดประตูหน้าต่างทุกบาน ห้ามจุดไฟทุกชนิด'] },
    danger: { key: 'danger', rank: 3, label: 'อันตราย', short: 'วิกฤต', color: '#d32f2f',
      headline: 'รีบอพยพออกจากพื้นที่ทันที',
      actions: ['ออกจากอาคารทันที ห้ามแตะสวิตช์ไฟ', 'ถ้าทำได้อย่างปลอดภัย ปิดวาล์วถังแก๊สระหว่างทางออก', 'เมื่ออยู่นอกอาคารแล้ว โทรแจ้งดับเพลิง 199'] }
  });
  const ORDER = ['safe', 'watch', 'warning', 'danger'];

  const PATTERNS = Object.freeze({
    none: { key: 'none', label: 'ข้อมูลยังไม่พอดูแนวโน้ม' },
    stable: { key: 'stable', label: 'ค่าคงที่' },
    falling: { key: 'falling', label: 'ค่ากำลังลดลง' },
    accumulating: { key: 'accumulating', label: 'แก๊สค่อย ๆ สะสม' },
    spike: { key: 'spike', label: 'ค่าพุ่งขึ้นเร็ว (อาจรั่วทันที)' }
  });
  const SPIKE_PPM = 900;          // rise of >= 5 % LEL ...
  const SPIKE_WINDOW_MS = 15e3;   // ... between two consecutive 10-second readings
  const ACCUMULATE_WINDOW_MS = 5 * 60e3;
  const ACCUMULATE_PPM_PER_MIN = 90; // >= 0.5 % LEL per minute, mostly rising
  const STALE_MS = 30e3;

  const num = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const ppmOf = r => (r && r.calibrationStatus !== 'CALIBRATION_REQUIRED' ? num(r.gasPpm) : null);
  const percentLel = ppm => (ppm == null ? null : (ppm / LEL_PPM) * 100);

  function classify(ppm) {
    const v = num(ppm);
    if (v == null) return LEVELS.unknown;
    if (v >= THRESHOLDS.danger) return LEVELS.danger;
    if (v >= THRESHOLDS.warning) return LEVELS.warning;
    if (v >= THRESHOLDS.watch) return LEVELS.watch;
    return LEVELS.safe;
  }

  function raise(level, steps = 1) {
    if (level.rank < 0) return level;
    return LEVELS[ORDER[Math.min(ORDER.length - 1, level.rank + steps)]];
  }

  // Trend of one sensor: [{ t (ms), ppm }] sorted by time.
  function pattern(series, now = Date.now()) {
    const pts = (series || []).filter(p => Number.isFinite(p.t) && p.ppm != null && p.t <= now + 1000);
    if (pts.length < 3) return { ...PATTERNS.none, ratePerMin: null };
    const last = pts[pts.length - 1];
    const recent = pts.filter(p => last.t - p.t <= SPIKE_WINDOW_MS);
    const low = Math.min(...recent.map(p => p.ppm));
    const lowAt = recent.find(p => p.ppm === low);
    if (last.ppm - low >= SPIKE_PPM && last.t > lowAt.t) {
      return { ...PATTERNS.spike, ratePerMin: Math.round(((last.ppm - low) / Math.max(1, last.t - lowAt.t)) * 60e3) };
    }
    const win = pts.filter(p => last.t - p.t <= ACCUMULATE_WINDOW_MS);
    const span = last.t - win[0].t;
    if (win.length < 3 || span <= 0) return { ...PATTERNS.none, ratePerMin: null };
    const rate = ((last.ppm - win[0].ppm) / span) * 60e3;
    let ups = 0;
    for (let i = 1; i < win.length; i++) if (win[i].ppm >= win[i - 1].ppm) ups++;
    const mostlyUp = ups / (win.length - 1) >= 0.7;
    const out = PATTERNS[rate >= ACCUMULATE_PPM_PER_MIN && mostlyUp ? 'accumulating' : rate <= -ACCUMULATE_PPM_PER_MIN ? 'falling' : 'stable'];
    return { ...out, ratePerMin: Math.round(rate) };
  }

  // A fast rise is warned one level early; slow accumulation in clean air already asks for ventilation.
  function levelWithTrend(ppm, trend) {
    const base = classify(ppm);
    if (base.rank < 0) return { level: base, escalated: false };
    if (trend.key === 'spike') return { level: raise(base), escalated: base.key !== 'danger' };
    if (trend.key === 'accumulating' && base.key === 'safe') return { level: LEVELS.watch, escalated: true };
    return { level: base, escalated: false };
  }

  // Detects wiring faults and stuck sensors from raw values. Uses rawAdc when present.
  function sensorHealth(reading, recent, now = Date.now()) {
    if (!reading) return { key: 'missing', ok: false, label: 'ยังไม่มีข้อมูล' };
    const at = Date.parse(reading.receivedAt);
    if (!Number.isFinite(at) || now - at > STALE_MS) return { key: 'stale', ok: false, label: 'ขาดการติดต่อเกิน 30 วินาที' };
    const adc = num(reading.rawAdc);
    if (adc != null && adc < 40) return { key: 'low', ok: false, label: 'สัญญาณต่ำผิดปกติ ตรวจสายสัญญาณหรือไฟเลี้ยงเซ็นเซอร์' };
    if (adc != null && adc > 4085) return { key: 'saturated', ok: false, label: 'ค่าเต็มสเกล ตรวจเซ็นเซอร์หรือวงจรแบ่งแรงดัน' };
    const values = (recent || []).slice(-12).map(r => (ppmOf(r) != null ? ppmOf(r) : num(r.rawAdc))).filter(v => v != null);
    if (values.length >= 12 && values.every(v => v === values[0])) return { key: 'flat', ok: false, label: 'ค่าไม่เปลี่ยนเลย เซ็นเซอร์อาจค้าง' };
    return { key: 'ok', ok: true, label: 'ทำงานปกติ' };
  }

  // Whole-site assessment from a /device/status payload (or the simulator's equivalent).
  function assess(state, now = Date.now()) {
    const latest = state?.sensorLatest || {};
    const history = Array.isArray(state?.history) ? state.history : [];
    const online = state?.connection === 'ONLINE';
    const sensors = Object.keys(latest).map(id => {
      const rows = history.filter(r => r.sensorId === id);
      const series = rows.map(r => ({ t: Date.parse(r.receivedAt), ppm: ppmOf(r) })).filter(p => p.ppm != null);
      const ppm = ppmOf(latest[id]);
      const trend = pattern(series, now);
      const health = sensorHealth(latest[id], rows, now);
      const { level, escalated } = online && health.key !== 'stale' ? levelWithTrend(ppm, trend) : { level: LEVELS.unknown, escalated: false };
      return { id, ppm, lel: percentLel(ppm), trend, health, level, escalated };
    });
    const known = sensors.filter(s => s.level.rank >= 0);
    const worst = known.reduce((a, s) => (!a || s.level.rank > a.level.rank || (s.level.rank === a.level.rank && (s.ppm || 0) > (a.ppm || 0)) ? s : a), null);
    const level = worst ? worst.level : LEVELS.unknown;
    const maxPpm = known.length ? Math.max(...known.map(s => s.ppm || 0)) : null;
    const checks = [
      { label: 'บอร์ดออนไลน์และส่งข้อมูลล่าสุด', ok: online },
      { label: 'เซ็นเซอร์ทุกตัวทำงานปกติ', ok: sensors.length > 0 && sensors.every(s => s.health.ok) },
      { label: 'ค่าแก๊สทุกจุดอยู่ระดับปกติ (สีเขียว)', ok: known.length > 0 && known.length === sensors.length && known.every(s => s.level.key === 'safe') },
      { label: 'ไม่มีแนวโน้มแก๊สสะสมหรือพุ่งขึ้น', ok: known.length > 0 && known.every(s => s.trend.key !== 'accumulating' && s.trend.key !== 'spike') }
    ];
    return { level, worst, maxPpm, sensors, readyToCook: checks.every(c => c.ok), checks };
  }

  // ---- Demo simulator: produces a reading per sensor every tick so the screen can be shown without hardware.
  const SCENARIOS = Object.freeze({
    cycle: 'ไล่ระดับ เขียว → แดง → เขียว',
    random: 'สุ่มค่า',
    accumulate: 'แก๊สค่อย ๆ สะสม',
    leak: 'รั่วกระชาก (ค่าพุ่งทันที)'
  });
  // Each step rises less than SPIKE_PPM so the demo walks through every colour instead of jumping straight to red.
  const CYCLE = [150, 170, 160, 600, 1000, 1150, 1100, 1500, 2000, 2300, 2200, 2800, 3400, 3950, 4500, 4900, 4600, 3800, 2900, 2000, 1300, 800, 400, 200];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSimulator({ scenario = 'cycle', sensors = ['MQ6-01', 'MQ2-01'], seed = Date.now() } = {}) {
    const rng = mulberry32(seed);
    let step = 0, main = 150;
    const jitter = (v, pct) => Math.max(20, v * (1 + (rng() * 2 - 1) * pct));
    function nextMain() {
      if (scenario === 'cycle') return jitter(CYCLE[step % CYCLE.length], 0.02);
      if (scenario === 'accumulate') {
        const phase = step % 40; // ~30 ticks rising, then ventilation
        return phase < 30 ? 150 + phase * 170 * (0.85 + rng() * 0.3) : Math.max(150, main * 0.55);
      }
      if (scenario === 'leak') {
        const phase = step % 24;
        if (phase < 6) return jitter(160, 0.08);
        if (phase < 9) return jitter([2600, 4600, 5400][phase - 6], 0.05);
        return Math.max(150, main * 0.7);
      }
      // random: mostly small moves, sometimes a jump to another level
      const target = rng() < 0.25 ? [150, 1200, 2400, 4500][Math.floor(rng() * 4)] : main * (0.85 + rng() * 0.3);
      return Math.min(6000, Math.max(80, target));
    }
    return {
      scenario,
      tick(now = Date.now()) {
        main = nextMain();
        step++;
        const at = new Date(now).toISOString();
        return sensors.map((sensorId, i) => {
          const share = i === 0 ? 1 : Math.max(0.25, 0.65 - (i - 1) * 0.25);
          const ppm = Math.round(jitter(main * share, 0.02));
          return { sensorId, gasPpm: ppm, rawAdc: null, sensorVoltage: null, calibrationStatus: 'SIMULATED', receivedAt: at };
        });
      }
    };
  }

  return Object.freeze({ LEL_PPM, THRESHOLDS, LEVELS, ORDER, PATTERNS, SCENARIOS, classify, pattern, levelWithTrend, sensorHealth, assess, percentLel, createSimulator });
});
