(function () {
  'use strict';
  const engine = window.GasGuardEngine;
  const providers = window.GasGuardProviders;
  const library = window.GasGuardDemoScenarios;
  if (!engine || !providers || !library) return;

  const $ = id => document.getElementById(id);
  const demoData = window.GasGuardDemoData;
  const state = { scenarioId:'S01', steps:0, speed:1, startedAt:null, active:false, guideStage:0 };
  let updateReviewContext = () => {};
  const guidedStages = Object.freeze([
    { title:'Normal operation', scenario:'S01', role:'general', page:'overview', expected:'ผู้ใช้ทั่วไปเห็นสถานะปกติและเวลาข้อมูลล่าสุด', check:['สถานะมีข้อความ “ปกติ”','ไม่มี raw risk score ใน General'], human:'ไม่มี action ของมนุษย์ใน stage นี้' },
    { title:'Gradual LPG rise', scenario:'S02', role:'developer', page:'demo', expected:'Developer ใช้ Step เพื่อดู rate of rise และ evidence ตาม Engine', check:['เลือก S02','กด Step และดูจำนวน step เพิ่มทีละหนึ่ง'], human:'ผู้ตรวจควรกด Step ด้วยตนเองเพื่อหยุดดูแต่ละ reading' },
    { title:'Danger', scenario:'S03', role:'general', page:'overview', expected:'General เห็นความเสี่ยงสูงและ action ที่อ่านง่าย', check:['เริ่ม S03 แล้วเดิน readings','ยืนยันว่า Danger ไม่พึ่งสีอย่างเดียว'], human:'ผู้ตรวจควรเริ่ม Scenario และกด Step จน Engine ยกระดับ' },
    { title:'System response evidence', scenario:'S03', role:'developer', page:'events', expected:'Developer เห็น incident และหลักฐาน lifecycle', check:['เลือก incident ใน evidence','ตรวจป้าย LOCAL_BROWSER_DATA'], human:'ไม่มีการสั่งวาล์วจริงใน prototype' },
    { title:'Unknown / fault', scenario:'S04', role:'general', page:'overview', expected:'ข้อมูล offline เป็น Unknown ไม่ใช่ Safe', check:['เลือก S04','risk ต้องไม่มีค่า fabricated'], human:'ผู้ตรวจควรกด Step เพื่อส่ง input offline หนึ่งครั้ง' },
    { title:'Recovery', scenario:'S08', role:'developer', page:'demo', expected:'เปลี่ยนกลับข้อมูล valid โดยไม่ลบประวัติ fault', check:['เลือก S08 และเริ่ม Scenario','เปิด evidence เพื่อตรวจประวัติเดิม'], human:'Recovery คือการรับ mock reading ที่ valid ไม่ใช่การรับรองหน้างาน' },
    { title:'General creates request', scenario:'S09', role:'general', page:'assistant', expected:'General เปิดคำขอจาก incident โดยเห็น Simulation label', check:['เปิดคำขอด้วยปุ่ม UI','ตรวจ required field และ success toast'], human:'ผู้ตรวจเป็นผู้ส่ง request เอง ระบบไม่สร้างแทน' },
    { title:'Technician investigates', scenario:'S09', role:'technician', page:'replay', expected:'Detection แยกจาก technician workflow', check:['เลือก incident','เพิ่ม note หรือเริ่มตรวจสอบ'], human:'ผู้ตรวจดำเนิน workflow ของช่างเอง' },
    { title:'Verification', scenario:'S09', role:'technician', page:'reports', expected:'Verification gate ต้องผ่านก่อนปิดงาน', check:['ตรวจสถานะ request','ยืนยันว่าปุ่ม terminal แก้ไขไม่ได้'], human:'ผู้ตรวจบันทึก verification เองผ่าน workflow' },
    { title:'Service report', scenario:'S09', role:'technician', page:'reports', expected:'รายงานเชื่อม relation และมี disclaimer', check:['เปิด report จาก request','ตรวจ not-a-safety-certificate disclaimer'], human:'รายงานเป็น mock และแก้ไขไม่ได้ผ่าน UI' },
    { title:'Developer evidence', scenario:'S09', role:'developer', page:'events', expected:'Relation Explorer แสดง chain Incident → Request → Verification → Report', check:['เลือก record ที่เกี่ยวข้อง','ตรวจ UNVALIDATED_PROTOTYPE'], human:'หาก relation ยังไม่ครบ ให้กลับไปทำ stage ของมนุษย์ก่อนหน้า' }
  ]);
  const escape = value => String(value == null ? '—' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const openIncidents = () => engine.state.events.filter(event => event.lifecycleStatus !== 'resolved');
  const current = () => library.byId(state.scenarioId);
  const currentRole = () => document.body.dataset.authRole || 'unknown';
  const isDeveloper = () => currentRole() === 'developer';
  const isDemoPage = () => $('page-demo') && $('page-demo').classList.contains('is-visible');

  function refreshApp() {
    if (typeof window.GasGuardAppRefresh === 'function') window.GasGuardAppRefresh();
  }
  function statusText() {
    if (engine.state.initializing) return 'กำลังเริ่ม session';
    if (engine.state.paused) return 'พักการจำลอง';
    return state.active ? 'กำลังเดิน Scenario' : 'พร้อมทดสอบ';
  }
  function renderShell() {
    const latest = engine.analysis.current;
    const badge = $('last-reading-badge');
    if (badge) badge.textContent = engine.state.initializing ? 'INITIALIZING · ข้อมูลยังไม่พร้อม' : `ล่าสุด ${new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(latest.timestamp))}`;
  }
  function renderDemo() {
    const select = $('demo-scenario-select');
    if (!select) return;
    const scenario = current();
    if (select.options.length !== library.scenarios.length) {
      select.innerHTML = library.scenarios.map(item => `<option value="${item.id}">${item.id} · ${escape(item.thai)}</option>`).join('');
    }
    select.value = scenario.id;
    $('demo-scenario-copy').innerHTML = `<strong>${scenario.id} · ${escape(scenario.title)}</strong><p>${escape(scenario.purpose)}</p><p><b>คาดหวัง:</b> ${escape(scenario.expected)}</p>`;
    const faults = openIncidents().filter(event => event.eventType === 'system_fault').length;
    const requests = window.GasGuardService ? window.GasGuardService.state.requests.filter(item => !['completed','cancelled'].includes(item.status)).length : 0;
    const facts = [
      ['สถานะ', statusText()],
      ['จำนวน Step', `${state.steps}`],
      ['ความเร็ว', `${state.speed}x`],
      ['เวลาใน session', state.startedAt ? `${Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000))} วินาที` : 'ยังไม่เริ่ม'],
      ['Provider', `${providers.status} · simulation`],
      ['Open incidents', `${openIncidents().length}`],
      ['Open system faults', `${faults}`],
      ['Open service requests', `${requests}`]
    ];
    $('demo-facts').innerHTML = facts.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
    const events = engine.state.events.slice(0,4);
    $('demo-open-list').innerHTML = `<p class="section-label">SCENARIO EVENTS</p>${events.length ? events.map(event => `<div><strong>${escape(event.title)}</strong><span>${escape(event.eventType || event.type)} · ${escape(event.lifecycleStatus || 'legacy')}</span></div>`).join('') : '<p>ยังไม่มี incident ใน session นี้</p>'}`;
    $('demo-start').textContent = state.active && !engine.state.paused ? 'กำลังทำงาน' : (state.steps ? 'ทำต่อ Scenario' : 'เริ่ม Scenario');
    $('demo-pause').textContent = engine.state.paused ? 'ทำงานต่อ' : 'พัก';
    $('demo-speed').value = String(state.speed);
    renderGuidedDemo();
    renderShell();
    updateReviewContext();
  }
  function pageLabel(page) {
    return ({overview:'ภาพรวมความปลอดภัย',assistant:'ขอความช่วยเหลือ',replay:'ตรวจสอบเหตุการณ์',reports:'รายงานการบริการ',events:'Logs and Evidence',demo:'ศูนย์ควบคุมการจำลอง'})[page] || page;
  }
  function roleLabel(role) { return ({general:'บุคคลทั่วไป',technician:'ช่างเทคนิค',developer:'นักพัฒนา'})[role] || role; }
  function renderGuidedDemo() {
    const panel = $('guided-demo');
    if (!panel) return;
    const isGuided = state.scenarioId === 'S10';
    panel.hidden = !isGuided;
    if (!isGuided) return;
    const stage = guidedStages[state.guideStage] || guidedStages[0];
    $('guided-demo-stage').textContent = `Stage ${state.guideStage + 1} / ${guidedStages.length}`;
    $('guided-demo-title').textContent = stage.title;
    $('guided-demo-copy').textContent = stage.expected;
    $('guided-demo-facts').innerHTML = [['Scenario state',stage.scenario],['Role',roleLabel(stage.role)],['Page',pageLabel(stage.page)]].map(([label,value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
    $('guided-demo-checklist').innerHTML = stage.check.map(item => `<li>${escape(item)}</li>`).join('');
    $('guided-demo-human').textContent = stage.human;
    $('guided-demo-prev').disabled = state.guideStage === 0;
    $('guided-demo-next').disabled = state.guideStage === guidedStages.length - 1;
  }
  function setScenario(id, restart) {
    const scenario = library.byId(id);
    state.scenarioId = scenario.id;
    state.steps = 0;
    state.active = false;
    if (scenario.id === 'S10') state.guideStage = 0;
    engine.restartSimulation(scenario.engineScenario);
    if (providers.setSimulationSpeed) providers.setSimulationSpeed(state.speed);
    if (restart) state.startedAt = Date.now();
    refreshApp();
    renderDemo();
  }
  function openGuidedStage() {
    const stage = guidedStages[state.guideStage] || guidedStages[0];
    if (state.scenarioId !== stage.scenario) setScenario(stage.scenario, true);
    if (currentRole() !== stage.role) return;
    const navButton = document.querySelector(`[data-role-page="${stage.page}"]`);
    navButton?.click();
    updateReviewContext();
  }
  function moveGuidedStage(delta) {
    state.guideStage = Math.max(0, Math.min(guidedStages.length - 1, state.guideStage + delta));
    renderDemo();
  }
  function restartGuidedDemo() {
    state.guideStage = 0;
    setScenario('S10', true);
    renderDemo();
  }
  function start() {
    if (engine.state.source.mode !== 'simulation') {
      engine.saveSource({ mode:'simulation', restUrl:'', mqttUrl:'' });
      providers.reset();
    }
    if (engine.state.paused) engine.togglePause();
    state.active = true;
    state.startedAt = state.startedAt || Date.now();
    refreshApp();
    renderDemo();
  }
  function togglePause() {
    if (!state.active) start();
    engine.togglePause();
    refreshApp();
    renderDemo();
  }
  function step() {
    if (engine.state.source.mode !== 'simulation') {
      engine.saveSource({ mode:'simulation', restUrl:'', mqttUrl:'' });
      providers.reset();
    }
    const wasPaused = engine.state.paused;
    if (!wasPaused) engine.togglePause();
    engine.togglePause();
    engine.tick();
    engine.togglePause();
    state.active = true;
    state.startedAt = state.startedAt || Date.now();
    state.steps += 1;
    refreshApp();
    renderDemo();
  }
  function resetDemo() {
    if (window.GasGuardActiveWorkspaceId !== 'demo-site' || !demoData) return;
    const approved = window.confirm('Reset Demo Site จะล้าง readings, events, alerts และ service state ของข้อมูลจำลอง แล้วคืนค่าเริ่มต้น ต้องการดำเนินการหรือไม่?');
    if (!approved) return;
    const result = demoData.reset({ workspaceId:window.GasGuardActiveWorkspaceId, engine, service:window.GasGuardService });
    if (!result.ok) return;
    Object.assign(state, { scenarioId:'S01', steps:0, startedAt:null, active:false, guideStage:0 });
    window.GasGuardDemoScenario = 'NORMAL';
    if ($('scenario-select')) $('scenario-select').value = 'NORMAL';
    if ($('mobile-scenario-select')) $('mobile-scenario-select').value = 'NORMAL';
    providers.reset?.();
    refreshApp();
    renderDemo();
    const notice = $('demo-reset-result');
    if (notice) notice.textContent = 'DEMO RESET COMPLETE';
  }
  function showDemo() {
    if (!isDeveloper()) return;
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('is-visible', page.id === 'page-demo'));
    document.body.dataset.demoPage = 'true';
    $('page-kicker').textContent = 'DEVELOPER DEMO CONTROL';
    $('page-title').textContent = 'ศูนย์ควบคุมการจำลอง';
    syncNavigation();
    renderDemo();
    window.scrollTo({ top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function syncNavigation() {
    const nav = $('navigation');
    if (!nav) return;
    const demoButton = nav.querySelector('[data-role-page="demo"]');
    if (demoButton) demoButton.classList.toggle('is-active', isDemoPage());
  }
  function bindReview() {
    const params = new URLSearchParams(window.location.search);
    const bar = $('review-bar');
    if (!bar || params.get('review') !== '1') return;
    const update = () => {
      const page = isDemoPage() ? 'D8 Demo Control' : ($('page-title')?.textContent || 'Unknown page');
      const viewport = window.innerWidth <= 430 ? 'mobile' : window.innerWidth <= 900 ? 'tablet' : 'desktop';
      const incident = openIncidents()[0];
      $('review-context').textContent = `Page: ${page} · Role: ${currentRole()} · Scenario: ${current().id} · ${viewport}`;
      return `Page: ${page}\nRole: ${currentRole()}\nScenario: ${current().id} ${current().title}\nViewport: ${viewport} ${window.innerWidth}×${window.innerHeight}\nData source: ${engine.state.source.mode}\nIncident: ${incident ? (incident.eventId || incident.id) : 'none'}\nComment:`;
    };
    updateReviewContext = update;
    bar.hidden = false;
    update();
    $('copy-review-context').addEventListener('click', async () => {
      const text = update();
      try { await navigator.clipboard.writeText(text); $('copy-review-context').textContent = 'คัดลอกแล้ว'; }
      catch (error) { window.prompt('คัดลอกข้อความนี้ด้วยตนเอง', text); }
      window.setTimeout(() => { $('copy-review-context').textContent = 'Copy review context'; }, 1600);
    });
    $('close-review').addEventListener('click', () => { bar.hidden = true; });
    window.addEventListener('resize', update, { passive:true });
  }
  function bindDrawer() {
    const sidebar = $('app-sidebar');
    const toggle = $('nav-toggle');
    if (!sidebar || !toggle) return;
    const close = () => { sidebar.classList.remove('is-open'); toggle.setAttribute('aria-expanded','false'); };
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      if (open) nav?.querySelector('button')?.focus();
    });
    const nav = $('navigation');
    nav?.addEventListener('click', event => { if (event.target.closest('button')) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }
  function bind() {
    $('demo-scenario-select')?.addEventListener('change', event => setScenario(event.target.value, true));
    $('demo-start')?.addEventListener('click', start);
    $('demo-pause')?.addEventListener('click', togglePause);
    $('demo-step')?.addEventListener('click', step);
    $('demo-restart')?.addEventListener('click', () => setScenario(state.scenarioId, true));
    $('demo-speed')?.addEventListener('change', event => { state.speed = Number(event.target.value); providers.setSimulationSpeed?.(state.speed); renderDemo(); });
    $('demo-reset')?.addEventListener('click', resetDemo);
    $('guided-demo-prev')?.addEventListener('click', () => moveGuidedStage(-1));
    $('guided-demo-next')?.addEventListener('click', () => moveGuidedStage(1));
    $('guided-demo-open')?.addEventListener('click', openGuidedStage);
    $('guided-demo-restart')?.addEventListener('click', restartGuidedDemo);
    const originalTick = providers.tick.bind(providers);
    providers.tick = async function controlledTick() {
      const before = engine.state.readings.length;
      const result = await originalTick();
      if (engine.state.readings.length > before && state.active) state.steps += engine.state.readings.length - before;
      renderShell();
      if (isDemoPage()) renderDemo();
      return result;
    };
    new MutationObserver(syncNavigation).observe($('navigation'), { childList:true });
    bindReview();
    bindDrawer();
    syncNavigation();
    renderDemo();
    renderShell();
  }
  window.GasGuardDemoRefresh = renderDemo;
  bind();
})();
