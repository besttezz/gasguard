(function () {
  'use strict';
  const now = Date.now();
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n, d = 0) => Number(n.toFixed(d));

  const contract = {
    deviceId: 'GG-KITCHEN-01', sensorId: 'LPG-01', locationId: 'restaurant-a', zoneId: 'kitchen',
    gas: { value: 0, unit: 'ppm', rawValue: 0, calibrationVersion: 'prototype-v0' },
    environment: { temperature: 0, humidity: 0 },
    system: { valve: 'open', connection: 'online', battery: 96, rssi: -58, activity: 'active' },
    timestamp: new Date().toISOString()
  };

  function reading(minute, value, extra = {}) {
    return {
      ...contract, gas: { ...contract.gas, value: round(value), rawValue: round(value * 0.98) },
      environment: { temperature: round(30.8 + Math.sin(minute / 17) * 1.1, 1), humidity: round(66 + Math.cos(minute / 22) * 4) },
      system: { ...contract.system, ...extra.system }, timestamp: new Date(now - minute * 60000).toISOString()
    };
  }

  const history = Array.from({ length: 120 }, (_, i) => {
    const minute = 119 - i;
    const pattern = 92 + Math.sin(i / 9) * 9 + Math.cos(i / 19) * 6 + (i % 13 === 0 ? 5 : 0);
    return reading(minute, pattern);
  });

  const dailyPattern = [
    ['00:00', 61, 63, 58, 60, 64, 70, 68], ['04:00', 55, 56, 54, 53, 57, 61, 59],
    ['08:00', 104, 116, 108, 112, 119, 135, 128], ['12:00', 151, 165, 158, 160, 172, 196, 188],
    ['16:00', 92, 98, 94, 96, 102, 118, 110], ['20:00', 128, 142, 133, 138, 146, 170, 159]
  ];

  const scenarios = {
    normal: { label: 'ทำงานตามปกติ', next(last, index) { return clamp(last + (Math.random() - .5) * 11 + Math.sin(index / 8) * 2, 66, 126); }, system: {} },
    transient: { label: 'ค่าสูงชั่วคราวขณะทำอาหาร', next(last, index) { const pulse=index%10<4?22:-18; return clamp(last+pulse+(Math.random()-.5)*8,72,230); }, system: { valve: 'open', activity: 'active' } },
    rise: { label: 'LPG เพิ่มต่อเนื่อง', next(last) { return clamp(last + 14 + Math.random() * 9, 70, 730); }, system: { activity: 'inactive' } },
    critical: { label: 'เหตุวิกฤต', next(last) { return clamp(last + 42 + Math.random() * 25, 120, 980); }, system: { valve: 'closed', activity: 'inactive' } },
    unknown: { label: 'เซ็นเซอร์ขาดการเชื่อมต่อ', next(last) { return last; }, system: { connection: 'offline', valve: 'unknown', activity: 'unknown' } }
  };

  window.GasGuardData = { contract, history, dailyPattern, scenarios, reading, now };
})();
