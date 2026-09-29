-- ==============================================================================
-- GasGuard: add MQ-2 sensor support
-- MQ-2 responds to LPG, propane, hydrogen and smoke. It is an auxiliary context
-- channel; MQ-6 remains the primary LPG sensor and readings are never merged.
-- 1. Allow sensor_type 'mq2'
-- 2. ingest_telemetry auto-registers MQ-2 channels the first time they report
-- ==============================================================================

alter table public.sensors drop constraint if exists sensors_sensor_type_check;
alter table public.sensors add constraint sensors_sensor_type_check
  check (sensor_type in ('mq2', 'mq3', 'mq6'));

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

    if v_sensor_id is null and v_sensor_type in ('mq2', 'mq3', 'mq6') then
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
