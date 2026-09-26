#ifndef GASGUARD_PROVISIONAL_CONFIG_EXAMPLE_H
#define GASGUARD_PROVISIONAL_CONFIG_EXAMPLE_H

// =============================================================================
// GASGUARD PROVISIONS CONFIGURATION EXAMPLE
// DO NOT COMMIT REAL SECRETS IN SOURCE CONTROL.
// Copy this file to provisioning_secrets.h for local device configuration.
// =============================================================================

#define GASGUARD_PROV_SERVICE_PREFIX "PROV_GG_"
#define GASGUARD_PROV_SECURITY_MODE 1 // 1 = Security 1 (X25519 + AES-CTR + PoP authentication). Security 0 is FORBIDDEN.

// Proof of Possession (PoP) placeholder.
// Must be set per device outside committed source. Static/default strings are strictly prohibited.
#define GASGUARD_PROV_POP_PLACEHOLDER ""

// SoftAP service key (null/empty if open AP with PoP session encryption/authentication).
#define GASGUARD_PROV_SERVICE_KEY ""

#endif // GASGUARD_PROVISIONAL_CONFIG_EXAMPLE_H
