const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const future = new Date(Date.now() + 86400000 * 3).toISOString();
const end = new Date(Date.parse(future) + 90 * 60000).toISOString();
const past = new Date(Date.now() - 86400000 * 3).toISOString();
let bookings = [
  {tenant_id:'club',court_id:'court',status:'approved',reference_code:'REAL-123',starts_at:future,ends_at:end,amount:225},
  {tenant_id:'club',court_id:'court',status:'pending',reference_code:'PENDING-456',starts_at:future,ends_at:end,amount:300},
  {tenant_id:'club',court_id:'court',status:'approved',reference_code:'PAST-789',starts_at:past,ends_at:past,amount:150}
];
const club = {id:'club',slug:'venue',name:'Real Club',cover_path:'club-cover.jpg',logo_path:'club-logo.jpg',street:'12 Real Street',barangay:'Poblacion',city:'Isulan',latitude:6.6,longitude:124.6};
const court = {id:'court',name:'Real Court',club_slug:'venue'};
const D = {esc:escape,state:{user:{id:'user',email:'a@example.com'}},mediaUrl:x=>x,ui:{emptyState:(title,desc)=>`<p>${title}: ${desc}</p>`},sb:{from(table){
  const rows = table==='club_players' ? [{id:'player',tenant_id:'club'}] : table==='bookings' ? bookings : table==='public_courts' ? [court] : [club];
  const query = {select(){return this;},eq(){return this;},in(){return this;},order(){return this;},limit(){return this;},maybeSingle(){return Promise.resolve({data:rows[0]});},then(resolve,reject){return Promise.resolve({data:rows,count:7}).then(resolve,reject);}};
  return query;
}}};
const source = fs.readFileSync('js/player.js','utf8').replace('D.player = { render: render, memberSkeleton: memberSkeleton };','D.player = { render: render, overview: overviewView };');
vm.runInNewContext(source,{window:{DS:D},console,Date,Set,setInterval:()=>1,clearInterval(){}});
function section(){
  const slot={innerHTML:'',setAttribute(){}};
  const tabs=['upcoming','recent','pending'].map(filter=>({className:'',setAttribute(){},getAttribute(){return filter;}}));
  return {innerHTML:'',tabs,slot,querySelector(selector){return selector==='#next-booking-card-slot'?slot:null;},querySelectorAll(selector){return selector==='[data-bfilter]'?tabs:[];}};
}
(async()=>{
  let sec=section(); await D.player.overview(sec);
  assert.match(sec.innerHTML,/REAL-123/);
  assert.match(sec.innerHTML,/booking-tone-upcoming/);
  assert.match(sec.innerHTML,/Active Courts<\/span><span[^>]+>7<\/span>/);
  assert.match(sec.innerHTML,/Skill Level/);
  assert.match(sec.innerHTML,/Not Rated/);
  assert.match(sec.innerHTML,/Self-reported/);
  assert.match(sec.innerHTML,/Upcoming Bookings<\/span><span[^>]+>1<\/span>/);
  assert.doesNotMatch(sec.innerHTML,/2,840|Avg Match Latency|>Verified<\/span>/);

  assert.match(sec.innerHTML,/12 Real Street, Poblacion, Isulan/);
  assert.match(sec.innerHTML,/90 minutes/);
  assert.match(sec.innerHTML,/PHP 225.00/);
  assert.match(sec.innerHTML,/Upcoming <span class="overview-filter-count">1<\/span>/);
  assert.doesNotMatch(sec.innerHTML,/Main Arena|DS-S54V8DJH1|Gate PIN:/);
  const home = sec.innerHTML.split('id="my-home-club"')[1];
  assert.match(home,/home-clubs-grid/);
  assert.match(home,/club-cover.jpg/);
  assert.match(home,/club-logo.jpg/);
  assert.match(home,/12 Real Street, Poblacion, Isulan/);
  assert.doesNotMatch(home,/All 16 Slots|4:30 PM|128 reviews/);
  sec.tabs[2].onclick(); assert.match(sec.slot.innerHTML,/PENDING-456/); assert.doesNotMatch(sec.slot.innerHTML,/REAL-123/);
  assert.match(sec.slot.innerHTML,/booking-tone-pending/);assert.match(sec.slot.innerHTML,/Awaiting approval/);
  sec.tabs[1].onclick(); assert.match(sec.slot.innerHTML,/PAST-789/);
  assert.match(sec.slot.innerHTML,/booking-tone-past/);assert.match(sec.slot.innerHTML,/Completed/);
  bookings=[]; sec=section(); await D.player.overview(sec);
  assert.match(sec.innerHTML,/No upcoming bookings/); assert.doesNotMatch(sec.innerHTML,/member-reservation-card/);
  sec.tabs[2].onclick(); assert.match(sec.slot.innerHTML,/No pending bookings/);
  let onChange, subscriptions=0;
  D.sb.channel=()=>({on(event,config,callback){assert.equal(config.table,'bookings');onChange=callback;return this;},subscribe(){subscriptions++;return this;}});
  D.sb.removeChannel=()=>{};
  bookings=[{tenant_id:'club',court_id:'court',status:'pending',reference_code:'LIVE-123',starts_at:future,ends_at:end,amount:200}];
  sec=section();sec.isConnected=true;await D.player.overview(sec);sec.tabs[2].onclick();
  assert.match(sec.slot.innerHTML,/LIVE-123/);
  bookings[0].status='approved';await onChange();
  assert.match(sec.slot.innerHTML,/No pending bookings/);
  assert.match(sec.innerHTML,/Upcoming <span class="overview-filter-count">1<\/span>/);
  assert.equal(sec.__overviewFilter,'pending');assert.equal(subscriptions,1);
  bookings[0].status='cancelled';await onChange();assert.match(sec.innerHTML,/Upcoming <span class="overview-filter-count">0<\/span>/);
  bookings[0].status='rejected';await onChange();assert.match(sec.innerHTML,/Pending <span class="overview-filter-count">0<\/span>/);
  console.log('Member booking records, location, duration, filters and empty states passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
