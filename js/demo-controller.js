(function () {
  'use strict';
  const engine = window.GasGuardEngine;
  const providers = window.GasGuardProviders;
  const library = window.GasGuardDemoScenarios;
  if (!engine || !providers || !library) return;

  const $ = id => document.getElementById(id);
  const demoKeys = Object.freeze([
    'gasguard-v2-draft',
    'gasguard-v2-service-workflow',
    'gasguard-v2-view-mode',
    'gasguard-v2-demo-role',
    'gasguard-v2-setup-profile',
    'gasguard-v2-managed-sites'
  ]);
  const resetMarker = 'gasguard-v2-demo-reset-pending';
  const state = { scenarioId:'S01', steps:0, speed:1, startedAt:null, active:false };
  let updateReviewContext = () => {};
  const escape = value => String(value == null ? '—' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const openIncidents = () => engine.state.events.filter(event => event.lifecycleStatus !== 'resolved');
  const current = () => library.byId(state.scenarioId);
  const isDeveloper = () => $('view-mode') && $('view-mode').value === 'developer';
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
    renderShell();
    updateReviewContext();
  }
  function setScenario(id, restart) {
    const scenario = library.byId(id);
    state.scenarioId = scenario.id;
    state.steps = 0;
    state.active = false;
    engine.restartSimulation(scenario.engineScenario);
    if (providers.setSimulationSpeed) providers.setSimulationSpeed(state.speed);
    if (restart) state.startedAt = Date.now();
    refreshApp();
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
    const approved = window.confirm('Reset Demo Session จะลบเฉพาะข้อมูล GasGuard ใน browser นี้ และรีโหลดหน้าเว็บ ต้องการดำเนินการหรือไม่?');
    if (!approved) return;
    try {
      demoKeys.forEach(key => localStorage.removeItem(key));
      sessionStorage.setItem(resetMarker, '1');
      window.location.reload();
    } catch (error) {
      const notice = $('demo-open-list');
      if (notice) notice.innerHTML = '<p>ไม่สามารถ reset local browser storage ได้ โปรดตรวจสิทธิ์ storage แล้วลองใหม่</p>';
    }
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
      $('review-context').textContent = `Page: ${page} · Role: ${$('view-mode')?.value || 'unknown'} · Scenario: ${current().id} · ${viewport}`;
      return `Page: ${page}\nRole: ${$('view-mode')?.value || 'unknown'}\nScenario: ${current().id} ${current().title}\nViewport: ${viewport} ${window.innerWidth}×${window.innerHeight}\nData source: ${engine.state.source.mode}\nIncident: ${incident ? (incident.eventId || incident.id) : 'none'}\nComment:`;
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
    $('view-mode')?.addEventListener('change', () => { document.body.dataset.demoPage = ''; syncNavigation(); });
    bindReview();
    bindDrawer();
    try {
      if (sessionStorage.getItem(resetMarker) === '1') {
        sessionStorage.removeItem(resetMarker);
        engine.setInitializing(true);
        refreshApp();
      }
    } catch (error) {}
    syncNavigation();
    renderDemo();
    renderShell();
  }
  window.GasGuardDemoRefresh = renderDemo;
  bind();
})();
