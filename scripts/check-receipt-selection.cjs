const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/booking.js','utf8');
const validation = source.slice(source.indexOf('  function checkImage('),source.indexOf('  async function signed('));
const selection = source.slice(source.indexOf('    function handleFile('),source.indexOf('    var submitBtn = el.querySelector("#submit-confirm-btn")'));
const node = () => ({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){}},addEventListener(){}});
const context = {TYPES:{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'},MAX_BYTES:5*1024*1024,
  fileInput:node(),fileStatus:node(),fileNameLabel:node(),fileDisplayName:node(),dropZone:node(),clearBtn:node(),proofMsg:node(),nice:e=>e.message};
// No storage, network, FileReader, or image decoder is provided: selection must be local.
vm.createContext(context);vm.runInContext(validation+selection,context);
context.fileInput.files=[{name:'receipt.jpg',type:'image/jpeg',size:4*1024*1024}];
context.fileInput.onchange();
assert.equal(context.fileNameLabel.textContent,'Ready to upload: receipt.jpg');
assert.equal(context.fileDisplayName.textContent,'receipt.jpg');
context.fileInput.files=[{name:'large.jpg',type:'image/jpeg',size:6*1024*1024}];
context.fileInput.onchange();
assert.match(context.proofMsg.textContent,/5 MB/);
assert.equal(context.fileInput.value,'');
assert.ok(source.indexOf('.upload(path, file') > source.indexOf('submitBtn.onclick = async function'));
console.log('Receipt selection is synchronous and local; upload remains inside confirmation.');
