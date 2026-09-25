const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildStatic, publicAuthConfig, outputRoot } = require('../tools/build-static.js');

buildStatic({ env:{} });
for (const relative of ['index.html','css/app.css','js/app.js','js/auth-config.js','assets/gasguard-mascot.png']) {
  assert.equal(fs.existsSync(path.join(outputRoot, relative)), true, `static output contains ${relative}`);
}
for (const blocked of ['server','tools','tests','config','package.json','.git']) {
  assert.equal(fs.existsSync(path.join(outputRoot, blocked)), false, `static output excludes ${blocked}`);
}
const blankConfig = fs.readFileSync(path.join(outputRoot, 'js/auth-config.js'), 'utf8');
assert.ok(blankConfig.includes('SUPABASE_URL:""') && blankConfig.includes('SUPABASE_ANON_KEY:""'), 'missing hosted auth config remains explicitly unavailable');
const hostedConfig = publicAuthConfig({ GASGUARD_SUPABASE_URL:'https://demo.supabase.co', GASGUARD_SUPABASE_ANON_KEY:'public-anon-test-value' });
assert.ok(hostedConfig.includes('https://demo.supabase.co') && hostedConfig.includes('public-anon-test-value'), 'public hosted auth config can be injected at build time');
assert.throws(() => publicAuthConfig({ GASGUARD_SUPABASE_ANON_KEY:'service_role-secret' }), /Refusing to publish/, 'secret keys cannot enter frontend output');
assert.equal(/GASGUARD_(REAL|TEST)_DEVICE_KEY/.test(hostedConfig), false, 'device credentials are never emitted');
const app = fs.readFileSync('js/app.js', 'utf8');
assert.equal(/[A-Z]:\\/.test(app), false, 'frontend runtime has no Windows absolute path');
console.log('deployment readiness tests passed');
