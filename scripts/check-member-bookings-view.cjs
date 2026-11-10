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

(async () => {
  // Test 1: Active bookings view
  let { sec, elements } = createMockSec();
  await D.player.bookings(sec);

  // 1. Header and Quick Stats
  assert.ok(sec.innerHTML.includes('data-purpose="header-and-quick-stats"'), 'Header metrics missing');
  assert.ok(sec.innerHTML.includes('Player Hub • Reservations &amp; Match Passes'), 'Eyebrow badge missing');
  assert.ok(sec.innerHTML.includes('My bookings'), 'Page title missing');
  assert.ok(sec.innerHTML.includes('Confirmed Upcoming'), 'Confirmed upcoming label missing');
  assert.ok(sec.innerHTML.includes('1 Match'), 'Confirmed count missing');
  assert.ok(sec.innerHTML.includes('Total Played'), 'Total played label missing');
  assert.ok(sec.innerHTML.includes('Court Credits'), 'Court credits label missing');

  // 2. Filter Toolbar
  assert.ok(sec.innerHTML.includes('data-purpose="filtering-and-search-toolbar"'), 'Filter toolbar missing');
  assert.ok(sec.innerHTML.includes('id="tab-upcoming"'), 'Upcoming tab missing');
  assert.ok(sec.innerHTML.includes('id="tab-past"'), 'Past tab missing');
  assert.ok(sec.innerHTML.includes('id="tab-cancelled"'), 'Cancelled tab missing');
  assert.ok(sec.innerHTML.includes('id="booking-search-input"'), 'Search input missing');
  assert.ok(sec.innerHTML.includes('id="booking-club-filter"'), 'Club filter missing');
  assert.ok(sec.innerHTML.includes('id="booking-date-filter"'), 'Date filter missing');
  assert.ok(sec.innerHTML.includes('id="btn-sort-toggle"'), 'Sort toggle missing');

  // 3. Upcoming reservation card
  const cardsContainer = elements['#booking-cards-container'];
  assert.ok(cardsContainer.innerHTML.includes('data-purpose="reservation-card"'), 'Reservation card missing');
  assert.ok(cardsContainer.innerHTML.includes('The Pickleshot – Court 1'), 'Court title missing');
  assert.ok(cardsContainer.innerHTML.includes('Confirmed'), 'Confirmed badge missing');
  assert.ok(cardsContainer.innerHTML.includes('Indoor Cushion Pro'), 'Surface badge missing');
  assert.ok(cardsContainer.innerHTML.includes('code DS-ECRS3Q02J'), 'Reference code missing');
  assert.ok(cardsContainer.innerHTML.includes('Turnstile QR Pass'), 'QR pass preview missing');
  assert.ok(cardsContainer.innerHTML.includes('View Digital Pass'), 'View digital pass button missing');

  // 4. Countdown reminder callout
  assert.ok(sec.innerHTML.includes('data-purpose="matchday-reminder-banner"'), 'Matchday reminder banner missing');
  assert.ok(sec.innerHTML.includes('Match Day Check-In Countdown'), 'Countdown heading missing');
  assert.ok(sec.innerHTML.includes('Get Driving Directions'), 'Driving directions button missing');
  assert.ok(sec.innerHTML.includes('Club Guidelines'), 'Club guidelines button missing');

  // 5. Past Match Records
  assert.ok(sec.innerHTML.includes('data-purpose="past-match-records"'), 'Past match records missing');
  const pastContainer = elements['#past-matches-container'];
  assert.ok(pastContainer.innerHTML.includes('The Pickleshot – Court 1'), 'Past match title missing');
  assert.ok(pastContainer.innerHTML.includes('Receipt'), 'Receipt button missing');
  assert.ok(pastContainer.innerHTML.includes('Rebook Court'), 'Rebook court button missing');

  // 6. Facility conversion banner
  assert.ok(sec.innerHTML.includes('data-purpose="club-partner-callout"'), 'Facility partner callout missing');
  assert.ok(sec.innerHTML.includes('#/register-club'), 'Register club link missing');

  // 7. Interactive search filtering
  const sInput = elements['#booking-search-input'];
  sInput.value = 'Nonexistent';
  elements['#booking-search-input'].oninput();
  assert.ok(cardsContainer.innerHTML.includes('No upcoming bookings found'), 'Search empty state missing');

  sInput.value = 'Pickleshot';
  elements['#booking-search-input'].oninput();
  assert.ok(cardsContainer.innerHTML.includes('The Pickleshot – Court 1'), 'Search result matching error');

  // Test 8: Empty bookings state
  mockBookings = [];
  const mock2 = createMockSec();
  await D.player.bookings(mock2.sec);
  const emptyCards = mock2.elements['#booking-cards-container'];
  assert.ok(emptyCards.innerHTML.includes('No upcoming bookings found'), 'Empty bookings view missing');
  assert.ok(emptyCards.innerHTML.includes('Book a Court'), 'Book a court CTA missing');

  console.log('My Bookings page header, metrics, toolbar, active card, countdown, history & empty states passed!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
