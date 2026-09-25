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
      label: 'สภาวะปกติ (Safe)',
      safety: 'safe',
      gasPpm: 84,
      baseline: 84,
      ratePpmMin: '+0.2',
      confidence: 95,
      variance: 2.1,
      exposure: 120,
      valve: 'OPEN',
      valveText: 'เปิดปกติ (Open)',
      connection: 'ONLINE',
      connectionText: 'ออนไลน์ (Online)',
      safetyScore: 92,
      riskScore: 8,
      statusLabel: 'ปกติ',
      badge: SIMULATION_BADGE,
      summary: 'ระดับก๊าซ LPG อยู่ในระดับปกติ ค่าเฉลี่ยคงที่ใกล้เคียง baseline ไม่มีแนวโน้มความเสี่ยง',
      action: 'สภาวะแวดล้อมปลอดภัย ระบบทำงานและส่งข้อมูลตามปกติ ไม่จำเป็นต้องดำเนินการใดๆ'
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
      valve: 'CLOSED',
      valveText: 'ปิดวาล์วอัตโนมัติ (Closed)',
      connection: 'ONLINE',
      connectionText: 'ออนไลน์ (Online)',
      safetyScore: 58,
      riskScore: 42,
      statusLabel: 'เฝ้าระวัง',
      badge: SIMULATION_BADGE,
      summary: 'ตรวจพบความเข้มข้น LPG เพิ่มขึ้นเร็วกว่าปกติ (+4.5 ppm/min) ขณะที่ระบบแจ้งสถานะวาล์วปิด',
      action: 'เฝ้าระวังต่อเนื่อง ตรวจสอบบริเวณครัวหรือวาล์วถังแก๊ส และระบายอากาศหากมีกลิ่นแก๊ส'
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
      valve: 'CLOSED',
      valveText: 'ปิดวาล์วฉุกเฉิน (Closed)',
      connection: 'ONLINE',
      connectionText: 'ออนไลน์ (Online)',
      safetyScore: 6,
      riskScore: 94,
      statusLabel: 'อันตราย',
      badge: SIMULATION_BADGE,
      summary: 'ความเข้มข้นก๊าซและอัตราการเพิ่มสูงผิดปกติอย่างมีนัยสำคัญ ข้อมูลสนับสนุนภาวะแก๊สรั่วรุนแรง',
      action: 'อพยพออกจากพื้นที่ทันที หลีกเลี่ยงประกายไฟหรือการเปิดสวิตช์ไฟฟ้า และติดต่อหน่วยงานฉุกเฉิน'
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
