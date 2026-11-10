const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const mockClub = {
  id: 'club-pickle',
  slug: 'the-pickleshot',
  name: 'The Pickleshot',
  city: 'Isulan', zip_code: '9800',
  logo_path: null,
  cover_path: null
};

const mockCourts = [
  { id: 'c1', name: 'Court 1', club_slug: 'the-pickleshot', hourly_rate: 38, is_indoor: true, surface: 'Cushioned Acrylic', open_time:'00:00', close_time:'00:00' },
  { id: 'c2', name: 'Court 2', club_slug: 'the-pickleshot', hourly_rate: 32, is_indoor: true, surface: 'Cushioned Acrylic', open_time:'00:00', close_time:'00:00' },
  { id: 'c3', name: 'Court 3', club_slug: 'the-pickleshot', hourly_rate: 24, is_indoor: false, surface: 'Championship Acrylic', open_time:'00:00', close_time:'00:00' }
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
          focus() {}, setAttribute() {},
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
  const {sec,elements} = createMockSec();
  await D.player.find(sec);
  const results = elements['#discover-clubs-list'];
  assert.match(results.innerHTML,/The Pickleshot/);
  assert.doesNotMatch(results.innerHTML,/Apex|Southside|Metro Paddle|4.8|12 mi/);
  const tools = sec.innerHTML.split('data-purpose="search-and-filter-bar"')[1].split('data-purpose="joined-clubs-section"')[0];
  assert.match(tools,/Isulan/); assert.match(tools,/Championship Acrylic/);
  assert.doesNotMatch(tools,/Austin|15 mi|DUPR|> nearby</);
  const city=elements['#club-filter-city'];city.value='Other City';city.onchange();assert.match(results.innerHTML,/No clubs found/);
  city.value='';city.onchange();
  const type=elements['#club-filter-type'];type.value='indoor';type.onchange();assert.match(results.innerHTML,/The Pickleshot/);
  const surface=elements['#club-filter-surface'];surface.value='Championship Acrylic';surface.onchange();assert.match(results.innerHTML,/No clubs found/);
  type.value='outdoor';type.onchange();assert.match(results.innerHTML,/The Pickleshot/);
  const open=elements['#filter-open-now'];open.checked=true;open.onchange();assert.match(results.innerHTML,/The Pickleshot/);
  elements['#club-search-input'].value='9800';elements['#club-search-input'].oninput();assert.match(results.innerHTML,/The Pickleshot/);
  elements['#club-search-input'].value='does not exist';elements['#club-search-input'].oninput();assert.match(results.innerHTML,/No clubs found/);
  elements['#btn-clear-search'].onclick();assert.match(results.innerHTML,/The Pickleshot/);
  elements['#btn-view-list'].onclick();assert.match(results.innerHTML,/The Pickleshot/);
  console.log('Real directory city, surface, same-court type, opening hours, ZIP search, counts and views passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
