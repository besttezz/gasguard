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
