'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 1. Test public demo isolation and deterministic scenarios
const publicDemo = require('../js/public-demo.js');
assert.ok(publicDemo, 'public-demo module loads');
assert.equal(typeof publicDemo.getScenario, 'function');
assert.equal(typeof publicDemo.setScenario, 'function');

const normal = publicDemo.getScenario('NORMAL');
assert.equal(normal.id, 'NORMAL');
assert.equal(normal.safety, 'safe');
assert.equal(normal.gasPpm, 84);
assert.equal(normal.systemMode, 'MONITORING');
assert.equal(normal.connection, 'AVAILABLE');
assert.ok(normal.badge.includes('SIMULATION'));

const attention = publicDemo.getScenario('ATTENTION');
assert.equal(attention.id, 'ATTENTION');
assert.equal(attention.safety, 'attention');
assert.equal(attention.gasPpm, 185);
assert.equal(attention.systemMode, 'ATTENTION');
assert.equal(attention.connection, 'AVAILABLE');
assert.ok(attention.badge.includes('SIMULATION'));

const critical = publicDemo.getScenario('CRITICAL');
assert.equal(critical.id, 'CRITICAL');
assert.equal(critical.safety, 'critical');
assert.equal(critical.gasPpm, 420);
assert.equal(critical.systemMode, 'HIGH RISK');
assert.equal(critical.connection, 'AVAILABLE');
assert.ok(critical.badge.includes('SIMULATION'));

// Trend paths and accessible descriptions
assert.ok(normal.trendPath && typeof normal.trendPath === 'string');
assert.ok(attention.trendPath && typeof attention.trendPath === 'string');
assert.ok(critical.trendPath && typeof critical.trendPath === 'string');
assert.notEqual(normal.trendPath, attention.trendPath);
assert.notEqual(attention.trendPath, critical.trendPath);

// Ensure no cross-workspace leakage
assert.equal(publicDemo.getActiveScenario().id, 'NORMAL');
publicDemo.setScenario('ATTENTION');
assert.equal(publicDemo.getActiveScenario().id, 'ATTENTION');
publicDemo.setScenario('CRITICAL');
assert.equal(publicDemo.getActiveScenario().id, 'CRITICAL');
publicDemo.setScenario('NORMAL');
assert.equal(publicDemo.getActiveScenario().id, 'NORMAL');

// 2. Test Role Matrix remains unchanged
const auth = require('../js/auth.js');
assert.deepEqual(Array.from(auth.VALID_ROLES).sort(), ['admin', 'developer', 'general', 'technician'].sort(), 'Role matrix strictly retains four roles');
assert.equal(auth.validRole('guest'), null, 'guest is not a valid role');
assert.equal(auth.validRole('public'), null, 'public visitor is not a role');

// 3. Test Navigation security for unauthenticated / unauthorized views
const navContext = { window: {} };
vm.createContext(navContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/navigation.js'), 'utf8'), navContext);
const nav = navContext.window.GasGuardNavigation;

// Private views must be strictly denied to any role not permitted
assert.equal(nav.canOpen('general', 'admin-dashboard'), false);
assert.equal(nav.canOpen('general', 'developer'), false);
assert.equal(nav.canOpen('general', 'hardware-lab'), false);
assert.equal(nav.canOpen('general', 'settings'), false);
assert.equal(nav.canOpen('general', 'explorer'), false);

assert.equal(nav.canOpen('technician', 'admin-dashboard'), false);
assert.equal(nav.canOpen('technician', 'hardware-lab'), false);
assert.equal(nav.canOpen('technician', 'settings'), false);

assert.equal(nav.canOpen('admin', 'hardware-lab'), false);
assert.equal(nav.canOpen('admin', 'developer'), false);

// 4. Test HTML structure for public landing, auth screen, and app shell
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert.ok(html.includes('id="public-landing"'), 'HTML contains public landing container');
assert.ok(html.includes('id="public-hero-title"'), 'HTML contains public hero title');
assert.ok(html.includes('id="public-demo-section"'), 'HTML contains public demo section');
assert.ok(html.includes('id="public-demo-stage"'), 'HTML contains public demo stage window');
assert.ok(html.includes('id="public-demo-trend-path"'), 'HTML contains public demo trend path');
assert.ok(html.includes('id="nav-login-button"'), 'HTML contains navigation login CTA');
assert.ok(html.includes('id="hero-login-button"'), 'HTML contains hero login CTA');
assert.ok(html.includes('id="footer-login-button"'), 'HTML contains footer login CTA');
assert.ok(html.includes('id="login-back-button"'), 'HTML contains login back button to return to public landing');
assert.ok(html.includes('aria-pressed="true"'), 'HTML contains aria-pressed on active scenario button');
assert.ok(html.includes('SIMULATION / PROTOTYPE / ข้อมูลจำลอง'), 'HTML displays simulation prototype label');
assert.ok(html.includes('js/public-demo.js'), 'HTML loads public-demo script');
assert.ok(html.includes('css/public-landing.css'), 'HTML loads public-landing stylesheet');

// 5. Test CSS rules for public-view, auth-view, and authenticated
const css = fs.readFileSync(path.join(__dirname, '../css/public-landing.css'), 'utf8');
assert.ok(css.includes('body.public-view .public-landing { display: block; }'), 'public-view displays public landing');
assert.ok(css.includes('body.public-view .auth-screen { display: none !important; }'), 'public-view hides auth screen');
assert.ok(css.includes('body.public-view .app-shell { display: none !important; }'), 'public-view hides app shell');
assert.ok(css.includes('body.auth-view .public-landing { display: none !important; }'), 'auth-view hides public landing');
assert.ok(css.includes('body.auth-view .auth-screen { display: grid !important; }'), 'auth-view displays auth screen');
assert.ok(css.includes('body.authenticated .public-landing { display: none !important; }'), 'authenticated hides public landing');
assert.ok(css.includes('body.authenticated .app-shell { display: block !important; }'), 'authenticated shows app shell');

// 6. Test public view flow logic in app.js
const appCode = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
assert.ok(appCode.includes('showPublicView'), 'app.js implements showPublicView');
assert.ok(appCode.includes('showLoginView'), 'app.js implements showLoginView');
assert.ok(appCode.includes('renderPublicDemo'), 'app.js implements renderPublicDemo');
assert.ok(appCode.includes('login-back-button'), 'app.js handles login-back-button to return to public landing');
assert.ok(appCode.includes('logout'), 'app.js implements logout');
assert.ok(appCode.includes('initPublicRolesTabs'), 'app.js implements initPublicRolesTabs');

// 7. Test Sprint 4: How It Works 5 stages and progressive disclosure
assert.ok(html.includes('id="public-flow-section"'), 'HTML contains public flow section');
assert.ok(html.includes('SENSOR / DATA SOURCE'), 'Stage 1: SENSOR / DATA SOURCE exists');
assert.ok(html.includes('MEASUREMENT'), 'Stage 2: MEASUREMENT exists');
assert.ok(html.includes('TELEMETRY'), 'Stage 3: TELEMETRY exists');
assert.ok(html.includes('SAFETY ANALYSIS'), 'Stage 4: SAFETY ANALYSIS exists');
assert.ok(html.includes('EXPERIENCE'), 'Stage 5: EXPERIENCE exists');
assert.ok(html.includes('details class="flow-disclosure"'), 'Progressive disclosure details elements exist');
assert.ok(css.includes('.flow-architecture-stage'), 'CSS contains flow architecture stage');
assert.ok(css.includes('.flow-track'), 'CSS contains flow track');

// 8. Test Sprint 4: User Roles 4 roles centered on questions
assert.ok(html.includes('id="public-roles-section"'), 'HTML contains public roles section');
assert.ok(html.includes('id="role-tab-general"'), 'Role tab General exists');
assert.ok(html.includes('id="role-tab-technician"'), 'Role tab Technician exists');
assert.ok(html.includes('id="role-tab-admin"'), 'Role tab Admin exists');
assert.ok(html.includes('id="role-tab-developer"'), 'Role tab Developer exists');
assert.ok(html.includes('“ตอนนี้พื้นที่ของฉันเป็นอย่างไร?”'), 'General question exists');
assert.ok(html.includes('“ตอนนี้มีอะไรที่ต้องตรวจสอบหรือบำรุงรักษา?”'), 'Technician question exists');
assert.ok(html.includes('“ภาพรวมหลายพื้นที่และอุปกรณ์เป็นอย่างไร?”'), 'Admin question exists');
assert.ok(html.includes('“Data pipeline และ integration ทำงานถูกต้องหรือไม่?”'), 'Developer question exists');
assert.ok(css.includes('.roles-interactive-layout'), 'CSS contains roles interactive layout');
assert.ok(css.includes('.role-story-grid'), 'CSS contains role story grid');

// 9. Test Sprint 5: Technology 3 Pillars
assert.ok(html.includes('id="public-tech-section"'), 'HTML contains public tech section');
assert.ok(html.includes('RELIABLE DATA'), 'Pillar 1: RELIABLE DATA exists');
assert.ok(html.includes('PROTECTED PIPELINE'), 'Pillar 2: PROTECTED PIPELINE exists');
assert.ok(html.includes('HARDWARE INTEGRATION PATH'), 'Pillar 3: HARDWARE INTEGRATION PATH exists');
assert.ok(html.includes('Measurement Layer'), 'Reliable Data mentions Measurement Layer');
assert.ok(html.includes('Telemetry V1.1'), 'Reliable Data mentions Telemetry V1.1');
assert.ok(html.includes('HTTP Ingress') || html.includes('HTTP Device Ingress'), 'Hardware path mentions HTTP Ingress');
assert.ok(css.includes('.public-tech-pillars'), 'CSS contains public tech pillars layout');

// 10. Test Sprint 5: Trust & Transparency 3 Maturity Stages
assert.ok(html.includes('id="public-trust-section"'), 'HTML contains public trust section');
assert.ok(html.includes('IMPLEMENTED IN SOFTWARE'), 'Stage 1: IMPLEMENTED IN SOFTWARE exists');
assert.ok(html.includes('READY FOR DEVICE INTEGRATION'), 'Stage 2: READY FOR DEVICE INTEGRATION exists');
assert.ok(html.includes('PENDING VALIDATION'), 'Stage 3: PENDING VALIDATION exists');
assert.ok(html.includes('Physical ESP32 Validation'), 'Pending validation lists physical ESP32');
assert.ok(html.includes('MQ-3 Calibration'), 'Pending validation lists MQ-3 Calibration');
assert.ok(html.includes('MQ-6 Calibration'), 'Pending validation lists MQ-6 Calibration');
assert.ok(css.includes('.public-trust-grid'), 'CSS contains public trust grid layout');

// 11. Test Sprint 5: Final CTA dual actions
assert.ok(html.includes('id="footer-demo-button"'), 'Footer contains primary demo button');
assert.ok(html.includes('href="#public-demo-section"'), 'Footer demo button links to public demo section');
assert.ok(html.includes('id="footer-login-button"'), 'Footer contains secondary login button');
assert.ok(css.includes('.public-footer-cta'), 'CSS contains footer CTA styles');

// 12. Test Sprint 5: Public Truthfulness Checks (No misleading hardware states)
const publicSectionHtml = html.split('<main id="public-content">')[1].split('</main>')[0];
assert.equal(publicSectionHtml.includes('Valve: OPEN'), false, 'Public landing does not state Valve: OPEN');
assert.equal(publicSectionHtml.includes('Valve: CLOSED'), false, 'Public landing does not state Valve: CLOSED');
assert.equal(publicSectionHtml.includes('Connection: ONLINE'), false, 'Public landing does not state Connection: ONLINE');
assert.equal(publicSectionHtml.includes('Sensor: Active'), false, 'Public landing does not state Sensor: Active');
assert.ok(publicSectionHtml.includes('Data Source: <strong>SIMULATION</strong>'), 'Hero preview footer displays simulation data source');

console.log('public landing tests passed');
