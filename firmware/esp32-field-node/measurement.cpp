#include "measurement.h"
#include <Arduino.h>

MeasurementReading sampleSensorChannel(const SensorDescriptor& desc) {
    MeasurementReading m;
    m.sensorId = desc.sensorId;
    m.sensorType = desc.sensorType;
    m.role = desc.role;
    m.calibrationStatus = "CALIBRATION_REQUIRED";
    m.isValid = false;
    m.hasInputScale = false;

    if (!desc.enabled) {
        m.rawAdc = 0;
        m.sensorVoltage = 0.0f;
        m.inputAdjustedVoltage = 0.0f;
        return m;
    }

    // Read 12-bit ADC raw integer
    m.rawAdc = (uint16_t)analogRead(desc.pin);
    
    // Platform calibrated pin voltage in millivolts
    uint32_t mV = analogReadMilliVolts(desc.pin);
    m.sensorVoltage = (float)mV / 1000.0f;
    
    // External divider corrected AO voltage (only if inputScale > 0)
    if (desc.inputScale > 0.0f) {
        m.inputAdjustedVoltage = m.sensorVoltage * desc.inputScale;
        m.hasInputScale = true;
    } else {
        m.inputAdjustedVoltage = 0.0f;
        m.hasInputScale = false;
    }
    
    m.isValid = true;
    return m;
}
