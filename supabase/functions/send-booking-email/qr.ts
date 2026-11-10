// Ticket QR as a PNG, for emails (email clients do not show SVG).
// Same look as the booking ticket in the app (js/booking.js bookingQrSvg): rounded-square modules,
// rounded corner squares, small DINKSLOT logo on a plain white block in the centre.
// Error correction H; the modules under the logo are left out. Tested by decoding the PNG (qr_test.ts).
import qrcode from "npm:qrcode-generator@1.4.4";
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import { LOGO_PNG_BASE64 } from "./logo.ts";

const S = 14;        // pixels per module
const QUIET = 4;     // quiet zone, in modules
const HOLE_W = 3;    // modules cleared left/right of the centre (7 wide)
const HOLE_H = 2;    // modules cleared above/below the centre (5 tall)
const SS = 3;        // anti-aliasing: 3 x 3 samples per pixel

interface RR { x: number; y: number; w: number; h: number; r: number } // rounded rectangle, in pixels

function inside(px: number, py: number, q: RR): boolean {
  if (px < q.x || px > q.x + q.w || py < q.y || py > q.y + q.h) return false;
  const cx = Math.max(q.x + q.r, Math.min(px, q.x + q.w - q.r));
  const cy = Math.max(q.y + q.r, Math.min(py, q.y + q.h - q.r));
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= q.r * q.r;
}

function fill(png: PNG, q: RR, v: number) { // v: 0 = black, 255 = white
  const x0 = Math.max(0, Math.floor(q.x)), x1 = Math.min(png.width - 1, Math.ceil(q.x + q.w));
  const y0 = Math.max(0, Math.floor(q.y)), y1 = Math.min(png.height - 1, Math.ceil(q.y + q.h));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, q)) hit++;
      if (!hit) continue;
      const a = hit / (SS * SS), i = (png.width * y + x) << 2;
      for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(png.data[i + k] * (1 - a) + v * a);
      png.data[i + 3] = 255;
    }
  }
}

// the logo, scaled with bilinear sampling and composited over whatever is already there (white)
function drawLogo(png: PNG, left: number, top: number, size: number) {
  const src = PNG.sync.read(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const px = (x: number, y: number, k: number) => {
    x = Math.max(0, Math.min(src.width - 1, x)); y = Math.max(0, Math.min(src.height - 1, y));
    const i = (src.width * y + x) << 2;
    return k === 3 ? src.data[i + 3] : src.data[i + k] * src.data[i + 3] / 255; // premultiplied colour
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * src.width / size - 0.5, v = (y + 0.5) * src.height / size - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const mix = (k: number) => px(x0, y0, k) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, k) * fx * (1 - fy) + px(x0, y0 + 1, k) * (1 - fx) * fy + px(x0 + 1, y0 + 1, k) * fx * fy;
      const a = mix(3) / 255;
      if (a <= 0) continue;
      const i = (png.width * (top + y) + (left + x)) << 2;
      for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(mix(k) + png.data[i + k] * (1 - a));
    }
  }
}

export function bookingQrPng(text: string): Uint8Array {
  const code = qrcode(3, "H"); code.addData(text); code.make();
  const count = code.getModuleCount(), cells = count + QUIET * 2, N = cells * S;
  const png = new PNG({ width: N, height: N });
  png.data.fill(255); // white, opaque
  const c = cells / 2; // centre, in modules

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!code.isDark(row, col)) continue;
      if ((row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7)) continue; // corner squares below
      const mx = col + QUIET + 0.5, my = row + QUIET + 0.5;
      if (Math.abs(mx - c) <= HOLE_W && Math.abs(my - c) <= HOLE_H) continue; // room for the logo
      fill(png, { x: (mx - 0.47) * S, y: (my - 0.47) * S, w: 0.94 * S, h: 0.94 * S, r: 0.3 * S }, 0);
    }
  }
  for (const [mx, my] of [[QUIET, QUIET], [QUIET + count - 7, QUIET], [QUIET, QUIET + count - 7]]) {
    fill(png, { x: mx * S, y: my * S, w: 7 * S, h: 7 * S, r: 1.2 * S }, 0);
    fill(png, { x: (mx + 1) * S, y: (my + 1) * S, w: 5 * S, h: 5 * S, r: 0.6 * S }, 255);
    fill(png, { x: (mx + 2) * S, y: (my + 2) * S, w: 3 * S, h: 3 * S, r: 0.4 * S }, 0);
  }
  // logo: plain white block exactly as big as the cleared modules, no border, the logo (6 modules wide) on it
  fill(png, { x: (c - HOLE_W - 0.5) * S, y: (c - HOLE_H - 0.5) * S, w: (HOLE_W * 2 + 1) * S, h: (HOLE_H * 2 + 1) * S, r: 1 * S }, 255);
  drawLogo(png, Math.round((c - 3) * S), Math.round((c - 3) * S), 6 * S);
  return new Uint8Array(PNG.sync.write(png));
}
