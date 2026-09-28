-- ==============================================================================
-- GasGuard Telemetry History, Device Status & Safety Events
-- Phase: DB-1 Durable Measurement Storage
-- Scope: 3 public tables, 1 reporting view, 5 functions
--   1. telemetry_readings   (append-only time series, one row per accepted packet)
--   2. device_status        (latest snapshot per device for fast dashboard reads)
--   3. safety_events        (gas_risk / system_fault incident lifecycle)
--   View: telemetry_hourly  (hourly rollup for reports, RLS-respecting)
-- Writes happen only through service_role RPC (public.ingest_telemetry).
-- Clients read through RLS; they cannot insert/update/delete telemetry directly.
-- ==============================================================================

-- ==============================================================================
-- 1. SITE ACCESS HELPER
-- ==============================================================================
-- Active site member, admin, or technician with a live job assignment on the site.
create or replace function public.can_view_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1
      from public.site_memberships sm
      where sm.site_id = p_site_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
      and exists (
        select 1
        from public.installation_jobs j
        join public.job_assignments ja on ja.job_id = j.id
        where j.site_id = p_site_id
          and ja.technician_user_id = auth.uid()
          and ja.assignment_status in ('assigned', 'accepted')
          and j.status in ('scheduled', 'in_progress', 'blocked')
      )
    );
$$;

revoke execute on function public.can_view_site(uuid) from public, anon;
grant execute on function public.can_view_site(uuid) to authenticated;

-- ==============================================================================
-- 2. TABLES
-- ==============================================================================

-- 2.1 telemetry_readings
create table public.telemetry_readings (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null,
  sensor_id uuid null references public.sensors(id) on delete set null,
  sensor_uid text null,
  sensor_type text null,
  boot_id text null,
  sequence bigint null check (sequence is null or sequence >= 0),
  device_timestamp timestamptz null,
  received_at timestamptz not null default now(),
  data_classification text not null default 'DEVICE_DATA'
    check (data_classification in ('DEVICE_DATA', 'VIRTUAL_TEST_DATA', 'SYNTHETIC_HANDSHAKE')),
  calibration_status text not null default 'CALIBRATION_REQUIRED'
    check (calibration_status in ('CALIBRATION_REQUIRED', 'CALIBRATED')),
  raw_adc integer null check (raw_adc is null or raw_adc between 0 and 4095),
  sensor_voltage numeric(8,3) null check (sensor_voltage is null or sensor_voltage >= 0),
  input_adjusted_voltage numeric(8,3) null check (input_adjusted_voltage is null or input_adjusted_voltage >= 0),
  gas_ppm numeric(10,2) null check (gas_ppm is null or gas_ppm >= 0),
  risk_score numeric(5,2) null check (risk_score is null or risk_score between 0 and 100),
  anomaly_score numeric(5,2) null check (anomaly_score is null or anomaly_score between 0 and 100),
  safety text null check (safety is null or safety in ('safe', 'attention', 'critical', 'unknown')),
  temperature_c numeric(5,2) null,
  humidity_pct numeric(5,2) null check (humidity_pct is null or humidity_pct between 0 and 100),
  -- Forward-compatible bag for fields added by future firmware/engine versions.
  extra jsonb not null default '{}'::jsonb,
  schema_version smallint not null default 1,
  constraint uq_telemetry_packet unique (device_id, sensor_uid, boot_id, sequence)
);

create index idx_telemetry_device_received on public.telemetry_readings(device_id, received_at desc);
create index idx_telemetry_site_received on public.telemetry_readings(site_id, received_at desc);
create index idx_telemetry_received_brin on public.telemetry_readings using brin(received_at);

-- 2.2 device_status (one row per device, upserted on every accepted packet)
create table public.device_status (
  device_id uuid primary key references public.devices(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null,
  last_reading_id bigint null references public.telemetry_readings(id) on delete set null,
  last_seen_at timestamptz not null,
  data_classification text not null,
  calibration_status text not null,
  safety text null,
  gas_ppm numeric(10,2) null,
  risk_score numeric(5,2) null,
  boot_id text null,
  last_sequence bigint null,
  updated_at timestamptz not null default now()
);

create index idx_device_status_site_id on public.device_status(site_id);

create trigger tr_device_status_updated_at
  before update on public.device_status
  for each row execute function public.handle_updated_at();

-- 2.3 safety_events (mirrors the engine incident model in js/engine.js)
create table public.safety_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null,
  device_id uuid null references public.devices(id) on delete set null,
  event_type text not null check (event_type in ('gas_risk', 'system_fault')),
  lifecycle_status text not null default 'open'
    check (lifecycle_status in ('open', 'acknowledged', 'system_fault', 'resolved')),
  severity text not null check (severity in ('attention', 'critical', 'unknown')),
  peak_severity text not null check (peak_severity in ('attention', 'critical', 'unknown')),
  data_classification text not null default 'DEVICE_DATA',
  started_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  first_reading_id bigint null references public.telemetry_readings(id) on delete set null,
  latest_reading_id bigint null references public.telemetry_readings(id) on delete set null,
  peak_gas_ppm numeric(10,2) null,
  peak_risk_score numeric(5,2) null,
  peak_anomaly_score numeric(5,2) null,
  reading_count integer not null default 1 check (reading_count >= 1),
  acknowledged_at timestamptz null,
  acknowledged_by uuid null references auth.users(id) on delete set null,
  review_status text not null default 'not_started'
    check (review_status in ('not_started', 'in_progress', 'resolved')),
  review_note text null check (review_note is null or char_length(review_note) <= 2000),
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  evidence jsonb not null default '{"timeline": []}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chk_safety_events_resolved_at check (lifecycle_status != 'resolved' or resolved_at is not null)
);

create index idx_safety_events_site_started on public.safety_events(site_id, started_at desc);
create index idx_safety_events_device_id on public.safety_events(device_id);
-- At most one unresolved incident of each type per device.
create unique index uq_safety_events_active_per_device
  on public.safety_events(device_id, event_type)
  where lifecycle_status != 'resolved';

-- ==============================================================================
-- 3. REPORTING VIEW (security_invoker => caller's RLS applies)
-- ==============================================================================
create view public.telemetry_hourly
with (security_invoker = true)
as
select
  device_id,
  site_id,
  sensor_uid,
  data_classification,
  date_trunc('hour', received_at) as hour,
  count(*) as reading_count,
  round(avg(gas_ppm), 2) as avg_gas_ppm,
  min(gas_ppm) as min_gas_ppm,
  max(gas_ppm) as max_gas_ppm,
  max(risk_score) as max_risk_score,
  count(*) filter (where safety = 'critical') as critical_count,
  count(*) filter (where safety = 'attention') as attention_count
from public.telemetry_readings
group by device_id, site_id, sensor_uid, data_classification, date_trunc('hour', received_at);

-- ==============================================================================
-- 4. ROW-LEVEL SECURITY (read-only for clients)
-- ==============================================================================
alter table public.telemetry_readings enable row level security;
alter table public.device_status enable row level security;
alter table public.safety_events enable row level security;

create policy "telemetry_readings_select" on public.telemetry_readings
  for select to authenticated
  using (public.can_view_site(site_id));

create policy "device_status_select" on public.device_status
  for select to authenticated
  using (public.can_view_site(site_id));

create policy "safety_events_select" on public.safety_events
  for select to authenticated
  using (public.can_view_site(site_id));

-- Clients never write these tables directly; all mutations go through RPCs.
-- SELECT is granted explicitly so reads work even when "auto-expose new tables" is off.
grant select on table public.telemetry_readings, public.device_status, public.safety_events to authenticated;
revoke all on table public.telemetry_readings, public.device_status, public.safety_events from anon;
revoke insert, update, delete, truncate on table public.telemetry_readings from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.device_status from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.safety_events from public, anon, authenticated;
revoke all on table public.telemetry_hourly from public, anon;
grant select on table public.telemetry_hourly to authenticated;

-- ==============================================================================
-- 5. INGEST RPC (service_role only; called by the device ingress server)
-- ==============================================================================
-- p_reading keys follow the Raw Measurement contract plus optional engine output:
--   sensorId, sensorType, bootId, sequence, timestamp,
--   raw { adc, sensorVoltage, inputAdjustedVoltage, calibrationStatus },
--   gasPpm, riskScore, anomalyScore, safety, dataClassification,
--   environment { temperature, humidity }, extra { ... }
create or replace function public.ingest_telemetry(p_device_uid text, p_reading jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_sensor_id uuid;
  v_sensor_uid text := nullif(trim(p_reading ->> 'sensorId'), '');
  v_sensor_type text := lower(nullif(trim(p_reading ->> 'sensorType'), ''));
  v_ts_text text := p_reading ->> 'timestamp';
  v_device_ts timestamptz;
  v_classification text := upper(coalesce(nullif(p_reading ->> 'dataClassification', ''), 'DEVICE_DATA'));
  v_calibration text := upper(coalesce(nullif(p_reading -> 'raw' ->> 'calibrationStatus', ''), 'CALIBRATION_REQUIRED'));
  v_safety text := lower(nullif(p_reading ->> 'safety', ''));
  v_gas numeric := (p_reading ->> 'gasPpm')::numeric;
  v_risk numeric := (p_reading ->> 'riskScore')::numeric;
  v_anomaly numeric := (p_reading ->> 'anomalyScore')::numeric;
  v_reading_id bigint;
  v_event_id uuid;
  v_event record;
  v_event_type text;
  v_now timestamptz := now();
  v_rank jsonb := '{"unknown":0,"attention":1,"critical":2}'::jsonb;
begin
  if p_device_uid is null or trim(p_device_uid) = '' then
    raise exception 'INVALID_DEVICE_UID: device uid required';
  end if;
  if p_reading is null or jsonb_typeof(p_reading) != 'object' then
    raise exception 'INVALID_PAYLOAD: reading must be a JSON object';
  end if;

  select d.id, d.site_id, d.zone_id, d.lifecycle_status
    into v_device
  from public.devices d
  where d.device_uid = trim(p_device_uid);

  if not found then
    raise exception 'DEVICE_NOT_FOUND: unknown device uid';
  end if;
  if v_device.lifecycle_status not in ('commissioning', 'active') then
    raise exception 'DEVICE_NOT_ELIGIBLE: device lifecycle does not accept telemetry';
  end if;

  if v_classification not in ('DEVICE_DATA', 'VIRTUAL_TEST_DATA', 'SYNTHETIC_HANDSHAKE') then
    v_classification := 'DEVICE_DATA';
  end if;
  if v_calibration not in ('CALIBRATION_REQUIRED', 'CALIBRATED') then
    v_calibration := 'CALIBRATION_REQUIRED';
  end if;
  if v_safety is not null and v_safety not in ('safe', 'attention', 'critical', 'unknown') then
    v_safety := null;
  end if;
  v_gas := case when v_gas < 0 then null else v_gas end;
  -- greatest/least ignore nulls, so guard explicitly: a missing score must stay null, never 0.
  v_risk := case when v_risk is null then null else least(greatest(v_risk, 0), 100) end;
  v_anomaly := case when v_anomaly is null then null else least(greatest(v_anomaly, 0), 100) end;

  -- Device clocks may send ISO-8601 text or epoch milliseconds; ignore anything unparseable.
  begin
    if v_ts_text ~ '^\d{10,13}$' then
      v_device_ts := to_timestamp(v_ts_text::bigint / 1000.0);
    elsif v_ts_text is not null then
      v_device_ts := v_ts_text::timestamptz;
    end if;
  exception when others then
    v_device_ts := null;
  end;

  -- Resolve sensor; auto-register a known sensor type the first time it reports.
  if v_sensor_uid is not null then
    select s.id into v_sensor_id
    from public.sensors s
    where s.device_id = v_device.id and s.sensor_uid = v_sensor_uid;

    if v_sensor_id is null and v_sensor_type in ('mq3', 'mq6') then
      insert into public.sensors (device_id, sensor_uid, sensor_type)
      values (v_device.id, v_sensor_uid, v_sensor_type)
      on conflict (device_id, sensor_uid) do nothing
      returning id into v_sensor_id;
    end if;
  end if;

  insert into public.telemetry_readings (
    device_id, site_id, zone_id, sensor_id, sensor_uid, sensor_type,
    boot_id, sequence, device_timestamp, received_at, data_classification,
    calibration_status, raw_adc, sensor_voltage, input_adjusted_voltage,
    gas_ppm, risk_score, anomaly_score, safety, temperature_c, humidity_pct, extra
  ) values (
    v_device.id, v_device.site_id, v_device.zone_id, v_sensor_id, v_sensor_uid, upper(v_sensor_type),
    nullif(p_reading ->> 'bootId', ''), (p_reading ->> 'sequence')::bigint, v_device_ts, v_now, v_classification,
    v_calibration, (p_reading -> 'raw' ->> 'adc')::integer,
    (p_reading -> 'raw' ->> 'sensorVoltage')::numeric, (p_reading -> 'raw' ->> 'inputAdjustedVoltage')::numeric,
    v_gas, v_risk, v_anomaly, v_safety,
    (p_reading -> 'environment' ->> 'temperature')::numeric, (p_reading -> 'environment' ->> 'humidity')::numeric,
    coalesce(p_reading -> 'extra', '{}'::jsonb)
  )
  on conflict on constraint uq_telemetry_packet do nothing
  returning id into v_reading_id;

  if v_reading_id is null then
    return jsonb_build_object('accepted', false, 'duplicate', true);
  end if;

  insert into public.device_status as ds (
    device_id, site_id, zone_id, last_reading_id, last_seen_at, data_classification,
    calibration_status, safety, gas_ppm, risk_score, boot_id, last_sequence
  ) values (
    v_device.id, v_device.site_id, v_device.zone_id, v_reading_id, v_now, v_classification,
    v_calibration, v_safety, v_gas, v_risk, nullif(p_reading ->> 'bootId', ''), (p_reading ->> 'sequence')::bigint
  )
  on conflict (device_id) do update set
    site_id = excluded.site_id,
    zone_id = excluded.zone_id,
    last_reading_id = excluded.last_reading_id,
    last_seen_at = excluded.last_seen_at,
    data_classification = excluded.data_classification,
    calibration_status = excluded.calibration_status,
    safety = excluded.safety,
    gas_ppm = excluded.gas_ppm,
    risk_score = excluded.risk_score,
    boot_id = excluded.boot_id,
    last_sequence = excluded.last_sequence;

  -- Incident lifecycle (same rules as js/engine.js syncLifecycle). Handshake packets never raise incidents.
  if v_safety is not null and v_classification != 'SYNTHETIC_HANDSHAKE' then
    if v_safety = 'unknown' then
      v_event_type := 'system_fault';
    else
      -- Any known state clears an open system fault.
      update public.safety_events
        set lifecycle_status = 'resolved', resolved_at = v_now, last_updated_at = v_now, latest_reading_id = v_reading_id,
            evidence = jsonb_set(evidence, '{timeline}', (evidence -> 'timeline') || jsonb_build_array(jsonb_build_object('at', v_now, 'type', 'resolved', 'detail', 'Monitoring state recovered')))
      where device_id = v_device.id and event_type = 'system_fault' and lifecycle_status != 'resolved';

      if v_safety = 'safe' then
        update public.safety_events
          set lifecycle_status = 'resolved', resolved_at = v_now, last_updated_at = v_now, latest_reading_id = v_reading_id,
              evidence = jsonb_set(evidence, '{timeline}', (evidence -> 'timeline') || jsonb_build_array(jsonb_build_object('at', v_now, 'type', 'resolved', 'detail', 'Returned to safe state')))
        where device_id = v_device.id and event_type = 'gas_risk' and lifecycle_status != 'resolved';
      else
        v_event_type := 'gas_risk';
      end if;
    end if;

    if v_event_type is not null then
      select * into v_event
      from public.safety_events
      where device_id = v_device.id and event_type = v_event_type and lifecycle_status != 'resolved'
      for update;

      if found then
        update public.safety_events set
          severity = case when v_safety = 'unknown' then severity else v_safety end,
          peak_severity = case when (v_rank ->> v_safety)::int > (v_rank ->> peak_severity)::int then v_safety else peak_severity end,
          last_updated_at = v_now,
          latest_reading_id = v_reading_id,
          reading_count = reading_count + 1,
          peak_gas_ppm = greatest(peak_gas_ppm, v_gas),
          peak_risk_score = greatest(peak_risk_score, v_risk),
          peak_anomaly_score = greatest(peak_anomaly_score, v_anomaly),
          evidence = case
            when (v_rank ->> v_safety)::int > (v_rank ->> peak_severity)::int
              then jsonb_set(evidence, '{timeline}', (evidence -> 'timeline') || jsonb_build_array(jsonb_build_object('at', v_now, 'type', 'escalated', 'detail', peak_severity || ' -> ' || v_safety)))
            else evidence
          end
        where id = v_event.id
        returning id into v_event_id;
      else
        insert into public.safety_events (
          site_id, zone_id, device_id, event_type, lifecycle_status, severity, peak_severity,
          data_classification, started_at, last_updated_at, first_reading_id, latest_reading_id,
          peak_gas_ppm, peak_risk_score, peak_anomaly_score, evidence
        ) values (
          v_device.site_id, v_device.zone_id, v_device.id, v_event_type,
          case when v_event_type = 'system_fault' then 'system_fault' else 'open' end,
          v_safety, v_safety, v_classification, v_now, v_now, v_reading_id, v_reading_id,
          v_gas, v_risk, v_anomaly,
          jsonb_build_object('timeline', jsonb_build_array(jsonb_build_object(
            'at', v_now, 'type', 'detected',
            'detail', case when v_event_type = 'system_fault' then 'Monitoring state is unknown; safety cannot be confirmed' else 'Detected ' || v_safety || ' gas-risk state' end)))
        )
        returning id into v_event_id;
      end if;
    end if;
  end if;

  return jsonb_build_object('accepted', true, 'duplicate', false, 'readingId', v_reading_id, 'eventId', v_event_id);
end;
$$;

revoke execute on function public.ingest_telemetry(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry(text, jsonb) to service_role;

-- ==============================================================================
-- 6. USER ACTIONS ON EVENTS (authenticated, access-checked)
-- ==============================================================================
create or replace function public.acknowledge_safety_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
begin
  select site_id into v_site_id from public.safety_events where id = p_event_id;
  if v_site_id is null or not public.can_view_site(v_site_id) then
    raise exception 'EVENT_NOT_FOUND: event not found';
  end if;

  update public.safety_events set
    lifecycle_status = case when lifecycle_status = 'open' then 'acknowledged' else lifecycle_status end,
    acknowledged_at = coalesce(acknowledged_at, now()),
    acknowledged_by = coalesce(acknowledged_by, auth.uid()),
    evidence = jsonb_set(evidence, '{timeline}', (evidence -> 'timeline') || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'acknowledged', 'detail', 'Acknowledged by user')))
  where id = p_event_id and acknowledged_at is null;
end;
$$;

revoke execute on function public.acknowledge_safety_event(uuid) from public, anon;
grant execute on function public.acknowledge_safety_event(uuid) to authenticated;

create or replace function public.review_safety_event(p_event_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
begin
  if v_role not in ('technician', 'admin') then
    raise exception 'UNAUTHORIZED: technician or admin role required';
  end if;
  if p_status not in ('in_progress', 'resolved') then
    raise exception 'INVALID_REVIEW_STATUS: status must be in_progress or resolved';
  end if;

  select site_id into v_site_id from public.safety_events where id = p_event_id;
  if v_site_id is null or not public.can_view_site(v_site_id) then
    raise exception 'EVENT_NOT_FOUND: event not found';
  end if;

  update public.safety_events set
    review_status = p_status,
    review_note = left(p_note, 2000),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    evidence = jsonb_set(evidence, '{timeline}', (evidence -> 'timeline') || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'review_' || p_status, 'detail', coalesce(left(p_note, 200), ''))))
  where id = p_event_id;
end;
$$;

revoke execute on function public.review_safety_event(uuid, text, text) from public, anon;
grant execute on function public.review_safety_event(uuid, text, text) to authenticated;

-- ==============================================================================
-- 7. RETENTION (service_role only; call from a scheduled job to cap storage)
-- ==============================================================================
create or replace function public.purge_telemetry_before(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if p_before is null or p_before > now() - interval '7 days' then
    raise exception 'INVALID_RETENTION: cutoff must be at least 7 days in the past';
  end if;
  delete from public.telemetry_readings where received_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_telemetry_before(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_telemetry_before(timestamptz) to service_role;

-- ==============================================================================
-- 8. REALTIME (live dashboard updates when the Supabase publication exists)
-- ==============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.device_status, public.safety_events;
  end if;
end;
$$;
