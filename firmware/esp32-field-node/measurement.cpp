#include "measurement.h"
#include <Arduino.h>

MeasurementReading sampleSensorChannel(const SensorDescriptor& desc) {
    MeasurementReading m;
    m.sensorId = desc.sensorId;
    m.sensorType = desc.sensorType;
    m.role = desc.role;
    m.calibrationStatus = "CALIBRATION_REQUIRED";
    m.isValid = false;

    if (!desc.enabled) {
        m.rawAdc = 0;
        m.sensorVoltage = 0.0f;
        m.inputAdjustedVoltage = 0.0f;
        return m;
    }

    // Read 12-bit ADC (0..4095)
    m.rawAdc = (uint16_t)analogRead(desc.pin);
    
    // Calibrated pin voltage (0 to 3.3V)
    m.sensorVoltage = ((float)m.rawAdc / 4095.0f) * 3.3f;
    
    // External divider corrected AO voltage
    m.inputAdjustedVoltage = m.sensorVoltage * desc.inputScale;
    
    m.isValid = true;
    return m;
}
