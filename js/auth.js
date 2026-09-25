(function (root, factory) {
  'use strict';
  const auth = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = auth;
  else root.GasGuardAuth = auth;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const VALID_ROLES = Object.freeze(['general', 'technician', 'developer', 'admin']);
  let client = null;
  let session = null;
  let authSubscription = null;

  const authError = (code, message) => Object.assign(new Error(message), { code });
  const validRole = role => VALID_ROLES.includes(role) ? role : null;
  const roleFromUser = user => validRole(user?.app_metadata?.role);
  function jwtRole(key) {
    try {
      const payload = key.split('.')[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decode = typeof root.atob === 'function' ? root.atob.bind(root) : value => Buffer.from(value, 'base64').toString('utf8');
      return JSON.parse(decode(normalized)).role || null;
    } catch (error) { return null; }
  }
  const isUnsafeClientKey = key => /^sb_secret_/i.test(key) || /service_role/i.test(key) || jwtRole(key) === 'service_role';

  function configuration() {
    const config = root.GASGUARD_AUTH_CONFIG || {};
    const url = String(config.SUPABASE_URL || '').trim();
    const key = String(config.SUPABASE_ANON_KEY || '').trim();
    if (!url || !key) throw authError('config_missing', 'ยังไม่ได้ตั้งค่า Supabase URL และ public anon key');
    if (isUnsafeClientKey(key)) throw authError('unsafe_key', 'ห้ามใช้ Supabase secret/service_role key ใน browser');
    return { url, key };
  }

  async function initialize(onChange) {
    if (!root.supabase?.createClient) throw authError('sdk_unavailable', 'โหลด Supabase Auth client ไม่สำเร็จ');
    const { url, key } = configuration();
    client = root.supabase.createClient(url, key, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    if (authSubscription) authSubscription.unsubscribe();
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null;
      if (typeof onChange === 'function') onChange(event, session);
    });
    authSubscription = data.subscription;
    const result = await client.auth.getSession();
    if (result.error) throw result.error;
    session = result.data.session || null;
    return session;
  }

  async function signIn(email, password) {
    if (!client) throw authError('not_initialized', 'Auth ยังไม่พร้อมใช้งาน');
    const result = await client.auth.signInWithPassword({ email:String(email || '').trim(), password:String(password || '') });
    if (result.error) throw result.error;
    session = result.data.session || null;
    return { session, user:result.data.user || session?.user || null, role:roleFromUser(result.data.user || session?.user) };
  }

  async function signOut() {
    if (!client) return;
    const result = await client.auth.signOut({ scope:'local' });
    if (result.error) throw result.error;
    session = null;
  }

  async function getSession() {
    if (!client) return null;
    const result = await client.auth.getSession();
    if (result.error) throw result.error;
    session = result.data.session || null;
    return session;
  }

  async function getCurrentUser() {
    if (!client || !session) return null;
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    return result.data.user || null;
  }

  function getRole(user) {
    return roleFromUser(user || session?.user || null);
  }

  return Object.freeze({ VALID_ROLES, validRole, roleFromUser, isUnsafeClientKey, initialize, signIn, signOut, getSession, getCurrentUser, getRole });
});
