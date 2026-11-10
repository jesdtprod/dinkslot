const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const mockProfile = {
  full_name: 'Marlon Quinto',
  phone: '+63 917 849 2011',
  birth_date: '1992-10-24',
  civil_status: 'single',
  avatar_path: null,
  street: 'Unit 18B, One Serendra, 32nd St.',
  barangay: 'Fort Bonifacio (BGC)',
  city: 'Taguig City',
  province: 'Metro Manila (NCR)',
  zip_code: '1634',
  address: 'Unit 18B, One Serendra, 32nd St., Fort Bonifacio (BGC), Taguig City, Metro Manila (NCR)',
  psgc_province: 'NCR',
  psgc_city: '137607000',
  psgc_barangay: '137607001'
};

const mockClub = {
  id: 'club-pickle',
  slug: 'the-pickleshot',
  name: 'The Pickleshot',
  city: 'Taguig, Metro Manila'
};

let updatedRow = null;

const D = {
  esc: escape,
  state: {
    user: {
      id: 'usr-89240-abcde',
      email: 'marlon.quinto@example.com',
      created_at: '2024-03-15T08:00:00Z',
      user_metadata: { full_name: 'Marlon Quinto' }
    }
  },
  mediaUrl: x => x || '',
  ui: {
    toast: (msg, type) => {}
  },
  setMsg: (form, text, kind) => {
    const el = form.querySelector ? form.querySelector('.msg') : null;
    if (el) {
      el.textContent = text;
      el.className = 'msg ' + (kind || '');
    }
  },
  friendly: err => String((err && err.message) || err || 'Error occurred'),
  ph: {
    mount(box, opts) {
      box.innerHTML = '<div class="ph-grid"><input id="ph-street"><select id="ph-prov"></select><select id="ph-city"></select><select id="ph-brgy"></select><input id="ph-zip"></div>';
      return {
        validate() { return null; },
        get() {
          return {
            street: 'Unit 18B, One Serendra, 32nd St.',
            barangay: 'Fort Bonifacio (BGC)',
            city: 'Taguig City',
            province: 'Metro Manila (NCR)',
            zip_code: '1634',
            address: 'Unit 18B, One Serendra, 32nd St., Fort Bonifacio (BGC), Taguig City',
            psgc_province: 'NCR',
            psgc_city: '137607000',
            psgc_barangay: '137607001'
          };
        }
      };
    }
  },
  sb: {
    from(table) {
      const rows = table === 'profiles'
        ? [mockProfile]
        : table === 'club_players'
        ? [{ id: 'cp-1', user_id: 'usr-89240-abcde', tenant_id: 'club-pickle' }]
        : [mockClub];
      const query = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null }); },
        update(row) {
          updatedRow = row;
          return {
            eq() {
              return Promise.resolve({ data: row, error: null });
            }
          };
        },
        then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); }
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          getPublicUrl(path) { return { data: { publicUrl: 'https://cdn.example.com/' + path } }; },
          upload(path, file) { return Promise.resolve({ data: { path }, error: null }); },
          remove(paths) { return Promise.resolve({ data: paths, error: null }); }
        };
      }
    }
  }
};

const mockLocalStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; }
};

const source = fs.readFileSync('js/player.js', 'utf8')
  .replace('D.player = { render: render };', 'D.player = { render: render, profile: profileView };');

vm.runInNewContext(source, {
  window: { DS: D },
  console,
  Date,
  Set,
  localStorage: mockLocalStorage,
  URL: { createObjectURL: () => 'blob:mock-avatar' }
});

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
          getAttribute(a) { return ''; },
          focus() {},
          onclick: null,
          oninput: null,
          onkeydown: null,
          onchange: null,
          onsubmit: null,
          innerHTML: '',
          textContent: '',
          disabled: false,
          hidden: false,
          querySelector(childSel) {
            return elements[childSel] || { textContent: '', className: '', innerHTML: '' };
          }
        };
      }
      return elements[selector];
    },
    querySelectorAll(selector) {
      if (selector === '[data-hand]') {
        return [
          sec.querySelector('[data-hand="right"]'),
          sec.querySelector('[data-hand="left"]'),
          sec.querySelector('[data-hand="ambi"]')
        ];
      }
      return [];
    }
  };
  return { sec, elements };
}

(async () => {
  // Test 1: Active profile view rendering
  let { sec, elements } = createMockSec();
  await D.player.profile(sec);

  // 1. Header Bar
  assert.ok(sec.innerHTML.includes('data-purpose="profile-header-bar"'), 'Header bar missing');
  assert.ok(sec.innerHTML.includes('ATHLETE HUB • IDENTITY &amp; SETTINGS'), 'Eyebrow badge missing');
  assert.ok(sec.innerHTML.includes('Player Profile'), 'Title missing');
  assert.ok(sec.innerHTML.includes('DUPR PRO VERIFIED'), 'DUPR Pro verified badge missing');
  assert.ok(sec.innerHTML.includes('Player ID:'), 'Player ID label missing');
  assert.ok(sec.innerHTML.includes('DS-PL-'), 'DS-PL prefix missing');
  assert.ok(sec.innerHTML.includes('Public View'), 'Public view link missing');

  // 2. Left Column: Athlete Identity Hub
  assert.ok(sec.innerHTML.includes('data-purpose="athlete-identity-column"'), 'Athlete identity column missing');
  assert.ok(sec.innerHTML.includes('id="mp-preview"'), 'Avatar preview missing');
  assert.ok(sec.innerHTML.includes('id="card-player-name"'), 'Card player name missing');
  assert.ok(sec.innerHTML.includes('Member since'), 'Member since text missing');
  assert.ok(sec.innerHTML.includes('DUPR Official Rating'), 'DUPR official rating label missing');
  assert.ok(sec.innerHTML.includes('4.12 Verified'), 'DUPR 4.12 score missing');
  assert.ok(sec.innerHTML.includes('Singles') && sec.innerHTML.includes('Doubles'), 'Singles/Doubles ratings missing');

  // 3. Turnstile Speed-Pass & Affiliation
  assert.ok(sec.innerHTML.includes('data-purpose="turnstile-speed-pass"'), 'Turnstile speed pass missing');
  assert.ok(sec.innerHTML.includes('Turnstile PIN Code'), 'Turnstile PIN label missing');
  assert.ok(sec.innerHTML.includes('The Pickleshot'), 'Primary club affiliation missing');
  assert.ok(sec.innerHTML.includes('VIP Facility Member • Priority Booking'), 'VIP facility perk missing');

  // 4. Section Anchors
  assert.ok(sec.innerHTML.includes('#section-identity'), 'Identity anchor missing');
  assert.ok(sec.innerHTML.includes('#section-address'), 'Address anchor missing');
  assert.ok(sec.innerHTML.includes('#section-specs'), 'Specs anchor missing');

  // 5. Right Column: Form Sections
  assert.ok(sec.innerHTML.includes('data-purpose="athlete-editor-column"'), 'Athlete editor column missing');
  assert.ok(sec.innerHTML.includes('id="myprofile"'), 'Profile form missing');

  // Section 01: Identity & Contact Details
  assert.ok(sec.innerHTML.includes('Identity &amp; Contact Details'), 'Section 1 heading missing');
  assert.ok(sec.innerHTML.includes('id="mp-name"'), 'Name input missing');
  assert.ok(sec.innerHTML.includes('id="mp-phone"'), 'Phone input missing');
  assert.ok(sec.innerHTML.includes('id="mp-birth"'), 'Birthdate input missing');
  assert.ok(sec.innerHTML.includes('id="mp-civil"'), 'Civil status select missing');

  // Section 02: Residential & Venue Region
  assert.ok(sec.innerHTML.includes('Residential &amp; Venue Region'), 'Section 2 heading missing');
  assert.ok(sec.innerHTML.includes('id="mp-address"'), 'Address mount container missing');

  // Section 03: Athletic & Matchmaking Specs
  assert.ok(sec.innerHTML.includes('Athletic &amp; Matchmaking Specs'), 'Section 3 heading missing');
  assert.ok(sec.innerHTML.includes('data-hand="right"'), 'Right hand button missing');
  assert.ok(sec.innerHTML.includes('data-hand="left"'), 'Left hand button missing');
  assert.ok(sec.innerHTML.includes('data-hand="ambi"'), 'Ambidextrous button missing');
  assert.ok(sec.innerHTML.includes('id="mp-paddle"'), 'Paddle gear input missing');
  assert.ok(sec.innerHTML.includes('id="mp-emergency"'), 'Emergency contact input missing');
  assert.ok(sec.innerHTML.includes('id="mp-discoverable"'), 'Discoverable checkbox toggle missing');

  // Sticky Action Dock
  assert.ok(sec.innerHTML.includes('data-purpose="action-dock"'), 'Action dock missing');
  assert.ok(sec.innerHTML.includes('id="btn-discard"'), 'Discard button missing');
  assert.ok(sec.innerHTML.includes('id="btn-save-profile"'), 'Save button missing');

  // Facility Promotion Ribbon
  assert.ok(sec.innerHTML.includes('data-purpose="partner-facility-cta"'), 'Partner facility CTA missing');
  assert.ok(sec.innerHTML.includes('List Your Club'), 'List your club button missing');
  assert.ok(sec.innerHTML.includes('#/register-club'), 'Register club link missing');

  // 6. Test Interactive Form Input & Real-Time Sync
  const nameInput = elements['#mp-name'];
  nameInput.value = 'Carlos Yulo';
  nameInput.oninput();
  assert.equal(elements['#card-player-name'].textContent, 'Carlos Yulo', 'Card name should sync with name input');

  // Test 7: Discard changes before submit resets to Marlon Quinto
  const discardBtn = elements['#btn-discard'];
  discardBtn.onclick();
  assert.equal(elements['#mp-name'].value, 'Marlon Quinto', 'Name should be restored from profile data');

  // 8. Test Dominant Hand Selection
  const leftHandBtn = elements['[data-hand="left"]'];
  leftHandBtn.onclick();

  // 9. Change name and Submit Form
  nameInput.value = 'Carlos Yulo';
  nameInput.oninput();
  const form = elements['#myprofile'];
  await form.onsubmit({ preventDefault() {} });
  assert.ok(updatedRow, 'Profile row should have been updated in Supabase');
  assert.equal(updatedRow.full_name, 'Carlos Yulo', 'Updated full name should match input');

  console.log('Member profile header, digital identity card, turnstile pass, form sections, interactive specs & submission passed!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
