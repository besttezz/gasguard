'use strict';
// Issue a device credential for the cloud ingress without the key ever touching the repo or the database.
//   node tools/new-device-key.js ESP32-KITCHEN-01
// Prints the raw 64-hex key (give it to the device owner privately) and SQL that stores only its
// SHA-256 hash, revoking any previous active key for that device. Run the SQL in Supabase SQL Editor.
const crypto = require('node:crypto');

const deviceUid = String(process.argv[2] || '').trim();
if (!/^[A-Za-z0-9._-]{1,64}$/.test(deviceUid)) {
  console.error('Usage: node tools/new-device-key.js <DEVICE_UID>   e.g. ESP32-KITCHEN-01');
  process.exit(1);
}

const rawKey = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
const uid = deviceUid.replace(/'/g, "''");

console.log(`
=== DEVICE KEY for ${deviceUid} (secret: send privately, do not commit) ===
${rawKey}

=== SQL: paste into Supabase > SQL Editor > Run ===
update private.device_credentials
   set status = 'revoked', revoked_at = now()
 where status = 'active'
   and device_id = (select id from public.devices where device_uid = '${uid}');

insert into private.device_credentials (device_id, credential_hash)
select id, '${hash}' from public.devices where device_uid = '${uid}';

select d.device_uid, d.lifecycle_status, c.status, c.created_at
  from private.device_credentials c join public.devices d on d.id = c.device_id
 where d.device_uid = '${uid}' order by c.created_at desc limit 1;
`);
