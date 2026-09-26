-- Migration: device_enrollment_workflow
-- Description: Phase HW-3B Controlled Device Enrollment Issuance & Atomic Claim Functions

-- 1. Helper function for pgcrypto digest if extensions not in path
create or replace function public.issue_device_enrollment_token(
    p_device_id uuid,
    p_installation_job_id uuid,
    p_expires_in_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_caller_id uuid;
    v_caller_role text;
    v_device_site_id uuid;
    v_device_lifecycle text;
    v_job_site_id uuid;
    v_job_type text;
    v_job_status text;
    v_is_assigned boolean;
    v_effective_minutes integer;
    v_raw_token text;
    v_token_hash text;
    v_token_id uuid;
    v_expires_at timestamptz;
begin
    -- 1. Verify caller authentication
    v_caller_id := auth.uid();
    if v_caller_id is null then
        raise exception 'UNAUTHORIZED: Authentication required' using errcode = 'P0001';
    end if;

    -- Extract caller role from app_metadata
    v_caller_role := auth.jwt() -> 'app_metadata' ->> 'role';
    if v_caller_role is null or v_caller_role not in ('technician', 'admin') then
        raise exception 'UNAUTHORIZED: Only technician or admin roles may issue enrollment tokens' using errcode = 'P0001';
    end if;

    -- 2. Bound expiration duration (1..60 minutes, default 15)
    v_effective_minutes := coalesce(p_expires_in_minutes, 15);
    if v_effective_minutes < 1 or v_effective_minutes > 60 then
        raise exception 'INVALID_EXPIRATION: Expiration duration must be between 1 and 60 minutes' using errcode = 'P0001';
    end if;

    -- 3. Lock device row & verify existence & site & lifecycle
    select site_id, lifecycle_status
    into v_device_site_id, v_device_lifecycle
    from public.devices
    where id = p_device_id
    for update;

    if v_device_site_id is null then
        raise exception 'DEVICE_NOT_FOUND: Device does not exist' using errcode = 'P0001';
    end if;

    if v_device_lifecycle != 'registered' then
        raise exception 'DEVICE_NOT_ELIGIBLE: Device lifecycle status must be registered' using errcode = 'P0001';
    end if;

    -- 4. Verify installation job existence, type, site, and status
    select site_id, job_type, status
    into v_job_site_id, v_job_type, v_job_status
    from public.installation_jobs
    where id = p_installation_job_id;

    if v_job_site_id is null then
        raise exception 'JOB_NOT_FOUND: Installation job does not exist' using errcode = 'P0001';
    end if;

    if v_job_type != 'installation' then
        raise exception 'JOB_NOT_ELIGIBLE: Job type must be installation' using errcode = 'P0001';
    end if;

    if v_job_status not in ('scheduled', 'in_progress') then
        raise exception 'JOB_NOT_ELIGIBLE: Installation job status must be scheduled or in_progress' using errcode = 'P0001';
    end if;

    -- 5. Strict Site Binding Verification
    if v_device_site_id != v_job_site_id then
        raise exception 'SITE_MISMATCH: Device site does not match installation job site' using errcode = 'P0001';
    end if;

    -- 6. Technician Job Assignment Authorization
    if v_caller_role = 'technician' then
        select exists (
            select 1
            from public.job_assignments
            where job_id = p_installation_job_id
              and technician_user_id = v_caller_id
              and assignment_status in ('assigned', 'accepted')
        ) into v_is_assigned;

        if not v_is_assigned then
            raise exception 'UNAUTHORIZED: Technician is not assigned to this installation job' using errcode = 'P0001';
        end if;
    end if;

    -- 7. Revoke any existing pending tokens for this device
    update private.device_enrollment_tokens
    set status = 'revoked', updated_at = now()
    where device_id = p_device_id
      and status = 'pending';

    -- 8. Generate cryptographically secure raw token (256-bit / 64 hex chars)
    v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
    v_expires_at := now() + (v_effective_minutes || ' minutes')::interval;

    -- 9. Insert new pending enrollment token
    insert into private.device_enrollment_tokens (
        device_id,
        installation_job_id,
        token_hash,
        status,
        expires_at,
        created_by_user_id
    ) values (
        p_device_id,
        p_installation_job_id,
        v_token_hash,
        'pending',
        v_expires_at,
        v_caller_id
    ) returning id into v_token_id;

    -- Return raw token ONCE along with metadata
    return jsonb_build_object(
        'token_id', v_token_id,
        'device_id', p_device_id,
        'installation_job_id', p_installation_job_id,
        'expires_at', v_expires_at,
        'raw_enrollment_token', v_raw_token
    );
end;
$$;

-- Revoke EXECUTE from PUBLIC and anon roles; Grant ONLY to authenticated
revoke execute on function public.issue_device_enrollment_token(uuid, uuid, integer) from public, anon;
grant execute on function public.issue_device_enrollment_token(uuid, uuid, integer) to authenticated;


-- 2. ATOMIC CLAIM FUNCTION (Server-only RPC, service_role execution)
create or replace function public.claim_device_enrollment(
    p_raw_enrollment_token text,
    p_expected_device_uid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_incoming_hash text;
    v_token_rec record;
    v_device_rec record;
    v_job_rec record;
    v_raw_credential text;
    v_credential_hash text;
    v_cred_id uuid;
    v_now timestamptz := now();
begin
    -- 1. Validate raw token input
    if p_raw_enrollment_token is null or length(trim(p_raw_enrollment_token)) != 64 then
        raise exception 'INVALID_TOKEN_FORMAT: Raw enrollment token must be 64 hex characters' using errcode = 'P0001';
    end if;

    -- Compute SHA-256 hash of incoming raw token
    v_incoming_hash := encode(extensions.digest(lower(trim(p_raw_enrollment_token)), 'sha256'), 'hex');

    -- 2. Lock and fetch matching enrollment token row
    select id, device_id, installation_job_id, status, expires_at
    into v_token_rec
    from private.device_enrollment_tokens
    where token_hash = v_incoming_hash
    for update;

    if v_token_rec.id is null then
        raise exception 'ENROLLMENT_NOT_FOUND: Invalid or unrecognized enrollment token' using errcode = 'P0001';
    end if;

    -- 3. Check status and expiration
    if v_token_rec.status = 'claimed' then
        raise exception 'ENROLLMENT_ALREADY_CLAIMED: Token has already been consumed' using errcode = 'P0001';
    end if;

    if v_token_rec.status = 'revoked' then
        raise exception 'ENROLLMENT_REVOKED: Token has been revoked' using errcode = 'P0001';
    end if;

    if v_token_rec.expires_at <= v_now then
        -- Atomically mark expired
        update private.device_enrollment_tokens
        set status = 'expired', updated_at = v_now
        where id = v_token_rec.id;

        raise exception 'ENROLLMENT_EXPIRED: Token has expired' using errcode = 'P0001';
    end if;

    if v_token_rec.status != 'pending' then
        raise exception 'ENROLLMENT_NOT_AVAILABLE: Token status is not pending' using errcode = 'P0001';
    end if;

    -- 4. Lock & verify Device
    select id, site_id, device_uid, lifecycle_status
    into v_device_rec
    from public.devices
    where id = v_token_rec.device_id
    for update;

    if v_device_rec.id is null then
        raise exception 'DEVICE_NOT_FOUND: Associated device does not exist' using errcode = 'P0001';
    end if;

    if p_expected_device_uid is not null and p_expected_device_uid != '' then
        if v_device_rec.device_uid != p_expected_device_uid then
            raise exception 'DEVICE_IDENTITY_MISMATCH: Provided device_uid does not match token binding' using errcode = 'P0001';
        end if;
    end if;

    if v_device_rec.lifecycle_status != 'registered' then
        raise exception 'DEVICE_NOT_ELIGIBLE: Device lifecycle status is not registered' using errcode = 'P0001';
    end if;

    -- 5. Lock & verify Installation Job
    select id, site_id, job_type, status
    into v_job_rec
    from public.installation_jobs
    where id = v_token_rec.installation_job_id;

    if v_job_rec.id is null then
        raise exception 'JOB_NOT_FOUND: Associated installation job does not exist' using errcode = 'P0001';
    end if;

    if v_job_rec.job_type != 'installation' or v_job_rec.status not in ('scheduled', 'in_progress') then
        raise exception 'JOB_NOT_ELIGIBLE: Associated installation job is not eligible' using errcode = 'P0001';
    end if;

    -- 6. Strict Site Binding Verification
    if v_device_rec.site_id != v_job_rec.site_id then
        raise exception 'SITE_MISMATCH: Device site does not match installation job site' using errcode = 'P0001';
    end if;

    -- 7. Verify no ACTIVE credential already exists for this device
    if exists (
        select 1
        from private.device_credentials
        where device_id = v_device_rec.id
          and status = 'active'
    ) then
        raise exception 'ACTIVE_CREDENTIAL_EXISTS: Device already has an active credential' using errcode = 'P0001';
    end if;

    -- 8. Generate cryptographically secure Device Credential (256-bit / 64 hex chars)
    v_raw_credential := encode(extensions.gen_random_bytes(32), 'hex');
    v_credential_hash := encode(extensions.digest(v_raw_credential, 'sha256'), 'hex');

    -- 9. Insert private.device_credentials (status = 'active')
    insert into private.device_credentials (
        device_id,
        credential_hash,
        status
    ) values (
        v_device_rec.id,
        v_credential_hash,
        'active'
    ) returning id into v_cred_id;

    -- 10. Mark enrollment token as claimed
    update private.device_enrollment_tokens
    set status = 'claimed',
        claimed_at = v_now,
        updated_at = v_now
    where id = v_token_rec.id;

    -- 11. Transition Device lifecycle_status to commissioning
    update public.devices
    set lifecycle_status = 'commissioning',
        updated_at = v_now
    where id = v_device_rec.id;

    -- Return raw device credential ONCE
    return jsonb_build_object(
        'device_id', v_device_rec.id,
        'device_uid', v_device_rec.device_uid,
        'raw_device_credential', v_raw_credential,
        'credential_created_at', v_now,
        'device_lifecycle', 'commissioning'
    );
end;
$$;

-- Revoke EXECUTE from PUBLIC, anon, authenticated; Grant ONLY to service_role
revoke execute on function public.claim_device_enrollment(text, text) from public, anon, authenticated;
grant execute on function public.claim_device_enrollment(text, text) to service_role;
