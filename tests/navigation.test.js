const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/navigation.js', 'utf8'), context);
const navigation = context.window.GasGuardNavigation;

assert.equal(new Set(navigation.pageIds).size, navigation.pageIds.length, 'navigation page IDs are unique');
for (const role of ['general', 'technician', 'developer']) {
  assert.ok(navigation.landingFor(role), `${role} has a landing page`);
  assert.ok(navigation.canOpen(role, navigation.landingFor(role)), `${role} landing belongs to that role`);
  assert.equal(Math.min(4, navigation.primaryFor(role).length) + 1, 5, `${role} has four direct items and a More entry on mobile`);
}
assert.equal(navigation.canOpen('general', 'developer'), false, 'General cannot open developer dashboard');
assert.equal(navigation.canOpen('technician', 'settings'), false, 'Technician cannot open provider settings');
assert.equal(navigation.canOpen('developer', 'explorer'), true, 'Developer can open data explorer');
assert.equal(navigation.moreFor('technician').some(item => item.action === 'setup'), true, 'Technician More menu includes provisioning');

console.log('navigation tests passed');
