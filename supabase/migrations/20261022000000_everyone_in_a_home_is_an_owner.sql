-- For now everyone in a home has the same rights as its owner (team decision, 21 Oct 2026):
-- they can edit the floor plan, invite and remove people, and record gas-care dates.
-- site_memberships.membership_type is kept so per-person rights can come back later, case by case;
-- to restore them, drop the trigger below and set membership_type per person again.

update public.site_memberships set membership_type = 'owner' where membership_type <> 'owner';
update private.site_invitations set membership_type = 'owner' where membership_type <> 'owner';

create or replace function private.force_owner_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.membership_type := 'owner';
  return new;
end;
$$;

revoke all on function private.force_owner_membership() from public, anon, authenticated;

create trigger tr_site_memberships_everyone_owner
  before insert or update of membership_type on public.site_memberships
  for each row execute function private.force_owner_membership();

create trigger tr_site_invitations_everyone_owner
  before insert or update of membership_type on private.site_invitations
  for each row execute function private.force_owner_membership();
