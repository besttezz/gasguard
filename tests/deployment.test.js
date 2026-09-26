const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildStatic, publicAuthConfig, outputRoot } = require('../tools/build-static.js');
const { buildCloudflare } = require('../tools/build-cloudflare.js');

// 1. Standard build works
buildStatic({ env: {} });

// 2. Stale dist file removal verification
const staleFilePath = path.join(outputRoot, 'stale-test-file.tmp');
fs.writeFileSync(staleFilePath, 'stale data', 'utf8');
assert.ok(fs.existsSync(staleFilePath), 'stale file created');
buildStatic({ env: {} });
assert.equal(fs.existsSync(staleFilePath), false, 'stale dist files are removed before build');

// Surface verification
for (const relative of ['index.html', 'css/app.css', 'js/app.js', 'js/auth-config.js', 'assets/gasguard-mascot.png', '_headers']) {
  assert.equal(fs.existsSync(path.join(outputRoot, relative)), true, `static output contains ${relative}`);
}
for (const blocked of ['server', 'tools', 'tests', 'config', 'package.json', '.git', '.env', '.env.local']) {
  assert.equal(fs.existsSync(path.join(outputRoot, blocked)), false, `static output excludes ${blocked}`);
}

const blankConfig = fs.readFileSync(path.join(outputRoot, 'js/auth-config.js'), 'utf8');
assert.ok(blankConfig.includes('SUPABASE_URL:""') && blankConfig.includes('SUPABASE_ANON_KEY:""'), 'missing hosted auth config remains explicitly unavailable in static build');

// 3. build:cloudflare rejects missing GASGUARD_SUPABASE_URL
assert.throws(
  () => buildCloudflare({ env: { GASGUARD_SUPABASE_ANON_KEY: 'sb_publishable_fake123' } }),
  /GASGUARD_SUPABASE_URL is missing or invalid/,
  'build:cloudflare rejects missing GASGUARD_SUPABASE_URL'
);

// 4. build:cloudflare rejects missing GASGUARD_SUPABASE_ANON_KEY
assert.throws(
  () => buildCloudflare({ env: { GASGUARD_SUPABASE_URL: 'https://fake.supabase.co' } }),
  /GASGUARD_SUPABASE_ANON_KEY is missing or invalid/,
  'build:cloudflare rejects missing GASGUARD_SUPABASE_ANON_KEY'
);

// 5. Invalid / non-HTTPS hosted URL rejected
assert.throws(
  () => buildCloudflare({ env: { GASGUARD_SUPABASE_URL: 'http://fake.supabase.co', GASGUARD_SUPABASE_ANON_KEY: 'sb_publishable_fake123' } }),
  /GASGUARD_SUPABASE_URL is missing or invalid/,
  'non-HTTPS hosted URL is rejected'
);

assert.throws(
  () => buildCloudflare({ env: { GASGUARD_SUPABASE_URL: 'invalid-url-format', GASGUARD_SUPABASE_ANON_KEY: 'sb_publishable_fake123' } }),
  /GASGUARD_SUPABASE_URL is missing or invalid/,
  'malformed hosted URL is rejected'
);

// 6. Safe fake public key is accepted
const fakeUrl = 'https://fake-project-ref.supabase.co';
const fakeAnonKey = 'sb_publishable_fake_anon_key_12345';
const hostedConfig = publicAuthConfig({ GASGUARD_SUPABASE_URL: fakeUrl, GASGUARD_SUPABASE_ANON_KEY: fakeAnonKey }, true);
assert.ok(hostedConfig.includes(fakeUrl) && hostedConfig.includes(fakeAnonKey), 'public hosted auth config can be injected at build time');

// 7. sb_secret_* rejected
assert.throws(
  () => publicAuthConfig({ GASGUARD_SUPABASE_URL: fakeUrl, GASGUARD_SUPABASE_ANON_KEY: 'sb_secret_fake_service_role' }, true),
  /Refusing to publish/,
  'sb_secret_* rejected'
);

// 8. Literal service_role secret rejected
assert.throws(
  () => publicAuthConfig({ GASGUARD_SUPABASE_URL: fakeUrl, GASGUARD_SUPABASE_ANON_KEY: 'service_role-secret-key' }, true),
  /Refusing to publish/,
  'literal service_role rejected'
);

// 9. JWT-style key with payload role = 'service_role' rejected
function createFakeJwt(payloadObj) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  return `${header}.${payload}.fake_signature`;
}

const fakeServiceRoleJwt = createFakeJwt({ role: 'service_role', sub: '123' });
assert.throws(
  () => publicAuthConfig({ GASGUARD_SUPABASE_URL: fakeUrl, GASGUARD_SUPABASE_ANON_KEY: fakeServiceRoleJwt }, true),
  /Refusing to publish/,
  'JWT service_role key rejected'
);

// 10. Generated auth-config.js contains supplied FAKE public URL & key
buildCloudflare({ env: { GASGUARD_SUPABASE_URL: fakeUrl, GASGUARD_SUPABASE_ANON_KEY: fakeAnonKey } });
const generatedConfig = fs.readFileSync(path.join(outputRoot, 'js/auth-config.js'), 'utf8');
assert.ok(generatedConfig.includes(fakeUrl) && generatedConfig.includes(fakeAnonKey), 'generated auth-config.js contains fake URL and key');

// 11. No device key emitted
assert.equal(/GASGUARD_(REAL|TEST)_DEVICE_KEY/.test(generatedConfig), false, 'device credentials are never emitted');

// 12. No server code emitted
assert.equal(fs.existsSync(path.join(outputRoot, 'server')), false, 'server code is never emitted');

// 13. No env files emitted
assert.equal(fs.existsSync(path.join(outputRoot, '.env')), false, '.env is never emitted');
assert.equal(fs.existsSync(path.join(outputRoot, '.env.local')), false, '.env.local is never emitted');

// 14. Dist surface clean & headers present
assert.equal(fs.existsSync(path.join(outputRoot, '_headers')), true, '_headers present in dist');

const app = fs.readFileSync('js/app.js', 'utf8');
assert.equal(/[A-Z]:\\/.test(app), false, 'frontend runtime has no Windows absolute path');

// Dev server health check integration
const { createDevServer } = require('../server/dev-server.js');
const http = require('node:http');

(async () => {
  const devServer = createDevServer({
    env: {
      GASGUARD_PORT: '5599',
      GASGUARD_HOST: '127.0.0.1',
      GASGUARD_SUPABASE_URL: 'https://dev.supabase.co',
      GASGUARD_SUPABASE_ANON_KEY: 'sb_publishable_dev_key'
    }
  });

  await new Promise(resolve => devServer.listen(5599, '127.0.0.1', resolve));
  const port = devServer.address().port;

  const res = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/js/auth-config.js`, (r) => {
      let data = '';
      r.on('data', chunk => data += chunk);
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: data }));
    }).on('error', reject);
  });

  await new Promise(resolve => devServer.close(resolve));

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.body.includes('https://dev.supabase.co'));
  assert.ok(res.body.includes('sb_publishable_dev_key'));

  console.log('deployment readiness tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
