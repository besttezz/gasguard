-- ==============================================================================
-- Owner, member, technician and admin features of the redesigned app.
--   1. Access helpers (technicians on an active job may set up the plan)
--   2. Member alert levels, invitations, member management
--   3. Alert episodes, server-side level evaluation, acknowledgements
--   4. LINE account links
--   5. Site settings (gas hose / sensor check dates) and AI summary cache
--   6. Technician: sensor calibrations, job start/complete
--   7. Admin: write policies and device credential issuing
-- Thresholds mirror js/safety-logic.js: 900 / 1,800 / 3,600 ppm (5 / 10 / 20 % LEL).
-- ==============================================================================

-- 1. ACCESS HELPERS ----------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false); $$;

create or replace function public.can_edit_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.site_memberships sm
      where sm.site_id = p_site_id and sm.user_id = auth.uid() and sm.status = 'active' and sm.membership_type = 'owner'
    )
    or (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
      and exists (
        select 1 from public.installation_jobs j
        join public.job_assignments ja on ja.job_id = j.id
        where j.site_id = p_site_id and ja.technician_user_id = auth.uid()
          and ja.assignment_status in ('assigned', 'accepted') and j.status in ('scheduled', 'in_progress', 'blocked')
      )
    );
$$;

create or replace function public.level_rank(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $$ select case p_level when 'watch' then 1 when 'warning' then 2 when 'danger' then 3 else 0 end; $$;

create or replace function public.level_for_ppm(p_ppm numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ppm is null then 'unknown'
    when p_ppm >= 3600 then 'danger'
    when p_ppm >= 1800 then 'warning'
    when p_ppm >= 900 then 'watch'
    else 'safe' end;
$$;

-- Technicians on an active job can read the site, its devices and sensors.
create policy "sites_select_job" on public.sites for select to authenticated using (public.can_view_site(id));
create policy "devices_select_job" on public.devices for select to authenticated using (public.can_view_site(site_id));
create policy "sensors_select_job" on public.sensors for select to authenticated
  using (exists (select 1 from public.devices d where d.id = sensors.device_id and public.can_view_site(d.site_id)));

-- 2. MEMBERS -------------------------------------------------------------------------
alter table public.site_memberships
  add column if not exists alert_min_level text not null default 'watch'
  check (alert_min_level in ('watch', 'warning', 'danger'));

-- Members of a site see each other (owners also manage them); admins see all.
create policy "site_memberships_select_same_site" on public.site_memberships for select to authenticated
  using (public.can_view_site(site_id));

create table private.site_invitations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  membership_type text not null default 'member' check (membership_type in ('owner', 'member')),
  alert_min_level text not null default 'watch' check (alert_min_level in ('watch', 'warning', 'danger')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid null references auth.users(id) on delete set null,
  claimed_by uuid null references auth.users(id) on delete set null,
  claimed_at timestamptz null,
  created_at timestamptz not null default now()
);
alter table private.site_invitations enable row level security;
revoke all on table private.site_invitations from public, anon, authenticated;

-- The inviter's browser makes a random token and sends only its SHA-256 hash.
create or replace function public.create_site_invitation(p_site_id uuid, p_token_hash text, p_membership_type text, p_alert_min_level text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.can_edit_site(p_site_id) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'technician' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  insert into private.site_invitations (site_id, token_hash, membership_type, alert_min_level, created_by)
  values (p_site_id, lower(p_token_hash), coalesce(p_membership_type, 'member'), coalesce(p_alert_min_level, 'watch'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.invitation_info(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'valid', i.status = 'pending' and i.expires_at > now(),
      'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
      'site_name', s.name, 'membership_type', i.membership_type, 'expires_at', i.expires_at)
    from private.site_invitations i join public.sites s on s.id = i.site_id
    where i.token_hash = lower(p_token_hash)
  ), jsonb_build_object('valid', false, 'status', 'not_found'));
$$;

-- Shared by the signed-in claim and the service-side sign-up path.
create or replace function private.claim_invitation(p_token_hash text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_inv private.site_invitations%rowtype;
begin
  select * into v_inv from private.site_invitations where token_hash = lower(p_token_hash) for update;
  if v_inv.id is null or v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'INVITATION_INVALID');
  end if;
  insert into public.site_memberships (site_id, user_id, membership_type, status, alert_min_level)
  values (v_inv.site_id, p_user_id, v_inv.membership_type, 'active', v_inv.alert_min_level)
  on conflict (site_id, user_id) do update set status = 'active',
    membership_type = case when public.site_memberships.membership_type = 'owner' then 'owner' else excluded.membership_type end,
    alert_min_level = excluded.alert_min_level;
  update private.site_invitations set status = 'claimed', claimed_by = p_user_id, claimed_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true, 'site_id', v_inv.site_id);
end;
$$;

create or replace function public.claim_site_invitation(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.claim_invitation(p_token_hash, auth.uid()); $$;

create or replace function public.claim_site_invitation_for(p_token_hash text, p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.claim_invitation(p_token_hash, p_user_id); $$;

create or replace function public.set_member_alert_level(p_site_id uuid, p_user_id uuid, p_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.can_edit_site(p_site_id) or p_user_id = auth.uid()) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.site_memberships set alert_min_level = p_level where site_id = p_site_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_site_member(p_site_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_owners integer; v_type text;
begin
  if not (public.can_edit_site(p_site_id) or p_user_id = auth.uid()) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select membership_type into v_type from public.site_memberships where site_id = p_site_id and user_id = p_user_id and status = 'active';
  select count(*) into v_owners from public.site_memberships where site_id = p_site_id and membership_type = 'owner' and status = 'active';
  if v_type = 'owner' and v_owners <= 1 then return jsonb_build_object('ok', false, 'code', 'LAST_OWNER'); end if;
  update public.site_memberships set status = 'revoked' where site_id = p_site_id and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 3. ALERT EPISODES -------------------------------------------------------------------
create table public.alert_episodes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  level text not null check (level in ('watch', 'warning', 'danger')),
  peak_level text not null check (peak_level in ('watch', 'warning', 'danger')),
  peak_ppm numeric(10,2) null,
  started_at timestamptz not null default now(),
  level_changed_at timestamptz not null default now(),
  ended_at timestamptz null
);
create unique index uq_alert_episodes_open on public.alert_episodes(site_id) where ended_at is null;
create index idx_alert_episodes_site_started on public.alert_episodes(site_id, started_at desc);

create table public.alert_acks (
  episode_id uuid not null references public.alert_episodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);

alter table public.alert_episodes enable row level security;
alter table public.alert_acks enable row level security;
create policy "alert_episodes_select" on public.alert_episodes for select to authenticated using (public.can_view_site(site_id));
create policy "alert_acks_select" on public.alert_acks for select to authenticated
  using (exists (select 1 from public.alert_episodes e where e.id = alert_acks.episode_id and public.can_view_site(e.site_id)));
grant select on public.alert_episodes, public.alert_acks to authenticated;
revoke all on public.alert_episodes, public.alert_acks from anon;

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
  insert into public.alert_acks (episode_id, user_id) values (p_episode_id, auth.uid()) on conflict do nothing;
end;
$$;

-- Called by the ingress after each stored reading (service role only). Site level = the highest of each
-- sensor's latest calibrated reading in the last 30 s. Opens, escalates or closes the site's episode and
-- returns who should get a LINE message.
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
    select coalesce(jsonb_agg(l.line_user_id), '[]'::jsonb) into v_recipients
    from public.site_memberships sm join public.user_line_links l on l.user_id = sm.user_id
    where sm.site_id = v_site and sm.status = 'active'
      and public.level_rank(case when v_event = 'resolved' then v_prev else v_level end) >= public.level_rank(sm.alert_min_level);
  end if;

  return jsonb_build_object('ok', true, 'event', v_event, 'level', v_level, 'previous', v_prev, 'ppm', v_ppm,
    'site_id', v_site, 'site_name', v_site_name, 'episode_id', v_episode, 'line_recipients', v_recipients);
end;
$$;

-- 4. LINE LINKS -----------------------------------------------------------------------
create table public.user_line_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique check (line_user_id ~ '^U[0-9a-f]{32}$'),
  linked_at timestamptz not null default now()
);
alter table public.user_line_links enable row level security;
create policy "user_line_links_select_own" on public.user_line_links for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "user_line_links_delete_own" on public.user_line_links for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.user_line_links to authenticated;
revoke all on public.user_line_links from anon;

create table private.line_link_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table private.line_link_codes enable row level security;
revoke all on table private.line_link_codes from public, anon, authenticated;

create or replace function public.create_line_link_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from private.line_link_codes where user_id = auth.uid() or expires_at < now();
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into private.line_link_codes (code, user_id) values (v_code, auth.uid());
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
  delete from private.line_link_codes where code = p_code and expires_at > now() returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false); end if;
  delete from public.user_line_links where line_user_id = p_line_user_id;
  insert into public.user_line_links (user_id, line_user_id) values (v_user, p_line_user_id)
  on conflict (user_id) do update set line_user_id = excluded.line_user_id, linked_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Member list (needs user_line_links above).
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
    sm.user_id = auth.uid(), sm.alert_min_level,
    exists (select 1 from public.user_line_links l where l.user_id = sm.user_id)
  from public.site_memberships sm
  join auth.users u on u.id = sm.user_id
  left join public.profiles p on p.id = sm.user_id
  where sm.site_id = p_site_id and sm.status = 'active' and public.can_view_site(p_site_id)
  order by (sm.membership_type = 'owner') desc, sm.created_at;
$$;

-- 5. SITE SETTINGS AND AI SUMMARY --------------------------------------------------
create table public.site_settings (
  site_id uuid primary key references public.sites(id) on delete cascade,
  hose_installed_on date null,
  sensor_checked_on date null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger tr_site_settings_updated_at before update on public.site_settings for each row execute function public.handle_updated_at();
alter table public.site_settings enable row level security;
create policy "site_settings_select" on public.site_settings for select to authenticated using (public.can_view_site(site_id));
create policy "site_settings_insert" on public.site_settings for insert to authenticated with check (public.can_edit_site(site_id) and updated_by = auth.uid());
create policy "site_settings_update" on public.site_settings for update to authenticated using (public.can_edit_site(site_id)) with check (public.can_edit_site(site_id) and updated_by = auth.uid());
grant select, insert, update on public.site_settings to authenticated;
revoke all on public.site_settings from anon;

create table public.ai_summaries (
  site_id uuid primary key references public.sites(id) on delete cascade,
  summary text not null check (char_length(summary) <= 2000),
  source text not null check (source in ('gemini', 'template')),
  model text null,
  facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ai_summaries enable row level security;
create policy "ai_summaries_select" on public.ai_summaries for select to authenticated using (public.can_view_site(site_id));
grant select on public.ai_summaries to authenticated;
revoke all on public.ai_summaries from anon;

-- 6. TECHNICIAN ----------------------------------------------------------------------
create table public.sensor_calibrations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  sensor_uid text not null,
  ro_kohm numeric(10,3) not null check (ro_kohm > 0 and ro_kohm < 10000),
  notes text null check (notes is null or char_length(notes) <= 500),
  measured_by uuid null references auth.users(id) on delete set null,
  measured_at timestamptz not null default now()
);
create index idx_sensor_calibrations_device on public.sensor_calibrations(device_id, measured_at desc);
alter table public.sensor_calibrations enable row level security;
create policy "sensor_calibrations_select" on public.sensor_calibrations for select to authenticated
  using (exists (select 1 from public.devices d where d.id = sensor_calibrations.device_id and public.can_view_site(d.site_id)));
create policy "sensor_calibrations_insert" on public.sensor_calibrations for insert to authenticated
  with check (measured_by = auth.uid() and exists (select 1 from public.devices d where d.id = sensor_calibrations.device_id and public.can_edit_site(d.site_id)));
grant select, insert on public.sensor_calibrations to authenticated;
revoke all on public.sensor_calibrations from anon;

create or replace function public.set_job_progress(p_job_id uuid, p_status text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('in_progress', 'completed', 'blocked') then raise exception 'BAD_STATUS'; end if;
  if not (public.is_admin() or exists (select 1 from public.job_assignments ja where ja.job_id = p_job_id and ja.technician_user_id = auth.uid()
      and ja.assignment_status in ('assigned', 'accepted'))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.installation_jobs set status = p_status,
    notes = case when p_notes is null or p_notes = '' then notes else left(coalesce(notes || E'\n', '') || p_notes, 4000) end
  where id = p_job_id;
  update public.job_assignments set
    assignment_status = case when p_status = 'completed' then 'completed' else 'accepted' end,
    completed_at = case when p_status = 'completed' then now() else null end
  where job_id = p_job_id and (technician_user_id = auth.uid() or public.is_admin()) and assignment_status <> 'cancelled';
end;
$$;

-- 7. ADMIN ---------------------------------------------------------------------------
create policy "customers_admin_write" on public.customers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "sites_admin_write" on public.sites for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "devices_admin_write" on public.devices for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "sensors_admin_write" on public.sensors for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "site_memberships_admin_write" on public.site_memberships for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "installation_jobs_admin_write" on public.installation_jobs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_assignments_admin_write" on public.job_assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert, update, delete on public.customers, public.sites, public.devices, public.sensors, public.site_memberships,
  public.installation_jobs, public.job_assignments to authenticated;

-- The admin's browser makes the 64-hex key, shows it once, and sends only its hash.
create or replace function public.admin_issue_device_credential(p_device_id uuid, p_credential_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_credential_hash !~ '^[0-9a-f]{64}$' then raise exception 'BAD_HASH'; end if;
  update private.device_credentials set status = 'revoked', revoked_at = now() where device_id = p_device_id and status = 'active';
  insert into private.device_credentials (device_id, credential_hash) values (p_device_id, p_credential_hash);
end;
$$;

-- PRIVILEGES -------------------------------------------------------------------------
revoke execute on function public.create_site_invitation(uuid, text, text, text), public.claim_site_invitation(text),
  public.set_member_alert_level(uuid, uuid, text), public.remove_site_member(uuid, uuid), public.site_members(uuid),
  public.ack_alert(uuid), public.create_line_link_code(), public.set_job_progress(uuid, text, text),
  public.admin_issue_device_credential(uuid, text), public.can_edit_site(uuid), public.is_admin()
  from public, anon;
grant execute on function public.create_site_invitation(uuid, text, text, text), public.claim_site_invitation(text),
  public.set_member_alert_level(uuid, uuid, text), public.remove_site_member(uuid, uuid), public.site_members(uuid),
  public.ack_alert(uuid), public.create_line_link_code(), public.set_job_progress(uuid, text, text),
  public.admin_issue_device_credential(uuid, text), public.can_edit_site(uuid), public.is_admin()
  to authenticated;
-- Anyone holding a link may see which home it is for.
revoke execute on function public.invitation_info(text) from public;
grant execute on function public.invitation_info(text) to anon, authenticated;
-- Service role only.
revoke execute on function public.claim_site_invitation_for(text, uuid), public.evaluate_site_alert(text),
  public.consume_line_link_code(text, text), private.claim_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_site_invitation_for(text, uuid), public.evaluate_site_alert(text),
  public.consume_line_link_code(text, text) to service_role;
