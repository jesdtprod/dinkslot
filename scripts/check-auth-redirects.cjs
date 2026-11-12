const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const home=source.slice(source.indexOf('  function homePath()'),source.indexOf('  function requireUser('));
const start=source.indexOf('      // Super admin never');
const guards=source.slice(start,source.indexOf('      if (path === "/")',start));
function run(path,state){const context={path,state,go:to=>to,viewRegisterClub:()=> 'SETUP'};return vm.runInNewContext(home+'\n(function(){'+guards+'return "PUBLIC";})()',context);}
for(const path of ['/auth','/register-club']){
 assert.equal(run(path,{user:{},accountType:'player'}),'/me');
 assert.equal(run(path,{user:{},managedSlug:'venue',accountType:'tenant'}),'/admin/venue');
 assert.equal(run(path,{user:{},isPlatform:true}),'/platform');
 assert.equal(run(path,{user:{},accountType:'tenant'}),'/club-setup');
 assert.equal(run(path,{user:null}),'PUBLIC');
}
assert.equal(run('/club-setup',{user:{},accountType:'tenant'}),'SETUP');
assert.equal(run('/club-setup',{user:{},accountType:'player'}),'/me');
assert.equal(run('/club-setup',{user:null}),'/auth?next=%2Fclub-setup');
console.log('Signed-in auth/registration redirects and protected club setup passed.');
