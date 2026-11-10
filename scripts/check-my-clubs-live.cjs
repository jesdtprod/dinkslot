const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const mockClub = {
  id: 'club-pickle',
  slug: 'the-pickleshot',
  name: 'The Pickleshot',
  city: 'Isulan', zip_code: '9800', contact_email:'club@example.com',
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
  hoursText: (open,close) => open + ' - ' + close,
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
  .replace('D.player = { render: render };', 'D.player = { render: render, clubs: clubsView };');

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

(async()=>{
  let {sec,elements}=createMockSec();
  await D.player.clubs(sec);
  assert.match(sec.innerHTML,/member-overview-header/);
  assert.match(sec.innerHTML,/member-clubs-page/);
  const cards=elements['#my-joined-clubs-list'];
  assert.match(cards.innerHTML,/The Pickleshot/);
  assert.match(cards.innerHTML,/membership-panel-header/);
  assert.match(cards.innerHTML,/Quick Book a Court/);
  assert.match(cards.innerHTML,/membership-court-grid/);
  assert.match(cards.innerHTML,/membership-panel-footer/);
  assert.match(cards.innerHTML,/PHP 24.00/);
  assert.match(cards.innerHTML,/mailto:club@example.com/);
  assert.doesNotMatch(sec.innerHTML,/VIP|Auto-Renewing|Austin|Apex Pickleball/);
  elements['#myclubs-filter-input'].value='9800';elements['#myclubs-filter-input'].oninput();assert.match(cards.innerHTML,/The Pickleshot/);
  elements['#myclubs-filter-input'].value='no matching club';elements['#myclubs-filter-input'].oninput();assert.match(cards.innerHTML,/No matching clubs/);
  elements['#myclubs-filter-input'].onkeydown({key:'Escape'});assert.match(cards.innerHTML,/The Pickleshot/);
  elements['#myclubs-sort'].value='courts';elements['#myclubs-sort'].onchange();assert.match(cards.innerHTML,/The Pickleshot/);
  hasJoined=false;({sec,elements}=createMockSec());await D.player.clubs(sec);assert.match(elements['#my-joined-clubs-list'].innerHTML,/No clubs joined/);
  console.log('My Clubs shared styling hooks, live details, search, sorting and empty state passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
