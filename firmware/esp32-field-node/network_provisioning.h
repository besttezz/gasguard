#ifndef GASGUARD_NETWORK_PROVISIONING_H
#define GASGUARD_NETWORK_PROVISIONING_H

#include <Arduino.h>

enum NodeState {
    NODE_STATE_UNPROVISIONED = 0,
    NODE_STATE_PROVISIONING = 1,
    NODE_STATE_CONNECTING_WIFI = 2,
    NODE_STATE_WIFI_CONNECTED = 3,
    NODE_STATE_CONNECTING_INGRESS = 4,
    NODE_STATE_READY = 5,
    NODE_STATE_CALIBRATION_REQUIRED = 6,
    NODE_STATE_OFFLINE = 7,
    NODE_STATE_CONFIG_ERROR = 8
};

const char* nodeStateToString(NodeState state);

struct BoundedBackoff {
    uint32_t attempt;
    uint32_t currentDelayMs;
    uint32_t maxDelayMs;
};

void initBackoff(BoundedBackoff& backoff, uint32_t initialMs = 1000, uint32_t maxMs = 30000);
uint32_t calculateNextBackoffMs(BoundedBackoff& backoff);
void resetBackoff(BoundedBackoff& backoff);

#endif // GASGUARD_NETWORK_PROVISIONING_H
