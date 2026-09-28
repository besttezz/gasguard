(function () {
  'use strict';

  // Stroke icons (24px grid) keyed by navigation page id. Rendered with currentColor so active/hover states theme them.
  const paths = Object.freeze({
    'admin-dashboard': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    alerts: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    events: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    locations: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    devices: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
    maintenance: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    reports: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/>',
    product: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    assistant: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    guide: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    live: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    replay: '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>',
    setup: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>',
    validation: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    developer: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    'hardware-lab': '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7 15h10"/>',
    explorer: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    demo: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    intelligence: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M21 5h-4"/>',
    spatial: '<path d="M14.1 4.9 9.9 3.1a2 2 0 0 0-1.8 0L3.6 5.2A1 1 0 0 0 3 6.1v13.3a1 1 0 0 0 1.4.9l3.7-1.9a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.2a1 1 0 0 0 .6-.9V4.6a1 1 0 0 0-1.4-.9l-3.7 1.9a2 2 0 0 1-1.8 0z"/><path d="M15 5.8v15M9 3.2v15"/>',
    settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>',
    analytics: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'
  });

  // Metric-card icons, chosen from the card label first and the legacy glyph second.
  const metricPaths = Object.freeze({
    gas: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    bell: paths.alerts,
    pin: paths.locations,
    chip: paths.devices,
    valve: '<path d="M4 12h16"/><path d="M12 12V6"/><path d="M9 6h6"/><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/>',
    'wifi-off': '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="M12 20h.01"/>',
    file: paths.reports,
    battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 11v2M10 11v2"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    peak: '<path d="m18 15-6-6-6 6"/>',
    sparkle: paths.intelligence,
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
    pulse: paths.live
  });

  const metricRules = [
    [/offline/i, 'wifi-off'], [/online|connect|signal/i, 'wifi'], [/battery/i, 'battery'],
    [/valve/i, 'valve'], [/device/i, 'chip'], [/location|site/i, 'pin'],
    [/alert|alarm/i, 'bell'], [/service|request|report/i, 'file'], [/provider/i, 'server'],
    [/temperature|อุณหภูมิ/i, 'thermometer'], [/humidity|ความชื้น/i, 'droplet'],
    [/overall safety|safety/i, 'shield'], [/confidence|health/i, 'target'],
    [/drift|อัตรา|rate/i, 'trend'], [/highest|สูงสุด|peak/i, 'peak'],
    [/risk|anomaly/i, 'sparkle'], [/baseline|เฉลี่ย|average/i, 'clock'],
    [/lpg|gas|ppm|แก๊ส/i, 'gas'], [/monitor/i, 'pulse']
  ];

  const svg = inner => `<svg class="gg-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

  window.GasGuardIcons = Object.freeze({
    has(name) { return Object.prototype.hasOwnProperty.call(paths, name); },
    // Falls back to the navigation entry's text glyph when no icon exists for the page.
    render(name, fallback = '') { return this.has(name) ? svg(paths[name]) : fallback; },
    metric(label, fallback = '') {
      const match = metricRules.find(([pattern]) => pattern.test(String(label || '')));
      return match ? svg(metricPaths[match[1]]) : fallback;
    }
  });
})();
