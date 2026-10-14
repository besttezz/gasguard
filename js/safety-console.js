(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardSafetyConsole = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  // User-facing safety screen for a device workspace: colour status + what to do, pre-cook check,
  // sensor health, event timeline, floor-plan heat map, alarms, and a demo simulator (new value every 10 s).
  const logic = root.GasGuardSafetyLogic || (typeof require === 'function' ? require('./safety-logic.js') : null);
  const TICK_MS = 10e3;
  const HISTORY_MS = 60 * 60e3;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmtPpm = v => (v == null ? '—' : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('th-TH'));
  const fmtLel = v => (v == null ? '' : `${v < 1 ? v.toFixed(2) : v.toFixed(1)} %LEL`);
  const clock = ms => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ICON = {
    safe: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    watch: '<path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    warning: '<path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    danger: '<path d="M12 6.5v7M12 17v.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
    unknown: '<path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  };
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[key] || ICON.unknown}</svg>`;

  function sensorName(info, id) { return (info && info[id] && info[id].name) || id; }

  // ---- Pure HTML builders (tested in Node) ---------------------------------------------------------
  function heroHtml(a, ctx = {}) {
    const lv = a.level, w = a.worst;
    const detail = w && w.ppm != null
      ? `สูงสุด <strong>${fmtPpm(w.ppm)} ppm</strong> (${fmtLel(w.lel)}) ที่ ${esc(sensorName(ctx.sensorInfo, w.id))} · ${esc(w.trend.label)}${w.escalated ? ' · <em>เตือนล่วงหน้าเพราะแนวโน้ม</em>' : ''}`
      : 'รอค่าแก๊สจากเซ็นเซอร์ (ppm)';
    const sound = ctx.soundOn
      ? '<button type="button" class="sg-chip is-on" data-sg-sound>เสียงเตือนเปิดอยู่</button>'
      : '<button type="button" class="sg-chip" data-sg-sound>เปิดเสียงและการแจ้งเตือน</button>';
    const ack = ctx.alarming ? '<button type="button" class="button sg-ack" data-sg-ack>รับทราบ / ปิดเสียง</button>' : '';
    return `<section class="sg-hero is-${lv.key}" id="sg-hero" aria-live="polite">
      <div class="sg-hero-status">
        <span class="sg-badge">${icon(lv.key)}</span>
        <div><p class="sg-kicker">สถานะตอนนี้${ctx.simulated ? ' · โหมดจำลอง' : ''}</p><h2>${esc(lv.label)}</h2><p class="sg-headline">${esc(lv.headline)}</p><p class="sg-detail">${detail}</p></div>
      </div>
      <div class="sg-hero-actions"><p class="sg-kicker">สิ่งที่ต้องทำ</p><ol>${lv.actions.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>
      <div class="sg-hero-foot"><span class="sg-cook ${a.readyToCook ? 'is-ok' : 'is-no'}">${a.readyToCook ? 'พร้อมใช้งาน จุดเตาได้' : 'ยังไม่ควรจุดเตา'}</span>${sound}${ack}</div>
    </section>`;
  }

  function scaleHtml() {
    const T = logic.THRESHOLDS, L = logic.LEVELS, lel = ppm => `${Math.round((ppm / logic.LEL_PPM) * 100)}%`;
    const rows = [[L.safe, `ต่ำกว่า ${T.watch.toLocaleString()} ppm`, `< ${lel(T.watch)} LEL`], [L.watch, `${T.watch.toLocaleString()}–${(T.warning - 1).toLocaleString()} ppm`, `${lel(T.watch)}–${lel(T.warning)} LEL`],
      [L.warning, `${T.warning.toLocaleString()}–${(T.danger - 1).toLocaleString()} ppm`, `${lel(T.warning)}–${lel(T.danger)} LEL`], [L.danger, `ตั้งแต่ ${T.danger.toLocaleString()} ppm`, `≥ ${lel(T.danger)} LEL`]];
    return `<div class="sg-scale" aria-label="เกณฑ์ระดับแก๊ส">${rows.map(([lv, ppm, pct]) => `<span><i style="background:${lv.color}"></i><b>${esc(lv.label)}</b> ${ppm} <small>${pct}</small></span>`).join('')}</div>`;
  }

  function checksHtml(a) {
    return `<section class="device-panel sg-card"><div class="device-panel-head"><h3>ตรวจก่อนจุดเตา</h3><span class="sg-pill ${a.readyToCook ? 'is-ok' : 'is-no'}">${a.readyToCook ? 'พร้อมใช้งาน' : 'ยังไม่พร้อม'}</span></div>
      <ul class="sg-checks">${a.checks.map(c => `<li class="${c.ok ? 'is-ok' : 'is-no'}"><span aria-hidden="true">${c.ok ? '✓' : '✕'}</span>${esc(c.label)}</li>`).join('')}</ul></section>`;
  }

  function healthHtml(a, info) {
    const rows = a.sensors.length ? a.sensors.map(s => `<li><span class="sg-dot" style="background:${s.level.color}"></span><div><strong>${esc(sensorName(info, s.id))}</strong><small class="${s.health.ok ? '' : 'is-bad'}">${esc(s.health.label)}</small></div><span class="sg-val">${s.ppm == null ? '—' : `${fmtPpm(s.ppm)} ppm`}<small>${esc(s.trend.label)}${s.trend.ratePerMin != null && s.trend.key !== 'none' ? ` · ${s.trend.ratePerMin > 0 ? '+' : ''}${s.trend.ratePerMin.toLocaleString()} ppm/นาที` : ''}</small></span></li>`).join('')
      : '<li class="sg-empty">ยังไม่มีข้อมูลจากเซ็นเซอร์</li>';
    return `<section class="device-panel sg-card"><div class="device-panel-head"><h3>สถานะเซ็นเซอร์</h3></div><ul class="sg-health">${rows}</ul></section>`;
  }

  function timelineHtml(events) {
    const rows = events.length ? events.slice(0, 6).map(e => `<li><time>${esc(clock(e.at))}</time><span class="sg-dot" style="background:${e.to.color}"></span><div><strong>${esc(e.from.label)} → ${esc(e.to.label)}</strong><small>${e.ppm == null ? '' : `${fmtPpm(e.ppm)} ppm · `}${esc(e.trend)}</small></div></li>`).join('')
      : '<li class="sg-empty">ยังไม่มีการเปลี่ยนระดับตั้งแต่เปิดหน้านี้</li>';
    return `<section class="device-panel sg-card"><div class="device-panel-head"><h3>เหตุการณ์ล่าสุด</h3><span class="device-muted">ตั้งแต่เปิดหน้านี้</span></div><ol class="sg-timeline">${rows}</ol></section>`;
  }

  function overlayHtml(a) {
    const lv = a.level;
    return `<div class="sg-alarm-card" role="alertdialog" aria-modal="true" aria-labelledby="sg-alarm-title">
      <span class="sg-alarm-icon">${icon('danger')}</span>
      <h2 id="sg-alarm-title">${esc(lv.label)}: ${esc(lv.headline)}</h2>
      <p>${a.worst && a.worst.ppm != null ? `วัดได้ ${fmtPpm(a.worst.ppm)} ppm (${fmtLel(a.worst.lel)})` : ''}</p>
      <ol>${lv.actions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <button type="button" class="button" data-sg-ack>รับทราบ / ปิดเสียง</button>
    </div>`;
  }

  // ---- Alarm sounds, vibration and system notifications ---------------------------------------------
  function createAlarm(storage) {
    let ctx = null, loop = null, lastRank = -1, ackRank = -1;
    const wanted = () => { try { return storage && storage.getItem('gasguard.alarm.sound') === 'on'; } catch (e) { return false; } };
    const remember = on => { try { storage && storage.setItem('gasguard.alarm.sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ } };

    function audio() {
      if (!ctx) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return null; ctx = new A(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function tone(freq, start, dur, type = 'sine', gain = 0.1, toFreq) {
      const c = audio();
      if (!c || c.state !== 'running') return;
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (toFreq) o.frequency.linearRampToValueAtTime(toFreq, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    const vibrate = p => { try { root.navigator && root.navigator.vibrate && root.navigator.vibrate(p); } catch (e) { /* unsupported */ } };
    const SOUNDS = {
      watch: () => { tone(880, 0, 0.18, 'sine', 0.07); tone(1320, 0.2, 0.25, 'sine', 0.06); vibrate(150); },
      warning: () => { tone(740, 0, 0.16, 'square', 0.09); tone(740, 0.24, 0.16, 'square', 0.09); vibrate([300, 150, 300]); },
      danger: () => { tone(650, 0, 0.45, 'sawtooth', 0.16, 1250); tone(1250, 0.47, 0.45, 'sawtooth', 0.16, 650); vibrate([700, 150, 700]); }
    };
    function stopLoop() { if (loop) { clearInterval(loop); loop = null; } }
    function notify(a) {
      try {
        if (!root.Notification || root.Notification.permission !== 'granted') return;
        new root.Notification(`GasGuard: ${a.level.label}`, { body: `${a.level.headline} — ${a.level.actions[0]}`, tag: 'gasguard-level', renotify: true, requireInteraction: a.level.key === 'danger' });
      } catch (e) { /* some mobile browsers only allow notifications from a service worker */ }
    }
    return {
      soundOn: () => wanted() && ctx != null && ctx.state === 'running',
      wantsSound: wanted,
      enable() {
        remember(true);
        audio();
        tone(880, 0, 0.12, 'sine', 0.05);
        try { if (root.Notification && root.Notification.permission === 'default') root.Notification.requestPermission(); } catch (e) { /* ignore */ }
      },
      disable() { remember(false); stopLoop(); },
      resumeIfWanted() { if (wanted()) audio(); },
      alarming: () => loop != null,
      stop: stopLoop,
      acknowledge() { ackRank = lastRank; stopLoop(); },
      // Called on every assessment; starts/stops sounds when the level changes.
      update(a) {
        const rank = a.level.rank;
        if (rank < ackRank) ackRank = -1; // dropped below the silenced level: arm again
        if (rank !== lastRank) {
          stopLoop();
          if (rank > lastRank && rank >= 1) {
            if (wanted()) SOUNDS[a.level.key] && SOUNDS[a.level.key]();
            notify(a);
          }
          if (rank >= 2 && rank > ackRank) loop = setInterval(() => { if (wanted()) SOUNDS[a.level.key](); }, a.level.key === 'danger' ? 1100 : 6000);
          lastRank = rank;
        }
      }
    };
  }

  // ---- Controller -------------------------------------------------------------------------------
  function create(options) {
    const root$ = options.root;
    const storage = (() => { try { return root.localStorage; } catch (e) { return null; } })();
    const info = options.sensorInfo || {};
    const alarm = createAlarm(storage);
    const events = [];
    let sim = null, simState = null, timer = null, lastLevel = null, last = null;

    root$.innerHTML = `
      <div data-sg-region="head"></div>
      <div class="sg-modebar" data-sg-modebar>
        <div class="sg-segment" role="group" aria-label="แหล่งข้อมูล">
          <button type="button" data-sg-mode="real" class="is-active">ข้อมูลจริงจากบอร์ด</button>
          <button type="button" data-sg-mode="sim">โหมดจำลอง (สาธิต)</button>
        </div>
        <label class="sg-scenario" hidden data-sg-scenario-wrap><span>สถานการณ์</span><select data-sg-scenario>${Object.entries(logic.SCENARIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <span class="sg-modenote" data-sg-modenote>แสดงค่าจริงที่บอร์ดส่งเข้ามา</span>
      </div>
      <div data-sg-region="hero"></div>
      <section class="device-panel sg-plan" id="sg-plan"><div class="device-panel-head"><h3>แปลนบ้านและแผนที่ความเข้มข้นแก๊ส</h3><span class="device-muted">วงสีคือปริมาณแก๊สรอบเซ็นเซอร์แต่ละจุด</span></div><div data-sg-region="plan"></div>${scaleHtml()}</section>
      <div class="sg-grid" data-sg-region="grid"></div>
      <div class="device-dashboard-readings" id="sg-readings" data-sg-region="readings"></div>
      <div class="sg-alarm" data-sg-alarm hidden></div>`;

    const region = name => root$.querySelector(`[data-sg-region="${name}"]`);
    const regions = { head: region('head'), hero: region('hero'), plan: region('plan'), grid: region('grid'), readings: region('readings') };
    const alarmEl = root$.querySelector('[data-sg-alarm]');
    const plan = root.GasGuardFloorPlan ? root.GasGuardFloorPlan.mount(regions.plan, {
      storageKey: `gasguard.floorplan.v1:${options.workspaceId}`,
      sensorOptions: () => Object.keys(info).map(id => ({ id, name: `${info[id].name} (${id})` }))
    }) : null;

    function tick() {
      const now = Date.now();
      const readings = sim.tick(now);
      simState.history = [...simState.history.filter(r => now - Date.parse(r.receivedAt) < HISTORY_MS), ...readings];
      readings.forEach(r => { simState.sensorLatest[r.sensorId] = r; });
      simState.lastTelemetry = readings[0].receivedAt;
      options.requestRender && options.requestRender();
    }
    function startSim(scenario) {
      stopSim();
      const sensors = ['MQ6-01', 'MQ2-01'];
      sim = logic.createSimulator({ scenario, sensors });
      const now = Date.now();
      const seed = [30, 20, 10].flatMap(s => sensors.map((id, i) => ({ sensorId: id, gasPpm: i ? 95 : 150, rawAdc: null, sensorVoltage: null, calibrationStatus: 'SIMULATED', receivedAt: new Date(now - s * 1000).toISOString() })));
      simState = { connection: 'ONLINE', dataClassification: 'SIMULATION', deviceId: 'โหมดจำลอง', history: seed, sensorLatest: {}, lastTelemetry: seed[seed.length - 1].receivedAt };
      seed.forEach(r => { simState.sensorLatest[r.sensorId] = r; });
      events.length = 0; lastLevel = null;
      tick();
      timer = setInterval(tick, TICK_MS);
    }
    function stopSim() { if (timer) clearInterval(timer); timer = null; sim = null; simState = null; }
    function setMode(mode) {
      root$.querySelectorAll('[data-sg-mode]').forEach(b => b.classList.toggle('is-active', b.dataset.sgMode === mode));
      root$.querySelector('[data-sg-scenario-wrap]').hidden = mode !== 'sim';
      root$.querySelector('[data-sg-modenote]').textContent = mode === 'sim' ? 'ค่าสุ่มเปลี่ยนทุก 10 วินาที ไม่ได้มาจากบอร์ดจริง' : 'แสดงค่าจริงที่บอร์ดส่งเข้ามา';
      if (mode === 'sim') startSim(root$.querySelector('[data-sg-scenario]').value);
      else { stopSim(); events.length = 0; lastLevel = null; options.requestRender && options.requestRender(); }
    }

    root$.addEventListener('click', evt => {
      const b = evt.target.closest('button');
      if (!b) return;
      if (b.dataset.sgMode) setMode(b.dataset.sgMode);
      else if (b.hasAttribute('data-sg-sound')) { if (alarm.soundOn()) alarm.disable(); else alarm.enable(); setTimeout(() => last && paint(last), 120); }
      else if (b.hasAttribute('data-sg-ack')) { alarm.acknowledge(); alarmEl.hidden = true; last && paint(last); }
    });
    root$.addEventListener('change', evt => { if (evt.target.matches('[data-sg-scenario]')) startSim(evt.target.value); });
    // Browsers keep audio locked until the user touches the page; re-arm it on the first touch after a reload.
    root.document && root.document.addEventListener('pointerdown', () => alarm.resumeIfWanted(), { once: true });

    function paint(state) {
      const a = logic.assess(state, Date.now());
      if (lastLevel && a.level.key !== lastLevel.key && a.level.rank >= 0) {
        events.unshift({ at: Date.now(), from: lastLevel, to: a.level, ppm: a.worst ? a.worst.ppm : null, trend: a.worst ? a.worst.trend.label : '' });
        if (events.length > 30) events.pop();
      }
      if (a.level.rank >= 0 || !lastLevel) lastLevel = a.level;
      alarm.update(a);
      regions.hero.innerHTML = heroHtml(a, { sensorInfo: info, simulated: Boolean(simState), soundOn: alarm.soundOn(), alarming: alarm.alarming() });
      regions.grid.innerHTML = checksHtml(a) + healthHtml(a, info) + timelineHtml(events);
      const showOverlay = a.level.key === 'danger' && alarm.alarming();
      if (showOverlay) alarmEl.innerHTML = overlayHtml(a);
      alarmEl.hidden = !showOverlay;
      root.document && root.document.body.classList.toggle('sg-danger-flash', showOverlay);
      if (plan) {
        const map = {};
        a.sensors.forEach(s => { map[s.id] = { ppm: s.ppm, level: s.level }; });
        plan.update(map);
      }
      return a;
    }

    return {
      workspaceId: options.workspaceId,
      regions,
      simulating: () => Boolean(simState),
      displayState: real => simState || real,
      render(state) { last = state; return paint(state); },
      destroy() { stopSim(); alarm.stop(); }
    };
  }

  return Object.freeze({ create, createAlarm, heroHtml, checksHtml, healthHtml, timelineHtml, overlayHtml, scaleHtml, TICK_MS });
});
