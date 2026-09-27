'use strict';

/**
 * Normalizes host strings for comparison by converting to lowercase and stripping
 * trailing dot or port numbers if present.
 */
function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return '';
  let cleaned = hostHeader.trim().toLowerCase();
  if (cleaned.endsWith('.')) {
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned.startsWith('[')) {
    const closingBracket = cleaned.indexOf(']');
    if (closingBracket > 0) {
      cleaned = cleaned.substring(0, closingBracket + 1);
    }
  } else {
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx >= 0) {
      cleaned = cleaned.substring(0, colonIdx);
    }
  }
  return cleaned;
}

/**
 * Checks if a bind host is a loopback interface.
 */
function isLoopbackHost(host) {
  if (!host || typeof host !== 'string') return false;
  const cleaned = host.trim().toLowerCase();
  return ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'].includes(cleaned);
}

/**
 * Evaluates safe remote gateway health status for GET /api/v1/health.
 * Never exposes secrets or confidential config values.
 */
function evaluateRemoteGatewayHealth({ serverConfig = {}, env = process.env } = {}) {
  const trustedTunnelMode = String(env.GASGUARD_TRUSTED_TUNNEL_MODE || '').toLowerCase() === 'true';
  const rawExpectedHost = String(env.GASGUARD_PUBLIC_DEVICE_HOST || '').trim();
  const expectedHostConfigured = rawExpectedHost.length > 0;
  const loopbackOrigin = isLoopbackHost(serverConfig.host) || (!serverConfig.lanMode && Boolean(serverConfig.host));

  let mode = 'LOCAL_ONLY';
  if (trustedTunnelMode) {
    if (!loopbackOrigin || !expectedHostConfigured) {
      mode = 'CONFIG_ERROR';
    } else {
      mode = 'TRUSTED_TUNNEL_READY';
    }
  }

  return {
    mode,
    trustedTunnelConfigured: trustedTunnelMode,
    expectedHostConfigured,
    loopbackOrigin
  };
}

/**
 * Classifies the security and source of incoming request transport.
 * Used to enforce HTTPS termination requirements for remote device enrollment and management.
 */
function classifyRequestTransport({ request, serverConfig = {}, env = process.env } = {}) {
  const trustedTunnelMode = String(env.GASGUARD_TRUSTED_TUNNEL_MODE || '').toLowerCase() === 'true';
  const expectedPublicHostRaw = String(env.GASGUARD_PUBLIC_DEVICE_HOST || '').trim();
  const expectedPublicHost = normalizeHost(expectedPublicHostRaw);
  const loopbackOrigin = isLoopbackHost(serverConfig.host) || (!serverConfig.lanMode && Boolean(serverConfig.host));
  const allowInsecureDev = String(env.GASGUARD_ALLOW_INSECURE_ENROLLMENT || '').toLowerCase() === 'true';

  const clientIp = request?.socket?.remoteAddress || '';
  const isLocalhostIp = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(clientIp);

  const rawHostHeader = request?.headers?.host || '';
  const normalizedReqHost = normalizeHost(rawHostHeader);
  const isLocalhostHost = ['127.0.0.1', 'localhost', '[::1]'].includes(normalizedReqHost);

  // 1. Evaluate Trusted Tunnel Mode (e.g. Cloudflare Tunnel reverse proxy)
  if (trustedTunnelMode) {
    if (!loopbackOrigin) {
      return {
        secure: false,
        source: 'UNTRUSTED',
        reason: 'CONFIG_ERROR: Trusted tunnel mode requires server origin bound to loopback interface'
      };
    }

    if (!expectedPublicHost) {
      return {
        secure: false,
        source: 'UNTRUSTED',
        reason: 'CONFIG_ERROR: GASGUARD_PUBLIC_DEVICE_HOST must be explicitly configured when trusted tunnel mode is enabled'
      };
    }

    // Forwarded Protocol Inspection
    const rawForwardedProto = request?.headers?.['x-forwarded-proto'];
    let forwardedProto = '';
    if (Array.isArray(rawForwardedProto)) {
      return {
        secure: false,
        source: 'UNTRUSTED',
        reason: 'Ambiguous multiple X-Forwarded-Proto headers received'
      };
    } else if (typeof rawForwardedProto === 'string') {
      const parts = rawForwardedProto.split(',').map(s => s.trim().toLowerCase());
      if (parts.length > 1 && new Set(parts).size > 1) {
        return {
          secure: false,
          source: 'UNTRUSTED',
          reason: 'Ambiguous mixed X-Forwarded-Proto values received'
        };
      }
      forwardedProto = parts[0] || '';
    }

    if (forwardedProto !== 'https') {
      return {
        secure: false,
        source: 'UNTRUSTED',
        reason: 'Trusted tunnel request rejected: X-Forwarded-Proto is not https'
      };
    }

    // Supplemental CF-Visitor check if present
    const cfVisitorHeader = request?.headers?.['cf-visitor'];
    if (cfVisitorHeader && typeof cfVisitorHeader === 'string') {
      try {
        const parsed = JSON.parse(cfVisitorHeader);
        if (parsed.scheme && String(parsed.scheme).toLowerCase() !== 'https') {
          return {
            secure: false,
            source: 'UNTRUSTED',
            reason: 'Trusted tunnel request rejected: CF-Visitor scheme is not https'
          };
        }
      } catch (_) {
        return {
          secure: false,
          source: 'UNTRUSTED',
          reason: 'Trusted tunnel request rejected: Malformed CF-Visitor header'
        };
      }
    }

    // Host Header Validation (Exact match on normalized hostname to prevent suffix attacks)
    const reqHostForCompare = normalizeHost(request?.headers?.['x-forwarded-host'] || rawHostHeader);
    if (!reqHostForCompare || reqHostForCompare !== expectedPublicHost) {
      return {
        secure: false,
        source: 'UNTRUSTED',
        reason: 'Trusted tunnel request rejected: Host header does not match expected public device host'
      };
    }

    return {
      secure: true,
      source: 'TRUSTED_TUNNEL',
      reason: 'Verified Cloudflare HTTPS tunnel request'
    };
  }

  // 2. Localhost Development Mode
  const isLocalhostRequest = !serverConfig.lanMode && isLocalhostIp && isLocalhostHost;
  if (isLocalhostRequest) {
    return {
      secure: true,
      source: 'LOCALHOST',
      reason: 'Localhost development request'
    };
  }

  // 3. Explicit Insecure Development Override
  if (allowInsecureDev) {
    return {
      secure: true,
      source: 'INSECURE_DEV_OVERRIDE',
      reason: 'Explicit insecure development override enabled'
    };
  }

  // 4. Fall closed
  return {
    secure: false,
    source: 'UNTRUSTED',
    reason: 'Non-HTTPS remote request without trusted tunnel configuration'
  };
}

module.exports = {
  normalizeHost,
  isLoopbackHost,
  evaluateRemoteGatewayHealth,
  classifyRequestTransport
};
