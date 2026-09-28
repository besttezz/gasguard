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
        entry('ติดตาม', 'แจ้งเตือน', 'alerts', '♧', 'primary'),
        entry('ติดตาม', 'พื้นที่', 'locations', '⌑', 'primary'),
        entry('ติดตาม', 'ประวัติ', 'events', '◷', 'primary'),
        entry('ช่วยเหลือ', 'ช่วยเหลือและงานบริการ', 'assistant', '☎', 'more'),
        entry('ช่วยเหลือ', 'คู่มือการอ่านข้อมูล', 'guide', '?', 'more'),
        entry('บริการ', 'รายงานการบริการ', 'reports', '▤', 'more'),
        entry('ข้อมูล', 'Product & Technology', 'product', '◇', 'more')
      ])
    }),
    technician: Object.freeze({
      landing: 'overview',
      entries: Object.freeze([
        entry('งานช่าง', 'งาน', 'overview', '◉', 'primary'),
        entry('ติดตาม', 'แจ้งเตือน', 'alerts', '♧', 'primary'),
        entry('ติดตาม', 'เหตุการณ์', 'events', '◷', 'primary'),
        entry('งานช่าง', 'นัดหมายและรายงานบริการ', 'reports', '▤', 'primary'),
        entry('งานช่าง', 'อุปกรณ์', 'live', '▣', 'primary'),
        entry('งานช่าง', 'รายการอุปกรณ์', 'devices', '⌘', 'more'),
        entry('ตรวจสอบ', 'ตรวจสอบเหตุการณ์', 'replay', '◷', 'primary'),
        entry('เพิ่มเติม', 'ติดตั้งสถานที่', 'setup', '⌘', 'more', { action: 'setup' }),
        entry('เพิ่มเติม', 'ทดสอบระบบ', 'validation', '✓', 'more'),
        entry('ดูแล', 'การบำรุงรักษา', 'maintenance', '◌', 'more'),
        entry('ข้อมูล', 'Product & Technology', 'product', '◇', 'more')
      ])
    }),
    developer: Object.freeze({
      landing: 'developer',
      entries: Object.freeze([
        entry('ระบบ', 'Overview', 'overview', '◉', 'primary'),
        entry('ระบบ', 'Live Monitor', 'live', '▣', 'primary'),
        entry('ระบบ', 'Dashboard', 'developer', '</>', 'primary'),
        entry('ระบบ', 'Hardware Lab', 'hardware-lab', '⌁', 'more'),
        entry('ข้อมูล', 'ข้อมูล', 'explorer', '⌘', 'primary'),
        entry('ตรวจสอบ', 'Evidence', 'events', '◷', 'primary'),
        entry('ระบบ', 'Demo', 'demo', '◷', 'primary'),
        entry('เพิ่มเติม', 'Feature Analysis', 'intelligence', '✦', 'more'),
        entry('ตรวจสอบ', 'Rule / Model Validation', 'validation', '✓', 'more'),
        entry('ตรวจสอบ', 'Spatial Simulation', 'spatial', '⌖', 'more'),
        entry('ระบบ', 'Devices', 'devices', '⌘', 'more'),
        entry('ระบบ', 'Version and Configuration', 'settings', '⚙', 'more'),
        entry('ข้อมูล', 'Product & Technology', 'product', '◇', 'more')
      ])
    }),
    admin: Object.freeze({
      landing: 'admin-dashboard',
      entries: Object.freeze([
        entry('ระบบ', 'Admin Dashboard', 'admin-dashboard', '◉', 'primary'),
        entry('ระบบ', 'Overview', 'overview', '▦', 'primary'),
        entry('ติดตาม', 'Alerts', 'alerts', '♧', 'primary'),
        entry('ติดตาม', 'Events', 'events', '◷', 'primary'),
        entry('ระบบ', 'Locations', 'locations', '⌑', 'more'),
        entry('ระบบ', 'Devices', 'devices', '⌘', 'more'),
        entry('บริการ', 'Maintenance', 'maintenance', '◌', 'more'),
        entry('บริการ', 'Reports', 'reports', '▤', 'more'),
        entry('ข้อมูล', 'Product & Technology', 'product', '◇', 'more')
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
    resolvePage(role, page) { return this.canOpen(role, page) ? page : this.landingFor(role); },
    primaryFor(role) { return this.entriesFor(role).filter(item => item.mobile === 'primary'); },
    moreFor(role) { return this.entriesFor(role).filter(item => item.mobile === 'more'); },
    pageIds: uniquePageIds
  });
})();
