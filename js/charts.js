/* ============================================================
   GasGuard v2 — charts.js
   กราฟทั้งหมด (Chart.js) รองรับธีมสว่าง/มืด และเซ็นเซอร์แบบไดนามิก
   ============================================================ */
(function () {
  'use strict';

  const GG = window.GG;
  const { store, util } = GG;

  const PALETTE = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#14b8a6', '#eab308', '#ec4899'];
  const C = { safe: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#6366f1' };

  const charts = {
    inst: {},
    PALETTE, C,

    theme() {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      return {
        light,
        text: light ? '#475569' : '#94a3b8',
        grid: light ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.05)',
        border: light ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)',
        tooltipBg: light ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.95)',
        tooltipText: light ? '#0f172a' : '#f1f5f9',
        track: light ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.05)'
      };
    },

    applyDefaults() {
      const t = this.theme();
      Chart.defaults.color = t.text;
      Chart.defaults.font.family = "'Inter','Noto Sans Thai',sans-serif";
      Chart.defaults.font.size = window.innerWidth < 600 ? 10 : 12;
      Chart.defaults.plugins.legend.labels.usePointStyle = true;
      Chart.defaults.plugins.legend.labels.boxWidth = 8;
      Chart.defaults.plugins.legend.labels.padding = window.innerWidth < 600 ? 10 : 16;
      Chart.defaults.plugins.tooltip.backgroundColor = t.tooltipBg;
      Chart.defaults.plugins.tooltip.titleColor = t.tooltipText;
      Chart.defaults.plugins.tooltip.bodyColor = t.tooltipText;
      Chart.defaults.plugins.tooltip.borderColor = t.border;
      Chart.defaults.plugins.tooltip.borderWidth = 1;
      Chart.defaults.plugins.tooltip.padding = 10;
      Chart.defaults.maintainAspectRatio = false;
    },

    scaleMax() { return Number(store.settings.thresholds.scaleMax) || 1000; },

    axisY() {
      const t = this.theme();
      return {
        beginAtZero: true,
        max: this.scaleMax(),
        grid: { color: t.grid },
        border: { color: t.border },
        ticks: { callback: v => v + ' PPM', maxTicksLimit: 6 }
      };
    },

    axisX(display) {
      const t = this.theme();
      return {
        display: display !== false,
        grid: { color: t.grid, display: false },
        border: { color: t.border },
        ticks: { maxTicksLimit: window.innerWidth < 600 ? 5 : 10, maxRotation: 0, autoSkip: true }
      };
    },

    destroy(id) { if (this.inst[id]) { this.inst[id].destroy(); delete this.inst[id]; } },
    destroyAll() { Object.keys(this.inst).forEach(k => this.destroy(k)); },

    ctx(id) {
      const el = document.getElementById(id);
      return el ? el.getContext('2d') : null;
    },

    /* ---------------- Gauge ---------------- */
    initGauge() {
      const ctx = this.ctx('gaugeChart');
      if (!ctx) return;
      this.destroy('gauge');
      const t = this.theme();
      this.inst.gauge = new Chart(ctx, {
        type: 'doughnut',
        data: { datasets: [{ data: [0, this.scaleMax()], backgroundColor: [C.safe, t.track], borderWidth: 0, circumference: 180, rotation: 270, cutout: '78%' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 400 } }
      });
    },

    updateGauge(avg) {
      const g = this.inst.gauge;
      if (!g) return;
      const max = this.scaleMax();
      const v = util.clamp(Math.round(avg || 0), 0, max);
      const th = store.settings.thresholds;
      const color = v >= th.danger ? C.danger : v >= th.warning ? C.warning : C.safe;
      g.data.datasets[0].data = [v, Math.max(0, max - v)];
      g.data.datasets[0].backgroundColor = [color, this.theme().track];
      g.update('none');
      const el = document.getElementById('gauge-value');
      if (el) { el.textContent = v; el.style.color = color; }
    },

    /* ---------------- 24h trend ---------------- */
    initTrend() {
      const ctx = this.ctx('trendChart');
      if (!ctx) return;
      this.destroy('trend');
      this.inst.trend = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top' },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} PPM` } }
          },
          scales: { x: this.axisX(), y: this.axisY() }
        }
      });
      this.updateTrend();
    },

    updateTrend() {
      const ch = this.inst.trend;
      if (!ch) return;
      const sensors = store.enabledSensors();
      const buckets = [];
      const now = Date.now();
      const step = 30 * 60 * 1000;           // ราย 30 นาที
      for (let i = 47; i >= 0; i--) buckets.push(now - i * step);

      const labels = buckets.map(t => util.formatShortTime(t));
      const datasets = sensors.map((s, i) => {
        const raw = store.series[s.devId] || [];
        const data = buckets.map(bt => {
          const pts = raw.filter(p => p[0] >= bt - step / 2 && p[0] < bt + step / 2);
          if (!pts.length) return null;
          return Math.round(pts.reduce((a, p) => a + p[1], 0) / pts.length);
        });
        const color = PALETTE[i % PALETTE.length];
        return {
          label: s.name, data, borderColor: color, backgroundColor: color + '20',
          borderWidth: 2, tension: 0.35, fill: false, pointRadius: 0, pointHoverRadius: 5, spanGaps: true
        };
      });
      ch.data.labels = labels;
      ch.data.datasets = datasets;
      ch.options.scales.y.max = this.scaleMax();
      ch.update('none');

      const note = document.getElementById('trend-note');
      if (note) {
        const total = sensors.reduce((a, s) => a + ((store.series[s.devId] || []).length), 0);
        note.textContent = total < 3 ? 'กำลังสะสมข้อมูล — กราฟจะสมบูรณ์ขึ้นเมื่อระบบทำงานต่อเนื่อง' : '';
      }
    },

    /* ---------------- realtime ---------------- */
    initRealtime() {
      const ctx = this.ctx('realtimeChart');
      if (!ctx) return;
      this.destroy('realtime');
      const sensors = store.enabledSensors();
      this.inst.realtime = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: sensors.map((s, i) => {
            const color = PALETTE[i % PALETTE.length];
            return {
              label: `${s.name} · ${s.location || ''}`.trim(),
              data: [], borderColor: color, backgroundColor: color + '18',
              borderWidth: 2, tension: 0.3, fill: true, pointRadius: 0
            };
          })
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 250 },
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} PPM` } } },
          scales: { x: this.axisX(false), y: this.axisY() }
        }
      });
      this.updateRealtime();
    },

    updateRealtime() {
      const ch = this.inst.realtime;
      if (!ch) return;
      const sensors = store.enabledSensors();
      if (ch.data.datasets.length !== sensors.length) { this.initRealtime(); return; }
      const first = store.liveSeries[sensors[0] && sensors[0].devId] || [];
      ch.data.labels = first.map(p => util.formatTime(p.t));
      sensors.forEach((s, i) => {
        const ls = store.liveSeries[s.devId] || [];
        ch.data.datasets[i].data = ls.map(p => p.ppm);
        ch.data.datasets[i].label = `${s.name} · ${s.location || ''}`.trim();
      });
      ch.options.scales.y.max = this.scaleMax();
      ch.update('none');
    },

    /* ---------------- zone distribution ---------------- */
    initZone() {
      const ctx = this.ctx('zoneDistChart');
      if (!ctx) return;
      this.destroy('zone');
      const t = this.theme();
      this.inst.zone = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'PPM ปัจจุบัน', data: [], backgroundColor: [], borderRadius: 8, borderSkipped: false }] },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.x} PPM` } } },
          scales: {
            x: { beginAtZero: true, max: this.scaleMax(), grid: { color: t.grid }, border: { color: t.border }, ticks: { callback: v => v + '' } },
            y: { grid: { display: false }, border: { color: t.border } }
          }
        }
      });
      this.updateZone();
    },

    updateZone() {
      const ch = this.inst.zone;
      if (!ch) return;
      const sensors = store.enabledSensors();
      ch.data.labels = sensors.map(s => s.location || s.name);
      ch.data.datasets[0].data = sensors.map(s => (store.live[s.devId] && store.live[s.devId].ppm) || 0);
      ch.data.datasets[0].backgroundColor = sensors.map(s => {
        const l = store.live[s.devId];
        const st = l ? store.statusOf(l.ppm, s) : 'offline';
        return C[st] || '#64748b';
      });
      ch.options.scales.x.max = this.scaleMax();
      ch.update('none');
    },

    /* ---------------- statistics ---------------- */
    initStats() {
      const stats = store.weeklyStats(7);
      const sensors = store.enabledSensors();
      const t = this.theme();

      // Bar: ค่าเฉลี่ยรายวัน แยกเซ็นเซอร์
      const barCtx = this.ctx('weeklyBarChart');
      if (barCtx) {
        this.destroy('weeklyBar');
        this.inst.weeklyBar = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: stats.map(s => s.label),
            datasets: sensors.map((s, i) => ({
              label: s.name,
              data: stats.map(d => d.perSensor[s.devId] || 0),
              backgroundColor: PALETTE[i % PALETTE.length] + 'b3',
              borderColor: PALETTE[i % PALETTE.length],
              borderWidth: 1, borderRadius: 6
            }))
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} PPM` } } },
            scales: { x: this.axisX(), y: this.axisY() }
          }
        });
      }

      // Line: เฉลี่ย/สูงสุด/ต่ำสุด
      const trendCtx = this.ctx('weeklyTrendChart');
      if (trendCtx) {
        this.destroy('weeklyTrend');
        this.inst.weeklyTrend = new Chart(trendCtx, {
          type: 'line',
          data: {
            labels: stats.map(s => s.label),
            datasets: [
              { label: 'ค่าเฉลี่ย', data: stats.map(s => s.avg), borderColor: C.info, backgroundColor: C.info + '22', borderWidth: 2.5, tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: C.info },
              { label: 'ค่าสูงสุด', data: stats.map(s => s.max), borderColor: C.danger, borderWidth: 2, tension: 0.4, fill: false, pointRadius: 3, borderDash: [5, 5] },
              { label: 'ค่าต่ำสุด', data: stats.map(s => s.min), borderColor: C.safe, borderWidth: 2, tension: 0.4, fill: false, pointRadius: 3, borderDash: [5, 5] }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} PPM` } } },
            scales: { x: this.axisX(), y: this.axisY() }
          }
        });
      }

      // Pie: สัดส่วนเวลาตามระดับ
      const pieCtx = this.ctx('levelPieChart');
      if (pieCtx) {
        this.destroy('levelPie');
        const safe = stats.reduce((a, s) => a + s.safe, 0);
        const warn = stats.reduce((a, s) => a + s.warn, 0);
        const danger = stats.reduce((a, s) => a + s.danger, 0);
        const total = safe + warn + danger;
        this.inst.levelPie = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: ['ปลอดภัย', 'เฝ้าระวัง', 'อันตราย'],
            datasets: [{
              data: total ? [safe, warn, danger] : [1, 0, 0],
              backgroundColor: [C.safe + 'cc', C.warning + 'cc', C.danger + 'cc'],
              borderColor: [C.safe, C.warning, C.danger], borderWidth: 2, hoverOffset: 8
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: c => {
                    const sum = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
                    return `${c.label}: ${Math.round(c.parsed / sum * 100)}% ของช่วงเวลาที่วัดได้`;
                  }
                }
              }
            }
          }
        });
      }
      return stats;
    },

    /* ---------------- theme refresh ---------------- */
    refreshTheme() {
      this.applyDefaults();
      const hadRealtime = !!this.inst.realtime;
      const hadStats = !!this.inst.weeklyBar;
      const hadZone = !!this.inst.zone;
      this.destroyAll();
      this.initGauge();
      this.initTrend();
      if (hadRealtime) this.initRealtime();
      if (hadZone) this.initZone();
      if (hadStats) this.initStats();
      GG.ui && GG.ui.refreshDashboard && GG.ui.refreshDashboard();
    }
  };

  GG.charts = charts;
})();
