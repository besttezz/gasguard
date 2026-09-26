const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260926160000_owner_invitation_storage.sql');
assert.ok(fs.existsSync(migrationPath), 'Owner invitation migration file must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Private schema creation allows IF NOT EXISTS
assert.ok(/create\s+schema\s+if\s+not\s+exists\s+private;/i.test(sql), 'private schema creation must use IF NOT EXISTS for schema sharing');

// 2. CREATE TABLE must NOT use IF NOT EXISTS (fail on object drift)
assert.ok(/create\s+table\s+private\.owner_invitations\b/i.test(sql), 'CREATE TABLE must be strict without IF NOT EXISTS to fail on object drift');
assert.ok(!/create\s+table\s+if\s+not\s+exists\s+private\.owner_invitations/i.test(sql), 'CREATE TABLE must NOT use IF NOT EXISTS');

// 3. Exactly ONE table created: private.owner_invitations
const createTableMatches = [...sql.matchAll(/create\s+table\s+([a-z0-9_\.]+)/gi)];
const tableNames = createTableMatches.map(m => m[1]);
assert.equal(tableNames.length, 1, 'Exactly ONE table must be created in this migration');
assert.equal(tableNames[0], 'private.owner_invitations', 'The created table must be private.owner_invitations');

// 4. No public.owner_invitations table created
assert.ok(!/create\s+table[\s\S]*?public\.owner_invitations/i.test(sql), 'public.owner_invitations must NOT be created');

// Extract the CREATE TABLE block for precise structural checks
const tableBlockMatch = sql.match(/create\s+table\s+private\.owner_invitations[\s\S]*?\);/i);
assert.ok(tableBlockMatch, 'CREATE TABLE block must be present');
const tableSql = tableBlockMatch[0];

// 5. site_id references public.sites(id) with ON DELETE CASCADE
assert.ok(/site_id\s+uuid\s+not\s+null\s+references\s+public\.sites\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(tableSql), 'site_id must reference public.sites(id) ON DELETE CASCADE');

// 6. token_hash is text NOT NULL UNIQUE
assert.ok(/token_hash\s+text\s+not\s+null\s+unique/i.test(tableSql), 'token_hash must be text NOT NULL UNIQUE');

// 7. token_hash constraint requires EXACTLY 64 lowercase hex characters
assert.ok(/token_hash\s*~\s*'^\^\[0-9a-f\]\{64\}\$'/i.test(tableSql) || /token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(tableSql), 'token_hash constraint must enforce exactly 64 lowercase hex characters');

// 8. Allowed statuses are EXACTLY pending, claimed, revoked, expired
const statusCheckMatch = tableSql.match(/status\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*,\s*'revoked'\s*,\s*'expired'\s*\)/i);
assert.ok(statusCheckMatch, 'Allowed statuses must be EXACTLY pending, claimed, revoked, expired');

// 9. Default status is pending
assert.ok(/status\s+text\s+not\s+null\s+default\s+'pending'/i.test(tableSql), 'Default status must be pending');

// 10. expires_at is NOT NULL
assert.ok(/expires_at\s+timestamptz\s+not\s+null/i.test(tableSql), 'expires_at must be timestamptz NOT NULL');

// 11. Constraint enforces expires_at > created_at
assert.ok(/expires_at\s*>\s*created_at/i.test(tableSql), 'Constraint must enforce expires_at > created_at');

// 12. claimed status requires claimed_at IS NOT NULL
assert.ok(/status\s*!=\s*'claimed'\s+or\s+claimed_at\s+is\s+not\s+null/i.test(tableSql), 'Constraint must require claimed_at IS NOT NULL when status is claimed');

// 13 & 14. created_by_user_id and claimed_by_user_id reference auth.users(id) ON DELETE SET NULL
assert.ok(/created_by_user_id\s+uuid\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(tableSql), 'created_by_user_id must reference auth.users(id) ON DELETE SET NULL');
assert.ok(/claimed_by_user_id\s+uuid\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(tableSql), 'claimed_by_user_id must reference auth.users(id) ON DELETE SET NULL');

// 15. updated_at trigger uses public.handle_updated_at()
assert.ok(/execute\s+function\s+public\.handle_updated_at\(\)/i.test(sql), 'updated_at trigger must execute public.handle_updated_at()');

// 16. Explicit CREATE INDEX statements must NOT use IF NOT EXISTS (fail on object drift)
assert.ok(!/create\s+index\s+if\s+not\s+exists/i.test(sql), 'CREATE INDEX statements must NOT use IF NOT EXISTS to fail on object drift');
const indexMatches = [...sql.matchAll(/create\s+index\s+([a-z0-9_]+)\s+on\s+private\.owner_invitations\s*\(\s*([a-z0-9_]+)\s*\)/gi)];
const indexedColumns = indexMatches.map(m => m[2]);
assert.equal(indexedColumns.length, 3, 'Exactly 3 explicit indexes must be created on private.owner_invitations');
assert.deepEqual(indexedColumns.sort(), ['site_id', 'status', 'expires_at'].sort(), 'Indexed columns must be site_id, status, expires_at');

// 17. RLS enabled on private.owner_invitations
assert.ok(/alter\s+table\s+private\.owner_invitations\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS must be enabled on private.owner_invitations');

// 18. No CREATE POLICY statement exists for this table
assert.ok(!/create\s+policy/i.test(sql), 'No CREATE POLICY statements allowed in this migration');

// 19. Schema/table privileges are revoked from PUBLIC, anon, authenticated
assert.ok(/revoke\s+usage\s+on\s+schema\s+private\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'USAGE on schema private must be revoked from public, anon, authenticated');
assert.ok(/revoke\s+create\s+on\s+schema\s+private\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'CREATE on schema private must be revoked from public, anon, authenticated');
assert.ok(/revoke\s+all\s+on\s+table\s+private\.owner_invitations\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'Table privileges must be revoked from public, anon, authenticated');

// 20. No raw invitation credential fields exist
const forbiddenCredentialRegex = /\b(raw_token|plaintext_token|token_plaintext|invite_code|invitation_code|activation_code|claim_code)\b/i;
assert.ok(!forbiddenCredentialRegex.test(sql), 'No raw invitation credential fields allowed');

// 21. No password field
assert.ok(!/\b(password|password_hash)\b/i.test(sql), 'No password fields allowed');

// 22. No secret field
assert.ok(!/\b(secret|secret_key)\b/i.test(sql), 'No secret fields allowed');

// 23. No email field
assert.ok(!/\bemail\b/i.test(sql), 'No email field allowed');

// 24. No device credential fields
const forbiddenDeviceCredsRegex = /\b(device_secret|wifi_password|api_key|jwt|access_token|refresh_token)\b/i;
assert.ok(!forbiddenDeviceCredsRegex.test(sql), 'No device/API credential fields allowed');

// 25 & 26. No invitation issuance or claim functions/RPCs
const forbiddenFunctionsRegex = /\b(issue_owner_invitation|claim_owner_invitation|validate_owner_invitation|consume_owner_invitation|generate_invitation_token)\b/i;
assert.ok(!forbiddenFunctionsRegex.test(sql), 'No invitation RPC/function definitions allowed in Phase 6E-1');

// 27. No hard-coded UUIDs
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'No hardcoded UUIDs allowed');

// 28. No secret/token value embedded in SQL
assert.ok(!/'(?:[0-9a-f]{64}|secret[a-z0-9_]*|token[a-z0-9_]*)'/i.test(sql), 'No embedded secret or token values in SQL');

// 29. Documentation contract verification for Site lifecycle state accuracy
const docPath = path.join(__dirname, '..', 'docs', 'OWNER_INVITATION_MODEL.md');
assert.ok(fs.existsSync(docPath), 'Owner invitation documentation file must exist');
const docText = fs.readFileSync(docPath, 'utf8');

assert.ok(!/\bdraft\b/i.test(docText), 'Documentation must NOT reference unsupported site state: draft');
assert.ok(!/\binstalled\b/i.test(docText), 'Documentation must NOT reference unsupported site state: installed');
assert.ok(!/\bdecommissioned\b/i.test(docText), 'Documentation must NOT reference unsupported site state: decommissioned');

assert.ok(/\bcommissioned\b/i.test(docText), 'Documentation must reference locked site state: commissioned');
assert.ok(/\bunverified\b/i.test(docText), 'Documentation must reference locked site state: unverified');
assert.ok(/\bcommissioning\b/i.test(docText), 'Documentation must reference locked site state: commissioning');
assert.ok(/\bsuspended\b/i.test(docText), 'Documentation must reference locked site state: suspended');

console.log('owner invitation schema & documentation tests passed');
