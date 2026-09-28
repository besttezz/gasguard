(function (root, factory) {
  'use strict';
  const demo = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = demo;
  else root.GasGuardPublicDemo = demo;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const SIMULATION_BADGE = 'SIMULATION / PROTOTYPE / ข้อมูลจำลอง';

  const SCENARIOS = Object.freeze({
    NORMAL: Object.freeze({
      id: 'NORMAL',
      label: 'ปกติ (Normal)',
      safety: 'safe',
      gasPpm: 84,
      baseline: 84,
      ratePpmMin: '+0.2',
      confidence: 95,
      variance: 2.1,
      exposure: 120,
      systemMode: 'MONITORING',
      systemModeText: 'เฝ้าระวังตามปกติ',
      connection: 'AVAILABLE',
      connectionText: 'การเชื่อมต่อจำลอง (Available)',
      safetyScore: 92,
      riskScore: 8,
      statusLabel: 'ปกติ (NORMAL)',
      badge: SIMULATION_BADGE,
      summary: 'ในตัวอย่างจำลองนี้ ค่าค่อนข้างคงที่และใกล้รูปแบบอ้างอิง ระบบกฎต้นแบบจึงจัดสถานะเป็นปกติ',
      action: 'ตัวอย่างข้อความระบบ: ค่าอยู่ในเกณฑ์จำลองปกติ ติดตามสถานะต่อเนื่องตามรอบการทำงาน',
      trendDesc: 'แนวโน้มจำลอง 30 นาที: ค่าคงที่ใกล้เคียง baseline 84 ppm (+0.2 ppm/min)',
      trendPath: 'M 0 64 C 120 63, 240 65, 360 62 C 480 60, 560 64, 680 63',
      trendPoint: { cx: 680, cy: 63 }
    }),
    ATTENTION: Object.freeze({
      id: 'ATTENTION',
      label: 'เฝ้าระวัง (Attention)',
      safety: 'attention',
      gasPpm: 185,
      baseline: 84,
      ratePpmMin: '+4.5',
      confidence: 88,
      variance: 14.8,
      exposure: 740,
      systemMode: 'ATTENTION',
      systemModeText: 'ติดตามสถานการณ์',
      connection: 'AVAILABLE',
      connectionText: 'การเชื่อมต่อจำลอง (Available)',
      safetyScore: 58,
      riskScore: 42,
      statusLabel: 'เฝ้าระวัง (ATTENTION)',
      badge: SIMULATION_BADGE,
      summary: 'ในตัวอย่างจำลองนี้ ค่ามีอัตราการเพิ่มสูงขึ้นกว่าปกติ (+4.5 ppm/min) ระบบกฎต้นแบบจึงจัดให้อยู่ในระดับเฝ้าระวังเพื่อติดตามรูปแบบการเปลี่ยนแปลง',
      action: 'ตัวอย่างข้อความระบบ: แนะนำให้ผู้ใช้สังเกตการณ์ ตรวจสอบบริเวณใช้งาน และระบายอากาศหากมีข้อสงสัย',
      trendDesc: 'แนวโน้มจำลอง 30 นาที: ค่ามีแนวโน้มเพิ่มขึ้นต่อเนื่อง (+4.5 ppm/min) สู่ 185 ppm',
      trendPath: 'M 0 64 C 140 62, 280 54, 420 38 C 520 28, 600 24, 680 20',
      trendPoint: { cx: 680, cy: 20 }
    }),
    CRITICAL: Object.freeze({
      id: 'CRITICAL',
      label: 'เสี่ยงสูง / อันตราย (Critical)',
      safety: 'critical',
      gasPpm: 420,
      baseline: 84,
      ratePpmMin: '+12.8',
      confidence: 94,
      variance: 38.6,
      exposure: 1850,
      systemMode: 'HIGH RISK',
      systemModeText: 'สถานะความเสี่ยงสูง',
      connection: 'AVAILABLE',
      connectionText: 'การเชื่อมต่อจำลอง (Available)',
      safetyScore: 6,
      riskScore: 94,
      statusLabel: 'ความเสี่ยงสูง (CRITICAL)',
      badge: SIMULATION_BADGE,
      summary: 'ในตัวอย่างจำลองนี้ ค่าจำลองสูงเกินเกณฑ์จำลองและมีอัตราการเพิ่มขึ้นอย่างรวดเร็ว (+12.8 ppm/min) เงื่อนไขกฎต้นแบบจึงประเมินว่าเป็นสถานะความเสี่ยงสูง',
      action: 'ตัวอย่างข้อความระบบ: แจ้งเตือนระดับความเสี่ยงสูง แนะนำให้อพยพออกจากพื้นที่และติดต่อหน่วยงานฉุกเฉิน',
      trendDesc: 'แนวโน้มจำลอง 30 นาที: ค่าพุ่งสูงขึ้นอย่างรวดเร็ว (+12.8 ppm/min) แตะระดับ 420 ppm',
      trendPath: 'M 0 64 C 100 62, 220 58, 320 46 C 440 28, 540 16, 680 8',
      trendPoint: { cx: 680, cy: 8 }
    })
  });

  let activeScenarioId = 'NORMAL';

  function getScenario(id) {
    const key = String(id || '').toUpperCase();
    return SCENARIOS[key] || SCENARIOS.NORMAL;
  }

  function setScenario(id) {
    const scenario = getScenario(id);
    activeScenarioId = scenario.id;
    return scenario;
  }

  function getActiveScenario() {
    return SCENARIOS[activeScenarioId];
  }

  function isScenario(id) {
    return Boolean(SCENARIOS[String(id || '').toUpperCase()]);
  }

  return Object.freeze({
    SIMULATION_BADGE,
    SCENARIOS,
    getScenario,
    setScenario,
    getActiveScenario,
    isScenario
  });
});
