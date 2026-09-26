#include "diagnostics.h"

String formatFieldDiagnosticsJson(const FieldDiagnostics& diag) {
    String json = "{";
    json += "\"deviceId\":\"" + String(diag.deviceId) + "\",";
    json += "\"bootId\":\"" + diag.bootId + "\",";
    json += "\"firmwareVersion\":\"" + String(diag.firmwareVersion) + "\",";
    json += "\"profileConfirmed\":" + String(diag.profileConfirmed ? "true" : "false") + ",";
    json += "\"state\":\"" + String(nodeStateToString(diag.currentState)) + "\",";
    json += "\"wifiConnected\":" + String(diag.wifiConnected ? "true" : "false") + ",";
    json += "\"rssi\":" + String(diag.rssi) + ",";
    json += "\"ipAddress\":\"" + diag.ipAddress + "\",";
    json += "\"ingressReachable\":" + String(diag.ingressReachable ? "true" : "false") + ",";
    json += "\"mq6LastHttpStatus\":" + String(diag.mq6LastHttpStatus) + ",";
    json += "\"mq3LastHttpStatus\":" + String(diag.mq3LastHttpStatus) + ",";
    json += "\"nextIngressAttemptInMs\":" + String(diag.nextIngressAttemptInMs) + ",";
    json += "\"provisioningServiceName\":\"" + diag.provisioningServiceName + "\",";
    json += "\"provisioningSecurityMode\":" + String(diag.provisioningSecurityMode) + ",";
    json += "\"hasDeviceCredential\":" + String(diag.hasDeviceCredential ? "true" : "false") + ",";
    json += "\"softApProvisioning\":\"" + String(diag.softApStatus ? diag.softApStatus : "PROTECTED_SOFTAP_SECURITY_1") + "\",";
    json += "\"mq6\":{";
    json += "\"rawAdc\":" + String(diag.mq6Reading.rawAdc) + ",";
    if (diag.mq6Reading.sensorVoltage > 0.0f) {
        json += "\"voltage\":" + String(diag.mq6Reading.sensorVoltage, 3) + ",";
    } else {
        json += "\"voltage\":null,";
    }
    if (diag.mq6Reading.hasInputScale) {
        json += "\"adjustedVoltage\":" + String(diag.mq6Reading.inputAdjustedVoltage, 3) + ",";
    } else {
        json += "\"adjustedVoltage\":null,";
    }
    json += "\"calibrationStatus\":\"" + String(diag.mq6Reading.calibrationStatus) + "\"";
    json += "},";
    json += "\"mq3\":{";
    json += "\"rawAdc\":" + String(diag.mq3Reading.rawAdc) + ",";
    if (diag.mq3Reading.sensorVoltage > 0.0f) {
        json += "\"voltage\":" + String(diag.mq3Reading.sensorVoltage, 3) + ",";
    } else {
        json += "\"voltage\":null,";
    }
    if (diag.mq3Reading.hasInputScale) {
        json += "\"adjustedVoltage\":" + String(diag.mq3Reading.inputAdjustedVoltage, 3) + ",";
    } else {
        json += "\"adjustedVoltage\":null,";
    }
    json += "\"calibrationStatus\":\"" + String(diag.mq3Reading.calibrationStatus) + "\"";
    json += "},";
    json += "\"mq6Sequence\":" + String(diag.mq6Sequence) + ",";
    json += "\"mq3Sequence\":" + String(diag.mq3Sequence) + ",";
    json += "\"uptimeMs\":" + String(diag.uptimeMs) + ",";
    json += "\"credentialsRedacted\":true"; // Safety confirmation
    json += "}";
    return json;
}

void printFieldDiagnosticsSerial(const FieldDiagnostics& diag) {
    Serial.println("==================================================");
    Serial.printf("FIELD DIAGNOSTICS [%s]\n", diag.deviceId);
    Serial.printf("Profile Confirmed: %s | State: %s | BootID: %s | FW: %s\n",
                  diag.profileConfirmed ? "YES" : "NO (UNCONFIRMED)", nodeStateToString(diag.currentState), diag.bootId.c_str(), diag.firmwareVersion);
    Serial.printf("Wi-Fi: %s (RSSI %d dBm) | IP: %s\n", diag.wifiConnected ? "CONNECTED" : "DISCONNECTED", diag.rssi, diag.ipAddress.c_str());
    Serial.printf("Prov Service: %s (SecMode: %u) | DeviceCred: %s\n",
                  diag.provisioningServiceName.c_str(), diag.provisioningSecurityMode, diag.hasDeviceCredential ? "PRESENT" : "MISSING");
    Serial.printf("Ingress Reachable: %s | MQ6 HTTP: %d | MQ3 HTTP: %d | Retry In: %u ms\n",
                  diag.ingressReachable ? "YES" : "NO", diag.mq6LastHttpStatus, diag.mq3LastHttpStatus, diag.nextIngressAttemptInMs);
    Serial.printf("MQ-6 Primary LPG  : ADC=%u | Vpin=%s | Vao=%s | Status=%s | Seq=%u\n",
                  diag.mq6Reading.rawAdc,
                  diag.mq6Reading.sensorVoltage > 0.0f ? String(diag.mq6Reading.sensorVoltage, 3).c_str() : "UNSET",
                  diag.mq6Reading.hasInputScale ? String(diag.mq6Reading.inputAdjustedVoltage, 3).c_str() : "UNCONFIGURED",
                  diag.mq6Reading.calibrationStatus, diag.mq6Sequence);
    Serial.printf("MQ-3 Aux Context  : ADC=%u | Vpin=%s | Vao=%s | Status=%s | Seq=%u\n",
                  diag.mq3Reading.rawAdc,
                  diag.mq3Reading.sensorVoltage > 0.0f ? String(diag.mq3Reading.sensorVoltage, 3).c_str() : "UNSET",
                  diag.mq3Reading.hasInputScale ? String(diag.mq3Reading.inputAdjustedVoltage, 3).c_str() : "UNCONFIGURED",
                  diag.mq3Reading.calibrationStatus, diag.mq3Sequence);
    Serial.printf("Uptime: %u ms | Secrets: REDACTED\n", diag.uptimeMs);
    Serial.println("==================================================");
}
