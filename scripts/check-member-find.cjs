const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const mockClub = {
  id: 'club-pickle',
  slug: 'the-pickleshot',
  name: 'The Pickleshot',
  city: 'Austin, TX',
  logo_path: null,
  cover_path: null
};

const mockCourts = [
  { id: 'c1', name: 'Court 1', club_slug: 'the-pickleshot', hourly_rate: 38, is_indoor: true, surface: 'Cushioned Acrylic' },
  { id: 'c2', name: 'Court 2', club_slug: 'the-pickleshot', hourly_rate: 32, is_indoor: true, surface: 'Cushioned Acrylic' },
  { id: 'c3', name: 'Court 3', club_slug: 'the-pickleshot', hourly_rate: 24, is_indoor: false, surface: 'Championship Acrylic' }
];

let hasJoined = true;

const D = {
  esc: escape,
  state: { user: { id: 'usr-42', email: 'player@example.com' } },
  mediaUrl: x => x || '',
  formatMoney: n => 'PHP ' + Number(n).toFixed(2),
  ui: {
    emptyState: (title, desc) => `<p>${title}: ${desc}</p>`,
    toast: (msg, type) => {}
  },
  sb: {
    from(table) {
      const rows = table === 'club_players'
        ? (hasJoined ? [{ tenant_id: 'club-pickle', role: 'member' }] : [])
        : table === 'public_courts'
        ? mockCourts
        : [mockClub];
      const query = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); }
      };
      return query;
    }
  }
};

const source = fs.readFileSync('js/player.js', 'utf8')
  .replace('D.player = { render: render };', 'D.player = { render: render, find: findView };');

vm.runInNewContext(source, { window: { DS: D }, console, Date, Set });

function createMockSec() {
  const elements = {};
  const sec = {
    innerHTML: '',
    isConnected: true,
    querySelector(selector) {
      if (!elements[selector]) {
        elements[selector] = {
          value: '',
          checked: true,
          className: '',
          classList: {
            toggle(cls, force) {
              if (force) this.add(cls); else this.remove(cls);
            },
            add(cls) {
              if (!this._classes.includes(cls)) this._classes.push(cls);
            },
            remove(cls) {
              this._classes = this._classes.filter(c => c !== cls);
            },
            _classes: []
          },
          focus() {},
          setAttribute() {},
          onclick: null,
          oninput: null,
          onkeydown: null,
          onchange: null,
          innerHTML: '',
          textContent: ''
        };
      }
      return elements[selector];
    },
    querySelectorAll(selector) {
      return [];
    }
  };
  return { sec, elements };
}

(async () => {
  hasJoined = true;
  const { sec, elements } = createMockSec();
  await D.player.find(sec);
  assert.match(sec.innerHTML,/member-overview-header/);
  assert.match(sec.innerHTML,/Discover Your Next Court/);
  assert.match(sec.innerHTML,/club-search-input/);
  assert.match(sec.innerHTML,/find-membership-grid/);
  assert.match(sec.innerHTML,/The Pickleshot/);
  assert.match(sec.innerHTML,/#\/c\/the-pickleshot\/book/);
  assert.doesNotMatch(sec.innerHTML,/Fast-Book Next Available Slots|Apex Pickleball Center/);
  const search = elements['#club-search-input'];
  const list = elements['#discover-clubs-list'];
  search.value = 'no matching club'; search.oninput();
  assert.match(list.innerHTML,/No clubs found/);
  assert.equal(elements['#nearby-count-badge'].textContent,0);
  search.onkeydown({key:'Escape'});
  assert.equal(search.value,''); assert.match(list.innerHTML,/The Pickleshot/);
  search.value='missing';search.oninput();elements['#btn-clear-search'].onclick();
  assert.equal(search.value,'');assert.match(list.innerHTML,/The Pickleshot/);
  elements['#btn-view-list'].onclick();assert.match(list.className,/flex flex-col/);
  elements['#btn-view-grid'].onclick();assert.match(list.className,/grid grid-cols-1/);
  hasJoined=false;const empty=createMockSec();await D.player.find(empty.sec);
  assert.match(empty.sec.innerHTML,/No clubs joined/);
  console.log('Find a Club saved data, layout, search, clear actions, view modes, and empty memberships passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
