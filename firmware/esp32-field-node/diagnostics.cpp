#include "diagnostics.h"

String formatFieldDiagnosticsJson(const FieldDiagnostics& diag) {
    String json = "{";
    json += "\"deviceId\":\"" + String(diag.deviceId) + "\",";
    json += "\"bootId\":\"" + diag.bootId + "\",";
    json += "\"firmwareVersion\":\"" + String(diag.firmwareVersion) + "\",";
    json += "\"state\":\"" + String(nodeStateToString(diag.currentState)) + "\",";
    json += "\"wifiConnected\":" + String(diag.wifiConnected ? "true" : "false") + ",";
    json += "\"rssi\":" + String(diag.rssi) + ",";
    json += "\"ipAddress\":\"" + diag.ipAddress + "\",";
    json += "\"ingressReachable\":" + String(diag.ingressReachable ? "true" : "false") + ",";
    json += "\"lastHttpStatus\":" + String(diag.lastHttpStatus) + ",";
    json += "\"mq6\":{";
    json += "\"rawAdc\":" + String(diag.mq6Reading.rawAdc) + ",";
    json += "\"voltage\":" + String(diag.mq6Reading.sensorVoltage, 3) + ",";
    json += "\"adjustedVoltage\":" + String(diag.mq6Reading.inputAdjustedVoltage, 3) + ",";
    json += "\"calibrationStatus\":\"" + String(diag.mq6Reading.calibrationStatus) + "\"";
    json += "},";
    json += "\"mq3\":{";
    json += "\"rawAdc\":" + String(diag.mq3Reading.rawAdc) + ",";
    json += "\"voltage\":" + String(diag.mq3Reading.sensorVoltage, 3) + ",";
    json += "\"adjustedVoltage\":" + String(diag.mq3Reading.inputAdjustedVoltage, 3) + ",";
    json += "\"calibrationStatus\":\"" + String(diag.mq3Reading.calibrationStatus) + "\"";
    json += "},";
    json += "\"sequence\":" + String(diag.sequence) + ",";
    json += "\"uptimeMs\":" + String(diag.uptimeMs) + ",";
    json += "\"credentialsRedacted\":true"; // Safety confirmation
    json += "}";
    return json;
}

void printFieldDiagnosticsSerial(const FieldDiagnostics& diag) {
    Serial.println("==================================================");
    Serial.printf("FIELD DIAGNOSTICS [%s]\n", diag.deviceId);
    Serial.printf("State: %s | BootID: %s | FW: %s\n", nodeStateToString(diag.currentState), diag.bootId.c_str(), diag.firmwareVersion);
    Serial.printf("Wi-Fi: %s (RSSI %d dBm) | IP: %s\n", diag.wifiConnected ? "CONNECTED" : "DISCONNECTED", diag.rssi, diag.ipAddress.c_str());
    Serial.printf("Ingress Reachable: %s | Last HTTP Status: %d\n", diag.ingressReachable ? "YES" : "NO", diag.lastHttpStatus);
    Serial.printf("MQ-6 Primary LPG  : ADC=%u | Vpin=%.3fV | Vao=%.3fV | Status=%s\n",
                  diag.mq6Reading.rawAdc, diag.mq6Reading.sensorVoltage, diag.mq6Reading.inputAdjustedVoltage, diag.mq6Reading.calibrationStatus);
    Serial.printf("MQ-3 Aux Context  : ADC=%u | Vpin=%.3fV | Vao=%.3fV | Status=%s\n",
                  diag.mq3Reading.rawAdc, diag.mq3Reading.sensorVoltage, diag.mq3Reading.inputAdjustedVoltage, diag.mq3Reading.calibrationStatus);
    Serial.printf("Sequence: %u | Uptime: %u ms | Secrets: REDACTED\n", diag.sequence, diag.uptimeMs);
    Serial.println("==================================================");
}
