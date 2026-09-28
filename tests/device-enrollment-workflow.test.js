const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../server/device-enrollment.js');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260926213000_device_enrollment_workflow.sql');
assert.ok(fs.existsSync(migrationPath), 'Device enrollment workflow migration file must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Verify issue_device_enrollment_token function static contract
assert.ok(/create\s+or\s+replace\s+function\s+public\.issue_device_enrollment_token/i.test(sql), 'issue_device_enrollment_token function must be defined');
assert.ok(/security\s+definer/i.test(sql), 'Functions must use SECURITY DEFINER');
assert.ok(/set\s+search_path\s*=\s*''/i.test(sql), 'Functions must set search_path = \'\'');

// Grants & Revokes for issue_device_enrollment_token
assert.ok(/revoke\s+execute\s+on\s+function\s+public\.issue_device_enrollment_token[\s\S]*?from\s+public,\s*anon/i.test(sql), 'issue function EXECUTE must be revoked from public and anon');
assert.ok(/grant\s+execute\s+on\s+function\s+public\.issue_device_enrollment_token[\s\S]*?to\s+authenticated/i.test(sql), 'issue function EXECUTE must be granted to authenticated');

// 2. Authorization & Checks in issue function
assert.ok(sql.includes("auth.jwt() -> 'app_metadata' ->> 'role'"), 'Checks app_metadata role from auth.jwt()');
assert.ok(sql.includes("('technician', 'admin')"), 'Allows only technician and admin roles');
assert.ok(sql.includes('public.job_assignments'), 'Verifies technician job assignment');
assert.ok(sql.includes('v_device_site_id != v_job_site_id'), 'Verifies strict Site Binding (device.site_id == job.site_id)');
assert.ok(sql.includes("lifecycle_status != 'registered'"), 'Verifies device lifecycle_status is registered');
assert.ok(sql.includes("job_type != 'installation'"), 'Verifies job_type is installation');
assert.ok(sql.includes("job_status not in ('scheduled', 'in_progress')"), 'Verifies job status is scheduled or in_progress');
assert.ok(sql.includes('for update'), 'Uses FOR UPDATE row locking');
assert.ok(sql.includes("status = 'revoked'"), 'Revokes existing pending tokens before inserting new one');

// 3. Verify claim_device_enrollment function static contract
assert.ok(/create\s+or\s+replace\s+function\s+public\.claim_device_enrollment/i.test(sql), 'claim_device_enrollment function must be defined');

// Grants & Revokes for claim_device_enrollment
assert.ok(/revoke\s+execute\s+on\s+function\s+public\.claim_device_enrollment[\s\S]*?from\s+public,\s*anon,\s*authenticated/i.test(sql), 'claim function EXECUTE must be revoked from public, anon, AND authenticated');
assert.ok(/grant\s+execute\s+on\s+function\s+public\.claim_device_enrollment[\s\S]*?to\s+service_role/i.test(sql), 'claim function EXECUTE must be granted ONLY to service_role');

// Checks in claim function
assert.ok(sql.includes('^[0-9a-fA-F]{64}$'), 'Requires 64 hex character token format validation via regex');
assert.ok(sql.includes('extensions.digest'), 'Computes SHA-256 digest using extensions.digest');
assert.ok(sql.includes('ENROLLMENT_ALREADY_CLAIMED'), 'Checks claimed token error');
assert.ok(sql.includes('ENROLLMENT_EXPIRED'), 'Checks expired token status');
assert.ok(!sql.includes("set status = 'expired'"), 'Does not pretend to persist status=expired before exception rollback');
assert.ok(sql.includes('ACTIVE_CREDENTIAL_EXISTS'), 'Prevents claim if active credential already exists');
assert.ok(sql.includes("lifecycle_status = 'commissioning'"), 'Transitions device lifecycle to commissioning');
assert.ok(sql.includes("status = 'claimed'"), 'Marks token status as claimed with claimed_at timestamp');

// 4. Crypto and Secret Redaction Tests
const validRawToken = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
assert.equal(service.validateRawTokenFormat(validRawToken), true);
assert.equal(service.validateRawTokenFormat('INVALID_SHORT_TOKEN'), false);
assert.equal(service.validateRawTokenFormat('z'.repeat(64)), false);

const hashed = service.hashToken(validRawToken);
assert.equal(hashed.length, 64);
assert.equal(/^[0-9a-f]{64}$/.test(hashed), true);

// Test recursive secret redaction
const nestedData = {
  data: {
    raw_enrollment_token: validRawToken,
    result: {
      raw_device_credential: 'a'.repeat(64),
      token_hash: hashed,
      device_id: 'dev-123'
    }
  }
};
const redacted = service.redactEnrollmentSecrets(nestedData);
assert.equal(redacted.data.raw_enrollment_token, '[REDACTED]');
assert.equal(redacted.data.result.raw_device_credential, '[REDACTED]');
assert.equal(redacted.data.result.token_hash, '[REDACTED]');
assert.equal(redacted.data.result.device_id, 'dev-123');

// Test error normalization
const knownErr = new Error('ENROLLMENT_EXPIRED: Token has expired');
const normKnown = service.normalizeEnrollmentError(knownErr);
assert.equal(normKnown.code, 'ENROLLMENT_EXPIRED');
assert.equal(normKnown.error, 'Token has expired');

const dbSecretErr = new Error('pg_catalog.devices_site_id_fkey constraint violation in schema public');
const normSecret = service.normalizeEnrollmentError(dbSecretErr);
assert.equal(normSecret.code, 'INTERNAL_ENROLLMENT_ERROR');
assert.equal(normSecret.error, 'An internal enrollment error occurred');

console.log('device enrollment workflow static contract & service tests passed!');
