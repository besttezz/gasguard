-- ==============================================================================
-- GasGuard Installation & Service Jobs Schema & RLS
-- Phase: 6D-1 Foundation (installation_jobs & job_assignments)
-- Scope: Exactly 2 new public tables
--   1. installation_jobs
--   2. job_assignments
-- ==============================================================================

-- 1. TECHNICIAN ASSIGNMENT ROLE VALIDATION FUNCTION
create or replace function public.validate_job_assignment_technician_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select raw_app_meta_data ->> 'role' into v_role
  from auth.users
  where id = new.technician_user_id;

  if v_role is null or v_role != 'technician' then
    raise exception 'User % is not a registered technician', new.technician_user_id;
  end if;
  return new;
end;
$$;

-- Revoke client EXECUTE access on security definer validation trigger function
revoke execute on function public.validate_job_assignment_technician_role() from public, anon, authenticated;

-- ==============================================================================
-- 2. PUBLIC TABLES
-- ==============================================================================

-- 2.1 installation_jobs
create table public.installation_jobs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  job_type text not null check (job_type in ('installation', 'service')),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'blocked', 'completed', 'cancelled')),
  scheduled_for timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_installation_jobs_site_id on public.installation_jobs(site_id);
create index idx_installation_jobs_status on public.installation_jobs(status);
create index idx_installation_jobs_scheduled_for on public.installation_jobs(scheduled_for);

create trigger tr_installation_jobs_updated_at
  before update on public.installation_jobs
  for each row execute function public.handle_updated_at();

-- 2.2 job_assignments
create table public.job_assignments (
  job_id uuid not null references public.installation_jobs(id) on delete cascade,
  technician_user_id uuid not null references auth.users(id) on delete cascade,
  assignment_status text not null default 'assigned' check (assignment_status in ('assigned', 'accepted', 'completed', 'cancelled')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz null,
  primary key (job_id, technician_user_id),
  constraint chk_job_assignments_completed_at check (assignment_status != 'completed' or completed_at is not null)
);

create index idx_job_assignments_technician_user_id on public.job_assignments(technician_user_id);

create trigger tr_validate_job_assignment_technician_role
  before insert or update of technician_user_id on public.job_assignments
  for each row execute function public.validate_job_assignment_technician_role();

-- ==============================================================================
-- 3. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

alter table public.installation_jobs enable row level security;
alter table public.job_assignments enable row level security;

-- 3.1 installation_jobs: Read via active site membership, technician job assignment, or admin
create policy "installation_jobs_select_general" on public.installation_jobs
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'general'
    and exists (
      select 1
      from public.site_memberships sm
      where sm.site_id = installation_jobs.site_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
  );

create policy "installation_jobs_select_technician" on public.installation_jobs
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
    and exists (
      select 1
      from public.job_assignments ja
      where ja.job_id = installation_jobs.id
        and ja.technician_user_id = auth.uid()
        and ja.assignment_status in ('assigned', 'accepted', 'completed')
    )
  );

create policy "installation_jobs_select_admin" on public.installation_jobs
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 3.2 job_assignments: Own assignment read for technician, global read for admin
create policy "job_assignments_select_technician" on public.job_assignments
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'technician'
    and technician_user_id = auth.uid()
  );

create policy "job_assignments_select_admin" on public.job_assignments
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
