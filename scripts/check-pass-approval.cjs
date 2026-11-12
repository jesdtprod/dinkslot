const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let queries=0,notices=[];
const D={ui:{toast:(text)=>notices.push(text)},sb:{from(){queries++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{status:'cancelled'}})}}}};
vm.runInNewContext(fs.readFileSync('js/booking.js','utf8'),{window:{DS:D},console});
(async()=>{
  for(const status of ['pending','rejected','cancelled','expired']) await D.booking.openPass({id:'id',status,reference_code:'REF'});
  assert.equal(queries,0);assert.equal(notices.length,4);
  await D.booking.openPass({id:'id',status:'approved',reference_code:'REF'});
  assert.equal(queries,1);assert.equal(notices.length,5);
  assert.ok(notices.every(text=>text.includes('only after')));
  console.log('Unapproved and stale cancelled bookings cannot generate QR passes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
