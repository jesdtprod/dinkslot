const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/admin.js','utf8');
const helper=source.slice(source.indexOf('  async function approvalCount'),source.indexOf('  var TYPES'));
let bookings=[],payments=[];
const context={sb:{from(table){return {select(){return this},eq(){return this},in(){return this},then(resolve,reject){return Promise.resolve({data:table==='bookings'?bookings:payments}).then(resolve,reject)}}}}};
vm.createContext(context);vm.runInContext(helper,context);
(async()=>{
  bookings=[{id:'pending',status:'pending',amount:150},{id:'unpaid',status:'approved',amount:150},{id:'cash',status:'approved',amount:150,paid_at:'now'},{id:'free',status:'approved',amount:0}];
  assert.equal(await context.approvalCount('club'),2);
  payments=[{booking_id:'unpaid'}];assert.equal(await context.approvalCount('club'),1);
  bookings[0].status='approved';payments.push({booking_id:'pending'});
  assert.equal(await context.approvalCount('club'),0);
  console.log('Approval badge counts pending/unpaid and clears after payment and approval.');
})().catch(error=>{console.error(error);process.exitCode=1;});
