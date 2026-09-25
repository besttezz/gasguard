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

console.log('public landing tests passed');
