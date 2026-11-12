const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let failure = false, filter = '';
const pending = {id:'pending',tenant_id:'club',court_id:'court',player_id:'player',status:'pending',reference_code:'NEEDS-REVIEW',starts_at:'2020-01-01T01:00:00Z',ends_at:'2020-01-01T02:00:00Z',amount:200,guest_name:'Guest'};
const D = {friendly:error=>error.message,state:{user:{id:'staff'}},esc:x=>String(x).replace(/</g,'&lt;'),ui:{emptyState:(title)=>title},sb:{
  from(table) {
    const query={select(){return this;},eq(){return this;},in(){return this;},or(value){filter=value;return this;},order(){return this;},then(resolve,reject){return Promise.resolve(table==='bookings'?{data:failure?null:[pending],error:failure?{message:'Network unavailable'}:null}:{data:table==='club_players'?[{id:'player',display_name:'NICKNAME'}]:[]}).then(resolve,reject);}};
    return query;
  },rpc(){return Promise.resolve({data:[{player_id:'player',full_name:'Alex Morgan',phone:'09171234567'}]});},channel(){return {on(){return this;},subscribe(){return this;}};}
}};
vm.runInNewContext(fs.readFileSync('js/booking.js','utf8'),{window:{DS:D},document:{body:{contains:()=>true}},setInterval:()=>1,clearInterval(){},console,Date,Set,URLSearchParams});
function box(){return {innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]};}
(async()=>{
  const normal=box();await D.booking.queue(normal,{id:'club',timezone:'Asia/Manila'});
  assert.match(filter,/^status.eq.pending,and\(status.eq.approved,ends_at.gte\./);
  assert.match(normal.innerHTML,/NEEDS-REVIEW/);
  assert.match(normal.innerHTML,/Alex Morgan/);
  assert.match(normal.innerHTML,/09171234567/);
  assert.doesNotMatch(normal.innerHTML,/NICKNAME/);
  assert.match(normal.innerHTML,/Needs approval/);
  assert.match(normal.innerHTML,/Unpaid/);
  assert.doesNotMatch(normal.innerHTML,/AM \? /);
  failure=true;const failed=box();await D.booking.queue(failed,{id:'club'});
  assert.match(failed.innerHTML,/Unable to load reservations/);
  assert.doesNotMatch(failed.innerHTML,/No pending approvals/);
  console.log('Pending approval visibility and query error states passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
