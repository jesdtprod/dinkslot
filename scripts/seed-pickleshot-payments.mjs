#!/usr/bin/env node
// Fill empty Pickleshot payment slots with inactive, explicitly marked samples.
// Run: node scripts/seed-pickleshot-payments.mjs
// Requires SUPABASE_SERVICE_ROLE_KEY; never writes the key to disk.
import { readFile } from 'node:fs/promises';

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY before running this script.');
const base = 'https://achwxeisrakxdtzmfbrc.supabase.co';
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers }
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}) at ${path}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
async function patch(table, filter, data) {
  return request(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(data)
  });
}
const clubs = await request('/rest/v1/tenants?slug=eq.the-pickleshot&deleted_at=is.null&select=id');
if (clubs.length !== 1) throw new Error('Expected exactly one active Pickleshot club.');
const tenant = clubs[0].id;
const filter = `tenant_id=eq.${encodeURIComponent(tenant)}`;
const cards = await request(`/rest/v1/payment_qrs?${filter}&deleted_at=is.null&select=*`);
if (cards.length !== 9) throw new Error('Expected the club’s nine fixed payment slots.');
const names = { gcash: 'GCash', maya: 'Maya', bank: 'Bank' };
let filled = 0;
for (const card of cards) {
  if (card.qr_path || card.account_name || card.account_number || card.is_active ||
      card.label !== `${card.kind === 'bank' ? 'Bank account' : names[card.kind]} ${card.slot}`) {
    console.log(`Preserved existing ${card.kind} ${card.slot}.`);
    continue;
  }
  const path = `${tenant}/qr/sample-${card.kind}-${card.id}.png`;
  const image = await readFile(new URL(`../assets/sample-payments/${card.kind}.png`, import.meta.url));
  await request(`/storage/v1/object/payment/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: image
  });
  // Recheck empty fields in the update to preserve edits made during the upload.
  const updated = await patch('payment_qrs',
    `id=eq.${encodeURIComponent(card.id)}&qr_path=is.null&account_name=is.null&account_number=is.null&is_active=eq.false&label=eq.${encodeURIComponent(card.label)}`,
    {
      label: `SAMPLE ${names[card.kind]} ${card.slot}`,
      account_name: 'The Pickleshot (SAMPLE ONLY)',
      account_number: card.kind === 'bank' ? `DEMO BANK - SAMPLE-000${card.slot}` : `SAMPLE-09XX-XXX-000${card.slot}`,
      qr_path: path,
      is_active: false
    });
  filled += updated.length;
}
// Add sample instructions only when none exist. Preserve checkout switches and booking rules.
for (const empty of ['is.null', 'eq.']) {
  await patch('tenant_settings', `${filter}&deleted_at=is.null&payment_instructions=${empty}`, {
    payment_instructions: 'SAMPLE ONLY: These payment details and QR codes are for demonstration. Do not send money. For real bookings, request verified payment details from The Pickleshot, pay the exact booking amount, include your booking code, and upload proof of payment for review.'
  });
}
const saved = await request(`/rest/v1/payment_qrs?${filter}&deleted_at=is.null&select=label,qr_path,is_active`);
console.log(`Added ${filled} sample cards. Samples remain inactive.`);
console.log(JSON.stringify(saved, null, 2));
