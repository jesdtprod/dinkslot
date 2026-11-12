const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/app.js', 'utf8');
const draw = source.slice(source.indexOf('    function drawCourts()'), source.indexOf('    async function loadAvailability()'));
const grid = { innerHTML: '' };
const court = { id: 'court-1', name: 'Court 1', slot_minutes: 60, rate_min: 150, rate_max: 200, hourly_rate: 150 };
const slots = [
  { m: 1020, s: '05:00 PM', rate: 150, off: false },
  { m: 1080, s: '06:00 PM', rate: 200, off: false },
  { m: 1140, s: '07:00 PM', rate: 200, off: false }
];
const S = { day: 0, dur: 60, sel: {} };
const context = {
  $: selector => selector === '#club-courtgrid' ? grid : null,
  courts: [court], dates: ['2026-11-12'], S, c: { name: 'Test Club' },
  slotsFor: () => slots, esc: String, money: n => 'PHP ' + Number(n).toFixed(2),
  timeLabel: value => value, hoursText: () => '06:00 - midnight',
  dayLabel: () => 'Today', dateLabel: () => 'Nov 12',
  bookHref: () => '#/book', state: { user: {} }
};
vm.createContext(context);
vm.runInContext(draw, context);
function price() {
  context.drawCourts();
  return grid.innerHTML.split('class="club-court-price')[1].split('<div class="space-y-1.5')[0];
}
assert.match(price(), /PHP 150\.00.*PHP 200\.00/s);
S.sel[court.id] = 1020;
assert.match(price(), /PHP 150\.00/);
assert.doesNotMatch(price(), /PHP 200\.00/);
S.sel[court.id] = 1080;
assert.match(price(), /PHP 200\.00/);
assert.doesNotMatch(price(), /PHP 150\.00/);
S.sel[court.id] = 1020;
S.dur = 120;
assert.match(price(), /PHP 350\.00/);
assert.match(price(), /\/ 2 hours/);
court.slot_minutes = 30;
slots[0].rate = 150; slots[1].rate = 200;
S.dur = 60;
assert.match(price(), /PHP 175\.00/);
slots[1].rate = undefined;
assert.match(price(), /Scheduled price unavailable/);
assert.doesNotMatch(price(), /PHP 175\.00/);
S.sel = {};
assert.match(price(), /PHP 150\.00.*PHP 200\.00/s);
console.log('Selected off-peak/peak prices, mixed-rate durations, half-hour pricing, missing rates, and deselection passed.');
