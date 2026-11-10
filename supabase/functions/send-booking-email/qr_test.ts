// Run: deno test -A supabase/functions/send-booking-email/qr_test.ts
// Decodes the generated PNG with a real QR scanner (jsQR), so "it looks right" is not the only check.
import jsQRModule from "npm:jsqr@1.4.0";
// deno-lint-ignore no-explicit-any
const jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null = (jsQRModule as any).default ?? (jsQRModule as any);
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import { bookingQrPng } from "./qr.ts";

function decode(bytes: Uint8Array, scaleDown = 1): { text: string | null; png: PNG } {
  const png = PNG.sync.read(Buffer.from(bytes));
  let w = png.width, h = png.height, data = png.data as Uint8Array;
  if (scaleDown > 1) { // simulate a smaller / phone-sized copy by nearest-neighbour downscale
    const nw = Math.floor(w / scaleDown), nh = Math.floor(h / scaleDown), out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let k = 0; k < 4; k++) out[(y * nw + x) * 4 + k] = data[((y * scaleDown) * w + x * scaleDown) * 4 + k];
    return { text: jsQR(out, nw, nh)?.data ?? null, png };
  }
  return { text: jsQR(new Uint8ClampedArray(data), w, h)?.data ?? null, png };
}

const CODES = ["DS-ABC123XYZ", "DS-01H9Z3K4M", "DS-ZZZZZZZZZ", "DS-000000001", "DS-9Q8W7E6R5", "DS-A1B2C3D4E", "DS-MMMMMMMMM", "DS-12345678A"];

Deno.test("ticket QR PNG is a valid PNG of a sensible size", () => {
  const b = bookingQrPng(CODES[0]);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => b[i] === v)) throw new Error("not a PNG");
  const { png } = decode(b);
  if (png.width !== png.height || png.width < 400 || png.width > 700) throw new Error("unexpected size " + png.width);
  if (b.length > 60_000) throw new Error("too heavy for an email: " + b.length);
});

Deno.test("ticket QR PNG scans back to the booking code (with the logo in the centre)", () => {
  for (const code of CODES) {
    const { text } = decode(bookingQrPng(code));
    if (text !== code) throw new Error(`${code} decoded as ${text}`);
  }
});

Deno.test("ticket QR still scans when shown at half size", () => {
  for (const code of CODES.slice(0, 4)) {
    const { text } = decode(bookingQrPng(code), 2);
    if (text !== code) throw new Error(`${code} (half size) decoded as ${text}`);
  }
});

Deno.test("the logo is really drawn in the centre (lime pixels from the DINKSLOT logo)", () => {
  const { png } = decode(bookingQrPng(CODES[0]));
  const c = Math.floor(png.width / 2), r = 40;
  let lime = 0;
  for (let y = c - r; y < c + r; y++) for (let x = c - r; x < c + r; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i + 1] > 180 && png.data[i] > 120 && png.data[i + 2] < 90) lime++;
  }
  if (lime < 150) throw new Error("no logo found in the centre (lime pixels: " + lime + ")");
});
