-- ==============================================================================
-- Owner app: shared floor plans and the member list of a site.
-- ==============================================================================
-- floor_plans keeps one plan per site (template or uploaded image + stove / tank / sensor pins)
-- so every phone of the household sees the same plan. Members and admins can read it;
-- only the site owner or an admin can change it.
-- site_members() lets an owner see who else belongs to their site (site_memberships RLS only
-- shows a user their own row).

-- 1. Owner-or-admin helper -------------------------------------------------------
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
      select 1
      from public.site_memberships sm
      where sm.site_id = p_site_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.membership_type = 'owner'
    );
$$;

revoke execute on function public.can_edit_site(uuid) from public, anon;
grant execute on function public.can_edit_site(uuid) to authenticated;

-- 2. floor_plans -------------------------------------------------------------------
create table public.floor_plans (
  site_id uuid primary key references public.sites(id) on delete cascade,
  plan jsonb not null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- An uploaded plan image is stored inline as a downscaled JPEG data URL; keep rows bounded.
  constraint chk_floor_plans_size check (pg_column_size(plan) <= 1500000),
  constraint chk_floor_plans_shape check (jsonb_typeof(plan) = 'object' and jsonb_typeof(plan -> 'pins') = 'array')
);

create trigger tr_floor_plans_updated_at
  before update on public.floor_plans
  for each row execute function public.handle_updated_at();

alter table public.floor_plans enable row level security;

create policy "floor_plans_select" on public.floor_plans
  for select to authenticated
  using (public.can_view_site(site_id));

create policy "floor_plans_insert" on public.floor_plans
  for insert to authenticated
  with check (public.can_edit_site(site_id) and updated_by = auth.uid());

create policy "floor_plans_update" on public.floor_plans
  for update to authenticated
  using (public.can_edit_site(site_id))
  with check (public.can_edit_site(site_id) and updated_by = auth.uid());

grant select, insert, update on table public.floor_plans to authenticated;
revoke all on table public.floor_plans from anon;

-- 3. site_members(): members of a site, for its owner or an admin ---------------------
create or replace function public.site_members(p_site_id uuid)
returns table (user_id uuid, membership_type text, status text, display_name text, email text, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sm.user_id, sm.membership_type, sm.status, p.display_name, u.email::text, sm.user_id = auth.uid()
  from public.site_memberships sm
  join auth.users u on u.id = sm.user_id
  left join public.profiles p on p.id = sm.user_id
  where sm.site_id = p_site_id
    and (public.can_edit_site(p_site_id) or sm.user_id = auth.uid())
  order by (sm.membership_type = 'owner') desc, sm.created_at;
$$;

revoke execute on function public.site_members(uuid) from public, anon;
grant execute on function public.site_members(uuid) to authenticated;
