-- Migration: owner_invitation_storage
-- Description: Phase 6E-1 Secure Owner Invitation Storage Foundation

-- 1. Create internal private schema if not exists
create schema if not exists private;

-- Explicitly revoke client schema access from PUBLIC, anon, authenticated
revoke usage on schema private from public, anon, authenticated;
revoke create on schema private from public, anon, authenticated;

-- 2. Create private owner_invitations table
create table private.owner_invitations (
    id uuid primary key default gen_random_uuid(),
    site_id uuid not null references public.sites(id) on delete cascade,
    token_hash text not null unique,
    status text not null default 'pending',
    expires_at timestamptz not null,
    created_by_user_id uuid null references auth.users(id) on delete set null,
    claimed_by_user_id uuid null references auth.users(id) on delete set null,
    claimed_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint owner_invitations_status_check check (status in ('pending', 'claimed', 'revoked', 'expired')),
    constraint owner_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint owner_invitations_expiration_check check (expires_at > created_at),
    constraint owner_invitations_claimed_at_check check (status != 'claimed' or claimed_at is not null)
);

-- 3. Attach updated_at trigger reusing existing public.handle_updated_at()
create trigger handle_updated_at_private_owner_invitations
    before update on private.owner_invitations
    for each row
    execute function public.handle_updated_at();

-- 4. Create useful performance indexes
create index owner_invitations_site_id_idx on private.owner_invitations(site_id);
create index owner_invitations_status_idx on private.owner_invitations(status);
create index owner_invitations_expires_at_idx on private.owner_invitations(expires_at);

-- 5. Enable Row Level Security (zero client RLS policies created)
alter table private.owner_invitations enable row level security;

-- 6. Explicitly revoke table privileges from client roles
revoke all on table private.owner_invitations from public, anon, authenticated;
