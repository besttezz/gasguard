#ifndef GASGUARD_PROVISIONING_SECRETS_EXAMPLE_H
#define GASGUARD_PROVISIONING_SECRETS_EXAMPLE_H

// =============================================================================
// GASGUARD PROVISIONING LOCAL SECRETS TEMPLATE
// DO NOT COMMIT REAL SECRETS IN SOURCE CONTROL.
// Copy this file to provisioning_secrets.h for local device configuration.
// provisioning_secrets.h is ignored by Git (.gitignore).
// =============================================================================

// Device-specific high-entropy Proof of Possession (PoP). Minimum 12 characters.
// Must be randomly generated per device outside source control.
#define GASGUARD_PROV_POP "DEVICE_SPECIFIC_POP_GOES_HERE"

// SoftAP association key (optional; NULL if open AP with PoP session protection).
#define GASGUARD_PROV_SERVICE_KEY NULL

#endif // GASGUARD_PROVISIONING_SECRETS_EXAMPLE_H
