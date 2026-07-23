'use strict';
const path=require('path');
const engine=require('./engine-manager');
const MANIFEST_URL='https://raw.githubusercontent.com/HikarlosWRD/WrdInterpEngine/main/releases/release-manifest.json';
async function installFromPanel(updateUI){return engine.installEngine({manifestUrl:MANIFEST_URL,installerPath:path.join(__dirname,'install-engine.ps1'),onProgress:p=>updateUI(p.percent,p.message)})}
async function interpolateFromPanel(input,output,factor,appendLog){return engine.interpolate({input,output,factor,scale:1.0,precision:'fp16',onLog:appendLog})}
module.exports={installFromPanel,interpolateFromPanel};
