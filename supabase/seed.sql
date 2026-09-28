-- ==============================================================================
-- GasGuard demo seed (idempotent). Safe to run more than once.
-- Local:  applied automatically by `supabase db reset`.
-- Hosted: paste into Supabase Dashboard > SQL Editor and run once.
-- Creates the same demo topology the app uses: Restaurant A / Kitchen Area with
-- the real board ESP32-KITCHEN-01 and the virtual board SIM-ESP32-KITCHEN-01.
-- No users, passwords, or device secrets are created here.
-- ==============================================================================

insert into public.customers (id, name, customer_type)
values ('00000000-0000-4000-8000-000000000001', 'Demo Restaurant Co.', 'restaurant')
on conflict (id) do nothing;

insert into public.sites (id, customer_id, name, address_text, lifecycle_status)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Restaurant A', 'พื้นที่ตัวอย่าง', 'commissioning')
on conflict (id) do nothing;

insert into public.zones (id, site_id, name)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'Kitchen Area')
on conflict (id) do nothing;

insert into public.devices (id, site_id, zone_id, device_uid, device_type, lifecycle_status)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'ESP32-KITCHEN-01', 'esp32', 'commissioning'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'SIM-ESP32-KITCHEN-01', 'esp32', 'active')
on conflict (id) do nothing;

insert into public.sensors (device_id, sensor_uid, sensor_type)
values
  ('00000000-0000-4000-8000-000000000301', 'MQ6-01', 'mq6'),
  ('00000000-0000-4000-8000-000000000301', 'MQ3-01', 'mq3'),
  ('00000000-0000-4000-8000-000000000302', 'MQ6-01', 'mq6')
on conflict (device_id, sensor_uid) do nothing;

-- To let a signed-in user see Restaurant A, add a membership after creating the user:
-- insert into public.site_memberships (site_id, user_id, membership_type)
-- values ('00000000-0000-4000-8000-000000000101', '<auth user uuid>', 'owner');
