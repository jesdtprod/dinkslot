const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const directory = JSON.parse(fs.readFileSync('assets/ph-zip-codes.json', 'utf8'));
assert.ok(directory.places.some(p => p[0] === 'Sultan Kudarat' && p[1] === 'Lebak (Salaman)' && p[2] === '9807'));

async function setup({apiZip = '', savedZip = '', directoryFails = false} = {}) {
  const elements = Object.fromEntries(['ph-prov', 'ph-city', 'ph-brgy', 'ph-zip', 'ph-status'].map(id => [id, {value:'', innerHTML:'', textContent:'', disabled:false}]));
  const box = {innerHTML:'', querySelector: selector => elements[selector.slice(1)]};
  const D = {esc: x => String(x)};
  const context = {window:{DS:D}, AbortController, setTimeout, clearTimeout, sessionStorage:{getItem(){return null;},setItem(){}}, fetch:async url => {
    let data;
    if (url === 'assets/ph-zip-codes.json') {
      if (directoryFails) throw new Error('Offline');
      data = {places:[...directory.places, ['Sultan Kudarat','Ambiguous','1111'], ['Sultan Kudarat','Ambiguous','2222']]};
    } else if (url.endsWith('/provinces')) data = [{code:'P',name:'Sultan Kudarat'}];
    else if (url.endsWith('/cities-municipalities')) data = [{code:'C1',name:'Lebak',zip_code:apiZip}, {code:'C2',name:'Unknown place'}, {code:'C3',name:'Ambiguous'}];
    else data = [{code:'B',name:'Poblacion III'}];
    return {ok:true,json:async()=>data};
  }};
  vm.runInNewContext(fs.readFileSync('js/ph-address.js','utf8'), context);
  const picker = D.ph.mount(box, {values:{psgc_province:'P',psgc_city:'C1',psgc_barangay:'B',zip_code:savedZip}});
  await picker.ready;
  return {elements,picker,box};
}

(async () => {
  const fallback = await setup();
  assert.equal(fallback.elements['ph-zip'].value,'9807');
  assert.equal(fallback.elements['ph-zip'].readOnly,true);
  assert.ok(!fallback.box.innerHTML.includes('ph-zipnote'));
  fallback.elements['ph-city'].value='2';
  await fallback.elements['ph-city'].onchange();
  assert.equal(fallback.elements['ph-zip'].value,'');
  assert.equal(fallback.elements['ph-zip'].readOnly,false);
  fallback.elements['ph-city'].value='0';
  await fallback.elements['ph-city'].onchange();
  assert.equal(fallback.elements['ph-zip'].value,''); // ambiguous city: no guessed ZIP
  const api = await setup({apiZip:'1234'});
  assert.equal(api.elements['ph-zip'].value,'1234');
  const saved = await setup({savedZip:'9807',directoryFails:true});
  assert.equal(saved.elements['ph-zip'].value,'9807');
  assert.equal(saved.elements['ph-zip'].readOnly,false);
  console.log('ZIP fallback, API precedence, saved ZIP, city changes, ambiguity and offline behavior passed.');
})().catch(error => {console.error(error);process.exitCode=1;});

