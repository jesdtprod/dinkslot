// DINKSLOT club dashboard: /#/admin/<slug>, /courts, /settings.
// Only club owner/staff reach real data: every query is filtered by RLS in Postgres.
// tenant_id is never trusted from here; the database re-checks membership on every write.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc, setMsg = D.setMsg, friendly = D.friendly;
  var ctx = null; // { t: tenant row, role: 'owner'|'staff', slug }
  var TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var MAX_BYTES = 5 * 1024 * 1024;

  function q(sel, root) { return (root || D.root()).querySelector(sel); }
  function val(sel, root) { var e = q(sel, root); return e ? e.value : ""; }
  function num(sel, root) { return Number(val(sel, root)); }
  function money(n) { return "PHP " + Number(n).toFixed(2); }
  function hhmm(t) { return String(t).slice(0, 5); }
  function when(iso) {
    return new Date(iso).toLocaleString("en-PH", { timeZone: ctx.t.timezone, dateStyle: "medium", timeStyle: "short" });
  }

  // "2026-11-12T10:00" typed in the club's timezone -> UTC Date
  function zonedToUtc(local, tz) {
    var m = local.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    function off(ms) {
      var p = {};
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
    }
    return new Date(guess - off(guess - off(guess)));
  }

  // -------------------------------------------------------------- uploads
  function checkImage(file) {
    if (!file) throw new Error("Choose an image first.");
    if (!TYPES[file.type]) throw new Error("Only JPG, PNG or WebP images are allowed.");
    if (file.size > MAX_BYTES) throw new Error("The image must be 5 MB or smaller.");
  }
  // Storage policies check the first path segment (tenant id) against club membership.
  async function upload(bucket, path, file) {
    checkImage(file);
    var r = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (r.error) throw r.error;
    return path;
  }
  async function removeQuiet(bucket, path) {
    if (path) { try { await sb.storage.from(bucket).remove([path]); } catch (e) { /* best effort */ } }
  }
  async function signedUrl(path) {
    if (!path) return "";
    var r = await sb.storage.from("payment").createSignedUrl(path, 300);
    return r.data ? r.data.signedUrl : "";
  }

  var SECTIONS = {
    overview: ["Overview", "How your club is doing today."],
    bookings: ["Bookings", "Approve payments and manage today's courts."],
    courts: ["Courts", "Courts, rates, opening hours and blocked times."],
    profile: ["Club profile", "Your public page: details and photos."],
    payments: ["Payments and rules", "Payment QR, approvals and booking rules."],
    staff: ["Staff", "People who help you run the club."]
  };

  // ----------------------------------------------------------------- shell
  async function render(slug, section) {
    var root = D.root();
    root.innerHTML = '<p class="muted">Loading...</p>';
    var tr = await sb.from("tenants").select("*").eq("slug", slug).maybeSingle();
    var t = tr.data, role = null;
    if (t) {
      var mr = await sb.from("tenant_members").select("role").eq("tenant_id", t.id).eq("user_id", D.state.user.id).maybeSingle();
      role = mr.data && mr.data.role;
    }
    if (!t || !role) {
      root.innerHTML = "<h2>No access</h2><p>This club does not exist, or you are not part of its team.</p>";
      return;
    }
    ctx = { t: t, role: role, slug: slug };
    if (!section || section === "dashboard") section = "overview";
    if (section === "settings") section = "profile";
    var owner = role === "owner";
    var pendingCount = (await sb.from("bookings").select("id", { count: "exact", head: true })
      .eq("tenant_id", t.id).eq("status", "pending")).count || 0;
    var base = "#/admin/" + slug;
    var items = [
      { type: "label", label: "Manage" },
      { key: "overview", label: "Overview", icon: "dashboard", href: base },
      { key: "bookings", label: "Bookings", icon: "event_available", href: base + "/bookings", badge: pendingCount || "" },
      { key: "courts", label: "Courts", icon: "sports_tennis", href: base + "/courts" }
    ];
    if (owner) {
      items.push({ type: "label", label: "Club" },
        { key: "profile", label: "Club profile", icon: "storefront", href: base + "/profile" },
        { key: "payments", label: "Payments and rules", icon: "qr_code_2", href: base + "/payments" },
        { key: "staff", label: "Staff", icon: "group", href: base + "/staff" });
    }
    var foot = [];
    if (t.status === "approved") foot.push({ label: "View public page", icon: "open_in_new", href: "#/c/" + slug });
    foot.push({ label: "My account", icon: "arrow_back", href: "#/me" });
    var ui = D.ui.dash(root, {
      head: { title: t.name, sub: role === "owner" ? "Owner" : "Staff", status: t.status, img: t.logo_path ? D.mediaUrl(t.logo_path) : "" },
      items: items, foot: foot, active: section
    });
    var meta = SECTIONS[section] || SECTIONS.overview;
    ui.setTitle(meta[0], meta[1]);
    var sec = ui.main;
    if (t.status !== "approved") {
      sec.insertAdjacentHTML("beforebegin", '<p class="notice">This club is <b>' + esc(t.status) +
        "</b>. It is hidden from the public until the platform admin approves it. You can set it up meanwhile.</p>");
    }
    if (section === "bookings") return D.booking ? D.booking.queue(sec, t) : undefined;
    if (section === "courts") return courtsView(sec);
    if (!owner && (section === "profile" || section === "payments" || section === "staff")) {
      sec.innerHTML = "<p>Only the club owner can change this.</p>"; return;
    }
    if (section === "profile" || section === "payments" || section === "staff") return settingsView(sec, section);
    return dashboardView(sec);
  }

  // -------------------------------------------------------------- overview
  async function dashboardView(sec) {
    var t = ctx.t, tz = t.timezone;
    var today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    var dayStart = zonedToUtc(today + "T00:00", tz), dayEnd = new Date(dayStart.getTime() + 86400000);
    function count(build) {
      return build(sb.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", t.id)).then(function (r) { return r.count || 0; });
    }
    var res = await Promise.all([
      count(function (b) { return b.eq("status", "pending"); }),
      count(function (b) { return b.eq("status", "approved").gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString()); }),
      count(function (b) { return b.eq("status", "approved").gte("starts_at", dayEnd.toISOString()); }),
      sb.from("courts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).then(function (r) { return r.count || 0; }),
      sb.from("tenant_settings").select("*").eq("tenant_id", t.id).maybeSingle().then(function (r) { return r.data || {}; })
    ]);
    var pending = res[0], todayN = res[1], upcoming = res[2], courts = res[3], st = res[4];
    var base = "#/admin/" + esc(ctx.slug);
    var tile = function (n, label, icon, href, tone) {
      return '<a class="tile ' + (tone || "") + '" href="' + href + '"><span class="mi">' + icon + "</span><b>" + n + "</b><span>" + label + "</span></a>";
    };
    var items = [
      [!!t.logo_path, "Profile photo", "profile"],
      [!!t.cover_path, "Cover photo", "profile"],
      [courts > 0, "At least one court", "courts"],
      [!st.payment_enabled || !!st.qr_path, "Payment QR code", "payments"],
      [!st.payment_enabled || !!(st.payment_instructions && st.payment_instructions.trim()), "Payment instructions", "payments"]
    ];
    var done = items.filter(function (i) { return i[0]; }).length;
    sec.innerHTML = '<div class="tiles">' + tile(pending, "Needs approval", "pending_actions", base + "/bookings", pending ? "warn" : "") +
      tile(todayN, "Today", "today", base + "/bookings") + tile(upcoming, "Upcoming", "event_upcoming", base + "/bookings") +
      tile(courts, "Courts", "sports_tennis", base + "/courts") + "</div>" +
      '<div class="panel wide"><div class="row"><h2>Setup checklist</h2><span class="badge ' + (done === items.length ? "approved" : "pending") + '">' + done + "/" + items.length + "</span></div>" +
      '<ul class="check">' + items.map(function (i) {
        var canFix = i[2] === "courts" || ctx.role === "owner";
        return '<li class="' + (i[0] ? "ok" : "todo") + '"><span class="mi">' + (i[0] ? "check_circle" : "radio_button_unchecked") + "</span><span>" + esc(i[1]) + "</span>" +
          (!i[0] && canFix ? '<a class="btn sm ghost" href="' + base + "/" + i[2] + '">Set up</a>' : "") + "</li>";
      }).join("") + "</ul></div>";
  }

  // ---------------------------------------------------------------- courts
  async function courtsView(sec) {
    var t = ctx.t;
    var cr = await sb.from("courts").select("*").eq("tenant_id", t.id).order("name");
    var br = await sb.from("court_blocks").select("*").eq("tenant_id", t.id)
      .gte("ends_at", new Date().toISOString()).order("starts_at");
    var courts = cr.data || [], blocks = br.data || [];
    var byId = {}; courts.forEach(function (c) { byId[c.id] = c; });

    sec.innerHTML =
      '<div class="panel wide"><div class="row"><h2>Courts</h2><button class="btn sm" id="addc" type="button">Add court</button></div>' +
      '<p class="msg" role="alert" id="cmsg"></p><div id="cform"></div>' +
      (courts.length ? '<table class="tbl"><thead><tr><th>Court</th><th>Rate</th><th>Hours</th><th>Slot</th><th>Status</th><th></th></tr></thead><tbody>' +
        courts.map(function (c) {
          return "<tr><td><strong>" + esc(c.name) + '</strong><br><span class="muted small">' + esc(c.surface || "") + (c.is_indoor ? " indoor" : " outdoor") +
            (c.qr_path ? " - own QR" : "") + "</span></td><td>" + money(c.hourly_rate) + "/hr</td><td>" + hhmm(c.open_time) + "-" + hhmm(c.close_time) +
            "</td><td>" + c.slot_minutes + ' min</td><td><span class="badge ' + (c.status === "active" ? "approved" : "pending") + '">' + esc(c.status) +
            '</span></td><td class="nowrap"><button class="btn sm" data-edit="' + esc(c.id) + '" type="button">Edit</button> ' +
            '<button class="btn sm danger" data-del="' + esc(c.id) + '" type="button">Delete</button></td></tr>';
        }).join("") + "</tbody></table>" : '<p class="muted">No courts yet. Add your first court.</p>') + "</div>" +
      '<div class="panel wide"><h2>Blocked times</h2><p class="muted small">Block a court for maintenance or private events. Times are in ' + esc(t.timezone) + ".</p>" +
      '<p class="msg" role="alert" id="bmsg"></p>' +
      (courts.length ? '<form id="bform" class="inline"><label>Court<select id="bc">' + courts.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + "</select></label>" +
        '<label>From<input id="bs" type="datetime-local" required></label><label>To<input id="be" type="datetime-local" required></label>' +
        '<label>Reason<input id="br" maxlength="120"></label><button class="btn sm" type="submit">Block time</button></form>' : "") +
      (blocks.length ? '<table class="tbl"><thead><tr><th>Court</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead><tbody>' +
        blocks.map(function (b) {
          return "<tr><td>" + esc((byId[b.court_id] || {}).name || "") + "</td><td>" + esc(when(b.starts_at)) + "</td><td>" + esc(when(b.ends_at)) +
            "</td><td>" + esc(b.reason || "") + '</td><td><button class="btn sm danger" data-delb="' + esc(b.id) + '" type="button">Remove</button></td></tr>';
        }).join("") + "</tbody></table>" : '<p class="muted">No upcoming blocks.</p>') + "</div>";

    q("#addc", sec).onclick = function () { courtForm(null, byId); };
    Array.prototype.forEach.call(sec.querySelectorAll("[data-edit]"), function (b) {
      b.onclick = function () { courtForm(byId[b.getAttribute("data-edit")], byId); };
    });
    Array.prototype.forEach.call(sec.querySelectorAll("[data-del]"), function (b) {
      b.onclick = async function () {
        var c = byId[b.getAttribute("data-del")];
        if (!confirm('Delete court "' + c.name + '"? This cannot be undone.')) return;
        var r = await sb.rpc("delete_court", { p_court_id: c.id });
        if (r.error) return setMsg(sec, r.error.message.indexOf("court_has_bookings") !== -1
          ? "This court has upcoming bookings. Cancel them first, or set it to maintenance." : friendly(r.error), "err");
        await removeQuiet("payment", c.qr_path);
        courtsView(sec);
      };
    });
    Array.prototype.forEach.call(sec.querySelectorAll("[data-delb]"), function (b) {
      b.onclick = async function () {
        var r = await sb.rpc("delete_court_block", { p_block_id: b.getAttribute("data-delb") });
        if (r.error) return setMsg(q("#bmsg", sec).parentNode, friendly(r.error), "err");
        courtsView(sec);
      };
    });
    var bf = q("#bform", sec);
    if (bf) bf.onsubmit = async function (e) {
      e.preventDefault();
      var s = zonedToUtc(val("#bs", bf), t.timezone), en = zonedToUtc(val("#be", bf), t.timezone);
      var msg = q("#bmsg", sec);
      if (!s || !en || en <= s) { msg.className = "msg err"; msg.textContent = "End must be after start."; return; }
      var r = await sb.from("court_blocks").insert({ tenant_id: t.id, court_id: val("#bc", bf),
        starts_at: s.toISOString(), ends_at: en.toISOString(), reason: val("#br", bf).trim() || null });
      if (r.error) { msg.className = "msg err"; msg.textContent = friendly(r.error); return; }
      courtsView(sec);
    };
  }

  function courtForm(c, byId) {
    var box = q("#cform");
    var v = c || { name: "", surface: "", is_indoor: false, hourly_rate: "", slot_minutes: 60, open_time: "06:00", close_time: "22:00", status: "active" };
    box.innerHTML = '<form id="cf" class="subpanel"><h3>' + (c ? "Edit court" : "New court") + "</h3>" +
      '<div class="grid2"><label>Name<input id="cn" maxlength="60" required value="' + esc(v.name) + '"></label>' +
      '<label>Surface<input id="cs" maxlength="40" placeholder="e.g. Acrylic" value="' + esc(v.surface || "") + '"></label>' +
      '<label>Hourly rate (PHP)<input id="cr" type="number" min="0" step="0.01" required value="' + esc(v.hourly_rate) + '"></label>' +
      '<label>Slot length<select id="cm">' + [30, 60, 90, 120].map(function (m) {
        return '<option value="' + m + '"' + (m === v.slot_minutes ? " selected" : "") + ">" + m + " minutes</option>"; }).join("") + "</select></label>" +
      '<label>Opens<input id="co" type="time" required value="' + esc(hhmm(v.open_time)) + '"></label>' +
      '<label>Closes<input id="cc" type="time" required value="' + esc(hhmm(v.close_time)) + '"></label>' +
      '<label>Status<select id="cst"><option value="active"' + (v.status === "active" ? " selected" : "") + '>Active</option><option value="maintenance"' +
      (v.status === "maintenance" ? " selected" : "") + ">Maintenance (not bookable)</option></select></label>" +
      '<label class="chk"><input id="ci" type="checkbox"' + (v.is_indoor ? " checked" : "") + "> Indoor court</label></div>" +
      '<label>Own payment QR for this court (optional, replaces the club QR)<input id="cq" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
      (c && c.qr_path ? '<label class="chk"><input id="cqx" type="checkbox"> Remove this court\'s own QR</label>' : "") +
      '<p class="msg" role="alert"></p><button class="btn sm" type="submit">Save court</button> <button class="btn sm ghost" id="cx" type="button">Cancel</button></form>';
    q("#cx", box).onclick = function () { box.innerHTML = ""; };
    q("#cf", box).onsubmit = async function (e) {
      e.preventDefault();
      var f = q("#cf", box), btn = q("button[type=submit]", f);
      if (val("#co", f) >= val("#cc", f)) return setMsg(f, "Closing time must be after opening time.", "err");
      btn.disabled = true; setMsg(f, "Saving...", "");
      try {
        var payload = { name: val("#cn", f).trim(), surface: val("#cs", f).trim() || null, is_indoor: q("#ci", f).checked,
          hourly_rate: num("#cr", f), slot_minutes: num("#cm", f), open_time: val("#co", f), close_time: val("#cc", f), status: val("#cst", f) };
        var file = q("#cq", f).files[0], oldQr = c && c.qr_path;
        if (file) payload.qr_path = await upload("payment", ctx.t.id + "/qr/court-" + Date.now() + "." + TYPES[file.type], file);
        else if (c && q("#cqx", f) && q("#cqx", f).checked) payload.qr_path = null;
        var r = c ? await sb.from("courts").update(payload).eq("id", c.id)
                  : await sb.from("courts").insert(Object.assign({ tenant_id: ctx.t.id }, payload));
        if (r.error) throw r.error;
        if (c && ("qr_path" in payload) && oldQr) await removeQuiet("payment", oldQr);
        courtsView(q("#sec"));
      } catch (err) { btn.disabled = false; setMsg(f, friendly(err), "err"); }
    };
  }

  // -------------------------------------------------------------- settings
  async function settingsView(sec, part) {
    var t = ctx.t;
    var st = (await sb.from("tenant_settings").select("*").eq("tenant_id", t.id).maybeSingle()).data || {};
    var qrUrl = part === "payments" ? await signedUrl(st.qr_path) : "";
    var img = function (p, cls) { return p ? '<img class="thumb ' + cls + '" src="' + esc(D.mediaUrl(p)) + '" alt="">' : '<div class="thumb ' + cls + ' ph"></div>'; };

    var PANELS = {};
    PANELS.profile =
      '<div class="panel wide"><h2>Club profile</h2><form id="pf"><div class="grid2">' +
      '<label>Club name<input id="pn" maxlength="80" required value="' + esc(t.name) + '"></label>' +
      '<label>City<input id="pc" value="' + esc(t.city || "") + '"></label>' +
      '<label>Street address<input id="pa" value="' + esc(t.address || "") + '"></label>' +
      '<label>Contact phone<input id="pp" value="' + esc(t.contact_phone || "") + '"></label>' +
      '<label>Contact email (used as reply-to)<input id="pe" type="email" value="' + esc(t.contact_email || "") + '"></label></div>' +
      '<label>Description<textarea id="pd" rows="3">' + esc(t.description || "") + '</textarea></label>' +
      '<p class="msg" role="alert"></p><button class="btn sm" type="submit">Save profile</button></form>' +
      '<h3>Photos</h3><div class="photos">' +
      '<div>' + img(t.logo_path, "round") + '<label>Profile photo<input id="logof" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn sm" id="logob" type="button">Upload profile photo</button></div>' +
      '<div>' + img(t.cover_path, "wide") + '<label>Cover photo<input id="coverf" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn sm" id="coverb" type="button">Upload cover photo</button></div>' +
      '</div><p class="msg" role="alert" id="phmsg"></p></div>';
    PANELS.payments =
      '<div class="panel wide"><h2>Payments and booking rules</h2><form id="sf">' +
      '<label class="chk"><input id="spe" type="checkbox"' + (st.payment_enabled ? " checked" : "") + '> Players pay by scanning my QR (turn off if you collect payment another way)</label>' +
      '<label>Payment instructions<textarea id="spi" rows="3" placeholder="e.g. GCash 0917 000 0000, include the booking code in the message">' + esc(st.payment_instructions || "") + '</textarea></label>' +
      '<div class="qrbox">' + (qrUrl ? '<img class="qr" src="' + esc(qrUrl) + '" alt="Payment QR">' : '<div class="qr ph"></div>') +
      '<div><label>Payment QR (GCash, Maya or bank)<input id="qrf" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
      '<button class="btn sm" id="qrb" type="button">Upload QR</button></div></div>' +
      '<label class="chk"><input id="sar" type="checkbox"' + (st.approval_required ? " checked" : "") + '> I approve each booking myself (recommended)</label>' +
      '<div class="grid2"><label>Book up to (days ahead)<input id="sbw" type="number" min="1" max="365" required value="' + esc(st.booking_window_days) + '"></label>' +
      '<label>Min hours per booking<input id="smn" type="number" min="0.5" step="0.5" required value="' + esc(st.min_hours) + '"></label>' +
      '<label>Max hours per booking<input id="smx" type="number" min="0.5" step="0.5" required value="' + esc(st.max_hours) + '"></label>' +
      '<label>Cancel allowed until (hours before start)<input id="scc" type="number" min="0" required value="' + esc(st.cancel_cutoff_hours) + '"></label>' +
      '<label>Hold an unpaid booking for (minutes)<input id="sph" type="number" min="5" max="1440" required value="' + esc(st.pending_hold_minutes) + '"></label></div>' +
      '<p class="msg" role="alert"></p><button class="btn sm" type="submit">Save settings</button></form></div>';
    PANELS.staff =
      '<div class="panel wide"><h2>Staff</h2><p class="muted small">Staff can manage courts and approve bookings. They must already have a DINKSLOT account with a confirmed email.</p>' +
      '<p class="msg" role="alert" id="stmsg"></p><div id="stafflist">Loading...</div>' +
      '<form id="stf" class="inline"><label>Staff email<input id="ste" type="email" required></label><button class="btn sm" type="submit">Add staff</button></form></div>';
    sec.innerHTML = PANELS[part];

    if (part === "profile") {
    // profile text
    q("#pf", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this;
      var r = await sb.from("tenants").update({ name: val("#pn", f).trim(), city: val("#pc", f).trim() || null, address: val("#pa", f).trim() || null,
        contact_phone: val("#pp", f).trim() || null, contact_email: val("#pe", f).trim() || null, description: val("#pd", f).trim() || null }).eq("id", t.id);
      if (r.error) return setMsg(f, friendly(r.error), "err");
      setMsg(f, "Saved.", "ok");
    };
    // photos
    function photoUpload(btnSel, fileSel, col, name) {
      q(btnSel, sec).onclick = async function () {
        var msg = q("#phmsg", sec), file = q(fileSel, sec).files[0];
        msg.className = "msg"; msg.textContent = "Uploading...";
        try {
          var old = ctx.t[col];
          var path = await upload("club-media", t.id + "/" + name + "-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
          var r = await sb.from("tenants").update((function () { var o = {}; o[col] = path; return o; })()).eq("id", t.id);
          if (r.error) { await removeQuiet("club-media", path); throw r.error; }
          await removeQuiet("club-media", old);
          render(ctx.slug, "profile");
        } catch (err) { msg.className = "msg err"; msg.textContent = friendly(err); }
      };
    }
    photoUpload("#logob", "#logof", "logo_path", "logo");
    photoUpload("#coverb", "#coverf", "cover_path", "cover");

    }
    if (part === "payments") {
    // payment QR
    q("#qrb", sec).onclick = async function () {
      var f = q("#sf", sec), file = q("#qrf", sec).files[0];
      setMsg(f, "Uploading...", "");
      try {
        var path = await upload("payment", t.id + "/qr/club-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
        var r = await sb.from("tenant_settings").update({ qr_path: path }).eq("tenant_id", t.id);
        if (r.error) { await removeQuiet("payment", path); throw r.error; }
        await removeQuiet("payment", st.qr_path);
        render(ctx.slug, "payments");
      } catch (err) { setMsg(f, friendly(err), "err"); }
    };
    // booking rules
    q("#sf", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this;
      if (num("#smx", f) < num("#smn", f)) return setMsg(f, "Max hours must be at least the min hours.", "err");
      var r = await sb.from("tenant_settings").update({
        payment_enabled: q("#spe", f).checked, payment_instructions: val("#spi", f).trim() || null, approval_required: q("#sar", f).checked,
        booking_window_days: num("#sbw", f), min_hours: num("#smn", f), max_hours: num("#smx", f),
        cancel_cutoff_hours: num("#scc", f), pending_hold_minutes: num("#sph", f) }).eq("tenant_id", t.id);
      if (r.error) return setMsg(f, friendly(r.error), "err");
      setMsg(f, "Saved.", "ok");
    };
    }
    if (part === "staff") {
    // staff
    async function loadStaff() {
      var r = await sb.rpc("list_tenant_staff", { p_tenant_id: t.id });
      var box = q("#stafflist", sec);
      if (r.error) { box.textContent = friendly(r.error); return; }
      box.innerHTML = '<table class="tbl"><tbody>' + (r.data || []).map(function (m) {
        return "<tr><td>" + esc(m.full_name || "") + '<br><span class="muted small">' + esc(m.email) + "</span></td><td>" + esc(m.role) + "</td><td>" +
          (m.role === "staff" ? '<button class="btn sm danger" data-rm="' + esc(m.member_id) + '" type="button">Remove</button>' : "") + "</td></tr>";
      }).join("") + "</tbody></table>";
      Array.prototype.forEach.call(box.querySelectorAll("[data-rm]"), function (b) {
        b.onclick = async function () {
          if (!confirm("Remove this staff member?")) return;
          var x = await sb.rpc("remove_staff", { p_member_id: b.getAttribute("data-rm") });
          if (x.error) return setMsg(sec, friendly(x.error), "err");
          loadStaff();
        };
      });
    }
    loadStaff();
    q("#stf", sec).onsubmit = async function (e) {
      e.preventDefault();
      var msg = q("#stmsg", sec);
      var r = await sb.rpc("add_staff", { p_tenant_id: t.id, p_email: val("#ste", this).trim() });
      if (r.error) {
        msg.className = "msg err";
        msg.textContent = r.error.message.indexOf("user_not_found") !== -1 ? "No confirmed DINKSLOT account has that email. Ask them to sign up and confirm first." : friendly(r.error);
        return;
      }
      msg.className = "msg ok"; msg.textContent = "Staff added.";
      q("#ste", sec).value = "";
      loadStaff();
    };
    }
  }

  D.admin = { render: render };
})();
