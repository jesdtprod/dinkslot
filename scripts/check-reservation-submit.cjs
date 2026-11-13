const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/booking.js','utf8');
const helper = source.slice(source.indexOf('  function setReserveLabel'),source.indexOf('  // "2026-11-12'));
const actions = source.slice(source.indexOf('    function summary()'),source.indexOf('    var bd = q("#bd", root);',source.indexOf('    async function doReserve()')));
const label = {textContent:'Confirm & Pay'};
const button = {disabled:false,querySelector:()=>label};
let finish, calls = 0;
const state = {court:{id:'court'},start:0,count:1,slots:[{s:new Date(),e:new Date(Date.now()+3600000)}],reserving:false};
const context = {isGuest:false,S:state,root:{},keys:{},uuid:()=> 'attempt',rangeOk:()=>true,
  q:selector=>selector==='#reserve-sidebar'?button:null,
  msg(){},nice:e=>e.message,sb:{rpc(){calls++;return new Promise(resolve=>{finish=resolve;});}}
};
vm.createContext(context);vm.runInContext(helper+actions,context);
(async()=>{
  const first=context.doReserve();
  assert.equal(label.textContent,'Holding slot...');assert.equal(button.disabled,true);
  context.summary();await context.doReserve();assert.equal(calls,1);
  assert.equal(label.textContent,'Holding slot...');
  finish({error:{message:'Network unavailable'}});await first;
  assert.equal(state.reserving,false);assert.equal(button.disabled,false);
  assert.equal(label.textContent,'Confirm & Pay');
  state.start=null;context.summary();assert.equal(button.disabled,true);
  assert.equal(label.textContent,'Confirm & Pay');
  console.log('Reservation loading label, live refresh guard, duplicate submit, and error recovery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
