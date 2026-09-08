(function () {
  'use strict';

  const entry = (group, label, page, icon, mobile, options = {}) => Object.freeze({
    group, label, page, icon, mobile, action: options.action || null,
    capability: options.capability || 'prototype', fallback: options.fallback || null
  });

  const roles = Object.freeze({
    general: Object.freeze({
      landing: 'overview',
      entries: Object.freeze([
        entry('ภาพรวม', 'หน้าหลัก', 'overview', '◉', 'primary'),
        entry('ติดตาม', 'การแจ้งเตือน', 'alerts', '!', 'primary'),
        entry('ติดตาม', 'พื้นที่', 'locations', '⌖', 'primary'),
        entry('ติดตาม', 'ประวัติเหตุการณ์', 'events', '◷', 'primary'),
        entry('ช่วยเหลือ', 'ช่วยเหลือและงานบริการ', 'assistant', '✧', 'primary'),
        entry('ช่วยเหลือ', 'คู่มือการอ่านข้อมูล', 'guide', '?', 'more')
      ])
    }),
    technician: Object.freeze({
      landing: 'overview',
      entries: Object.freeze([
        entry('งานช่าง', 'งาน', 'overview', '◉', 'primary'),
        entry('งานช่าง', 'นัดหมายและรายงานบริการ', 'reports', '▤', 'primary'),
        entry('งานช่าง', 'อุปกรณ์', 'live', '▣', 'primary'),
        entry('ตรวจสอบ', 'ตรวจสอบเหตุการณ์', 'replay', '◷', 'primary'),
        entry('เพิ่มเติม', 'ติดตั้งสถานที่', 'setup', '⌘', 'more', { action: 'setup' }),
        entry('เพิ่มเติม', 'ทดสอบระบบ', 'validation', '✓', 'more'),
        entry('ดูแล', 'การบำรุงรักษา', 'maintenance', '◌', 'more')
      ])
    }),
    developer: Object.freeze({
      landing: 'developer',
      entries: Object.freeze([
        entry('ระบบ', 'Dashboard', 'developer', '</>', 'primary'),
        entry('ข้อมูล', 'ข้อมูล', 'explorer', '⌘', 'primary'),
        entry('ตรวจสอบ', 'Evidence', 'events', '◷', 'primary'),
        entry('ระบบ', 'Demo', 'demo', '◷', 'primary'),
        entry('เพิ่มเติม', 'Feature Analysis', 'intelligence', '✦', 'more'),
        entry('ตรวจสอบ', 'Rule / Model Validation', 'validation', '✓', 'more'),
        entry('ตรวจสอบ', 'Spatial Simulation', 'spatial', '⌖', 'more'),
        entry('ระบบ', 'Version and Configuration', 'settings', '⚙', 'more')
      ])
    })
  });

  const legacyRoles = Object.freeze(Object.fromEntries(Object.entries(roles).map(([role, config]) => [role, Object.freeze({
    landing: config.landing,
    items: Object.freeze(config.entries.map(item => Object.freeze([item.group, item.label, item.page, item.icon])))
  })])));

  const allPageIds = Object.freeze(Object.values(roles).flatMap(config => config.entries.map(item => item.page)));
  const uniquePageIds = Object.freeze([...new Set(allPageIds)]);

  window.GasGuardNavigation = Object.freeze({
    roles: legacyRoles,
    registry: roles,
    entriesFor(role) { return roles[role]?.entries || []; },
    landingFor(role) { return roles[role]?.landing || roles.general.landing; },
    canOpen(role, page) { return this.entriesFor(role).some(item => item.page === page); },
    primaryFor(role) { return this.entriesFor(role).filter(item => item.mobile === 'primary'); },
    moreFor(role) { return this.entriesFor(role).filter(item => item.mobile === 'more'); },
    pageIds: uniquePageIds
  });
})();
