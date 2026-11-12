const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let failure = false, statusFilter = [], records = null;
const pending = {id:'pending',tenant_id:'club',court_id:'court',player_id:'player',status:'pending',reference_code:'NEEDS-REVIEW',starts_at:'2020-01-01T01:00:00Z',ends_at:'2020-01-01T02:00:00Z',amount:200,guest_name:'Guest'};
const D = {friendly:error=>error.message,state:{user:{id:'staff'}},esc:x=>String(x).replace(/</g,'&lt;'),ui:{emptyState:(title)=>title},sb:{
  from(table) {
    const query={select(){return this;},eq(){return this;},in(column,values){if(column==='status')statusFilter=values;return this;},or(value){filter=value;return this;},order(){return this;},then(resolve,reject){return Promise.resolve(table==='bookings'?{data:failure?null:(records || [pending]),error:failure?{message:'Network unavailable'}:null}:{data:table==='club_players'?[{id:'player',display_name:'NICKNAME'}]:[]}).then(resolve,reject);}};
    return query;
  },rpc(){return Promise.resolve({data:[{player_id:'player',full_name:'Alex Morgan',phone:'09171234567'}]});},channel(){return {on(){return this;},subscribe(){return this;}};}
}};
vm.runInNewContext(fs.readFileSync('js/booking.js','utf8'),{window:{DS:D},document:{body:{contains:()=>true}},setInterval:()=>1,clearInterval(){},console,Date,Set,URLSearchParams});
function box(){return {innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]};}
(async()=>{
  const normal=box();await D.booking.queue(normal,{id:'club',timezone:'Asia/Manila'});
  assert.deepEqual(Array.from(statusFilter),["pending","approved"]);
  assert.match(normal.innerHTML,/NEEDS-REVIEW/);
  assert.match(normal.innerHTML,/Alex Morgan/);
  assert.match(normal.innerHTML,/09171234567/);
  assert.doesNotMatch(normal.innerHTML,/NICKNAME/);
  assert.match(normal.innerHTML,/Needs approval/);
  assert.match(normal.innerHTML,/Unpaid/);
  assert.doesNotMatch(normal.innerHTML,/AM \? /);
  records=[{...pending,id:'guest',player_id:null,source:'walk_in',status:'approved',reference_code:'UNPAID-GUEST',ends_at:'2099-01-01T02:00:00Z'}];
  const guest=box();await D.booking.queue(guest,{id:'club'});
  assert.match(guest.innerHTML.split("Today's confirmed bookings")[0],/UNPAID-GUEST/);
  assert.match(guest.innerHTML,/data-guest-pay="guest"/);
  assert.doesNotMatch(guest.innerHTML,/data-ok="guest"/);
  records=[{...records[0],paid_at:'2026-11-12T01:00:00Z',reference_code:'PAID-GUEST'}];
  const paid=box();await D.booking.queue(paid,{id:'club'});
  assert.doesNotMatch(paid.innerHTML.split("Today's confirmed bookings")[0],/PAID-GUEST/);
  assert.match(paid.innerHTML,/PAID-GUEST/);
  assert.doesNotMatch(paid.innerHTML,/data-guest-pay/);
  failure=true;const failed=box();await D.booking.queue(failed,{id:'club'});
  assert.match(failed.innerHTML,/Unable to load reservations/);
  assert.doesNotMatch(failed.innerHTML,/No pending approvals/);
  console.log('Pending approval visibility and query error states passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
