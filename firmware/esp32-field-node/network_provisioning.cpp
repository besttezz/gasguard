#include "network_provisioning.h"

const char* nodeStateToString(NodeState state) {
    switch (state) {
        case NODE_STATE_UNPROVISIONED: return "UNPROVISIONED";
        case NODE_STATE_PROVISIONING: return "PROVISIONING";
        case NODE_STATE_CONNECTING_WIFI: return "CONNECTING_WIFI";
        case NODE_STATE_WIFI_CONNECTED: return "WIFI_CONNECTED";
        case NODE_STATE_CONNECTING_INGRESS: return "CONNECTING_INGRESS";
        case NODE_STATE_READY: return "READY";
        case NODE_STATE_CALIBRATION_REQUIRED: return "CALIBRATION_REQUIRED";
        case NODE_STATE_OFFLINE: return "OFFLINE";
        case NODE_STATE_CONFIG_ERROR: return "CONFIG_ERROR";
        default: return "UNKNOWN";
    }
}

void initBackoff(BoundedBackoff& backoff, uint32_t initialMs, uint32_t maxMs) {
    backoff.attempt = 0;
    backoff.currentDelayMs = initialMs;
    backoff.maxDelayMs = maxMs;
}

uint32_t calculateNextBackoffMs(BoundedBackoff& backoff) {
    backoff.attempt++;
    uint32_t nextDelay = backoff.currentDelayMs * 2;
    if (nextDelay > backoff.maxDelayMs) {
        nextDelay = backoff.maxDelayMs;
    }
    backoff.currentDelayMs = nextDelay;
    return backoff.currentDelayMs;
}

void resetBackoff(BoundedBackoff& backoff) {
    backoff.attempt = 0;
    backoff.currentDelayMs = 1000;
}
