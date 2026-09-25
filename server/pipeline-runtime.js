'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function createPipeline(root) {
  const context={window:{},console,Date,setTimeout,clearTimeout};
  context.window.window=context.window;
  vm.createContext(context);
  for(const file of ['js/data.js','js/engine.js','js/measurement.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  const engine=context.window.GasGuardEngine;
  engine.state.readings=[];
  engine.state.events=[];
  engine.state.source={mode:'device-ingress',restUrl:'',mqttUrl:'',topic:''};
  return { engine,measurement:context.window.GasGuardMeasurement };
}

module.exports = Object.freeze({ createPipeline });
