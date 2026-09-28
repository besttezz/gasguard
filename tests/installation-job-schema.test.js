const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260926120000_installation_jobs_schema.sql');
assert.ok(fs.existsSync(migrationPath), 'Installation jobs migration file must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Exactly 2 new tables
const createTableMatches = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi)];
const tableNames = createTableMatches.map(m => m[1]);

assert.equal(tableNames.length, 2, 'Exactly 2 public tables must be created in this migration');
assert.deepEqual(tableNames.sort(), ['installation_jobs', 'job_assignments'].sort(), 'Table list must match installation_jobs and job_assignments');

// 2. Foreign keys
assert.ok(/site_id\s+uuid\s+not\s+null\s+references\s+public\.sites/i.test(sql), 'installation_jobs.site_id must reference public.sites');
assert.ok(/job_id\s+uuid\s+not\s+null\s+references\s+public\.installation_jobs/i.test(sql), 'job_assignments.job_id must reference public.installation_jobs');
assert.ok(/technician_user_id\s+uuid\s+not\s+null\s+references\s+auth\.users/i.test(sql), 'job_assignments.technician_user_id must reference auth.users');

// 3. Allowed enum check constraints
assert.ok(/job_type\s+in\s*\(\s*'installation'\s*,\s*'service'\s*\)/i.test(sql), 'Allowed job types must be installation, service');
assert.ok(/status\s+in\s*\(\s*'scheduled'\s*,\s*'in_progress'\s*,\s*'blocked'\s*,\s*'completed'\s*,\s*'cancelled'\s*\)/i.test(sql), 'Allowed job statuses must match scheduled, in_progress, blocked, completed, cancelled');
assert.ok(/assignment_status\s+in\s*\(\s*'assigned'\s*,\s*'accepted'\s*,\s*'completed'\s*,\s*'cancelled'\s*\)/i.test(sql), 'Allowed assignment statuses must match assigned, accepted, completed, cancelled');

// 4. No platform role column in job_assignments
const jobAssignmentsBlock = sql.substring(sql.indexOf('create table public.job_assignments'), sql.indexOf('create trigger tr_validate_job_assignment'));
assert.ok(!/role\s+text/i.test(jobAssignmentsBlock), 'Platform role column must not exist in job_assignments');

// 5. RLS enabled on both tables
assert.ok(/alter\s+table\s+public\.installation_jobs\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS must be enabled on installation_jobs');
assert.ok(/alter\s+table\s+public\.job_assignments\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS must be enabled on job_assignments');

// 6. No anon policies
assert.ok(!/to\s+anon\b/i.test(sql), 'No anon access policies allowed');

// 7. General job read requires platform role = 'general' AND active site membership
assert.ok(/create\s+policy\s+"installation_jobs_select_general"\s+on\s+public\.installation_jobs/i.test(sql), 'General job SELECT policy must exist');
assert.ok(/role['"]?\s*\)?\s*=\s*'general'/i.test(sql), 'General job SELECT policy must explicitly require role = general');
assert.ok(/sm\.status\s*=\s*'active'/i.test(sql), 'General job SELECT must check active site membership status');

// 8. Technician job read requires platform role = 'technician' AND explicit non-cancelled job assignment
const techJobPolicy = sql.substring(sql.indexOf('policy "installation_jobs_select_technician"'), sql.indexOf('policy "installation_jobs_select_admin"'));
assert.ok(/role['"]?\s*\)?\s*=\s*'technician'/i.test(techJobPolicy), 'installation_jobs technician policy must explicitly require role = technician');
assert.ok(/ja\.technician_user_id\s*=\s*auth\.uid\(\)/i.test(techJobPolicy), 'installation_jobs technician policy must require matching job assignment');
assert.ok(/ja\.assignment_status\s+in\s*\(\s*'assigned'\s*,\s*'accepted'\s*,\s*'completed'\s*\)/i.test(techJobPolicy), 'installation_jobs technician policy must allow assigned, accepted, completed statuses only');
assert.ok(!/cancelled/i.test(techJobPolicy), 'Cancelled assignment status must NOT grant installation_jobs read access');

// 9. Technician job assignment read requires platform role = 'technician' AND own user_id (preserves history including cancelled)
const techAssignmentPolicy = sql.substring(sql.indexOf('policy "job_assignments_select_technician"'), sql.indexOf('policy "job_assignments_select_admin"'));
assert.ok(/role['"]?\s*\)?\s*=\s*'technician'/i.test(techAssignmentPolicy), 'job_assignments technician policy must explicitly require role = technician');
assert.ok(/technician_user_id\s*=\s*auth\.uid\(\)/i.test(techAssignmentPolicy), 'job_assignments technician policy must require own technician_user_id');
assert.ok(!/assignment_status/i.test(techAssignmentPolicy), 'job_assignments technician policy must NOT restrict assignment history by status');

// 10. Admin global SELECT policies exist
assert.ok(/create\s+policy\s+"installation_jobs_select_admin"\s+on\s+public\.installation_jobs/i.test(sql), 'Admin job SELECT policy must exist');
assert.ok(/create\s+policy\s+"job_assignments_select_admin"\s+on\s+public\.job_assignments/i.test(sql), 'Admin job assignment SELECT policy must exist');

// 11. Developer has no blanket access
assert.ok(!/role['"]?\s*\)?\s*=\s*'developer'/i.test(sql), 'developer must not have blanket access');

// 12. No browser write policies (trustworthy multiline regex check)
const writePolicyRegex = /create\s+policy[\s\S]*?for\s+(insert|update|delete|all)/gi;
assert.ok(!writePolicyRegex.test(sql), 'No browser write policy allowed');

// 13. Function security and trigger scope
assert.ok(/security\s+definer/i.test(sql), 'Validation function must be SECURITY DEFINER');
assert.ok(/set\s+search_path\s*=\s*''/i.test(sql), 'Validation trigger function must set empty search_path');
assert.ok(/revoke\s+execute\s+on\s+function\s+public\.validate_job_assignment_technician_role\(\)\s+from\s+public,\s*anon,\s*authenticated/i.test(sql), 'EXECUTE on validation trigger function must be revoked from public, anon, authenticated');
assert.ok(/before\s+insert\s+or\s+update\s+of\s+technician_user_id\s+on\s+public\.job_assignments/i.test(sql), 'Validation trigger must be BEFORE INSERT OR UPDATE OF technician_user_id');

// 14. No hardcoded secrets / UUIDs
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'No hardcoded UUIDs allowed');

console.log('installation job schema tests passed');
