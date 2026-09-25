'use strict';
const virtual=require('../js/virtual-esp32.js');
const scenario=(process.argv[2]||'NORMAL').toUpperCase();
virtual.send({scenario,deviceKey:process.env.GASGUARD_TEST_DEVICE_KEY}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
