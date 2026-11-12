const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/booking.js','utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('    var cancelReleaseBtn =');
const code=source.slice(start,source.indexOf('\n  }\n',start));
let accepted=false,calls=0,returned=0,error=null,notices=[];
const button={disabled:false,textContent:''};
const context={el:{querySelector:()=>button},court:{name:'Court 1'},b:{id:'booking'},uuid:()=> 'attempt',nice:e=>e.message,
  ctx:{onBack(){returned++;}},D:{ui:{confirmAction:async()=>accepted,toast:(...args)=>notices.push(args)}},
  sb:{rpc:async(name,args)=>{assert.equal(name,'cancel_booking');assert.equal(args.p_booking_id,'booking');calls++;return {error};}}};
vm.createContext(context);vm.runInContext(code,context);
(async()=>{
  await button.onclick();assert.equal(calls,0);
  accepted=true;error={message:'Request failed'};await button.onclick();
  assert.equal(button.disabled,false);assert.equal(notices.at(-1)[1],'err');
  error=null;await button.onclick();assert.equal(returned,1);assert.equal(notices.at(-1)[1],'ok');
  console.log('Checkout release modal cancellation, failure recovery, and successful return passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
