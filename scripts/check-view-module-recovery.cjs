const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/app.js','utf8');
const helper = source.slice(source.indexOf('  var pendingViewModules = {}'),source.indexOf('  async function render()'));
let mode = 'success', requests = 0;
const DS = {};
const context = {window:{DS},Date,Error,Promise,document:{
  createElement(){return {remove(){}};},head:{appendChild(script){
    requests++;
    queueMicrotask(()=>{if(mode==='success'){DS.player={render(){}};script.onload();}else script.onerror();});
  }}
}};
vm.createContext(context);vm.runInContext(helper,context);
(async()=>{
  const [a,b]=await Promise.all([context.ensureViewModule('player'),context.ensureViewModule('player')]);
  assert.equal(a,b);assert.equal(requests,1);
  assert.equal(await context.ensureViewModule('player'),a);assert.equal(requests,1);
  delete DS.player;mode='failure';
  await assert.rejects(context.ensureViewModule('player'),/Check your connection/);
  mode='success';assert.ok((await context.ensureViewModule('player')).render);
  assert.equal(requests,3);
  console.log('Missing view module recovery, shared loads, and retry passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
