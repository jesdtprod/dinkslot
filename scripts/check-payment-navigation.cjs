const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let result = {data:{slug:'the-pickleshot'}}, notices = [];
const location = {hash:'#/me/bookings'};
const D = {friendly:e=>e.message,ui:{toast:(...args)=>notices.push(args)},sb:{from(table){
  assert.equal(table,'public_tenants');
  return {select(){return this;},eq(key,value){assert.equal(key,'id');assert.equal(value,'club');return this;},maybeSingle:async()=>result};
}}};
vm.runInNewContext(fs.readFileSync('js/booking.js','utf8'),{window:{DS:D},location,console,URLSearchParams});
(async()=>{
  await D.booking.openPayment({id:'booking-1',tenant_id:'club'});
  assert.equal(location.hash,'#/c/the-pickleshot/book?booking=booking-1');
  location.hash='#/me/bookings';result={data:null,error:{message:'Network unavailable'}};
  await D.booking.openPayment({id:'booking-1',tenant_id:'club'});
  assert.equal(location.hash,'#/me/bookings');
  assert.equal(notices[0][1],'err');
  console.log('Full-page checkout navigation and lookup failure passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
