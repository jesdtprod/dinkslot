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
  // Test 1: User with active membership
  hasJoined = true;
  let { sec, elements } = createMockSec();
  await D.player.find(sec);

  assert.ok(sec.innerHTML.includes('data-purpose="page-hero-banner"'), 'Hero banner missing');
  assert.ok(sec.innerHTML.includes('member-overview-header') && sec.innerHTML.includes('Player Workspace'), 'Shared overview header missing');
  assert.ok(sec.innerHTML.includes('data-purpose="search-and-filter-bar"'), 'Filter bar missing');
  assert.ok(sec.innerHTML.includes('id="club-search-input"'), 'Search input missing');
  assert.ok(sec.innerHTML.includes('data-purpose="joined-clubs-section"'), 'Joined section missing');
  assert.ok(sec.innerHTML.includes('My Active Membership'), 'Active membership title missing');
  assert.ok(sec.innerHTML.includes('JOINED'), 'Joined badge missing');
  assert.ok(sec.innerHTML.includes('#/c/the-pickleshot/book'), 'Direct booking link missing');
  assert.ok(sec.innerHTML.includes('Fast-Book Next Available Slots'), 'Fast-book slot picker missing');
  assert.ok(sec.innerHTML.includes('Today • 4:30 PM'), 'Slot 1 missing');
  assert.ok(sec.innerHTML.includes('Tomorrow • 7:00 AM'), 'Slot 4 missing');

  assert.ok(sec.innerHTML.includes('data-purpose="nearby-clubs-grid"'), 'Discover section missing');
  assert.ok(sec.innerHTML.includes('Featured &amp; Nearby Clubs to Join'), 'Discover title missing');
  assert.ok(sec.innerHTML.includes('data-purpose="club-onboarding-cta"'), 'Facility CTA missing');
  assert.ok(sec.innerHTML.includes('#/register-club'), 'Register club link missing');

  // Verify discover cards list rendered
  const discoverList = elements['#discover-clubs-list'];
  assert.ok(discoverList.innerHTML.includes('Apex Pickleball Center'), 'Apex card missing');
  assert.ok(discoverList.innerHTML.includes('Southside Dinks &amp; Social'), 'Southside card missing');
  assert.ok(discoverList.innerHTML.includes('Metro Paddle &amp; Pickle Arena'), 'Metro card missing');

  // Test 2: Search filtering and keyboard clear
  const searchInput = elements['#club-search-input'];
  searchInput.value = 'Apex';
  searchInput.oninput();
  assert.ok(discoverList.innerHTML.includes('Apex Pickleball Center'), 'Apex should match search');
  assert.ok(!discoverList.innerHTML.includes('Southside Dinks'), 'Southside should be filtered out');

  // ESC key clears search
  searchInput.onkeydown({ key: 'Escape' });
  assert.equal(searchInput.value, '', 'Escape should clear search input');
  assert.ok(discoverList.innerHTML.includes('Southside Dinks'), 'Southside should return after ESC');

  // Clear button clears search
  searchInput.value = 'Metro';
  searchInput.oninput();
  assert.ok(discoverList.innerHTML.includes('Metro Paddle'), 'Metro should match search');
  const clearBtn = elements['#btn-clear-search'];
  clearBtn.onclick();
  assert.equal(searchInput.value, '', 'Clear button should clear search input');
  assert.ok(discoverList.innerHTML.includes('Apex Pickleball Center'), 'All clubs should return after clear');

  // Test 3: View mode switching
  const btnList = elements['#btn-view-list'];
  btnList.onclick();
  assert.ok(discoverList.className.includes('flex flex-col'), 'List view should set flex flex-col layout');

  const btnGrid = elements['#btn-view-grid'];
  btnGrid.onclick();
  assert.ok(discoverList.className.includes('grid grid-cols-1'), 'Grid view should restore grid layout');

  // Test 4: User without active membership (featured showcase)
  hasJoined = false;
  const mock2 = createMockSec();
  await D.player.find(mock2.sec);
  assert.ok(mock2.sec.innerHTML.includes('data-purpose="joined-clubs-section"'), 'Showcase section missing');
  assert.ok(mock2.sec.innerHTML.includes('Featured Club'), 'Featured club title missing');
  assert.ok(mock2.sec.innerHTML.includes('FEATURED'), 'Featured badge missing');
  assert.ok(mock2.sec.innerHTML.includes('#/c/the-pickleshot/join'), 'Join club CTA missing');

  console.log('Find a Club page layout, search filtering, ESC clear, view modes, and membership showcase passed!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
