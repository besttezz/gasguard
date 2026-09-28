'use strict';
// Send virtual ESP32 packets. Local dev server by default; set GASGUARD_BASE_URL to target the website, e.g.
//   $env:GASGUARD_BASE_URL='https://gasguard-bu.pages.dev'; $env:GASGUARD_TEST_DEVICE_KEY='<64 hex>'; npm run virtual:esp32 -- NORMAL
const virtual=require('../js/virtual-esp32.js');
const scenario=(process.argv[2]||'NORMAL').toUpperCase();
const baseUrl=process.env.GASGUARD_BASE_URL||undefined;
// A fresh boot id per run keeps repeated runs from being treated as duplicate packets.
const options={bootId:`virtual-${Date.now().toString(36)}`,startTime:new Date().toISOString()};
virtual.send({scenario,baseUrl,deviceKey:process.env.GASGUARD_TEST_DEVICE_KEY,options}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
