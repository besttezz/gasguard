const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/navigation.js', 'utf8'), context);
const navigation = context.window.GasGuardNavigation;
const pagesFor = role => Array.from(navigation.entriesFor(role), item => item.page).sort();

assert.deepEqual(pagesFor('general'), ['overview','alerts','events','locations','assistant','guide','reports','product'].sort());
assert.deepEqual(pagesFor('technician'), ['overview','alerts','events','live','devices','maintenance','replay','reports','setup','validation','product'].sort());
assert.deepEqual(pagesFor('developer'), ['overview','live','events','intelligence','validation','demo','spatial','devices','developer','explorer','settings','hardware-lab','product'].sort());
assert.deepEqual(pagesFor('admin'), ['admin-dashboard','overview','alerts','events','locations','devices','maintenance','reports','product'].sort());

assert.equal(navigation.canOpen('general', 'overview'), true);
assert.equal(navigation.canOpen('general', 'developer'), false);
assert.equal(navigation.canOpen('technician', 'maintenance'), true);
assert.equal(navigation.canOpen('developer', 'settings'), true);
assert.equal(navigation.resolvePage('general', 'developer'), 'overview', 'unauthorized general page redirects to landing');
assert.equal(navigation.resolvePage('technician', 'settings'), 'overview', 'unauthorized technician page redirects to landing');
assert.equal(navigation.resolvePage('developer', 'reports'), 'developer', 'unauthorized developer page redirects to developer landing');

assert.equal(new Set(navigation.pageIds).size, navigation.pageIds.length, 'navigation page IDs are unique');
for (const role of ['general', 'technician', 'developer', 'admin']) {
  assert.ok(navigation.landingFor(role), `${role} has a landing page`);
  assert.ok(navigation.canOpen(role, navigation.landingFor(role)), `${role} landing belongs to that role`);
  assert.equal(Math.min(4, navigation.primaryFor(role).length) + 1, 5, `${role} has four direct items and a More entry on mobile`);
}
assert.equal(navigation.canOpen('general', 'developer'), false, 'General cannot open developer dashboard');
assert.equal(navigation.canOpen('technician', 'settings'), false, 'Technician cannot open provider settings');
assert.equal(navigation.canOpen('developer', 'explorer'), true, 'Developer can open data explorer');
assert.equal(navigation.canOpen('developer', 'hardware-lab'), true, 'Developer can open hardware lab');
assert.equal(navigation.canOpen('general', 'hardware-lab'), false, 'General cannot open hardware lab');
assert.equal(navigation.canOpen('technician', 'hardware-lab'), false, 'Technician cannot open hardware lab');
assert.equal(navigation.landingFor('admin'), 'admin-dashboard');
assert.equal(navigation.canOpen('admin', 'admin-dashboard'), true);
for (const role of ['general','technician','developer']) assert.equal(navigation.canOpen(role, 'admin-dashboard'), false, `${role} cannot open admin dashboard`);
for (const role of ['general','technician','developer','admin']) assert.equal(navigation.canOpen(role, 'product'), true, `${role} can open product page`);
assert.equal(navigation.canOpen('admin', 'hardware-lab'), false, 'Admin cannot open developer hardware lab');
assert.equal(navigation.moreFor('technician').some(item => item.action === 'setup'), true, 'Technician More menu includes provisioning');

console.log('navigation tests passed');
