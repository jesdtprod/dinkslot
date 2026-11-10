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
          '<a class="inline-flex items-center gap-space-xs bg-primary hover:bg-primary-fixed text-on-primary font-bold px-space-lg py-space-sm rounded-full font-label-md text-label-md shadow-[0_0_20px_rgba(163,230,53,0.35)] transition-all no-underline" href="#/admin/' + esc(ctx.slug) + '/bookings?new=1">' +
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
              (c.qr_path ? " • Dedicated QR" : "") + "</span></td><td class=\"py-space-sm px-space-md font-label-md text-primary font-bold\">" + money(c.hourly_rate) + "/hr</td><td class=\"py-space-sm px-space-md font-label-md\">" + D.hoursText(c.open_time, c.close_time) +
              "</td><td class=\"py-space-sm px-space-md\">" + c.slot_minutes + ' min slots</td><td class=\"py-space-sm px-space-md\"><span class="px-space-xs py-0.5 rounded-full font-label-sm ' + (c.status === "active" ? "bg-primary/10 text-primary" : "bg-error/10 text-error") + '">' + esc(c.status.charAt(0).toUpperCase() + c.status.slice(1)) +
              '</span></td><td class="py-space-sm px-space-md text-right whitespace-nowrap"><button class="court-icon-action" data-edit="' + esc(c.id) + '" type="button" title="Edit court" aria-label="Edit ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button> ' +
              '<button class="court-icon-action is-danger" data-del="' + esc(c.id) + '" type="button" title="Delete court" aria-label="Delete ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td></tr>';
          }).join("") + "</tbody></table></div>" : D.ui.emptyState('No courts yet', 'Add your first court to configure pricing and availability.', 'sports_tennis')) +
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
              "</td><td class=\"py-space-sm px-space-md text-on-surface-variant\">" + esc(b.reason || "Maintenance") + '</td><td class="py-space-sm px-space-md text-right"><button class="court-icon-action is-danger" title="Remove blocked window" aria-label="Remove blocked window" data-delb="' + esc(b.id) + '" type="button"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td></tr>';
          }).join("") + "</tbody></table></div>" : '<div class="court-blocks-empty"><span class="material-symbols-outlined" aria-hidden="true">event_available</span><div><strong>No blocked windows</strong><p>Scheduled maintenance and court closures will appear here.</p></div></div>') +
      '</div></div>';

    D.ui.dateTimePickers(sec, t.timezone);
    q("#addc", sec).onclick = function () { courtForm(null, byId); };
    Array.prototype.forEach.call(sec.querySelectorAll("[data-edit]"), function (b) {
      b.onclick = function () { courtForm(byId[b.getAttribute("data-edit")], byId); };
    });
    Array.prototype.forEach.call(sec.querySelectorAll("[data-del]"), function (b) {
      b.onclick = async function () {
        var c = byId[b.getAttribute("data-del")];
        if (!await D.ui.confirmAction('Delete court "' + c.name + '"? This cannot be undone.', { title: 'Delete court', confirmText: 'Delete court' })) return;
        var r = await sb.rpc("delete_court", { p_court_id: c.id });
        if (r.error) return setMsg(sec, r.error.message.indexOf("court_has_bookings") !== -1
          ? "This court has upcoming bookings. Cancel them first, or set it to maintenance." : friendly(r.error), "err");
        await removeQuiet("payment", c.qr_path);
        courtsView(sec);
      };
    });
    Array.prototype.forEach.call(sec.querySelectorAll("[data-delb]"), function (b) {
      b.onclick = async function () {
        if (!await D.ui.confirmAction("Remove this blocked window? Players will be able to book this time again.", { title: "Remove blocked window", confirmText: "Remove block" })) return;
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
    var box = q("#cform"), previousFocus = document.activeElement;
    var v = c || { name: "", surface: "", is_indoor: false, hourly_rate: "", slot_minutes: 60, open_time: "06:00", close_time: "22:00", status: "active" };
    box.innerHTML = '<dialog class="court-config-modal" aria-labelledby="court-config-title"><form id="cf" class="bg-surface-container-low p-space-lg dashboard-rounded border border-outline-variant/30 flex flex-col gap-space-md mb-space-lg shadow-lg"><header class="court-config-heading"><div><span class="court-config-caption">Court settings</span><h3 id="court-config-title" class="font-headline-sm text-on-surface">' + (c ? "Edit Court Configuration" : "New Court Configuration") + '</h3><p>Configure court details, availability, and payment options.</p></div><button class="court-config-close" type="button" aria-label="Close court configuration"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header><div class="court-config-body">' +
      '<section class="court-details-section"><div class="court-section-title"><span></span>Court details</div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">' +
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
      "</div></section>" +
      '<div class="court-qr-upload"><div class="court-qr-heading"><strong>Court payment QR</strong><span>Optional</span></div><p>Use a separate QR for this court, or leave it empty to use the club QR.</p>' +
        '<label class="court-qr-drop" for="cq"><input id="cq" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose court payment QR image"><span class="court-qr-preview"><span class="material-symbols-outlined" aria-hidden="true">qr_code_2</span></span><span class="court-qr-copy"><span>Drop a QR image here, or <u>browse files</u></span><small>JPG, PNG or WebP - Up to 5 MB</small><span class="court-qr-filename" aria-live="polite">No image selected</span></span></label></div>' +
      (c && c.qr_path ? '<label class="flex items-center gap-2 font-body-sm text-on-surface-variant"><input id="cqx" type="checkbox"> Remove this court\'s custom QR</label>' : "") +
      '<p class="msg" role="alert"></p>' +
      '</div><div class="court-config-actions"><button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="submit">Save Court</button> <button class="px-space-md py-2.5 rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-md border-0 cursor-pointer" id="cx" type="button">Cancel</button></div></form></dialog>';

    var modal = q("dialog", box);
    function close() { modal.close(); }
    q("#cx", box).onclick = close;
    q(".court-config-close", box).onclick = close;
    modal.addEventListener("close", function () { if (previousFocus && previousFocus.isConnected) previousFocus.focus(); });
    modal.addEventListener("click", function (event) {
      if (event.target !== modal) return;
      var rect = modal.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    modal.showModal();
    D.ui.timePickers(box);
    var qrInput = q("#cq", box), qrDrop = q(".court-qr-drop", box);
    qrInput.onchange = function () {
      var file = qrInput.files[0], filename = q(".court-qr-filename", box);
      if (!file) { filename.textContent = "No image selected"; return; }
      try { checkImage(file); } catch (err) { qrInput.value = ""; filename.textContent = err.message; return; }
      filename.textContent = file.name;
      var reader = new FileReader();
      reader.onload = function () {
        if (qrInput.files[0] !== file) return;
        var image = document.createElement("img"); image.src = reader.result; image.alt = "Selected court QR preview";
        q(".court-qr-preview", box).replaceChildren(image);
      };
      reader.readAsDataURL(file);
    };
    ["dragenter", "dragover"].forEach(function (type) { qrDrop.addEventListener(type, function (event) { event.preventDefault(); qrDrop.classList.add("is-dragging"); }); });
    qrDrop.addEventListener("dragleave", function (event) { if (!qrDrop.contains(event.relatedTarget)) qrDrop.classList.remove("is-dragging"); });
    qrDrop.addEventListener("drop", function (event) {
      event.preventDefault(); qrDrop.classList.remove("is-dragging");
      if (!event.dataTransfer.files.length) return;
      var transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]); qrInput.files = transfer.files; qrInput.onchange();
    });
    q("#cf", box).onsubmit = async function (e) {
      e.preventDefault();
      var f = q("#cf", box), btn = q("button[type=submit]", f);
      if (val("#cc", f) !== "00:00" && val("#co", f) >= val("#cc", f)) return setMsg(f, "Closing time must be after opening time. To close at midnight choose 12:00 AM.", "err");
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
        modal.close();
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
          '<section class="club-map-settings"><header><span class="material-symbols-outlined" aria-hidden="true">location_on</span><div><h3>Google Maps Location</h3><p>Save your court?s exact location so players can find your club.</p></div></header><div class="club-map-fields">' +
            '<label>Latitude<input id="plat" type="number" min="-90" max="90" step="any" placeholder="e.g. 14.5995" value="' + esc(t.latitude == null ? '' : t.latitude) + '"></label>' +
            '<label>Longitude<input id="plng" type="number" min="-180" max="180" step="any" placeholder="e.g. 120.9842" value="' + esc(t.longitude == null ? '' : t.longitude) + '"></label></div>' +
            '<p class="club-map-help">In Google Maps, right-click your venue and copy its coordinates. Paste the latitude and longitude below.</p><label>Paste coordinates<input id="pcoords" type="text" placeholder="14.5995, 120.9842" autocomplete="off"></label><div class="club-map-actions"><button id="use-club-location" type="button">Use Current Location</button><a id="open-club-map" class="btn ghost" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">View on Google Maps</a></div><p id="club-map-status"></p></section>' +
          '<p class="msg" role="alert"></p>' +
          '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer self-start" type="submit">Save Profile</button>' +
        '</form>' +
      '</div>' +
      '<section class="profile-media"><header><h3>Club Media</h3><p>Give players a clear first impression of your club.</p></header><div class="media-upload-grid">' +
        mediaCard('logo', 'Profile logo', t.logo_path, 'Square image recommended ? 400 ? 400 px') +
        mediaCard('cover', 'Cover banner', t.cover_path, 'Wide landscape image recommended') +
      '</div><p class="msg" role="alert" id="phmsg"></p></section>';


    PANELS.payments =
      '<div class="flex flex-col gap-space-xs pb-space-sm border-b border-outline-variant/20"><h1 class="font-headline-lg text-on-surface">Payments &amp; Booking Rules</h1><p class="font-body-md text-on-surface-variant">Set how players pay, which QR codes they can use, and your booking rules.</p></div>' +
      // The settings form is empty on purpose: fields in the sections below belong to it through the form="paycfg"
      // attribute, so the QR cards (which sit between them) are NOT inside a form and Enter never saves settings by accident.
      '<form id="paycfg"></form>' +
      '<div class="pay-sections">' +

      // ---- 1. checkout -------------------------------------------------------------------------------------------
      '<section class="pay-card"><header><h2>1. Checkout</h2><p>What players see when they pay for a booking.</p></header>' +
        '<label class="pay-toggle"><input id="spe" form="paycfg" type="checkbox"' + (st.payment_enabled ? " checked" : "") + '><span><b>Players pay by scanning a QR code</b><small>Turn off if you collect payment another way. Players then only send a booking request.</small></span></label>' +
        '<label class="pay-toggle"><input id="sar" form="paycfg" type="checkbox"' + (st.approval_required ? " checked" : "") + '><span><b>I approve every booking myself</b><small>Recommended. You check the payment proof, then approve or reject.</small></span></label>' +
        '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Payment instructions shown to players<textarea id="spi" form="paycfg" rows="3" placeholder="e.g. Send the exact amount and type your booking code in the message" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + esc(st.payment_instructions || "") + '</textarea></label>' +
      '</section>' +

      // ---- 2. payment methods (cards live here, outside the form) -------------------------------------------------------
      '<section class="pay-card"><div id="qrmgr" class="qr-manager"></div></section>' +

      // ---- 3. booking rules ---------------------------------------------------------------------------------------------
      '<section class="pay-card"><header><h2>3. Booking rules</h2><p>Limits players must follow when they book.</p></header>' +
        '<div class="pay-rules">' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Book up to (days ahead)<input id="sbw" form="paycfg" type="number" min="1" max="365" required value="' + esc(st.booking_window_days || 14) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Minimum hours<input id="smn" form="paycfg" type="number" min="0.5" step="0.5" required value="' + esc(st.min_hours || 1) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Maximum hours<input id="smx" form="paycfg" type="number" min="0.5" step="0.5" required value="' + esc(st.max_hours || 4) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Cancel allowed until (hours before)<input id="scc" form="paycfg" type="number" min="0" required value="' + esc(st.cancel_cutoff_hours || 4) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Hold an unpaid booking (minutes)<input id="sph" form="paycfg" type="number" min="5" max="1440" required value="' + esc(st.pending_hold_minutes || 30) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
        '</div>' +
      '<div class="pay-actions"><p class="msg" role="alert"></p><button form="paycfg" class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="submit">Save settings</button><span class="muted small">Saves the Checkout and Booking rules sections. QR cards save on their own.</span></div>' +
      '</section></div>';

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
      function updateMapLink() {
        var lat = val('#plat', sec), lng = val('#plng', sec);
        var valid = lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
        q('#open-club-map', sec).href = valid ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng) : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([t.name,t.address,t.city,'Philippines'].filter(Boolean).join(', '));
        q('#club-map-status', sec).textContent = valid ? 'Location selected. Save Profile to keep these coordinates.' : 'No exact location selected.';
      }
      q('#plat', sec).oninput = updateMapLink; q('#plng', sec).oninput = updateMapLink;
      q('#pcoords', sec).onchange = function () {
        var parts = this.value.trim().split(/\s*,\s*/);
        if (parts.length !== 2 || parts.some(function (part) { return !part || !Number.isFinite(Number(part)); }) || Math.abs(Number(parts[0])) > 90 || Math.abs(Number(parts[1])) > 180) return D.ui.toast('Enter valid latitude and longitude separated by a comma.', 'err');
        q('#plat', sec).value = parts[0]; q('#plng', sec).value = parts[1]; updateMapLink();
      };
      q('#use-club-location', sec).onclick = function () {
        var button = this;
        if (!navigator.geolocation) return D.ui.toast('Location services are not available in this browser.', 'err');
        button.disabled = true;
        navigator.geolocation.getCurrentPosition(function (position) {
          if (!sec.isConnected) return;
          q('#plat', sec).value = position.coords.latitude.toFixed(6); q('#plng', sec).value = position.coords.longitude.toFixed(6); updateMapLink(); button.disabled = false;
        }, function () { button.disabled = false; D.ui.toast('Unable to access your location. Enter your venue coordinates manually.', 'err'); }, { enableHighAccuracy: true, timeout: 12000 });
      };
      updateMapLink();
      q("#pf", sec).onsubmit = async function (e) {
        e.preventDefault();
        if ((val("#plat", this) === "") !== (val("#plng", this) === "")) return D.ui.toast("Enter both latitude and longitude, or leave both fields empty.", "err");
        var f = this;
        var perr = phc.validate();
        if (perr) return setMsg(f, perr, "err");
        var ad = phc.get();
        var r = await sb.from("tenants").update({ name: val("#pn", f).trim(), city: ad.city, address: ad.address,
          manager_name: ad.manager_name, street: ad.street, barangay: ad.barangay, province: ad.province, zip_code: ad.zip_code,
          psgc_province: ad.psgc_province, psgc_city: ad.psgc_city, psgc_barangay: ad.psgc_barangay,
          latitude: val("#plat", f) === "" ? null : num("#plat", f), longitude: val("#plng", f) === "" ? null : num("#plng", f),
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
      q("#paycfg", sec).onsubmit = async function (e) {
        e.preventDefault();
        var box = q(".pay-actions", sec);
        if (num("#smx", sec) < num("#smn", sec)) return setMsg(box, "Maximum hours must be at least the minimum hours.", "err");
        var r = await sb.from("tenant_settings").update({
          payment_enabled: q("#spe", sec).checked, payment_instructions: val("#spi", sec).trim() || null,
          approval_required: q("#sar", sec).checked, booking_window_days: num("#sbw", sec),
          min_hours: num("#smn", sec), max_hours: num("#smx", sec), cancel_cutoff_hours: num("#scc", sec),
          pending_hold_minutes: num("#sph", sec)
        }).eq("tenant_id", t.id);
        if (r.error) return setMsg(box, friendly(r.error), "err");
        setMsg(box, "Settings saved.", "ok");
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
            if (!await D.ui.confirmAction("Remove this staff member from your facility? They will lose staff access.", { title: "Remove staff member", confirmText: "Remove staff" })) return;
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

  // ------------------------------------------------------- QR image check (is it really a QR code?)
  // Reads the image in the browser before it is saved. BarcodeDetector where the browser has it,
  // otherwise the small jsQR library (loaded on demand). Returns {status: "ok" | "none" | "unverified"}.
  var jsQRLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsQRLoading) jsQRLoading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      var timer = setTimeout(function () { jsQRLoading = null; rej(new Error("scanner timeout")); }, 10000); // never hang the form
      s.onload = function () { clearTimeout(timer); res(window.jsQR); }; s.onerror = function () { clearTimeout(timer); jsQRLoading = null; rej(new Error("scanner")); };
      document.head.appendChild(s);
    });
    return jsQRLoading;
  }
  async function scanQr(file) {
    var bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { return { status: "none" }; }
    var scales = [1, 0.5, 0.25], canvas = document.createElement("canvas"), cx = canvas.getContext("2d", { willReadFrequently: true });
    var detector = null;
    try { if ("BarcodeDetector" in window) detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
    var jq = null, scannerFailed = false;
    for (var i = 0; i < scales.length; i++) {
      var w = Math.max(60, Math.round(Math.min(bmp.width, 1600) * scales[i])), h = Math.max(60, Math.round(bmp.height * (w / bmp.width)));
      canvas.width = w; canvas.height = h; cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
      if (detector) { try { var r = await detector.detect(canvas); if (r && r.length) return { status: "ok" }; } catch (e) { /* try the library */ } }
      if (!jq && !scannerFailed) { try { jq = await loadJsQR(); } catch (e) { scannerFailed = true; } }
      if (jq) { var d = cx.getImageData(0, 0, w, h); if (jq(d.data, w, h, { inversionAttempts: "attemptBoth" })) return { status: "ok" }; }
    }
    return { status: scannerFailed && !detector ? "unverified" : "none" };
  }

  // ------------------------------------------------ payment QR cards (fixed slots, each on or off)
  // Every club has 9 cards: 3 GCash, 3 Maya, 3 Bank account. One card = one account. All start inactive.
  // The owner fills a card in, uploads its QR (checked to be a real QR code) and switches it on.
  // Players see only the active cards at checkout and say which one they paid with.
  async function qrManager(box) {
    var t = ctx.t, flash = "";
    var KINDS = [["gcash", "GCash"], ["maya", "Maya"], ["bank", "Bank account"]];
    var fieldCls = "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30";
    var lblCls = "flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase";
    function say(el, text, kind) { var m = el.querySelector(".msg"); if (m) { m.className = "msg " + (kind || ""); m.textContent = text || ""; } }

    async function load() {
      box.innerHTML = '<p class="muted small">Loading payment cards...</p>';
      var r = await sb.from("payment_qrs").select("*").eq("tenant_id", t.id).is("deleted_at", null).order("sort_order");
      var rows = r.data || [], urls = {};
      var paths = rows.filter(function (x) { return x.qr_path; }).map(function (x) { return x.qr_path; });
      if (paths.length) {
        var su = await sb.storage.from("payment").createSignedUrls(paths, 300);
        (su.data || []).forEach(function (x) { if (x.path && x.signedUrl) urls[x.path] = x.signedUrl; });
      }
      draw(rows, urls);
    }

    function cardHtml(x, urls) {
      var kindName = KINDS.filter(function (k) { return k[0] === x.kind; })[0][1];
      return '<div class="qrcard' + (x.is_active ? "" : " off") + '" data-id="' + esc(x.id) + '">' +
        '<div class="qrthumbbox">' + (x.qr_path && urls[x.qr_path] ? '<img class="qrthumb" src="' + esc(urls[x.qr_path]) + '" alt="QR for ' + esc(x.label) + '">' : '<div class="qrthumb empty"><span>No QR yet</span></div>') + "</div>" +
        '<div class="qrbody"><div class="qrtop"><b>' + esc(kindName) + " " + x.slot + '</b>' +
        '<label class="qrswitch" title="' + (x.qr_path ? "Show this card to players" : "Upload a QR image first") + '"><input type="checkbox" data-act="toggle"' + (x.is_active ? " checked" : "") + (x.qr_path ? "" : " disabled") + '><span>' + (x.is_active ? "Active" : "Inactive") + "</span></label></div>" +
        '<div class="grid2"><label class="' + lblCls + '">Label players see<input data-f="label" maxlength="40" value="' + esc(x.label) + '" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + '">Account name<input data-f="account_name" maxlength="80" value="' + esc(x.account_name || "") + '" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + ' ph-wide">' + (x.kind === "bank" ? "Bank and account number" : "Mobile number") + '<input data-f="account_number" maxlength="60" value="' + esc(x.account_number || "") + '" class="' + fieldCls + '"></label></div>' +
        '<label class="' + lblCls + '">QR image' + (x.qr_path ? " (choose a file to replace it)" : "") + '<input type="file" data-act="file" accept="image/jpeg,image/png,image/webp" class="' + fieldCls + '"></label>' +
        '<div class="qract"><button type="button" class="btn sm" data-act="save">Save card</button>' +
        '<button type="button" class="btn sm danger" data-act="clear">Clear card</button></div><p class="msg" role="alert"></p></div></div>';
    }

    var curKind = "gcash", lastRows = [], lastUrls = {};
    function draw(rows, urls) {
      lastRows = rows; lastUrls = urls;
      var active = rows.filter(function (x) { return x.is_active; }).length;
      var count = function (k) { return rows.filter(function (x) { return x.kind === k && x.is_active; }).length; };
      var list = rows.filter(function (x) { return x.kind === curKind; }).sort(function (p, q2) { return p.slot - q2.slot; });
      box.innerHTML =
        '<header class="qr-head"><h2>2. Payment methods (QR codes)</h2><p>Three cards each for GCash, Maya and bank accounts. One card is one account. Fill in a card, upload its QR and switch it on. Players see only the active cards.</p>' +
        '<span class="qr-count' + (active ? " has" : "") + '">' + active + " of 9 active</span></header>" +
        '<div class="qr-tabs" role="tablist">' + KINDS.map(function (k) {
          return '<button type="button" role="tab" class="qr-tab' + (k[0] === curKind ? " on" : "") + '" data-kind="' + k[0] + '" aria-selected="' + (k[0] === curKind) + '">' + esc(k[1]) +
            '<small>' + count(k[0]) + " / 3 active</small></button>"; }).join("") + "</div>" +
        '<div class="qr-list">' + list.map(function (x) { return cardHtml(x, urls); }).join("") + "</div>";
      if (flash) D.ui.toast(flash, "ok");
      flash = "";
      Array.prototype.forEach.call(box.querySelectorAll(".qr-tab"), function (b) {
        b.onclick = function () { curKind = b.getAttribute("data-kind"); draw(lastRows, lastUrls); };
      });

      var byId = {}; rows.forEach(function (x) { byId[x.id] = x; });
      Array.prototype.forEach.call(box.querySelectorAll(".qrcard"), function (card) {
        var row = byId[card.getAttribute("data-id")];
        var fileEl = card.querySelector('[data-act="file"]'), scan = null;
        var val = function (k) { return card.querySelector('[data-f="' + k + '"]').value.trim(); };

        // check the image the moment it is chosen
        fileEl.onchange = async function () {
          scan = null; var file = this.files[0];
          if (!file) return say(card, "", "");
          if (!TYPES[file.type]) { this.value = ""; return say(card, "Only JPG, PNG or WebP images are allowed.", "err"); }
          if (file.size > MAX_BYTES) { this.value = ""; return say(card, "The image must be 5 MB or smaller.", "err"); }
          var box2 = card.querySelector(".qrthumbbox");
          box2.innerHTML = '<img class="qrthumb" src="' + URL.createObjectURL(file) + '" alt="Preview">';
          say(card, "Checking that this is a QR code...", "");
          scan = await scanQr(file);
          if (scan.status === "ok") say(card, "QR code detected. Click Save card to keep it.", "ok");
          else if (scan.status === "none") say(card, "No QR code found in this image. Use a clear screenshot of the whole QR code.", "err");
          else say(card, "This browser could not check the QR code. You can still save it, so test it with a real payment.", "");
        };

        card.querySelector('[data-act="toggle"]').onchange = async function () {
          var on = this.checked; this.disabled = true;
          var x = await sb.from("payment_qrs").update({ is_active: on }).eq("id", row.id);
          if (x.error) { this.checked = !on; this.disabled = false; return say(card, friendly(x.error), "err"); }
          flash = row.label + " is now " + (on ? "active. Players can pay with it." : "inactive. Players no longer see it.");
          load();
        };

        card.querySelector('[data-act="save"]').onclick = async function () {
          var btn = this, file = fileEl.files[0];
          if (!val("label")) return say(card, "The label cannot be empty.", "err");
          if (file && scan && scan.status === "none") return say(card, "This image has no readable QR code. Choose another image.", "err");
          btn.disabled = true;
          try {
            var path = row.qr_path, checked = false;
            if (file) {
              if (!scan) { say(card, "Checking that this is a QR code...", ""); scan = await scanQr(file); }
              if (scan.status === "none") throw new Error("This image has no readable QR code. Choose another image.");
              checked = scan.status === "ok";
              say(card, "Uploading...", "");
              path = await upload("payment", t.id + "/qr/" + row.id + "-" + Date.now() + "." + TYPES[file.type], file);
            }
            var x = await sb.from("payment_qrs").update({ label: val("label"), account_name: val("account_name") || null, account_number: val("account_number") || null, qr_path: path }).eq("id", row.id);
            if (x.error) { if (file) await removeQuiet("payment", path); throw x.error; }
            if (file && row.qr_path) await removeQuiet("payment", row.qr_path);
            flash = "Saved " + val("label") + (file ? (checked ? ". QR code checked." : ". The QR could not be checked in this browser.") : ".") +
              (path && !row.is_active ? " Switch the card on to show it to players." : "");
            load();
          } catch (err) { btn.disabled = false; say(card, friendly(err), "err"); }
        };

        card.querySelector('[data-act="clear"]').onclick = async function () {
          if (!await D.ui.confirmAction("Clear " + row.label + "? Its details and QR image will be removed and the card will become inactive.", { title: "Clear payment card", confirmText: "Clear card" })) return;
          var x = await sb.rpc("clear_payment_qr", { p_id: row.id });
          if (x.error) return say(card, friendly(x.error), "err");
          if (x.data) await removeQuiet("payment", x.data);
          flash = "Cleared " + row.label + ".";
          load();
        };
      });
    }
    load();
  }

  D.admin = { render: render, scanQr: scanQr };
})();
