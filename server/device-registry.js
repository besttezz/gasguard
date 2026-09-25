'use strict';

const devices = Object.freeze({
  'ESP32-KITCHEN-01': Object.freeze({ deviceId:'ESP32-KITCHEN-01', workspaceId:'hardware-pilot', source:'REAL_DEVICE', credentialEnv:'GASGUARD_REAL_DEVICE_KEY' }),
  'SIM-ESP32-KITCHEN-01': Object.freeze({ deviceId:'SIM-ESP32-KITCHEN-01', workspaceId:'device-test', source:'TEST_DEVICE', credentialEnv:'GASGUARD_TEST_DEVICE_KEY' })
});

const resolve = deviceId => devices[deviceId] || null;
const credentialsFromEnv = env => Object.fromEntries(Object.values(devices).map(device => [device.deviceId, env[device.credentialEnv] || null]));

module.exports = Object.freeze({ devices, resolve, credentialsFromEnv });
