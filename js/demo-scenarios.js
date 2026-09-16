(function (root, factory) {
  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  root.GasGuardDemoScenarios = library;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const scenarios = [
    { id:'S01', engineScenario:'normal', title:'Normal Operation', thai:'ทำงานตามปกติ', purpose:'ยืนยันว่าการติดตามปกติไม่สร้างเหตุการณ์ผิดพลาด', expected:'สถานะปกติและไม่มี incident ใหม่' },
    { id:'S02', engineScenario:'rise', title:'Gradual LPG Rise', thai:'LPG เพิ่มต่อเนื่อง', purpose:'สังเกต baseline, rate of rise และการยกระดับตาม Engine', expected:'เริ่มเฝ้าระวัง แล้วอาจยกระดับเมื่อหลักฐานครบ' },
    { id:'S03', engineScenario:'critical', title:'Rapid LPG Rise', thai:'LPG เพิ่มเร็ว', purpose:'ตรวจเส้นทางเหตุความเสี่ยงสูงและหลักฐานที่สัมพันธ์กัน', expected:'เกิด gas-risk incident เดียวและอัปเดตต่อเนื่อง' },
    { id:'S04', engineScenario:'unknown', title:'Sensor Offline', thai:'Sensor offline', purpose:'ตรวจว่าข้อมูลไม่พร้อมต้องเป็น Unknown ไม่ใช่ Safe', expected:'เกิด system fault และ risk ไม่ถูกสรุป' },
    { id:'S05', engineScenario:'network', title:'Network Offline', thai:'Network offline', purpose:'ทดสอบความต่างระหว่างการขาดเครือข่ายและเหตุแก๊ส', expected:'เป็น system fault โดยไม่ปิด gas incident ที่มีอยู่' },
    { id:'S06', engineScenario:'valveFailure', title:'Valve Mismatch', thai:'Valve command / feedback ไม่ตรงกัน', purpose:'ตรวจ evidence ของ actuator โดยไม่สั่งวาล์วจริง', expected:'แสดง valve mismatch ผ่าน Engine เดิม' },
    { id:'S07', engineScenario:'valveFailure', title:'Multi-sensor Disagreement', thai:'ข้อมูลหลาย sensor ไม่สอดคล้อง', purpose:'ตรวจค่า sensor fusion ที่มีใน mock fleet', expected:'แสดง evidence ความเชื่อมั่นของ sensor fusion' },
    { id:'S08', engineScenario:'normal', title:'Recovery', thai:'กลับสู่การติดตามปกติ', purpose:'ตรวจการปิด fault ตาม lifecycle เดิมหลังข้อมูลใช้ได้อีกครั้ง', expected:'fault ปิดตาม logic เดิมเท่านั้น' },
    { id:'S09', engineScenario:'critical', title:'Incident to Service', thai:'เหตุการณ์สู่การขอให้ช่างตรวจ', purpose:'ใช้สร้าง incident จำลอง แล้วดำเนิน workflow ในหน้าเหตุการณ์', expected:'สร้าง request ด้วยปุ่มงานบริการ ไม่สร้างเองซ้ำ' },
    { id:'S10', engineScenario:'normal', title:'Full Presentation Demo', thai:'เส้นทางนำเสนอครบ', purpose:'เริ่มปกติ แล้วสลับ S02 → S03 → S04 → S08 → S09 ตามคู่มือ', expected:'ใช้ประกอบการสาธิต ไม่ใช่ผลทดสอบภาคสนาม' }
  ];

  const byId = id => scenarios.find(item => item.id === id) || scenarios[0];
  const byEngineScenario = name => scenarios.find(item => item.engineScenario === name) || scenarios[0];
  return Object.freeze({ scenarios:Object.freeze(scenarios), byId, byEngineScenario });
});
