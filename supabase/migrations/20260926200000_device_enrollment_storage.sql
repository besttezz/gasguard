-- Migration: device_enrollment_storage
-- Description: Phase HW-3A Secure Device Enrollment Storage Foundation

-- 1. Ensure private schema exists (idempotent guard)
create schema if not exists private;

-- Explicitly revoke schema access from public, anon, authenticated
revoke usage on schema private from public, anon, authenticated;
revoke create on schema private from public, anon, authenticated;

-- 2. Create private.device_enrollment_tokens table
create table private.device_enrollment_tokens (
    id uuid primary key default gen_random_uuid(),
    device_id uuid not null references public.devices(id) on delete cascade,
    installation_job_id uuid not null references public.installation_jobs(id) on delete cascade,
    token_hash text not null unique,
    status text not null default 'pending',
    expires_at timestamptz not null,
    created_by_user_id uuid null references auth.users(id) on delete set null,
    claimed_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint device_enrollment_tokens_status_check check (status in ('pending', 'claimed', 'revoked', 'expired')),
    constraint device_enrollment_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint device_enrollment_tokens_expires_at_check check (expires_at > created_at),
    constraint device_enrollment_tokens_claimed_at_check check (status != 'claimed' or claimed_at is not null)
);

-- 3. Create private.device_credentials table
create table private.device_credentials (
    id uuid primary key default gen_random_uuid(),
    device_id uuid not null references public.devices(id) on delete cascade,
    credential_hash text not null unique,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    revoked_at timestamptz null,

    constraint device_credentials_status_check check (status in ('active', 'revoked')),
    constraint device_credentials_hash_check check (credential_hash ~ '^[0-9a-f]{64}$'),
    constraint device_credentials_revoked_at_check check (status != 'revoked' or revoked_at is not null)
);

-- Partial unique index: at most ONE active credential per device
create unique index idx_device_credentials_active_unique on private.device_credentials(device_id) where status = 'active';

-- 4. Attach updated_at triggers reusing public.handle_updated_at()
create trigger handle_updated_at_private_device_enrollment_tokens
    before update on private.device_enrollment_tokens
    for each row
    execute function public.handle_updated_at();

create trigger handle_updated_at_private_device_credentials
    before update on private.device_credentials
    for each row
    execute function public.handle_updated_at();

-- 5. Create useful performance indexes
create index idx_device_enrollment_tokens_device_id on private.device_enrollment_tokens(device_id);
create index idx_device_enrollment_tokens_job_id on private.device_enrollment_tokens(installation_job_id);
create index idx_device_enrollment_tokens_status on private.device_enrollment_tokens(status);
create index idx_device_enrollment_tokens_expires_at on private.device_enrollment_tokens(expires_at);

create index idx_device_credentials_device_id on private.device_credentials(device_id);
create index idx_device_credentials_status on private.device_credentials(status);

-- 6. Enable Row Level Security (zero client RLS policies created)
alter table private.device_enrollment_tokens enable row level security;
alter table private.device_credentials enable row level security;

-- 7. Explicitly revoke all table privileges from client roles
revoke all on table private.device_enrollment_tokens from public, anon, authenticated;
revoke all on table private.device_credentials from public, anon, authenticated;
