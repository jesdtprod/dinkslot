const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const future = new Date(Date.now() + 86400000 * 2).toISOString();
const futureEnd = new Date(Date.parse(future) + 60 * 60000).toISOString();
const pastDate = new Date(Date.now() - 86400000 * 3).toISOString();
const pastEnd = new Date(Date.parse(pastDate) + 90 * 60000).toISOString();

let mockBookings = [
  {
    id: 'b-up-1',
    court_id: 'court-1',
    status: 'approved',
    reference_code: 'DS-ECRS3Q02J',
    starts_at: future,
    ends_at: futureEnd,
    amount: 150
  },
  {
    id: 'b-past-1',
    court_id: 'court-1',
    status: 'approved',
    reference_code: 'DS-78AB29KL',
    starts_at: pastDate,
    ends_at: pastEnd,
    amount: 225
  },
  {
    id: 'b-cx-1',
    court_id: 'court-1',
    status: 'cancelled',
    reference_code: 'DS-CX9999',
    starts_at: pastDate,
    ends_at: pastEnd,
    amount: 150
  }
];

const mockClub = {
  id: 'club-pickle',
  slug: 'the-pickleshot',
  name: 'The Pickleshot',
  city: 'Austin, TX',
  street: 'Building 4, Metro Athletic Park',
  timezone: 'Asia/Manila'
};

const mockCourt = {
  id: 'court-1',
  name: 'Court 1',
  club_slug: 'the-pickleshot',
  surface: 'Indoor Cushion Pro',
  is_indoor: true,
  hourly_rate: 150
};

const D = {
  esc: escape,
  state: { user: { id: 'usr-42', email: 'player@example.com', user_metadata: { full_name: 'James B.' } } },
  mediaUrl: x => x || '',
  ui: {
    toast: (msg, type) => {},
    confirmAction: (msg, opts) => Promise.resolve(true)
  },
  sb: {
    from(table) {
      const rows = table === 'club_players'
        ? [{ id: 'cp-1', user_id: 'usr-42', tenant_id: 'club-pickle' }]
        : table === 'bookings'
        ? mockBookings
        : table === 'public_courts'
        ? [mockCourt]
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
    },
    rpc(fn, args) {
      return Promise.resolve({ data: { success: true }, error: null });
    }
  }
};

const source = fs.readFileSync('js/player.js', 'utf8')
  .replace('D.player = { render: render };', 'D.player = { render: render, bookings: bookingsView };');

vm.runInNewContext(source, { window: { DS: D, qrcode: null }, console, Date, Set });

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
          setAttribute() {},
          getAttribute() { return ''; },
          focus() {},
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
  const {sec,elements}=createMockSec();
  await D.player.bookings(sec);
  assert.match(sec.innerHTML,/member-overview-header/);
  assert.match(sec.innerHTML,/member-bookings-page/);
  assert.match(sec.innerHTML,/Match Day Countdown/);
  assert.doesNotMatch(sec.innerHTML,/Recent Match History|Turnstile opens|past-match-records|club-partner-callout/);
  assert.match(elements['#booking-live-countdown'].textContent,/Starts in/);
  const cards=elements['#booking-cards-container'];
  assert.match(cards.innerHTML,/DS-ECRS3Q02J/);
  mockBookings=mockBookings.map(b=>({...b,status:'pending'}));
  const pending=createMockSec();await D.player.bookings(pending.sec);
  assert.doesNotMatch(pending.sec.innerHTML,/matchday-reminder-banner/);
  mockBookings=[];const empty=createMockSec();await D.player.bookings(empty.sec);
  assert.doesNotMatch(empty.sec.innerHTML,/matchday-reminder-banner|Recent Match History/);
  console.log('Bookings shared layout, confirmed countdown, pending exclusion and empty states passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
