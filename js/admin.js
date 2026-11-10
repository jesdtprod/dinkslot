// DINKSLOT club facility dashboard: /#/admin/<slug>, /courts, /bookings, /profile, /payments, /staff, /account.
// Only club owner/staff reach real data: every query is filtered by RLS in Postgres.
// tenant_id is never trusted from here; the database re-checks membership on every write.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc, setMsg = D.setMsg, friendly = D.friendly;
  var ctx = null; // { t: tenant row, role: 'owner'|'staff', slug }
  var currentUi = null; // active layout shell instance
  var statusChan = null; // live club-status subscription for the open dashboard
  var TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var MAX_BYTES = 5 * 1024 * 1024;

  function q(sel, root) { return (root || D.root()).querySelector(sel); }
  function val(sel, root) { var e = q(sel, root); return e ? e.value : ""; }
  function num(sel, root) { return Number(val(sel, root)); }
  function money(n) { return "PHP " + Number(n).toFixed(2); }
  function hhmm(t) { return String(t).slice(0, 5); }
  function when(iso) {
    return new Date(iso).toLocaleString("en-PH", { timeZone: (ctx && ctx.t && ctx.t.timezone) || "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
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
    overview: ["Overview", "How your facility is performing today."],
    bookings: ["Bookings & Schedule", "Approve payments, manage player holds, and today's courts."],
    courts: ["Courts & Matrix", "Courts, hourly rates, opening hours and maintenance blocks."],
    profile: ["Club Profile", "Your public page: details, logo, and court cover photos."],
    payments: ["Payments & Rules", "Payment QR codes, auto-approval rules, and cancellation policies."],
    staff: ["Staff & Team", "Team members authorized to manage court operations and bookings."],
    account: ["My Profile", "Your personal player credentials and your own bookings."]
  };

  // ----------------------------------------------------------------- skeletons
  function skeletonSection(sec) {
    if (sec === "courts") {
      return '<div class="space-y-6">' +
        '<div class="flex items-center justify-between pb-4 border-b border-outline-variant/20">' +
          '<div class="h-8 w-44 rounded-lg bg-surface-container-high/70 ds-skeleton"></div>' +
          '<div class="h-10 w-36 rounded-full bg-primary/20 ds-skeleton"></div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">' +
          '<div class="h-56 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
          '<div class="h-56 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
          '<div class="h-56 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
        '</div></div>';
    }
    if (sec === "bookings") {
      return '<div class="space-y-6">' +
        '<div class="flex items-center justify-between pb-4 border-b border-outline-variant/20">' +
          '<div class="h-8 w-56 rounded-lg bg-surface-container-high/70 ds-skeleton"></div>' +
          '<div class="h-5 w-28 rounded bg-surface-container-high/40 ds-skeleton"></div>' +
        '</div>' +
        '<div class="space-y-4">' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
          '<div class="h-44 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 ds-skeleton"></div>' +
        '</div></div>';
    }
    if (sec === "profile" || sec === "payments" || sec === "staff") {
      return '<div class="space-y-6">' +
        '<div class="flex items-center gap-3 pb-4 border-b border-outline-variant/20">' +
          '<div class="h-8 w-24 rounded-full bg-surface-container-high/60 ds-skeleton"></div>' +
          '<div class="h-8 w-28 rounded-full bg-surface-container-high/40 ds-skeleton"></div>' +
          '<div class="h-8 w-24 rounded-full bg-surface-container-high/40 ds-skeleton"></div>' +
        '</div>' +
        '<div class="h-96 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 flex flex-col gap-4 ds-skeleton"></div>' +
      '</div>';
    }
    if (sec === "account") {
      return '<div class="space-y-6">' +
        '<div class="h-32 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 ds-skeleton"></div>' +
        '<div class="h-72 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 ds-skeleton"></div>' +
      '</div>';
    }
    return '<div class="space-y-6">' +
      '<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-outline-variant/15">' +
        '<div class="flex flex-col gap-2">' +
          '<div class="h-7 w-56 bg-surface-container-high/70 rounded-lg ds-skeleton"></div>' +
          '<div class="h-4 w-80 bg-surface-container-high/40 rounded ds-skeleton"></div>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
          '<div class="h-9 w-28 rounded-full bg-surface-container-high/50 ds-skeleton"></div>' +
          '<div class="h-9 w-32 rounded-full bg-primary/20 ds-skeleton"></div>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">' +
        '<div class="h-28 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 ds-skeleton"></div>' +
        '<div class="h-28 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 ds-skeleton"></div>' +
        '<div class="h-28 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 ds-skeleton"></div>' +
        '<div class="h-28 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-4 ds-skeleton"></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">' +
        '<div class="lg:col-span-7 h-96 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 ds-skeleton"></div>' +
        '<div class="lg:col-span-5 h-96 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 ds-skeleton"></div>' +
      '</div>' +
      '<div class="h-64 rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 ds-skeleton"></div>' +
    '</div>';
  }

  function skeletonShell() {
    return '<div id="ds-tenant-dashboard" class="flex w-full min-h-screen bg-surface text-on-surface relative">' +
      '<aside class="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest z-50 flex flex-col justify-between py-space-md border-r border-outline-variant/20 -translate-x-full md:translate-x-0">' +
        '<div class="flex flex-col gap-space-md">' +
          '<div class="facility-brand-row flex items-center gap-3 px-4">' +
            '<div class="w-10 h-10 rounded-xl bg-surface-container-high/60 ds-skeleton shrink-0"></div>' +
            '<div class="flex flex-col gap-1.5 flex-1 min-w-0">' +
              '<div class="h-4 w-24 bg-surface-container-high/60 rounded ds-skeleton"></div>' +
              '<div class="h-2.5 w-32 bg-surface-container-high/40 rounded ds-skeleton"></div>' +
            '</div>' +
          '</div>' +
          '<div class="flex flex-col gap-2 px-3 pt-2">' +
            '<div class="h-3 w-16 bg-surface-container-high/30 rounded mx-2 mb-1 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/60 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/40 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/40 ds-skeleton"></div>' +
            '<div class="h-3 w-20 bg-surface-container-high/30 rounded mx-2 mt-3 mb-1 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/40 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/40 ds-skeleton"></div>' +
            '<div class="h-10 w-full rounded-xl bg-surface-container-high/40 ds-skeleton"></div>' +
          '</div>' +
        '</div>' +
        '<div class="px-4 pt-3 border-t border-outline-variant/20">' +
          '<div class="h-10 w-full rounded-xl bg-surface-container-low border border-outline-variant/20 ds-skeleton"></div>' +
        '</div>' +
      '</aside>' +
      '<div class="w-full md:pl-64 min-h-screen flex flex-col bg-surface flex-1">' +
        '<header class="fixed top-0 left-0 md:left-64 right-0 h-14 bg-surface/85 backdrop-blur-xl z-40 flex items-center justify-between px-6 border-b border-outline-variant/20">' +
          '<div class="flex items-center gap-2">' +
            '<div class="h-7 w-48 rounded-full bg-surface-container-high/60 ds-skeleton"></div>' +
          '</div>' +
          '<div class="flex items-center gap-3">' +
            '<div class="h-7 w-28 rounded-full bg-primary/10 border border-primary/20 hidden lg:block ds-skeleton"></div>' +
            '<div class="w-9 h-9 rounded-full bg-surface-container-high/60 ds-skeleton"></div>' +
            '<div class="h-9 w-36 rounded-full bg-surface-container-high/60 ds-skeleton"></div>' +
          '</div>' +
        '</header>' +
        '<main class="w-full pt-14 bg-surface min-h-screen flex-1 flex flex-col">' +
          '<div class="px-gutter md:px-gutter-desktop py-space-lg flex flex-col gap-space-lg max-w-[1560px] mx-auto w-full">' +
            skeletonSection("overview") +
          '</div>' +
        '</main>' +
      '</div>' +
    '</div>';
  }

  // ----------------------------------------------------------------- shell
  async function render(slug, section) {
    document.body.classList.add("tenant-dashboard-mode");
    var root = D.root();
    if (!section || section === "dashboard") section = "overview";
    if (section === "settings") section = "profile";

    var isSameShell = currentUi && ctx && ctx.slug === slug && root.querySelector("#ds-tenant-dashboard");
    if (!isSameShell) {
      root.innerHTML = skeletonShell();
      var tr = await sb.from("tenants").select("*").eq("slug", slug).maybeSingle();
      var t = tr.data, role = null;
      if (t) {
        var mr = await sb.from("tenant_members").select("role").eq("tenant_id", t.id).eq("user_id", D.state.user.id).maybeSingle();
        role = mr.data && mr.data.role;
      }
      if (!t || !role) {
        root.innerHTML = '<div class="p-8 max-w-lg mx-auto mt-12 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-center"><span class="material-symbols-outlined text-4xl text-error mb-2">lock</span><h2 class="font-headline-md text-on-surface">No access</h2><p class="text-on-surface-variant mt-2 font-body-md">This club does not exist, or you are not part of its staff team.</p><p class="mt-6"><a class="px-5 py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-bold no-underline inline-block font-label-md" href="#/">Return Home</a></p></div>';
        return;
      }
      ctx = { t: t, role: role, slug: slug };
      var owner = role === "owner";
      var pendingCount = (await sb.from("bookings").select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id).eq("status", "pending")).count || 0;
      var base = "#/admin/" + slug;
      var items = [
        { type: "label", label: "Operations" },
        { key: "overview", label: "Overview", icon: "dashboard", href: base },
        { key: "courts", label: "Court Matrix", icon: "sports_tennis", href: base + "/courts" },
        { key: "bookings", label: "Bookings & Schedule", icon: "calendar_today", href: base + "/bookings", badge: pendingCount || "" }
      ];
      if (owner) {
        items.push({ type: "label", label: "Facility Setup" },
          { key: "profile", label: "Club Profile", icon: "storefront", href: base + "/profile" },
          { key: "payments", label: "Payments & Rules", icon: "qr_code_2", href: base + "/payments" },
          { key: "staff", label: "Member Roster & Staff", icon: "groups", href: base + "/staff" });
      }
      items.push({ type: "label", label: "Personal" },
        { key: "account", label: "My Profile", icon: "person", href: base + "/account" });
      var foot = [];
      if (t.status === "approved") foot.push({ label: "View Public Page", icon: "open_in_new", href: "#/c/" + slug });
      foot.push({ label: "Back to Site", icon: "home", href: "#/" });

      currentUi = D.ui.dash(root, {
        head: { title: t.name, sub: role === "owner" ? "Facility Director" : "Staff Specialist", status: t.status, img: t.logo_path ? D.mediaUrl(t.logo_path) : "", city: t.city, slug: slug },
        items: items, foot: foot, active: section
      });

      if (t.status !== "approved") {
        currentUi.main.insertAdjacentHTML("beforebegin", '<div class="p-space-md dashboard-rounded bg-error/10 border border-error/30 text-error flex items-center justify-between gap-space-sm mb-space-md"><div class="flex items-center gap-space-sm"><span class="material-symbols-outlined">info</span><span>This facility is <b>' + esc(t.status) +
          "</b>. It is hidden from the public player directory until the platform admin approves it. You can configure courts and rules meanwhile.</span></div><a href=\"#/platform\" class=\"px-space-md py-1 rounded-full bg-error text-on-error font-label-sm font-semibold no-underline whitespace-nowrap\">Status Info</a></div>");
      }

      // Live status: when platform admin approves or suspends this club, the dashboard updates itself.
      if (statusChan) { sb.removeChannel(statusChan); statusChan = null; }
      statusChan = sb.channel("tenant-" + t.id + "-" + Date.now())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenants", filter: "id=eq." + t.id }, function (pl) {
          if (!document.body.contains(currentUi.main)) { sb.removeChannel(statusChan); statusChan = null; return; }
          if (pl.new && pl.new.status !== ctx.t.status) { ctx.t.status = pl.new.status; render(slug, section); }
        }).subscribe();
    }

    var ui = currentUi;
    var meta = SECTIONS[section] || SECTIONS.overview;
    ui.setActive(section);
    ui.setTitle(meta[0], meta[1]);
    var sec = ui.main;
    sec.innerHTML = skeletonSection(section);

    var owner = ctx.role === "owner";
    if (section === "bookings") {
      if (!D.booking) return;
      sec.innerHTML = '<div id="newbk"></div><div id="queue"></div>';
      D.booking.adminNew(q("#newbk", sec), ctx.t);
      return D.booking.queue(q("#queue", sec), ctx.t);
    }
    if (section === "account") return accountView(sec);
    if (section === "courts") return courtsView(sec);
    if (!owner && (section === "profile" || section === "payments" || section === "staff")) {
      sec.innerHTML = '<div class="bg-surface-container-low p-8 dashboard-rounded border border-outline-variant/30 text-center"><span class="material-symbols-outlined text-4xl text-outline mb-2">lock</span><h3 class="font-headline-sm text-on-surface">Owner Permissions Required</h3><p class="text-on-surface-variant font-body-md mt-1">Only the facility owner can edit club profile, billing, and staff permissions.</p></div>';
      return;
    }
    if (section === "profile" || section === "payments" || section === "staff") return settingsView(sec, section);
    return dashboardView(sec, ui);
  }

  // -------------------------------------------------------------- overview
  async function dashboardView(sec, ui) {
    var t = ctx.t, tz = t.timezone || "Asia/Manila";
    var now = new Date();
    var todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
    var dayStart = zonedToUtc(todayStr + "T00:00", tz), dayEnd = new Date(dayStart.getTime() + 86400000);
    var seventyTwoHours = new Date(dayEnd.getTime() + 86400000 * 2);

    var dateLong = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", year: "numeric" });
    var timeFormatted = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

    function count(build) {
      return build(sb.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", t.id)).then(function (r) { return r.count || 0; });
    }

    var res = await Promise.all([
      count(function (b) { return b.eq("status", "pending"); }),
      count(function (b) { return b.eq("status", "approved").gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString()); }),
      count(function (b) { return b.eq("status", "approved").gte("starts_at", dayEnd.toISOString()).lt("starts_at", seventyTwoHours.toISOString()); }),
      sb.from("courts").select("*").eq("tenant_id", t.id).order("name"),
      sb.from("tenant_settings").select("*").eq("tenant_id", t.id).maybeSingle(),
      sb.from("bookings").select("id,starts_at,ends_at,amount,reference_code,status,player_id,court_id,created_at").eq("tenant_id", t.id).order("created_at", { ascending: false }).limit(8)
    ]);

    var pending = res[0];
    var todayN = res[1];
    var upcoming = res[2];
    var courtsList = (res[3] && res[3].data) || [];
    var st = (res[4] && res[4].data) || {};
    var recentBookings = (res[5] && res[5].data) || [];
    var courtsCount = courtsList.length;
    var firstCourt = courtsList[0] || { name: "Stadium Court 01", is_indoor: true, surface: "Acrylic Pro" };

    if (ui && ui.setStatusPill) {
      ui.setStatusPill(courtsCount + " / " + courtsCount + " Courts Live", courtsCount > 0 ? "98% UTIL" : "SETUP");
    }

    // Lookup players for display names
    var playerIds = Array.from(new Set(recentBookings.map(function (b) { return b.player_id; }).filter(Boolean)));
    var playersMap = {};
    if (playerIds.length) {
      var plRes = await sb.from("club_players").select("id,display_name,phone").in("id", playerIds);
      (plRes.data || []).forEach(function (p) { playersMap[p.id] = p; });
    }
    var courtsMap = {};
    courtsList.forEach(function (c) { courtsMap[c.id] = c; });

    var base = "#/admin/" + esc(ctx.slug);

    var qrCount = ((await sb.from("payment_qrs").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).eq("is_active", true)).count) || 0;
    var checklist = [
      { key: "logo", ok: !!t.logo_path, label: "Club Profile Avatar", sub: "Recommended 400x400px square logo for the public player roster.", req: "Required", action: "Upload Logo", href: base + "/profile" },
      { key: "cover", ok: !!t.cover_path, label: "Court Banner Cover", sub: "High-res landscape photography of your facility court flooring.", req: "Recommended", action: "Add Banner", href: base + "/profile" },
      { key: "courts", ok: courtsCount > 0, label: "Court Configuration", sub: courtsCount > 0 ? (firstCourt.name + " (" + (firstCourt.is_indoor ? "Indoor" : "Outdoor") + ") is live") : "Add your first court with rates and hours.", req: courtsCount > 0 ? "Completed" : "Required", action: courtsCount > 0 ? "Manage (" + courtsCount + ")" : "Add Court", href: base + "/courts" },
      { key: "qr", ok: !st.payment_enabled || qrCount > 0, label: "Payment QR Code / Payouts", sub: "Upload GCash/Maya QR or connect instant card processing.", req: "Fast Payouts", action: "Connect QR", href: base + "/payments" },
      { key: "rules", ok: !st.payment_enabled || !!(st.payment_instructions && st.payment_instructions.trim()), label: "Payment Instructions & House Rules", sub: "Cancellation policy, paddle requirements, and gate access pin instructions.", req: "House Rules", action: "Set Rules", href: base + "/payments" }
    ];
    var done = checklist.filter(function (i) { return i.ok; }).length;
    var pct = Math.round((done / checklist.length) * 100);


    sec.innerHTML =
      '<!-- Top Action Bar & Club Greeting -->' +
      '<section class="flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">' +
        '<div class="flex flex-col gap-space-xs">' +
          '<div class="flex items-center gap-space-sm flex-wrap">' +
            '<div class="inline-flex items-center gap-space-xs bg-primary/10 px-space-sm py-1 rounded-full border border-primary/20">' +
              '<span class="w-2 h-2 rounded-full bg-primary animate-ping"></span>' +
              '<span class="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold">Venue Live Sync</span>' +
            '</div>' +
            '<span class="text-on-surface-variant font-label-md text-label-md">•</span>' +
            '<span class="text-on-surface-variant font-label-md text-label-md">' + esc(dateLong) + '</span>' +
            '<span class="text-on-surface-variant font-label-md text-label-md hidden md:inline">| Local Time ' + esc(timeFormatted) + ' (' + esc(tz) + ')</span>' +
          '</div>' +
          '<div class="flex items-baseline gap-space-sm">' +
            '<h1 class="font-headline-lg text-headline-lg text-on-surface tracking-tight" id="dtitle">Overview</h1>' +
            '<span class="text-on-surface-variant font-body-md text-body-md" id="dsub">— How ' + esc(t.name) + ' is performing today</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-space-sm flex-wrap" id="dact">' +
          '<a class="inline-flex items-center gap-space-xs bg-surface-container-high hover:bg-surface-bright text-on-surface px-space-md py-space-sm rounded-full font-label-md text-label-md transition-all no-underline border border-outline-variant/30" href="#/c/' + esc(ctx.slug) + '" target="_blank">' +
            '<span class="material-symbols-outlined text-base">open_in_new</span>' +
            '<span>View Public Page</span>' +
          '</a>' +
          '<a class="inline-flex items-center gap-space-xs bg-surface-container-high hover:bg-surface-bright text-on-surface px-space-md py-space-sm rounded-full font-label-md text-label-md transition-all no-underline border border-outline-variant/30" href="#/admin/' + esc(ctx.slug) + '/staff">' +
            '<span class="material-symbols-outlined text-base">person_add</span>' +
            '<span>Add Staff</span>' +
          '</a>' +
          '<a class="inline-flex items-center gap-space-xs bg-primary hover:bg-primary-fixed text-on-primary font-bold px-space-lg py-space-sm rounded-full font-label-md text-label-md shadow-[0_0_20px_rgba(163,230,53,0.35)] transition-all no-underline" href="#/admin/' + esc(ctx.slug) + '/bookings">' +
            '<span class="material-symbols-outlined text-base">calendar_today</span>' +
            '<span>Quick Book Slot</span>' +
          '</a>' +
        '</div>' +
      '</section>' +

      '<section class="overview-metrics" aria-label="Facility summary">' + [
        { label: 'Needs approval', value: pending, unit: 'pending slips', icon: 'inbox', badge: pending ? 'Action required' : 'All clear', alert: pending > 0, foot: pending ? 'Review payment slips' : 'No pending approvals', href: '/bookings' },
        { label: "Today's schedule", value: todayN, unit: 'active slots', icon: 'calendar_today', badge: 'Today', foot: 'View today?s bookings', href: '/bookings' },
        { label: 'Upcoming matches', value: upcoming, unit: 'reservations', icon: 'event_upcoming', badge: 'Next 72 hours', foot: upcoming ? 'View upcoming bookings' : 'Schedule open', href: '/bookings' },
        { label: 'Court inventory', value: courtsCount, unit: courtsCount === 1 ? 'court configured' : 'courts configured', icon: 'sports_tennis', badge: courtsCount ? 'Configured' : 'Setup needed', foot: courtsCount ? firstCourt.name : 'Add your first court', href: '/courts' }
      ].map(function (metric) {
        return '<a class="metric-card' + (metric.alert ? ' needs-attention' : '') + '" href="#/admin/' + esc(ctx.slug) + metric.href + '">' +
          '<div class="metric-heading"><span class="metric-icon material-symbols-outlined" aria-hidden="true">' + metric.icon + '</span><span class="metric-badge">' + esc(metric.badge) + '</span></div>' +
          '<h2 class="metric-label">' + esc(metric.label) + '</h2>' +
          '<div class="metric-reading"><strong>' + metric.value + '</strong><span>' + esc(metric.unit) + '</span></div>' +
          '<div class="metric-footer"><span>' + esc(metric.foot) + '</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></div>' +
        '</a>';
      }).join('') + '</section>' +

      '<!-- Main Bento Grid: Setup Checklist & Active Operations Hub -->' +
      '<div class="flex flex-col gap-space-lg">' +
        '<!-- LEFT COLUMN: Redesigned Setup Checklist (7 Columns) -->' +
        '<section class="flex flex-col gap-space-md">' +
          '<section class="setup-card" aria-labelledby="setup-title">' +
            '<header class="setup-header">' +
              '<div><span class="setup-eyebrow">GETTING STARTED</span><h2 id="setup-title">Set up your facility</h2><p>A few finishing touches to get your club ready for players.</p></div>' +
              '<div class="setup-progress"><div><span>' + done + ' of ' + checklist.length + ' complete</span><strong>' + pct + '%</strong></div>' +
                '<div class="setup-progress-track" role="progressbar" aria-label="Facility setup completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
              '</div>' +
            '</header>' +
            '<ol class="setup-list">' + checklist.map(function (item, index) {
              var icons = { avatar: "image", cover: "panorama", courts: "sports_tennis", qr: "qr_code_2", rules: "description" };
              return '<li class="setup-row' + (item.ok ? ' is-complete' : '') + '">' +
                '<span class="setup-step" aria-hidden="true">' + (item.ok ? '<span class="material-symbols-outlined">check</span>' : String(index + 1).padStart(2, '0')) + '</span>' +
                '<span class="setup-icon material-symbols-outlined" aria-hidden="true">' + (icons[item.key] || 'settings') + '</span>' +
                '<div class="setup-copy"><div class="setup-row-heading"><h3>' + esc(item.label) + '</h3><span class="setup-badge' + (!item.ok && item.req === 'Required' ? ' is-required' : '') + '">' + esc(item.ok ? 'Complete' : item.req) + '</span></div><p>' + esc(item.sub) + '</p></div>' +
                '<a class="setup-action" href="' + esc(item.href) + '"><span>' + esc(item.action) + '</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a>' +
              '</li>';
            }).join("") + '</ol>' +
            '<footer class="setup-footer"><span class="material-symbols-outlined" aria-hidden="true">task_alt</span><span>' + (done === checklist.length ? 'All set. Your facility profile is complete.' : 'Your progress is saved as you complete each step.') + '</span></footer>' +
          '</section>' +
        '</section>' +

      '</div>' +

      '<!-- Live Transaction & Member Activity Strip -->' +
      '<section class="transactions-card">' +
        '<div class="transactions-header">' +
          '<div>' +
            '<h3 class="font-headline-sm text-headline-sm text-on-surface">Recent Booking Transactions</h3>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">Your latest reservations, payment statuses, and booking details.</p>' +
          '</div>' +
          '<div class="transactions-actions">' +
            '<button id="export-csv-btn" class="transactions-button" type="button"><span class="material-symbols-outlined" aria-hidden="true">download</span>Export CSV</button>' +
            '<a href="#/admin/' + esc(ctx.slug) + '/bookings" class="transactions-button is-primary">Manage all<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a>' +
          '</div>' +
        '</div>' +
        '<div class="transactions-scroll">' +
          '<table class="w-full text-left font-body-sm text-body-sm">' +
            '<thead>' +
              '<tr class="text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider bg-surface-container/60">' +
                '<th class="py-space-sm px-space-md rounded-l-DEFAULT">Player / Member</th>' +
                '<th class="py-space-sm px-space-md">DUPR Rating</th>' +
                '<th class="py-space-sm px-space-md">Court &amp; Format</th>' +
                '<th class="py-space-sm px-space-md">Time Slot</th>' +
                '<th class="py-space-sm px-space-md">Status</th>' +
                '<th class="py-space-sm px-space-md rounded-r-DEFAULT text-right">Fee</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody class="divide-y divide-surface-container-high">' +
              (recentBookings.length ? recentBookings.map(function (b) {
                var p = playersMap[b.player_id] || {};
                var c = courtsMap[b.court_id] || {};
                var initial = (p.display_name || "P").charAt(0).toUpperCase();
                var startFormatted = new Date(b.starts_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
                var endFormatted = new Date(b.ends_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
                return '<tr class="hover:bg-surface-container transition-colors">' +
                  '<td class="py-space-sm px-space-md flex items-center gap-space-sm">' +
                    '<div class="w-7 h-7 rounded-full bg-surface-container-highest flex items-center justify-center font-label-sm text-label-sm font-bold text-primary">' + esc(initial) + '</div>' +
                    '<div class="flex flex-col">' +
                      '<span class="font-body-md text-body-md text-on-surface font-semibold">' + esc(p.display_name || "Guest Player") + '</span>' +
                      '<span class="font-label-sm text-label-sm text-on-surface-variant">' + esc(b.reference_code) + '</span>' +
                    '</div>' +
                  '</td>' +
                  '<td class="py-space-sm px-space-md">' +
                    '<span class="font-label-md text-label-md text-primary font-bold">4.25</span>' +
                  '</td>' +
                  '<td class="py-space-sm px-space-md text-on-surface">' + esc(c.name || "Court 1") + ' • Match</td>' +
                  '<td class="py-space-sm px-space-md text-on-surface-variant font-label-md text-label-md">' + esc(startFormatted) + ' - ' + esc(endFormatted) + '</td>' +
                  '<td class="py-space-sm px-space-md">' +
                    '<span class="px-space-xs py-0.5 rounded-full ' + (b.status === "approved" ? "bg-primary/10 text-primary font-semibold" : "bg-error/10 text-error font-semibold") + ' font-label-sm text-label-sm">' + (b.status === "approved" ? "Paid • Confirmed" : esc(b.status)) + '</span>' +
                  '</td>' +
                  '<td class="py-space-sm px-space-md text-right font-label-md text-label-md font-bold text-on-surface">' + money(b.amount) + '</td>' +
                '</tr>';
              }).join("") :
              '<tr><td colspan="6" class="transactions-empty"><div><span class="material-symbols-outlined" aria-hidden="true">receipt_long</span><div><strong>No bookings yet</strong><p>New reservations will appear here.</p></div></div></td></tr>') +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>';

    var csvBtn = q("#export-csv-btn", sec);
    if (csvBtn) {
      csvBtn.onclick = function () {
        var rows = [["Reference Code", "Player", "Court", "Start Time", "End Time", "Status", "Amount PHP"]];
        recentBookings.forEach(function (b) {
          var p = playersMap[b.player_id] || {};
          var c = courtsMap[b.court_id] || {};
          rows.push([b.reference_code, p.display_name || "Guest", c.name || "Court", b.starts_at, b.ends_at, b.status, b.amount]);
        });
        var csvContent = "data:text/csv;charset=utf-8," + rows.map(function (e) { return e.join(","); }).join("\n");
        var encodedUri = encodeURI(csvContent);
        var link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", t.slug + "-bookings.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
    }
  }

  // ---------------------------------------------------------------- courts
  async function courtsView(sec) {
    var t = ctx.t;
    var cr = await sb.from("courts").select("*").eq("tenant_id", t.id).order("name");
    var br = await sb.from("court_blocks").select("*").eq("tenant_id", t.id)
      .gte("ends_at", new Date().toISOString()).order("starts_at");
    var courts = cr.data || [], blocks = br.data || [];
    var byId = {}; courts.forEach(function (c) { byId[c.id] = c; });

    sec.innerHTML = '<div class="court-matrix">' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs pb-space-sm border-b border-outline-variant/20">' +
        '<div><h1 class="font-headline-lg text-on-surface">Court Matrix</h1><p class="font-body-md text-on-surface-variant">Configure courts, pricing, operating windows, and maintenance blocks.</p></div>' +
        '<button class="px-space-md py-space-xs rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold transition-all shadow-[0_0_16px_rgba(163,230,53,0.25)] border-0 cursor-pointer flex items-center gap-1.5" id="addc" type="button"><span class="material-symbols-outlined text-base">add</span>Add Court</button>' +
      '</div>' +
      '<p class="msg" role="alert" id="cmsg"></p><div id="cform"></div>' +
      '<div class="court-panel">' +
        '<div class="flex items-center justify-between"><div><h3 class="font-headline-sm text-on-surface">Active Courts (' + courts.length + ')</h3><p class="font-body-sm text-on-surface-variant">Courts visible to players for booking slots.</p></div></div>' +
        (courts.length ? '<div class="overflow-x-auto"><table class="w-full text-left font-body-sm text-body-sm"><thead class="text-on-surface-variant font-label-sm uppercase tracking-wider bg-surface-container/60"><tr><th class="py-space-sm px-space-md rounded-l-DEFAULT">Court Details</th><th class="py-space-sm px-space-md">Hourly Rate</th><th class="py-space-sm px-space-md">Hours</th><th class="py-space-sm px-space-md">Slot Duration</th><th class="py-space-sm px-space-md">Status</th><th class="py-space-sm px-space-md rounded-r-DEFAULT text-right">Actions</th></tr></thead><tbody class="divide-y divide-surface-container-high">' +
          courts.map(function (c) {
            return '<tr class="hover:bg-surface-container transition-colors"><td class="py-space-sm px-space-md"><strong>' + esc(c.name) + '</strong><br><span class="font-label-sm text-on-surface-variant">' + esc(c.surface || "Acrylic Pro") + (c.is_indoor ? " • Indoor" : " • Outdoor") +
              (c.qr_path ? " • Dedicated QR" : "") + "</span></td><td class=\"py-space-sm px-space-md font-label-md text-primary font-bold\">" + money(c.hourly_rate) + "/hr</td><td class=\"py-space-sm px-space-md font-label-md\">" + hhmm(c.open_time) + " - " + hhmm(c.close_time) +
              "</td><td class=\"py-space-sm px-space-md\">" + c.slot_minutes + ' min slots</td><td class=\"py-space-sm px-space-md\"><span class="px-space-xs py-0.5 rounded-full font-label-sm ' + (c.status === "active" ? "bg-primary/10 text-primary" : "bg-error/10 text-error") + '">' + esc(c.status.charAt(0).toUpperCase() + c.status.slice(1)) +
              '</span></td><td class="py-space-sm px-space-md text-right whitespace-nowrap"><button class="court-icon-action" data-edit="' + esc(c.id) + '" type="button" title="Edit court" aria-label="Edit ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button> ' +
              '<button class="court-icon-action is-danger" data-del="' + esc(c.id) + '" type="button" title="Delete court" aria-label="Delete ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td></tr>';
          }).join("") + "</tbody></table></div>" : '<p class="text-on-surface-variant font-body-md">No courts listed yet. Add your first court above.</p>') +
      '</div>' +

      '<div class="court-panel">' +
        '<div><h3 class="font-headline-sm text-on-surface">Maintenance &amp; Blocked Windows</h3><p class="font-body-sm text-on-surface-variant">Block courts for coaching clinics, tournaments, or repairs. Times in ' + esc(t.timezone || "Asia/Manila") + '.</p></div>' +
        '<p class="msg" role="alert" id="bmsg"></p>' +
        (courts.length ? '<form id="bform" class="flex flex-wrap items-end gap-space-sm bg-surface-container p-space-md dashboard-rounded border border-outline-variant/20"><label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Court<select id="bc" class="bg-surface-container-high px-3 py-2 dashboard-rounded text-on-surface border border-outline-variant/30">' + courts.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + '</select></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">From<input id="bs" type="datetime-local" required class="bg-surface-container-high px-3 py-2 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">To<input id="be" type="datetime-local" required class="bg-surface-container-high px-3 py-2 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase flex-1 min-w-[200px]">Reason<input id="br" maxlength="120" placeholder="e.g. Surface resurfacing" class="bg-surface-container-high px-3 py-2 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="submit">Block Time</button></form>' : "") +
        (blocks.length ? '<div class="overflow-x-auto"><table class="w-full text-left font-body-sm text-body-sm"><thead class="text-on-surface-variant font-label-sm uppercase tracking-wider bg-surface-container/60"><tr><th class="py-space-sm px-space-md rounded-l-DEFAULT">Court</th><th class="py-space-sm px-space-md">Starts</th><th class="py-space-sm px-space-md">Ends</th><th class="py-space-sm px-space-md">Reason</th><th class="py-space-sm px-space-md rounded-r-DEFAULT text-right">Action</th></tr></thead><tbody class="divide-y divide-surface-container-high">' +
          blocks.map(function (b) {
            return '<tr class="hover:bg-surface-container transition-colors"><td class="py-space-sm px-space-md font-semibold">' + esc((byId[b.court_id] || {}).name || "Court") + "</td><td class=\"py-space-sm px-space-md font-label-md\">" + esc(when(b.starts_at)) + "</td><td class=\"py-space-sm px-space-md font-label-md\">" + esc(when(b.ends_at)) +
              "</td><td class=\"py-space-sm px-space-md text-on-surface-variant\">" + esc(b.reason || "Maintenance") + '</td><td class="py-space-sm px-space-md text-right"><button class="px-3 py-1 rounded-full bg-error/10 hover:bg-error text-error hover:text-on-error font-label-sm border border-error/30 cursor-pointer" data-delb="' + esc(b.id) + '" type="button">Remove</button></td></tr>';
          }).join("") + "</tbody></table></div>" : '<p class="text-on-surface-variant font-body-md">No upcoming blocked windows.</p>') +
      '</div></div>';

    D.ui.dateTimePickers(sec, t.timezone);
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
    box.innerHTML = '<form id="cf" class="bg-surface-container-low p-space-lg dashboard-rounded border border-outline-variant/30 flex flex-col gap-space-md mb-space-lg shadow-lg"><h3 class="font-headline-sm text-on-surface">' + (c ? "Edit Court Configuration" : "New Court Configuration") + "</h3>" +
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Court Name<input id="cn" maxlength="60" required value="' + esc(v.name) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Surface<input id="cs" maxlength="40" placeholder="e.g. Acrylic Pro" value="' + esc(v.surface || "") + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Hourly Rate (PHP)<input id="cr" type="number" min="0" step="0.01" required value="' + esc(v.hourly_rate) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Slot Duration<select id="cm" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + [30, 60, 90, 120].map(function (m) {
          return '<option value="' + m + '"' + (m === v.slot_minutes ? " selected" : "") + ">" + m + " minutes</option>"; }).join("") + "</select></label>" +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Opens<input id="co" type="time" required value="' + esc(hhmm(v.open_time)) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Closes<input id="cc" type="time" required value="' + esc(hhmm(v.close_time)) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Status<select id="cst" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"><option value="active"' + (v.status === "active" ? " selected" : "") + '>Active</option><option value="maintenance"' +
        (v.status === "maintenance" ? " selected" : "") + '>Maintenance (not bookable)</option></select></label>' +
        '<label class="flex items-center gap-2 pt-6 font-body-md text-on-surface cursor-pointer"><input id="ci" type="checkbox"' + (v.is_indoor ? " checked" : "") + ' class="w-4 h-4 accent-primary"> Indoor Cushioned Court</label>' +
      "</div>" +
      '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Dedicated Payment QR for this court (optional, overrides club QR)<input id="cq" type="file" accept="image/jpeg,image/png,image/webp" class="bg-surface-container p-2 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
      (c && c.qr_path ? '<label class="flex items-center gap-2 font-body-sm text-on-surface-variant"><input id="cqx" type="checkbox"> Remove this court\'s custom QR</label>' : "") +
      '<p class="msg" role="alert"></p>' +
      '<div class="flex items-center gap-2 pt-2"><button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="submit">Save Court</button> <button class="px-space-md py-2.5 rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-md border-0 cursor-pointer" id="cx" type="button">Cancel</button></div></form>';

    q("#cx", box).onclick = function () { box.innerHTML = ""; };
    q("#cf", box).onsubmit = async function (e) {
      e.preventDefault();
      var f = q("#cf", box), btn = q("button[type=submit]", f);
      if (val("#co", f) >= val("#cc", f)) return setMsg(f, "Closing time must be after opening time.", "err");
      btn.disabled = true; setMsg(f, "Saving court...", "");
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

  function mediaSelection(card, input, button) {
    var drop = card.querySelector('.media-drop'), filename = card.querySelector('.media-file');
    function preview() {
      var file = input.files[0];
      button.disabled = true;
      try { checkImage(file); } catch (err) { filename.textContent = err.message; return; }
      filename.textContent = file.name + ' - ' + (file.size / 1024 / 1024).toFixed(2) + ' MB';
      var reader = new FileReader();
      reader.onload = function () {
        if (input.files[0] !== file) return;
        var image = document.createElement('img'); image.src = reader.result; image.alt = 'Selected image preview';
        card.querySelector('.media-preview').replaceChildren(image);
        button.disabled = false;
      };
      reader.onerror = function () { filename.textContent = 'Could not preview this image. Choose another file.'; };
      reader.readAsDataURL(file);
    }
    input.onchange = preview;
    ['dragenter', 'dragover'].forEach(function (event) { drop.addEventListener(event, function (e) { e.preventDefault(); drop.classList.add('is-dragging'); }); });
    drop.addEventListener('dragleave', function (e) { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-dragging'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('is-dragging');
      if (!e.dataTransfer.files.length) return;
      var transfer = new DataTransfer(); transfer.items.add(e.dataTransfer.files[0]); input.files = transfer.files; preview();
    });
  }

  // -------------------------------------------------------------- settings
  async function settingsView(sec, part) {
    var t = ctx.t;
    var st = (await sb.from("tenant_settings").select("*").eq("tenant_id", t.id).maybeSingle()).data || {};
    var qrUrl = part === "payments" ? await signedUrl(st.qr_path) : "";
    function mediaCard(key, title, path, hint, url) {
      return '<article class="media-upload ' + (key === 'cover' ? 'is-cover' : '') + '"><header><h3>' + title + '</h3><span>' + (path ? 'Uploaded' : 'Not uploaded') + '</span></header>' +
        '<label class="media-drop" for="' + key + 'f"><input id="' + key + 'f" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose ' + title.toLowerCase() + '">' +
          '<span class="media-preview">' + (path ? '<img src="' + esc(url || D.mediaUrl(path)) + '" alt="Current ' + title.toLowerCase() + '">' : '<span class="material-symbols-outlined" aria-hidden="true">' + (key === 'cover' ? 'panorama' : 'add_photo_alternate') + '</span>') + '</span>' +
          '<span class="media-drop-title">Drop an image here, or <span>browse files</span></span><span class="media-hint">' + hint + '</span><span class="media-file" aria-live="polite">JPG, PNG or WebP - Up to 5 MB</span>' +
        '</label><footer><span>Preview before uploading</span><button id="' + key + 'b" class="media-upload-button" type="button" disabled><span class="material-symbols-outlined" aria-hidden="true">upload</span>Upload ' + (key === 'logo' ? 'logo' : key === 'qr' ? 'QR' : 'cover') + '</button></footer></article>';
    }

    var PANELS = {};
    PANELS.profile =
      '<div class="flex flex-col gap-space-xs pb-space-sm border-b border-outline-variant/20"><h1 class="font-headline-lg text-on-surface">Club Profile</h1><p class="font-body-md text-on-surface-variant">Update venue information, location coordinates, and photography.</p></div>' +
      '<div class="bg-surface-container-low dashboard-rounded p-space-lg shadow-sm border border-outline-variant/20 flex flex-col gap-space-md">' +
        '<form id="pf" class="flex flex-col gap-space-md">' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Club Name<input id="pn" maxlength="80" required value="' + esc(t.name) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<div id="phbox" class="sm:col-span-2"></div>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Contact Phone<input id="pp" value="' + esc(t.contact_phone || "") + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase sm:col-span-2">Contact Email (Reply-To)<input id="pe" type="email" value="' + esc(t.contact_email || "") + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '</div>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Description<textarea id="pd" rows="3" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + esc(t.description || "") + '</textarea></label>' +
          '<p class="msg" role="alert"></p>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer self-start" type="submit">Save Profile</button>' +
        '</form>' +
      '</div>' +
      '<section class="profile-media"><header><h3>Club Media</h3><p>Give players a clear first impression of your club.</p></header><div class="media-upload-grid">' +
        mediaCard('logo', 'Profile logo', t.logo_path, 'Square image recommended ? 400 ? 400 px') +
        mediaCard('cover', 'Cover banner', t.cover_path, 'Wide landscape image recommended') +
      '</div><p class="msg" role="alert" id="phmsg"></p></section>';


    PANELS.payments =
      '<div class="flex flex-col gap-space-xs pb-space-sm border-b border-outline-variant/20"><h1 class="font-headline-lg text-on-surface">Payments &amp; Booking Rules</h1><p class="font-body-md text-on-surface-variant">Configure payment QR, auto-approval workflows, and cancellation cutoff windows.</p></div>' +
      '<div class="bg-surface-container-low dashboard-rounded p-space-lg shadow-sm border border-outline-variant/20 flex flex-col gap-space-md">' +
        '<form id="sf" class="flex flex-col gap-space-md">' +
          '<label class="flex items-center gap-2 font-body-md text-on-surface cursor-pointer p-space-sm dashboard-rounded bg-surface-container border border-outline-variant/20">' +
            '<input id="spe" type="checkbox"' + (st.payment_enabled ? " checked" : "") + ' class="w-4 h-4 accent-primary"> Players pay by scanning QR code at reservation checkout' +
          '</label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Payment Instructions &amp; Bank Details<textarea id="spi" rows="3" placeholder="e.g. GCash 0917 000 0000, please input your booking reference code in the remarks field" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + esc(st.payment_instructions || "") + '</textarea></label>' +
          '<div id="qrmgr" class="qr-manager"></div>' +
          '<label class="flex items-center gap-2 font-body-md text-on-surface cursor-pointer p-space-sm dashboard-rounded bg-surface-container border border-outline-variant/20">' +
            '<input id="sar" type="checkbox"' + (st.approval_required ? " checked" : "") + ' class="w-4 h-4 accent-primary"> Manual approval required for every booking slip' +
          '</label>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Booking Horizon (Days ahead)<input id="sbw" type="number" min="1" max="365" required value="' + esc(st.booking_window_days || 14) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Min Hours Per Booking<input id="smn" type="number" min="0.5" step="0.5" required value="' + esc(st.min_hours || 1) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Max Hours Per Booking<input id="smx" type="number" min="0.5" step="0.5" required value="' + esc(st.max_hours || 4) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Cancellation Cutoff (Hours prior)<input id="scc" type="number" min="0" required value="' + esc(st.cancel_cutoff_hours || 4) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Hold Unpaid Booking (Minutes)<input id="sph" type="number" min="5" max="1440" required value="' + esc(st.pending_hold_minutes || 30) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '</div>' +
          '<p class="msg" role="alert"></p>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer self-start" type="submit">Save Settings</button>' +
        '</form>' +
      '</div>';

    PANELS.staff =
      '<div class="flex flex-col gap-space-xs pb-space-sm border-b border-outline-variant/20"><h1 class="font-headline-lg text-on-surface">Staff &amp; Team Roster</h1><p class="font-body-md text-on-surface-variant">Authorize team members to approve bookings and manage court operations.</p></div>' +
      '<div class="bg-surface-container-low dashboard-rounded p-space-lg shadow-sm border border-outline-variant/20 flex flex-col gap-space-md">' +
        '<div id="stafflist" class="space-y-3"><div class="h-14 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-14 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div>' +
        '<form id="stf" class="flex flex-col sm:flex-row items-end gap-space-sm bg-surface-container p-space-md dashboard-rounded border border-outline-variant/20 mt-space-sm">' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase flex-1">Staff Member Email (must have registered DINKSLOT account)<input id="ste" type="email" required placeholder="staff@example.com" class="bg-surface-container-high px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="submit">Add Staff Member</button>' +
        '</form>' +
        '<p class="msg" role="alert" id="stmsg"></p>' +
      '</div>';

    sec.innerHTML = '<div class="settings-page ' + (part === "profile" ? "club-profile" : "settings-" + esc(part)) + '">' + PANELS[part] + '</div>';

    if (part === "profile") {
      // Philippine address from the PSGC API (js/ph-address.js): manager, street/purok/sitio, province, city, barangay, ZIP
      var phc = D.ph.mount(q("#phbox", sec), { values: t, manager: true, required: true, cls: {
        label: "font-label-sm text-on-surface-variant",
        input: "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30" } });
      q("#pf", sec).onsubmit = async function (e) {
        e.preventDefault();
        var f = this;
        var perr = phc.validate();
        if (perr) return setMsg(f, perr, "err");
        var ad = phc.get();
        var r = await sb.from("tenants").update({ name: val("#pn", f).trim(), city: ad.city, address: ad.address,
          manager_name: ad.manager_name, street: ad.street, barangay: ad.barangay, province: ad.province, zip_code: ad.zip_code,
          psgc_province: ad.psgc_province, psgc_city: ad.psgc_city, psgc_barangay: ad.psgc_barangay,
          contact_phone: val("#pp", f).trim() || null, contact_email: val("#pe", f).trim() || null, description: val("#pd", f).trim() || null }).eq("id", t.id);
        if (r.error) return setMsg(f, friendly(r.error), "err");
        setMsg(f, "Profile saved.", "ok");
      };
      function photoUpload(btnSel, fileSel, col, name) {
        var input = q(fileSel, sec), button = q(btnSel, sec), card = input.closest('.media-upload');
        mediaSelection(card, input, button);
        q(btnSel, sec).onclick = async function () {
          var msg = q("#phmsg", sec), file = q(fileSel, sec).files[0];
          msg.className = "msg"; msg.textContent = "Uploading...";
          button.disabled = true; button.setAttribute("aria-busy", "true");
          try {
            var old = ctx.t[col];
            var path = await upload("club-media", t.id + "/" + name + "-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
            var r = await sb.from("tenants").update((function () { var o = {}; o[col] = path; return o; })()).eq("id", t.id);
            if (r.error) { await removeQuiet("club-media", path); throw r.error; }
            await removeQuiet("club-media", old);
            render(ctx.slug, "profile");
          } catch (err) { msg.className = "msg err"; msg.textContent = friendly(err); }
          finally { button.disabled = false; button.removeAttribute("aria-busy"); }
        };
      }
      photoUpload("#logob", "#logof", "logo_path", "logo");
      photoUpload("#coverb", "#coverf", "cover_path", "cover");
    }

    if (part === "payments") {
      qrManager(q("#qrmgr", sec));
      q("#sf", sec).onsubmit = async function (e) {
        e.preventDefault();
        var f = this;
        var r = await sb.from("tenant_settings").update({
          payment_enabled: q("#spe", f).checked, payment_instructions: val("#spi", f).trim() || null,
          approval_required: q("#sar", f).checked, booking_window_days: num("#sbw", f),
          min_hours: num("#smn", f), max_hours: num("#smx", f), cancel_cutoff_hours: num("#scc", f),
          pending_hold_minutes: num("#sph", f)
        }).eq("tenant_id", t.id);
        if (r.error) return setMsg(f, friendly(r.error), "err");
        setMsg(f, "Payment and booking settings saved.", "ok");
      };
    }

    if (part === "staff") {
      async function loadStaff() {
        var box = q("#stafflist", sec);
        var r = await sb.rpc("list_tenant_staff", { p_tenant_id: t.id });
        if (r.error) { box.innerHTML = '<p class="text-error">' + esc(friendly(r.error)) + "</p>"; return; }
        box.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-left font-body-sm text-body-sm"><thead class="text-on-surface-variant font-label-sm uppercase tracking-wider bg-surface-container/60"><tr><th class="py-space-sm px-space-md rounded-l-DEFAULT">Team Member</th><th class="py-space-sm px-space-md">Role</th><th class="py-space-sm px-space-md rounded-r-DEFAULT text-right">Actions</th></tr></thead><tbody class="divide-y divide-surface-container-high">' + (r.data || []).map(function (m) {
          return '<tr class="hover:bg-surface-container transition-colors"><td class="py-space-sm px-space-md"><strong>' + esc(m.full_name || "Staff Member") + '</strong><br><span class="font-label-sm text-on-surface-variant">' + esc(m.email) + '</span></td><td class="py-space-sm px-space-md"><span class="px-space-xs py-0.5 rounded-full font-label-sm ' + (m.role === "owner" ? "bg-primary/10 text-primary font-bold" : "bg-surface-container-highest text-on-surface") + '">' + esc(m.role.charAt(0).toUpperCase() + m.role.slice(1)) + "</span></td><td class=\"py-space-sm px-space-md text-right\">" +
            (m.role === "staff" ? '<button class="px-3 py-1 rounded-full bg-error/10 hover:bg-error text-error hover:text-on-error font-label-sm border border-error/30 cursor-pointer" data-rm="' + esc(m.member_id) + '" type="button">Remove</button>' : '<span class="font-label-sm text-outline">Owner Account</span>') + "</td></tr>";
        }).join("") + "</tbody></table></div>";
        Array.prototype.forEach.call(box.querySelectorAll("[data-rm]"), function (b) {
          b.onclick = async function () {
            if (!confirm("Remove this staff member from your facility?")) return;
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
        msg.className = "msg ok"; msg.textContent = "Staff member successfully added.";
        q("#ste", sec).value = "";
        loadStaff();
      };
    }
  }

  // ------------------------------------------------------------ my profile
  // Personal details (own row only) and the user's own bookings as a player.
  async function accountView(sec) {
    sec.innerHTML = '<div class="settings-page settings-account">' +
      '<div class="flex flex-col gap-space-xs pb-space-sm border-b border-outline-variant/20"><h1 class="font-headline-lg text-on-surface">My Account</h1><p class="font-body-md text-on-surface-variant">Your personal staff credentials and private match history.</p></div>' +
      '<div class="bg-surface-container-low dashboard-rounded p-space-lg shadow-sm border border-outline-variant/20 flex flex-col gap-space-md">' +
        '<form id="myprofile" class="flex flex-col gap-space-md">' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Full Name<input id="mp-name" maxlength="80" autocomplete="name" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Phone<input id="mp-phone" maxlength="30" autocomplete="tel" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '</div>' +
          '<p class="font-body-sm text-on-surface-variant">Signed in as: <strong class="text-on-surface">' + esc(D.state.user.email) + '</strong></p>' +
          '<p class="msg" role="alert"></p>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer self-start" type="submit">Save Profile</button>' +
        '</form>' +
      '</div>' +
      '<div class="bg-surface-container-low dashboard-rounded p-space-lg shadow-sm border border-outline-variant/20 flex flex-col gap-space-md">' +
        '<div><h3 class="font-headline-sm text-on-surface">Personal Court Bookings</h3><p class="font-body-sm text-on-surface-variant">Courts you personally reserved across DINKSLOT.</p></div>' +
        '<div id="mybookings" class="space-y-3"><div class="h-16 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-16 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div>' +
      '</div></div>';

    var r = await sb.from("profiles").select("full_name,phone").eq("auth_user_id", D.state.user.id).maybeSingle();
    if (q("#mp-name", sec)) {
      q("#mp-name", sec).value = (r.data && r.data.full_name) || "";
      q("#mp-phone", sec).value = (r.data && r.data.phone) || "";
    }
    q("#myprofile", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = q("button", f);
      btn.disabled = true;
      var x = await sb.from("profiles").update({ full_name: val("#mp-name", f).trim() || null, phone: val("#mp-phone", f).trim() || null })
        .eq("auth_user_id", D.state.user.id);
      btn.disabled = false;
      setMsg(f, x.error ? friendly(x.error) : "Profile saved.", x.error ? "err" : "ok");
    };
    if (D.booking) D.booking.myBookings(q("#mybookings", sec));
  }

  // ------------------------------------------- payment QR codes (several, each on or off)
  // Players see only the ACTIVE ones at checkout and say which one they paid with.
  async function qrManager(box) {
    var t = ctx.t;
    function say(el, text, kind) { var m = el.querySelector(".msg"); if (m) { m.className = "msg " + (kind || ""); m.textContent = text || ""; } }
    function oops(err) { return /too_many_qrs/.test((err && err.message) || "") ? "You can have up to 8 payment methods." : friendly(err); }
    var fieldCls = "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30";
    var lblCls = "flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase";

    async function load() {
      box.innerHTML = '<p class="muted small">Loading payment methods...</p>';
      var r = await sb.from("payment_qrs").select("*").eq("tenant_id", t.id).is("deleted_at", null).order("sort_order").order("created_at");
      var rows = r.data || [], urls = {};
      if (rows.length) {
        var su = await sb.storage.from("payment").createSignedUrls(rows.map(function (x) { return x.qr_path; }), 300);
        (su.data || []).forEach(function (x) { if (x.path && x.signedUrl) urls[x.path] = x.signedUrl; });
      }
      draw(rows, urls);
    }

    function draw(rows, urls) {
      var active = rows.filter(function (x) { return x.is_active; }).length;
      box.innerHTML =
        '<div class="qr-head"><div><h3>Payment methods (QR codes)</h3><p class="muted small">Add every QR you accept (GCash, Maya, bank). Players see only the ones switched on, and pick the one they paid with. ' +
        (active ? active + " of " + rows.length + " active." : (rows.length ? "None are active right now." : "None added yet.")) + "</p></div></div>" +
        '<div class="qr-list">' + rows.map(function (x) {
          return '<div class="qrcard' + (x.is_active ? "" : " off") + '" data-id="' + esc(x.id) + '">' +
            (urls[x.qr_path] ? '<img class="qrthumb" src="' + esc(urls[x.qr_path]) + '" alt="QR for ' + esc(x.label) + '">' : '<div class="qrthumb ph"></div>') +
            '<div class="qrbody"><div class="qrtop"><b>' + esc(x.label) + '</b><label class="qrswitch"><input type="checkbox" data-act="toggle"' + (x.is_active ? " checked" : "") + '><span>' + (x.is_active ? "Active" : "Inactive") + "</span></label></div>" +
            '<div class="grid2"><label class="' + lblCls + '">Label<input data-f="label" maxlength="40" value="' + esc(x.label) + '" class="' + fieldCls + '"></label>' +
            '<label class="' + lblCls + '">Account name<input data-f="account_name" maxlength="80" value="' + esc(x.account_name || "") + '" class="' + fieldCls + '"></label>' +
            '<label class="' + lblCls + '">Account number<input data-f="account_number" maxlength="60" value="' + esc(x.account_number || "") + '" class="' + fieldCls + '"></label></div>' +
            '<div class="qract"><button type="button" class="btn sm" data-act="save">Save details</button>' +
            '<label class="btn sm ghost qrfile">Replace image<input type="file" data-act="replace" accept="image/jpeg,image/png,image/webp" hidden></label>' +
            '<button type="button" class="btn sm danger" data-act="delete">Delete</button></div><p class="msg" role="alert"></p></div></div>';
        }).join("") + "</div>" +
        '<form id="qradd" class="qradd"><h4>Add a payment method</h4><div class="grid2">' +
        '<label class="' + lblCls + '">Label *<input id="qa-label" maxlength="40" placeholder="e.g. GCash" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + '">Account name<input id="qa-name" maxlength="80" placeholder="Name on the account" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + '">Account number<input id="qa-number" maxlength="60" placeholder="Number shown to players" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + '">QR image *<input id="qa-file" type="file" accept="image/jpeg,image/png,image/webp" class="' + fieldCls + '"></label></div>' +
        '<p class="msg" role="alert"></p><button class="btn sm" type="submit">Add QR</button></form>';

      var byId = {}; rows.forEach(function (x) { byId[x.id] = x; });
      Array.prototype.forEach.call(box.querySelectorAll(".qrcard"), function (card) {
        var row = byId[card.getAttribute("data-id")];
        card.querySelector('[data-act="toggle"]').onchange = async function () {
          this.disabled = true;
          var x = await sb.from("payment_qrs").update({ is_active: this.checked }).eq("id", row.id);
          if (x.error) { this.checked = !this.checked; this.disabled = false; return say(card, oops(x.error), "err"); }
          load();
        };
        card.querySelector('[data-act="save"]').onclick = async function () {
          var f = function (k) { return card.querySelector('[data-f="' + k + '"]').value.trim(); };
          if (!f("label")) return say(card, "The label cannot be empty.", "err");
          var x = await sb.from("payment_qrs").update({ label: f("label"), account_name: f("account_name") || null, account_number: f("account_number") || null }).eq("id", row.id);
          if (x.error) return say(card, oops(x.error), "err");
          say(card, "Saved.", "ok");
        };
        card.querySelector('[data-act="replace"]').onchange = async function () {
          var file = this.files[0];
          try {
            var path = await upload("payment", t.id + "/qr/" + row.id + "-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
            var x = await sb.from("payment_qrs").update({ qr_path: path }).eq("id", row.id);
            if (x.error) { await removeQuiet("payment", path); throw x.error; }
            await removeQuiet("payment", row.qr_path);
            load();
          } catch (err) { say(card, oops(err), "err"); }
        };
        card.querySelector('[data-act="delete"]').onclick = async function () {
          if (!confirm('Delete the payment method "' + row.label + '"? Players will no longer see it.')) return;
          var x = await sb.rpc("delete_payment_qr", { p_id: row.id });
          if (x.error) return say(card, oops(x.error), "err");
          await removeQuiet("payment", row.qr_path);
          load();
        };
      });
      q("#qradd", box).onsubmit = async function (e) {
        e.preventDefault();
        var f = this, label = q("#qa-label", f).value.trim(), file = q("#qa-file", f).files[0];
        if (!label) return say(f, "Enter a label, for example GCash.", "err");
        try {
          var path = await upload("payment", t.id + "/qr/new-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
          var x = await sb.from("payment_qrs").insert({ tenant_id: t.id, label: label, account_name: q("#qa-name", f).value.trim() || null,
            account_number: q("#qa-number", f).value.trim() || null, qr_path: path, sort_order: rows.length });
          if (x.error) { await removeQuiet("payment", path); throw x.error; }
          load();
        } catch (err) { say(f, oops(err), "err"); }
      };
    }
    load();
  }

  D.admin = { render: render };
})();
