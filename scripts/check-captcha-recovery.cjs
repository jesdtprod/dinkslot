const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('js/app.js','utf8');
const code=s.slice(s.indexOf('  function mountCaptcha('),s.indexOf('  // ---------------------------------------------------------------- session'));
let options,renders=0,removed=0,toasts=[],timers=[];
const container={isConnected:true};
const ctx={app:{},cfg:{TURNSTILE_SITE_KEY:'site'},setMsg:(a,t,k,action)=>{toasts.push(action);return ()=>{};},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},window:{turnstile:{render(c,o){options=o;return ++renders;},remove(){removed++;}}}};
vm.createContext(ctx);vm.runInContext(code,ctx);
const cap=ctx.mountCaptcha(container);
for(let i=0;i<2;i++){options['error-callback']('300010');timers.at(-1).fn();}
assert.equal(renders,3);assert.equal(removed,2);assert.equal(toasts.length,0);
options['error-callback']('300010');assert.equal(toasts.length,1);
toasts[0].run();assert.equal(renders,4);
options.callback('valid');assert.equal(cap.token,'valid');
container.isConnected=false;cap.reset();assert.equal(renders,4);
console.log('Captcha bounded retries, fresh manual retry, token success, and detached-page guard passed.');
