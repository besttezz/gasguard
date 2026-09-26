#include "telemetry.h"

String buildRawMeasurementPayload(
    const char* deviceId,
    const MeasurementReading& reading,
    const String& bootId,
    uint32_t sequence,
    const String& timestampIso
) {
    String json = "{";
    json += "\"deviceId\":\"" + String(deviceId) + "\",";
    json += "\"sensorId\":\"" + String(reading.sensorId) + "\",";
    json += "\"sensorType\":\"" + String(reading.sensorType) + "\",";
    json += "\"bootId\":\"" + bootId + "\",";
    json += "\"sequence\":" + String(sequence) + ",";
    json += "\"timestamp\":\"" + timestampIso + "\",";
    json += "\"raw\":{";
    json += "\"adc\":" + String(reading.rawAdc) + ",";
    json += "\"sensorVoltage\":" + String(reading.sensorVoltage, 3) + ",";
    if (reading.hasInputScale) {
        json += "\"inputAdjustedVoltage\":" + String(reading.inputAdjustedVoltage, 3) + ",";
    } else {
        json += "\"inputAdjustedVoltage\":null,";
    }
    json += "\"calibrationStatus\":\"" + String(reading.calibrationStatus) + "\"";
    json += "}";
    json += "}";
    return json;
}
