-- ==============================================================================
-- Lean schema: 24 tables -> 10 (8 public + 2 private). Team decision, 28 Oct 2026.
-- Small side tables become columns of the table they describe; unused tables go.
--   profiles          + LINE link (was user_line_links) and the 6-digit link code (was private.line_link_codes)
--   sites             + customer name/type (customers), gas-care dates (site_settings),
--                       floor plan (floor_plans), weekly AI summary (ai_summaries)
--   devices           + latest status (device_status)
--   sensors           + Ro calibration (sensor_calibrations)
--   alert_episodes    + who acknowledged (alert_acks)
--   installation_jobs + the technician (job_assignments)
--   kept as they are: site_memberships, telemetry_readings (trimmed), private.site_invitations,
--                     private.device_credentials
--   dropped unused:   zones, safety_events, private.owner_invitations, private.device_enrollment_tokens
-- Every row was backed up first (.backups/2026-10-28-before-lean-schema.json, local only, not in git).
-- ==============================================================================

-- 1. NEW COLUMNS ------------------------------------------------------------------------
alter table public.profiles
  add column line_user_id text null unique check (line_user_id ~ '^U[0-9a-f]{32}$'),
  add column line_linked_at timestamptz null,
  add column line_code text null unique check (line_code ~ '^[0-9]{6}$'),
  add column line_code_expires_at timestamptz null;

alter table public.sites
  add column customer_name text null,
  add column site_type text not null default 'household' check (site_type in ('household', 'restaurant', 'other')),
  add column hose_installed_on date null,
  add column sensor_checked_on date null,
  -- An uploaded plan image is stored inline as a downscaled JPEG data URL; keep it bounded.
  add column floor_plan jsonb null check (floor_plan is null or (jsonb_typeof(floor_plan) = 'object'
    and jsonb_typeof(floor_plan -> 'pins') = 'array' and pg_column_size(floor_plan) <= 1500000)),
  add column ai_summary jsonb null; -- { summary, source: gemini|template, model, facts, created_at }

alter table public.devices
  add column last_seen_at timestamptz null,
  add column last_gas_ppm numeric(10,2) null,
  add column last_data_classification text null,
  add column last_calibration_status text null;

alter table public.sensors
  add column ro_kohm numeric(10,3) null check (ro_kohm is null or (ro_kohm > 0 and ro_kohm < 10000)),
  add column calibrated_at timestamptz null,
  add column calibrated_by uuid null references auth.users(id) on delete set null,
  add column calibration_notes text null check (calibration_notes is null or char_length(calibration_notes) <= 500);

alter table public.alert_episodes
  add column acks jsonb not null default '[]'::jsonb; -- [{ "user_id": uuid, "acked_at": timestamptz }]

alter table public.installation_jobs
  add column technician_user_id uuid null references auth.users(id) on delete set null,
  add column assigned_at timestamptz null,
  add column completed_at timestamptz null;
create index idx_installation_jobs_technician on public.installation_jobs(technician_user_id);

-- 2. COPY EXISTING DATA ---------------------------------------------------------------
update public.profiles p set line_user_id = l.line_user_id, line_linked_at = l.linked_at
  from public.user_line_links l where l.user_id = p.id;
update public.sites s set customer_name = c.name, site_type = c.customer_type
  from public.customers c where c.id = s.customer_id;
update public.sites s set hose_installed_on = x.hose_installed_on, sensor_checked_on = x.sensor_checked_on
  from public.site_settings x where x.site_id = s.id;
update public.sites s set floor_plan = f.plan from public.floor_plans f where f.site_id = s.id;
update public.sites s set ai_summary = jsonb_build_object('summary', a.summary, 'source', a.source, 'model', a.model,
    'facts', a.facts, 'created_at', a.created_at)
  from public.ai_summaries a where a.site_id = s.id;
update public.devices d set last_seen_at = x.last_seen_at, last_gas_ppm = x.gas_ppm,
    last_data_classification = x.data_classification, last_calibration_status = x.calibration_status
  from public.device_status x where x.device_id = d.id;
update public.sensors s set ro_kohm = c.ro_kohm, calibrated_at = c.measured_at, calibrated_by = c.measured_by, calibration_notes = c.notes
  from (select distinct on (device_id, sensor_uid) * from public.sensor_calibrations order by device_id, sensor_uid, measured_at desc) c
  where c.device_id = s.device_id and c.sensor_uid = s.sensor_uid;
update public.alert_episodes e set acks = coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'acked_at', a.acked_at) order by a.acked_at)
  from public.alert_acks a where a.episode_id = e.id), '[]'::jsonb);
update public.installation_jobs j set technician_user_id = a.technician_user_id, assigned_at = a.assigned_at, completed_at = a.completed_at
  from (select distinct on (job_id) * from public.job_assignments where assignment_status <> 'cancelled' order by job_id, assigned_at desc) a
  where a.job_id = j.id;

-- 3. ACCESS HELPERS (technicians: the job itself names them) -----------------------------
create or replace function public.can_view_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (select 1 from public.site_memberships sm where sm.site_id = p_site_id and sm.user_id = auth.uid() and sm.status = 'active')
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
      and exists (select 1 from public.installation_jobs j where j.site_id = p_site_id and j.technician_user_id = auth.uid()
        and j.status in ('scheduled', 'in_progress', 'blocked')));
$$;

create or replace function public.can_edit_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (select 1 from public.site_memberships sm where sm.site_id = p_site_id and sm.user_id = auth.uid()
      and sm.status = 'active' and sm.membership_type = 'owner')
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
      and exists (select 1 from public.installation_jobs j where j.site_id = p_site_id and j.technician_user_id = auth.uid()
        and j.status in ('scheduled', 'in_progress', 'blocked')));
$$;

-- 4. JOBS ------------------------------------------------------------------------------
drop policy if exists "installation_jobs_select_technician" on public.installation_jobs;
create policy "installation_jobs_select_technician" on public.installation_jobs for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'technician' and technician_user_id = auth.uid());

create or replace function public.validate_job_technician_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  if new.technician_user_id is null then return new; end if;
  select raw_app_meta_data ->> 'role' into v_role from auth.users where id = new.technician_user_id;
  if v_role is null or v_role <> 'technician' then
    raise exception 'User % is not a registered technician', new.technician_user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_job_technician_role() from public, anon, authenticated;
create trigger tr_installation_jobs_technician_role
  before insert or update of technician_user_id on public.installation_jobs
  for each row execute function public.validate_job_technician_role();

create or replace function public.set_job_progress(p_job_id uuid, p_status text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('in_progress', 'completed', 'blocked') then raise exception 'BAD_STATUS'; end if;
  if not (public.is_admin() or exists (select 1 from public.installation_jobs j where j.id = p_job_id
      and j.technician_user_id = auth.uid() and j.status in ('scheduled', 'in_progress', 'blocked'))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.installation_jobs set status = p_status,
    completed_at = case when p_status = 'completed' then now() else null end,
    notes = case when p_notes is null or p_notes = '' then notes else left(coalesce(notes || E'\n', '') || p_notes, 4000) end
  where id = p_job_id;
end;
$$;

-- 5. HOME WRITES (owners, admins and the technician on a live job) --------------------------
create or replace function public.save_floor_plan(p_site_id uuid, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_site(p_site_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.sites set floor_plan = p_plan where id = p_site_id;
end;
$$;

create or replace function public.save_site_care(p_site_id uuid, p_hose date, p_sensor date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_site(p_site_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.sites set hose_installed_on = p_hose, sensor_checked_on = p_sensor where id = p_site_id;
end;
$$;

-- The technician's Ro measurement for one sensor channel; registers the channel if it never reported yet.
create or replace function public.save_sensor_calibration(p_device_id uuid, p_sensor_uid text, p_ro_kohm numeric, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_site uuid; v_type text := lower(regexp_replace(coalesce(p_sensor_uid, ''), '-.*$', ''));
begin
  select site_id into v_site from public.devices where id = p_device_id;
  if v_site is null or not public.can_edit_site(v_site) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_type not in ('mq2', 'mq3', 'mq6') then raise exception 'BAD_SENSOR'; end if;
  insert into public.sensors (device_id, sensor_uid, sensor_type, ro_kohm, calibrated_at, calibrated_by, calibration_notes)
  values (p_device_id, p_sensor_uid, v_type, p_ro_kohm, now(), auth.uid(), nullif(p_notes, ''))
  on conflict (device_id, sensor_uid) do update set ro_kohm = excluded.ro_kohm, calibrated_at = excluded.calibrated_at,
    calibrated_by = excluded.calibrated_by, calibration_notes = excluded.calibration_notes;
end;
$$;

-- 6. ALERTS ---------------------------------------------------------------------------
create or replace function public.ack_alert(p_episode_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.alert_episodes e where e.id = p_episode_id and public.can_view_site(e.site_id)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.alert_episodes set acks = acks || jsonb_build_array(jsonb_build_object('user_id', auth.uid(), 'acked_at', now()))
  where id = p_episode_id and not acks @> jsonb_build_array(jsonb_build_object('user_id', auth.uid()));
end;
$$;

create or replace function public.evaluate_site_alert(p_device_uid text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid; v_site_name text; v_ppm numeric; v_level text; v_open public.alert_episodes%rowtype;
  v_prev text := 'safe'; v_event text := null; v_episode uuid; v_recipients jsonb := '[]'::jsonb;
begin
  select d.site_id, s.name into v_site, v_site_name from public.devices d join public.sites s on s.id = d.site_id where d.device_uid = p_device_uid;
  if v_site is null then return jsonb_build_object('ok', false); end if;

  select max(latest.gas_ppm) into v_ppm from (
    select distinct on (r.device_id, r.sensor_uid) r.gas_ppm
    from public.telemetry_readings r join public.devices d on d.id = r.device_id
    where d.site_id = v_site and r.received_at > now() - interval '30 seconds'
      and r.data_classification <> 'SYNTHETIC_HANDSHAKE' and r.gas_ppm is not null
    order by r.device_id, r.sensor_uid, r.received_at desc
  ) latest;
  if v_ppm is null then return jsonb_build_object('ok', true, 'event', null); end if;
  v_level := public.level_for_ppm(v_ppm);

  select * into v_open from public.alert_episodes where site_id = v_site and ended_at is null for update;
  if v_open.id is not null then v_prev := v_open.level; end if;

  if v_level = 'safe' then
    if v_open.id is not null then
      update public.alert_episodes set ended_at = now() where id = v_open.id;
      v_event := 'resolved'; v_episode := v_open.id;
    end if;
  elsif v_open.id is null then
    insert into public.alert_episodes (site_id, level, peak_level, peak_ppm) values (v_site, v_level, v_level, v_ppm) returning id into v_episode;
    v_event := 'raised';
  else
    v_episode := v_open.id;
    update public.alert_episodes set
      level = v_level,
      level_changed_at = case when v_level <> v_open.level then now() else level_changed_at end,
      peak_level = case when public.level_rank(v_level) > public.level_rank(v_open.peak_level) then v_level else peak_level end,
      peak_ppm = greatest(coalesce(peak_ppm, 0), v_ppm)
    where id = v_open.id;
    if public.level_rank(v_level) > public.level_rank(v_open.level) then v_event := 'raised'; end if;
  end if;

  if v_event is not null then
    select coalesce(jsonb_agg(p.line_user_id), '[]'::jsonb) into v_recipients
    from public.site_memberships sm join public.profiles p on p.id = sm.user_id
    where sm.site_id = v_site and sm.status = 'active' and p.line_user_id is not null
      and public.level_rank(case when v_event = 'resolved' then v_prev else v_level end) >= public.level_rank(sm.alert_min_level);
  end if;

  return jsonb_build_object('ok', true, 'event', v_event, 'level', v_level, 'previous', v_prev, 'ppm', v_ppm,
    'site_id', v_site, 'site_name', v_site_name, 'episode_id', v_episode, 'line_recipients', v_recipients);
end;
$$;

-- 7. LINE -----------------------------------------------------------------------------
-- Users may change their own name and theme only; the LINE columns are written by the functions below.
revoke update on public.profiles from authenticated;
grant update (display_name, theme) on public.profiles to authenticated;

create or replace function public.create_line_link_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.profiles set line_code = null, line_code_expires_at = null where line_code_expires_at < now();
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      update public.profiles set line_code = v_code, line_code_expires_at = now() + interval '15 minutes' where id = auth.uid();
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return v_code;
end;
$$;

create or replace function public.consume_line_link_code(p_code text, p_line_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  select id into v_user from public.profiles where line_code = p_code and line_code_expires_at > now() for update;
  if v_user is null then return jsonb_build_object('ok', false); end if;
  update public.profiles set line_user_id = null, line_linked_at = null where line_user_id = p_line_user_id and id <> v_user;
  update public.profiles set line_user_id = p_line_user_id, line_linked_at = now(), line_code = null, line_code_expires_at = null where id = v_user;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.unlink_line()
returns void
language sql
security definer
set search_path = ''
as $$ update public.profiles set line_user_id = null, line_linked_at = null where id = auth.uid(); $$;

drop function if exists public.site_members(uuid);
create or replace function public.site_members(p_site_id uuid)
returns table (user_id uuid, membership_type text, status text, display_name text, email text, is_me boolean, alert_min_level text, line_linked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sm.user_id, sm.membership_type, sm.status, p.display_name,
    case when public.can_edit_site(p_site_id) or sm.user_id = auth.uid() then u.email::text else null end,
    sm.user_id = auth.uid(), sm.alert_min_level, p.line_user_id is not null
  from public.site_memberships sm
  join auth.users u on u.id = sm.user_id
  left join public.profiles p on p.id = sm.user_id
  where sm.site_id = p_site_id and sm.status = 'active' and public.can_view_site(p_site_id)
  order by (sm.membership_type = 'owner') desc, sm.created_at;
$$;

-- 8. DEVICE INGRESS -------------------------------------------------------------------
create or replace function public.verify_device_credential(p_device_uid text, p_credential_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_device record; v_cred uuid;
begin
  if p_device_uid is null or trim(p_device_uid) = '' or length(trim(p_device_uid)) > 128
     or p_credential_hash is null or p_credential_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
  end if;
  select id, site_id, device_type, lifecycle_status, device_uid into v_device from public.devices where device_uid = trim(p_device_uid);
  if v_device.id is null or v_device.lifecycle_status not in ('commissioning', 'active') then
    return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
  end if;
  select id into v_cred from private.device_credentials where device_id = v_device.id and credential_hash = p_credential_hash and status = 'active';
  if v_cred is null then return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL'); end if;
  return jsonb_build_object('valid', true, 'device_id', v_device.id, 'device_uid', v_device.device_uid, 'site_id', v_device.site_id,
    'device_type', v_device.device_type, 'lifecycle_status', v_device.lifecycle_status);
end;
$$;

-- Stores one reading and refreshes the device's latest status. The site's alert level is decided
-- afterwards by evaluate_site_alert (called by the ingress), not here.
create or replace function public.ingest_telemetry(p_device_uid text, p_reading jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_sensor_uid text := nullif(trim(p_reading ->> 'sensorId'), '');
  v_sensor_type text := lower(nullif(trim(p_reading ->> 'sensorType'), ''));
  v_ts_text text := p_reading ->> 'timestamp';
  v_device_ts timestamptz;
  v_classification text := upper(coalesce(nullif(p_reading ->> 'dataClassification', ''), 'DEVICE_DATA'));
  v_calibration text := upper(coalesce(nullif(p_reading -> 'raw' ->> 'calibrationStatus', ''), 'CALIBRATION_REQUIRED'));
  v_gas numeric := (p_reading ->> 'gasPpm')::numeric;
  v_reading_id bigint;
  v_now timestamptz := now();
begin
  if p_device_uid is null or trim(p_device_uid) = '' then raise exception 'INVALID_DEVICE_UID: device uid required'; end if;
  if p_reading is null or jsonb_typeof(p_reading) != 'object' then raise exception 'INVALID_PAYLOAD: reading must be a JSON object'; end if;

  select d.id, d.site_id, d.lifecycle_status into v_device from public.devices d where d.device_uid = trim(p_device_uid);
  if not found then raise exception 'DEVICE_NOT_FOUND: unknown device uid'; end if;
  if v_device.lifecycle_status not in ('commissioning', 'active') then
    raise exception 'DEVICE_NOT_ELIGIBLE: device lifecycle does not accept telemetry';
  end if;

  if v_classification not in ('DEVICE_DATA', 'VIRTUAL_TEST_DATA', 'SYNTHETIC_HANDSHAKE') then v_classification := 'DEVICE_DATA'; end if;
  if v_calibration not in ('CALIBRATION_REQUIRED', 'CALIBRATED') then v_calibration := 'CALIBRATION_REQUIRED'; end if;
  v_gas := case when v_gas < 0 then null else v_gas end;

  -- Device clocks may send ISO-8601 text or epoch milliseconds; ignore anything unparseable.
  begin
    if v_ts_text ~ '^\d{10,13}$' then v_device_ts := to_timestamp(v_ts_text::bigint / 1000.0);
    elsif v_ts_text is not null then v_device_ts := v_ts_text::timestamptz; end if;
  exception when others then v_device_ts := null;
  end;

  -- Auto-register a known sensor type the first time it reports.
  if v_sensor_uid is not null and v_sensor_type in ('mq2', 'mq3', 'mq6') then
    insert into public.sensors (device_id, sensor_uid, sensor_type) values (v_device.id, v_sensor_uid, v_sensor_type)
    on conflict (device_id, sensor_uid) do nothing;
  end if;

  insert into public.telemetry_readings (
    device_id, site_id, sensor_uid, sensor_type, boot_id, sequence, device_timestamp, received_at, data_classification,
    calibration_status, raw_adc, sensor_voltage, input_adjusted_voltage, gas_ppm, extra
  ) values (
    v_device.id, v_device.site_id, v_sensor_uid, upper(v_sensor_type), nullif(p_reading ->> 'bootId', ''), (p_reading ->> 'sequence')::bigint,
    v_device_ts, v_now, v_classification, v_calibration, (p_reading -> 'raw' ->> 'adc')::integer,
    (p_reading -> 'raw' ->> 'sensorVoltage')::numeric, (p_reading -> 'raw' ->> 'inputAdjustedVoltage')::numeric,
    v_gas, coalesce(p_reading -> 'extra', '{}'::jsonb)
  )
  on conflict on constraint uq_telemetry_packet do nothing
  returning id into v_reading_id;

  if v_reading_id is null then return jsonb_build_object('accepted', false, 'duplicate', true); end if;

  update public.devices set last_seen_at = v_now, last_gas_ppm = v_gas,
    last_data_classification = v_classification, last_calibration_status = v_calibration
  where id = v_device.id;

  return jsonb_build_object('accepted', true, 'duplicate', false, 'readingId', v_reading_id);
end;
$$;

-- 9. DROP WHAT IS NO LONGER USED --------------------------------------------------------
drop view if exists public.telemetry_hourly;

drop function if exists public.acknowledge_safety_event;
drop function if exists public.review_safety_event;
drop function if exists public.issue_device_enrollment_token;
drop function if exists public.claim_device_enrollment;

drop table public.safety_events;
drop table public.device_status;
drop table public.alert_acks;
drop table public.user_line_links;
drop table private.line_link_codes;
drop table public.site_settings;
drop table public.floor_plans;
drop table public.ai_summaries;
drop table public.sensor_calibrations;
drop table public.job_assignments;
drop function if exists public.validate_job_assignment_technician_role();
drop table private.owner_invitations;
drop table private.device_enrollment_tokens;

drop policy if exists "customers_select" on public.customers; -- it reads sites.customer_id
alter table public.sites drop column customer_id, drop column latitude, drop column longitude;
drop table public.customers;
alter table public.devices drop column zone_id, drop column firmware_version;
alter table public.telemetry_readings drop column zone_id, drop column sensor_id, drop column risk_score, drop column anomaly_score,
  drop column safety, drop column temperature_c, drop column humidity_pct, drop column schema_version;
drop table public.zones;
alter table public.sensors drop column calibration_status, drop column enabled;

-- 10. HOURLY VIEW (security_invoker => caller's RLS applies) ----------------------------
create view public.telemetry_hourly
with (security_invoker = true)
as
select device_id, site_id, sensor_uid, data_classification, date_trunc('hour', received_at) as hour,
  count(*) as reading_count, round(avg(gas_ppm), 2) as avg_gas_ppm, min(gas_ppm) as min_gas_ppm, max(gas_ppm) as max_gas_ppm
from public.telemetry_readings
group by device_id, site_id, sensor_uid, data_classification, date_trunc('hour', received_at);
revoke all on table public.telemetry_hourly from public, anon;
grant select on table public.telemetry_hourly to authenticated;

-- 11. PRIVILEGES ------------------------------------------------------------------------
revoke execute on function public.save_floor_plan(uuid, jsonb), public.save_site_care(uuid, date, date),
  public.save_sensor_calibration(uuid, text, numeric, text), public.unlink_line(), public.site_members(uuid) from public, anon;
grant execute on function public.save_floor_plan(uuid, jsonb), public.save_site_care(uuid, date, date),
  public.save_sensor_calibration(uuid, text, numeric, text), public.unlink_line(), public.site_members(uuid) to authenticated;
revoke execute on function public.ingest_telemetry(text, jsonb), public.verify_device_credential(text, text),
  public.evaluate_site_alert(text), public.consume_line_link_code(text, text) from public, anon, authenticated;
grant execute on function public.ingest_telemetry(text, jsonb), public.verify_device_credential(text, text),
  public.evaluate_site_alert(text), public.consume_line_link_code(text, text) to service_role;
