-- ==============================================================================
-- GasGuard Core Platform Schema & RLS
-- Phase: 6C-1 Core Platform Foundation
-- Scope: Exactly 7 public tables
--   1. profiles
--   2. customers
--   3. sites
--   4. zones
--   5. site_memberships
--   6. devices
--   7. sensors
-- ==============================================================================

-- 1. REUSABLE UPDATED_AT TRIGGER FUNCTION
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. PROFILE AUTO-CREATION TRIGGER FUNCTION & TRIGGER
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ==============================================================================
-- 3. CORE PUBLIC TABLES
-- ==============================================================================

-- 3.1 profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text null,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tr_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Attach trigger to auth.users for profile auto-creation
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Safe backfill for existing auth users without hardcoded UUIDs
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- 3.2 customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_type text not null default 'other' check (customer_type in ('household', 'restaurant', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tr_customers_updated_at
  before update on public.customers
  for each row execute function public.handle_updated_at();

-- 3.3 sites
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  name text not null,
  address_text text null,
  latitude numeric null check (latitude is null or latitude between -90 and 90),
  longitude numeric null check (longitude is null or longitude between -180 and 180),
  lifecycle_status text not null default 'unverified' check (lifecycle_status in ('unverified', 'commissioning', 'commissioned', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sites_customer_id on public.sites(customer_id);

create trigger tr_sites_updated_at
  before update on public.sites
  for each row execute function public.handle_updated_at();

-- 3.4 zones
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name),
  unique (site_id, id)
);

create index idx_zones_site_id on public.zones(site_id);

create trigger tr_zones_updated_at
  before update on public.zones
  for each row execute function public.handle_updated_at();

-- 3.5 site_memberships
create table public.site_memberships (
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_type text not null check (membership_type in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

create index idx_site_memberships_user_id on public.site_memberships(user_id);

-- 3.6 devices
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null,
  device_uid text unique not null,
  device_type text not null default 'esp32',
  lifecycle_status text not null default 'registered' check (lifecycle_status in ('registered', 'commissioning', 'active', 'retired')),
  firmware_version text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (site_id, zone_id) references public.zones(site_id, id) on delete set null (zone_id)
);

create index idx_devices_site_id on public.devices(site_id);
create index idx_devices_zone_id on public.devices(zone_id);

create trigger tr_devices_updated_at
  before update on public.devices
  for each row execute function public.handle_updated_at();

-- 3.7 sensors
create table public.sensors (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  sensor_uid text not null,
  sensor_type text not null check (sensor_type in ('mq3', 'mq6')),
  calibration_status text not null default 'not_configured' check (calibration_status in ('not_configured', 'pending', 'validated')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, sensor_uid)
);

create index idx_sensors_device_id on public.sensors(device_id);

create trigger tr_sensors_updated_at
  before update on public.sensors
  for each row execute function public.handle_updated_at();

-- ==============================================================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on ALL 7 tables
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.sites enable row level security;
alter table public.zones enable row level security;
alter table public.site_memberships enable row level security;
alter table public.devices enable row level security;
alter table public.sensors enable row level security;

-- 4.1 profiles: Own read, own update only
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 4.2 site_memberships: Own membership or admin read
create policy "site_memberships_select" on public.site_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4.3 customers: Read via active site membership or admin
create policy "customers_select" on public.customers
  for select to authenticated
  using (
    exists (
      select 1
      from public.sites s
      join public.site_memberships sm on sm.site_id = s.id
      where s.customer_id = customers.id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4.4 sites: Read via active site membership or admin
create policy "sites_select" on public.sites
  for select to authenticated
  using (
    exists (
      select 1
      from public.site_memberships sm
      where sm.site_id = sites.id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4.5 zones: Read via active site membership or admin
create policy "zones_select" on public.zones
  for select to authenticated
  using (
    exists (
      select 1
      from public.site_memberships sm
      where sm.site_id = zones.site_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4.6 devices: Read via active site membership or admin
create policy "devices_select" on public.devices
  for select to authenticated
  using (
    exists (
      select 1
      from public.site_memberships sm
      where sm.site_id = devices.site_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4.7 sensors: Read via active site membership or admin
create policy "sensors_select" on public.sensors
  for select to authenticated
  using (
    exists (
      select 1
      from public.devices d
      join public.site_memberships sm on sm.site_id = d.site_id
      where d.id = sensors.device_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
