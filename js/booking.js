// DINKSLOT booking flow: book a court, pay by QR + proof, my bookings, club approval queue.
// No business rules live here. The database decides (create_booking, attach_payment_proof,
// decide_booking, cancel_booking); this file only collects input and shows results.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc;
  var TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var MAX_BYTES = 5 * 1024 * 1024;
  var keys = {}; // idempotency keys per selection, so a retried click never double-books

  var ERR = {
    slot_taken: "Sorry, that time was just taken. Pick another slot.",
    slot_blocked: "The club has blocked that time.",
    not_on_slot_grid: "Please pick a start time from the grid.",
    outside_opening_hours: "That time is outside the court's opening hours.",
    outside_booking_window: "That date is too far ahead for this club.",
    duration_not_allowed: "That length is not allowed by this club.",
    in_the_past: "That time has already passed.",
    join_club_first: "Join this club first.",
    player_blocked: "You are blocked from this club.",
    court_unavailable: "This court is not available right now.",
    club_not_approved: "This club is not open for booking.",
    past_cancel_cutoff: "It is too late to cancel this booking. Please contact the club.",
    proof_required: "No payment proof has been uploaded for this booking yet.",
    reason_required: "A reason is required.",
    invalid_state: "This booking was already updated. Refreshing.",
    payer_reference_already_used: "That payer reference was already used for another booking.",
    invalid_payer_reference: "Enter the reference number from your payment (3 to 60 characters).",
    invalid_proof_path: "The upload failed. Please try again.",
    payment_disabled: "This club does not take payment through the app.",
    court_has_bookings: "That court has upcoming bookings.",
    choose_player_or_guest: "Choose a registered player, or enter a guest name.",
    player_not_found: "That player is not on your club's list.",
    user_not_found: "No confirmed player account has that email.",
    club_account_cannot_book: "That is a club account. Club accounts cannot be players.",
    guest_name_too_long: "The guest name is too long (60 characters at most).",
    crosses_midnight: "A booking cannot run past midnight."
  };
  function nice(err) {
    var m = (err && (err.message || err.msg)) || String(err || "");
    for (var k in ERR) if (m.indexOf(k) !== -1) return ERR[k];
    return D.friendly(err);
  }
  function uuid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(16).slice(2);
  }
  function q(sel, root) { return (root || D.root()).querySelector(sel); }
  function alive(el) { return !!el && document.body.contains(el); }
  function money(n) { return "PHP " + Number(n).toFixed(2); }
  function hhmm(t) { return String(t).slice(0, 5); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // closing time 00:00 means midnight: the end of the day (1440 minutes), so the last slot can end at 12 AM
  function closeMin(c) { var h = hhmm(c.close_time); return h === "00:00" ? 1440 : toMin(h); }
  function toMin(hm) { var p = hm.split(":"); return +p[0] * 60 + +p[1]; }
  function timeOf(d, tz) { return d.toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" }); }
  function dayStr(tz) { return new Date().toLocaleDateString("en-CA", { timeZone: tz }); }
  function range(s, e, tz) {
    var a = new Date(s), b = new Date(e);
    return a.toLocaleDateString("en-PH", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }) + ", " + timeOf(a, tz) + " - " + timeOf(b, tz);
  }
  function msg(root, text, kind) {
    var m = q(".msg", root);
    if (m) { m.className = "msg " + (kind || ""); m.textContent = text || ""; }
  }
  function setMsg(el, text, kind) { if (el) { el.className = "msg " + (kind || ""); el.textContent = text || ""; } }

  // "2026-11-12T10:00" typed/computed in the club's timezone -> UTC Date
  function zonedToUtc(local, tz) {
    var m = local.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    function off(ms) {
      var p = {};
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
    }
    return new Date(guess - off(guess - off(guess)));
  }

  function checkImage(file) {
    if (!file) throw new Error("Choose a screenshot of your payment first.");
    if (!TYPES[file.type]) throw new Error("Only JPG, PNG or WebP images are allowed.");
    if (file.size > MAX_BYTES) throw new Error("The image must be 5 MB or smaller.");
  }
  async function signed(path) {
    if (!path) return "";
    var r = await sb.storage.from("payment").createSignedUrl(path, 300);
    return r.data ? r.data.signedUrl : "";
  }

  // One interval ticks every countdown on screen; it stops itself when they are gone.
  var tickTimer = null;
  function startTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      var els = document.querySelectorAll("[data-exp]");
      if (!els.length) { clearInterval(tickTimer); tickTimer = null; return; }
      Array.prototype.forEach.call(els, function (el) {
        var left = new Date(el.getAttribute("data-exp")).getTime() - Date.now();
        el.textContent = left > 0 ? Math.floor(left / 60000) + ":" + pad(Math.floor(left / 1000) % 60) : "expired";
      });
    }, 1000);
  }

  // ======================================================== payment panel
  // Shows amount, QR, instructions, reference code and the proof upload for one booking.
  async function payPanel(el, b, ctx) {
    el.innerHTML = '<div class="space-y-4"><div class="h-32 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-24 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div>';
    var ir = await sb.rpc("get_booking_info", { p_court_id: b.court_id });
    if (ir.error) { el.innerHTML = '<p class="msg err">' + esc(nice(ir.error)) + "</p>"; return; }
    var info = ir.data;
    if (b.status === "approved") {
      el.innerHTML = '<p class="msg ok">Your booking is approved. See you on the court!</p>'; return;
    }
    if (b.status !== "pending") { el.innerHTML = ""; return; }
    if (!info.payment_enabled) {
      el.innerHTML = '<p class="msg ok">Request sent. The club will review it and you will see the result here.</p>'; return;
    }
    var qrs = info.qrs || [], urls = {}, method = qrs.length ? qrs[0].label : null, attemptKey = uuid();
    if (qrs.length) {
      var su = await sb.storage.from("payment").createSignedUrls(qrs.map(function (x) { return x.qr_path; }), 600);
      (su.data || []).forEach(function (x) { if (x.path && x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    // one QR per payment method: tabs switch between the ones the club accepts
    function qrSide(i) {
      var x = qrs[i];
      if (!x) return '<div class="qr ph"></div><p class="muted small">The club has not set up a payment QR yet. Contact the club to pay.</p>';
      return (qrs.length > 1 ? '<div class="qrtabs" role="tablist">' + qrs.map(function (y, k) {
          return '<button type="button" role="tab" class="qrtab' + (k === i ? " on" : "") + '" data-i="' + k + '">' + esc(y.label) + "</button>"; }).join("") + "</div>" : "") +
        (urls[x.qr_path] ? '<img class="qr" src="' + esc(urls[x.qr_path]) + '" alt="' + esc(x.label) + ' QR">' : '<div class="qr ph"></div>') +
        '<p class="small"><b>' + esc(x.label) + "</b>" + (x.account_name ? "<br>" + esc(x.account_name) : "") + (x.account_number ? "<br>" + esc(x.account_number) : "") + "</p>";
    }
    el.innerHTML =
      '<div class="pay"><div id="qrside">' + qrSide(0) + "</div>" +
      "<div><p class=\"muted small\">Amount to pay</p><p class=\"bigamt\">" + money(b.amount) + "</p>" +
      '<p class="muted small">Include this code in your payment note</p><p class="refcode">' + esc(b.reference_code) + "</p>" +
      (info.payment_instructions ? '<p class="small">' + esc(info.payment_instructions) + "</p>" : "") +
      (b.expires_at ? '<p class="small">Pay within <b class="timer" data-exp="' + esc(b.expires_at) + '"></b> or the slot is released.</p>' : "") + "</div></div>" +
      '<form class="proof"><h3>Upload your proof</h3><label>Payment reference number<input id="pref" maxlength="60" required placeholder="e.g. GCash ref no."></label>' +
      '<label>Screenshot of the payment<input id="pfile" type="file" accept="image/jpeg,image/png,image/webp" required></label>' +
      '<p class="msg" role="alert"></p><button class="btn" type="submit">Submit proof</button></form>';
    startTicker();
    function bindTabs() {
      Array.prototype.forEach.call(el.querySelectorAll(".qrtab"), function (b) {
        b.onclick = function () { var i = +b.getAttribute("data-i"); method = qrs[i].label; q("#qrside", el).innerHTML = qrSide(i); bindTabs(); };
      });
    }
    bindTabs();
    q("form.proof", el).onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = q("button", f);
      btn.disabled = true; msg(f, "Uploading...", "");
      try {
        var file = q("#pfile", f).files[0];
        checkImage(file);
        // Storage policy: <tenant_id>/proofs/<my user id>/...  (first segment = club, third = me)
        var path = b.tenant_id + "/proofs/" + D.state.user.id + "/" + b.id + "-" + attemptKey + "." + TYPES[file.type];
        var up = await sb.storage.from("payment").upload(path, file, { contentType: file.type, upsert: false });
        if (up.error && !/exist|duplicate|409/i.test(up.error.message || "")) throw up.error;
        var r = await sb.rpc("attach_payment_proof", { p_booking_id: b.id, p_proof_path: path,
          p_payer_reference: q("#pref", f).value.trim(), p_idempotency_key: attemptKey, p_method: method });
        if (r.error) throw r.error;
        el.innerHTML = '<p class="msg ok">Proof submitted. The club will check it and approve your booking. You will see the result here.</p>';
        if (ctx && ctx.onDone) ctx.onDone();
      } catch (err) { btn.disabled = false; msg(f, nice(err), "err"); }
    };
  }

  // ============================================================ book page
  async function renderBook(slug) {
    var root = D.root();
    if (!D.requireUser("/c/" + slug + "/book")) return;
    root.innerHTML = '<div class="pubwrap narrow space-y-6">' +
      '<div class="h-8 w-48 rounded-lg bg-surface-container-high/70 ds-skeleton"></div>' +
      '<div class="flex gap-2 overflow-x-auto pb-2">' +
        '<div class="w-16 h-20 rounded-xl bg-surface-container-high/60 ds-skeleton shrink-0"></div>' +
        '<div class="w-16 h-20 rounded-xl bg-surface-container-high/40 ds-skeleton shrink-0"></div>' +
        '<div class="w-16 h-20 rounded-xl bg-surface-container-high/40 ds-skeleton shrink-0"></div>' +
        '<div class="w-16 h-20 rounded-xl bg-surface-container-high/40 ds-skeleton shrink-0"></div>' +
      '</div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
        '<div class="h-12 rounded-lg bg-surface-container-high/50 ds-skeleton"></div>' +
        '<div class="h-12 rounded-lg bg-surface-container-high/50 ds-skeleton"></div>' +
        '<div class="h-12 rounded-lg bg-surface-container-high/50 ds-skeleton"></div>' +
        '<div class="h-12 rounded-lg bg-surface-container-high/50 ds-skeleton"></div>' +
      '</div>' +
    '</div>';
    var club = (await sb.from("public_clubs").select("*").eq("slug", slug).maybeSingle()).data;
    if (!club) { root.innerHTML = "<h2>Club not found</h2><p>This club does not exist or is not approved yet.</p>"; return; }
    var me = (await sb.from("club_players").select("id,status,display_name").eq("tenant_id", club.id)
      .eq("user_id", D.state.user.id).maybeSingle()).data;
    if (!me) return D.go("/c/" + slug + "/join");
    if (me.status === "blocked") { root.innerHTML = "<h2>Booking unavailable</h2><p>You are blocked from this club. Please contact the club.</p>"; return; }
    var courts = (await sb.from("public_courts").select("*").eq("club_slug", slug).order("name")).data || [];
    var tz = club.timezone || "Asia/Manila";
    var S = { court: null, info: null, date: "", slots: [], start: null, count: 1 };

    root.innerHTML =
      '<div class="bookwrap"><a class="back" href="#/c/' + esc(slug) + '">&larr; ' + esc(club.name) + "</a><h1>Book a court</h1>" +
      '<div class="panel wide"><h2>1. Choose a court</h2>' + (courts.length ? '<div class="courtpick">' + courts.map(function (c) {
        return '<button type="button" class="courtbtn" data-c="' + esc(c.id) + '"><b>' + esc(c.name) + "</b><span>" + (c.is_indoor ? "Indoor" : "Outdoor") +
          " - " + money(c.hourly_rate) + "/hr</span></button>";
      }).join("") + "</div>" : '<p class="muted">This club has no bookable courts yet.</p>') + "</div>" +
      '<div class="panel wide" id="slotpanel" hidden><h2>2. Pick a date and time</h2><div class="inline">' +
      '<label>Date<input id="bd" type="date"></label><label>Length<select id="bn"></select></label></div>' +
      '<div id="slots" class="slots"></div><p class="legend small muted">Greyed out times are taken or in the past. Times are in ' + esc(tz) + ".</p>" +
      '<div id="sum" class="summary"></div><p class="msg" role="alert"></p><button class="btn" id="reserve" type="button" disabled>Reserve this slot</button></div>' +
      '<div class="panel wide" id="paypanel" hidden></div></div>';

    function pickCourt(id) {
      S.court = courts.filter(function (c) { return c.id === id; })[0];
      Array.prototype.forEach.call(root.querySelectorAll(".courtbtn"), function (b) { b.classList.toggle("on", b.getAttribute("data-c") === id); });
      q("#slotpanel", root).hidden = false;
      q("#paypanel", root).hidden = true;
      sb.rpc("get_booking_info", { p_court_id: id }).then(function (r) {
        if (r.error) return msg(q("#slotpanel", root), nice(r.error), "err");
        S.info = r.data;
        var step = S.court.slot_minutes, mn = Math.max(1, Math.ceil(r.data.min_hours * 60 / step)), mx = Math.max(mn, Math.floor(r.data.max_hours * 60 / step));
        var opts = "";
        for (var n = mn; n <= mx; n++) opts += '<option value="' + n + '">' + (n * step / 60) + " hour" + (n * step === 60 ? "" : "s") + "</option>";
        q("#bn", root).innerHTML = opts; S.count = mn; S.start = null;
        var today = dayStr(tz), last = new Date(Date.now() + r.data.booking_window_days * 86400000).toLocaleDateString("en-CA", { timeZone: tz });
        var bd = q("#bd", root); bd.min = today; bd.max = last; if (!S.date || S.date < today) S.date = today; bd.value = S.date;
        drawSlots();
      });
    }

    async function drawSlots() {
      var c = S.court, step = c.slot_minutes, box = q("#slots", root);
      box.innerHTML = '<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">' + Array(6).fill('<div class="h-10 rounded-lg bg-surface-container-high/60 ds-skeleton"></div>').join('') + '</div>'; S.start = null; summary();
      var startM = toMin(hhmm(c.open_time)), endM = closeMin(c), slots = [];
      for (var m = startM; m + step <= endM; m += step) {
        var s = zonedToUtc(S.date + "T" + pad(Math.floor(m / 60)) + ":" + pad(m % 60), tz);
        slots.push({ s: s, e: new Date(s.getTime() + step * 60000) });
      }
      if (!slots.length) { box.innerHTML = '<p class="muted">No times.</p>'; return; }
      var av = await sb.rpc("court_availability", { p_court_id: c.id, p_from: slots[0].s.toISOString(), p_to: slots[slots.length - 1].e.toISOString() });
      var taken = (av.data || []).map(function (r) { return [new Date(r.starts_at), new Date(r.ends_at)]; });
      var now = Date.now();
      slots.forEach(function (x) {
        x.off = x.s.getTime() <= now || taken.some(function (t) { return t[0] < x.e && t[1] > x.s; });
      });
      S.slots = slots; paint();
    }

    function rangeOk(i) {
      if (i == null || i + S.count > S.slots.length) return false;
      for (var k = i; k < i + S.count; k++) if (S.slots[k].off) return false;
      return true;
    }
    function paint() {
      var box = q("#slots", root);
      box.innerHTML = S.slots.map(function (x, i) {
        var inRange = S.start != null && i >= S.start && i < S.start + S.count;
        return '<button type="button" class="slot' + (inRange ? (i === S.start ? " sel" : " in") : "") + '" data-i="' + i + '"' + (x.off ? " disabled" : "") + ">" + esc(timeOf(x.s, tz)) + "</button>";
      }).join("");
      Array.prototype.forEach.call(box.querySelectorAll(".slot"), function (b) {
        b.onclick = function () {
          var i = +b.getAttribute("data-i");
          S.start = i; paint(); summary();
          if (!rangeOk(i)) msg(q("#slotpanel", root), "Not enough free time from here for that length. Try a shorter length or another start.", "err");
          else msg(q("#slotpanel", root), "", "");
        };
      });
    }
    function summary() {
      var el = q("#sum", root), btn = q("#reserve", root);
      if (S.start == null || !rangeOk(S.start)) { el.innerHTML = ""; btn.disabled = true; return; }
      var first = S.slots[S.start], last = S.slots[S.start + S.count - 1], hrs = S.count * S.court.slot_minutes / 60;
      el.innerHTML = "<b>" + esc(range(first.s, last.e, tz)) + "</b> - " + hrs + " h - <b>" + money(S.court.hourly_rate * hrs) + "</b>";
      btn.disabled = false;
    }

    Array.prototype.forEach.call(root.querySelectorAll(".courtbtn"), function (b) { b.onclick = function () { pickCourt(b.getAttribute("data-c")); }; });
    q("#bd", root).onchange = function () { S.date = this.value; if (S.date) drawSlots(); };
    q("#bn", root).onchange = function () { S.count = +this.value; paint(); summary(); };
    q("#reserve", root).onclick = async function () {
      if (S.start == null || !rangeOk(S.start)) return;
      var btn = this, first = S.slots[S.start], last = S.slots[S.start + S.count - 1];
      var sig = S.court.id + "|" + first.s.toISOString() + "|" + last.e.toISOString();
      keys[sig] = keys[sig] || uuid();
      btn.disabled = true; msg(q("#slotpanel", root), "Reserving...", "");
      var r = await sb.rpc("create_booking", { p_court_id: S.court.id, p_starts_at: first.s.toISOString(),
        p_ends_at: last.e.toISOString(), p_idempotency_key: keys[sig] });
      if (r.error) {
        msg(q("#slotpanel", root), nice(r.error), "err");
        if (/slot_taken|slot_blocked/.test(r.error.message || "")) drawSlots(); else btn.disabled = false;
        return;
      }
      var b = r.data;
      q("#slotpanel", root).hidden = true;
      var pp = q("#paypanel", root); pp.hidden = false;
      pp.innerHTML = '<h2>3. ' + (b.status === "approved" ? "Booked" : "Pay and confirm") + '</h2><p><b>' + esc(S.court.name) + "</b> - " + esc(range(b.starts_at, b.ends_at, tz)) +
        '</p><div id="payhere"></div><p><a class="btn ghost" href="#/me">View my bookings</a></p>';
      payPanel(q("#payhere", pp), b, {});
    };
    if (courts.length === 1) pickCourt(courts[0].id);
  }

  // =========================================================== my bookings
  var STATUS_NOTE = {
    pending: "Waiting", approved: "Confirmed", rejected: "Rejected", cancelled: "Cancelled", expired: "Expired (not paid in time)"
  };
  async function myBookings(box) {
    var chan = null, poll = null;
    function stop() { if (chan) { sb.removeChannel(chan); chan = null; } if (poll) { clearInterval(poll); poll = null; } }
    async function load() {
      if (!alive(box)) { stop(); return; }
      if (!box.querySelector(".bcard")) {
        box.innerHTML = '<div class="space-y-4">' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
        '</div>';
      }
      var pl = (await sb.from("club_players").select("id").eq("user_id", D.state.user.id)).data || [];
      if (!pl.length) { box.innerHTML = D.ui.emptyState('No bookings yet', 'Your court reservations will appear here.', 'event_available', { href: '#/', label: 'Find a club' }); return; }
      var bs = (await sb.from("bookings").select("*").in("player_id", pl.map(function (p) { return p.id; })).order("starts_at", { ascending: false }).limit(60)).data || [];
      if (!bs.length) { box.innerHTML = D.ui.emptyState('No bookings yet', 'Your court reservations will appear here.', 'event_available', { href: '#/', label: 'Find a club' }); return; }
      var cIds = Array.from(new Set(bs.map(function (b) { return b.court_id; })));
      var courts = (await sb.from("public_courts").select("id,name,club_slug").in("id", cIds)).data || [];
      var slugs = Array.from(new Set(courts.map(function (c) { return c.club_slug; })));
      var clubs = slugs.length ? (await sb.from("public_clubs").select("slug,name,timezone").in("slug", slugs)).data || [] : [];
      var pays = (await sb.from("booking_payments").select("booking_id,payer_reference").in("booking_id", bs.map(function (b) { return b.id; }))).data || [];
      var cMap = {}, clMap = {}, pMap = {};
      courts.forEach(function (c) { cMap[c.id] = c; }); clubs.forEach(function (c) { clMap[c.slug] = c; }); pays.forEach(function (p) { pMap[p.booking_id] = p; });
      var now = Date.now();
      function card(b) {
        var c = cMap[b.court_id] || {}, cl = clMap[c.club_slug] || {}, tz = cl.timezone || "Asia/Manila", pay = pMap[b.id];
        var live = (b.status === "pending" || b.status === "approved") && new Date(b.ends_at).getTime() > now;
        var note = "";
        if (b.status === "pending" && pay) note = "Proof sent (ref " + esc(pay.payer_reference) + "). Waiting for the club to approve.";
        else if (b.status === "pending" && b.expires_at) note = 'Pay within <b class="timer" data-exp="' + esc(b.expires_at) + '"></b>';
        else if (b.status === "pending") note = "Waiting for the club to approve.";
        else if (b.status === "rejected") note = "Reason: " + esc(b.reject_reason || "not given");
        else if (b.status === "cancelled" && b.cancel_reason) note = "Reason: " + esc(b.cancel_reason);
        return '<div class="bcard" data-b="' + esc(b.id) + '"><div class="brow"><div><b>' + esc(cl.name || "Club") + "</b> - " + esc(c.name || "Court") +
          '<br><span class="small">' + esc(range(b.starts_at, b.ends_at, tz)) + '</span><br><span class="muted small">' + money(b.amount) + " - code " + esc(b.reference_code) +
          '</span></div><div class="bstat"><span class="badge ' + esc(b.status) + '">' + esc(STATUS_NOTE[b.status] || b.status) + "</span></div></div>" +
          (note ? '<p class="small bnote">' + note + "</p>" : "") +
          (live ? '<div class="bact">' + (b.status === "pending" && !pay && (!b.expires_at || new Date(b.expires_at) > now) && b.expires_at ? '<button class="btn sm" data-pay="' + esc(b.id) + '" type="button">Pay and upload proof</button> ' : "") +
            '<button class="btn sm danger" data-cancel="' + esc(b.id) + '" type="button">Cancel</button></div>' : "") +
          '<div class="payhere"></div><p class="msg" role="alert"></p></div>';
      }
      var upcoming = bs.filter(function (b) { return (b.status === "pending" || b.status === "approved") && new Date(b.ends_at).getTime() > now; })
        .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
      var past = bs.filter(function (b) { return upcoming.indexOf(b) === -1; });
      // keep open payment panels while refreshing
      var open = {}; Array.prototype.forEach.call(box.querySelectorAll(".bcard"), function (e) { if (q(".payhere form", e)) open[e.getAttribute("data-b")] = true; });
      if (Object.keys(open).length && box.__skipRefresh) return;
      box.innerHTML = (upcoming.length ? "<h3>Upcoming</h3>" + upcoming.map(card).join("") : '<p class="muted">No upcoming bookings.</p>') +
        (past.length ? "<h3>History</h3>" + past.map(card).join("") : "");
      startTicker();
      var byId = {}; bs.forEach(function (b) { byId[b.id] = b; });
      Array.prototype.forEach.call(box.querySelectorAll("[data-pay]"), function (btn) {
        btn.onclick = function () {
          var b = byId[btn.getAttribute("data-pay")], host = q(".payhere", btn.closest(".bcard"));
          box.__skipRefresh = true; payPanel(host, b, { onDone: function () { box.__skipRefresh = false; load(); } });
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll("[data-cancel]"), function (btn) {
        btn.onclick = async function () {
          if (!await D.ui.confirmAction("Cancel this booking? Your reserved time will be released.", { title: "Cancel booking", confirmText: "Cancel booking" })) return;
          btn.disabled = true;
          var r = await sb.rpc("cancel_booking", { p_booking_id: btn.getAttribute("data-cancel"), p_reason: null, p_idempotency_key: uuid() });
          if (r.error) { btn.disabled = false; return msg(btn.closest(".bcard"), nice(r.error), "err"); }
          box.__skipRefresh = false; load();
        };
      });
    }
    await load();
    chan = sb.channel("my-bookings-" + D.state.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, function () { load(); }).subscribe();
    poll = setInterval(load, 20000);
  }

  // ==================================================== club approval queue
  async function queue(box, t) {
    var tz = t.timezone || "Asia/Manila", chan = null, poll = null;
    function stop() { if (chan) { sb.removeChannel(chan); chan = null; } if (poll) { clearInterval(poll); poll = null; } }
    function modal(html) {
      var m = document.createElement("div"); m.className = "fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4";
      m.innerHTML = '<div class="bg-surface-container-low border border-outline-variant/40 rounded-DEFAULT p-space-lg max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-3 text-on-surface">' + html + '<div class="pt-2"><button class="px-4 py-2 rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-md border-0 cursor-pointer" type="button">Close</button></div></div>';
      m.onclick = function (e) { if (e.target === m || e.target.tagName === "BUTTON") m.remove(); };
      document.body.appendChild(m);
    }
    async function load() {
      if (!alive(box)) { stop(); return; }
      if (!box.querySelector(".bcard")) {
        box.innerHTML = '<div class="space-y-4">' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
        '</div>';
      }
      var bs = (await sb.from("bookings").select("*").eq("tenant_id", t.id).in("status", ["pending", "approved"])
        .gte("ends_at", new Date().toISOString()).order("starts_at")).data || [];
      var players = (await sb.from("club_players").select("id,display_name,phone").eq("tenant_id", t.id)).data || [];
      var courts = (await sb.from("courts").select("id,name").eq("tenant_id", t.id)).data || [];
      var pays = bs.length ? (await sb.from("booking_payments").select("*").eq("tenant_id", t.id).in("booking_id", bs.map(function (b) { return b.id; }))).data || [] : [];
      var pm = {}, cm = {}, pay = {};
      players.forEach(function (p) { pm[p.id] = p; }); courts.forEach(function (c) { cm[c.id] = c; }); pays.forEach(function (p) { pay[p.booking_id] = p; });
      var today = dayStr(tz);
      var pending = bs.filter(function (b) { return b.status === "pending"; });
      var approved = bs.filter(function (b) { return b.status === "approved"; });
      var todayList = approved.filter(function (b) { return new Date(b.starts_at).toLocaleDateString("en-CA", { timeZone: tz }) === today; });
      var later = approved.filter(function (b) { return todayList.indexOf(b) === -1; });
      function row(b, withDecide) {
        var p = pm[b.player_id] || {}, c = cm[b.court_id] || {}, py = pay[b.id];
        p = { display_name: p.display_name || b.guest_name, phone: p.phone || b.guest_phone };
        return '<div class="bcard bg-surface-container border border-outline-variant/30 rounded-DEFAULT p-space-md mb-space-sm flex flex-col gap-2" data-b="' + esc(b.id) + '">' +
          '<div class="flex items-start justify-between gap-4"><div><div class="font-title-md text-on-surface font-bold">' + esc(p.display_name || "Guest") + '</div>' + (p.phone ? ' <span class="font-mono text-xs text-on-surface-variant">' + esc(p.phone) + "</span>" : "") +
          '<div class="font-body-sm text-on-surface-variant mt-1"><span class="text-on-surface font-semibold">' + esc(c.name || "Court") + "</span> · " + esc(range(b.starts_at, b.ends_at, tz)) + '</div>' +
          '<div class="font-mono text-xs text-primary mt-1 font-bold">' + money(b.amount) + " · ref #" + esc(b.reference_code) + '</div></div>' +
          '<div>' + (!withDecide ? srcBadge(b) : py ? '<span class="px-2.5 py-1 rounded-full bg-secondary-container/30 border border-secondary/40 text-secondary font-mono text-xs font-semibold">Proof uploaded</span>' : '<span class="px-2.5 py-1 rounded-full bg-error-container/20 border border-error/30 text-error font-mono text-xs font-semibold">No proof</span>') + '</div></div>' +
          (py ? '<div class="flex items-center justify-between text-xs font-mono text-on-surface-variant bg-surface-container-high px-3 py-2 rounded"><span>Payer ref: <strong class="text-on-surface">' + esc(py.payer_reference) + '</strong>' + (py.method ? ' via ' + esc(py.method) : '') + '</span><button class="px-3 py-1 rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-sm border border-outline-variant/30 cursor-pointer" data-proof="' + esc(b.id) + '" type="button">View proof</button></div>'
              : (b.expires_at ? '<p class="text-xs text-on-surface-variant bg-surface-container-high px-3 py-2 rounded">Unpaid. Hold ends in <b class="timer text-primary font-mono" data-exp="' + esc(b.expires_at) + '"></b></p>' : "")) +
          '<div class="booking-card-actions">' + (!withDecide ? '<button type="button" class="ds-action ds-action-secondary" data-ticket="' + esc(b.id) + '"><span class="material-symbols-outlined" aria-hidden="true">qr_code_2</span>QR ticket</button>' : '') + (withDecide ? '<button class="px-3.5 py-1.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-sm font-bold border-0 cursor-pointer" data-ok="' + esc(b.id) + '" type="button">Approve</button> <button class="px-3.5 py-1.5 rounded-full bg-error-container/30 hover:bg-error-container/50 text-error font-label-sm border border-error/40 cursor-pointer" data-no="' + esc(b.id) + '" type="button">Reject</button>'
            : '<button class="px-3.5 py-1.5 rounded-full bg-error-container/30 hover:bg-error-container/50 text-error font-label-sm border border-error/40 cursor-pointer" data-cx="' + esc(b.id) + '" type="button">Cancel booking</button>') + '</div><p class="msg" role="alert"></p></div>';
      }
      box.innerHTML = '<div class="booking-queues">' + [
        { title: 'Needs approval', icon: 'pending_actions', items: pending, decide: true, empty: 'Nothing waiting in the queue.' },
        { title: "Today's confirmed bookings", icon: 'today', items: todayList, empty: 'No confirmed bookings today.' },
        { title: 'Upcoming confirmed bookings', icon: 'event_upcoming', items: later, empty: 'No other confirmed bookings.' }
      ].map(function (group) {
        return '<section class="booking-queue"><header class="booking-queue-heading"><span class="material-symbols-outlined" aria-hidden="true">' + group.icon + '</span><h3>' + group.title + '</h3><span class="booking-count' + (group.decide && group.items.length ? ' needs-attention' : '') + '">' + group.items.length + '</span></header>' +
          (group.items.length ? group.items.map(function (b) { return row(b, !!group.decide); }).join('') : D.ui.emptyState(group.decide ? 'No pending approvals' : 'No bookings scheduled', group.empty, group.icon)) + '</section>';
      }).join('') + '</div>';
      startTicker();
      var byId = {}; bs.forEach(function (b) { byId[b.id] = b; });
      box.querySelectorAll('[data-ticket]').forEach(function (button) {
        button.onclick = function () {
          var booking = byId[button.getAttribute('data-ticket')], player = pm[booking.player_id] || {}, court = cm[booking.court_id] || {};
          var ticket = document.createElement('dialog'); ticket.className = 'booking-ticket-modal';
          ticket.setAttribute('aria-label', 'Booking QR ticket');
          ticket.innerHTML = '<header><span class="ticket-caption">Booking ticket</span><h2></h2><p></p></header><div class="ticket-qr"></div><strong class="ticket-reference"></strong><p class="ticket-schedule"></p><p class="ticket-note">Scan to read the booking reference. This ticket does not confirm payment or check-in.</p><div class="ticket-actions"><button type="button" class="ds-action ds-action-secondary" data-download><span class="material-symbols-outlined" aria-hidden="true">download</span>Download QR</button><button type="button" class="ds-action ds-action-secondary" data-close><span class="material-symbols-outlined" aria-hidden="true">close</span>Close</button></div>';
          ticket.querySelector('h2').textContent = player.display_name || booking.guest_name || 'Guest';
          ticket.querySelector('header p').textContent = court.name || 'Court';
          ticket.querySelector('.ticket-reference').textContent = booking.reference_code;
          ticket.querySelector('.ticket-schedule').textContent = range(booking.starts_at, booking.ends_at, tz);
          var code = window.qrcode(0, 'M'); code.addData(booking.reference_code); code.make();
          var svg = code.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
          ticket.querySelector('.ticket-qr').innerHTML = svg;
          ticket.querySelector('[data-close]').onclick = function () { ticket.close(); };
          ticket.querySelector('[data-download]').onclick = function () {
            var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), link = document.createElement('a');
            link.href = url; link.download = 'booking-' + booking.reference_code + '.svg'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          };
          ticket.addEventListener('close', function () { ticket.remove(); if (button.isConnected) button.focus(); }, { once: true });
          document.body.appendChild(ticket); ticket.showModal();
        };
      });
      function card(el) { return el.closest(".bcard"); }
      async function decide(el, id, decision, reason) {
        el.disabled = true;
        var r = await sb.rpc("decide_booking", { p_booking_id: id, p_decision: decision, p_reason: reason, p_idempotency_key: uuid() });
        if (r.error) { el.disabled = false; msg(card(el), nice(r.error), "err"); if (/invalid_state/.test(r.error.message || "")) load(); return; }
        load();
      }
      Array.prototype.forEach.call(box.querySelectorAll("[data-ok]"), function (b) { b.onclick = async function () { if (await D.ui.confirmAction("Approve this booking and confirm the reserved court time?", { title: "Approve booking", confirmText: "Approve booking", danger: false })) decide(b, b.getAttribute("data-ok"), "approved", null); }; });
      Array.prototype.forEach.call(box.querySelectorAll("[data-no]"), function (b) {
        b.onclick = async function () {
          var confirmation = await D.ui.confirmAction("Reject this booking? The player will see your reason.", { title: "Reject booking", confirmText: "Reject booking", reason: true, requireReason: true });
          if (!confirmation) return;
          var why = confirmation.reason;
          if (!why.trim()) return msg(card(b), ERR.reason_required, "err");
          decide(b, b.getAttribute("data-no"), "rejected", why.trim());
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll("[data-cx]"), function (b) {
        b.onclick = async function () {
          var confirmation = await D.ui.confirmAction("Cancel this booking? The player will see your reason.", { title: "Cancel booking", confirmText: "Cancel booking", reason: true, requireReason: true });
          if (!confirmation) return;
          var why = confirmation.reason;
          if (!why.trim()) return msg(card(b), ERR.reason_required, "err");
          b.disabled = true;
          var r = await sb.rpc("cancel_booking", { p_booking_id: b.getAttribute("data-cx"), p_reason: why.trim(), p_idempotency_key: uuid() });
          if (r.error) { b.disabled = false; return msg(card(b), nice(r.error), "err"); }
          load();
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll("[data-proof]"), function (b) {
        b.onclick = async function () {
          var bk = byId[b.getAttribute("data-proof")], py = pay[bk.id], url = await signed(py.proof_path);
          modal('<h3>Payment proof</h3><p class="small">Amount due <b>' + money(bk.amount) + "</b> - payer ref <b>" + esc(py.payer_reference) + "</b> - code <b>" + esc(bk.reference_code) + "</b></p>" +
            (url ? '<img class="proofimg" src="' + esc(url) + '" alt="Payment proof">' : "<p>Could not load the image.</p>"));
        };
      });
    }
    await load();
    chan = sb.channel("queue-" + t.id).on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: "tenant_id=eq." + t.id }, function () { load(); }).subscribe();
    poll = setInterval(load, 20000);
  }


  // ============================================ club books for a customer
  // Owner or staff books a court for a walk-in guest (name only) or for a registered player.
  // The database (create_admin_booking) checks membership, opening hours, slot grid, blocks and overlaps.
  function srcBadge(b) {
    var label = b.source === "walk_in" ? "Walk-in guest" : b.source === "admin" ? "Booked by club" : "";
    return label ? '<span class="px-2.5 py-1 rounded-full bg-surface-container-highest text-on-surface-variant font-mono text-xs font-semibold">' + label + "</span>" : "";
  }

  async function adminNew(box, t) {
    var tz = t.timezone || "Asia/Manila", built = false;
    var deskResId = "RES-" + Math.floor(1000 + Math.random() * 9000);

    box.innerHTML =
      '<section class="booking-launch">' +
        '<div class="booking-launch-copy"><span class="booking-launch-icon material-symbols-outlined" aria-hidden="true">person_add</span><div>' +
          '<div class="booking-launch-title"><h2>Book for a customer</h2><span class="booking-launch-badge">Staff Desk</span></div>' +
          '<p>Reserve a court for a walk-in guest or registered player.</p>' +
        '</div></div>' +
        '<button id="nbtoggle" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="booking-modal" class="booking-launch-action"><span class="material-symbols-outlined" aria-hidden="true">add</span>New booking</button>' +

        '<dialog id="booking-modal" class="booking-modal relative w-full max-w-3xl bg-brand-surface border border-brand-border rounded-2xl shadow-modal backdrop-blur-xl overflow-hidden p-0 m-auto text-slate-100" aria-labelledby="booking-modal-title">' +
          '<!-- Top Accent Bar: Kinetic Sport Stripe -->' +
          '<div class="h-1 w-full bg-gradient-to-r from-brand-lime via-emerald-400 to-cyan-400"></div>' +
          '<!-- Modal Header -->' +
          '<header class="px-6 pt-6 pb-5 border-b border-brand-border/60 flex items-start justify-between gap-4 relative">' +
            '<div>' +
              '<div class="flex items-center gap-2.5 mb-1.5">' +
                '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-lime/10 text-brand-lime border border-brand-lime/25 uppercase tracking-wider font-display">' +
                  '<span class="w-1.5 h-1.5 rounded-full bg-brand-lime animate-pulse"></span>Staff Desk Mode' +
                '</span>' +
                '<span class="text-xs text-brand-subtle font-mono">ID: #' + deskResId + '</span>' +
              '</div>' +
              '<h2 id="booking-modal-title" class="text-2xl font-bold font-display tracking-tight text-white flex items-center gap-2">' +
                'Book for a customer' +
              '</h2>' +
              '<p class="text-sm text-slate-400 mt-0.5">Select customer profile, court asset, date and assign an open slot.</p>' +
            '</div>' +
            '<button aria-label="Close dialog" class="booking-modal-close text-slate-400 hover:text-white bg-brand-card hover:bg-brand-elevated border border-brand-border rounded-xl p-2.5 transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-lime cursor-pointer" type="button">' +
              '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</button>' +
          '</header>' +
          '<div id="nbform"></div>' +
        '</dialog>' +
      '</section>';

    var formBox = q("#nbform", box);
    var dialog = q("#booking-modal", box), toggle = q("#nbtoggle", box);
    q(".booking-modal-close", dialog).onclick = function () { dialog.close(); };
    dialog.addEventListener("close", function () { toggle.setAttribute("aria-expanded", "false"); toggle.focus(); });
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) return;
      var rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    toggle.onclick = function () {
      dialog.showModal();
      this.setAttribute("aria-expanded", "true");
      if (!built) { built = true; build(); }
    };

    if (location.hash.indexOf("new=1") !== -1 || location.hash.indexOf("quick") !== -1) {
      setTimeout(function () {
        if (toggle) toggle.click();
      }, 150);
    }

    async function build() {
      formBox.innerHTML = '<div class="p-8 text-center text-slate-400 font-mono text-xs flex items-center justify-center gap-2"><span class="w-2 h-2 rounded-full bg-brand-lime animate-ping"></span>Loading court availability...</div>';
      var courts = (await sb.from("courts").select("id,name,slot_minutes,open_time,close_time,hourly_rate,surface,is_indoor")
        .eq("tenant_id", t.id).eq("status", "active").order("name")).data || [];
      var players = (await sb.from("club_players").select("id,display_name,phone")
        .eq("tenant_id", t.id).eq("status", "active").order("display_name")).data || [];
      if (!courts.length) {
        formBox.innerHTML = '<div class="p-8 text-center text-slate-400 font-mono text-sm">No active courts configured. Please add a court first on the Courts tab.</div>';
        return;
      }
      var S = { court: courts[0], date: dayStr(tz), slots: [], start: null, count: 1, who: "guest" };
      var playerOpts = function () {
        return '<option value="">Choose a registered player...</option>' + players.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.display_name) + (p.phone ? " (" + esc(p.phone) + ")" : "") + '</option>';
        }).join('');
      };

      formBox.innerHTML =
        '<form id="nbf" novalidate><div class="booking-modal-body">' +
        '<!-- BEGIN: CustomerDetailsSection -->' +
        '<section class="border border-brand-border/80 bg-brand-card/50 rounded-xl p-5 relative" data-purpose="customer-selection-card">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<div class="flex items-center gap-2">' +
              '<div class="w-2 h-2 rounded-full bg-brand-lime"></div>' +
              '<h3 class="text-xs font-semibold font-display tracking-wider uppercase text-slate-300">Customer Details</h3>' +
            '</div>' +
            '<span class="text-[11px] text-brand-subtle font-medium font-mono">Step 1 of 3</span>' +
          '</div>' +

          '<!-- Segmented Toggle Pill -->' +
          '<div class="inline-flex p-1 bg-brand-dark/90 rounded-xl border border-brand-border mb-4 w-full sm:w-auto" role="tablist">' +
            '<button aria-selected="true" class="customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 bg-brand-elevated text-white shadow-sm border border-slate-700/60 cursor-pointer" id="tab-walkin" type="button" role="tab">' +
              '<svg class="w-3.5 h-3.5 text-brand-lime" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              'Walk-in guest' +
            '</button>' +
            '<button aria-selected="false" class="customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 text-slate-400 hover:text-slate-200 border border-transparent bg-transparent cursor-pointer" id="tab-registered" type="button" role="tab">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              'Registered player' +
            '</button>' +
          '</div>' +

          '<!-- Mode A: Walk-in Inputs View -->' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4" id="view-walkin">' +
            '<div>' +
              '<label class="block text-xs font-medium text-slate-300 mb-1.5" for="gname">Guest Name <span class="text-brand-lime">*</span></label>' +
              '<div class="relative">' +
                '<input class="w-full bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime transition" id="gname" placeholder="e.g. Jason Brooks" required type="text" autocomplete="off"/>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-medium text-slate-300 mb-1.5 flex justify-between" for="gphone">' +
                '<span>Phone</span>' +
                '<span class="text-brand-subtle text-[11px]">Optional for SMS receipts</span>' +
              '</label>' +
              '<div class="relative">' +
                '<input class="w-full bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime transition" id="gphone" placeholder="+63 917 123 4567" type="tel" autocomplete="off"/>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<!-- Mode B: Registered Player View -->' +
          '<div class="hidden space-y-3" id="view-registered">' +
            '<div>' +
              '<label class="block text-xs font-medium text-slate-300 mb-1.5" for="pplayer">Search Player Directory <span class="text-brand-lime">*</span></label>' +
              '<div class="relative">' +
                '<select id="pplayer" class="w-full appearance-none bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime cursor-pointer pr-9">' +
                  playerOpts() +
                '</select>' +
                '<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div id="player-preview" class="hidden w-full bg-brand-surface border border-brand-border rounded-xl p-2.5 flex items-center justify-between">' +
              '<div class="flex items-center gap-2.5">' +
                '<div class="w-7 h-7 rounded-full bg-gradient-to-tr from-brand-lime to-emerald-400 flex items-center justify-center text-xs font-bold text-black font-display" id="player-avatar-init">PL</div>' +
                '<div class="text-left">' +
                  '<p class="text-xs font-semibold text-white leading-tight" id="player-preview-name">Player Name</p>' +
                  '<p class="text-[11px] text-slate-400" id="player-preview-sub">Contact</p>' +
                '</div>' +
              '</div>' +
              '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-lime/10 text-brand-lime border border-brand-lime/30 font-mono">DUPR Ready</span>' +
            '</div>' +
            '<div class="pt-2 border-t border-brand-border/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">' +
              '<input id="pemail" class="flex-1 bg-brand-dark/70 border border-brand-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-lime" placeholder="Or invite new player by email..." type="email"/>' +
              '<button id="padd" class="px-3.5 py-1.5 rounded-lg text-xs font-medium font-display bg-brand-elevated hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer" type="button">Add Player</button>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- BEGIN: BookingDetailsSection -->' +
        '<section class="border border-brand-border/80 bg-brand-card/50 rounded-xl p-5" data-purpose="booking-parameters">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<div class="flex items-center gap-2">' +
              '<div class="w-2 h-2 rounded-full bg-cyan-400"></div>' +
              '<h3 class="text-xs font-semibold font-display tracking-wider uppercase text-slate-300">Booking Details</h3>' +
            '</div>' +
            '<span class="text-[11px] text-brand-subtle font-medium font-mono">Step 2 of 3</span>' +
          '</div>' +
          '<div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">' +
            '<div>' +
              '<label class="booking-court-label" for="ncourt">Court</label>' +
              '<div class="relative">' +
                '<select id="ncourt" class="w-full appearance-none bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime cursor-pointer pr-9">' +
                  courts.map(function (c) {
                    return '<option value="' + esc(c.id) + '">' + esc(c.name) + ' (' + (c.surface || 'Acrylic') + ' • ' + (c.is_indoor ? 'Indoor' : 'Outdoor') + ')</option>';
                  }).join('') +
                '</select>' +
                '<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-medium text-slate-300 mb-1.5 flex justify-between" for="ndate">' +
                '<span>Date</span>' +
              '</label>' +
              '<div class="relative">' +
                '<input id="ndate" class="w-full bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime cursor-pointer [color-scheme:dark]" type="date" value="' + S.date + '"/>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-medium text-slate-300 mb-1.5 flex justify-between" for="nlen">' +
                '<span>Length</span>' +
                '<span id="rate-badge" class="text-[11px] text-slate-400 font-mono">' + money(S.court.hourly_rate) + '/hr</span>' +
              '</label>' +
              '<div class="relative">' +
                '<select id="nlen" class="w-full appearance-none bg-brand-surface border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-lime focus:border-brand-lime cursor-pointer pr-9"></select>' +
                '<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- BEGIN: StartTimeSection -->' +
        '<section class="border border-brand-border/80 bg-brand-card/50 rounded-xl p-5" data-purpose="time-slot-matrix">' +
          '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">' +
            '<div>' +
              '<div class="flex items-center gap-2">' +
                '<div class="w-2 h-2 rounded-full bg-purple-400"></div>' +
                '<h3 class="text-xs font-semibold font-display tracking-wider uppercase text-slate-300">Start Time</h3>' +
              '</div>' +
              '<p id="slot-subtitle" class="text-xs text-brand-subtle mt-0.5">' + esc(S.court.name) + ' schedule</p>' +
            '</div>' +
            '<div class="flex items-center gap-3 text-[11px]">' +
              '<div class="flex items-center gap-1.5">' +
                '<span class="w-2.5 h-2.5 rounded-sm bg-brand-card border border-brand-border"></span>' +
                '<span class="text-slate-400">Open</span>' +
              '</div>' +
              '<div class="flex items-center gap-1.5">' +
                '<span class="w-2.5 h-2.5 rounded-sm bg-brand-lime"></span>' +
                '<span class="text-brand-lime font-medium">Selected</span>' +
              '</div>' +
              '<div class="flex items-center gap-1.5">' +
                '<span class="w-2.5 h-2.5 rounded-sm bg-brand-surface/40 border border-brand-border/40 opacity-40 line-through"></span>' +
                '<span class="text-slate-500">Booked</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="nslots" class="space-y-3.5"></div>' +
        '</section>' +

        '<!-- BEGIN: PaymentOptionToggle -->' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1" data-purpose="payment-mode-selector">' +
          '<label class="text-xs font-medium text-slate-300 flex items-center gap-2">' +
            '<span>Billing Collection Method:</span>' +
          '</label>' +
          '<div class="flex items-center gap-1.5 bg-brand-dark/90 p-1 rounded-xl border border-brand-border text-xs">' +
            '<label class="cursor-pointer">' +
              '<input checked class="sr-only peer" name="payment_pref" type="radio" value="desk"/>' +
              '<span class="block px-3 py-1.5 rounded-lg text-slate-400 peer-checked:bg-brand-elevated peer-checked:text-white font-medium transition text-center">' +
                'Collect at desk' +
              '</span>' +
            '</label>' +
            '<label class="cursor-pointer">' +
              '<input class="sr-only peer" name="payment_pref" type="radio" value="charge"/>' +
              '<span class="block px-3 py-1.5 rounded-lg text-slate-400 peer-checked:bg-brand-elevated peer-checked:text-white font-medium transition text-center">' +
                'Card on file' +
              '</span>' +
            '</label>' +
            '<label class="cursor-pointer">' +
              '<input class="sr-only peer" name="payment_pref" type="radio" value="hold"/>' +
              '<span class="block px-3 py-1.5 rounded-lg text-slate-400 peer-checked:bg-brand-elevated peer-checked:text-white font-medium transition text-center">' +
                'Hold unpaid' +
              '</span>' +
            '</label>' +
          '</div>' +
        '</div>' +

        '<p class="msg text-xs" role="alert"></p>' +

        '</div>' +
        '<!-- BEGIN: ModalFooterActionSummary -->' +
        '<footer class="pt-5 border-t border-brand-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-purpose="bottom-bar">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 rounded-xl bg-brand-lime/10 border border-brand-lime/25 flex items-center justify-center text-brand-lime shrink-0">' +
              '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div id="nsum" aria-live="polite">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-base font-bold font-display text-white tracking-tight" id="sum-price">' + money(0) + '</span>' +
                '<span class="text-[11px] font-mono px-1.5 py-0.5 rounded bg-brand-elevated text-slate-300 border border-brand-border">Total</span>' +
              '</div>' +
              '<p class="text-xs text-brand-subtle" id="sum-desc">Select court and open slot</p>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center justify-end gap-3 w-full sm:w-auto">' +
            '<button id="cancel-booking-btn" class="w-1/2 sm:w-auto px-5 py-2.5 rounded-xl text-xs font-semibold font-display text-slate-300 hover:text-white hover:bg-brand-elevated border border-transparent hover:border-brand-border transition duration-150 text-center cursor-pointer" type="button">' +
              'Cancel' +
            '</button>' +
            '<button id="nreserve" class="w-1/2 sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold font-display tracking-wide bg-brand-lime hover:bg-brand-limeHover text-black shadow-neon-lime transition duration-200 ease-in-out flex items-center justify-center gap-2 group active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" type="submit" disabled>' +
              '<svg class="w-4 h-4 stroke-[2.5] text-black transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
              '<span>Confirm booking</span>' +
            '</button>' +
          '</div>' +
        '</footer>' +
        '</form>';

      var f = q("#nbf", formBox);

      function switchTab(who) {
        S.who = who;
        var tabWalkin = q("#tab-walkin", f), tabRegistered = q("#tab-registered", f);
        var viewWalkin = q("#view-walkin", f), viewRegistered = q("#view-registered", f);
        if (who === "guest") {
          viewWalkin.classList.remove("hidden");
          viewRegistered.classList.add("hidden");
          tabWalkin.className = "customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 bg-brand-elevated text-white shadow-sm border border-slate-700/60 cursor-pointer";
          tabWalkin.setAttribute("aria-selected", "true");
          tabRegistered.className = "customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 text-slate-400 hover:text-slate-200 border border-transparent bg-transparent cursor-pointer";
          tabRegistered.setAttribute("aria-selected", "false");
        } else {
          viewWalkin.classList.add("hidden");
          viewRegistered.classList.remove("hidden");
          tabRegistered.className = "customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 bg-brand-elevated text-white shadow-sm border border-slate-700/60 cursor-pointer";
          tabRegistered.setAttribute("aria-selected", "true");
          tabWalkin.className = "customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 text-slate-400 hover:text-slate-200 border border-transparent bg-transparent cursor-pointer";
          tabWalkin.setAttribute("aria-selected", "false");
        }
        msg(f, "", "");
      }
      q("#tab-walkin", f).onclick = function () { switchTab("guest"); };
      q("#tab-registered", f).onclick = function () { switchTab("player"); };

      var pSelect = q("#pplayer", f);
      var pPrev = q("#player-preview", f);
      pSelect.onchange = function () {
        var pid = this.value;
        var pObj = players.filter(function (x) { return x.id === pid; })[0];
        if (pObj && pPrev) {
          pPrev.classList.remove("hidden");
          q("#player-avatar-init", pPrev).textContent = (pObj.display_name || "PL").slice(0, 2).toUpperCase();
          q("#player-preview-name", pPrev).textContent = pObj.display_name || "Registered Player";
          q("#player-preview-sub", pPrev).textContent = pObj.phone || "Member ID: #" + pObj.id.slice(0, 8);
        } else if (pPrev) {
          pPrev.classList.add("hidden");
        }
      };

      function lengths() {
        var step = S.court.slot_minutes, opts = "";
        for (var n = 1; n <= 8; n++) {
          var hrs = (n * step) / 60;
          var label = hrs + (hrs === 1 ? " hour" : " hours");
          if (n === 1) label += " (Standard match)";
          else if (n === 2) label += " (Full session)";
          else if (n === 3) label += " (Tournament slot)";
          opts += '<option value="' + n + '"' + (n === S.count ? " selected" : "") + ">" + label + "</option>";
        }
        q("#nlen", f).innerHTML = opts;
        var rateBadge = q("#rate-badge", f);
        if (rateBadge) rateBadge.textContent = money(S.court.hourly_rate) + "/hr";
      }

      function rangeOk(i) {
        if (i == null || i + S.count > S.slots.length) return false;
        for (var k = i; k < i + S.count; k++) if (S.slots[k].off) return false;
        return true;
      }

      function summary() {
        var priceEl = q("#sum-price", f), descEl = q("#sum-desc", f), btn = q("#nreserve", f);
        if (S.start == null || !rangeOk(S.start)) {
          if (priceEl) priceEl.textContent = money(0);
          if (descEl) descEl.textContent = "Select court and open slot";
          if (btn) btn.disabled = true;
          return;
        }
        var a = S.slots[S.start], z = S.slots[S.start + S.count - 1], hrs = (S.count * S.court.slot_minutes) / 60;
        var total = S.court.hourly_rate * hrs;
        if (priceEl) priceEl.textContent = money(total);
        if (descEl) descEl.textContent = S.court.name + " • " + range(a.s, z.e, tz) + " (" + hrs + " hr" + (hrs > 1 ? "s" : "") + ")";
        if (btn) btn.disabled = false;
      }

      function paint() {
        var grid = q("#nslots", f);
        var morning = [], afternoon = [], evening = [];
        S.slots.forEach(function (x, i) {
          var hr = parseInt(new Date(x.s).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", hour12: false }), 10);
          var item = { x: x, i: i };
          if (hr < 12) morning.push(item);
          else if (hr < 17) afternoon.push(item);
          else evening.push(item);
        });

        function renderGroup(title, items, isPrime) {
          if (!items.length) return "";
          return '<div>' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">' +
              '<span class="' + (isPrime ? 'text-brand-lime font-bold' : '') + '">' + title + '</span>' +
              '<div class="h-px flex-1 bg-brand-border/40"></div>' +
            '</div>' +
            '<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">' +
              items.map(function (item) {
                var x = item.x, i = item.i;
                var inRange = S.start != null && i >= S.start && i < S.start + S.count;
                var isFirst = S.start != null && i === S.start;
                var timeLabel = esc(timeOf(x.s, tz));
                if (x.off) {
                  return '<button type="button" class="py-2.5 px-2 rounded-lg text-xs font-mono font-medium bg-brand-surface/40 text-slate-600 border border-brand-border/30 cursor-not-allowed text-center line-through" disabled>' + timeLabel + '</button>';
                }
                if (inRange) {
                  return '<button type="button" class="slot-btn relative py-2.5 px-2 rounded-lg text-xs font-mono font-bold bg-brand-lime text-black border border-brand-lime shadow-neon-lime-sm flex items-center justify-center gap-1 ring-2 ring-brand-lime ring-offset-2 ring-offset-brand-surface cursor-pointer" data-i="' + i + '">' +
                    '<span>' + timeLabel + '</span>' +
                    (isFirst ? '<svg class="w-3.5 h-3.5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>' : '') +
                  '</button>';
                }
                return '<button type="button" class="slot-btn py-2.5 px-2 rounded-lg text-xs font-mono font-medium bg-brand-elevated hover:bg-slate-700/80 text-white border border-brand-border hover:border-brand-lime/40 text-center transition cursor-pointer" data-i="' + i + '">' + timeLabel + '</button>';
              }).join('') +
            '</div>' +
          '</div>';
        }

        grid.innerHTML = renderGroup("Morning", morning, false) +
                         renderGroup("Afternoon", afternoon, false) +
                         renderGroup("Evening (Prime Time)", evening, true);

        Array.prototype.forEach.call(grid.querySelectorAll(".slot-btn"), function (b) {
          b.onclick = function () {
            S.start = +b.getAttribute("data-i");
            paint();
            summary();
            msg(f, rangeOk(S.start) ? "" : "Not enough free time from here for that length. Try a shorter length or another start.", rangeOk(S.start) ? "" : "err");
          };
        });
      }

      async function draw() {
        var c = S.court, step = c.slot_minutes, grid = q("#nslots", f);
        var sub = q("#slot-subtitle", f);
        if (sub) {
          var dObj = new Date(S.date + "T00:00:00");
          var dFormatted = isNaN(dObj.getTime()) ? S.date : dObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          sub.textContent = c.name + " schedule • " + dFormatted;
        }
        grid.innerHTML = '<div class="py-6 text-center text-slate-400 font-mono text-xs flex items-center justify-center gap-2"><span class="w-2 h-2 rounded-full bg-brand-lime animate-ping"></span>Refreshing available slots...</div>';
        S.start = null;
        summary();
        var a = toMin(hhmm(c.open_time)), z = closeMin(c), slots = [];
        for (var m = a; m + step <= z; m += step) {
          var s0 = zonedToUtc(S.date + "T" + pad(Math.floor(m / 60)) + ":" + pad(m % 60), tz);
          slots.push({ s: s0, e: new Date(s0.getTime() + step * 60000) });
        }
        if (!slots.length) {
          grid.innerHTML = '<p class="text-xs text-slate-500 font-mono py-4 text-center">No schedule slots configured for this court on this date.</p>';
          return;
        }
        var av = await sb.rpc("court_availability", { p_court_id: c.id, p_from: slots[0].s.toISOString(), p_to: slots[slots.length - 1].e.toISOString() });
        var taken = (av.data || []).map(function (r) { return [new Date(r.starts_at), new Date(r.ends_at)]; }), now = Date.now();
        slots.forEach(function (x) { x.off = x.e.getTime() <= now || taken.some(function (k) { return k[0] < x.e && k[1] > x.s; }); });
        S.slots = slots;
        paint();
      }

      q("#ndate", f).value = S.date;
      q("#ndate", f).min = S.date;
      lengths();

      var cancelBtn = q("#cancel-booking-btn", f);
      if (cancelBtn) cancelBtn.onclick = function () { dialog.close(); };

      q("#ncourt", f).onchange = function () {
        S.court = courts.filter(function (c) { return c.id === this.value; }, this)[0] || courts[0];
        lengths();
        draw();
      };
      q("#ndate", f).onchange = function () {
        if (this.value) { S.date = this.value; draw(); }
      };
      D.ui.dateTimePickers(f, tz);
      q("#nlen", f).onchange = function () {
        S.count = +this.value;
        paint();
        summary();
      };
      q("#padd", f).onclick = async function () {
        var email = q("#pemail", f).value.trim();
        if (!email) return msg(f, "Enter the player's email.", "err");
        var r = await sb.rpc("admin_add_player", { p_tenant_id: t.id, p_email: email });
        if (r.error) return msg(f, nice(r.error), "err");
        if (!players.some(function (p) { return p.id === r.data.id; })) players.push({ id: r.data.id, display_name: r.data.display_name, phone: r.data.phone });
        q("#pplayer", f).innerHTML = playerOpts();
        q("#pplayer", f).value = r.data.id;
        q("#pplayer", f).dispatchEvent(new Event("change"));
        q("#pemail", f).value = "";
        msg(f, r.data.display_name + " was added to your registered players.", "ok");
      };

      f.onsubmit = async function (e) {
        e.preventDefault();
        if (S.start == null || !rangeOk(S.start)) return;
        var guest = q("#gname", f).value.trim(), pid = q("#pplayer", f).value;
        if (S.who === "guest" && !guest) return msg(f, "Enter the guest's name.", "err");
        if (S.who === "player" && !pid) return msg(f, "Choose a registered player from the directory.", "err");
        var a = S.slots[S.start], z = S.slots[S.start + S.count - 1], btn = q("#nreserve", f);
        var sig = "admin|" + S.court.id + "|" + a.s.toISOString() + "|" + z.e.toISOString() + "|" + (S.who === "guest" ? guest : pid);
        keys[sig] = keys[sig] || uuid();
        btn.disabled = true;
        msg(f, "Confirming reservation on court...", "");
        var r = await sb.rpc("create_admin_booking", {
          p_court_id: S.court.id,
          p_starts_at: a.s.toISOString(),
          p_ends_at: z.e.toISOString(),
          p_idempotency_key: keys[sig],
          p_player_id: S.who === "player" ? pid : null,
          p_guest_name: S.who === "guest" ? guest : null,
          p_guest_phone: S.who === "guest" ? (q("#gphone", f).value.trim() || null) : null
        });
        if (r.error) {
          msg(f, nice(r.error), "err");
          if (/slot_taken|slot_blocked/.test(r.error.message || "")) draw();
          else btn.disabled = false;
          return;
        }
        msg(f, "Successfully booked " + (S.who === "guest" ? guest : "player") + ": " + range(r.data.starts_at, r.data.ends_at, tz) + " (Ref #" + r.data.reference_code + ").", "ok");
        if (q("#gname", f)) q("#gname", f).value = "";
        if (q("#gphone", f)) q("#gphone", f).value = "";
        draw();
        setTimeout(function () {
          dialog.close();
        }, 1200);
      };

      draw();
    }
  }

    D.booking = { renderBook: renderBook, myBookings: myBookings, queue: queue, adminNew: adminNew };
})();
