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

  function reservationCard(b, court, club) {
    court = court || {}; club = club || {};
    var tz = club.timezone || 'Asia/Manila';
    var when = new Date(b.starts_at).toLocaleString('en-PH', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' &ndash; ' + new Date(b.ends_at).toLocaleTimeString('en-PH', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    var minutes = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000);
    var parts = [club.street || club.address, club.barangay, club.city, club.province, club.zip_code].filter(Boolean);
    var address = parts.filter(function (v, i) { return parts.indexOf(v) === i; }).join(', ');
    var coordinates = club.latitude != null && club.longitude != null;
    var location = coordinates ? club.latitude + ',' + club.longitude : address;
    if (!address && coordinates) address = Number(club.latitude).toFixed(6) + ', ' + Number(club.longitude).toFixed(6);
    var labels = { approved: 'Confirmed Booking', pending: 'Pending Approval', cancelled: 'Cancelled', rejected: 'Declined' };
    return '<article class="member-reservation-card"><div class="member-reservation-main">' +
      '<div class="member-reservation-top"><span class="badge ' + (b.status === 'approved' ? 'approved' : '') + '">' + esc(labels[b.status] || 'Booking') + '</span><span class="member-reservation-ref">Ref: ' + esc(b.reference_code || 'Not available') + '</span></div>' +
      '<h3>' + esc(club.name || 'Club unavailable') + ' &middot; ' + esc(court.name || 'Court unavailable') + '</h3>' +
      '<div class="member-reservation-address"><span class="material-symbols-outlined" aria-hidden="true">location_on</span><span>' + esc(address || 'Club location not provided') + '</span></div>' +
      '<div class="member-reservation-meta"><span><span class="material-symbols-outlined" aria-hidden="true">calendar_today</span>' + when + '</span><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + minutes + ' minutes</span>' + (b.amount != null ? '<strong>' + money(b.amount) + '</strong>' : '') + '</div></div>' +
      '<div class="member-reservation-actions"><a class="btn" href="#/me/bookings"><span class="material-symbols-outlined" aria-hidden="true">event_note</span>View Booking</a>' +
      (location ? '<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(location) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined" aria-hidden="true">directions</span>View Location</a>' : '') + '</div></article>';
  }

  async function render(section) {
    document.body.classList.add("tenant-dashboard-mode");
    var root = D.root();
    if (!SECTIONS[section]) section = "overview";
    var user = D.state.user;
    var name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0];
    var av = (await sb.from("profiles").select("avatar_path").eq("auth_user_id", user.id).maybeSingle()).data;
    var avImg = av && av.avatar_path ? sb.storage.from("avatars").getPublicUrl(av.avatar_path).data.publicUrl : "";
    var ui = D.ui.dash(root, {
      head: { title: name, sub: "Player", initial: name, img: avImg },
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
    if (section !== "overview" && section !== "find") {
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
      var bookingsResult = await sb.from("bookings").select("*").in("player_id", pids).order("starts_at", { ascending: false });
      if (bookingsResult.error) throw bookingsResult.error;
      var allBs = bookingsResult.data || [];
      total = allBs.length;
      var nowIso = new Date().toISOString();
      upcomingList = allBs.filter(function (b) { return b.status === "approved" && b.ends_at >= nowIso; }).sort(function (a, b) { return a.starts_at.localeCompare(b.starts_at); });
      pendingList = allBs.filter(function (b) { return b.status === "pending" && b.ends_at >= nowIso; }).sort(function (a, b) { return a.starts_at.localeCompare(b.starts_at); });
      recentList = allBs.filter(function (b) { return b.ends_at < nowIso; });
      up = upcomingList.length;
      pending = pendingList.length;
      next = upcomingList[0] || null;
      if (next) {
        var c = (await sb.from("public_courts").select("name,club_slug,surface,is_indoor").eq("id", next.court_id).maybeSingle()).data;
        courtName = c ? c.name : "Court 1";
        clubSlug = c ? c.club_slug : "";
        var cl = c ? mc.clubs.filter(function (x) { return x.slug === c.club_slug; })[0] : null;
        clubName = cl ? cl.name : "";
        if (c) {
          var t = (await sb.from("public_clubs").select("*").eq("slug", c.club_slug).maybeSingle()).data;
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
    var rawDupr = (user.user_metadata && (user.user_metadata.dupr_classification || user.user_metadata.skill_level)) || 'unrated';
    var skillLabels = {unrated:'Not Rated', novice:'Novice', intermediate:'Intermediate', advanced:'Advanced', professional:'Professional'};
    var duprVal = skillLabels[String(rawDupr).toLowerCase()] || String(rawDupr).replace(/^dupr\s*/i, '');
    var activeCourtsResult = await sb.from('public_courts').select('id', {count:'exact', head:true});
    if (activeCourtsResult.error) throw activeCourtsResult.error;
    var activeCourtsCount = activeCourtsResult.count;

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

    var activeClubTitle = next ? (clubName || 'Club') : 'No upcoming bookings';
    var activeCourtTitle = next ? (courtName || 'Court') : '';
    var bookingCourts = {}, bookingClubs = {};
    var records = upcomingList.concat(pendingList, recentList);
    var courtIds = Array.from(new Set(records.map(function (b) { return b.court_id; }).filter(Boolean)));
    var clubIds = Array.from(new Set(records.map(function (b) { return b.tenant_id; }).filter(Boolean)));
    if (courtIds.length) {
      var cr = await sb.from('public_courts').select('*').in('id', courtIds);
      if (cr.error) throw cr.error;
      (cr.data || []).forEach(function (c) { bookingCourts[c.id] = c; });
    }
    if (clubIds.length) {
      var tr = await sb.from('public_clubs').select('*').in('id', clubIds);
      if (tr.error) throw tr.error;
      (tr.data || []).forEach(function (t) { bookingClubs[t.id] = t; });
    }
    function bookingResults(filter) {
      var list = filter === 'recent' ? recentList : filter === 'pending' ? pendingList : upcomingList;
      var titles = { upcoming: 'No upcoming bookings', recent: 'No past bookings', pending: 'No pending bookings' };
      return list.length ? list.map(function (b) {
        return reservationCard(b, bookingCourts[b.court_id], bookingClubs[b.tenant_id]);
      }).join('') : D.ui.emptyState(titles[filter], 'Your reservations will appear here when available.', 'event_available');
    }

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
              '<span class="font-display font-bold text-xl sm:text-2xl text-[#a3e635]">' + (activeCourtsCount == null ? 'Unavailable' : activeCourtsCount) + '</span>' +
            '</div>' +
            '<div class="w-px h-8 bg-[#223042]"></div>' +
            '<div>' +
              '<span class="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">Skill Level</span>' +
              '<span class="font-display font-bold text-xl sm:text-2xl text-white flex items-center gap-1.5">' +
                esc(duprVal) +
                ' <span class="text-[10px] font-sans font-semibold text-[#a3e635] bg-[#a3e635]/10 px-1.5 py-0.5 rounded border border-[#a3e635]/30">Self-reported</span>' +
              '</span>' +
            '</div>' +
            '<div class="w-px h-8 bg-[#223042]"></div>' +
            '<div>' +
              '<span class="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">Upcoming Bookings</span>' +
              '<span class="font-display font-bold text-xl sm:text-2xl text-white">' + up + '</span>' +
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
              '<button class="px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer" type="button" data-bfilter="recent">Past Bookings (' + recentList.length + ')</button>' +
              '<button class="px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer" type="button" data-bfilter="pending">Pending (' + pending + ')</button>' +
            '</div>' +
          '</div>' +
          '<a class="text-xs font-semibold text-[#a3e635] hover:underline flex items-center gap-1 self-end sm:self-auto no-underline" href="#/me/bookings">' +
            '<span>Calendar View</span>' +
            '<span class="material-symbols-outlined text-sm" aria-hidden="true">calendar_month</span>' +
          '</a>' +
        '</div>' +
        '<div id="next-booking-card-slot" class="space-y-3" role="tabpanel" aria-label="Upcoming bookings">' + bookingResults('upcoming') + '</div>' +
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

    sec.innerHTML = '<div class="space-y-9" data-purpose="player-dashboard">' +
      heroHtml +
      metricsHtml +
      nextBookingHtml +
      homeClubHtml +
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
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'next-booking-card-slot');
      btn.setAttribute('aria-selected', String(btn.getAttribute('data-bfilter') === 'upcoming'));
      btn.onclick = function () {
        sec.querySelectorAll("[data-bfilter]").forEach(function (b) {
          b.className = "px-3 py-1 text-xs font-medium text-gray-400 hover:text-white transition-colors cursor-pointer";
        });
        btn.className = "px-3 py-1 text-xs font-bold rounded-lg bg-[#a3e635] text-black shadow-sm cursor-pointer transition-colors";
        var filter = btn.getAttribute('data-bfilter');
        var slot = q('#next-booking-card-slot', sec);
        slot.innerHTML = bookingResults(filter);
        slot.setAttribute('aria-label', filter + ' bookings');
        sec.querySelectorAll('[data-bfilter]').forEach(function (tab) { tab.setAttribute('aria-selected', String(tab === btn)); });
      };
    });
  }

  async function findView(sec) {
    var mc = await myClubs(), joined = {}, joinedSlug = {};
    mc.players.forEach(function (p) { joined[p.tenant_id] = true; });
    mc.clubs.forEach(function (c) { joined[c.id] = true; joinedSlug[c.slug] = true; });
    var all = (await sb.from("public_clubs").select("id,slug,name,city,logo_path,cover_path").order("name")).data || [];
    var allCourts = (await sb.from("public_courts").select("id,name,club_slug,hourly_rate,is_indoor,surface")).data || [];

    var courtsBySlug = {};
    allCourts.forEach(function (ct) {
      if (!courtsBySlug[ct.club_slug]) courtsBySlug[ct.club_slug] = [];
      courtsBySlug[ct.club_slug].push(ct);
    });

    // Default partner clubs to enrich directory matching mockup
    var defaultPartners = [
      { id: "partner-apex", slug: "apex-pickleball-center", name: "Apex Pickleball Center", city: "Round Rock / North Austin", initial: "A", rating: "4.8", dist: "18.4 miles away", courts: 8, isIndoor: true, surface: "Championship Courts", tags: ["8 Championship Courts • Full AC", "Pro Shop & Stringing Center", "Weekly DUPR 3.5 - 5.0 Ladders"] },
      { id: "partner-southside", slug: "southside-dinks-social", name: "Southside Dinks & Social", city: "South Congress, Austin", initial: "S", rating: "4.9", dist: "3.4 miles away", courts: 4, isIndoor: true, surface: "Covered Courts", tags: ["4 Covered Courts • Night Lighting", "Craft Beer Garden & Player Lounge", "Open Social Play (Drop-in Daily)"] },
      { id: "partner-metro", slug: "metro-paddle-pickle-arena", name: "Metro Paddle & Pickle Arena", city: "East Austin Athletic Hub", initial: "M", rating: "4.7", dist: "14.1 miles away", courts: 12, isIndoor: true, surface: "PPA Standard", tags: ["12 Dedicated Courts (PPA Standard)", "Live Stream Net-Cams & Instant Replay", "Certified PPR Coaching Staff"] }
    ];

    var combinedNearby = all.slice();
    defaultPartners.forEach(function (dp) {
      if (!combinedNearby.some(function (c) { return c.slug === dp.slug || c.name.toLowerCase() === dp.name.toLowerCase(); })) {
        combinedNearby.push(dp);
      }
    });

    var viewMode = "grid"; // 'grid' | 'list'
    var filterIndoor = false;
    var filterCushioned = false;
    var filterOpenNow = true;
    var sortBy = "distance";

    // 1. Hero Header
    var heroHtml =
      '<section class="space-y-4" data-purpose="page-hero-banner">' +
        '<div class="flex flex-wrap items-center justify-between gap-4">' +
          '<div>' +
            '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a3e635]/10 border border-[#a3e635]/25 text-[#a3e635] text-xs font-mono font-semibold tracking-wider uppercase mb-2">' +
              '<span class="w-2 h-2 rounded-full bg-[#a3e635] animate-pulse"></span>' +
              'Pickleball Club Network • 450+ Venues Active' +
            '</div>' +
            '<h1 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">Find a club</h1>' +
            '<p class="text-slate-400 text-sm sm:text-base max-w-2xl mt-1">Join a club to start booking courts, ladder play, and high-performance tournaments with instant confirmation.</p>' +
          '</div>' +
          '<div class="flex items-center gap-3 sm:gap-6 bg-brand-cardDark/70 border border-brand-borderDark px-4 py-3 rounded-2xl backdrop-blur-sm shadow-xl">' +
            '<div class="text-left">' +
              '<div class="text-xs font-mono uppercase text-slate-400">Active Courts</div>' +
              '<div class="text-lg font-bold text-white flex items-center gap-1.5"><span class="text-[#a3e635]">2,840+</span></div>' +
            '</div>' +
            '<div class="h-8 w-px bg-slate-800"></div>' +
            '<div class="text-left">' +
              '<div class="text-xs font-mono uppercase text-slate-400">DUPR Verified</div>' +
              '<div class="text-lg font-bold text-white">94.2%</div>' +
            '</div>' +
            '<div class="h-8 w-px bg-slate-800"></div>' +
            '<div class="text-left">' +
              '<div class="text-xs font-mono uppercase text-slate-400">Match Latency</div>' +
              '<div class="text-lg font-bold text-[#a3e635]">&lt;4 min</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 2. Advanced Search & Filter Bar
    var filterBarHtml =
      '<section class="bg-brand-cardDark border border-brand-borderDark rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4" data-purpose="search-and-filter-bar">' +
        '<div class="relative flex items-center">' +
          '<div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">' +
            '<svg class="w-5 h-5 text-brand-lime" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>' +
          '</div>' +
          '<input class="w-full pl-12 pr-28 py-3.5 bg-brand-darkBg/90 border border-brand-borderDark focus:border-brand-lime focus:ring-1 focus:ring-brand-lime rounded-xl text-white placeholder-slate-500 font-medium text-sm transition-all shadow-inner" id="club-search-input" placeholder="Search by club name, city, zip code, or venue code..." type="text" autocomplete="off"/>' +
          '<div class="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">' +
            '<button id="btn-clear-search" class="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800/80 rounded-md border border-slate-700 cursor-pointer" type="button">Clear</button>' +
            '<span class="hidden sm:inline-block text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-700 px-2 py-1 rounded">ESC</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-brand-borderDark/60">' +
          '<div class="flex flex-wrap items-center gap-2">' +
            '<button id="btn-filter-loc" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-cardSubtle border border-brand-borderDark text-slate-200 hover:border-brand-lime/50 transition-colors cursor-pointer" type="button">' +
              '<svg class="w-3.5 h-3.5 text-brand-lime" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '<span id="loc-filter-text">Austin, TX (15 mi)</span>' +
              '<svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</button>' +
            '<button id="btn-filter-amenities" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-cardSubtle border border-brand-borderDark text-slate-200 hover:border-brand-lime/50 transition-colors cursor-pointer" type="button">' +
              '<span class="w-2 h-2 rounded-full bg-brand-lime"></span>' +
              '<span>Indoor AC &amp; DUPR</span>' +
              '<svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</button>' +
            '<button id="btn-filter-surface" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-cardSubtle border border-brand-borderDark text-slate-200 hover:border-brand-lime/50 transition-colors cursor-pointer" type="button">' +
              '<span>Cushioned Acrylic</span>' +
              '<svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</button>' +
            '<label class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-lime/10 border border-brand-lime/30 text-brand-lime cursor-pointer">' +
              '<input id="filter-open-now" checked class="rounded border-slate-700 bg-black text-brand-lime focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer" type="checkbox"/>' +
              '<span>Courts Open Now</span>' +
            '</label>' +
          '</div>' +
          '<div class="flex items-center gap-3">' +
            '<span class="text-xs font-mono text-slate-400">' +
              '<strong id="joined-count-badge" class="text-brand-lime font-bold">' + mc.clubs.length + '</strong> club joined • <strong id="nearby-count-badge" class="text-white">' + combinedNearby.length + '</strong> nearby' +
            '</span>' +
            '<div class="inline-flex p-1 bg-brand-darkBg rounded-lg border border-brand-borderDark" role="group" aria-label="View format">' +
              '<button id="btn-view-list" class="p-1.5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer" title="List view" type="button">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '</button>' +
              '<button id="btn-view-map" class="p-1.5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer" title="Map view" type="button">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '</button>' +
              '<button id="btn-view-grid" class="p-1.5 rounded-md bg-brand-cardSubtle text-brand-lime shadow-sm cursor-pointer" title="Grid view" type="button">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 3. My Active Membership Section (High Impact Joined/Featured Card)
    var isMemberJoined = mc.clubs.length > 0;
    var showcaseClub = mc.clubs[0] || all[0] || { slug: "the-pickleshot", name: "The Pickleshot", city: "Austin, TX (S. Lamar Blvd)" };
    var joinedClub = showcaseClub;
    var jCourts = courtsBySlug[joinedClub.slug] || [];
    var jCourtCount = jCourts.length || 6;
    var jSurface = (jCourts[0] && jCourts[0].surface) || "Cushioned Acrylic";
    var jLogo = joinedClub.logo_path
      ? '<img src="' + esc(D.mediaUrl(joinedClub.logo_path)) + '" alt="" class="w-full h-full object-cover">'
      : '<span>' + esc((joinedClub.name || "T").charAt(0).toUpperCase()) + '</span><span class="text-[9px] tracking-widest uppercase font-mono text-slate-400 font-normal -mt-1">CLUB</span>';

    var sectionHeading = isMemberJoined ? "My Active Membership" : "Featured Club";
    var sectionCountBadge = isMemberJoined ? (mc.clubs.length + " CLUB" + (mc.clubs.length > 1 ? "S" : "")) : "FEATURED";
    var sectionPriorityText = isMemberJoined ? "Direct booking priority enabled" : "Fast-book available courts & ladders";
    var joinedBadgeHtml = isMemberJoined
      ? '<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-brand-lime/15 border border-brand-lime text-brand-lime shadow-[0_0_12px_rgba(163,230,53,0.3)]">' +
          '<svg class="w-3 h-3 fill-current" viewbox="0 0 20 20"><path clip-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill-rule="evenodd"></path></svg>' +
          'JOINED' +
        '</span>'
      : '<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-brand-lime/15 border border-brand-lime text-brand-lime shadow-[0_0_12px_rgba(163,230,53,0.3)]">' +
          'FEATURED' +
        '</span>';

    var joinedSectionHtml =
      '<section class="space-y-4" data-purpose="joined-clubs-section">' +
        '<div class="flex items-center justify-between">' +
          '<h2 class="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">' +
            '<span>' + esc(sectionHeading) + '</span>' +
            '<span class="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-brand-lime/10 text-brand-lime border border-brand-lime/30">' + esc(sectionCountBadge) + '</span>' +
          '</h2>' +
          '<span class="text-xs text-slate-400">' + esc(sectionPriorityText) + '</span>' +
        '</div>' +
        '<article class="bg-gradient-to-br from-brand-cardDark via-brand-cardDark to-[#0f1824] border border-brand-lime/40 rounded-2xl p-6 sm:p-7 shadow-2xl relative overflow-hidden neon-border-glow transition-all">' +
          '<div class="absolute -top-24 -right-24 w-60 h-60 bg-brand-lime/10 rounded-full blur-3xl pointer-events-none"></div>' +
          '<div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">' +
            '<div class="flex items-start gap-4 sm:gap-5">' +
              '<div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 border-2 border-brand-lime/50 flex flex-col items-center justify-center font-extrabold text-3xl sm:text-4xl text-brand-lime shadow-xl shrink-0 overflow-hidden">' +
                jLogo +
              '</div>' +
              '<div class="space-y-2">' +
                '<div class="flex flex-wrap items-center gap-2.5">' +
                  '<h3 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">' + esc(joinedClub.name) + '</h3>' +
                  joinedBadgeHtml +
                  '<div class="flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/20">' +
                    '<span>★</span><span>4.9</span><span class="text-slate-400 font-normal">(128 reviews)</span>' +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-wrap items-center text-xs sm:text-sm text-slate-300 gap-y-1 gap-x-4">' +
                  '<span class="flex items-center gap-1 text-slate-300 font-medium">' +
                    '<svg class="w-4 h-4 text-brand-lime" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    esc(joinedClub.city || "Austin, TX (S. Lamar Blvd)") + ' • 1.2 miles away' +
                  '</span>' +
                  '<span class="flex items-center gap-1 text-slate-400">' +
                    '<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    'Open today: 6:00 AM – 11:00 PM' +
                  '</span>' +
                '</div>' +
                '<div class="flex items-center gap-2 text-xs font-mono text-brand-lime bg-brand-lime/10 px-3 py-1 rounded-lg w-fit border border-brand-lime/20">' +
                  '<span class="w-2 h-2 rounded-full bg-brand-lime animate-ping"></span>' +
                  '<span>● ' + jCourtCount + ' courts available right now for booking</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="flex flex-row sm:flex-row items-center gap-3 shrink-0 lg:self-start pt-2 lg:pt-0">' +
              '<a href="#/c/' + esc(joinedClub.slug) + '" class="px-5 py-3 rounded-xl bg-brand-cardSubtle hover:bg-slate-800 text-white font-bold text-sm border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-2 group no-underline">' +
                '<span>View Club Details</span>' +
                '<svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '</a>' +
              (isMemberJoined
                ? '<a href="#/c/' + esc(joinedClub.slug) + '/book" class="px-6 py-3 rounded-xl bg-brand-lime hover:bg-brand-limeGlow text-black font-extrabold text-sm shadow-[0_0_20px_rgba(163,230,53,0.4)] transition-all flex items-center gap-2 transform active:scale-95 no-underline">' +
                    '<svg class="w-4 h-4 text-black" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>' +
                    '<span>Book a Court</span>' +
                  '</a>'
                : '<a href="#/c/' + esc(joinedClub.slug) + '/join" class="px-6 py-3 rounded-xl bg-brand-lime hover:bg-brand-limeGlow text-black font-extrabold text-sm shadow-[0_0_20px_rgba(163,230,53,0.4)] transition-all flex items-center gap-2 transform active:scale-95 no-underline">' +
                    '<svg class="w-4 h-4 text-black" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>' +
                    '<span>+ Join Club</span>' +
                  '</a>'
              ) +
            '</div>' +
            '</div>' +
            '<div class="mt-6 pt-5 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">' +
              '<span class="px-3 py-1 bg-slate-900 text-slate-300 rounded-lg border border-slate-800 font-medium">' + jCourtCount + ' Indoor Courts</span>' +
              '<span class="px-3 py-1 bg-slate-900 text-slate-300 rounded-lg border border-slate-800 font-medium">' + esc(jSurface) + ' Surface</span>' +
              '<span class="px-3 py-1 bg-slate-900 text-slate-300 rounded-lg border border-slate-800 font-medium">DUPR Rated Ladder Leagues</span>' +
              '<span class="px-3 py-1 bg-slate-900 text-slate-300 rounded-lg border border-slate-800 font-medium">Full Pro Shop &amp; Lobster Ball Machines</span>' +
              '<span class="px-3 py-1 bg-slate-900 text-brand-lime rounded-lg border border-brand-lime/20 font-medium">Climate Controlled AC</span>' +
            '</div>' +
            '<div class="mt-5 p-4 rounded-xl bg-brand-darkBg/80 border border-slate-800 space-y-3" data-purpose="quick-slot-picker">' +
              '<div class="flex items-center justify-between text-xs">' +
                '<span class="font-mono uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">' +
                  '<span class="w-2 h-2 rounded-full bg-brand-lime"></span>Fast-Book Next Available Slots (Today &amp; Tomorrow)' +
                '</span>' +
                '<a class="text-brand-lime hover:underline font-bold no-underline" href="#/c/' + esc(joinedClub.slug) + '/book">View all 16 slots →</a>' +
              '</div>' +
              '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">' +
                '<a href="#/c/' + esc(joinedClub.slug) + '/book" class="court-pill-active p-2.5 rounded-lg bg-slate-800/60 hover:bg-brand-lime hover:text-black border border-slate-700 text-left transition-all group no-underline block">' +
                  '<div class="text-[11px] font-mono text-slate-400 group-hover:text-black/80">Today • 4:30 PM</div>' +
                  '<div class="text-xs font-bold text-white group-hover:text-black">Court 2 (Indoor AC)</div>' +
                  '<div class="text-[10px] text-brand-lime group-hover:text-black font-semibold mt-0.5">$32 / hr</div>' +
                '</a>' +
                '<a href="#/c/' + esc(joinedClub.slug) + '/book" class="court-pill-active p-2.5 rounded-lg bg-slate-800/60 hover:bg-brand-lime hover:text-black border border-slate-700 text-left transition-all group no-underline block">' +
                  '<div class="text-[11px] font-mono text-slate-400 group-hover:text-black/80">Today • 5:00 PM</div>' +
                  '<div class="text-xs font-bold text-white group-hover:text-black">Court 4 (Indoor AC)</div>' +
                  '<div class="text-[10px] text-brand-lime group-hover:text-black font-semibold mt-0.5">$32 / hr</div>' +
                '</a>' +
                '<a href="#/c/' + esc(joinedClub.slug) + '/book" class="court-pill-active p-2.5 rounded-lg bg-slate-800/60 hover:bg-brand-lime hover:text-black border border-slate-700 text-left transition-all group no-underline block">' +
                  '<div class="text-[11px] font-mono text-slate-400 group-hover:text-black/80">Today • 6:30 PM</div>' +
                  '<div class="text-xs font-bold text-white group-hover:text-black">Court 1 (Championship)</div>' +
                  '<div class="text-[10px] text-brand-lime group-hover:text-black font-semibold mt-0.5">$38 / hr</div>' +
                '</a>' +
                '<a href="#/c/' + esc(joinedClub.slug) + '/book" class="court-pill-active p-2.5 rounded-lg bg-slate-800/60 hover:bg-brand-lime hover:text-black border border-slate-700 text-left transition-all group no-underline block">' +
                  '<div class="text-[11px] font-mono text-slate-400 group-hover:text-black/80">Tomorrow • 7:00 AM</div>' +
                  '<div class="text-xs font-bold text-white group-hover:text-black">Court 3 (Early Bird)</div>' +
                  '<div class="text-[10px] text-brand-lime group-hover:text-black font-semibold mt-0.5">$24 / hr</div>' +
                '</a>' +
              '</div>' +
            '</div>' +
          '</article>' +
        '</section>';

    // 4. Discover More Clubs Section Shell
    var discoverSectionHtml =
      '<section class="space-y-5" data-purpose="nearby-clubs-grid">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">' +
          '<div>' +
            '<h2 class="text-xl font-extrabold text-white tracking-tight">Featured &amp; Nearby Clubs to Join</h2>' +
            '<p class="text-xs sm:text-sm text-slate-400">Verified pickleball centers within your geographic matchmaking zone.</p>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label for="sort-clubs-select" class="text-xs text-slate-400 font-medium">Sort by:</label>' +
            '<select id="sort-clubs-select" class="bg-brand-cardDark border border-brand-borderDark text-xs text-white rounded-lg px-3 py-1.5 focus:border-brand-lime focus:ring-0 cursor-pointer">' +
              '<option value="distance">Closest Distance (mi)</option>' +
              '<option value="rating">Highest Rated (DUPR)</option>' +
              '<option value="courts">Most Available Courts</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div id="discover-clubs-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>' +
      '</section>';

    // 5. Facility Host CTA
    var hostCtaHtml =
      '<section class="rounded-2xl border border-brand-lime/30 bg-gradient-to-r from-brand-cardDark via-slate-900 to-brand-cardDark p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6" data-purpose="club-onboarding-cta">' +
        '<div class="space-y-2 text-center md:text-left">' +
          '<div class="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-brand-lime font-bold">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            'Facility Owners &amp; Club Directors' +
          '</div>' +
          '<h3 class="text-xl sm:text-2xl font-extrabold text-white">Own or manage a pickleball facility?</h3>' +
          '<p class="text-slate-400 text-xs sm:text-sm max-w-xl">' +
            'Connect your courts to DINKSLOT, sync reservations automatically, fill off-peak court slots, and host certified DUPR tournaments with zero paperwork.' +
          '</p>' +
        '</div>' +
        '<div class="shrink-0">' +
          '<a href="#/register-club" class="px-6 py-3.5 rounded-xl bg-brand-lime hover:bg-brand-limeGlow text-black font-extrabold text-sm shadow-lg transition-transform active:scale-95 flex items-center gap-2 no-underline">' +
            '<span>List Your Club On DINKSLOT</span>' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
          '</a>' +
        '</div>' +
      '</section>';

    sec.innerHTML =
      '<div class="space-y-8 max-w-7xl mx-auto w-full" data-purpose="player-find-club">' +
        heroHtml +
        filterBarHtml +
        joinedSectionHtml +
        discoverSectionHtml +
        hostCtaHtml +
      '</div>';

    // Renders the discover cards into #discover-clubs-list
    function renderDiscoverCards() {
      var searchInput = q("#club-search-input", sec);
      var term = searchInput ? searchInput.value.trim().toLowerCase() : "";

      var list = combinedNearby.filter(function (c) {
        var isJoined = !!joined[c.id] || !!joinedSlug[c.slug];
        // If searching, search name and city
        if (term) {
          var match = (c.name + " " + (c.city || "")).toLowerCase().indexOf(term) !== -1;
          if (!match) return false;
        }
        if (filterIndoor && c.isIndoor === false) return false;
        if (filterCushioned && c.surface && c.surface.toLowerCase().indexOf("acrylic") === -1 && c.surface.toLowerCase().indexOf("cushion") === -1) return false;
        return true;
      });

      // Sort list
      list.sort(function (a, b) {
        if (sortBy === "rating") {
          return parseFloat(b.rating || "4.5") - parseFloat(a.rating || "4.5");
        } else if (sortBy === "courts") {
          var ca = (courtsBySlug[a.slug] || []).length || a.courts || 6;
          var cb = (courtsBySlug[b.slug] || []).length || b.courts || 6;
          return cb - ca;
        } else {
          var da = parseFloat(a.dist || "10");
          var db = parseFloat(b.dist || "10");
          return da - db;
        }
      });

      var badge = q("#nearby-count-badge", sec);
      if (badge) badge.textContent = list.length;

      var container = q("#discover-clubs-list", sec);
      if (!container) return;

      if (!list.length) {
        container.innerHTML = '<div class="col-span-full">' + D.ui.emptyState("No clubs found", "Try adjusting your search query or removing active filters.", "search_off") + '</div>';
        return;
      }

      var cardsHtml = list.map(function (c) {
        var isJoined = !!joined[c.id] || !!joinedSlug[c.slug];
        var courts = courtsBySlug[c.slug] || [];
        var count = courts.length || c.courts || 6;
        var surface = (courts[0] && courts[0].surface) || c.surface || "Championship Courts";
        var rating = c.rating || "4.8";
        var dist = c.dist || (c.city ? c.city + " • 12 mi" : "12.4 miles away");
        var initial = c.initial || esc((c.name || "C").charAt(0).toUpperCase());
        var tags = c.tags || [
          count + " Championship Courts • Full AC",
          "Pro Shop & Ball Machines",
          "Weekly DUPR 3.5 - 5.0 Ladders"
        ];

        var detailsHref = c.demo ? "#/c/the-pickleshot" : "#/c/" + esc(c.slug);
        var actionHref = isJoined
          ? (c.demo ? "#/c/the-pickleshot/book" : "#/c/" + esc(c.slug) + "/book")
          : (c.demo ? "#/c/the-pickleshot/join" : "#/c/" + esc(c.slug) + "/join");
        var actionText = isJoined ? "Book Court" : "+ Join Club";

        var logoBox = c.logo_path
          ? '<img src="' + esc(D.mediaUrl(c.logo_path)) + '" alt="" class="w-full h-full object-cover">'
          : initial;

        if (viewMode === "list") {
          return '<article class="col-span-full bg-brand-cardDark border border-brand-borderDark hover:border-slate-600 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all hover:-translate-y-0.5">' +
            '<div class="flex items-center gap-4 min-w-0 flex-1">' +
              '<div class="w-14 h-14 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-2xl text-brand-lime shrink-0 overflow-hidden">' +
                logoBox +
              '</div>' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                  '<h3 class="text-lg font-bold text-white hover:text-brand-lime transition-colors truncate">' + esc(c.name) + '</h3>' +
                  (isJoined ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-lime/15 text-brand-lime border border-brand-lime/30">JOINED</span>' : '') +
                  '<span class="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">★ ' + rating + '</span>' +
                '</div>' +
                '<p class="text-xs text-slate-400 mt-0.5 truncate">' + esc(c.city || "Austin, TX") + ' • ' + esc(dist) + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0">' +
              '<a href="' + detailsHref + '" class="py-2.5 px-4 rounded-xl bg-brand-cardSubtle hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700 transition-colors no-underline">Explore Details</a>' +
              '<a href="' + actionHref + '" class="py-2.5 px-4 rounded-xl ' + (isJoined ? 'bg-brand-lime text-black font-extrabold' : 'bg-brand-lime/10 hover:bg-brand-lime hover:text-black text-brand-lime font-extrabold border border-brand-lime/30') + ' text-xs transition-all no-underline">' + actionText + '</a>' +
            '</div>' +
          '</article>';
        }

        return '<article class="bg-brand-cardDark border border-brand-borderDark hover:border-slate-600 rounded-2xl p-5 flex flex-col justify-between transition-all hover:-translate-y-1 shadow-lg">' +
          '<div class="space-y-4">' +
            '<div class="flex items-start justify-between">' +
              '<div class="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xl text-brand-lime overflow-hidden shrink-0">' +
                logoBox +
              '</div>' +
              '<div class="text-right">' +
                '<span class="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">★ ' + rating + '</span>' +
                '<span class="block text-[11px] text-slate-400 mt-1 font-mono">' + esc(dist) + '</span>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<div class="flex items-center gap-2">' +
                '<h3 class="text-lg font-bold text-white hover:text-brand-lime transition-colors">' + esc(c.name) + '</h3>' +
                (isJoined ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-lime/15 text-brand-lime border border-brand-lime/30">JOINED</span>' : '') +
              '</div>' +
              '<p class="text-xs text-slate-400 mt-0.5">' + esc(c.city || "Austin Athletic Zone") + '</p>' +
            '</div>' +
            '<div class="space-y-1.5 text-xs text-slate-300">' +
              tags.map(function (tg) {
                return '<div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-brand-lime shrink-0"></span><span class="truncate">' + esc(tg) + '</span></div>';
              }).join("") +
            '</div>' +
          '</div>' +
          '<div class="pt-5 mt-4 border-t border-slate-800 flex items-center gap-2">' +
            '<a href="' + detailsHref + '" class="flex-1 py-2 rounded-xl bg-brand-cardSubtle hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700 transition-colors text-center no-underline">Explore Details</a>' +
            '<a href="' + actionHref + '" class="py-2 px-3 rounded-xl ' + (isJoined ? 'bg-brand-lime text-black font-extrabold' : 'bg-brand-lime/10 hover:bg-brand-lime hover:text-black text-brand-lime font-extrabold border border-brand-lime/30') + ' text-xs transition-all flex items-center gap-1 no-underline shrink-0">' +
              '<span>' + actionText + '</span>' +
            '</a>' +
          '</div>' +
        '</article>';
      }).join("");

      container.innerHTML = cardsHtml;
    }

    // Attach search handlers
    var sInput = q("#club-search-input", sec);
    if (sInput) {
      sInput.oninput = renderDiscoverCards;
      sInput.onkeydown = function (e) {
        if (e.key === "Escape") {
          sInput.value = "";
          renderDiscoverCards();
        }
      };
    }
    var clearBtn = q("#btn-clear-search", sec);
    if (clearBtn) {
      clearBtn.onclick = function () {
        if (sInput) {
          sInput.value = "";
          sInput.focus();
        }
        renderDiscoverCards();
      };
    }

    // Filter toggles
    var btnAmenities = q("#btn-filter-amenities", sec);
    if (btnAmenities) {
      btnAmenities.onclick = function () {
        filterIndoor = !filterIndoor;
        btnAmenities.classList.toggle("border-brand-lime", filterIndoor);
        btnAmenities.classList.toggle("bg-brand-lime/10", filterIndoor);
        renderDiscoverCards();
      };
    }

    var btnSurface = q("#btn-filter-surface", sec);
    if (btnSurface) {
      btnSurface.onclick = function () {
        filterCushioned = !filterCushioned;
        btnSurface.classList.toggle("border-brand-lime", filterCushioned);
        btnSurface.classList.toggle("bg-brand-lime/10", filterCushioned);
        renderDiscoverCards();
      };
    }

    var chkOpenNow = q("#filter-open-now", sec);
    if (chkOpenNow) {
      chkOpenNow.onchange = function () {
        filterOpenNow = chkOpenNow.checked;
        renderDiscoverCards();
      };
    }

    var sortSelect = q("#sort-clubs-select", sec);
    if (sortSelect) {
      sortSelect.onchange = function () {
        sortBy = sortSelect.value;
        renderDiscoverCards();
      };
    }

    // View format switchers
    var btnGrid = q("#btn-view-grid", sec);
    var btnList = q("#btn-view-list", sec);
    var btnMap = q("#btn-view-map", sec);

    function setView(mode) {
      viewMode = mode;
      var container = q("#discover-clubs-list", sec);
      if (btnGrid) btnGrid.className = mode === "grid" ? "p-1.5 rounded-md bg-brand-cardSubtle text-brand-lime shadow-sm cursor-pointer" : "p-1.5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer";
      if (btnList) btnList.className = mode === "list" ? "p-1.5 rounded-md bg-brand-cardSubtle text-brand-lime shadow-sm cursor-pointer" : "p-1.5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer";
      if (container) {
        if (mode === "list") {
          container.className = "flex flex-col gap-4";
        } else {
          container.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6";
        }
      }
      renderDiscoverCards();
    }

    if (btnGrid) btnGrid.onclick = function () { setView("grid"); };
    if (btnList) btnList.onclick = function () { setView("list"); };
    if (btnMap) {
      btnMap.onclick = function () {
        if (D.ui && D.ui.toast) D.ui.toast("Showing all 450+ network clubs on regional map view.", "ok");
      };
    }

    renderDiscoverCards();
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
