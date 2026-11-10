#!/usr/bin/env node
// DINKSLOT database backup / verify / restore (no Docker or pg_dump needed).
// Uses the Supabase CLI session you are already logged in with.
//
//   node scripts/db-backup.mjs backup [dir]            export every table to JSON + manifest (default backups/<timestamp>)
//   node scripts/db-backup.mjs verify <dir>            restore the backup into a THROWAWAY schema inside a transaction that
//                                                     is rolled back, then compare row counts and checksums with the live data
//   node scripts/db-backup.mjs restore <dir> --apply   load a backup into the linked project (a FRESH project, see docs/runbook.md)
//
// A backup contains personal data (emails, password hashes, payment references). Keep the folder private.
// backups/ is git-ignored. Files in the storage buckets (photos, QR codes, payment proofs) are NOT part of this
// export; see docs/runbook.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dependency order (parents first). pk is used for stable ordering.
const TABLES = [
  { name: "auth.users", pk: "id", auth: true },
  { name: "public.profiles", pk: "id" },
  { name: "public.platform_admin_emails", pk: "email" },
  { name: "public.tenants", pk: "id" },
  { name: "public.tenant_settings", pk: "id" },
  { name: "public.tenant_members", pk: "id" },
  { name: "public.club_players", pk: "id" },
  { name: "public.courts", pk: "id" },
  { name: "public.court_blocks", pk: "id" },
  { name: "public.bookings", pk: "id" },
  { name: "public.booking_payments", pk: "id" },
  { name: "public.notifications", pk: "id" },
  { name: "public.email_log", pk: "id" },
  { name: "public.audit_log", pk: "id" },
  { name: "public.captcha_passes", pk: "id" },
];

function cli(args, input) {
  const r = spawnSync("npx", ["--yes", "supabase", ...args], { shell: true, encoding: "utf8", maxBuffer: 1 << 29, input });
  return { out: r.stdout || "", err: r.stderr || "", status: r.status };
}
function parseJson(text) {
  const i = text.indexOf("{");
  if (i < 0) throw new Error("no JSON in CLI output: " + text.slice(0, 300));
  return JSON.parse(text.slice(i));
}
function query(sql, { write = false } = {}) {
  // SQL goes through a temp file: robust against shell quoting and large restores.
  const file = join(tmpdir(), "dinkslot_sql_" + process.pid + "_" + Math.random().toString(16).slice(2) + ".sql");
  writeFileSync(file, sql);
  try {
    return cli(["db", "query", "--remote", ...(write ? ["--yes"] : ["--read-only"]), "-f", `"${file}"`]);
  } finally { try { unlinkSync(file); } catch { /* ignore */ } }
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const q = (t) => t.name;

function projectRef() {
  const p = join("supabase", ".temp", "project-ref");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "(unlinked)";
}

// ------------------------------------------------------------------ backup
function backup(dir) {
  dir ||= join("backups", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), project_ref: projectRef(), tables: {} };
  for (const t of TABLES) {
    const r = query(`select coalesce(jsonb_agg(to_jsonb(x) order by x.${t.pk}), '[]'::jsonb) as data from ${q(t)} x`);
    const data = parseJson(r.out).rows[0].data;
    const text = JSON.stringify(data);
    const file = t.name.replace(".", "_") + ".json";
    writeFileSync(join(dir, file), text);
    manifest.tables[t.name] = { file, rows: data.length, sha256: sha(text) };
    console.log(`  ${t.name.padEnd(32)} ${String(data.length).padStart(6)} rows`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nBackup written to ${dir}  (project ${manifest.project_ref})`);
  return dir;
}

function load(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const data = {};
  for (const t of TABLES) {
    const m = manifest.tables[t.name];
    const text = readFileSync(join(dir, m.file), "utf8");
    if (sha(text) !== m.sha256) throw new Error(`checksum mismatch for ${t.name}: the backup file was changed or damaged`);
    data[t.name] = text;
  }
  return { manifest, data };
}

// ------------------------------------------------------------------ verify
function verify(dir) {
  const { manifest, data } = load(dir);
  console.log(`Backup files intact (sha256 ok). Restoring into a throwaway schema, then rolling back...`);
  let body = `create schema restore_check;\n`;
  TABLES.forEach((t, i) => {
    const n = "t" + i, tag = "$bk" + sha(t.name).slice(0, 8) + "$";
    if (data[t.name].includes(tag)) throw new Error("dollar-quote collision in " + t.name);
    body += `create table restore_check.${n} (like ${q(t)});\n` +
      `insert into restore_check.${n} select * from jsonb_populate_recordset(null::${q(t)}, ${tag}${data[t.name]}${tag}::jsonb);\n` +
      `select count(*), md5(coalesce(jsonb_agg(to_jsonb(x) order by x.${t.pk})::text, '')) into c_${i}, h_${i} from restore_check.${n} x;\n` +
      `select count(*), md5(coalesce(jsonb_agg(to_jsonb(x) order by x.${t.pk})::text, '')) into lc_${i}, lh_${i} from ${q(t)} x;\n`;
  });
  const decl = TABLES.map((_, i) => `c_${i} bigint; h_${i} text; lc_${i} bigint; lh_${i} text;`).join(" ");
  const rep = TABLES.map((t, i) =>
    `rep := rep || '${t.name}: backup-restored ' || c_${i} || ', live ' || lc_${i} || ' -> ' || ` +
    `case when c_${i} = lc_${i} and h_${i} = lh_${i} then 'MATCH' else 'DIFFERS (data changed since the backup, or restore problem)' end || E'\\n';`).join("\n");
  const sql = `do $verify$ declare rep text := ''; ${decl} begin\n${body}${rep}\nraise exception 'BACKUP_VERIFY%', E'\\n' || rep;\nend $verify$;`;
  const r = query(sql, { write: true });
  const all = r.out + r.err;
  const m = all.match(/BACKUP_VERIFY((?:\\n|\n|[^"])*)/);
  if (!m) { console.error("Verification did not complete:\n" + all.slice(0, 1500)); process.exit(1); }
  const text = m[1].replace(/\\n/g, "\n").replace(/\\+"/g, '"').replace(/CONTEXT:[^]*$/, "")
    .split("\n").map((l) => l.replace(/\\+$/, "").trim()).filter(Boolean).join("\n");
  console.log("\n" + text + "\n");
  console.log("Nothing was kept: the throwaway schema was rolled back.");
  const bad = text.split("\n").filter((l) => /DIFFERS/.test(l)).length;
  process.exit(bad ? 2 : 0);
}

// ----------------------------------------------------------------- restore
function restore(dir, args) {
  const { data } = load(dir);
  const ref = projectRef();
  console.log(`Restore target: linked project ${ref}`);
  if (!args.includes("--apply")) {
    console.log("Dry run. Nothing was written. Add --apply (and DINKSLOT_RESTORE_CONFIRM=" + ref + ") to restore.");
    return;
  }
  if (process.env.DINKSLOT_RESTORE_CONFIRM !== ref) {
    console.error(`Refusing: set DINKSLOT_RESTORE_CONFIRM=${ref} to confirm you mean this project.`);
    process.exit(1);
  }
  // Safety: restore only into an empty project unless forced.
  const cnt = parseJson(query("select (select count(*) from public.tenants) as n").out).rows[0].n;
  if (Number(cnt) > 0 && !args.includes("--force-nonempty")) {
    console.error(`Refusing: the target already has ${cnt} club(s). Restore into a fresh project (see docs/runbook.md).`);
    process.exit(1);
  }
  for (const t of TABLES) {
    const tag = "$bk" + sha(t.name).slice(0, 8) + "$";
    const src = `jsonb_populate_recordset(null::${q(t)}, ${tag}${data[t.name]}${tag}::jsonb)`;
    let sql;
    if (t.name === "public.profiles") {
      // the signup trigger already created an empty profile for each restored user: overwrite it
      sql = `insert into public.profiles select * from ${src} on conflict (auth_user_id) do update set id = excluded.id, full_name = excluded.full_name, phone = excluded.phone, is_platform_admin = excluded.is_platform_admin, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`;
    } else if (t.auth) {
      sql = `insert into auth.users select * from ${src} on conflict (id) do nothing`;
    } else if (["public.tenants", "public.bookings", "public.tenant_members", "public.club_players", "public.booking_payments"].includes(t.name)) {
      // user triggers (rate limits, notifications, email webhook) must not fire for restored history
      sql = `alter table ${q(t)} disable trigger user; insert into ${q(t)} select * from ${src} on conflict do nothing; alter table ${q(t)} enable trigger user`;
    } else {
      sql = `insert into ${q(t)} select * from ${src} on conflict do nothing`;
    }
    const r = query(sql, { write: true });
    const ok = !/"_tag":"Error"/.test(r.out + r.err);
    console.log(`  ${t.name.padEnd(32)} ${ok ? "restored" : "FAILED"}`);
    if (!ok) { console.error((r.out + r.err).slice(0, 800)); process.exit(1); }
  }
  console.log("\nRestore finished. Re-create the Vault/Edge secrets (docs/runbook.md) and restore storage files.");
}

// -------------------------------------------------------------------- main
const [cmd, a, ...rest] = process.argv.slice(2);
try {
  if (cmd === "backup") backup(a);
  else if (cmd === "verify" && a) verify(a);
  else if (cmd === "restore" && a) restore(a, rest);
  else {
    console.log("usage:\n  node scripts/db-backup.mjs backup [dir]\n  node scripts/db-backup.mjs verify <dir>\n  node scripts/db-backup.mjs restore <dir> [--apply] [--force-nonempty]");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error("\nFAILED: " + (e && e.message ? e.message : e));
  process.exit(1);
}
