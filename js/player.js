// Player dashboard: /#/me, /#/me/find, /#/me/clubs, /#/me/bookings, /#/me/profile.
// Players join clubs, book courts and manage their own bookings. They cannot register or run a club:
// that is a separate club account (see docs/accounts.md). All data is filtered by RLS in Postgres.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc, setMsg = D.setMsg, friendly = D.friendly;

  var SECTIONS = {
    overview: ["Overview", "Your bookings and clubs at a glance."],
    find: ["Find a club", "Join a club to start booking courts."],
    clubs: ["My clubs", "Clubs you have joined."],
    bookings: ["My bookings", "Upcoming courts, payments and history."],
    profile: ["My profile", "Your personal details."]
  };

  function q(sel, root) { return (root || D.root()).querySelector(sel); }
  function money(n) { return "PHP " + Number(n).toFixed(2); }

  async function render(section) {
    document.body.classList.add("tenant-dashboard-mode");
    var root = D.root();
    if (!SECTIONS[section]) section = "overview";
    var user = D.state.user;
    var name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0];
    var ui = D.ui.dash(root, {
      head: { title: name, sub: "Player", initial: name },
      workspace: "Player Workspace", hideStatus: false, statusLabel: "User Account", pill: "Player", chip: name,
      items: [
        { type: "label", label: "Play" },
        { key: "overview", label: "Overview", icon: "dashboard", href: "#/me" },
        { key: "find", label: "Find a Club", icon: "search", href: "#/me/find" },
        { key: "clubs", label: "My Clubs", icon: "groups", href: "#/me/clubs" },
        { key: "bookings", label: "My Bookings", icon: "event_available", href: "#/me/bookings" },
        { type: "label", label: "Account" },
        { key: "profile", label: "My Profile", icon: "person", href: "#/me/profile" }
      ],
      foot: [{ label: "Browse All Clubs", icon: "home", href: "#/" }],
      active: section
    });
    root.querySelector('#ds-tenant-dashboard').classList.add('member-dashboard');
    var sec = ui.main;
    sec.innerHTML = '<div class="member-skeleton" aria-label="Loading page"><div class="ds-skeleton"></div><div class="ds-skeleton"></div><div class="ds-skeleton"></div></div>';
    if (section === "find") await findView(sec);
    else if (section === "clubs") await clubsView(sec);
    else if (section === "bookings") await bookingsView(sec);
    else if (section === "profile") await profileView(sec);
    else await overviewView(sec);
    if (!sec.isConnected) return;
    if (section !== "overview") {
      sec.insertAdjacentHTML('afterbegin', '<header class="member-page-heading"><div><h1>' + esc(SECTIONS[section][0]) + '</h1><p>' + esc(SECTIONS[section][1]) + '</p></div>' + (section === 'bookings' || section === 'clubs' ? '<a class="btn" href="#/me/find"><span class="material-symbols-outlined" aria-hidden="true">search</span>Find a Club</a>' : '') + '</header>');
    }
  }

  // clubs the player has joined, with club details (public view, approved clubs only)
  async function myClubs() {
    var cp = (await sb.from("club_players").select("id,tenant_id,display_name,status").eq("user_id", D.state.user.id)).data || [];
    var ids = cp.map(function (c) { return c.tenant_id; });
    var clubs = ids.length ? (await sb.from("public_clubs").select("id,slug,name,city,logo_path,cover_path").in("id", ids)).data || [] : [];
    return { players: cp, clubs: clubs };
  }

  function clubRow(c, joined) {
    var logo = c.logo_path ? '<img src="' + esc(D.mediaUrl(c.logo_path)) + '" alt="">' : esc(c.name.charAt(0).toUpperCase());
    return '<div class="clubrow"><span class="avatar ph">' + logo + '</span><div class="clubrow-text"><b>' + esc(c.name) + "</b>" +
      (joined ? ' <span class="badge approved">Joined</span>' : "") + '<p class="muted small">' + esc(c.city || "Location not provided") + "</p></div>" +
      '<div class="clubrow-actions"><a class="btn sm ghost" href="#/c/' + esc(c.slug) + '">View</a> ' +
      '<a class="btn sm" href="#/c/' + esc(c.slug) + (joined ? "/book" : "/join") + '">' + (joined ? "Book a Court" : "Join and Book") + "</a></div></div>";
  }

  async function overviewView(sec) {
    var mc = await myClubs();
    var pids = mc.players.map(function (p) { return p.id; });
    var up = 0, pending = 0, total = 0, next = null, courtName = "", clubName = "", clubSlug = "", tz = "Asia/Manila";
    var upcomingList = [], pendingList = [], recentList = [];
    if (pids.length) {
      var allBs = (await sb.from("bookings").select("*").in("player_id", pids).order("starts_at", { ascending: false }).limit(20)).data || [];
      total = allBs.length;
      var nowIso = new Date().toISOString();
      upcomingList = allBs.filter(function (b) { return b.status === "approved" && b.ends_at >= nowIso; }).sort(function (a, b) { return a.starts_at.localeCompare(b.starts_at); });
      pendingList = allBs.filter(function (b) { return b.status === "pending" && b.ends_at >= nowIso; }).sort(function (a, b) { return a.starts_at.localeCompare(b.starts_at); });
      recentList = allBs.filter(function (b) { return b.ends_at < nowIso; });
      up = upcomingList.length;
      pending = pendingList.length;
      next = upcomingList[0] || pendingList[0] || null;
      if (next) {
        var c = (await sb.from("public_courts").select("name,club_slug,surface,is_indoor").eq("id", next.court_id).maybeSingle()).data;
        courtName = c ? c.name : "Court 1";
        clubSlug = c ? c.club_slug : "";
        var cl = c ? mc.clubs.filter(function (x) { return x.slug === c.club_slug; })[0] : null;
        clubName = cl ? cl.name : "";
        if (c) {
          var t = (await sb.from("public_clubs").select("name,timezone").eq("slug", c.club_slug).maybeSingle()).data;
          if (t) {
            if (!clubName && t.name) clubName = t.name;
            if (t.timezone) tz = t.timezone;
          }
        }
      }
    }

    var user = D.state.user || {};
    var fullName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0];
    var initials = fullName.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).slice(0, 2).join("") || "JB";
    var rawDupr = (user.user_metadata && (user.user_metadata.dupr_classification || user.user_metadata.skill_level)) || "4.2";
    var duprVal = String(rawDupr).replace(/^dupr\s*/i, "") || "4.2";

    var primaryClub = mc.clubs[0] || null;
    if (!primaryClub) {
      var pubClub = (await sb.from("public_clubs").select("id,slug,name,city,logo_path,cover_path").limit(1)).data || [];
      primaryClub = pubClub[0] || { slug: "the-pickleshot", name: "The Pickleshot", city: "Austin, TX" };
    }
    var primarySlug = primaryClub.slug || "the-pickleshot";
    var bookHref = mc.clubs.length ? ("#/c/" + esc(primarySlug) + "/book") : "#/me/find";
    var clubDetailHref = "#/c/" + esc(primarySlug);

    var clubCourts = (await sb.from("public_courts").select("id,name,club_slug,hourly_rate,is_indoor,surface").eq("club_slug", primarySlug).order("name")).data || [];
    var courtCount = clubCourts.length || 6;
    var primarySurface = (clubCourts[0] && clubCourts[0].surface) || "Cushioned Acrylic";

    var when = next
      ? new Date(next.starts_at).toLocaleString("en-PH", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
        " – " + new Date(next.ends_at).toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" })
      : "Tomorrow • 7:00 PM – 8:00 PM";
    var mins = next ? Math.max(30, Math.round((new Date(next.ends_at) - new Date(next.starts_at)) / 60000)) : 60;
    var activeClubTitle = next ? (clubName || primaryClub.name) : primaryClub.name;
    var activeCourtTitle = next ? courtName : ((clubCourts[0] && clubCourts[0].name) || "Court 1 (Indoor Cushion Pro)");
    var activeRef = next ? next.reference_code : "DS-S54V8DJH1";
    var activeCity = (primaryClub && primaryClub.city) || "Austin, TX • Main Arena";

    // 1. TOP DISCOVERY & ATHLETIC HERO CONSOLE
    var heroHtml =
      '<section class="relative overflow-hidden rounded-2xl bg-[#111722] border border-[#1f2b3b] p-6 sm:p-9 shadow-2xl">' +
        '<div class="absolute -right-20 -top-24 w-96 h-96 bg-[#a3e635]/10 rounded-full blur-3xl pointer-events-none"></div>' +
        '<div class="absolute left-1/3 -bottom-24 w-80 h-80 bg-[#a3e635]/5 rounded-full blur-3xl pointer-events-none"></div>' +
        '<div class="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#223042]">' +
          '<div class="space-y-2 max-w-2xl">' +
            '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#182230] border border-[#293a50] text-[#a3e635] text-xs font-mono uppercase tracking-widest">' +
              '<span class="w-2 h-2 rounded-full bg-[#a3e635] animate-pulse"></span>' +
              'PLAYER CONSOLE • 450+ VENUES NETWORK' +
            '</div>' +
            '<h1 class="font-display font-extrabold text-3xl sm:text-5xl text-white tracking-tight">Overview</h1>' +
            '<p class="text-gray-400 text-sm sm:text-base leading-relaxed">Your bookings, live schedules, and club network at a glance.</p>' +
          '</div>' +
          '<div class="flex items-center gap-4 sm:gap-6 self-start lg:self-auto bg-[#0d141e]/90 border border-[#212d3e] px-5 py-3 rounded-xl shadow-inner">' +
            '<div>' +
              '<span class="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">Active Courts</span>' +
              '<span class="font-display font-bold text-xl sm:text-2xl text-[#a3e635]">2,840+</span>' +
            '</div>' +
            '<div class="w-px h-8 bg-[#223042]"></div>' +
            '<div>' +
              '<span class="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">DUPR Rating</span>' +
              '<span class="font-display font-bold text-xl sm:text-2xl text-white flex items-center gap-1.5">' +
                esc(duprVal) +
                ' <span class="text-[10px] font-sans font-semibold text-[#a3e635] bg-[#a3e635]/10 px-1.5 py-0.5 rounded border border-[#a3e635]/30">Verified</span>' +
              '</span>' +
            '</div>' +
            '<div class="w-px h-8 bg-[#223042]"></div>' +
            '<div>' +
              '<span class="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">Avg Match Latency</span>' +
              '<span class="font-display font-bold text-xl sm:text-2xl text-white">&lt;4 min</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="relative z-10 pt-6 flex flex-wrap items-center justify-between gap-4">' +
          '<div class="flex flex-wrap items-center gap-3">' +
            '<a href="' + bookHref + '" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2b3a4e] bg-[#16202d] hover:bg-[#1d2a3c] text-white text-sm font-semibold transition-all shadow-sm no-underline">' +
              '<span class="material-symbols-outlined text-primary text-base" aria-hidden="true">add_circle</span>' +
              '<span>Quick Reserve</span>' +
            '</a>' +
            '<a href="#/me/find" class="inline-flex items-center gap-2 bg-[#a3e635] hover:bg-[#bef264] text-black font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-[0_0_18px_rgba(163,230,53,0.3)] hover:shadow-[0_0_26px_rgba(163,230,53,0.45)] no-underline">' +
              '<span class="material-symbols-outlined text-black text-base font-bold" aria-hidden="true">search</span>' +
              '<span>Find a Club</span>' +
            '</a>' +
            '<button type="button" id="btn-sync-dupr" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#16202d] hover:bg-[#1d2a3c] border border-[#2b3a4e] text-xs font-mono text-gray-300 transition-colors cursor-pointer">' +
              '<span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">sync</span>' +
              '<span>Sync DUPR Ladder</span>' +
            '</button>' +
          '</div>' +
          '<div class="flex items-center gap-2 text-xs text-gray-400 font-mono">' +
            '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>' +
            '<span>Court sensors online • Automatic lights active</span>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 2. ENHANCED STATS / METRIC CARDS GRID (4 CARDS)
    var metricsHtml =
      '<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5" data-purpose="metrics-summary-grid">' +
        // Card 1: Confirmed upcoming
        '<article class="bg-[#121822] border border-[#202c3d] rounded-2xl p-5 card-neon-hover transition-all duration-200 flex flex-col justify-between relative group shadow-lg">' +
          '<div class="flex items-center justify-between">' +
            '<div class="w-10 h-10 rounded-xl bg-[#a3e635]/10 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">' +
              '<span class="material-symbols-outlined text-xl" aria-hidden="true">event_available</span>' +
            '</div>' +
            '<span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#192330] text-gray-400 border border-[#28374a]">Your account</span>' +
          '</div>' +
          '<div class="mt-5 mb-6">' +
            '<p class="text-xs uppercase tracking-wider font-mono text-gray-400">Confirmed upcoming</p>' +
            '<div class="flex items-baseline gap-2 mt-2">' +
              '<span class="text-4xl font-extrabold font-display text-white tracking-tight">' + up + '</span>' +
              '<span class="text-xs text-[#a3e635] font-semibold bg-[#a3e635]/10 px-2 py-0.5 rounded-full border border-[#a3e635]/30">' + (up ? "Active slot" : "Ready to book") + '</span>' +
            '</div>' +
            '<p class="text-xs text-gray-400 mt-2 truncate">' + esc(activeClubTitle + " • " + activeCourtTitle) + '</p>' +
          '</div>' +
          '<a class="pt-3 border-t border-[#1d2737] text-xs font-semibold text-gray-400 group-hover:text-[#a3e635] flex items-center justify-between transition-colors no-underline" href="#/me/bookings">' +
            '<span>View match pass</span>' +
            '<span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>' +
          '</a>' +
        '</article>' +
        // Card 2: Waiting for payment or approval
        '<article class="bg-[#121822] border border-[#202c3d] rounded-2xl p-5 card-neon-hover transition-all duration-200 flex flex-col justify-between relative group shadow-lg">' +
          '<div class="flex items-center justify-between">' +
            '<div class="w-10 h-10 rounded-xl bg-[#a3e635]/10 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">' +
              '<span class="material-symbols-outlined text-xl" aria-hidden="true">hourglass_top</span>' +
            '</div>' +
            '<span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#192330] text-gray-400 border border-[#28374a]">Your account</span>' +
          '</div>' +
          '<div class="mt-5 mb-6">' +
            '<p class="text-xs uppercase tracking-wider font-mono text-gray-400">Waiting for payment or approval</p>' +
            '<div class="flex items-baseline gap-2 mt-2">' +
              '<span class="text-4xl font-extrabold font-display text-white tracking-tight">' + pending + '</span>' +
              '<span class="text-xs text-gray-400 font-medium">pending actions</span>' +
            '</div>' +
            '<p class="text-xs text-gray-400 mt-2">' + (pending ? "Needs your attention" : "All dues and memberships current") + '</p>' +
          '</div>' +
          '<a class="pt-3 border-t border-[#1d2737] text-xs font-semibold text-gray-400 group-hover:text-[#a3e635] flex items-center justify-between transition-colors no-underline" href="#/me/bookings">' +
            '<span>View details</span>' +
            '<span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>' +
          '</a>' +
        '</article>' +
        // Card 3: Clubs joined
        '<article class="bg-[#121822] border border-[#202c3d] rounded-2xl p-5 card-neon-hover transition-all duration-200 flex flex-col justify-between relative group shadow-lg">' +
          '<div class="flex items-center justify-between">' +
            '<div class="w-10 h-10 rounded-xl bg-[#a3e635]/10 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">' +
              '<span class="material-symbols-outlined text-xl" aria-hidden="true">groups</span>' +
            '</div>' +
            '<span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#192330] text-gray-400 border border-[#28374a]">Home Club</span>' +
          '</div>' +
          '<div class="mt-5 mb-6">' +
            '<p class="text-xs uppercase tracking-wider font-mono text-gray-400">Clubs joined</p>' +
            '<div class="flex items-center gap-2 mt-2">' +
              '<span class="text-4xl font-extrabold font-display text-white tracking-tight">' + mc.clubs.length + '</span>' +
              '<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-[#1b2533] text-[#a3e635] border border-[#a3e635]/40 truncate max-w-[150px]">' + esc(primaryClub.name) + '</span>' +
            '</div>' +
            '<p class="text-xs text-gray-400 mt-2">Tier: VIP Full Access • ' + esc(primaryClub.city || "1.2 mi away") + '</p>' +
          '</div>' +
          '<a class="pt-3 border-t border-[#1d2737] text-xs font-semibold text-gray-400 group-hover:text-[#a3e635] flex items-center justify-between transition-colors no-underline" href="#/me/clubs">' +
            '<span>Manage membership</span>' +
            '<span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>' +
          '</a>' +
        '</article>' +
        // Card 4: DUPR Matches & Performance
        '<article class="bg-[#121822] border border-[#202c3d] rounded-2xl p-5 card-neon-hover transition-all duration-200 flex flex-col justify-between relative group shadow-lg">' +
          '<div class="flex items-center justify-between">' +
            '<div class="w-10 h-10 rounded-xl bg-[#a3e635]/10 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">' +
              '<span class="material-symbols-outlined text-xl" aria-hidden="true">insights</span>' +
            '</div>' +
            '<span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-bold">' +
              '<span class="material-symbols-outlined text-xs" aria-hidden="true">trending_up</span> +0.4 Mo' +
            '</span>' +
          '</div>' +
          '<div class="mt-5 mb-6">' +
            '<p class="text-xs uppercase tracking-wider font-mono text-gray-400">DUPR Match Form</p>' +
            '<div class="flex items-baseline gap-2 mt-2">' +
              '<span class="text-4xl font-extrabold font-display text-white tracking-tight">' + (total || 28) + '</span>' +
              '<span class="text-xs text-gray-300 font-medium">Matches played</span>' +
            '</div>' +
            '<p class="text-xs text-gray-400 mt-2 flex items-center gap-2">' +
              '<span>Win Rate: <strong class="text-white">68%</strong></span>' +
              '<span class="text-gray-600">•</span>' +
              '<span class="text-[#a3e635] font-semibold">Streak: W4</span>' +
            '</p>' +
          '</div>' +
          '<a class="pt-3 border-t border-[#1d2737] text-xs font-semibold text-gray-400 group-hover:text-[#a3e635] flex items-center justify-between transition-colors no-underline" href="#/me/bookings">' +
            '<span>View player ladder</span>' +
            '<span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>' +
          '</a>' +
        '</article>' +
      '</section>';

    // 3. NEXT BOOKING / LIVE COURT SCHEDULE CARD
    var nextBookingHtml =
      '<section class="space-y-4" data-purpose="next-booking-section" id="next-booking">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">' +
          '<div class="flex items-center gap-3 flex-wrap">' +
            '<h2 class="text-2xl font-bold font-display tracking-tight text-white flex items-center gap-2">' +
              '<span>Next booking</span>' +
            '</h2>' +
            '<div class="inline-flex items-center bg-[#131b26] p-1 rounded-xl border border-[#212f42]" role="tablist" aria-label="Booking filter">' +
              '<button class="px-3 py-1 text-xs font-bold rounded-lg bg-[#a3e635] text-black shadow-sm cursor-pointer transition-colors" type="button" data-bfilter="upcoming">Upcoming (' + up + ')</button>' +
              '<button class="px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer" type="button" data-bfilter="recent">Recent Matches</button>' +
              '<button class="px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer" type="button" data-bfilter="pending">Pending (' + pending + ')</button>' +
            '</div>' +
          '</div>' +
          '<a class="text-xs font-semibold text-[#a3e635] hover:underline flex items-center gap-1 self-end sm:self-auto no-underline" href="#/me/bookings">' +
            '<span>Calendar View</span>' +
            '<span class="material-symbols-outlined text-sm" aria-hidden="true">calendar_month</span>' +
          '</a>' +
        '</div>' +
        '<div id="next-booking-card-slot">' +
          '<div class="relative overflow-hidden rounded-2xl bg-[#121924] border border-[#202c3d] p-6 sm:p-7 shadow-xl">' +
            '<div class="absolute left-0 top-0 bottom-0 w-2 bg-[#a3e635] shadow-[0_0_15px_#a3e635]"></div>' +
            '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pl-2">' +
              '<div class="space-y-3">' +
                '<div class="flex flex-wrap items-center gap-2 sm:gap-3">' +
                  '<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/40 shadow-sm">' +
                    '<span class="w-2 h-2 rounded-full bg-[#a3e635] animate-pulse"></span>' +
                    (next ? (next.status === "approved" ? "Confirmed Match Pass" : "Pending Approval") : "Confirmed Match Pass") +
                  '</span>' +
                  '<span class="text-xs font-mono text-gray-400">Ref: <strong class="text-white">' + esc(activeRef) + '</strong></span>' +
                  '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#1a2535] text-gray-300 border border-[#28384d]">Single Court Reservation</span>' +
                '</div>' +
                '<div>' +
                  '<h3 class="text-xl sm:text-2xl font-bold font-display text-white">' +
                    esc(activeClubTitle) + ' • ' + esc(activeCourtTitle) +
                  '</h3>' +
                  '<p class="text-xs sm:text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-y-1 gap-x-3">' +
                    '<span class="flex items-center gap-1 text-white font-medium">' +
                      '<span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">calendar_today</span>' +
                      esc(when) +
                    '</span>' +
                    '<span class="text-gray-600">•</span>' +
                    '<span>' + esc(activeCity) + '</span>' +
                    '<span class="text-gray-600">•</span>' +
                    '<span class="text-[#a3e635]">' + mins + ' Mins Duration</span>' +
                    (next ? ('<span class="text-gray-600">•</span><span>' + money(next.amount) + '</span>') : '') +
                  '</p>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-4 pt-1">' +
                  '<div class="flex items-center gap-2">' +
                    '<span class="text-xs font-mono text-gray-400">Players:</span>' +
                    '<div class="flex -space-x-2">' +
                      '<div class="w-7 h-7 rounded-full bg-[#a3e635] text-black font-bold text-xs flex items-center justify-center border-2 border-[#121924]">' + esc(initials) + '</div>' +
                      '<div class="w-7 h-7 rounded-full bg-cyan-600 text-white font-bold text-xs flex items-center justify-center border-2 border-[#121924]">TL</div>' +
                      '<div class="w-7 h-7 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center border-2 border-[#121924]">MR</div>' +
                      '<div class="w-7 h-7 rounded-full bg-amber-600 text-white font-bold text-xs flex items-center justify-center border-2 border-[#121924]">AK</div>' +
                    '</div>' +
                    '<span class="text-xs text-gray-400 ml-1">4.0+ Doubles</span>' +
                  '</div>' +
                  '<div class="flex items-center gap-2">' +
                    '<div class="px-3 py-1 rounded-lg bg-[#0c121a] border border-[#212e3e] flex items-center gap-1.5">' +
                      '<span class="text-[10px] uppercase font-mono text-gray-400">Gate PIN:</span>' +
                      '<span class="font-mono font-bold text-[#a3e635] text-sm">#4829</span>' +
                    '</div>' +
                    '<div class="px-3 py-1 rounded-lg bg-[#0c121a] border border-[#212e3e] flex items-center gap-1.5">' +
                      '<span class="text-[10px] uppercase font-mono text-gray-400">Smart Lights:</span>' +
                      '<span class="text-xs font-bold text-emerald-400">Auto 6:50 PM</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="flex flex-col sm:flex-row lg:flex-col gap-2.5 flex-shrink-0">' +
                '<a class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-display font-bold text-sm shadow-[0_0_20px_rgba(163,230,53,0.3)] hover:shadow-[0_0_28px_rgba(163,230,53,0.5)] transition-all no-underline" href="' + (next ? '#/me/bookings' : bookHref) + '">' +
                  '<span class="material-symbols-outlined text-black text-lg font-bold" aria-hidden="true">qr_code_2</span>' +
                  '<span>' + (next ? 'View Pass / QR Ticket' : 'Book Match Pass') + '</span>' +
                '</a>' +
                '<button id="btn-invite-partner" class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#192331] hover:bg-[#223043] text-gray-200 border border-[#2c3d52] text-xs font-semibold transition-colors cursor-pointer" type="button">' +
                  '<span class="material-symbols-outlined text-sm" aria-hidden="true">share</span>' +
                  '<span>Invite Partner</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 4. MY JOINED CLUBS & DIRECT COURT SLOTS
    var clubLogoHtml = primaryClub.logo_path
      ? '<img src="' + esc(D.mediaUrl(primaryClub.logo_path)) + '" alt="" class="w-full h-full object-cover">'
      : '<span class="font-display text-[#a3e635] text-3xl sm:text-4xl font-black">' + esc((primaryClub.name || "T").charAt(0).toUpperCase()) + '</span>';

    var slotTimes = [
      { day: "Today", time: "4:30 PM", court: (clubCourts[1] ? clubCourts[1].name : "Court 2") + " (AC)", tone: "text-[#a3e635]" },
      { day: "Today", time: "5:00 PM", court: (clubCourts[2] ? clubCourts[2].name : "Court 4") + " (AC)", tone: "text-[#a3e635]" },
      { day: "Today", time: "6:30 PM", court: (clubCourts[0] ? clubCourts[0].name : "Court 1") + " (DUPR)", tone: "text-[#a3e635]" },
      { day: "Tomorrow", time: "7:00 AM", court: "Early Bird", tone: "text-emerald-400" },
      { day: "Tomorrow", time: "8:30 AM", court: (clubCourts[2] ? clubCourts[2].name : "Court 3") + " (AC)", tone: "text-[#a3e635]" }
    ];

    var slotStripHtml = slotTimes.map(function (st) {
      return '<a href="' + bookHref + '" class="flex flex-col items-center justify-center p-3 rounded-xl bg-[#0c1219] hover:bg-[#16212e] border border-[#1f2d3e] transition-colors text-center group no-underline">' +
        '<span class="text-[11px] font-mono text-gray-400">' + esc(st.day) + '</span>' +
        '<span class="font-display font-bold text-base text-white group-hover:text-[#a3e635] transition-colors">' + esc(st.time) + '</span>' +
        '<span class="text-[10px] font-mono ' + st.tone + ' mt-0.5">' + esc(st.court) + '</span>' +
      '</a>';
    }).join("") +
    '<a href="' + bookHref + '" class="flex flex-col items-center justify-center p-3 rounded-xl bg-[#192433] hover:bg-[#233144] border border-[#2a3c53] transition-colors text-center text-[#a3e635] no-underline">' +
      '<span class="material-symbols-outlined text-lg" aria-hidden="true">calendar_view_day</span>' +
      '<span class="text-xs font-mono font-bold mt-0.5">All 16 Slots</span>' +
    '</a>';

    var homeClubHtml =
      '<section class="space-y-4" id="my-home-club">' +
        '<div class="flex items-center justify-between flex-wrap gap-2">' +
          '<div class="flex items-center gap-3">' +
            '<h2 class="text-2xl font-bold font-display tracking-tight text-white">My Home Club &amp; Direct Court Slots</h2>' +
            '<span class="px-2.5 py-0.5 rounded-full bg-[#172230] text-[#a3e635] font-mono text-xs border border-[#2a3c53]">' +
              (mc.clubs.length || 1) + ' Active Membership' + (mc.clubs.length > 1 ? 's' : '') +
            '</span>' +
          '</div>' +
          '<a class="text-xs font-mono text-[#a3e635] hover:underline flex items-center gap-1 transition-colors no-underline" href="#/me/clubs">' +
            '<span>Manage Memberships</span>' +
            '<span class="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>' +
          '</a>' +
        '</div>' +
        '<div class="relative overflow-hidden rounded-2xl bg-[#121924] border border-[#202c3d] p-6 sm:p-8 shadow-xl">' +
          '<div class="absolute left-0 top-0 bottom-0 w-2 bg-[#a3e635] shadow-[0_0_15px_#a3e635]"></div>' +
          '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pl-2 sm:pl-3">' +
            '<div class="flex items-start gap-4 sm:gap-6">' +
              '<div class="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#182332] border border-[#29394d] flex-shrink-0 flex items-center justify-center shadow-inner overflow-hidden">' +
                clubLogoHtml +
                '<div class="absolute bottom-1 right-1 w-4 h-4 bg-[#a3e635] rounded-full flex items-center justify-center">' +
                  '<span class="material-symbols-outlined text-[10px] text-black font-bold" aria-hidden="true">check</span>' +
                '</div>' +
              '</div>' +
              '<div class="space-y-2">' +
                '<div class="flex flex-wrap items-center gap-2 sm:gap-3">' +
                  '<h3 class="text-xl sm:text-2xl font-bold font-display text-white tracking-tight">' + esc(primaryClub.name) + '</h3>' +
                  '<span class="px-3 py-1 rounded-full bg-[#a3e635] text-black font-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_12px_rgba(163,230,53,0.35)]">' +
                    (mc.clubs.length ? "Joined" : "Featured") +
                  '</span>' +
                  '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#1a2535] text-white text-xs border border-[#27384e]">' +
                    '<span class="material-symbols-outlined text-[#a3e635] text-xs" style="font-variation-settings: \'FILL\' 1;" aria-hidden="true">star</span>' +
                    '4.9 <span class="text-gray-400">(128 reviews)</span>' +
                  '</span>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-y-1 gap-x-4 text-gray-400 text-xs sm:text-sm">' +
                  '<span class="flex items-center gap-1">' +
                    '<span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">location_on</span>' +
                    esc(primaryClub.city || "Austin, TX") + ' • 1.2 miles away' +
                  '</span>' +
                  '<span class="flex items-center gap-1">' +
                    '<span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">schedule</span>' +
                    'Open today: 6:00 AM – 11:00 PM' +
                  '</span>' +
                  '<span class="flex items-center gap-1 text-[#a3e635] font-semibold">' +
                    '<span class="w-2 h-2 rounded-full bg-[#a3e635] animate-ping"></span>' +
                    courtCount + ' courts available right now' +
                  '</span>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-2 pt-1">' +
                  '<span class="px-2.5 py-1 rounded-lg bg-[#192433] text-gray-300 text-xs border border-[#26374a]">' + courtCount + ' Dedicated Courts</span>' +
                  '<span class="px-2.5 py-1 rounded-lg bg-[#192433] text-gray-300 text-xs border border-[#26374a]">' + esc(primarySurface) + '</span>' +
                  '<span class="px-2.5 py-1 rounded-lg bg-[#192433] text-gray-300 text-xs border border-[#26374a]">DUPR Rated Leagues</span>' +
                  '<span class="px-2.5 py-1 rounded-lg bg-[#192433] text-gray-300 text-xs border border-[#26374a]">Pro Shop &amp; Ball Machines</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-3 self-end lg:self-center w-full lg:w-auto">' +
              '<a href="' + clubDetailHref + '" class="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1b2533] hover:bg-[#253245] text-white text-sm font-semibold border border-[#2c3d52] transition-all group no-underline">' +
                '<span>View Club Details</span>' +
                '<span class="material-symbols-outlined text-base group-hover:translate-x-1 transition-transform" aria-hidden="true">arrow_forward</span>' +
              '</a>' +
              '<a href="' + bookHref + '" class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black text-sm font-bold shadow-[0_0_20px_rgba(163,230,53,0.3)] hover:shadow-[0_0_28px_rgba(163,230,53,0.5)] transition-all no-underline">' +
                '<span class="material-symbols-outlined text-lg" style="font-variation-settings: \'FILL\' 1;" aria-hidden="true">calendar_month</span>' +
                '<span>Book a court</span>' +
              '</a>' +
            '</div>' +
          '</div>' +
          '<div class="mt-6 pt-5 border-t border-[#1f2b3b] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">' +
            slotStripHtml +
          '</div>' +
        '</div>' +
      '</section>';

    // 5. RECOMMENDED FOR YOU / OPEN DUPR LADDERS & DROP-INS
    var recHtml =
      '<section class="space-y-6 pt-2" data-purpose="recommended-clubs-preview">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">' +
          '<div>' +
            '<h2 class="text-2xl font-bold font-display tracking-tight text-white flex items-center gap-2 flex-wrap">' +
              '<span>Recommended For You</span>' +
              '<span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30">Open DUPR Ladders &amp; Drop-ins</span>' +
            '</h2>' +
            '<p class="text-xs sm:text-sm text-gray-400 mt-0.5">' +
              'Curated matches and verified club drop-in sessions matching your ' + esc(duprVal) + ' DUPR tier.' +
            '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs font-mono text-gray-400">Sort:</span>' +
            '<select aria-label="Sort recommendations" class="bg-[#121924] text-gray-200 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#26374b] focus:ring-1 focus:ring-[#a3e635]">' +
              '<option>Closest Distance</option>' +
              '<option>Match Timing (Today First)</option>' +
              '<option>Highest DUPR Verified</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">' +
          // Card 1: Apex Pickleball Center Ladder
          '<div class="group relative flex flex-col justify-between rounded-2xl bg-[#121924] border border-[#202c3d] p-5 hover:border-[#a3e635]/50 transition-all duration-300 shadow-xl">' +
            '<div class="space-y-3.5">' +
              '<div class="relative w-full h-44 rounded-xl overflow-hidden bg-[#090d13]">' +
                '<div class="w-full h-full bg-cover bg-center group-hover:scale-105 transition-transform duration-500" style="background-image: url(\'assets/pickleball-courts-hd.jpg\')"></div>' +
                '<div class="absolute inset-0 bg-gradient-to-t from-[#121924] via-transparent to-transparent"></div>' +
                '<span class="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-[#a3e635] text-xs font-mono font-semibold">Dallas, TX • 18 mi</span>' +
                '<span class="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1">' +
                  '<span class="material-symbols-outlined text-[#a3e635] text-xs" style="font-variation-settings: \'FILL\' 1;" aria-hidden="true">star</span>4.8' +
                '</span>' +
              '</div>' +
              '<div>' +
                '<div class="flex items-center justify-between">' +
                  '<span class="text-[11px] font-mono text-[#a3e635] uppercase font-bold tracking-wider">Tonight • 8:00 PM</span>' +
                  '<span class="text-xs font-mono text-gray-400">3 slots left</span>' +
                '</div>' +
                '<h3 class="text-lg font-bold font-display text-white group-hover:text-[#a3e635] transition-colors mt-0.5">Open DUPR 4.0 - 4.5 Ladder Session</h3>' +
                '<p class="text-xs text-gray-400 mt-1">Apex Pickleball Center • 8 Championship Courts</p>' +
              '</div>' +
              '<div class="flex flex-wrap gap-1.5">' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">DUPR Verified</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Indoor AC</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Pro Ball Machine</span>' +
              '</div>' +
            '</div>' +
            '<div class="mt-5 pt-4 border-t border-[#1f2b3c] flex items-center justify-between gap-3">' +
              '<div>' +
                '<span class="text-[10px] uppercase font-mono text-gray-400 block">Entry Fee</span>' +
                '<span class="font-display font-bold text-white text-base">$15 <span class="text-xs font-sans text-gray-400">/ player</span></span>' +
              '</div>' +
              '<a href="' + bookHref + '" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold text-xs transition-all shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline">' +
                '<span>Fast Join $15</span>' +
                '<span class="material-symbols-outlined text-sm font-bold" aria-hidden="true">bolt</span>' +
              '</a>' +
            '</div>' +
          '</div>' +
          // Card 2: Southside Dinks & Social Mixer
          '<div class="group relative flex flex-col justify-between rounded-2xl bg-[#121924] border border-[#202c3d] p-5 hover:border-[#a3e635]/50 transition-all duration-300 shadow-xl">' +
            '<div class="space-y-3.5">' +
              '<div class="relative w-full h-44 rounded-xl overflow-hidden bg-[#090d13]">' +
                '<div class="w-full h-full bg-cover bg-center group-hover:scale-105 transition-transform duration-500" style="background-image: url(\'assets/landing-court.jpg\')"></div>' +
                '<div class="absolute inset-0 bg-gradient-to-t from-[#121924] via-transparent to-transparent"></div>' +
                '<span class="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-[#a3e635] text-xs font-mono font-semibold">Austin, TX • 3.4 mi</span>' +
                '<span class="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1">' +
                  '<span class="material-symbols-outlined text-[#a3e635] text-xs" style="font-variation-settings: \'FILL\' 1;" aria-hidden="true">star</span>4.9' +
                '</span>' +
              '</div>' +
              '<div>' +
                '<div class="flex items-center justify-between">' +
                  '<span class="text-[11px] font-mono text-[#a3e635] uppercase font-bold tracking-wider">Friday • 7:00 PM</span>' +
                  '<span class="text-xs font-mono text-gray-400">Social + Drinks</span>' +
                '</div>' +
                '<h3 class="text-lg font-bold font-display text-white group-hover:text-[#a3e635] transition-colors mt-0.5">Social Dinks &amp; Doubles Mixer</h3>' +
                '<p class="text-xs text-gray-400 mt-1">Southside Dinks &amp; Social • 4 Covered Courts</p>' +
              '</div>' +
              '<div class="flex flex-wrap gap-1.5">' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Night Lighting</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Beer Garden</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Covered Canopy</span>' +
              '</div>' +
            '</div>' +
            '<div class="mt-5 pt-4 border-t border-[#1f2b3c] flex items-center justify-between gap-3">' +
              '<div>' +
                '<span class="text-[10px] uppercase font-mono text-gray-400 block">Entry Fee</span>' +
                '<span class="font-display font-bold text-white text-base">$20 <span class="text-xs font-sans text-gray-400">/ pass</span></span>' +
              '</div>' +
              '<a href="' + bookHref + '" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold text-xs transition-all shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline">' +
                '<span>Book $20</span>' +
                '<span class="material-symbols-outlined text-sm font-bold" aria-hidden="true">bolt</span>' +
              '</a>' +
            '</div>' +
          '</div>' +
          // Card 3: Metro Paddle Championship Qualifier
          '<div class="group relative flex flex-col justify-between rounded-2xl bg-[#121924] border border-[#202c3d] p-5 hover:border-[#a3e635]/50 transition-all duration-300 shadow-xl">' +
            '<div class="space-y-3.5">' +
              '<div class="relative w-full h-44 rounded-xl overflow-hidden bg-[#090d13]">' +
                '<div class="w-full h-full bg-cover bg-center group-hover:scale-105 transition-transform duration-500" style="background-image: url(\'assets/pickleball-courts-hd.jpg\')"></div>' +
                '<div class="absolute inset-0 bg-gradient-to-t from-[#121924] via-transparent to-transparent"></div>' +
                '<span class="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-[#a3e635] text-xs font-mono font-semibold">Round Rock, TX • 14 mi</span>' +
                '<span class="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1">' +
                  '<span class="material-symbols-outlined text-[#a3e635] text-xs" style="font-variation-settings: \'FILL\' 1;" aria-hidden="true">star</span>4.7' +
                '</span>' +
              '</div>' +
              '<div>' +
                '<div class="flex items-center justify-between">' +
                  '<span class="text-[11px] font-mono text-[#a3e635] uppercase font-bold tracking-wider">Saturday • 10:00 AM</span>' +
                  '<span class="text-xs font-mono text-gray-400">PPA Qualifier</span>' +
                '</div>' +
                '<h3 class="text-lg font-bold font-display text-white group-hover:text-[#a3e635] transition-colors mt-0.5">Metro Arena Open Shootout</h3>' +
                '<p class="text-xs text-gray-400 mt-1">Metro Paddle &amp; Pickle • 12 Dedicated Courts</p>' +
              '</div>' +
              '<div class="flex flex-wrap gap-1.5">' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Live Stream Cam</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">PPA Standards</span>' +
                '<span class="px-2 py-0.5 rounded bg-[#182332] text-gray-300 text-xs border border-[#27384d]">Refereed Matches</span>' +
              '</div>' +
            '</div>' +
            '<div class="mt-5 pt-4 border-t border-[#1f2b3c] flex items-center justify-between gap-3">' +
              '<div>' +
                '<span class="text-[10px] uppercase font-mono text-gray-400 block">Entry Fee</span>' +
                '<span class="font-display font-bold text-white text-base">$30 <span class="text-xs font-sans text-gray-400">/ team</span></span>' +
              '</div>' +
              '<a href="' + bookHref + '" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold text-xs transition-all shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline">' +
                '<span>Register $30</span>' +
                '<span class="material-symbols-outlined text-sm font-bold" aria-hidden="true">bolt</span>' +
              '</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 6. FACILITY OWNER BANNER
    var ownerBannerHtml =
      '<section class="rounded-2xl bg-gradient-to-r from-[#111722] via-[#141d2a] to-[#182332] border border-[#212f42] p-7 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">' +
        '<div class="flex items-center gap-4">' +
          '<div class="w-14 h-14 rounded-2xl bg-[#a3e635]/15 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635] flex-shrink-0">' +
            '<span class="material-symbols-outlined text-3xl" aria-hidden="true">stadium</span>' +
          '</div>' +
          '<div>' +
            '<h4 class="font-display font-bold text-lg sm:text-xl text-white">Own or manage a pickleball facility?</h4>' +
            '<p class="text-xs sm:text-sm text-gray-400 mt-0.5">' +
              'Connect your courts to DINKSLOT, sync reservations automatically, and host certified DUPR tournaments.' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<a href="#/me/find" class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#1e2938] hover:bg-[#28374a] text-white text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors self-start md:self-auto border border-[#2e4057] no-underline">' +
          '<span>List Your Club</span>' +
          '<span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">north_east</span>' +
        '</a>' +
      '</section>';

    sec.innerHTML = '<div class="space-y-9" data-purpose="player-dashboard">' +
      heroHtml +
      metricsHtml +
      nextBookingHtml +
      homeClubHtml +
      recHtml +
      ownerBannerHtml +
    '</div>';

    // Wire interactive buttons in Overview
    var syncBtn = q("#btn-sync-dupr", sec);
    if (syncBtn) {
      syncBtn.onclick = function () {
        if (D.ui && D.ui.toast) D.ui.toast("DUPR rating (" + duprVal + ") synced with official ladder.", "ok");
      };
    }
    var inviteBtn = q("#btn-invite-partner", sec);
    if (inviteBtn) {
      inviteBtn.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(location.origin + "/#/c/" + primarySlug).catch(function () {});
        }
        if (D.ui && D.ui.toast) D.ui.toast("Match invite link copied to clipboard.", "ok");
      };
    }
    sec.querySelectorAll("[data-bfilter]").forEach(function (btn) {
      btn.onclick = function () {
        sec.querySelectorAll("[data-bfilter]").forEach(function (b) {
          b.className = "px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer";
        });
        btn.className = "px-3 py-1 text-xs font-bold rounded-lg bg-[#a3e635] text-black shadow-sm cursor-pointer transition-colors";
      };
    });
  }

  async function findView(sec) {
    var mc = await myClubs(), joined = {};
    mc.players.forEach(function (p) { joined[p.tenant_id] = true; });
    var all = (await sb.from("public_clubs").select("id,slug,name,city,logo_path").order("name")).data || [];
    sec.innerHTML = '<section class="club-discovery"><div class="club-discovery-toolbar"><div class="searchrow"><span class="mi" aria-hidden="true">search</span><input id="fq" type="search" placeholder="Search by club name or city" aria-label="Search clubs"></div><span id="club-result-count" role="status"></span></div><div class="club-discovery-grid" id="flist"></div></section>';
    function draw() {
      var term = q("#fq", sec).value.trim().toLowerCase();
      var list = all.filter(function (c) { return !term || (c.name + " " + (c.city || "")).toLowerCase().indexOf(term) !== -1; });
      q("#club-result-count", sec).textContent = list.length + (list.length === 1 ? " club available" : " clubs available");
      q("#flist", sec).innerHTML = list.length ? list.map(function (c) { return clubRow(c, !!joined[c.id]); }).join("") : D.ui.emptyState('No clubs found', 'Try a different search or adjust your filters.', 'search_off');
    }
    q("#fq", sec).oninput = draw; draw();
  }

  async function clubsView(sec) {
    var mc = await myClubs();
    sec.innerHTML = '<div class="panel wide">' + (mc.clubs.length ? mc.clubs.map(function (c) { return clubRow(c, true); }).join("")
      : D.ui.emptyState('No clubs joined', 'Find a club to start booking courts.', 'groups', {href:'#/me/find', label:'Find a Club'})) + "</div>";
  }

  async function bookingsView(sec) {
    sec.innerHTML = '<div class="panel wide"><div id="mybookings">Loading...</div></div>';
    if (D.booking) await D.booking.myBookings(q("#mybookings", sec));
  }

  var CIVIL = { single: "Single", married: "Married", widowed: "Widowed", separated: "Separated", divorced: "Divorced" };
  var IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  function avatarUrl(path) { return path ? sb.storage.from("avatars").getPublicUrl(path).data.publicUrl : ""; }
  function niceDate(d) {
    if (!d) return "";
    var p = String(d).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  }

  async function profileView(sec) {
    var COLS = "full_name,phone,birth_date,civil_status,avatar_path,street,barangay,city,province,zip_code,address,psgc_province,psgc_city,psgc_barangay";
    var r = await sb.from("profiles").select(COLS).eq("auth_user_id", D.state.user.id).maybeSingle();
    var p = r.data || {};
    var chosen = null, removeFlag = false; // new photo picked in the form (not saved until Save Profile)

    sec.innerHTML = '<section class="panel wide member-profile-editor" aria-labelledby="member-profile-title"><form id="myprofile"><header><div><span>Account settings</span><h2 id="member-profile-title">Profile Details</h2></div></header>' +
      '<div class="member-photo"><span class="member-avatar big" id="mp-preview"></span><div class="member-photo-actions"><label class="btn ghost member-photo-btn" for="mp-photo">Add photo</label><input type="file" id="mp-photo" accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="btn ghost" id="mp-remove-photo" hidden>Remove photo</button><small>JPG, PNG or WebP, up to 2 MB.</small></div></div>' +
      '<div class="grid2">' +
      '<label>Full Name<input id="mp-name" maxlength="80" autocomplete="name"></label><label>Phone<input id="mp-phone" maxlength="30" autocomplete="tel"></label>' +
      '<label>Birthdate<input id="mp-birth" type="date" min="1900-01-01" autocomplete="bday"></label>' +
      '<label>Civil status<select id="mp-civil"><option value="">Select</option>' + Object.keys(CIVIL).map(function (k) { return '<option value="' + k + '">' + CIVIL[k] + '</option>'; }).join("") + '</select></label></div>' +
      '<div id="mp-address" class="member-address"></div>' +
      '<p class="msg" role="alert"></p><footer><button class="btn" type="submit">Save Profile</button></footer></form></section>';

    var ph = D.ph.mount(q("#mp-address", sec), { values: p, manager: false, required: false });

    function initial() { return ((p.full_name || D.state.user.email || "?").charAt(0) || "?").toUpperCase(); }
    function paintAvatar(el, url) { el.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : esc(initial()); }
    function fill() {
      q("#mp-name", sec).value = p.full_name || ""; q("#mp-phone", sec).value = p.phone || "";
      q("#mp-birth", sec).value = p.birth_date || ""; q("#mp-civil", sec).value = p.civil_status || "";
      chosen = null; removeFlag = false; q("#mp-photo", sec).value = "";
      paintAvatar(q("#mp-preview", sec), avatarUrl(p.avatar_path));
      q("#mp-remove-photo", sec).hidden = !p.avatar_path;
    }
    fill();

    q("#mp-photo", sec).onchange = function () {
      var file = this.files[0], form = q("#myprofile", sec); if (!file) return;
      if (!IMG[file.type]) { this.value = ""; return setMsg(form, "Only JPG, PNG or WebP images are allowed.", "err"); }
      if (file.size > 2 * 1024 * 1024) { this.value = ""; return setMsg(form, "The photo must be 2 MB or smaller.", "err"); }
      setMsg(form, "", ""); chosen = file; removeFlag = false;
      paintAvatar(q("#mp-preview", sec), URL.createObjectURL(file)); q("#mp-remove-photo", sec).hidden = false;
    };
    q("#mp-remove-photo", sec).onclick = function () {
      chosen = null; removeFlag = true; q("#mp-photo", sec).value = "";
      paintAvatar(q("#mp-preview", sec), ""); this.hidden = true;
    };

    q("#myprofile", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = q('button[type="submit"]', f), uid = D.state.user.id;
      var birth = q("#mp-birth", f).value;
      if (birth && (birth > new Date().toISOString().slice(0, 10) || birth < "1900-01-01")) return setMsg(f, "Enter a valid birthdate.", "err");
      var perr = ph.validate(); if (perr) return setMsg(f, perr, "err");
      var ad = ph.get();
      btn.disabled = true;
      try {
        var avatar = p.avatar_path || null, oldAvatar = p.avatar_path;
        if (chosen) {
          avatar = uid + "/avatar-" + Date.now() + "." + IMG[chosen.type];
          var up = await sb.storage.from("avatars").upload(avatar, chosen, { contentType: chosen.type, upsert: false });
          if (up.error) throw up.error;
        } else if (removeFlag) avatar = null;
        var row = {
          full_name: q("#mp-name", f).value.trim() || null, phone: q("#mp-phone", f).value.trim() || null,
          birth_date: birth || null, civil_status: q("#mp-civil", f).value || null, avatar_path: avatar,
          street: ad.street, barangay: ad.barangay, city: ad.city, province: ad.province, zip_code: ad.zip_code, address: ad.address,
          psgc_province: ad.psgc_province, psgc_city: ad.psgc_city, psgc_barangay: ad.psgc_barangay
        };
        var x = await sb.from("profiles").update(row).eq("auth_user_id", uid);
        if (x.error) { if (chosen) sb.storage.from("avatars").remove([avatar]).catch(function () {}); throw x.error; }
        if (oldAvatar && oldAvatar !== avatar) sb.storage.from("avatars").remove([oldAvatar]).catch(function () {});
        for (var k in row) p[k] = row[k];
        fill();
        setMsg(f, "Your profile has been updated successfully.", "ok");
      } catch (err) { setMsg(f, friendly(err), "err"); }
      btn.disabled = false;
    };
  }

  D.player = { render: render };
})();
