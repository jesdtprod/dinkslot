// DINKSLOT club facility dashboard: /#/admin/<slug>, /courts, /bookings, /profile, /payments, /staff, /account.
// Only club owner/staff reach real data: every query is filtered by RLS in Postgres.
// tenant_id is never trusted from here; the database re-checks membership on every write.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc, setMsg = D.setMsg, friendly = D.friendly;
  var ctx = null; // { t: tenant row, role: 'owner'|'staff', slug }
  var currentUi = null; // active layout shell instance
  var statusChan = null; // live club-status subscription for the open dashboard
  var badgePoll = null;
  var renderRequest = 0;
  async function approvalCount(tenantId) {
    var result = await sb.from('bookings').select('id,status,amount,paid_at').eq('tenant_id', tenantId).in('status', ['pending','approved']);
    if (result.error) throw result.error;
    var payments = await sb.from('booking_payments').select('booking_id,deleted_at').eq('tenant_id', tenantId);
    if (payments.error) throw payments.error;
    var paid = {};
    (payments.data || []).forEach(function (payment) { if (!payment.deleted_at) paid[payment.booking_id] = true; });
    return (result.data || []).filter(function (booking) {
      return booking.status === 'pending' || !(Number(booking.amount) === 0 || booking.paid_at || paid[booking.id]);
    }).length;
  }
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
  async function saveClubPhoto(tenant, col, name, file) {
    var old = tenant[col];
    var path = await upload("club-media", tenant.id + "/" + name + "-" + Date.now() + "." + (TYPES[(file || {}).type] || "x"), file);
    var payload = {}; payload[col] = path;
    var result = await sb.from("tenants").update(payload).eq("id", tenant.id).select("id," + col).single();
    if (result.error || !result.data || result.data[col] !== path) {
      await removeQuiet("club-media", path);
      throw result.error || new Error("The image could not be saved to your club. Please try again.");
    }
    tenant[col] = path;
    await removeQuiet("club-media", old);
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
    var request = ++renderRequest;
    document.body.classList.add("tenant-dashboard-mode");
    var root = D.root();
    if (!section || section === "dashboard") section = "overview";
    if (section === "settings") section = "profile";

    var isSameShell = currentUi && ctx && ctx.slug === slug && root.contains(currentUi.main) && root.querySelector("#ds-tenant-dashboard");
    if (!isSameShell) {
      root.innerHTML = skeletonShell();
      var tr = await sb.from("tenants").select("*").eq("slug", slug).maybeSingle();
      var t = tr.data, role = null;
      if (t) {
        var mr = await sb.from("tenant_members").select("role").eq("tenant_id", t.id).eq("user_id", D.state.user.id).maybeSingle();
        role = mr.data && mr.data.role;
      }
      if (request !== renderRequest) return;
      if (!t || !role) {
        root.innerHTML = '<div class="p-8 max-w-lg mx-auto mt-12 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-center"><span class="material-symbols-outlined text-4xl text-error mb-2">lock</span><h2 class="font-headline-md text-on-surface">No access</h2><p class="text-on-surface-variant mt-2 font-body-md">This club does not exist, or you are not part of its staff team.</p><p class="mt-6"><a class="px-5 py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-bold no-underline inline-block font-label-md" href="#/">Return Home</a></p></div>';
        return;
      }
      ctx = { t: t, role: role, slug: slug };
      var owner = role === "owner";
      var pendingCount = await approvalCount(t.id);
      if (request !== renderRequest) return;
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
      if (badgePoll) clearInterval(badgePoll);
      var badgeUi = currentUi;
      async function refreshBadge() {
        if (!document.body.contains(badgeUi.main)) { clearInterval(badgePoll); return; }
        try {
          var count = await approvalCount(t.id);
          if (document.body.contains(badgeUi.main)) badgeUi.setBadge('bookings', count);
        } catch (error) { console.error('Unable to refresh booking badge', error); }
      }
      badgePoll = setInterval(refreshBadge, 20000);
      statusChan = sb.channel("tenant-" + t.id + "-" + Date.now())
        .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: "tenant_id=eq." + t.id }, refreshBadge)
        .on("postgres_changes", { event: "*", schema: "public", table: "booking_payments", filter: "tenant_id=eq." + t.id }, refreshBadge)
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
    var stage = sec.parentElement;
    stage.classList.toggle('member-workspace-stage', section === 'overview');
    if (section === 'overview' && D.mountPublicBackdrop) D.mountPublicBackdrop(stage);
    sec.innerHTML = skeletonSection(section);

    var owner = ctx.role === "owner";
    if (section === "bookings") {
      if (!D.booking) return;
      sec.innerHTML = '<div id="newbk"></div><div id="queue"></div>';
      D.booking.adminNew(q("#newbk", sec), ctx.t);
      return D.booking.queue(q("#queue", sec), ctx.t, { onCount: function (count) { ui.setBadge('bookings', count); } });
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
  function overviewHeader(t, stats) {
    var base = '#/admin/' + esc(t.slug);
    var secondary = t.status === 'approved'
      ? '<a class="admin-overview-action" href="#/c/' + esc(t.slug) + '"><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>View Public Page</a>'
      : '<a class="admin-overview-action" href="' + base + '/courts"><span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>Court Matrix</a>';
    return '<header class="admin-overview-header" aria-labelledby="dtitle"><div class="admin-overview-intro"><span class="admin-overview-eyebrow">Pickleball Club Management</span><h1 id="dtitle">Overview</h1><p id="dsub">Your courts, reservations, and daily operations in one place.</p><nav id="dact" class="admin-overview-actions" aria-label="Club quick actions"><a class="admin-overview-action is-primary" href="' + base + '/bookings?new=1"><span class="material-symbols-outlined" aria-hidden="true">event_available</span>Quick Booking</a>' + secondary + '</nav></div><div class="admin-overview-summary" aria-label="Club activity"><div><span>Active courts</span><strong>' + stats.active + '</strong><small>Of ' + stats.total + ' configured</small></div><div><span>Today&#39;s bookings</span><strong>' + stats.today + '</strong><small>Confirmed reservations</small></div><div><span>Pending requests</span><strong>' + stats.pending + '</strong><small>Awaiting review</small></div></div></header>';
  }

  async function dashboardView(sec, ui) {
    var t = ctx.t, tz = t.timezone || "Asia/Manila";
    var now = new Date();
    var todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
    var dayStart = zonedToUtc(todayStr + "T00:00", tz), dayEnd = new Date(dayStart.getTime() + 86400000);
    var seventyTwoHours = new Date(dayEnd.getTime() + 86400000 * 2);


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
    var activeCourtsCount = courtsList.filter(function (court) { return court.status === 'active'; }).length;
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
      // Staff-scoped contacts supply the real profile name and photo (avatar_path arrives with migration 0036).
      try {
        var ct = await sb.rpc("club_player_contacts", { p_tenant_id: t.id });
        (ct.data || []).forEach(function (c) {
          var pl = playersMap[c.player_id];
          if (pl) { pl.display_name = c.full_name || pl.display_name; pl.avatar_path = c.avatar_path || null; }
        });
      } catch (e) { /* initials only */ }
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
      overviewHeader(t, {active:activeCourtsCount,total:courtsCount,today:todayN,pending:pending}) +

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
                    '<div class="w-7 h-7 rounded-full bg-surface-container-highest flex items-center justify-center font-label-sm text-label-sm font-bold text-primary overflow-hidden shrink-0">' + (p.avatar_path ? '<img src="' + esc(D.avatar.url(p.avatar_path)) + '" alt="" class="w-full h-full object-cover" loading="lazy">' : esc(initial)) + '</div>' +
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

  // ------------------------------------------------- time-based rates (rate bands)
  // A band = days + time range + hourly rate, for ONE court or the WHOLE CLUB (court_id null).
  // The database picks the rate for every slot and prices each booking (court_price); see migration 0024.
  var DAY_LABEL = { all: "Every day", weekday: "Mon - Fri", weekend: "Sat - Sun" };
  var DAY_ORDER = { all: 0, weekday: 1, weekend: 2 };
  function clock(m) { if (m >= 1440) return "midnight"; var h = Math.floor(m / 60); return (h % 12 || 12) + ":" + String(m % 60).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); }
  function toMinutes(hm) { var p = String(hm).split(":"); return Number(p[0]) * 60 + Number(p[1]); }

  async function ratesEditor(host, courtId, onChange) {
    var all = (await sb.from("court_rates").select("*").eq("tenant_id", ctx.t.id).order("start_min")).data || [];
    var mine = all.filter(function (x) { return courtId ? x.court_id === courtId : x.court_id == null; })
      .sort(function (a, b) { return DAY_ORDER[a.day_type] - DAY_ORDER[b.day_type] || a.start_min - b.start_min; });
    var inp = "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30";
    var lab = "flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase";
    host.classList.add("rate-editor");
    host.innerHTML =
      '<p class="rate-editor-description">' + (courtId
        ? "Set custom prices by day and time. Other hours use club-wide pricing or the court?s standard hourly rate."
        : "These rates apply to every court that has no rates of its own. Any time not covered uses the court's Hourly Rate.") + "</p>" +
      (mine.length ? '<div class="overflow-x-auto"><table class="w-full text-left font-body-sm text-body-sm"><thead class="text-on-surface-variant font-label-sm uppercase tracking-wider"><tr><th class="py-1 pr-3">Days</th><th class="py-1 pr-3">Time</th><th class="py-1 pr-3">Rate</th><th></th></tr></thead><tbody class="divide-y divide-surface-container-high">' +
        mine.map(function (x) {
          return '<tr><td class="py-1.5 pr-3">' + esc(DAY_LABEL[x.day_type]) + '</td><td class="py-1.5 pr-3">' + esc(clock(x.start_min) + " - " + clock(x.end_min)) +
            '</td><td class="py-1.5 pr-3 text-primary font-bold">' + money(x.hourly_rate) + '/hr</td><td class="py-1.5 text-right"><button class="court-icon-action is-danger" type="button" data-delrate="' + esc(x.id) + '" title="Remove rate" aria-label="Remove rate"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td></tr>';
        }).join("") + "</tbody></table></div>"
        : '<div class="rate-editor-empty"><span class="material-symbols-outlined" aria-hidden="true">schedule</span><div><strong>No custom rates</strong><span>Standard pricing applies until you add a rate.</span></div></div>') +
      '<div class="rate-add flex flex-wrap items-end gap-space-sm">' +
        '<label class="' + lab + '">Days<select class="' + inp + '" data-rd><option value="all">Every day</option><option value="weekday">Weekdays (Mon - Fri)</option><option value="weekend">Weekends (Sat - Sun)</option></select></label>' +
        '<label class="' + lab + '">From<input type="time" value="06:00" data-rs></label>' +
        '<label class="' + lab + '">To<input type="time" value="18:00" data-re></label>' +
        '<label class="' + lab + '">Hourly Rate (PHP)<input type="number" min="0" step="0.01" placeholder="150" data-rr class="' + inp + ' w-32"></label>' +
        '<button class="px-space-md py-2.5 rounded-full bg-primary hover:bg-primary-fixed text-on-primary font-label-md font-bold border-0 cursor-pointer" type="button" data-addrate>Add rate</button>' +
      '</div><p class="rate-editor-note">Use 12:00 AM as the end time for midnight. Pricing follows the slot?s start time.</p>';
    D.ui.timePickers(host);

    Array.prototype.forEach.call(host.querySelectorAll("[data-delrate]"), function (b) {
      b.onclick = async function () {
        var r = await sb.rpc("delete_court_rate", { p_rate_id: b.getAttribute("data-delrate") });
        if (r.error) return setMsg(host, friendly(r.error), "err");
        if (onChange) onChange();
        ratesEditor(host, courtId, onChange);
      };
    });
    var add = q("[data-addrate]", host), rateInput = q("[data-rr]", host);
    rateInput.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); add.click(); } };
    add.onclick = async function () {
      var from = toMinutes(val("[data-rs]", host)), to = toMinutes(val("[data-re]", host)) || 1440, rate = rateInput.value;
      if (rate === "" || Number(rate) < 0) return setMsg(host, "Enter the hourly rate for this time range.", "err");
      if (to <= from) return setMsg(host, "The end time must be after the start time. Use 12:00 AM for midnight.", "err");
      add.disabled = true;
      var r = await sb.from("court_rates").insert({ tenant_id: ctx.t.id, court_id: courtId || null, day_type: val("[data-rd]", host),
        start_min: from, end_min: to, hourly_rate: Number(rate) });
      if (r.error) {
        add.disabled = false;
        return setMsg(host, /no_overlap|exclusion/.test(r.error.message || "") ? "That time range overlaps another rate for the same days. Remove or change the other rate first." : friendly(r.error), "err");
      }
      if (onChange) onChange();
      ratesEditor(host, courtId, onChange);
    };
  }

  // ---------------------------------------------------------------- courts
  async function courtsView(sec) {
    var t = ctx.t;
    var cr = await sb.from("courts").select("*").eq("tenant_id", t.id).order("name");
    var br = await sb.from("court_blocks").select("*").eq("tenant_id", t.id)
      .gte("ends_at", new Date().toISOString()).order("starts_at");
    var courts = cr.data || [], blocks = br.data || [];
    var byId = {}; courts.forEach(function (c) { byId[c.id] = c; });
    var rateRows = (await sb.from("court_rates").select("court_id").eq("tenant_id", t.id)).data || [];
    var rateCount = {}, clubRates = 0;
    rateRows.forEach(function (x) { if (x.court_id) rateCount[x.court_id] = (rateCount[x.court_id] || 0) + 1; else clubRates++; });

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
              "</span></td><td class=\"py-space-sm px-space-md font-label-md text-primary font-bold\">" + money(c.hourly_rate) + "/hr" + (rateCount[c.id] ? '<br><span class="font-label-sm text-on-surface-variant font-normal">+ ' + rateCount[c.id] + " time-based rate" + (rateCount[c.id] === 1 ? "" : "s") + "</span>" : (clubRates ? '<br><span class="font-label-sm text-on-surface-variant font-normal">club-wide rates apply</span>' : "")) + "</td><td class=\"py-space-sm px-space-md font-label-md\">" + D.hoursText(c.open_time, c.close_time) +
              "</td><td class=\"py-space-sm px-space-md\">" + c.slot_minutes + ' min slots</td><td class=\"py-space-sm px-space-md\"><span class="px-space-xs py-0.5 rounded-full font-label-sm ' + (c.status === "active" ? "bg-primary/10 text-primary" : "bg-error/10 text-error") + '">' + esc(c.status.charAt(0).toUpperCase() + c.status.slice(1)) +
              '</span></td><td class="py-space-sm px-space-md text-right whitespace-nowrap"><button class="court-icon-action" data-edit="' + esc(c.id) + '" type="button" title="Edit court" aria-label="Edit ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button> ' +
              '<button class="court-icon-action is-danger" data-del="' + esc(c.id) + '" type="button" title="Delete court" aria-label="Delete ' + esc(c.name) + '"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td></tr>';
          }).join("") + "</tbody></table></div>" : D.ui.emptyState('No courts yet', 'Add your first court to configure pricing and availability.', 'sports_tennis')) +
      '</div>' +

      '<div class="court-panel">' +
        '<div><h3 class="font-headline-sm text-on-surface">Club-wide Pricing Schedule</h3><p class="font-body-sm text-on-surface-variant">Different rates by time of day, weekdays or weekends. Example: 6:00 AM - 6:00 PM at PHP 150/hr and 6:00 PM - midnight at PHP 200/hr.</p></div>' +
        '<div id="clubrates" class="flex flex-col gap-space-sm"></div>' +
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
    ratesEditor(q("#clubrates", sec), null, null);
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
      '<section class="court-details-section"><div class="court-section-title"><span></span>Time-based rates for this court</div>' +
        (c ? '<div id="courtrates" class="flex flex-col gap-space-sm"></div>' : '<p class="font-body-sm text-on-surface-variant">Save the court first, then reopen it to add rates by time of day or for weekdays and weekends. Until then it uses the club-wide rates, or its Hourly Rate.</p>') +
      "</section>" +
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
    var ratesChanged = false;
    if (c) ratesEditor(q("#courtrates", box), c.id, function () { ratesChanged = true; });
    modal.addEventListener("close", function () { if (ratesChanged) courtsView(q("#sec")); });
    q("#cf", box).onsubmit = async function (e) {
      e.preventDefault();
      var f = q("#cf", box), btn = q("button[type=submit]", f);
      if (val("#cc", f) !== "00:00" && val("#co", f) >= val("#cc", f)) return setMsg(f, "Closing time must be after opening time. To close at midnight choose 12:00 AM.", "err");
      btn.disabled = true; setMsg(f, "Saving court...", "");
      try {
        var payload = { name: val("#cn", f).trim(), surface: val("#cs", f).trim() || null, is_indoor: q("#ci", f).checked,
          hourly_rate: num("#cr", f), slot_minutes: num("#cm", f), open_time: val("#co", f), close_time: val("#cc", f), status: val("#cst", f) };
        var r = c ? await sb.from("courts").update(payload).eq("id", c.id)
                  : await sb.from("courts").insert(Object.assign({ tenant_id: ctx.t.id }, payload));
        if (r.error) throw r.error;
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
      if (input.disabled) return;
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
        '<header class="profile-details-heading"><h3>Profile Details</h3><p>Keep your club information, contact details, and location up to date.</p></header>' +
        '<form id="pf" class="flex flex-col gap-space-md">' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Club Name<input id="pn" maxlength="80" required value="' + esc(t.name) + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<div id="phbox" class="sm:col-span-2"></div>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Contact Phone<input id="pp" value="' + esc(t.contact_phone || "") + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
            '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase sm:col-span-2">Contact Email (Reply-To)<input id="pe" type="email" value="' + esc(t.contact_email || "") + '" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30"></label>' +
          '</div>' +
          '<label class="flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Description<textarea id="pd" rows="3" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + esc(t.description || "") + '</textarea></label>' +
          '<section class="club-map-settings"><header><span class="material-symbols-outlined" aria-hidden="true">location_on</span><div><h3>Satellite Map Location</h3><p>Click the map or drag the pin. Location changes save automatically.</p></div></header><div id="club-location-map" aria-label="Choose club location on map"></div><div class="map-location-editor"><div class="map-coordinate-heading"><span class="material-symbols-outlined" aria-hidden="true">my_location</span><strong>Location coordinates</strong><span>Auto-save enabled</span></div><div class="club-map-fields">' +
            '<label>Latitude<input id="plat" type="number" min="-90" max="90" step="any" placeholder="e.g. 14.5995" value="' + esc(t.latitude == null ? '' : t.latitude) + '"></label>' +
            '<label>Longitude<input id="plng" type="number" min="-180" max="180" step="any" placeholder="e.g. 120.9842" value="' + esc(t.longitude == null ? '' : t.longitude) + '"></label></div>' +
            '<label class="map-paste-field">Paste coordinates<input id="pcoords" type="text" placeholder="14.5995, 120.9842" autocomplete="off"></label><div class="map-location-footer"><p id="club-map-status" role="status"></p><div class="club-map-actions"><button id="use-club-location" type="button"><span class="material-symbols-outlined" aria-hidden="true">my_location</span>Use Current Location</button><a id="open-club-map" class="btn ghost" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer"><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>View on Google Maps</a></div></div></div></section>' +
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
        '<label class="payment-instructions-field flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase">Payment instructions shown to players<textarea id="spi" form="paycfg" rows="3" placeholder="e.g. Send the exact amount and type your booking code in the message" class="bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30">' + esc(st.payment_instructions || "") + '</textarea></label>' +
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
      var profileLayout = sec.querySelector('.club-profile'), mediaCard = sec.querySelector('.profile-media'), mapCard = sec.querySelector('.club-map-settings');
      var detailsCard = sec.querySelector('#pf').parentElement;
      var leftColumn = document.createElement('div'); leftColumn.className = 'club-profile-left';
      var rightColumn = document.createElement('div'); rightColumn.className = 'club-profile-right';
      mapCard.querySelectorAll('input').forEach(function (input) { input.setAttribute('form', 'pf'); });
      leftColumn.append(detailsCard, mediaCard); rightColumn.append(mapCard); profileLayout.append(leftColumn, rightColumn);
    }

    if (part === "profile") {
      // Philippine address from the PSGC API (js/ph-address.js): manager, street/purok/sitio, province, city, barangay, ZIP
      var phc = D.ph.mount(q("#phbox", sec), { values: t, manager: true, required: true, cls: {
        label: "font-label-sm text-on-surface-variant",
        input: "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30" } });
      function updateMapLink() {
        var lat = val('#plat', sec), lng = val('#plng', sec);
        var valid = lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
        q('#open-club-map', sec).href = valid ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng) : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([t.name,t.address,t.city,'Philippines'].filter(Boolean).join(', '));
        q('#club-map-status', sec).textContent = valid ? 'Location selected.' : 'Enter coordinates to set your exact club location.';
      }
      var locationMap, locationPin, saveTimer, saving = false, pendingLocation = null;
      async function persistLocation() {
        if (saving || !pendingLocation) return;
        saving = true;
        var target = pendingLocation; pendingLocation = null;
        q('#club-map-status', sec).textContent = 'Saving location...';
        try {
          var saved = await sb.from('tenants').update(target).eq('id', t.id).select('id').single();
          if (saved.error) throw saved.error;
          t.latitude = target.latitude; t.longitude = target.longitude;
          if (sec.isConnected) q('#club-map-status', sec).textContent = pendingLocation ? 'Saving latest location...' : 'Location saved automatically.';
        } catch (error) {
          if (sec.isConnected) q('#club-map-status', sec).textContent = 'Location could not be saved. Update the coordinates to retry.';
          D.ui.toast('Unable to save the map location. Please try again.', 'err');
        } finally { saving = false; if (pendingLocation) persistLocation(); }
      }
      function locationChanged() {
        updateMapLink();
        var lat = Number(val('#plat', sec)), lng = Number(val('#plng', sec));
        if (val('#plat', sec) === '' || val('#plng', sec) === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
        renderMap();
        pendingLocation = {latitude:lat, longitude:lng}; clearTimeout(saveTimer); saveTimer = setTimeout(persistLocation, 400);
      }
      function chooseMapPoint(point) {
        if (!sec.isConnected) return;
        q('#plat',sec).value = point.lat.toFixed(6); q('#plng',sec).value = point.lng.toFixed(6); locationChanged();
      }
      function renderMap() {
        if (!window.L) return;
        var lat = val('#plat',sec), lng = val('#plng',sec), has = lat !== '' && lng !== '';
        if (!locationMap) {
          locationMap = L.map(q('#club-location-map',sec), {scrollWheelZoom:true, zoomControl:false}).setView(has ? [Number(lat),Number(lng)] : [12.8797,121.774], has ? 17 : 6);
          L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom:19, attribution:'Source: <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community'
          }).addTo(locationMap);
          L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'Labels &copy; Esri', pane:'overlayPane'}).addTo(locationMap);
          locationMap.on('click', function(event) { chooseMapPoint(event.latlng); });
          requestAnimationFrame(function() { locationMap.invalidateSize(); });
        }
        if (has) {
          if (!locationPin) {
            locationPin = L.marker([Number(lat),Number(lng)], {draggable:true, title:'Drag to set club location',icon:L.divIcon({className:'club-map-pin',html:'<span></span>',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(locationMap);
            locationPin.on('dragend',function(){ chooseMapPoint(locationPin.getLatLng()); });
          }
          locationPin.setLatLng([Number(lat),Number(lng)]);
          var address = phc.get();
          var label = '<strong>' + esc(val('#pn',sec) || t.name) + '</strong><span>' + esc([address.barangay || t.barangay,address.city || t.city].filter(Boolean).join(', ')) + '</span>';
          if (locationPin.getTooltip()) locationPin.setTooltipContent(label);
          else locationPin.bindTooltip(label,{permanent:true,direction:'top',offset:[0,-16],className:'club-location-label'});

        }
      }
      function centerLocation(lat,lng) { if(locationMap) locationMap.setView([lat,lng],17); }
      q('#plat', sec).onchange = locationChanged; q('#plng', sec).onchange = locationChanged;
      renderMap();
      q('#pcoords', sec).onchange = function () {
        var parts = this.value.trim().split(/\s*,\s*/);
        if (parts.length !== 2 || parts.some(function (part) { return !part || !Number.isFinite(Number(part)); }) || Math.abs(Number(parts[0])) > 90 || Math.abs(Number(parts[1])) > 180) return D.ui.toast('Enter valid latitude and longitude separated by a comma.', 'err');
        q('#plat', sec).value = parts[0]; q('#plng', sec).value = parts[1]; locationChanged(); centerLocation(Number(parts[0]),Number(parts[1]));
      };
      q('#use-club-location', sec).onclick = function () {
        var button = this;
        if (!navigator.geolocation) return D.ui.toast('Location services are not available in this browser.', 'err');
        button.disabled = true;
        navigator.geolocation.getCurrentPosition(function (position) {
          if (!sec.isConnected) return;
          q('#plat', sec).value = position.coords.latitude.toFixed(6); q('#plng', sec).value = position.coords.longitude.toFixed(6); locationChanged(); centerLocation(position.coords.latitude,position.coords.longitude); button.disabled = false;
        }, function () { button.disabled = false; D.ui.toast('Unable to access your location. Enter your venue coordinates manually.', 'err'); }, { enableHighAccuracy: true, timeout: 12000 });
      };
      q('#pf',sec).addEventListener('change',function(event){ if(event.target.id !== 'plat' && event.target.id !== 'plng') renderMap(); });
      updateMapLink();
      q("#pf", sec).onsubmit = async function (e) {
        e.preventDefault();
        if ((val("#plat", sec) === "") !== (val("#plng", sec) === "")) return D.ui.toast("Enter both latitude and longitude, or leave both fields empty.", "err");
        var f = this;
        var perr = phc.validate();
        if (perr) return setMsg(f, perr, "err");
        var ad = phc.get();
        var r = await sb.from("tenants").update({ name: val("#pn", f).trim(), city: ad.city, address: ad.address,
          manager_name: ad.manager_name, street: ad.street, barangay: ad.barangay, province: ad.province, zip_code: ad.zip_code,
          psgc_province: ad.psgc_province, psgc_city: ad.psgc_city, psgc_barangay: ad.psgc_barangay,
          latitude: val("#plat", sec) === "" ? null : num("#plat", sec), longitude: val("#plng", sec) === "" ? null : num("#plng", sec),
          contact_phone: val("#pp", f).trim() || null, contact_email: val("#pe", f).trim() || null, description: val("#pd", f).trim() || null }).eq("id", t.id);
        if (r.error) return setMsg(f, friendly(r.error), "err");
        setMsg(f, "Profile saved.", "ok");
      };
      function photoUpload(btnSel, fileSel, col, name) {
        var input = q(fileSel, sec), button = q(btnSel, sec), card = input.closest('.media-upload');
        mediaSelection(card, input, button);
        q(btnSel, sec).onclick = async function () {
          var msg = q("#phmsg", sec), file = q(fileSel, sec).files[0];
          if (!file || button.disabled) return;
          input.disabled = true;
          button.disabled = true; button.setAttribute("aria-busy", "true");
          try {
            var path = await saveClubPhoto(t, col, name, file);
            var image = document.createElement('img'); image.src = D.mediaUrl(path); image.alt = 'Current ' + (name === 'logo' ? 'profile logo' : 'cover banner');
            card.querySelector('.media-preview').replaceChildren(image);
            card.querySelector('header > span').textContent = 'Uploaded';
            card.querySelector('.media-file').textContent = file.name;
            card.querySelector('footer > span').textContent = 'Image uploaded successfully';
            input.value = '';
            setMsg(sec, name === 'logo' ? 'Your club logo has been updated successfully.' : 'Your club cover has been updated successfully.', 'ok');
          } catch (err) { msg.className = "msg err"; msg.textContent = friendly(err); }
          finally { input.disabled = false; button.disabled = !input.files.length; button.removeAttribute("aria-busy"); }
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
        '<div class="flex items-center gap-space-md">' +
          '<div id="mp-preview" class="w-20 h-20 rounded-full bg-surface-container-high border-2 border-primary flex items-center justify-center text-primary text-2xl font-bold overflow-hidden shrink-0"></div>' +
          '<div class="flex flex-col gap-space-xs"><span class="font-label-md text-on-surface font-semibold">Profile photo</span>' +
            '<span class="font-body-sm text-on-surface-variant">JPG, PNG or WebP, up to 2 MB. Shown in your account menu.</span>' +
            '<div class="flex items-center gap-space-sm">' +
              '<label for="mp-photo" class="px-space-md py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 text-on-surface font-label-sm font-bold uppercase cursor-pointer">Change Photo</label>' +
              '<input type="file" id="mp-photo" accept="image/jpeg,image/png,image/webp" hidden>' +
              '<button type="button" id="mp-remove-photo" class="px-space-md py-1.5 rounded-full bg-transparent border border-outline-variant/30 text-on-surface-variant font-label-sm font-bold uppercase cursor-pointer" hidden>Remove</button>' +
            '</div><p class="msg" id="mp-photo-msg" role="alert"></p></div>' +
        '</div></div>' +
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
    var paintPhoto = function () {
      var url = D.avatar.mine(), nm = (r.data && r.data.full_name) || D.state.user.email || "?";
      q("#mp-preview", sec).innerHTML = url ? '<img src="' + esc(url) + '" alt="Profile photo" class="w-full h-full object-cover">' : esc(nm.trim().charAt(0).toUpperCase() || "?");
      q("#mp-remove-photo", sec).hidden = !url;
    };
    paintPhoto();
    q("#mp-photo", sec).onchange = async function () {
      var input = this, file = input.files[0], pm = q("#mp-photo-msg", sec);
      if (!file) return;
      setMsg(pm, "", "");
      q("#mp-preview", sec).style.opacity = "0.5";
      try { await D.avatar.upload(file); setMsg(pm, "Photo updated.", "ok"); }
      catch (err) { setMsg(pm, err.message || "Could not upload the photo.", "err"); }
      q("#mp-preview", sec).style.opacity = "";
      input.value = "";
      paintPhoto();
    };
    q("#mp-remove-photo", sec).onclick = async function () {
      var pm = q("#mp-photo-msg", sec);
      this.disabled = true;
      try { await D.avatar.remove(); setMsg(pm, "Photo removed.", "ok"); }
      catch (err) { setMsg(pm, err.message || "Could not remove the photo.", "err"); }
      this.disabled = false;
      paintPhoto();
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
  async function seedPickleshotSamples(t, rows) {
    if (t.slug !== "the-pickleshot") return;
    var marker = "dinkslot:payment-samples:v2:" + t.id;
    try { if (localStorage.getItem(marker)) return; } catch (e) { /* storage may be unavailable */ }
    var images = {}, added = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var name = row.kind === "gcash" ? "GCash" : row.kind === "maya" ? "Maya" : "Bank Account";
      if (row.qr_path || row.account_name || row.account_number || row.is_active ||
          (row.label !== name + " " + row.slot && !(row.kind === "bank" && row.label === "Bank account " + row.slot))) continue;
      if (!images[row.kind]) {
        var response = await fetch("assets/sample-payments/" + row.kind + ".png");
        if (!response.ok) throw new Error("Could not load the sample QR images. Please retry.");
        images[row.kind] = new File([await response.blob()], "sample-" + row.kind + ".png", { type: "image/png" });
      }
      var path = await upload("payment", t.id + "/qr/sample-" + row.id + "-" + Date.now() + ".png", images[row.kind]);
      var values = {
        label: "SAMPLE " + name + " " + row.slot,
        account_name: "The Pickleshot (SAMPLE ONLY)",
        account_number: row.kind === "bank" ? "DEMO BANK - SAMPLE-000" + row.slot : "SAMPLE-09XX-XXX-000" + row.slot,
        qr_path: path, is_active: false
      };
      var saved = await sb.from("payment_qrs").update(values).eq("id", row.id).eq("tenant_id", t.id)
        .is("qr_path", null).is("account_name", null).is("account_number", null).eq("is_active", false).eq("label", row.label).select("*").single();
      if (saved.error || !saved.data) {
        await removeQuiet("payment", path);
        throw saved.error || new Error("The sample payment card could not be saved.");
      }
      Object.assign(row, saved.data);
      added++;
    }
    try { localStorage.setItem(marker, "done"); } catch (e) { /* persisted cards remain the source of truth */ }
    return added;
  }

  async function qrManager(box) {
    var t = ctx.t, flash = "", sampleError = "";
    var KINDS = [["gcash", "GCash"], ["maya", "Maya"], ["bank", "Bank Account"]];
    var fieldCls = "bg-surface-container px-3 py-2.5 dashboard-rounded text-on-surface border border-outline-variant/30";
    var lblCls = "flex flex-col gap-1 font-label-sm text-on-surface-variant uppercase";
    function say(el, text, kind) { var m = el.querySelector(".msg"); if (m) { m.className = "msg " + (kind || ""); m.textContent = text || ""; } }

    async function load() {
      box.innerHTML = '<p class="muted small">Loading payment cards...</p>';
      var r = await sb.from("payment_qrs").select("*").eq("tenant_id", t.id).is("deleted_at", null).order("sort_order");
      if (r.error || !r.data || !r.data.length) {
        box.innerHTML = '<p class="msg err" role="alert">' + esc(r.error ? friendly(r.error) : "No payment cards were found. Contact support to initialize this club’s payment slots.") + '</p><button type="button" class="btn sm" data-act="retry">Retry</button>';
        box.querySelector('[data-act="retry"]').onclick = load;
        return;
      }
      var rows = r.data || [], urls = {};
      sampleError = "";
      try {
        var added = await seedPickleshotSamples(t, rows);
        if (added) flash = "Added " + added + " sample accounts and QR images. Sample cards are inactive and are not valid for payments.";
      } catch (e) { sampleError = "Sample setup could not finish: " + friendly(e); }
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
        '<div class="qrthumbbox">' + (x.qr_path && urls[x.qr_path] ? '<img class="qrthumb" src="' + esc(urls[x.qr_path]) + '" alt="QR for ' + esc(x.label) + '">' : '<div class="qrthumb empty"><span class="material-symbols-outlined" aria-hidden="true">qr_code_2</span><strong>No QR Image</strong><span>Add a clear payment QR code below.</span></div>') + "</div>" +
        '<div class="qrbody"><div class="qrtop"><b>' + esc(kindName) + " " + x.slot + '</b>' +
        '<button type="button" class="qr-activation" role="switch" aria-label="Activate ' + esc(x.label) + '" aria-checked="' + !!x.is_active + '" data-act="toggle" title="' + (x.qr_path ? "Show this card to players" : "Save a QR image first") + '"' + (x.qr_path ? "" : " disabled") + '><span class="qr-activation-track" aria-hidden="true"></span><span>' + (x.is_active ? "Active" : "Inactive") + "</span></button></div>" +
        (!x.qr_path ? '<p class="small muted">Save a QR image to enable activation.</p>' : '') +
        '<div class="grid2"><label class="' + lblCls + '">Label players see<input data-f="label" maxlength="40" value="' + esc(x.label) + '" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + '">Account Name<input data-f="account_name" maxlength="80" value="' + esc(x.account_name || "") + '" class="' + fieldCls + '"></label>' +
        '<label class="' + lblCls + ' ph-wide">' + (x.kind === "bank" ? "Bank and Account Number" : "Contact Number") + '<input data-f="account_number" maxlength="60" value="' + esc(x.account_number || "") + '" class="' + fieldCls + '"></label></div>' +
        '<div class="payment-qr-upload"><span class="payment-qr-upload-label">QR Image</span><label class="payment-qr-picker"><input type="file" data-act="file" accept="image/jpeg,image/png,image/webp"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span><span><strong>' + (x.qr_path ? 'Replace QR Image' : 'Choose QR Image') + '</strong><small>JPG, PNG or WebP &middot; Up to 5 MB</small><span class="payment-qr-filename">No image selected</span></span><span class="material-symbols-outlined" aria-hidden="true">add</span></label></div>' +
        '<div class="qract"><button type="button" class="btn sm" data-act="save">Save card</button>' +
        '<button type="button" class="btn sm danger" data-act="clear">Clear card</button>' +
        (t.slug === "the-pickleshot" && !x.qr_path && !x.account_name && !x.account_number ? '<button type="button" class="btn sm" data-act="sample">Add sample data and QR</button>' : '') +
        '</div><p class="msg" role="alert"></p></div></div>';
    }

    var curKind = "gcash", lastRows = [], lastUrls = {};
    function draw(rows, urls) {
      lastRows = rows; lastUrls = urls;
      var active = rows.filter(function (x) { return x.is_active; }).length;
      var count = function (k) { return rows.filter(function (x) { return x.kind === k && x.is_active; }).length; };
      var list = rows.filter(function (x) { return x.kind === curKind; }).sort(function (p, q2) { return p.slot - q2.slot; });
      box.innerHTML =
        '<header class="qr-head"><div class="qr-heading-row"><h2>2. Payment methods (QR codes)</h2>' +
        '<span class="qr-count' + (active ? " has" : "") + '" role="status" aria-live="polite">' + active + ' of 9 active</span></div>' +
        '<p class="qr-description">Set up to three accounts each for GCash, Maya and bank transfers.</p>' +
        '<p class="qr-guidance"><span class="material-symbols-outlined" aria-hidden="true">info</span><span>Save the account details and QR, then switch the card on. Players see only active cards.</span></p></header>' +
        (sampleError ? '<p class="msg err" role="alert">' + esc(sampleError) + '</p>' : '') +
        '<div class="qr-tabs" role="tablist">' + KINDS.map(function (k) {
          var logo = k[0] === "bank" ? '<span class="material-symbols-outlined" aria-hidden="true">account_balance</span>' : '<img src="assets/payment-logos/' + k[0] + '.svg" alt="" width="58" height="20">';
          return '<button type="button" role="tab" class="qr-tab' + (k[0] === curKind ? " on" : "") + '" data-kind="' + k[0] + '" aria-selected="' + (k[0] === curKind) + '"><span class="qr-tab-logo qr-tab-logo-' + k[0] + '" aria-hidden="true">' + logo + '</span><span class="qr-tab-copy"><span>' + esc(k[1]) +
            '</span><small>' + count(k[0]) + " / 3 active</small></span></button>"; }).join("") + "</div>" +
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
          card.querySelector(".payment-qr-filename").textContent = file ? file.name : "No image selected";
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

        card.querySelector('[data-act="toggle"]').onclick = async function () {
          var btn = this, on = !row.is_active; btn.disabled = true;
          try {
            var x = await sb.from("payment_qrs").update({ is_active: on }).eq("id", row.id).eq("tenant_id", t.id).select("id,is_active").single();
            if (x.error) throw x.error;
            if (!x.data || x.data.is_active !== on) throw new Error("The activation change was not saved. Please retry.");
            row.is_active = x.data.is_active;
            flash = row.label + " is now " + (on ? "active. Players can pay with it." : "inactive. Players no longer see it.");
            draw(lastRows, lastUrls);
          } catch (err) { btn.disabled = false; say(card, friendly(err), "err"); }
        };

        var sampleBtn = card.querySelector('[data-act="sample"]');
        if (sampleBtn) sampleBtn.onclick = async function () {
          this.disabled = true;
          try {
            say(card, "Loading sample data and QR...", "");
            var response = await fetch("assets/sample-payments/" + row.kind + ".png");
            if (!response.ok) throw new Error("Could not load the sample QR. Please retry.");
            var file = new File([await response.blob()], "sample-" + row.kind + ".png", { type: "image/png" });
            var transfer = new DataTransfer(); transfer.items.add(file); fileEl.files = transfer.files;
            card.querySelector('[data-f="label"]').value = "SAMPLE " + row.kind.toUpperCase() + " " + row.slot;
            card.querySelector('[data-f="account_name"]').value = "The Pickleshot (SAMPLE ONLY)";
            card.querySelector('[data-f="account_number"]').value = "SAMPLE ONLY - NOT FOR PAYMENT";
            await fileEl.onchange();
            await card.querySelector('[data-act="save"]').onclick();
          } catch (err) { say(card, friendly(err), "err"); }
          this.disabled = false;
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
            var x = await sb.from("payment_qrs").update({ label: val("label"), account_name: val("account_name") || null, account_number: val("account_number") || null, qr_path: path }).eq("id", row.id).eq("tenant_id", t.id).select("id").single();
            if (x.error || !x.data) { if (file) await removeQuiet("payment", path); throw x.error || new Error("The payment card was not saved. Please retry."); }
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
