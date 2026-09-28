#ifndef GASGUARD_PROVISIONING_CONFIG_H
#define GASGUARD_PROVISIONING_CONFIG_H

#define GASGUARD_PROV_SERVICE_PREFIX "PROV_GG_"
#define GASGUARD_PROV_SECURITY_MODE 1 // 1 = Security 1 (X25519 + AES-CTR + PoP). Security 0 FORBIDDEN.

#if __has_include("provisioning_secrets.h")
  #include "provisioning_secrets.h"
  #define GASGUARD_HAS_PROVISIONING_SECRETS true
#else
  #define GASGUARD_HAS_PROVISIONING_SECRETS false
  #define GASGUARD_PROV_POP ""
  #define GASGUARD_PROV_SERVICE_KEY NULL
#endif

#endif // GASGUARD_PROVISIONING_CONFIG_H
