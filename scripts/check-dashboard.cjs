// Run with: node scripts/check-dashboard.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const D = {
  state: { user: { email: 'director@example.com' } },
  esc: value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char])
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8'), {
  window: { DS: D }, document: { addEventListener() {} }
});

// Exercise the full shell renderer: testing the menu helper alone misses
// function-name collisions inside dash(). Only DOM event targets are stubbed.
const handlers = {};
let focused = false;
const menu = {
  open: true,
  addEventListener(name, handler) { handlers[name] = handler; },
  querySelector() { return { focus() { focused = true; } }; },
  querySelectorAll() { return []; }
};
const main = {};
const signout = {};
const root = {
  innerHTML: 'Loading...',
  querySelector(selector) {
    return ({ '.facility-account': menu, '#sec': main, '#facility-signout': signout })[selector] || null;
  }
};
const ui = D.ui.dash(root, {
  head: { title: 'Test Club', sub: 'Facility Director', slug: 'test-club' },
  items: [{ key: 'overview', label: 'Overview', icon: 'dashboard', href: '#/admin/test-club' }]
});
assert.equal(ui.main, main);
assert.ok(root.innerHTML.includes('id="ds-tenant-dashboard"'));
assert.ok(root.innerHTML.includes('Public Club Page'));
assert.ok(root.innerHTML.includes('#/admin/test-club/profile'));
assert.equal(typeof signout.onclick, 'function');
handlers.keydown({ key: 'Escape' });
assert.equal(menu.open, false);
assert.equal(focused, true);

const playerMenu = D.ui.accountMenu({ title: '<Player>', sub: 'Player' }, 'signout');
assert.ok(playerMenu.includes('&lt;Player&gt;'));
assert.ok(playerMenu.includes('id="signout"'));
assert.ok(!playerMenu.includes('Facility Management'));
console.log('Dashboard shell, menu links, sign-out binding, Escape, and player menu checks passed.');
