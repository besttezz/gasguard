const assert = require('node:assert/strict');
const auth = require('../js/auth.js');

assert.equal(auth.validRole('general'), 'general');
assert.equal(auth.validRole('technician'), 'technician');
assert.equal(auth.validRole('developer'), 'developer');
assert.equal(auth.validRole('admin'), 'admin');
assert.equal(auth.validRole(undefined), null);
assert.equal(auth.roleFromUser({ app_metadata:{ role:'technician' } }), 'technician');
assert.equal(auth.roleFromUser({ app_metadata:{ role:'admin' } }), 'admin');
assert.equal(auth.roleFromUser({ user_metadata:{ role:'developer' } }), null, 'user metadata cannot grant a role');
assert.equal(auth.validRole('owner'), null, 'unsupported role remains denied');
assert.equal(auth.isUnsafeClientKey('sb_secret_example'), true);
assert.equal(auth.isUnsafeClientKey('sb_publishable_example'), false);
const servicePayload = Buffer.from(JSON.stringify({ role:'service_role' })).toString('base64url');
assert.equal(auth.isUnsafeClientKey(`header.${servicePayload}.signature`), true, 'legacy service_role JWT is rejected');

(async () => {
  const restoredUser = { id:'user-1', email:'general@example.invalid', app_metadata:{ role:'general' } };
  const restoredSession = { user:restoredUser, access_token:'test-token' };
  let signOutOptions = null;
  globalThis.GASGUARD_AUTH_CONFIG = { SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'sb_publishable_test' };
  globalThis.supabase = { createClient:() => ({ auth:{
    onAuthStateChange:callback => { callback('INITIAL_SESSION', restoredSession); return { data:{ subscription:{ unsubscribe() {} } } }; },
    getSession:async () => ({ data:{ session:restoredSession }, error:null }),
    getUser:async () => ({ data:{ user:restoredUser }, error:null }),
    signOut:async options => { signOutOptions=options; return { error:null }; }
  } }) };

  const session = await auth.initialize();
  assert.equal(session, restoredSession, 'initialize restores the persisted Supabase session');
  assert.equal(auth.getRole(await auth.getCurrentUser()), 'general');
  await auth.signOut();
  assert.deepEqual(signOutOptions, { scope:'local' }, 'logout clears the current browser session');
  console.log('auth tests passed');
})().catch(error => { console.error(error); process.exitCode=1; });
