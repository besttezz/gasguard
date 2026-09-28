-- Migration: device_credential_verification
-- Description: Phase HW-3C1 Server Device Verification RPC Function

create or replace function public.verify_device_credential(
    p_device_uid text,
    p_credential_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_device_rec record;
    v_cred_rec record;
begin
    -- 1. Input validation
    if p_device_uid is null or trim(p_device_uid) = '' or length(trim(p_device_uid)) > 128 then
        return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
    end if;

    if p_credential_hash is null or p_credential_hash !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
    end if;

    -- 2. Lookup device in public.devices
    select id, site_id, zone_id, device_type, lifecycle_status, device_uid
    into v_device_rec
    from public.devices
    where device_uid = trim(p_device_uid);

    if v_device_rec.id is null then
        return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
    end if;

    -- Check lifecycle status must be in ('commissioning', 'active')
    -- Reject ('registered', 'retired')
    if v_device_rec.lifecycle_status not in ('commissioning', 'active') then
        return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
    end if;

    -- 3. Lookup active credential in private.device_credentials
    select id, credential_hash, status
    into v_cred_rec
    from private.device_credentials
    where device_id = v_device_rec.id
      and credential_hash = p_credential_hash
      and status = 'active';

    if v_cred_rec.id is null then
        return jsonb_build_object('valid', false, 'code', 'INVALID_DEVICE_CREDENTIAL');
    end if;

    -- 4. Return ONLY non-secret metadata
    return jsonb_build_object(
        'valid', true,
        'device_id', v_device_rec.id,
        'device_uid', v_device_rec.device_uid,
        'site_id', v_device_rec.site_id,
        'zone_id', v_device_rec.zone_id,
        'device_type', v_device_rec.device_type,
        'lifecycle_status', v_device_rec.lifecycle_status
    );
end;
$$;

-- Revoke EXECUTE from PUBLIC, anon, and authenticated; Grant ONLY to service_role
revoke execute on function public.verify_device_credential(text, text) from public, anon, authenticated;
grant execute on function public.verify_device_credential(text, text) to service_role;
