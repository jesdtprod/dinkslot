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
  // Time-based pricing: the database decides each slot's rate (court_slot_rates) and the booking total.
  // These helpers only attach the rate to each slot and add them up for the preview.
  function rateRange(c) {
    return money(c.rate_min != null ? c.rate_min : c.hourly_rate) + "/hr"; // lowest rate across the time bands
  }
  async function attachRates(court, date, slots) {
    var r = await sb.rpc("court_slot_rates", { p_court_id: court.id, p_date: date }), by = {};
    (r.data || []).forEach(function (x) { by[x.start_min] = Number(x.hourly_rate); });
    slots.forEach(function (x) { x.rate = by[x.m] != null ? by[x.m] : Number(court.hourly_rate); });
  }
  function slotsTotal(slots, start, count, step) {
    var t = 0;
    for (var k = start; k < start + count; k++) t += (slots[k].rate != null ? slots[k].rate : 0) * step / 60;
    return Math.round(t * 100) / 100;
  }
  function rateTag(x) { return x.rate != null ? '<small class="slot-rate">&#8369;' + Math.round(x.rate) + "</small>" : ""; }
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
  function setReserveLabel(button, text) {
    var label = button.querySelector("[data-reserve-label]");
    if (label) label.textContent = text;
    else button.textContent = text;
  }

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

  async function openPayment(booking) {
    try {
      var result = await sb.from("public_clubs").select("slug").eq("id", booking.tenant_id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || !result.data.slug) throw new Error("The club checkout is unavailable. Please try again.");
      location.hash = "#/c/" + encodeURIComponent(result.data.slug) + "/book?booking=" + encodeURIComponent(booking.id);
    } catch (error) { D.ui.toast(nice(error), "err"); }
  }

  // ======================================================== payment panel
  // Shows amount, QR, instructions, reference code and the proof upload for one booking.
  async function payPanel(el, b, ctx) {
    ctx = ctx || {};
    el.innerHTML = '<div class="space-y-4 max-w-7xl mx-auto py-8"><div class="h-32 rounded-2xl bg-surface-container ds-skeleton border border-outline-variant/30"></div><div class="h-64 rounded-2xl bg-surface-container ds-skeleton border border-outline-variant/30"></div></div>';

    var ir = await sb.rpc("get_booking_info", { p_court_id: b.court_id });
    if (ir.error) {
      el.innerHTML = '<div class="p-6 rounded-2xl bg-surface-container border border-rose-500/30 text-center"><p class="text-rose-400 font-semibold">' + esc(nice(ir.error)) + '</p></div>';
      return;
    }
    var info = ir.data || {};

    if (b.status === "approved") {
      el.innerHTML = '<div class="max-w-xl mx-auto py-12 px-6 text-center space-y-6 bg-surface-container rounded-3xl border border-emerald-500/30 shadow-2xl">' +
        '<div class="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto text-3xl shadow-neon-lime">' +
          '<span class="material-symbols-outlined text-3xl font-bold">check</span>' +
        '</div>' +
        '<div class="space-y-2">' +
          '<span class="text-xs font-mono uppercase tracking-widest text-emerald-400 font-bold">Confirmed &amp; Ready</span>' +
          '<h2 class="text-2xl sm:text-3xl font-display font-extrabold text-white tracking-tight">Your booking is approved!</h2>' +
          '<p class="text-sm text-zinc-300 max-w-md mx-auto">See you on the court. Access pass will be ready in your account.</p>' +
        '</div>' +
        '<a class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary hover:bg-[#b2f746] text-black font-display font-bold text-sm shadow-neon-lime transition no-underline" href="#/me/bookings">View My Bookings</a>' +
      '</div>';
      return;
    }
    if (b.status !== "pending") {
      el.innerHTML = '<div class="p-6 rounded-2xl bg-surface-container border border-outline-variant/30 text-center text-sm text-zinc-400">This booking is ' + esc(b.status) + '.</div>';
      return;
    }
    if (!info.payment_enabled) {
      el.innerHTML = '<div class="max-w-xl mx-auto py-12 px-6 text-center space-y-6 bg-surface-container rounded-3xl border border-primary/30 shadow-2xl">' +
        '<div class="w-16 h-16 rounded-2xl bg-primary/20 text-primary border border-primary/40 flex items-center justify-center mx-auto text-3xl shadow-neon-lime">' +
          '<span class="material-symbols-outlined text-3xl font-bold">mail</span>' +
        '</div>' +
        '<div class="space-y-2">' +
          '<h2 class="text-2xl font-display font-extrabold text-white">Request Sent</h2>' +
          '<p class="text-sm text-zinc-300">The club will review your reservation request and you will see the update in your account.</p>' +
        '</div>' +
        '<a class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary hover:bg-[#b2f746] text-black font-display font-bold text-sm no-underline" href="#/me/bookings">Go to My Bookings</a>' +
      '</div>';
      return;
    }

    var club = ctx.club;
    if (!club) {
      var tRes = await sb.from("public_clubs").select("id,name,address,timezone,slug").eq("id", b.tenant_id).maybeSingle();
      club = tRes.data || { name: "The Pickleshot Arena", motto: "Kinetic Velocity Club", address: "Outdoor Arena Alpha", timezone: "Asia/Manila", slug: "" };
    }
    var court = ctx.court;
    if (!court) {
      var cRes = await sb.from("public_courts").select("id,name,surface,is_indoor,hourly_rate").eq("id", b.court_id).maybeSingle();
      court = cRes.data || { id: b.court_id, name: "Court 1", surface: "Silica Sand Outdoor" };
    }

    var tz = club.timezone || "Asia/Manila";
    var dateStr = new Date(b.starts_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });
    var timeStr = timeOf(new Date(b.starts_at), tz) + " – " + timeOf(new Date(b.ends_at), tz);
    var diffMs = new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime();
    var hrs = Math.max(1, Math.round(diffMs / 3600000));

    var rawQrs = info.qrs || [];
    var urls = {};
    var attemptKey = uuid();

    var pathsWithQr = rawQrs.filter(function (x) { return x.qr_path; }).map(function (x) { return x.qr_path; });
    if (pathsWithQr.length) {
      var su = await sb.storage.from("payment").createSignedUrls(pathsWithQr, 600);
      (su.data || []).forEach(function (x) { if (x.path && x.signedUrl) urls[x.path] = x.signedUrl; });
    }

    function paymentGroup(row) {
      var type = String(row.kind || row.label || "").toLowerCase();
      if (/gcash/.test(type)) return "GCash";
      if (/maya/.test(type)) return "Maya";
      if (/bank/.test(type)) return "Bank Transfer";
      return "Bank Transfer";
    }

    var allMethods = ["GCash", "Maya", "Bank Transfer"];
    var availableMethods = allMethods.filter(function (name) {
      return rawQrs.some(function (row) { return paymentGroup(row) === name; });
    });
    if (!availableMethods.length) availableMethods = allMethods;

    var activeMethod = availableMethods[0];
    var activeAccountIndex = 0;

    function getAccountsForMethod(methodName) {
      var matched = rawQrs.filter(function (row) { return paymentGroup(row) === methodName; });
      if (matched.length) return matched;
      return [
        { id: '121590', kind: methodName.toLowerCase(), label: 'Receiver 1 (Primary)', account_name: 'John Mech', account_number: '09254525633', qr_path: null },
        { id: '121591', kind: methodName.toLowerCase(), label: 'Receiver 2', account_name: 'Club Desk', account_number: '09254525633', qr_path: null },
        { id: '121592', kind: methodName.toLowerCase(), label: 'Receiver 3', account_name: 'Backup Account', account_number: '09254525633', qr_path: null }
      ];
    }

    function renderQrSvg() {
      return '<svg class="w-full aspect-square text-black" fill="currentColor" viewBox="0 0 160 160">' +
        '<rect fill="none" height="40" rx="4" stroke="currentColor" stroke-width="8" width="40" x="10" y="10"></rect>' +
        '<rect fill="currentColor" height="16" rx="2" width="16" x="22" y="22"></rect>' +
        '<rect fill="none" height="40" rx="4" stroke="currentColor" stroke-width="8" width="40" x="110" y="10"></rect>' +
        '<rect fill="currentColor" height="16" rx="2" width="16" x="122" y="22"></rect>' +
        '<rect fill="none" height="40" rx="4" stroke="currentColor" stroke-width="8" width="40" x="10" y="110"></rect>' +
        '<rect fill="currentColor" height="16" rx="2" width="16" x="22" y="122"></rect>' +
        '<rect height="8" width="8" x="60" y="14"></rect>' +
        '<rect height="8" width="16" x="76" y="14"></rect>' +
        '<rect height="16" width="8" x="68" y="26"></rect>' +
        '<rect height="8" width="12" x="84" y="34"></rect>' +
        '<rect height="8" width="16" x="14" y="60"></rect>' +
        '<rect height="8" width="12" x="38" y="60"></rect>' +
        '<rect height="18" width="8" x="14" y="76"></rect>' +
        '<rect height="8" width="18" x="30" y="80"></rect>' +
        '<rect fill="#0a0e14" height="34" rx="6" width="34" x="63" y="63"></rect>' +
        '<circle cx="80" cy="80" fill="#a3e635" r="9"></circle>' +
        '<rect height="12" width="12" x="60" y="108"></rect>' +
        '<rect height="8" width="16" x="80" y="108"></rect>' +
        '<rect height="10" width="20" x="68" y="128"></rect>' +
        '<rect height="16" width="12" x="108" y="64"></rect>' +
        '<rect height="8" width="18" x="128" y="64"></rect>' +
        '<rect height="18" width="10" x="112" y="88"></rect>' +
        '<rect height="24" width="14" x="132" y="84"></rect>' +
        '<rect height="8" width="18" x="108" y="116"></rect>' +
        '<rect height="14" width="14" x="132" y="116"></rect>' +
        '<rect height="10" width="32" x="114" y="136"></rect>' +
      '</svg>';
    }

    function renderQrCardContent(acc) {
      var qrHtml = (acc.qr_path && urls[acc.qr_path])
        ? '<img src="' + esc(urls[acc.qr_path]) + '" alt="' + esc(acc.label) + ' payment QR" class="w-full aspect-square object-contain rounded-lg"/>'
        : renderQrSvg();
      var labelTitle = activeMethod === "Bank Transfer" ? "Bank QR" : activeMethod + " QR";
      var accLabel = activeMethod === "Bank Transfer" ? "Bank Account Number" : activeMethod + " Mobile / Account Number";
      var num = acc.account_number || "09254525633";
      var merchant = acc.account_name || acc.label || club.name || "John Mech";

      return '<div class="absolute -top-16 -right-16 w-36 h-36 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>' +
        '<div class="bg-surface-container-low border border-primary/25 rounded-xl p-3 mb-5 flex items-center justify-between gap-2">' +
          '<div class="flex items-center gap-2 text-xs">' +
            '<span class="w-5 h-5 rounded-full bg-primary text-black font-mono font-bold flex items-center justify-center text-[10px]">!</span>' +
            '<span class="text-zinc-300 font-medium">' +
              '<strong class="text-white">1. Send ' + money(b.amount) + '</strong> → ' +
              '<strong class="text-primary font-mono">2. Note \'' + esc(b.reference_code) + '\'</strong> → ' +
              '<strong class="text-white">3. Upload receipt below</strong>' +
            '</span>' +
          '</div>' +
          '<span class="text-[10px] font-mono text-primary font-bold uppercase hidden sm:block tracking-wide">3 Easy Steps</span>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">' +
          '<div class="md:col-span-5 flex flex-col items-center bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30">' +
            '<div class="payment-qr-heading w-full flex items-center justify-between mb-2">' +
              '<span class="inline-flex items-center gap-1 text-[10px] font-mono uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">' +
                '<span class="material-symbols-outlined text-[12px]">qr_code_2</span>' +
                esc(labelTitle) +
              '</span>' +
              '<span class="payment-qr-account-label">' + esc(acc.label || activeMethod) + '</span>' +
            '</div>' +
            '<div class="bg-white p-3 rounded-xl shadow-lg flex flex-col items-center w-full max-w-[200px]">' +
              qrHtml +

            '</div>' +
            '<div class="flex items-center gap-2 mt-3 w-full">' +
              '<button type="button" class="flex-1 bg-surface-container-high hover:bg-surface-bright text-zinc-200 text-[11px] font-semibold py-1.5 px-2 rounded-lg border border-outline-variant/30 flex items-center justify-center gap-1 transition cursor-pointer" id="btn-save-qr">' +
                '<span class="material-symbols-outlined text-sm">download</span> Save QR' +
              '</button>' +
              '<button type="button" class="flex-1 bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-semibold py-1.5 px-2 rounded-lg border border-primary/30 flex items-center justify-center gap-1 transition cursor-pointer" id="btn-open-app">' +
                '<span class="material-symbols-outlined text-sm">open_in_new</span> Open App' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="md:col-span-7 flex flex-col gap-3">' +
            '<div class="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/30">' +
              '<span class="text-[10px] font-mono uppercase text-zinc-400 block mb-1">Registered Merchant Name</span>' +
              '<div class="flex items-center justify-between">' +
                '<span class="text-sm font-display font-bold text-white tracking-wide">' + esc(merchant) + '</span>' +
                '<span class="text-[11px] font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">Verified Host</span>' +
              '</div>' +
            '</div>' +
            '<div class="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/30">' +
              '<span class="text-[10px] font-mono uppercase text-zinc-400 block mb-1">' + esc(accLabel) + '</span>' +
              '<div class="flex items-center justify-between gap-2">' +
                '<span class="text-base font-mono font-bold text-primary tracking-wider" id="displayed-acc-num">' + esc(num) + '</span>' +
                '<button type="button" class="bg-surface-container-high hover:bg-surface-bright text-primary border border-primary/30 hover:border-primary px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer" id="btn-copy-account">' +
                  '<span class="material-symbols-outlined text-sm">content_copy</span>' +
                  '<span>Copy</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div class="p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/20 flex items-start gap-2.5 text-xs text-zinc-400">' +
              '<span class="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">payments</span>' +
              '<span>Zero platform convenience charges applied on direct GCash / InstaPay QR payments.</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    function renderAccountSubtabs(accounts, selIndex) {
      return accounts.map(function (acc, i) {
        var isSel = i === selIndex;
        var btnClass = isSel
          ? 'flex flex-col text-left p-2.5 rounded-xl border-2 border-primary bg-primary/10 text-white transition cursor-pointer'
          : 'flex flex-col text-left p-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-low hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition cursor-pointer';
        var merchant = acc.account_name || club.name || (i === 0 ? "John Mech" : i === 1 ? "Club Desk" : "Backup Account");
        return '<button type="button" class="receiver-subtab-btn ' + btnClass + '" data-acc-idx="' + i + '">' +
          '<div class="flex items-center justify-between w-full">' +
            '<span class="text-xs font-bold ' + (isSel ? 'text-primary' : 'text-zinc-300') + '">' + esc(acc.label || 'Receiver ' + (i + 1)) + '</span>' +
            (isSel ? '<span class="material-symbols-outlined text-primary text-sm">check_circle</span>' : '') +
          '</div>' +
          '<span class="text-[11px] font-mono ' + (isSel ? 'text-zinc-300' : 'text-zinc-400') + ' mt-1">' + esc(merchant) + '</span>' +
        '</button>';
      }).join("");
    }

    function clubInstructionMarkup(text) {
      var lines = String(text || "").split(/\r?\n|\s+\*\s+/).map(function (line) {
        return line.trim().replace(/^(?:\d+[.)]|[-*])\s*/, "");
      }).filter(function (line) { return line && !/^booking and payment instructions:?$/i.test(line); });
      return '<section class="payment-club-instructions"><h5>Instructions from the club</h5><ul>' + lines.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join("") + '</ul></section>';
    }
    el.innerHTML =
      '<div class="dink-payment-container max-w-7xl mx-auto w-full relative text-slate-100">' +
        '<header class="checkout-page-intro"><span>Pickleball Court Reservation</span><div><h1>Complete your payment</h1><span class="checkout-page-badge">Checkout</span></div><p>Pay your reservation fee and attach your receipt to confirm your court booking.</p></header>' +
        '<!-- Top Breadcrumb & Reference Context Bar -->' +
        '<div class="checkout-context-row flex flex-wrap items-center justify-between gap-4 mb-6">' +
          '<nav class="shared-booking-breadcrumb flex items-center gap-2 text-xs font-mono text-zinc-400">' +
            '<a class="hover:text-primary transition flex items-center gap-1 no-underline text-zinc-400" id="back-to-booking-btn" href="#/c/' + esc(club.slug || '') + '/book">' +
              '<span class="material-symbols-outlined text-sm">arrow_back</span>' +
              'Back to Court Booking' +
            '</a>' +
            '<span class="text-zinc-600">/</span>' +
            '<span class="text-zinc-300">' + esc(club.name || "Club") + '</span>' +
            '<span class="text-zinc-600">/</span>' +
            '<span class="text-primary font-bold">Checkout</span>' +
          '</nav>' +
          '<div class="checkout-context-badges flex items-center gap-3">' +
            '<div class="flex items-center gap-2 bg-surface-container-high px-3 py-1.5 rounded-full border border-outline-variant/40">' +
              '<span class="text-[11px] font-mono uppercase text-on-surface-variant">Booking Ref</span>' +
              '<span class="text-xs font-mono font-bold text-primary tracking-wider" id="global-ref-val">' + esc(b.reference_code) + '</span>' +
              '<button type="button" class="text-zinc-400 hover:text-primary transition flex items-center border-0 bg-transparent cursor-pointer p-0" id="btn-copy-global-ref" title="Copy Reference ID">' +
                '<span class="material-symbols-outlined text-sm">content_copy</span>' +
              '</button>' +
            '</div>' +
            '<span class="bg-primary/10 border border-primary/30 text-primary font-mono text-[11px] px-2.5 py-1 rounded-full font-semibold">Step 3 of 3 • Direct Payment</span>' +
          '</div>' +
        '</div>' +

        '<!-- 2 Columns Checkout Architecture (7 cols Left, 5 cols Right) -->' +
        '<div class="checkout-balanced-grid grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">' +
          '<!-- LEFT COLUMN: Payment & Transfer Method (7 cols) -->' +
          '<div class="checkout-method-column lg:col-span-7 flex flex-col gap-5">' +
            '<!-- Payment Gateway Switcher Card -->' +
            '<div class="bg-surface-container rounded-2xl border border-outline-variant/30 p-5 shadow-xl">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<div>' +
                  '<h2 class="text-base font-display font-bold text-white flex items-center gap-2 m-0">' +
                    '<span class="material-symbols-outlined text-primary text-xl">account_balance_wallet</span>' +
                    'Payment &amp; Transfer Method' +
                  '</h2>' +
                  '<p class="text-xs text-zinc-400 mt-0.5 m-0">Select preferred payment rail and send the exact fee amount.</p>' +
                '</div>' +
                '<span class="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">' +
                  '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>' +
                  'INSTANT MATCH' +
                '</span>' +
              '</div>' +
              '<!-- Segmented Method Tabs -->' +
              '<div class="grid grid-cols-3 gap-2 p-1 bg-surface-container-lowest rounded-xl border border-outline-variant/30" id="method-tab-bar">' +
                availableMethods.map(function (m) {
                  var isSel = m === activeMethod;
                  return '<button type="button" class="method-select-btn flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-display text-xs transition cursor-pointer border-0 ' +
                    (isSel ? 'bg-primary text-on-primary font-bold shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-surface-container-high font-semibold bg-transparent') + '" data-method="' + esc(m) + '">' +
                    '<span class="material-symbols-outlined payment-method-icon" aria-hidden="true">' + (m === "Bank Transfer" ? "account_balance" : "account_balance_wallet") + '</span>'  +
                    esc(m) +
                  '</button>';
                }).join("") +
              '</div>' +
              '<!-- Account Selection Sub-Tabs -->' +
              '<div class="mt-4 pt-3 border-t border-outline-variant/20 flex flex-col gap-2">' +
                '<span class="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Select Designated Receiver Account</span>' +
                '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2" id="account-subtabs-container">' +
                  renderAccountSubtabs(getAccountsForMethod(activeMethod), activeAccountIndex) +
                '</div>' +
              '</div>' +
            '</div>' +

            '<!-- Dedicated QR & Transfer Card -->' +
            '<div class="bg-surface-container rounded-2xl border border-outline-variant/30 p-5 shadow-xl relative overflow-hidden" id="dedicated-qr-container">' +
              renderQrCardContent(getAccountsForMethod(activeMethod)[activeAccountIndex]) +
            '</div>' +

            '<!-- Upload Payment Proof Section -->' +
            '<div class="checkout-proof-card bg-surface-container rounded-2xl border border-outline-variant/30 p-5 shadow-xl">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<div>' +
                  '<h2 class="text-base font-display font-bold text-white flex items-center gap-2 m-0">' +
                    '<span class="material-symbols-outlined text-primary text-xl">receipt_long</span>' +
                    'Upload Payment Proof' +
                  '</h2>' +
                  '<p class="text-xs text-zinc-400 mt-0.5 m-0">Attach the transaction screenshot or receipt slip showing reference number.</p>' +
                '</div>' +
                '<span class="text-[10px] font-mono bg-surface-container-high text-zinc-400 px-2 py-0.5 rounded border border-outline-variant/30">JPG, PNG, WebP up to 5MB</span>' +
              '</div>' +
              '<div class="relative group bg-surface-container-low hover:bg-surface-container-high rounded-xl border-2 border-dashed border-outline-variant/60 hover:border-primary p-6 transition flex flex-col items-center justify-center text-center cursor-pointer" id="drop-zone">' +
                '<input accept="image/jpeg,image/png,image/webp" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" id="proof-input" type="file" required/>' +
                '<div class="w-12 h-12 rounded-full bg-primary/10 text-primary border border-primary/30 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">' +
                  '<span class="material-symbols-outlined text-2xl">cloud_upload</span>' +
                '</div>' +
                '<p class="text-sm font-semibold text-white group-hover:text-primary transition m-0" id="file-name-label">' +
                  'Drag &amp; drop your receipt screenshot here, or <span class="text-primary underline">browse</span>' +
                '</p>' +
                '<p class="text-xs text-zinc-500 mt-1 m-0" id="file-attachment-hint">Your receipt uploads when you select Submit Proof &amp; Confirm Booking.</p>' +
              '</div>' +
              '<div class="hidden flex items-center justify-between bg-primary/10 border border-primary/30 px-3.5 py-2.5 rounded-xl mt-3" id="file-status-indicator">' +
                '<div class="flex items-center gap-2.5 min-w-0">' +
                  '<span class="material-symbols-outlined text-primary text-lg shrink-0" aria-hidden="true">attach_file</span>' +
                  '<span class="text-xs font-mono font-medium text-white truncate" id="file-display-name">receipt.png</span>' +
                '</div>' +
                '<button type="button" class="receipt-remove-button" id="btn-clear-file" aria-label="Remove attached receipt" title="Remove attached receipt"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>' +
              '</div>' +
              '<p class="msg mt-3 text-xs" role="alert" id="proof-msg"></p>' +
            '</div>' +
              '<template id="payment-help-content"><section class="payment-howto"><h4>How to complete payment</h4><ol><li>Choose a receiver account and save or scan its QR.</li><li>Open your payment app and send <strong>' + money(b.amount) + '</strong>. Check the receiver name before paying.</li><li>Include booking code <strong>' + esc(b.reference_code) + '</strong> in the payment note when available.</li><li>Save the receipt, attach it in checkout, then select Submit Proof &amp; Confirm Booking.</li></ol><p>' + (info.approval_required ? 'The club will review your receipt before confirming the reservation.' : 'Your reservation is confirmed after successful submission.') + '</p>' + (info.payment_instructions ? clubInstructionMarkup(info.payment_instructions) : '') + '</section></template>' +
          '</div>' +

          '<!-- RIGHT COLUMN: Order & Court Summary Card (5 cols) -->' +
          '<div class="checkout-ticket-column lg:col-span-5 flex flex-col gap-5">' +
            '<div class="bg-surface-container rounded-2xl border border-outline-variant/30 p-5 shadow-2xl relative">' +
              '<!-- Header & Countdown Urgency Pill -->' +
              '<div class="flex items-center justify-between pb-4 border-b border-outline-variant/30">' +
                '<h3 class="payment-reservation-title font-display font-bold text-base text-white tracking-tight m-0"><span class="material-symbols-outlined" aria-hidden="true">event_available</span>Court Reservation</h3>' +
                '<div class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono font-bold">' +
                  '<span class="material-symbols-outlined payment-timer-icon" aria-hidden="true">timer</span>' +
                  '<span id="countdown-val">Calculating...</span>' +
                '</div>' +
              '</div>' +
              '<!-- Venue & Match Card Block -->' +
              '<div class="py-4 border-b border-outline-variant/20 flex flex-col gap-3">' +
                '<div class="flex items-start gap-3">' +
                  '<div class="w-10 h-10 rounded-xl bg-surface-container-high border border-outline-variant/40 flex items-center justify-center text-primary shrink-0">' +
                    '<svg class="payment-court-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M8 4v16m8-16v16M8 8h8m-8 8h8"/></svg>' +
                  '</div>' +
                  '<div class="flex flex-col">' +
                    '<span class="text-xs font-mono uppercase text-primary font-bold tracking-wider">' + esc(club.name || "The Pickleshot Arena") + '</span>' +
                    '<h4 class="text-base font-display font-bold text-white m-0">' + esc(court.name || "Court 1") + ' (' + esc(court.surface || "Silica Sand Outdoor") + ')</h4>' +
                    '<p class="text-xs text-zinc-400 mt-0.5 m-0">' + esc(club.motto || club.address || "Kinetic Velocity Club • Outdoor Arena Alpha") + '</p>' +
                  '</div>' +
                '</div>' +
                '<!-- Date, Time Badges -->' +
                '<div class="grid grid-cols-2 gap-2 mt-1">' +
                  '<div class="bg-surface-container-low p-2.5 rounded-xl border border-outline-variant/30 flex items-center gap-2">' +
                    '<span class="material-symbols-outlined text-primary text-base shrink-0">calendar_today</span>' +
                    '<div class="min-w-0">' +
                      '<span class="text-[10px] font-mono uppercase text-zinc-400 block">Date</span>' +
                      '<span class="text-xs font-semibold text-zinc-200 truncate block">' + esc(dateStr) + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="bg-surface-container-low p-2.5 rounded-xl border border-outline-variant/30 flex items-center gap-2">' +
                    '<span class="material-symbols-outlined text-primary text-base shrink-0">schedule</span>' +
                    '<div class="min-w-0">' +
                      '<span class="text-[10px] font-mono uppercase text-zinc-400 block">Time Slot</span>' +
                      '<span class="text-xs font-semibold text-zinc-200 truncate block">' + esc(timeStr) + '</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-low text-xs text-zinc-300">' +
                  '<span class="flex items-center gap-1.5">' +
                    '<span class="material-symbols-outlined text-sm text-primary">groups</span>' +
                    'Session Capacity: <strong>Up to 4 players included</strong>' +
                  '</span>' +
                  '<span class="text-[11px] font-mono text-zinc-400">' + hrs + ' hr peak session</span>' +
                '</div>' +
              '</div>' +

              '<!-- Mandatory Payment Note Box (High Visibility) -->' +
              '<div class="my-4 bg-gradient-to-r from-primary/15 via-surface-container-low to-primary/10 border-2 border-primary/50 rounded-xl p-4 shadow-lg">' +
                '<div class="flex items-center justify-between mb-1.5">' +
                  '<div class="flex items-center gap-1.5 text-primary text-xs font-mono font-bold uppercase tracking-wider">' +
                    '<span class="material-symbols-outlined text-sm font-bold">sticky_note_2</span>' +
                    'Required Payment Note' +
                  '</div>' +
                  '<span class="text-[10px] font-mono bg-primary text-black font-bold px-2 py-0.5 rounded">MANDATORY</span>' +
                '</div>' +
                '<p class="text-xs text-zinc-300 mb-2">' +
                  'You must copy &amp; paste this reference code into the payment message/notes box. This helps the club match your payment to the booking.' +
                '</p>' +
                '<div class="flex items-center justify-between bg-black/40 border border-primary/40 rounded-lg p-2.5">' +
                  '<span class="font-mono text-base font-extrabold text-primary tracking-wider" id="note-ref-val">' + esc(b.reference_code) + '</span>' +
                  '<button type="button" class="bg-primary hover:bg-primary/90 text-black px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center gap-1 transition cursor-pointer border-0" id="btn-copy-note-ref">' +
                    '<span class="material-symbols-outlined text-sm">content_copy</span>' +
                    'Copy Code' +
                  '</button>' +
                '</div>' +
              '</div>' +

              '<!-- Price Breakdown Ledger -->' +
              '<div class="py-3 border-t border-outline-variant/30 flex flex-col gap-2 text-xs">' +
                '<div class="flex items-center justify-between text-zinc-300">' +
                  '<span>Court Fee (' + hrs + ' hr' + (hrs > 1 ? 's' : '') + ' Peak Session)</span>' +
                  '<span class="font-mono font-semibold">' + money(b.amount) + '</span>' +
                '</div>' +
                '<div class="flex items-center justify-between text-zinc-300">' +
                  '<span class="flex items-center gap-1">' +
                    'LED Lighting Surcharge' +
                    '<span class="text-[10px] text-primary bg-primary/10 px-1 rounded">Night Rate</span>' +
                  '</span>' +
                  '<span class="font-mono text-emerald-400 font-semibold">FREE (Included)</span>' +
                '</div>' +
                '<div class="flex items-center justify-between text-zinc-300">' +
                  '<span>DINK Platform Convenience Fee</span>' +
                  '<span class="font-mono text-emerald-400 font-semibold">PHP 0.00 (Waived)</span>' +
                '</div>' +
                '<div class="checkout-total-due flex items-baseline justify-between pt-3 mt-1 border-t border-outline-variant/40">' +
                  '<div>' +
                    '<span class="text-xs uppercase font-mono tracking-wider text-zinc-400 block">Total Amount Due</span>' +
                    '<span class="text-[11px] text-zinc-500">Tax included • Direct settlement</span>' +
                  '</div>' +
                  '<div class="text-right">' +
                    '<span class="font-display text-3xl font-extrabold text-primary tracking-tight">' + money(b.amount) + '</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<section class="checkout-club-policies" aria-labelledby="checkout-policy-title"><h4 id="checkout-policy-title"><span class="material-symbols-outlined" aria-hidden="true">policy</span>Club Policies &amp; Cancellation Terms</h4><ul><li><span class="material-symbols-outlined" aria-hidden="true">event_busy</span><span><strong>Cancellation &amp; Refunds:</strong> Bookings cannot be cancelled and payments are non-refundable, except when weather prevents play.</span></li><li><span class="material-symbols-outlined" aria-hidden="true">rainy</span><span><strong>Weather Guarantee:</strong> If weather prevents your outdoor session from going ahead, your payment will be refunded.</span></li><li><span class="material-symbols-outlined" aria-hidden="true">checkroom</span><span><strong>Dress Code:</strong> Wear non-marking athletic court shoes on Silica Sand surfaces.</span></li></ul></section>' +

              '<!-- Primary & Secondary Checkout CTAs -->' +
              '<div class="flex flex-col gap-2.5 mt-5">' +
                '<button type="button" class="w-full bg-primary hover:bg-[#b2f746] text-[#121f00] font-display font-extrabold text-base py-3.5 px-6 rounded-xl shadow-neon-lime hover:shadow-neon-lime transition-all flex items-center justify-center gap-2 group cursor-pointer border-0" id="submit-confirm-btn">' +
                  '<span class="material-symbols-outlined font-bold text-xl group-hover:scale-110 transition-transform">task_alt</span>' +
                  '<span>Submit Proof &amp; Confirm Booking</span>' +
                '</button>' +
                '<div class="checkout-secondary-actions flex items-center justify-between gap-2 pt-1">' +
                  '<a class="flex-1 bg-surface-container-high hover:bg-surface-bright text-zinc-300 text-xs font-semibold py-2.5 px-3 rounded-lg border border-outline-variant/30 transition text-center no-underline" href="#/me/bookings">' +
                    'View My Bookings' +
                  '</a>' +
                  '<button type="button" class="text-xs text-zinc-400 hover:text-rose-400 font-semibold py-2.5 px-3 rounded-lg transition text-center border-0 bg-transparent cursor-pointer" id="cancel-release-btn">' +
                    'Cancel &amp; Release Slot' +
                  '</button>' +
                '</div>' +
              '</div>' +

              '<button type="button" class="payment-help-trigger" id="payment-help-btn"><span class="material-symbols-outlined" aria-hidden="true">help</span>How to pay &amp; club instructions<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span></button>' +
              '<!-- Trust Sub-badge inside card -->' +
              '<div class="payment-access-note mt-4 pt-3 border-t border-outline-variant/20">' +
                '<span class="material-symbols-outlined" aria-hidden="true">door_front</span>' +
                '<span>Your gate access pass is ready once your booking is confirmed.</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    function copyText(val, toastId) {
      if (!val) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(function () { showToast(toastId); }).catch(function () {
          fallbackCopy(val, toastId);
        });
      } else {
        fallbackCopy(val, toastId);
      }
    }
    function fallbackCopy(val, toastId) {
      var ta = document.createElement("textarea");
      ta.value = val;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); showToast(toastId); } catch (e) {}
      document.body.removeChild(ta);
    }
    function showToast(id) {
      D.ui.toast(id === 'gcash-toast' ? 'Account number copied.' : 'Booking reference copied.', 'ok');
    }

    var btnCopyGlobal = el.querySelector("#btn-copy-global-ref");
    if (btnCopyGlobal) btnCopyGlobal.onclick = function () { copyText(b.reference_code, "global-ref-toast"); };
    var btnCopyNoteRef = el.querySelector("#btn-copy-note-ref");
    if (btnCopyNoteRef) btnCopyNoteRef.onclick = function () { copyText(b.reference_code, "summary-note-toast"); };

    var backBtn = el.querySelector("#back-to-booking-btn");
    if (backBtn && ctx.onBack) {
      backBtn.onclick = function (e) {
        e.preventDefault();
        ctx.onBack();
      };
    }

    var totalSeconds;
    if (b.expires_at) {
      var diffSec = Math.floor((new Date(b.expires_at).getTime() - Date.now()) / 1000);
      totalSeconds = Math.max(0, diffSec);
    } else {
      totalSeconds = 29 * 60 + 32;
    }
    function formatTime(sec) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
    var countdownVal = el.querySelector("#countdown-val");
    var navCountdown = document.getElementById("nav-countdown");
    if (countdownVal) countdownVal.textContent = totalSeconds > 0 ? formatTime(totalSeconds) + " remaining" : "Expired";
    if (navCountdown) navCountdown.textContent = totalSeconds > 0 ? formatTime(totalSeconds) : "00:00";

    var timerTick = setInterval(function () {
      if (!el.isConnected) { clearInterval(timerTick); return; }
      if (totalSeconds <= 0) {
        if (countdownVal) countdownVal.textContent = "Expired";
        if (navCountdown) navCountdown.textContent = "00:00";
        clearInterval(timerTick);
        return;
      }
      totalSeconds--;
      var formatted = formatTime(totalSeconds);
      if (countdownVal) countdownVal.textContent = formatted + " remaining";
      if (navCountdown) navCountdown.textContent = formatted;
    }, 1000);

    function wireAccountsAndQr() {
      var curAccounts = getAccountsForMethod(activeMethod);
      var curAccount = curAccounts[activeAccountIndex] || curAccounts[0];

      var subtabContainer = el.querySelector("#account-subtabs-container");
      if (subtabContainer) {
        subtabContainer.innerHTML = renderAccountSubtabs(curAccounts, activeAccountIndex);
        subtabContainer.querySelectorAll(".receiver-subtab-btn").forEach(function (btn) {
          btn.onclick = function () {
            activeAccountIndex = +btn.getAttribute("data-acc-idx") || 0;
            wireAccountsAndQr();
          };
        });
      }

      var qrCard = el.querySelector("#dedicated-qr-container");
      if (qrCard) {
        qrCard.innerHTML = renderQrCardContent(curAccount);
      }

      var btnCopyAcc = el.querySelector("#btn-copy-account");
      if (btnCopyAcc) {
        btnCopyAcc.onclick = function () {
          copyText(curAccount.account_number || "09254525633", "gcash-toast");
        };
      }

      var btnSaveQr = el.querySelector("#btn-save-qr");
      if (btnSaveQr) {
        btnSaveQr.onclick = async function () {
          btnSaveQr.disabled = true;
          try {
            if (curAccount.qr_path && urls[curAccount.qr_path]) {
              var resp = await fetch(urls[curAccount.qr_path]);
              var blob = await resp.blob();
              var u = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = u; a.download = "payment-qr-" + b.reference_code + ".png"; a.click();
              setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
            } else {
              copyText(curAccount.account_number || "", "gcash-toast");
            }
          } catch (e) {
            if (curAccount.qr_path && urls[curAccount.qr_path]) window.open(urls[curAccount.qr_path], "_blank");
          } finally {
            btnSaveQr.disabled = false;
          }
        };
      }

      var btnOpenApp = el.querySelector("#btn-open-app");
      if (btnOpenApp) {
        btnOpenApp.textContent = /gcash/i.test(activeMethod) ? "Open GCash" : "Open payment app";
        btnOpenApp.onclick = function () {
          if (/gcash/i.test(activeMethod)) {
            window.open("https://gcash.com/getting-started?redirect=gcash%3A%2F%2Fcom.mynt.gcash%2Fapp%2F006300000100", "_blank", "noopener");
          } else {
            msg(q("form.proof", el) || el, "Open your " + activeMethod + " app, scan the saved QR, and send the exact amount.", "");
          }
        };
      }
    }

    var methodBtns = el.querySelectorAll(".method-select-btn");
    methodBtns.forEach(function (btn) {
      btn.onclick = function () {
        activeMethod = btn.getAttribute("data-method");
        activeAccountIndex = 0;
        methodBtns.forEach(function (b) {
          var isSel = b.getAttribute("data-method") === activeMethod;
          b.className = "method-select-btn flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-display text-xs transition cursor-pointer border-0 " +
            (isSel ? "bg-primary text-on-primary font-bold shadow-sm" : "text-zinc-400 hover:text-white hover:bg-surface-container-high font-semibold bg-transparent");
          b.innerHTML = '<span class="material-symbols-outlined payment-method-icon" aria-hidden="true">' + (m === "Bank Transfer" ? "account_balance" : "account_balance_wallet") + '</span>'  + esc(b.getAttribute("data-method"));
        });
        wireAccountsAndQr();
      };
    });

    wireAccountsAndQr();
    el.querySelector("#payment-help-btn").onclick = function () {
      var trigger = this;
      var dialog = document.createElement("dialog");
      dialog.className = "payment-instructions-modal";
      dialog.setAttribute("aria-labelledby", "payment-instructions-title");
      dialog.innerHTML = '<header><div><span class="payment-guide-badge"><span class="material-symbols-outlined" aria-hidden="true">help</span>Payment guide</span><h2 id="payment-instructions-title">Payment instructions</h2><p>Follow the payment steps and review the club guidelines.</p></div><button type="button" data-close-guide aria-label="Close payment instructions"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header><div class="payment-instructions-body"></div><footer><span class="material-symbols-outlined" aria-hidden="true">info</span><span>Return to checkout to upload your receipt.</span><button type="button" data-close-guide>Got it</button></footer>';
      dialog.querySelector(".payment-instructions-body").append(el.querySelector("#payment-help-content").content.cloneNode(true));
      dialog.querySelectorAll("[data-close-guide]").forEach(function (button) { button.onclick = function () { dialog.close(); }; });
      dialog.addEventListener("close", function () { dialog.remove(); if (trigger.isConnected) trigger.focus(); }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    };

    var fileInput = el.querySelector("#proof-input");
    var fileStatus = el.querySelector("#file-status-indicator");
    var fileNameLabel = el.querySelector("#file-name-label");
    var fileDisplayName = el.querySelector("#file-display-name");
    var dropZone = el.querySelector("#drop-zone");
    var clearBtn = el.querySelector("#btn-clear-file");
    var proofMsg = el.querySelector("#proof-msg");

    function handleFile(file) {
      if (!file) return;
      try {
        checkImage(file);
        if (fileNameLabel) fileNameLabel.textContent = "Ready to upload: " + file.name;
        if (fileDisplayName) fileDisplayName.textContent = file.name;
        if (fileStatus) fileStatus.classList.remove("hidden");
        if (proofMsg) { proofMsg.textContent = ""; proofMsg.className = "msg mt-3 text-xs"; }
      } catch (err) {
        if (fileInput) fileInput.value = "";
        if (fileStatus) fileStatus.classList.add("hidden");
        if (fileNameLabel) fileNameLabel.innerHTML = 'Drag &amp; drop your receipt screenshot here, or <span class="text-primary underline">browse</span>';
        if (proofMsg) { proofMsg.textContent = nice(err); proofMsg.className = "msg err mt-3 text-xs text-rose-400 font-semibold"; }
      }
    }

    if (fileInput) {
      fileInput.onchange = function () {
        if (this.files && this.files[0]) handleFile(this.files[0]);
      };
    }

    if (dropZone) {
      ["dragenter", "dragover"].forEach(function (eventName) {
        dropZone.addEventListener(eventName, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.add("border-primary", "bg-surface-container-high");
        }, false);
      });
      ["dragleave", "drop"].forEach(function (eventName) {
        dropZone.addEventListener(eventName, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.remove("border-primary", "bg-surface-container-high");
        }, false);
      });
      dropZone.addEventListener("drop", function (e) {
        var dt = e.dataTransfer;
        var files = dt.files;
        if (files && files.length) {
          fileInput.files = files;
          handleFile(files[0]);
        }
      }, false);
    }

    if (clearBtn) {
      clearBtn.onclick = function (e) {
        e.stopPropagation();
        if (fileInput) fileInput.value = "";
        if (fileNameLabel) fileNameLabel.innerHTML = 'Drag &amp; drop your receipt screenshot here, or <span class="text-primary underline">browse</span>';
        if (fileStatus) fileStatus.classList.add("hidden");
      };
    }

    var submitBtn = el.querySelector("#submit-confirm-btn");
    if (submitBtn) {
      submitBtn.onclick = async function () {
        if (submitBtn.disabled) return;
        var file = fileInput ? fileInput.files[0] : null;
        if (!file) {
          if (proofMsg) {
            proofMsg.textContent = "Please attach your payment receipt screenshot before submitting.";
            proofMsg.className = "msg err mt-3 text-xs text-rose-400 font-semibold";
          }
          if (dropZone) dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        try {
          checkImage(file);
        } catch (err) {
          if (proofMsg) {
            proofMsg.textContent = nice(err);
            proofMsg.className = "msg err mt-3 text-xs text-rose-400 font-semibold";
          }
          return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add("opacity-80", "pointer-events-none");
        submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-xl">refresh</span><span>Uploading receipt...</span>';

        try {
          var path = b.tenant_id + "/proofs/" + D.state.user.id + "/" + b.id + "-" + attemptKey + "." + TYPES[file.type];
          var up = await sb.storage.from("payment").upload(path, file, { contentType: file.type, upsert: false });
          if (up.error && !/exist|duplicate|409/i.test(up.error.message || "")) throw up.error;
          submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-xl">refresh</span><span>Submitting payment proof...</span>';

          var curAccounts = getAccountsForMethod(activeMethod);
          var curAccount = curAccounts[activeAccountIndex] || curAccounts[0];
          var methodString = activeMethod + (curAccount && curAccount.label ? " - " + curAccount.label : "");

          var r = await sb.rpc("attach_payment_proof", {
            p_booking_id: b.id,
            p_proof_path: path,
            p_payer_reference: null,
            p_idempotency_key: attemptKey,
            p_method: methodString
          });
          if (r.error) throw r.error;

          submitBtn.classList.remove("opacity-80", "pointer-events-none", "bg-primary");
          submitBtn.classList.add("bg-emerald-400", "text-black");
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-xl">check_circle</span><span>' + esc(court.name || "Court") + ' Confirmed! Gate Access QR Ready</span>';

          setTimeout(function () {
            el.innerHTML = '<div class="max-w-xl mx-auto py-12 px-6 text-center space-y-6 bg-surface-container rounded-3xl border border-primary/30 shadow-2xl">' +
              '<div class="w-16 h-16 rounded-2xl bg-primary/20 text-primary border border-primary/40 flex items-center justify-center mx-auto text-3xl shadow-neon-lime">' +
                '<span class="material-symbols-outlined text-3xl font-bold">check</span>' +
              '</div>' +
              '<div class="space-y-2">' +
                '<span class="text-xs font-mono uppercase tracking-widest text-primary font-bold">Booking Hold Confirmed</span>' +
                '<h2 class="text-2xl sm:text-3xl font-display font-extrabold text-white tracking-tight">Proof Submitted Successfully!</h2>' +
                '<p class="text-sm text-zinc-300 max-w-md mx-auto">Your payment receipt for <strong class="text-white">' + esc(court.name || "Court") + '</strong> has been received with reference <strong class="text-primary font-mono">' + esc(b.reference_code) + '</strong>.</p>' +
              '</div>' +
              '<div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-zinc-400 max-w-md mx-auto space-y-1.5 text-left font-mono">' +
                '<div class="flex justify-between"><span class="text-zinc-500">Venue:</span><span class="text-white font-bold">' + esc(club.name || "Club") + '</span></div>' +
                '<div class="flex justify-between"><span class="text-zinc-500">Schedule:</span><span class="text-zinc-200">' + esc(dateStr) + ' • ' + esc(timeStr) + '</span></div>' +
                '<div class="flex justify-between"><span class="text-zinc-500">Amount:</span><span class="text-primary font-bold">' + money(b.amount) + '</span></div>' +
              '</div>' +
              '<div class="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">' +
                '<a class="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary hover:bg-[#b2f746] text-black font-display font-bold text-sm shadow-neon-lime transition no-underline text-center" href="#/me/bookings">View My Bookings</a>' +
                '<a class="w-full sm:w-auto px-5 py-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-zinc-200 font-semibold text-xs border border-outline-variant/40 transition no-underline text-center" href="#/c/' + esc(club.slug || '') + '">Back to Club</a>' +
              '</div>' +
            '</div>';
            if (ctx && ctx.onDone) ctx.onDone();
          }, 1200);

        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("opacity-80", "pointer-events-none");
          submitBtn.innerHTML = '<span class="material-symbols-outlined font-bold text-xl">task_alt</span><span>Submit Proof &amp; Confirm Booking</span>';
          if (proofMsg) {
            proofMsg.textContent = nice(err);
            proofMsg.className = "msg err mt-3 text-xs text-rose-400 font-semibold";
          }
        }
      };
    }

    var cancelReleaseBtn = el.querySelector("#cancel-release-btn");
    if (cancelReleaseBtn) {
      cancelReleaseBtn.onclick = async function () {
        if (!confirm("Are you sure you want to cancel and release " + (court.name || "Court") + " back to the booking pool?")) return;
        cancelReleaseBtn.disabled = true;
        cancelReleaseBtn.textContent = "Releasing...";
        var r = await sb.rpc("cancel_booking", {
          p_booking_id: b.id,
          p_reason: "Player released slot from checkout",
          p_idempotency_key: uuid()
        });
        if (r.error) {
          cancelReleaseBtn.disabled = false;
          cancelReleaseBtn.textContent = "Cancel & Release Slot";
          alert("Could not cancel: " + nice(r.error));
          return;
        }
        if (ctx && ctx.onBack) {
          ctx.onBack();
        } else {
          location.reload();
        }
      };
    }
  }

  // ============================================================ book page
  async function renderBook(slug) {
    var root = D.root();
    if (!D.requireUser("/c/" + slug + "/book")) return;
    root.innerHTML = '<div class="w-full max-w-7xl mx-auto px-4 py-8 space-y-6">' +
      '<div class="h-8 w-48 rounded-lg bg-carbon-850/70 ds-skeleton border border-white/5"></div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">' +
        '<div class="lg:col-span-8 space-y-6">' +
          '<div class="h-44 rounded-2xl bg-carbon-900/60 ds-skeleton border border-white/5"></div>' +
          '<div class="h-72 rounded-2xl bg-carbon-900/60 ds-skeleton border border-white/5"></div>' +
        '</div>' +
        '<div class="lg:col-span-4">' +
          '<div class="h-96 rounded-2xl bg-carbon-900/60 ds-skeleton border border-white/5"></div>' +
        '</div>' +
      '</div></div>';
    var club = (await sb.from("public_clubs").select("*").eq("slug", slug).maybeSingle()).data;
    if (!club) { root.innerHTML = '<div class="max-w-xl mx-auto py-16 text-center text-slate-300"><h2>Club not found</h2><p>This club does not exist or is not approved yet.</p><a class="inline-block mt-4 px-4 py-2 rounded-xl bg-neon-lime text-carbon-950 font-bold text-sm" href="#/">Back to clubs</a></div>'; return; }
    var me = (await sb.from("club_players").select("id,status,display_name").eq("tenant_id", club.id)
      .eq("user_id", D.state.user.id).maybeSingle()).data;
    if (!me) return D.go("/c/" + slug + "/join");
    if (me.status === "blocked") { root.innerHTML = '<div class="max-w-xl mx-auto py-16 text-center text-slate-300"><h2>Booking unavailable</h2><p>You are blocked from this club. Please contact the club.</p></div>'; return; }
    var courts = (await sb.from("public_courts").select("*").eq("club_slug", slug).order("name")).data || [];
    var tz = club.timezone || "Asia/Manila";
    var S = { court: null, info: null, date: "", slots: [], start: null, count: 1, bookingDays: 14, reserving: false };
    var pre = new URLSearchParams(location.hash.split("?")[1] || "");

    function addDays(ymd, n) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }

    root.innerHTML =
      '<div id="ds-book-page" class="book-public w-full min-h-screen text-slate-100 flex flex-col antialiased selection:bg-neon-lime selection:text-black">' +
        '<!-- BookingMainLayout -->' +
        '<main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">' +
          '<div id="booking-step1-2-wrapper">' +
          '<header class="checkout-page-intro"><span>Pickleball Court Reservation</span><div><h1>Book a court</h1><span class="checkout-page-badge">Fast Checkout</span></div><p>Choose your court and time, then confirm your reservation.</p></header>' +

        '<section class="booking-context" data-purpose="breadcrumbs-context">' +
          '<div class="flex flex-wrap items-center justify-between gap-3 text-xs">' +
            '<nav class="booking-checkout-breadcrumb shared-booking-breadcrumb" aria-label="Breadcrumb"><a href="#/c/' + esc(slug) + '"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Back to club</a><span aria-hidden="true">/</span><span>' + esc(club.name) + '</span><span aria-hidden="true">/</span><strong aria-current="page">Book a court</strong></nav>' +
            '<div class="booking-context-status">' +
              '<span class="club-live-badge"><span class="booking-live-dot" aria-hidden="true"></span><span id="book-live-slots">Live Availability: Checking slots...</span></span>' +
              '<span class="booking-timezone">Timezone: ' + esc(tz) + ' (PHT)</span>' +
            '</div>' +
          '</div>' +
        '</section>' +

          '<div class="booking-layout grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">' +
            '<!-- LEFT / MAIN INTERACTION COLUMN -->' +
            '<div class="booking-steps lg:col-span-8 space-y-7">' +
              '<!-- Step 1: Choose a court -->' +
              '<section class="bg-carbon-900 rounded-2xl p-6 sm:p-7 border border-white/10 shadow-card-dark relative overflow-hidden" data-purpose="step-choose-court">' +
                '<div class="flex items-center justify-between mb-5">' +
                  '<div class="flex items-center gap-3">' +
                    '<span class="w-7 h-7 rounded-lg bg-neon-lime text-carbon-950 font-black text-sm flex items-center justify-center shadow-sm">1</span>' +
                    '<h2 class="text-lg sm:text-xl font-bold text-white tracking-tight m-0">Choose a court</h2>' +
                  '</div>' +
                  '<span class="text-xs font-mono text-slate-400">' + courts.length + ' ' + (courts.length === 1 ? 'Court' : 'Courts') + ' Available</span>' +
                '</div>' +
                '<div id="courtcards" class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">' +
                '</div>' +
              '</section>' +

              '<!-- Step 2: Pick a date and time -->' +
              '<section id="slotpanel" class="bg-carbon-900 rounded-2xl p-6 sm:p-7 border border-white/10 shadow-card-dark space-y-6" data-purpose="step-date-time-selection" hidden>' +
                '<div class="flex items-center justify-between">' +
                  '<div class="flex items-center gap-3">' +
                    '<span class="w-7 h-7 rounded-lg bg-neon-lime text-carbon-950 font-black text-sm flex items-center justify-center shadow-sm">2</span>' +
                    '<h2 class="text-lg sm:text-xl font-bold text-white tracking-tight m-0">Pick a date and time</h2>' +
                  '</div>' +
                  '<div class="hidden sm:flex items-center gap-1 text-[11px] text-slate-400 bg-carbon-800/80 px-2.5 py-1 rounded-lg border border-white/5">' +
                    '<span>Timezone:</span>' +
                    '<strong class="text-slate-200">' + esc(tz) + ' (PHT)</strong>' +
                  '</div>' +
                '</div>' +

                '<!-- Date Input & Quick Day Selector -->' +
                '<div class="booking-date-length">' +
                '<div class="booking-date-field space-y-2.5">' +
                  '<label for="bd" class="block text-xs font-semibold uppercase tracking-wider text-slate-300">Date</label>' +
                  '<div class="relative">' +
                    '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">' +
                      '<svg class="w-4 h-4 text-neon-lime" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '</div>' +
                    '<input id="bd" data-has-icon="true" class="w-full pl-11 pr-10 py-3 bg-carbon-850 border border-white/10 rounded-xl text-sm font-semibold text-white focus:outline-none focus:border-neon-lime focus:ring-1 focus:ring-neon-lime cursor-pointer font-mono" type="date"/>' +
                  '</div>' +
                '</div>' +

                '<!-- Duration / Length Selector -->' +
                '<div class="booking-length-field space-y-2">' +
                  '<label for="bn" class="block text-xs font-semibold uppercase tracking-wider text-slate-300">Length</label>' +
                  '<div class="relative">' +
                    '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">' +
                      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '</div>' +
                    '<select id="bn" data-has-icon="true" class="w-full pl-11 pr-10 py-3 bg-carbon-850 border border-white/10 rounded-xl text-sm font-semibold text-white focus:outline-none focus:border-neon-lime focus:ring-1 focus:ring-neon-lime appearance-none cursor-pointer">' +
                    '</select>' +
                    '<div class="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">' +
                      '<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '</div>' +
                  '</div>' +
                '</div>' +

                '</div>' +
                '<div id="quick-days" aria-label="Quick booking dates"></div>' +

                '<!-- Slots Time Matrix Grid -->' +
                '<div class="booking-time-section">' +
                  '<div class="flex items-center justify-between text-xs text-slate-400">' +
                    '<span class="font-medium text-slate-300">Select Available Start Time</span>' +
                    '<div class="booking-slot-legend" aria-label="Time slot status"><span class="slot-status selected">Selected</span><span class="slot-status open">Open</span><span class="slot-status booked">Booked</span></div>' +
                  '</div>' +
                  '<div id="slots" class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">' +
                  '</div>' +
                  '<p class="text-xs text-slate-400 pt-2 flex items-center gap-1.5">' +
                    '<svg class="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '<span>Greyed out times are taken or in the past. Times are in ' + esc(tz) + '.</span>' +
                  '</p>' +
                '</div>' +

                '<!-- Selected Slot Banner & Quick Reserve Button -->' +
                '<div id="slot-banner" class="mt-4 p-4 rounded-xl bg-carbon-950 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4" hidden>' +
                  '<div>' +
                    '<div class="text-xs font-mono uppercase text-slate-400 tracking-wider">Current Selection</div>' +
                    '<div id="banner-selection-time" class="text-base sm:text-lg font-bold text-white tracking-tight mt-0.5"></div>' +
                    '<div id="banner-selection-rate" class="text-xs text-slate-400 mt-0.5"></div>' +
                  '</div>' +
                  '<div class="flex items-center gap-3">' +
                    '<div class="text-right sm:block hidden">' +
                      '<div class="text-xs text-slate-400">Total Due</div>' +
                      '<div id="banner-total-due" class="text-xl font-black text-neon-lime font-mono"></div>' +
                    '</div>' +
                    '<button id="reserve" type="button" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-neon-lime text-carbon-950 hover:bg-neon-glow font-bold text-sm flex items-center justify-center gap-2 shadow-neon transition-all hover:scale-[1.02] active:scale-[0.98] border-0 cursor-pointer">' +
                      '<svg class="w-4 h-4 text-carbon-950" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                      '<span>Reserve this slot</span>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '<div class="booking-selection-support p-4 rounded-xl bg-carbon-900/60 border border-white/5 flex items-center justify-between text-xs text-slate-400">' +
                '<div class="flex items-center gap-2.5">' +
                  '<div class="w-8 h-8 rounded-lg bg-carbon-800 flex items-center justify-center text-neon-lime">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '</div>' +
                  '<div>' +
                    '<p class="text-white font-medium m-0">Need equipment or a paddle coach?</p>' +
                    '<p class="text-[11px] m-0">Chat with ' + esc(club.name) + ' club front desk</p>' +
                  '</div>' +
                '</div>' +
                (club.contact_phone ? '<a href="tel:' + esc(club.contact_phone) + '" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium text-xs transition-colors border border-white/10 no-underline">Call Support</a>'
                  : club.contact_email ? '<a href="mailto:' + esc(club.contact_email) + '" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium text-xs transition-colors border border-white/10 no-underline">Email</a>'
                  : '<span class="text-xs text-slate-500">Support</span>') +
              '</div>' +
                '<p class="msg" role="alert"></p>' +
              '</section>' +

              '<!-- Step 3: Payment Panel -->' +
              '<section id="paypanel" class="space-y-6" hidden></section>' +
            '</div>' +

            '<!-- RIGHT COLUMN: Sticky Reservation Checkout Card & Summary -->' +
            '<aside class="lg:col-span-4 lg:sticky lg:top-24 space-y-5" data-purpose="reservation-summary-sidebar">' +
              '<div class="bg-carbon-900 rounded-2xl p-6 border border-white/10 shadow-card-dark relative overflow-hidden">' +
                '<div class="absolute -top-12 -right-12 w-32 h-32 bg-neon-lime/10 rounded-full blur-2xl pointer-events-none"></div>' +
                '<div class="flex items-center justify-between pb-5 border-b border-white/10">' +
                  '<div>' +
                    '<span class="text-[11px] font-mono text-neon-lime uppercase tracking-wider font-semibold">Booking Ticket</span>' +
                    '<h3 class="text-xl font-extrabold text-white m-0">Reservation Summary</h3>' +
                  '</div>' +
                  '<span id="ticket-ref-badge" class="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-mono text-slate-300">' +
                    '#READY' +
                  '</span>' +
                '</div>' +

                '<div class="py-5 space-y-3.5 border-b border-white/10 text-xs">' +
                  '<div class="flex items-start justify-between">' +
                    '<span class="text-slate-400">Club Venue</span>' +
                    '<span class="text-white font-semibold text-right">' + esc(club.name) + '</span>' +
                  '</div>' +
                  '<div class="flex items-start justify-between">' +
                    '<span class="text-slate-400">Court Assigned</span>' +
                    '<span id="summary-court-assigned" class="text-white font-semibold text-right flex items-center gap-1.5">' +
                      '<span class="w-2 h-2 rounded-full bg-neon-lime"></span>' +
                      '<span>Select a court</span>' +
                    '</span>' +
                  '</div>' +
                  '<div class="flex items-start justify-between">' +
                    '<span class="text-slate-400">Date</span>' +
                    '<span id="summary-date" class="text-slate-200 font-mono font-medium">-</span>' +
                  '</div>' +
                  '<div class="flex items-start justify-between">' +
                    '<span class="text-slate-400">Time Window</span>' +
                    '<span id="summary-time" class="text-neon-lime font-mono font-semibold">Select a time slot</span>' +
                  '</div>' +
                  '<div class="flex items-start justify-between">' +
                    '<span class="text-slate-400">Player Count</span>' +
                    '<span class="text-slate-200">Up to 4 Players Included</span>' +
                  '</div>' +
                '</div>' +

                '<div class="py-5 space-y-3 border-b border-white/10">' +
                  '<span class="block text-[11px] font-semibold uppercase text-slate-400 tracking-wider">Session Inclusions</span>' +
                  '<div class="grid grid-cols-1 gap-2.5 text-xs text-slate-300">' +
                    '<div class="flex items-center gap-2">' +
                      '<svg class="w-3.5 h-3.5 text-neon-lime shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clip-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill-rule="evenodd"></path></svg>' +
                      '<span>Automated Smart LED Floodlight System</span>' +
                    '</div>' +
                    '<div class="flex items-center gap-2">' +
                      '<svg class="w-3.5 h-3.5 text-neon-lime shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clip-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill-rule="evenodd"></path></svg>' +
                      '<span>Gate access QR available on confirmation</span>' +
                    '</div>' +
                    '<div class="flex items-center gap-2">' +
                      '<svg class="w-3.5 h-3.5 text-neon-lime shrink-0" fill="currentColor" viewBox="0 0 20 20"><path clip-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill-rule="evenodd"></path></svg>' +
                      '<span>Franklin X-40 loaner balls available</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +

                '<div class="py-5 space-y-2.5 text-xs">' +
                  '<div class="flex justify-between text-slate-400">' +
                    '<span id="summary-fee-label">Court Booking Fee</span>' +
                    '<span id="summary-court-fee" class="font-mono text-slate-200">PHP 0.00</span>' +
                  '</div>' +
                  '<div class="flex justify-between text-slate-400">' +
                    '<span>Night Lighting Surcharge</span>' +
                    '<span class="font-mono text-emerald-400">PHP 0.00 (Free)</span>' +
                  '</div>' +
                  '<div class="flex justify-between text-slate-400">' +
                    '<span>Booking Processing Fee</span>' +
                    '<span class="font-mono text-emerald-400">PHP 0.00</span>' +
                  '</div>' +
                  '<div class="mt-1 pt-4 border-t border-white/10 flex items-baseline justify-between">' +
                    '<div>' +
                      '<span class="text-sm font-bold text-white">Total Amount</span>' +
                      '<p class="text-[10px] text-slate-400 m-0">All local taxes included</p>' +
                    '</div>' +
                    '<span id="summary-total-amount" class="text-2xl font-black text-neon-lime font-mono">PHP 0.00</span>' +
                  '</div>' +
                '</div>' +

                '<div class="space-y-4">' +
                  '<button id="reserve-sidebar" type="button" class="w-full py-4 px-6 rounded-xl bg-neon-lime text-carbon-950 hover:bg-neon-glow font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-neon transition-all hover:scale-[1.02] active:scale-[0.98] border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none" disabled>' +
                    '<svg class="w-4 h-4 text-carbon-950" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '<span data-reserve-label>Confirm &amp; Pay</span>' +
                  '</button>' +
                  '<div class="p-3.5 rounded-lg bg-carbon-800/60 border border-white/5 flex items-start gap-2.5 leading-relaxed text-[11px] text-slate-300">' +
                    '<svg class="w-4 h-4 text-neon-lime shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '<span><strong>Booking policy:</strong> No cancellations. Payments are non-refundable, except when weather prevents play.</span>' +
                  '</div>' +
                '</div>' +

                '<div class="mt-6 pt-5 border-t border-white/10 text-center">' +
                  '<span class="text-[10px] uppercase font-mono tracking-widest text-slate-400 block mb-3">Supported Payment Channels</span>' +
                  '<div class="flex items-center justify-center flex-wrap gap-2 text-xs font-mono text-slate-400">' +
                    '<span class="px-2 py-1 rounded bg-carbon-800 border border-white/5 text-[11px] text-slate-300">GCash</span>' +
                    '<span class="px-2 py-1 rounded bg-carbon-800 border border-white/5 text-[11px] text-slate-300">Maya</span>' +
                    '<span class="px-2 py-1 rounded bg-carbon-800 border border-white/5 text-[11px] text-slate-300">Visa / Mastercard</span>' +
                    '<span class="px-2 py-1 rounded bg-carbon-800 border border-white/5 text-[11px] text-neon-lime">Court Credits</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +

            '</aside>' +
          '</div>' +
          '</div><!-- /booking-step1-2-wrapper -->' +
          '<div id="booking-step3-wrapper" class="w-full relative" hidden></div>' +
        '</main>' +
      '</div>';
    if (D.mountPublicBackdrop) D.mountPublicBackdrop(q("#ds-book-page", root));


    function drawCourtCards() {
      var box = q("#courtcards", root);
      if (!box) return;
      box.innerHTML = courts.map(function (c) {
        var isSelected = S.court && S.court.id === c.id;
        var lo = Number(c.rate_min != null ? c.rate_min : c.hourly_rate);
        var hi = Number(c.rate_max != null ? c.rate_max : lo);
        var rateStr = "PHP " + lo.toFixed(2) + (hi > lo ? " – " + hi.toFixed(2) : "") + "/hr";
        return '<label class="court-card relative block p-4 rounded-xl cursor-pointer transition-all ' +
          (isSelected ? "bg-carbon-850/95 border-2 border-neon-lime shadow-neon" : "bg-carbon-800/40 hover:bg-carbon-800/70 border border-white/10 hover:border-white/20") + '" data-c="' + esc(c.id) + '">' +
          '<input type="radio" name="selected_court" class="sr-only" value="' + esc(c.id) + '"' + (isSelected ? " checked" : "") + '/>' +
          '<div class="flex items-center justify-between mb-2">' +
            (isSelected
              ? '<span class="text-xs font-mono uppercase tracking-wider text-neon-lime font-bold">Selected</span><div class="w-5 h-5 rounded-full bg-neon-lime flex items-center justify-center text-carbon-950 text-xs font-black">✓</div>'
              : '<span class="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">Available</span><span class="w-4 h-4 rounded-full border border-slate-600 flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-transparent"></span></span>') +
          '</div>' +
          '<h3 class="text-base font-bold text-white mb-0.5 m-0">' + esc(c.name) + '</h3>' +
          '<p class="text-xs text-slate-300 mb-3 m-0">' + (c.is_indoor ? "Indoor" : "Outdoor") + ' – ' + '<span class="court-price">' + esc(rateStr) + '</span></p>' +
          '<div class="space-y-1.5 pt-2.5 border-t border-white/10 text-[11px] text-slate-400">' +
            '<div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ' + (isSelected ? "bg-emerald-400" : "bg-slate-500") + '"></span><span>' + esc(c.surface || "Silica Cushion Surface") + '</span></div>' +
          '</div>' +
        '</label>';
      }).join("");

      Array.prototype.forEach.call(box.querySelectorAll(".court-card"), function (card) {
        card.onclick = function (e) {
          e.preventDefault();
          var id = card.getAttribute("data-c");
          if (id) pickCourt(id);
        };
      });
    }

    function drawQuickDays() {
      var box = q("#quick-days", root);
      if (!box) return;
      var today = dayStr(tz);
      var maxDays = Math.min(S.bookingDays || 14, 7);
      var html = [];
      for (var i = 0; i < maxDays; i++) {
        var ymd = addDays(today, i);
        var dateObj = new Date(ymd + "T12:00:00Z");
        var dayName = dateObj.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
        var monthDay = dateObj.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
        var label = dayName + ", " + monthDay;
        var active = ymd === S.date;
        html.push(
          '<button type="button" class="quick-day-btn px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ' +
          (active ? "bg-neon-lime/10 border border-neon-lime/30 text-neon-lime font-bold shadow-sm" : "bg-carbon-800 border border-white/5 text-slate-300 hover:text-white hover:bg-carbon-700") +
          '" data-today="' + (i === 0) + '" aria-pressed="' + active + '" data-date="' + ymd + '">' + esc(label) + '</button>'
        );
      }
      box.innerHTML = html.join("");
      Array.prototype.forEach.call(box.querySelectorAll(".quick-day-btn"), function (btn) {
        btn.onclick = function () {
          var selectedDate = btn.getAttribute("data-date");
          if (selectedDate && selectedDate !== S.date) {
            S.date = selectedDate;
            var bd = q("#bd", root);
            if (bd) bd.value = selectedDate;
            drawQuickDays();
            drawSlots();
          }
        };
      });
    }

    function pickCourt(id) {
      S.court = courts.filter(function (c) { return c.id === id; })[0];
      if (!S.court) return;
      drawCourtCards();
      q("#slotpanel", root).hidden = false;
      q("#paypanel", root).hidden = true;

      var assignedEl = q("#summary-court-assigned", root);
      if (assignedEl) {
        assignedEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-neon-lime"></span><span>' +
          esc(S.court.name) + ' (' + esc(S.court.surface || "Silica Sand") + ' ' + (S.court.is_indoor ? "Indoor" : "Outdoor") + ')</span>';
      }

      sb.rpc("get_booking_info", { p_court_id: id }).then(function (r) {
        if (r.error) return msg(q("#slotpanel", root), nice(r.error), "err");
        S.info = r.data;
        S.bookingDays = r.data.booking_window_days || 14;
        var step = S.court.slot_minutes, mn = Math.max(1, Math.ceil(r.data.min_hours * 60 / step)), mx = Math.max(mn, Math.floor(r.data.max_hours * 60 / step));
        var opts = "";
        for (var n = mn; n <= mx; n++) {
          var hrsVal = (n * step / 60);
          var hrSuffix = hrsVal === 1 ? "1 hour" : (hrsVal + " hours");
          if (hrsVal === 2) hrSuffix += " (Popular for doubles)";
          else if (hrsVal === 3) hrSuffix += " (Mini Tournament)";
          opts += '<option value="' + n + '">' + esc(hrSuffix) + '</option>';
        }
        var bn = q("#bn", root);
        if (bn) bn.innerHTML = opts;
        S.count = mn;
        S.start = null;
        var pl = +pre.get("len");
        if (pl && pl % step === 0 && pl / step >= mn && pl / step <= mx) {
          S.count = pl / step;
          if (bn) bn.value = String(S.count);
        }
        pre.delete("len");

        var today = dayStr(tz), last = addDays(today, S.bookingDays);
        var pd = pre.get("date"); pre.delete("date");
        if (pd && pd >= today && pd <= last) S.date = pd;
        else if (!S.date || S.date < today) S.date = today;

        var bd = q("#bd", root);
        if (bd) { bd.min = today; bd.max = last; bd.value = S.date; }
        drawQuickDays();
        drawSlots();
      });
    }

    async function drawSlots() {
      if (S.reserving) return;
      var c = S.court, step = c.slot_minutes, box = q("#slots", root);
      if (!c || !box) return;
      box.innerHTML = '<div class="col-span-full grid grid-cols-2 sm:grid-cols-4 gap-2.5">' + Array(8).fill('<div class="h-16 rounded-xl bg-carbon-850/60 ds-skeleton border border-white/5"></div>').join('') + '</div>';
      S.start = null;
      summary();
      var startM = toMin(hhmm(c.open_time)), endM = closeMin(c), slots = [];
      for (var m = startM; m + step <= endM; m += step) {
        var s = zonedToUtc(S.date + "T" + pad(Math.floor(m / 60)) + ":" + pad(m % 60), tz);
        slots.push({ s: s, e: new Date(s.getTime() + step * 60000), m: m });
      }
      if (!slots.length) {
        box.innerHTML = '<p class="text-xs text-slate-400 col-span-full py-4 text-center">No available time slots on this date.</p>';
        return;
      }
      await attachRates(c, S.date, slots);
      var av = await sb.rpc("court_availability", { p_court_id: c.id, p_from: slots[0].s.toISOString(), p_to: slots[slots.length - 1].e.toISOString() });
      var taken = (av.data || []).map(function (r) { return [new Date(r.starts_at), new Date(r.ends_at)]; });
      var now = Date.now();
      var freeCount = 0;
      slots.forEach(function (x) {
        x.off = x.s.getTime() <= now || taken.some(function (t) { return t[0] < x.e && t[1] > x.s; });
        if (!x.off) freeCount++;
      });
      var liveInd = q("#book-live-slots", root);
      if (liveInd) liveInd.textContent = "Live Availability: " + freeCount + " slots open on " + S.date;

      S.slots = slots;
      paint();

      var pm = pre.get("start");
      if (pm != null && pre.get("court") === c.id) {
        pre.delete("start");
        var pi = -1;
        slots.forEach(function (x, i) { if (x.m === +pm) pi = i; });
        if (pi >= 0 && rangeOk(pi)) { S.start = pi; paint(); summary(); }
      }
    }

    function rangeOk(i) {
      if (i == null || i + S.count > S.slots.length) return false;
      for (var k = i; k < i + S.count; k++) if (S.slots[k].off) return false;
      return true;
    }

    function paint() {
      var box = q("#slots", root);
      if (!box) return;
      box.innerHTML = S.slots.map(function (x, i) {
        var inRange = S.start != null && i >= S.start && i < S.start + S.count;
        var isPeak = S.court && S.court.rate_max != null && x.rate != null && Number(x.rate) >= Number(S.court.rate_max) && Number(S.court.rate_max) > Number(S.court.rate_min);
        var rateNum = Math.round(x.rate != null ? x.rate : S.court.hourly_rate);
        var timeStr = esc(timeOf(x.s, tz));

        if (x.off) {
          return '<button type="button" class="slot-pill p-3 rounded-xl bg-carbon-950/70 border border-white/5 text-slate-600 cursor-not-allowed opacity-55 text-center" disabled>' +
            '<div class="text-xs font-semibold line-through">' + timeStr + '</div>' +
            '<div class="text-[11px] font-mono text-slate-600">' + '&#8369;' + rateNum + '</div>' +
          '</button>';
        }
        if (inRange) {
          return '<button type="button" aria-pressed="true" class="slot-pill p-3 rounded-xl bg-neon-lime text-carbon-950 font-bold border-2 border-neon-glow shadow-neon text-center transform scale-[1.02] ring-2 ring-neon-lime/30 cursor-pointer" data-i="' + i + '">' +
            '<div class="text-xs font-black tracking-tight text-carbon-950">' + timeStr + '</div>' +
            '<div class="text-[11px] font-mono font-bold text-carbon-900">' + '&#8369;' + rateNum + '</div>' +
          '</button>';
        }
        return '<button type="button" class="slot-pill p-3 rounded-xl bg-carbon-850 hover:bg-carbon-700/80 border border-white/10 hover:border-slate-500 text-slate-200 text-center group cursor-pointer" data-i="' + i + '">' +
          '<div class="text-xs font-semibold group-hover:text-white">' + timeStr + '</div>' +
          '<div class="text-[11px] font-mono ' + (isPeak ? "text-amber-400 group-hover:text-neon-lime font-bold" : "text-slate-400 group-hover:text-neon-lime") + '">' + '&#8369;' + rateNum + '</div>' +
        '</button>';
      }).join("");

      Array.prototype.forEach.call(box.querySelectorAll(".slot-pill:not([disabled])"), function (b) {
        b.onclick = function () {
          var i = +b.getAttribute("data-i");
          S.start = i;
          paint();
          summary();
          if (!rangeOk(i)) msg(q("#slotpanel", root), "Not enough consecutive free slots from here for that duration. Try another start time or shorter duration.", "err");
          else msg(q("#slotpanel", root), "", "");
        };
      });
    }

    function summary() {
      if (S.reserving) return;
      var banner = q("#slot-banner", root);
      var btn1 = q("#reserve", root);
      var btn2 = q("#reserve-sidebar", root);
      var timeSidebar = q("#summary-time", root);
      var dateSidebar = q("#summary-date", root);
      var feeSidebar = q("#summary-court-fee", root);
      var totalSidebar = q("#summary-total-amount", root);

      if (S.start == null || !rangeOk(S.start)) {
        if (banner) banner.hidden = true;
        if (btn1) btn1.disabled = true;
        if (btn2) { btn2.disabled = true; setReserveLabel(btn2, "Confirm & Pay"); }
        if (timeSidebar) timeSidebar.textContent = "Select a time slot";
        if (feeSidebar) feeSidebar.textContent = "PHP 0.00";
        if (totalSidebar) totalSidebar.textContent = "PHP 0.00";
        return;
      }
      var first = S.slots[S.start], last = S.slots[S.start + S.count - 1];
      var hrs = S.count * S.court.slot_minutes / 60;
      var total = slotsTotal(S.slots, S.start, S.count, S.court.slot_minutes);
      var formattedRange = range(first.s, last.e, tz);
      var timeWindowStr = timeOf(first.s, tz) + " – " + timeOf(last.e, tz) + " (" + hrs + " hr" + (hrs === 1 ? "" : "s") + ")";

      if (banner) {
        banner.hidden = false;
        var timeEl = q("#banner-selection-time", banner);
        if (timeEl) timeEl.innerHTML = esc(formattedRange) + ' <span class="text-neon-lime font-mono font-medium">• ' + hrs + ' h</span>';
        var rateEl = q("#banner-selection-rate", banner);
        if (rateEl) {
          rateEl.textContent = "Rate: PHP " + Number(first.rate != null ? first.rate : S.court.hourly_rate).toFixed(2) + " / hour" +
            (S.court.rate_max && first.rate >= S.court.rate_max ? " (Peak Evening Slot)" : "");
        }
        var dueEl = q("#banner-total-due", banner);
        if (dueEl) dueEl.textContent = money(total);
      }
      if (btn1) btn1.disabled = false;
      if (btn2) {
        btn2.disabled = false;
        setReserveLabel(btn2, "Confirm & Pay " + money(total));
      }
      if (timeSidebar) timeSidebar.textContent = timeWindowStr;
      if (dateSidebar) dateSidebar.textContent = first.s.toLocaleDateString("en-PH", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" });
      if (feeSidebar) feeSidebar.textContent = money(total);
      if (totalSidebar) totalSidebar.textContent = money(total);
    }

    async function doReserve() {
      if (S.reserving || S.start == null || !rangeOk(S.start)) return;
      S.reserving = true;
      var first = S.slots[S.start], last = S.slots[S.start + S.count - 1];
      var sig = S.court.id + "|" + first.s.toISOString() + "|" + last.e.toISOString();
      keys[sig] = keys[sig] || uuid();
      var btn1 = q("#reserve", root), btn2 = q("#reserve-sidebar", root);
      if (btn1) btn1.disabled = true;
      if (btn2) btn2.disabled = true;
      msg(q("#slotpanel", root), "", "");
      if (btn1) btn1.textContent = "Holding slot...";
      if (btn2) setReserveLabel(btn2, "Holding slot...");
      var r;
      try { r = await sb.rpc("create_booking", {
        p_court_id: S.court.id,
        p_starts_at: first.s.toISOString(),
        p_ends_at: last.e.toISOString(),
        p_idempotency_key: keys[sig]
      }); } catch (error) { r = { error: error }; }
      if (r.error) {
        S.reserving = false;
        if (btn1) btn1.textContent = "Reserve this slot";
        if (btn2) setReserveLabel(btn2, "Confirm & Pay");
        msg(q("#slotpanel", root), nice(r.error), "err");
        if (/slot_taken|slot_blocked/.test(r.error.message || "")) drawSlots();
        else { if (btn1) btn1.disabled = false; if (btn2) btn2.disabled = false; }
        return;
      }
      var b = r.data;
      var checkoutParams = new URLSearchParams();
      checkoutParams.set("booking", b.id);
      history.replaceState(null, "", location.pathname + location.search + "#/c/" + slug + "/book?" + checkoutParams.toString());
      var step12 = q("#booking-step1-2-wrapper", root);
      if (step12) step12.hidden = true;
      var step3 = q("#booking-step3-wrapper", root);
      if (step3) {
        step3.hidden = false;
        payPanel(step3, b, {
          club: club,
          court: S.court,
          onDone: function () {
            if (btn2) btn2.parentElement.innerHTML = '<p class="text-xs text-emerald-400 font-semibold text-center">Proof uploaded. View status in <a class="underline text-neon-lime" href="#/me">My Bookings</a></p>';
          },
          onBack: function () {
            S.reserving = false;
            history.replaceState(null, "", location.pathname + location.search + "#/c/" + slug + "/book");
            step3.hidden = true;
            if (step12) step12.hidden = false;
            drawSlots();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    var bd = q("#bd", root);
    if (bd) bd.onchange = function () { S.date = this.value; if (S.date) { drawQuickDays(); drawSlots(); } };
    var bn = q("#bn", root);
    if (bn) bn.onchange = function () { S.count = +this.value; paint(); summary(); };
    var reserveBtn = q("#reserve", root);
    if (reserveBtn) reserveBtn.onclick = doReserve;
    var reserveSidebarBtn = q("#reserve-sidebar", root);
    if (reserveSidebarBtn) reserveSidebarBtn.onclick = doReserve;

    drawCourtCards();
    var pendingBookingId = pre.get("booking");
    var pc = pre.get("court");
    if (!pendingBookingId && pc && courts.some(function (c) { return c.id === pc; })) pickCourt(pc);
    else if (!pendingBookingId && courts.length > 0) pickCourt(courts[0].id);
    if (pendingBookingId) {
      var bkRes = await sb.from("bookings").select("*").eq("id", pendingBookingId).eq("tenant_id", club.id).eq("player_id", me.id).maybeSingle();
      if (bkRes.error || !bkRes.data) {
        root.innerHTML = '<div class="max-w-xl mx-auto py-12 text-center"><h2>Unable to restore checkout</h2><p>Your reservation could not be loaded. Open My Bookings to check its status.</p><a class="btn" href="#/me/bookings">My Bookings</a></div>';
        return;
      }
      if (bkRes.data) {
        var step12 = q("#booking-step1-2-wrapper", root);
        if (step12) step12.hidden = true;
        var step3 = q("#booking-step3-wrapper", root);
        if (step3) {
          step3.hidden = false;
          payPanel(step3, bkRes.data, {
            club: club,
            court: courts.find(function(c) { return c.id === bkRes.data.court_id; }),
            onBack: function () {
              history.replaceState(null, "", location.pathname + location.search + "#/c/" + slug + "/book");
              if (!S.court && courts.length) pickCourt(courts[0].id);
              step3.hidden = true;
              if (step12) step12.hidden = false;
              drawSlots();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          });
        }
      }
    }
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
        if (b.status === "pending" && pay) note = "Proof sent" + (pay.payer_reference ? " (ref " + esc(pay.payer_reference) + ")" : "") + ". Waiting for the club to approve.";
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

  // ============================================ booking ticket QR (round dots, logo in the centre)
  // Error correction level H lets about 30% of the code be damaged, so a logo covering ~6% of the area is safe.
  // The modules under the logo are left out (never half hidden) and the code is checked with a real scanner (docs/ticket-qr.md).
  var qrLogoData = null;
  async function loadQrLogo() {
    if (qrLogoData !== null) return qrLogoData;
    try {
      var r = await fetch("assets/icons/qr-logo.png");
      if (!r.ok) throw new Error("logo");
      var blob = await r.blob();
      qrLogoData = await new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = function () { res(""); }; fr.readAsDataURL(blob); });
    } catch (e) { qrLogoData = ""; } // no logo: a plain dot is drawn instead, the code still works
    return qrLogoData;
  }
  function bookingQrSvg(text, logo) {
    var code = window.qrcode(3, "H"); code.addData(text); code.make();
    var count = code.getModuleCount(), quiet = 4, size = count + quiet * 2, c = size / 2;
    var holeW = 3, holeH = 2; // modules left out each side of the centre: a 7 x 5 block, just big enough for the logo
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + size + " " + size +
      '" role="img" aria-label="Booking QR code"><rect width="100%" height="100%" fill="white"/><g fill="black">';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (!code.isDark(row, col)) continue;
        if ((row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7)) continue; // drawn below as rounded squares
        var x = col + quiet + 0.5, y = row + quiet + 0.5;
        if (Math.abs(x - c) <= holeW && Math.abs(y - c) <= holeH) continue; // room for the logo
        // soft rounded squares: nearly dots, but large enough that scanners read them (small round dots do not scan)
        svg += '<rect x="' + (x - 0.47) + '" y="' + (y - 0.47) + '" width="0.94" height="0.94" rx="0.3"/>';
      }
    }
    [[quiet, quiet], [quiet + count - 7, quiet], [quiet, quiet + count - 7]].forEach(function (pt) {
      svg += '<rect x="' + pt[0] + '" y="' + pt[1] + '" width="7" height="7" rx="1.2"/>' +
        '<rect x="' + (pt[0] + 1) + '" y="' + (pt[1] + 1) + '" width="5" height="5" rx="0.6" fill="white"/>' +
        '<rect x="' + (pt[0] + 2) + '" y="' + (pt[1] + 2) + '" width="3" height="3" rx="0.4"/>';
    });
    svg += "</g>";
    // logo: a plain white block exactly as big as the cleared modules (no border), the DINKSLOT logo inside it
    svg += '<rect x="' + (c - holeW - 0.5) + '" y="' + (c - holeH - 0.5) + '" width="' + (holeW * 2 + 1) + '" height="' + (holeH * 2 + 1) + '" rx="1" fill="white"/>';
    if (logo) {
      var half = 3; // logo is 6 modules wide (about 4 tall): a small, tidy mark
      svg += '<image x="' + (c - half) + '" y="' + (c - half) + '" width="' + half * 2 + '" height="' + half * 2 + '" preserveAspectRatio="xMidYMid meet" href="' + logo + '" xlink:href="' + logo + '"/>';
    } else {
      svg += '<circle cx="' + c + '" cy="' + c + '" r="1.6" fill="black"/>';
    }
    return svg + "</svg>";
  }
  window.__dsQr = { svg: bookingQrSvg, logo: loadQrLogo }; // used by the scan test

  // ==================================================== club approval queue
  async function openPass(booking, court, t, player, button) {
    if (!booking || !booking.reference_code) return D.ui.toast('The booking reference is unavailable.', 'err');
    button = button || document.activeElement;
          var logo = await loadQrLogo();
          player = player || {}; court = court || {}; t = t || {};
          var tz = t.timezone || 'Asia/Manila';
          var playerName = player.display_name || booking.guest_name || 'Guest';
          var courtName = court.name || 'Court';
          var courtSurface = court.is_indoor === true ? 'Indoor' : court.is_indoor === false ? 'Outdoor' : 'Court type unavailable';
          var clubName = t.name || 'DINKSLOT Club';
          var refCode = booking.reference_code || '';
          var sDate = new Date(booking.starts_at), eDate = new Date(booking.ends_at);
          var dateLabel = sDate.toLocaleDateString('en-PH', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
          var timeRange = timeOf(sDate, tz) + ' \u2013 ' + timeOf(eDate, tz);
          var durationMins = Math.round((eDate - sDate) / (60 * 1000)) || 60;
          var pinDigits = refCode.replace(/\D/g, '');
          var gatePin = '#' + (pinDigits.length >= 4 ? pinDigits.slice(-4) : (refCode.slice(-4) || '4829'));
          var lightDate = new Date(sDate.getTime() - 10 * 60 * 1000);
          var lightsLabel = 'Auto ' + timeOf(lightDate, tz);

          var ticket = document.createElement('dialog');
          ticket.className = 'booking-ticket-modal';
          ticket.setAttribute('aria-label', 'Booking QR Pass');

          ticket.innerHTML =
            '<div class="relative bg-[#121822]/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-modal-elevated overflow-hidden transition-all duration-300 text-slate-100 max-w-md w-full">' +
              '<div class="h-1.5 w-full bg-gradient-to-r from-brand-lime via-emerald-400 to-cyan-400"></div>' +
              '<header class="p-5 sm:p-6 pb-4">' +
                '<div class="flex items-center justify-between gap-2">' +
                  '<div class="flex items-center gap-2">' +
                    '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-brand-lime/10 text-brand-lime border border-brand-lime/20">' +
                      '<span class="w-2 h-2 rounded-full bg-brand-lime animate-pulse"></span>Confirmed Pass' +
                    '</span>' +
                    '<span class="text-xs text-slate-400 hidden sm:inline-block">• ' + esc(clubName) + '</span>' +
                  '</div>' +
                  '<button aria-label="Close ticket dialog" class="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-white/5 cursor-pointer" data-close type="button">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>' +
                  '</button>' +
                '</div>' +
                '<div class="mt-4 text-center">' +
                  '<div class="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">' +
                    '<svg class="w-3.5 h-3.5 text-brand-lime" fill="currentColor" viewBox="0 0 24 24">' +
                      '<circle cx="12" cy="12" fill="none" r="10" stroke="currentColor" stroke-width="2"></circle>' +
                      '<circle cx="9" cy="9" r="1.5"></circle><circle cx="15" cy="9" r="1.5"></circle>' +
                      '<circle cx="12" cy="12" r="1.5"></circle><circle cx="9" cy="15" r="1.5"></circle><circle cx="15" cy="15" r="1.5"></circle>' +
                    '</svg>' +
                    'Single Court Reservation' +
                  '</div>' +
                  '<h1 class="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight ticket-player-name">' + esc(playerName) + '</h1>' +
                  '<div class="inline-flex items-center gap-2 mt-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs sm:text-sm font-medium text-slate-200">' +
                    '<span class="text-brand-lime font-bold">' + esc(courtName) + '</span>' +
                    '<span class="text-slate-600">|</span>' +
                    '<span>' + esc(courtSurface) + '</span>' +
                    '<span class="text-slate-600">•</span>' +
                    '<span class="text-slate-400">' + esc(clubName) + '</span>' +
                  '</div>' +
                '</div>' +
              '</header>' +

              '<section class="px-5 sm:px-6 py-2">' +
                '<div class="ticket-white-frame bg-white rounded-2xl p-4 shadow-2xl flex flex-col items-center justify-center relative group">' +
                  '<div class="ticket-qr relative w-full aspect-square flex items-center justify-center"></div>' +
                  '<div class="w-full mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">' +
                    '<span class="flex items-center gap-1">' +
                      '<svg class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                      'Auto-Scanner Ready' +
                    '</span>' +
                    '<span class="font-mono text-slate-400">Turn brightness up</span>' +
                  '</div>' +
                '</div>' +
              '</section>' +

              '<section class="px-5 sm:px-6 pt-4 pb-2 text-center">' +
                '<div class="inline-flex items-center justify-center gap-2 bg-slate-900/90 border border-brand-lime/30 px-3.5 py-1.5 rounded-xl shadow-inner cursor-pointer hover:border-brand-lime transition-all" data-copy-ref title="Click to copy">' +
                  '<span class="text-xs uppercase font-mono tracking-wider text-slate-400">Ref:</span>' +
                  '<span class="text-brand-lime font-mono font-bold tracking-widest text-base sm:text-lg ticket-reference">' + esc(refCode) + '</span>' +
                  '<svg class="w-4 h-4 text-brand-lime/80 hover:text-brand-lime transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                '</div>' +
                '<div class="mt-3 flex items-center justify-center gap-2 text-sm sm:text-base font-semibold text-white">' +
                  '<svg class="w-4 h-4 text-brand-lime" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '<span>' + esc(dateLabel) + '</span>' +
                  '<span class="text-slate-500">•</span>' +
                  '<span class="text-brand-lime">' + esc(timeRange) + '</span>' +
                '</div>' +
              '</section>' +

              '<div class="relative flex items-center my-4">' +
                '<div aria-hidden="true" class="ticket-notch-left"></div>' +
                '<div aria-hidden="true" class="ticket-notch-right"></div>' +
                '<div class="w-full border-t border-dashed border-white/15 mx-4"></div>' +
              '</div>' +

              '<div class="px-6 py-3 text-center">' +
                '<p class="text-[11px] leading-relaxed text-slate-400">Scan at court scanner or reception totem to check in and initialize smart net cams. Hold QR 10cm from optical glass.</p>' +
              '</div>' +

              '<footer class="p-5 sm:p-6 pt-2 bg-slate-950/40 border-t border-white/5 flex flex-col sm:flex-row items-center gap-2.5">' +
                '<button class="w-full sm:flex-1 py-3 px-4 rounded-xl bg-brand-lime hover:bg-brand-limeHover active:scale-[0.98] text-slate-950 font-display font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-neon-lime cursor-pointer" data-download type="button">' +
                  '<svg class="w-4 h-4 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
                  'Download QR' +
                '</button>' +
                '<button class="w-full sm:w-auto px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.98] text-white border border-white/10 text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer" data-share type="button">' +
                  '<svg class="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  'Share' +
                '</button>' +
                '<button class="w-full sm:w-auto px-3.5 py-3 rounded-xl bg-transparent hover:bg-white/5 text-slate-400 hover:text-slate-200 text-sm font-medium transition-colors cursor-pointer" data-close type="button">Close</button>' +
              '</footer>' +

              '<div class="opacity-0 transition-opacity duration-300 absolute bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 border border-brand-lime/40 text-brand-lime text-xs font-mono font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none z-50 whitespace-nowrap" id="pass-toast"></div>' +
            '</div>';

          var svg = bookingQrSvg(refCode, logo);
          ticket.querySelector('.ticket-qr').innerHTML = svg;

          function showToast(text) {
            var tBox = ticket.querySelector('#pass-toast');
            if (!tBox) return;
            tBox.textContent = text;
            tBox.classList.remove('opacity-0');
            clearTimeout(tBox._tm);
            tBox._tm = setTimeout(function () { tBox.classList.add('opacity-0'); }, 2200);
          }

          ticket.querySelectorAll('[data-close]').forEach(function (btn) {
            btn.onclick = function () { ticket.close(); };
          });

          ticket.onclick = function (e) {
            if (e.target === ticket) ticket.close();
          };

          var copyBtn = ticket.querySelector('[data-copy-ref]');
          if (copyBtn) {
            copyBtn.onclick = function () {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(refCode);
              }
              showToast('Reference code copied: ' + refCode);
            };
          }

          var shareBtn = ticket.querySelector('[data-share]');
          if (shareBtn) {
            shareBtn.onclick = async function () {
              var shareData = {
                title: 'DINKSLOT Booking Pass - ' + playerName,
                text: 'Court Booking Pass: ' + courtName + ' on ' + dateLabel + ' (' + timeRange + '). Ref: ' + refCode,
                url: window.location.href
              };
              if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
                try { await navigator.share(shareData); } catch (_) {}
              } else {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(refCode);
                }
                showToast('Booking details copied to clipboard!');
              }
            };
          }

          // Download = the pass as shown on screen (status, name, court, QR, ref, date) drawn to a PNG: no buttons, footer or instructions.
          function passPng() {
            return new Promise(function (resolve, reject) {
              var W = 720, H = 1030, k = 2, pad = 40;
              var cv = document.createElement('canvas'); cv.width = W * k; cv.height = H * k;
              var c = cv.getContext('2d'); c.scale(k, k);
              function rr(x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
              var sans = '"Segoe UI", Inter, Arial, sans-serif', mono = 'Consolas, "Courier New", monospace', LIME = '#a3e635';
              // text parts on one line, centred on cy; the vertical position comes from the glyph box so it is truly centred
              function line(parts, cy) {
                var w = 0; parts.forEach(function (p) { c.font = p.f; p.w = c.measureText(p.t).width; w += p.w; });
                c.textAlign = 'left'; c.textBaseline = 'alphabetic';
                var x = (W - w) / 2;
                parts.forEach(function (p) {
                  c.font = p.f; var m = c.measureText(p.t);
                  c.fillStyle = p.c; c.fillText(p.t, x, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + (p.dy || 0)); x += p.w;
                });
                return w;
              }
              function pill(parts, cy, fill, stroke, h) {
                var w = 0; parts.forEach(function (p) { c.font = p.f; w += c.measureText(p.t).width; });
                var bw = w + 48; rr((W - bw) / 2, cy - h / 2, bw, h, h / 2.6); c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke();
                line(parts, cy);
              }
              var img = new Image();
              img.onload = function () {
                var bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#151c28'); bg.addColorStop(1, '#0d121b');
                rr(0, 0, W, H, 40); c.fillStyle = bg; c.fill();
                var bar = c.createLinearGradient(0, 0, W, 0); bar.addColorStop(0, LIME); bar.addColorStop(0.5, '#34d399'); bar.addColorStop(1, '#22d3ee');
                c.save(); rr(0, 0, W, H, 40); c.clip(); c.fillStyle = bar; c.fillRect(0, 0, W, 8); c.restore();
                pill([{ t: 'CONFIRMED PASS', f: '700 20px ' + sans, c: LIME }], 66, 'rgba(163,230,53,.10)', 'rgba(163,230,53,.40)', 46);
                c.beginPath(); c.arc(W / 2 - c.measureText('CONFIRMED PASS').width / 2 - 16, 66, 5, 0, 7); c.fillStyle = LIME; c.fill();
                line([{ t: 'SINGLE COURT RESERVATION', f: '500 17px ' + mono, c: '#94a3b8' }], 126);
                var nm = playerName, size = 48; c.font = '700 ' + size + 'px ' + sans;
                while (c.measureText(nm).width > W - pad * 2 && size > 24) { size -= 2; c.font = '700 ' + size + 'px ' + sans; }
                line([{ t: nm, f: '700 ' + size + 'px ' + sans, c: '#ffffff' }], 182);
                pill([{ t: courtName, f: '700 22px ' + sans, c: LIME }, { t: '   |   ', f: '400 22px ' + sans, c: '#475569' }, { t: courtSurface, f: '500 22px ' + sans, c: '#e2e8f0' }, { t: '   \u2022   ', f: '400 22px ' + sans, c: '#475569' }, { t: clubName, f: '500 22px ' + sans, c: '#94a3b8' }], 242, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.12)', 54);
                var fw = 560, fx = (W - fw) / 2, fy = 296;
                rr(fx, fy, fw, fw, 32); c.fillStyle = '#fff'; c.fill();
                c.drawImage(img, fx + 22, fy + 22, fw - 44, fw - 44);
                var ry = fy + fw + 56;
                pill([{ t: 'REF:  ', f: '500 20px ' + mono, c: '#94a3b8' }, { t: refCode, f: '700 32px ' + mono, c: LIME }], ry, '#0f172a', 'rgba(163,230,53,.45)', 62);
                line([{ t: dateLabel, f: '700 28px ' + sans, c: '#ffffff' }, { t: '   \u2022   ', f: '700 28px ' + sans, c: '#64748b' }, { t: timeRange, f: '700 28px ' + sans, c: LIME }], ry + 74);
                cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('png')); }, 'image/png');
              };
              img.onerror = function () { reject(new Error('qr image')); };
              img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.indexOf('xmlns') < 0 ? svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') : svg);
            });
          }
          ticket.querySelector('[data-download]').onclick = async function () {
            try {
              await document.fonts.ready;
              var blob = await passPng(), url = URL.createObjectURL(blob), link = document.createElement('a');
              link.href = url; link.download = 'booking-' + (refCode || 'pass') + '.png'; link.click();
              setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
              D.ui.toast('Your booking ticket has been downloaded.', 'ok');
            } catch (e) { D.ui.toast('Unable to download the booking ticket. Please try again.', 'err'); }
          };

          ticket.addEventListener('close', function () { ticket.remove(); if (button.isConnected) button.focus(); }, { once: true });
          document.body.appendChild(ticket); ticket.showModal();
  }

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
      // Keep unpaid reservations visible until payment or a final status change.
      var bookingsResult = await sb.from("bookings").select("*").eq("tenant_id", t.id)
        .in("status", ["pending", "approved"]).order("starts_at");
      if (bookingsResult.error) {
        box.innerHTML = '<div class="booking-queue-error" role="alert"><h3>Unable to load reservations</h3><p>' + esc(nice(bookingsResult.error)) + '</p><button type="button" class="btn ghost" data-retry-queue>Retry</button></div>';
        box.querySelector("[data-retry-queue]").onclick = load;
        return;
      }
      var bs = bookingsResult.data || [];
      var players = (await sb.from("club_players").select("id,display_name,phone").eq("tenant_id", t.id)).data || [];
      var courts = (await sb.from("courts").select("id,name,is_indoor").eq("tenant_id", t.id)).data || [];
      var paymentResult = bs.length ? await sb.from("booking_payments").select("*").eq("tenant_id", t.id).in("booking_id", bs.map(function (b) { return b.id; })) : { data: [] };
      if (paymentResult.error) {
        box.innerHTML = '<div class="booking-queue-error" role="alert"><h3>Unable to load payment status</h3><p>' + esc(nice(paymentResult.error)) + '</p><button type="button" class="btn ghost" data-retry-queue>Retry</button></div>';
        box.querySelector("[data-retry-queue]").onclick = load;
        return;
      }
      var pays = (paymentResult.data || []).filter(function (payment) { return !payment.deleted_at; });
      // The scoped RPC supplies real profile names without granting access to profile rows.
      var contacts = typeof sb.rpc === "function" ? await sb.rpc("club_player_contacts", { p_tenant_id: t.id }) : { data: [] };
      var contactMap = {};
      (contacts.data || []).forEach(function (contact) { contactMap[contact.player_id] = contact; });
      players.forEach(function (player) {
        var contact = contactMap[player.id];
        if (contact) { player.full_name = contact.full_name; player.phone = contact.phone || player.phone; }
      });
      var pm = {}, cm = {}, pay = {};
      players.forEach(function (p) { pm[p.id] = p; }); courts.forEach(function (c) { cm[c.id] = c; }); pays.forEach(function (p) { pay[p.booking_id] = p; });
      var today = dayStr(tz);
      function isPaid(booking) { return Number(booking.amount) === 0 || !!booking.paid_at || (booking.status === "approved" && !!pay[booking.id]); }
      var pending = bs.filter(function (b) { return b.status === "pending" || !isPaid(b); });
      var approved = bs.filter(function (b) { return b.status === "approved" && isPaid(b) && new Date(b.ends_at).getTime() > Date.now(); });
      var todayList = approved.filter(function (b) { return new Date(b.starts_at).toLocaleDateString("en-CA", { timeZone: tz }) === today; });
      var later = approved.filter(function (b) { return todayList.indexOf(b) === -1; });
      function row(b, withDecide) {
        var p = pm[b.player_id] || {}, c = cm[b.court_id] || {}, py = pay[b.id];
        p = { display_name: p.full_name || p.display_name || b.guest_name, phone: p.phone || b.guest_phone };
        var displayName = p.display_name || "Guest";
        var initials = displayName.split(" ").filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase() || "BK";

        var statusBadge = !withDecide
          ? srcBadge(b)
          : (py
              ? '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Proof uploaded</span>'
              : '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>No Proof</span>');

        var paymentState = Number(b.amount) === 0 ? "free" : b.paid_at ? "paid" : py ? (b.status === "approved" ? "paid" : "review") : "unpaid";
        var paymentLabel = { free: "No payment due", paid: "Paid", review: "Pending verification", unpaid: "Unpaid" }[paymentState];
        var bookingDate = new Date(b.starts_at).toLocaleDateString("en-PH", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
        return '<article class="bcard reservation-review-card" data-b="' + esc(b.id) + '">' +
          '<header class="reservation-review-header"><div class="reservation-customer"><span class="reservation-customer-avatar" aria-hidden="true">' + esc(initials) + '</span><div class="reservation-customer-copy"><span class="reservation-customer-type ' + (b.player_id ? 'member' : 'guest') + '">' + (b.player_id ? 'Member' : 'Guest') + '</span><h4>' + esc(displayName) + '</h4></div></div><div class="reservation-payment-status">' + statusBadge + '<div class="reservation-customer-phone"><span class="material-symbols-outlined" aria-hidden="true">call</span><span>' + esc(p.phone || "Phone not provided") + '</span></div></div></header>' +
          '<dl class="reservation-review-details"><div><dt>Court</dt><dd>' + esc(c.name || "Court") + '</dd></div><div><dt>Amount</dt><dd class="reservation-review-amount">' + money(b.amount) + '</dd></div><div><dt>Date</dt><dd>' + esc(bookingDate) + '</dd></div><div><dt>Time</dt><dd>' + esc(timeOf(new Date(b.starts_at), tz) + " \u2013 " + timeOf(new Date(b.ends_at), tz)) + '</dd></div></dl>' +
          '<div class="reservation-review-reference"><span>Reference</span><strong>' + esc(b.reference_code || "Not available") + '</strong></div>' +
          '<div class="reservation-review-reference reservation-review-payment"><span>Payment</span><strong class="payment-state-' + paymentState + '">' + paymentLabel + '</strong></div>' +
          '<div class="reservation-card-actions mt-3.5 pt-3 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">' +
            '<div class="booking-pass-actions">' +
              '<button type="button" class="booking-decision-action qr-pass" data-ticket="' + esc(b.id) + '" aria-label="View QR pass" title="View QR Pass"><span class="material-symbols-outlined" aria-hidden="true">qr_code_2</span></button>' +
              (((py && py.proof_path) || (!b.player_id && paymentState === "paid")) ? '<button type="button" class="booking-decision-action view-proof" data-proof="' + esc(b.id) + '" aria-label="View payment proof" title="View Payment Proof"><span class="material-symbols-outlined" aria-hidden="true">visibility</span></button>' : '') +
              (!py && b.expires_at ? '<div class="reservation-review-hold"><span class="material-symbols-outlined" aria-hidden="true">schedule</span><span>Hold ends in <b class="timer" data-exp="' + esc(b.expires_at) + '"></b></span></div>' : '') +
            '</div>' +
            '<div class="reservation-decision-actions flex items-center gap-2">' +
              (!b.player_id && (b.source === "walk_in" || b.guest_name) && !isPaid(b) && (!b.expires_at || new Date(b.expires_at).getTime() > Date.now()) ? '<button class="booking-decision-action approve" data-guest-pay="' + esc(b.id) + '" type="button" aria-label="Record guest payment" title="Record guest payment"><span class="material-symbols-outlined" aria-hidden="true">account_balance_wallet</span></button>' : '') +
              (b.status === "pending"
                ? '<button class="booking-decision-action approve" data-ok="' + esc(b.id) + '" type="button" aria-label="Approve reservation" title="' + (py && py.proof_path ? 'Approve reservation' : 'Attach payment proof before approving') + '"' + (py && py.proof_path ? '' : ' disabled aria-disabled="true"') + '><span class="material-symbols-outlined" aria-hidden="true">check</span></button>' +
                  '<button class="booking-decision-action reject" data-no="' + esc(b.id) + '" type="button" aria-label="Reject reservation" title="Reject reservation"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>'
                : '<button class="booking-decision-action cancel" data-cx="' + esc(b.id) + '" type="button" aria-label="Cancel booking" title="Cancel booking"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>') +
            '</div>' +
          '</div>' +
          '<p class="msg" role="alert"></p>' +
        '</article>';
      }
      box.innerHTML = (contacts.error && players.length ? '<div class="booking-contact-warning" role="status">Customer profile details are temporarily unavailable. Showing club registration details.</div>' : '') + '<div class="booking-queues">' + [
        { title: 'Needs approval', description: 'Review payments and unpaid reservations.', icon: 'pending_actions', items: pending, decide: true, empty: 'Nothing waiting in the queue.' },
        { title: "Today's confirmed bookings", description: "Confirmed reservations scheduled for today.", icon: 'today', items: todayList, empty: 'No confirmed bookings today.' },
        { title: 'Upcoming confirmed bookings', description: 'Confirmed reservations for the coming days.', icon: 'event_upcoming', items: later, empty: 'No other confirmed bookings.' }
      ].map(function (group) {
        return '<section class="booking-queue"><header class="booking-queue-heading"><span class="material-symbols-outlined" aria-hidden="true">' + group.icon + '</span><div class="booking-queue-heading-copy"><h3>' + group.title + '</h3>' + '<p class="booking-queue-description">' + esc(group.description) + '</p>'  + '</div><span class="booking-count' + (group.decide && group.items.length ? ' needs-attention' : '') + '">' + group.items.length + '</span></header>' +
          (group.items.length ? '<div class="booking-record-grid">' + group.items.map(function (b) { return row(b, !!group.decide); }).join('') + '</div>' : D.ui.emptyState(group.decide ? 'No pending approvals' : 'No bookings scheduled', group.empty, group.icon)) + '</section>';
      }).join('') + '</div>';
      startTicker();
      var byId = {}; bs.forEach(function (b) { byId[b.id] = b; });
      box.querySelectorAll('[data-ticket]').forEach(function (button) {
        button.onclick = async function () {
          await openPass(byId[button.getAttribute('data-ticket')], cm[byId[button.getAttribute('data-ticket')].court_id], t, pm[byId[button.getAttribute('data-ticket')].player_id], button);
        };
      });
      function card(el) { return el.closest(".bcard"); }
      async function decide(el, id, decision, reason) {
        el.disabled = true;
        var r = await sb.rpc("decide_booking", { p_booking_id: id, p_decision: decision, p_reason: reason, p_idempotency_key: uuid() });
        if (r.error) { el.disabled = false; msg(card(el), nice(r.error), "err"); if (/invalid_state/.test(r.error.message || "")) load(); return; }
        load();
      }
      Array.prototype.forEach.call(box.querySelectorAll("[data-guest-pay]"), function (button) {
        button.onclick = function () {
          var booking = byId[button.getAttribute("data-guest-pay")];
          var dialog = document.createElement("dialog");
          dialog.className = "confirmation-modal guest-payment-dialog";
          dialog.setAttribute("aria-label", "Record guest payment");
          var paymentMethods = [["cash", "Cash", "payments"], ["gcash", "GCash", "account_balance_wallet"], ["maya", "Maya", "wallet"], ["bank", "Bank Transfer", "account_balance"]];
          dialog.innerHTML = '<form><header class="guest-payment-header"><div><span class="guest-payment-eyebrow">Guest reservation</span><h2>Record payment</h2></div><button type="button" class="guest-payment-close" data-close aria-label="Close payment dialog"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header><div class="guest-payment-summary"><span>Amount received</span><strong>' + money(booking.amount) + '</strong><div><span>Reference</span><b>' + esc(booking.reference_code) + '</b></div></div><fieldset class="guest-payment-methods"><legend>Payment method</legend><div>' + paymentMethods.map(function (method, index) {
            return '<label class="guest-payment-method"><input type="radio" name="method" value="' + method[0] + '"' + (index === 0 ? ' checked' : '') + ' required><span class="material-symbols-outlined" aria-hidden="true">' + method[2] + '</span><span>' + method[1] + '</span><span class="guest-method-check material-symbols-outlined" aria-hidden="true">check_circle</span></label>';
          }).join("") + '</div></fieldset><div class="guest-proof-section" hidden><label class="guest-proof-upload"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span><span><strong class="guest-proof-name">Attach payment receipt</strong><small class="guest-proof-hint">JPG, PNG or WebP, up to 5 MB</small></span><input type="file" name="proof" accept="image/jpeg,image/png,image/webp" aria-label="Attach payment receipt"></label></div><p class="guest-payment-note">Record only payments you have received. This marks the reservation as paid.</p><p class="msg" role="alert"></p><div class="guest-payment-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">Confirm payment</button></div></form>';
          var proofInput = dialog.querySelector('input[name="proof"]');
          var paymentAttempt = uuid();
          var uploadedProof = null;
          dialog.querySelectorAll('input[name="method"]').forEach(function (radio) {
            radio.onchange = function () {
              var needsProof = this.value !== "cash";
              dialog.querySelector(".guest-proof-section").hidden = !needsProof;
              proofInput.required = needsProof;
              msg(dialog, "", "");
            };
          });
          proofInput.onchange = function () {
            uploadedProof = null;
            paymentAttempt = uuid();
            var name = dialog.querySelector(".guest-proof-name");
            var hint = dialog.querySelector(".guest-proof-hint");
            try {
              var file = this.files[0];
              if (file) checkImage(file);
              name.textContent = file ? file.name : "Attach payment receipt";
              hint.textContent = file ? "Attached (" + (file.size / 1024 / 1024).toFixed(2) + " MB). Uploads when you confirm payment." : "JPG, PNG or WebP, up to 5 MB";
              dialog.querySelector(".guest-proof-upload").classList.toggle("has-receipt", !!file);
              msg(dialog, "", "");
            } catch (error) {
              this.value = "";
              name.textContent = "Attach payment receipt";
              hint.textContent = "JPG, PNG or WebP, up to 5 MB";
              dialog.querySelector(".guest-proof-upload").classList.remove("has-receipt");
              msg(dialog, nice(error), "err");
            }
          };
          dialog.querySelectorAll("[data-close]").forEach(function (closeButton) { closeButton.onclick = function () { dialog.close(); }; });
          dialog.addEventListener("close", function () { dialog.remove(); if (button.isConnected) button.focus(); }, { once: true });
          dialog.querySelector("form").onsubmit = async function (event) {
            event.preventDefault();
            var submit = dialog.querySelector('[type="submit"]');
            submit.disabled = true;
            try {
              var selectedMethod = dialog.querySelector('input[name="method"]:checked').value;
              if (selectedMethod !== "cash") {
                var receipt = proofInput.files[0];
                checkImage(receipt);
                if (!uploadedProof) {
                  var proofPath = booking.tenant_id + "/guest-proofs/" + D.state.user.id + "/" + booking.id + "-" + paymentAttempt + "." + TYPES[receipt.type];
                  submit.textContent = "Uploading receipt...";
                  var upload = await sb.storage.from("payment").upload(proofPath, receipt, { contentType: receipt.type, upsert: false });
                  if (upload.error && !/exist|duplicate|409/i.test(upload.error.message || "")) throw upload.error;
                  uploadedProof = proofPath;
                }
              }
              submit.textContent = "Recording payment...";
              var result = await sb.rpc("record_guest_payment", { p_booking_id: booking.id, p_method: selectedMethod, p_proof_path: selectedMethod === "cash" ? null : uploadedProof });
              if (result.error) throw result.error;
              dialog.close();
              await load();
            } catch (error) { submit.disabled = false; submit.textContent = "Confirm payment"; msg(dialog, nice(error), "err"); }
          };
          document.body.append(dialog);
          dialog.showModal();
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll("[data-ok]"), function (b) { b.onclick = async function () { if (b.disabled) return; var proof = pay[b.getAttribute("data-ok")]; if (!proof || !proof.proof_path) return; if (await D.ui.confirmAction("Approve this booking and confirm the reserved court time?", { title: "Approve booking", confirmText: "Approve booking", danger: false })) decide(b, b.getAttribute("data-ok"), "approved", null); }; });
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
          var bk = byId[b.getAttribute("data-proof")], py = pay[bk.id];
          if (!py || !py.proof_path) {
            var paidInCash = String(bk.staff_payment_method || (py && py.method) || "").toLowerCase() === "cash";
            D.ui.toast(paidInCash ? "Paid in cash. No payment proof is attached to this reservation." : "No payment proof is attached to this reservation.", "info");
            return;
          }
          var url = await signed(py.proof_path);
          var proof = document.createElement('dialog');
          proof.className = 'payment-proof-modal'; proof.setAttribute('aria-label','Payment Proof');
          proof.innerHTML = '<header><div><span class="payment-proof-eyebrow">Booking Payment</span><h2>Payment Proof</h2></div><button type="button" data-close aria-label="Close payment proof"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header><div class="payment-proof-details"><div><span>Amount Due</span><strong>' + money(bk.amount) + '</strong></div><div><span>Payer Reference</span><strong>' + esc(py.payer_reference || 'Not provided') + '</strong></div><div><span>Booking Reference</span><strong>' + esc(bk.reference_code) + '</strong></div></div><div class="payment-proof-image">' + (url ? '<img src="' + esc(url) + '" alt="Uploaded payment proof">' : D.ui.emptyState('Image unavailable','The payment proof could not be loaded. Please try again.','image_not_supported')) + '</div><footer><button type="button" class="btn ghost" data-close><span class="material-symbols-outlined" aria-hidden="true">close</span>Close</button></footer>';
          proof.querySelectorAll('[data-close]').forEach(function (button) { button.onclick = function () { proof.close(); }; });
          proof.addEventListener('click',function (event) { if (event.target === proof) { var rect = proof.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) proof.close(); } });
          proof.addEventListener('close',function () { proof.remove(); if (b.isConnected) b.focus(); },{once:true});
          document.body.appendChild(proof); proof.showModal();
        };
      });
    }
    await load();
    chan = sb.channel("queue-" + t.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: "tenant_id=eq." + t.id }, function () { load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_payments", filter: "tenant_id=eq." + t.id }, function () { load(); }).subscribe();
    poll = setInterval(load, 20000);
  }


  // ============================================ club books for a customer
  // Owner or staff books a court for a walk-in guest (name only) or for a registered player.
  // The database (create_admin_booking) checks membership, opening hours, slot grid, blocks and overlaps.
  function srcBadge(b) {
    if (b.source === "walk_in") {
      return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-xs font-mono font-medium"><span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>Walk-in Guest</span>';
    }
    if (b.source === "admin") {
      return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs font-mono font-medium"><span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>Booked by Club</span>';
    }
    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-lime/10 border border-brand-lime/25 text-brand-lime text-xs font-mono font-medium"><span class="w-1.5 h-1.5 rounded-full bg-brand-lime"></span>Registered Player</span>';
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
      var directory = await sb.rpc("club_booking_players", { p_tenant_id: t.id });
      if (directory.error) {
        formBox.innerHTML = '<p class="msg err" role="alert">Unable to load registered players. ' + esc(nice(directory.error)) + '</p>';
        return;
      }
      var players = directory.data || [];
      if (!courts.length) {
        formBox.innerHTML = '<div class="p-8 text-center text-slate-400 font-mono text-sm">No active courts configured. Please add a court first on the Courts tab.</div>';
        return;
      }
      var S = { court: courts[0], date: dayStr(tz), slots: [], start: null, count: 1, who: "guest" };
      var playerOpts = function () {
        return '<option value="">Choose a registered player...</option>' + players.map(function (p) {
          var name = p.full_name || p.display_name;
          var nickname = p.full_name && p.display_name && p.full_name.toLowerCase() !== p.display_name.toLowerCase() ? " (" + p.display_name + ")" : "";
          return '<option value="' + esc(p.id) + '">' + esc(name + nickname) + (p.phone ? " - " + esc(p.phone) : "") + '</option>';
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
              'Walk-in Guest' +
            '</button>' +
            '<button aria-selected="false" class="customer-toggle-btn flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium font-display tracking-wide transition-all duration-150 flex items-center justify-center gap-2 text-slate-400 hover:text-slate-200 border border-transparent bg-transparent cursor-pointer" id="tab-registered" type="button" role="tab">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              'Registered Player' +
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
                '<span id="rate-badge" class="text-[11px] text-slate-400 font-mono">' + rateRange(S.court) + '</span>' +
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
        if (rateBadge) rateBadge.textContent = rateRange(S.court);
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
        var total = slotsTotal(S.slots, S.start, S.count, S.court.slot_minutes);
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
                var timeLabel = esc(timeOf(x.s, tz)) + rateTag(x);
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
          slots.push({ s: s0, e: new Date(s0.getTime() + step * 60000), m: m });
        }
        if (!slots.length) {
          grid.innerHTML = '<p class="text-xs text-slate-500 font-mono py-4 text-center">No schedule slots configured for this court on this date.</p>';
          return;
        }
        await attachRates(c, S.date, slots);
        var rb = q("#rate-badge", f), rs = slots.map(function (x) { return x.rate; }), rlo = Math.min.apply(null, rs), rhi = Math.max.apply(null, rs);
        if (rb) rb.textContent = rlo === rhi ? money(rlo) + "/hr" : "PHP " + rlo.toFixed(0) + " - " + rhi.toFixed(0) + "/hr";
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
        if (btn.disabled) return;
        btn.disabled = true;
        var customer = S.who === "guest" ? guest : ((players.find(function (player) { return player.id === pid; }) || {}).display_name || "the selected player");
        var confirmation = await D.ui.confirmAction("Reserve " + S.court.name + " for " + customer + " on " + range(a.s, z.e, tz) + "? This booking will be confirmed immediately.", { title: "Confirm Booking", confirmText: "Confirm Booking", danger: false });
        if (!confirmation) { btn.disabled = false; return; }
        var sig = "admin|" + S.court.id + "|" + a.s.toISOString() + "|" + z.e.toISOString() + "|" + (S.who === "guest" ? guest : pid);
        keys[sig] = keys[sig] || uuid();
        btn.disabled = true;
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

    D.booking = { openPayment: openPayment, openPass: openPass, renderBook: renderBook, myBookings: myBookings, queue: queue, adminNew: adminNew, zonedToUtc: zonedToUtc };
})();
