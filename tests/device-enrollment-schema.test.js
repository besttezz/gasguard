const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260926200000_device_enrollment_storage.sql');
assert.ok(fs.existsSync(migrationPath), 'Device enrollment storage migration file must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Private schema creation allows IF NOT EXISTS
assert.ok(/create\s+schema\s+if\s+not\s+exists\s+private;/i.test(sql), 'private schema creation must use IF NOT EXISTS for schema sharing');

// 2. CREATE TABLE must NOT use IF NOT EXISTS (fail on object drift)
assert.ok(!/create\s+table\s+if\s+not\s+exists\s+private\.device_enrollment_tokens/i.test(sql), 'CREATE TABLE device_enrollment_tokens must NOT use IF NOT EXISTS');
assert.ok(!/create\s+table\s+if\s+not\s+exists\s+private\.device_credentials/i.test(sql), 'CREATE TABLE device_credentials must NOT use IF NOT EXISTS');

// 3. Exactly TWO tables created: private.device_enrollment_tokens and private.device_credentials
const createTableMatches = [...sql.matchAll(/create\s+table\s+([a-z0-9_\.]+)/gi)];
const tableNames = createTableMatches.map(m => m[1]);
assert.equal(tableNames.length, 2, 'Exactly TWO tables must be created in this migration');
assert.deepEqual(tableNames.sort(), ['private.device_credentials', 'private.device_enrollment_tokens'].sort(), 'Created tables must be private.device_enrollment_tokens and private.device_credentials');

// 4. No public enrollment or device credential tables created
assert.ok(!/create\s+table[\s\S]*?public\.device_enrollment/i.test(sql), 'public.device_enrollment must NOT be created');
assert.ok(!/create\s+table[\s\S]*?public\.device_credentials/i.test(sql), 'public.device_credentials must NOT be created');

// Extract CREATE TABLE blocks
const tokensTableMatch = sql.match(/create\s+table\s+private\.device_enrollment_tokens[\s\S]*?\);/i);
assert.ok(tokensTableMatch, 'CREATE TABLE private.device_enrollment_tokens block must exist');
const tokensSql = tokensTableMatch[0];

const credsTableMatch = sql.match(/create\s+table\s+private\.device_credentials[\s\S]*?\);/i);
assert.ok(credsTableMatch, 'CREATE TABLE private.device_credentials block must exist');
const credsSql = credsTableMatch[0];

// 5. device_enrollment_tokens references public.devices and public.installation_jobs
assert.ok(/device_id\s+uuid\s+not\s+null\s+references\s+public\.devices\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(tokensSql), 'device_id must reference public.devices(id) ON DELETE CASCADE');
assert.ok(/installation_job_id\s+uuid\s+not\s+null\s+references\s+public\.installation_jobs\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(tokensSql), 'installation_job_id must reference public.installation_jobs(id) ON DELETE CASCADE');

// 6. token_hash is text NOT NULL UNIQUE
assert.ok(/token_hash\s+text\s+not\s+null\s+unique/i.test(tokensSql), 'token_hash must be text NOT NULL UNIQUE');

// 7. token_hash constraint requires EXACTLY 64 lowercase hex characters
assert.ok(/token_hash\s*~\s*'^\^\[0-9a-f\]\{64\}\$'/i.test(tokensSql) || /token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(tokensSql), 'token_hash constraint must enforce exactly 64 lowercase hex characters');

// 8. Allowed token statuses are EXACTLY pending, claimed, revoked, expired
const tokenStatusMatch = tokensSql.match(/status\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*,\s*'revoked'\s*,\s*'expired'\s*\)/i);
assert.ok(tokenStatusMatch, 'Allowed token statuses must be EXACTLY pending, claimed, revoked, expired');

// 9. Default token status is pending
assert.ok(/status\s+text\s+not\s+null\s+default\s+'pending'/i.test(tokensSql), 'Default token status must be pending');

// 10. expires_at > created_at
assert.ok(/expires_at\s*>\s*created_at/i.test(tokensSql), 'Constraint must enforce expires_at > created_at');

// 11. claimed status requires claimed_at IS NOT NULL
assert.ok(/status\s*!=\s*'claimed'\s+or\s+claimed_at\s+is\s+not\s+null/i.test(tokensSql), 'Constraint must require claimed_at IS NOT NULL when status is claimed');

// 12. created_by_user_id references auth.users(id) ON DELETE SET NULL
assert.ok(/created_by_user_id\s+uuid\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(tokensSql), 'created_by_user_id must reference auth.users(id) ON DELETE SET NULL');

// 13. device_credentials references public.devices
assert.ok(/device_id\s+uuid\s+not\s+null\s+references\s+public\.devices\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(credsSql), 'device_id in device_credentials must reference public.devices(id) ON DELETE CASCADE');

// 14. credential_hash is text NOT NULL UNIQUE and 64 hex characters
assert.ok(/credential_hash\s+text\s+not\s+null\s+unique/i.test(credsSql), 'credential_hash must be text NOT NULL UNIQUE');
assert.ok(/credential_hash\s*~\s*'^\^\[0-9a-f\]\{64\}\$'/i.test(credsSql) || /credential_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(credsSql), 'credential_hash constraint must enforce exactly 64 lowercase hex characters');

// 15. Credential statuses are EXACTLY active, revoked
const credStatusMatch = credsSql.match(/status\s+in\s*\(\s*'active'\s*,\s*'revoked'\s*\)/i);
assert.ok(credStatusMatch, 'Allowed credential statuses must be EXACTLY active, revoked');

// 16. Default credential status is active
assert.ok(/status\s+text\s+not\s+null\s+default\s+'active'/i.test(credsSql), 'Default credential status must be active');

// 17. Revoked credential requires revoked_at
assert.ok(/status\s*!=\s*'revoked'\s+or\s+revoked_at\s+is\s+not\s+null/i.test(credsSql), 'Constraint must require revoked_at IS NOT NULL when status is revoked');

// 18. Partial unique active credential per device exists
assert.ok(/create\s+unique\s+index\s+idx_device_credentials_active_unique\s+on\s+private\.device_credentials\s*\(\s*device_id\s*\)\s+where\s+status\s*=\s*'active'/i.test(sql), 'Partial unique index for active device credentials must exist');

// 19. updated_at triggers exist for both
assert.ok(/trigger\s+handle_updated_at_private_device_enrollment_tokens/i.test(sql), 'updated_at trigger must exist for device_enrollment_tokens');
assert.ok(/trigger\s+handle_updated_at_private_device_credentials/i.test(sql), 'updated_at trigger must exist for device_credentials');

// 20. RLS enabled for both
assert.ok(/alter\s+table\s+private\.device_enrollment_tokens\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS must be enabled on device_enrollment_tokens');
assert.ok(/alter\s+table\s+private\.device_credentials\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS must be enabled on device_credentials');

// 21. Zero CREATE POLICY statements in migration
assert.ok(!/create\s+policy/i.test(sql), 'No CREATE POLICY statements allowed in this migration');

// 22. Privileges explicitly revoked
assert.ok(/revoke\s+all\s+on\s+table\s+private\.device_enrollment_tokens\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'Privileges on device_enrollment_tokens must be revoked');
assert.ok(/revoke\s+all\s+on\s+table\s+private\.device_credentials\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'Privileges on device_credentials must be revoked');

// 23 & 24. No raw token or raw key columns
const forbiddenRawCols = /\b(raw_token|plaintext_token|token_plaintext|device_key|api_key|plaintext_key|secret_key|password)\b/i;
assert.ok(!forbiddenRawCols.test(sql), 'No raw token, raw key, or password columns allowed');

// 25. No hard-coded UUIDs
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'No hardcoded UUIDs allowed');

// 26 & 27. No issuance or claim RPC functions created in migration
const forbiddenRPCs = /\b(issue_device_enrollment_token|claim_device_enrollment_token|enroll_device|verify_device_token)\b/i;
assert.ok(!forbiddenRPCs.test(sql), 'No token issuance or claim functions allowed in HW-3A migration');

// 28. No Edge Function / HTTP endpoint added in migration
assert.ok(!/\b(fetch|http|express|router|app\.post)\b/i.test(sql), 'No HTTP endpoint definitions allowed in SQL migration');

// 29. Owner invitations untouched in migration
assert.ok(!/owner_invitations/i.test(sql), 'owner_invitations schema must remain untouched in this migration');

// 30. Documentation file exists and verifies HW-3A maturity & architecture
const docPath = path.join(root, 'docs', 'DEVICE_ENROLLMENT_MODEL.md');
assert.ok(fs.existsSync(docPath), 'docs/DEVICE_ENROLLMENT_MODEL.md must exist');
const docText = fs.readFileSync(docPath, 'utf8');
assert.ok(docText.includes('private.device_enrollment_tokens'), 'Documentation must reference private.device_enrollment_tokens');
assert.ok(docText.includes('private.device_credentials'), 'Documentation must reference private.device_credentials');

console.log('device enrollment storage schema contract tests passed!');
