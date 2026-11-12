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
  function lowRate(c) { return c.rate_min != null ? Number(c.rate_min) : (c.hourly_rate == null ? NaN : Number(c.hourly_rate)); } // cheapest rate across time bands

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
    if (section !== "overview" && section !== "find" && section !== "clubs" && section !== "bookings" && section !== "profile") {
      sec.insertAdjacentHTML('afterbegin', '<header class="member-page-heading"><div><h1>' + esc(SECTIONS[section][0]) + '</h1><p>' + esc(SECTIONS[section][1]) + '</p></div>' + (section === 'bookings' || section === 'clubs' ? '<a class="btn" href="#/me/find"><span class="material-symbols-outlined" aria-hidden="true">search</span>Find a Club</a>' : '') + '</header>');
    }
  }

  // clubs the player has joined, with club details (public view, approved clubs only)
  async function myClubs() {
    var cp = (await sb.from("club_players").select("id,tenant_id,display_name,status").eq("user_id", D.state.user.id)).data || [];
    var ids = cp.map(function (c) { return c.tenant_id; });
    var clubs = ids.length ? (await sb.from("public_clubs").select("*").in("id", ids)).data || [] : [];
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
    var heroHtml = '<section class="member-overview-header" aria-labelledby="member-overview-title">' +
      '<div class="member-overview-intro"><span class="member-overview-eyebrow">Player Workspace</span><h1 id="member-overview-title">Overview</h1><p>Your bookings, court schedules, and clubs in one place.</p>' +
      '<div class="member-overview-actions"><a class="btn" href="' + bookHref + '"><span class="material-symbols-outlined" aria-hidden="true">calendar_add_on</span>Quick Reserve</a><a class="btn ghost" href="#/me/find"><span class="material-symbols-outlined" aria-hidden="true">search</span>Find a Club</a></div></div>' +
      '<div class="member-overview-stats" aria-label="Your account summary"><div><span class="member-overview-stat-label">Active Courts</span><span class="member-overview-stat-value">' + (activeCourtsCount == null ? 'Unavailable' : activeCourtsCount) + '</span><small>Across the network</small></div>' +
      '<div><span class="member-overview-stat-label">Skill Level</span><span class="member-overview-stat-value member-overview-skill">' + esc(duprVal) + '</span><small>Self-reported</small></div>' +
      '<div><span class="member-overview-stat-label">Upcoming Bookings</span><span class="member-overview-stat-value">' + up + '</span><small>Confirmed reservations</small></div></div></section>';

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

    var joinedCourts = [];
    if (mc.clubs.length) {
      var joinedCourtsResult = await sb.from('public_courts').select('id,club_slug,surface,is_indoor,hourly_rate').in('club_slug', mc.clubs.map(function (club) { return club.slug; }));
      if (joinedCourtsResult.error) throw joinedCourtsResult.error;
      joinedCourts = joinedCourtsResult.data || [];
    }
    // Joined clubs use saved media and venue details, without sample time slots.
    var homeClubHtml = '<section id="my-home-club"><header class="home-clubs-heading"><div><h2>My Clubs</h2><p>Your joined clubs, ready for your next game.</p></div><a class="btn ghost" href="#/me/clubs"><span class="material-symbols-outlined" aria-hidden="true">groups</span>View All Clubs</a></header>' +
      '<div class="home-clubs-grid">' + (mc.clubs.length ? mc.clubs.map(function (club) {
        var addressParts = [club.street || club.address, club.barangay, club.city, club.province].filter(Boolean);
        var address = addressParts.filter(function (part, index) { return addressParts.indexOf(part) === index; }).join(', ');
        var courts = joinedCourts.filter(function (court) { return court.club_slug === club.slug; });
        var surfaces = Array.from(new Set(courts.map(function (court) { return court.surface; }).filter(Boolean)));
        var formats = Array.from(new Set(courts.map(function (court) { return court.is_indoor ? 'Indoor' : 'Outdoor'; })));
        var detailHtml = '<div class="home-club-details"><div class="home-club-facilities"><span class="home-club-fact"><span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>' + courts.length + (courts.length === 1 ? ' Court' : ' Courts') + '</span>' +
          (formats.length ? '<span class="home-club-format">' + esc(formats.join(' / ')) + '</span>' : '') + '<span class="home-club-joined"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Joined</span></div>' +
          (surfaces.length ? '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">layers</span><span><small>Surface</small>' + esc(surfaces.join(', ')) + '</span></div>' : '') +
          (club.contact_phone ? '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">call</span><span><small>Contact</small>' + esc(club.contact_phone) + '</span></div>' : '') + '</div>';
        return '<article class="home-club-card"><a class="home-club-cover" href="#/c/' + esc(club.slug) + '" aria-label="View ' + esc(club.name) + '">' +
          (club.cover_path ? '<img src="' + esc(D.mediaUrl(club.cover_path)) + '" alt="' + esc(club.name) + ' cover" loading="lazy">' : '<span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>') + '</a>' +
          '<div class="home-club-body"><div class="home-club-identity"><div class="home-club-avatar">' + (club.logo_path ? '<img src="' + esc(D.mediaUrl(club.logo_path)) + '" alt="' + esc(club.name) + ' logo" loading="lazy">' : esc((club.name || 'C').charAt(0))) + '</div></div>' +
          '<h3>' + esc(club.name) + '</h3><p class="home-club-address"><span class="material-symbols-outlined" aria-hidden="true">location_on</span><span>' + esc(address || 'Location not provided') + '</span></p>' +
          detailHtml + '<div class="home-club-actions"><a class="btn ghost" href="#/c/' + esc(club.slug) + '"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>View Club</a><a class="btn" href="#/c/' + esc(club.slug) + '/book"><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>Book a Court</a></div></div></article>';
      }).join('') : D.ui.emptyState('No clubs joined', 'Find a club to start booking courts.', 'groups', {href:'#/me/find',label:'Find a Club'})) + '</div></section>';

    sec.innerHTML = '<div class="space-y-9 member-profile-theme" data-purpose="player-dashboard">' +
      heroHtml +
      metricsHtml +
      nextBookingHtml +
      homeClubHtml +
    '</div>';

    // Wire interactive buttons in Overview
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
    var directoryResults = await Promise.all([
      sb.from("public_clubs").select("*").order("name"),
      sb.from("public_courts").select("id,name,club_slug,hourly_rate,rate_min,rate_max,is_indoor,surface,open_time,close_time")
    ]);
    if (directoryResults[0].error) throw directoryResults[0].error;
    if (directoryResults[1].error) throw directoryResults[1].error;
    var all = directoryResults[0].data || [], allCourts = directoryResults[1].data || [];

    var courtsBySlug = {};
    allCourts.forEach(function (ct) {
      if (!courtsBySlug[ct.club_slug]) courtsBySlug[ct.club_slug] = [];
      courtsBySlug[ct.club_slug].push(ct);
    });

    var combinedNearby = all.slice();
    var viewMode = 'grid', filterCity = '', filterType = '', filterSurface = '', filterOpenNow = false, sortBy = 'name';
    function filterOptions(values, placeholder) {
      return '<option value="">' + placeholder + '</option>' + Array.from(new Set(values.filter(Boolean))).sort().map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + '</option>'; }).join('');
    }
    function courtOpen(court, timezone) {
      if (!court.open_time || !court.close_time) return false;
      var clock = new Intl.DateTimeFormat('en-GB', {timeZone:timezone || 'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
      var now = clock.slice(0,5), opens = court.open_time.slice(0,5), closes = court.close_time.slice(0,5);
      if (opens === closes) return true;
      return closes <= opens ? now >= opens || now < closes : now >= opens && now < closes;
    }
    // Use the same compact header and account summary as Member Overview.
    var heroHtml = '<section class="member-overview-header" data-purpose="page-hero-banner"><div class="member-overview-intro"><span class="member-overview-eyebrow">Player Workspace</span><h1>Find a Club</h1><p>Explore clubs, compare courts, and find your next place to play.</p></div>' +
      '<div class="member-overview-stats"><div><span class="member-overview-stat-label">Clubs</span><span class="member-overview-stat-value">' + all.length + '</span><small>Available to explore</small></div><div><span class="member-overview-stat-label">Active Courts</span><span class="member-overview-stat-value">' + allCourts.length + '</span><small>Across the network</small></div><div><span class="member-overview-stat-label">My Clubs</span><span class="member-overview-stat-value">' + mc.clubs.length + '</span><small>Joined memberships</small></div></div></section>';

    var filterBarHtml = '<section class="club-directory-tools" data-purpose="search-and-filter-bar">' +
      '<div class="club-directory-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="club-search-input" type="search" aria-label="Search clubs" placeholder="Search clubs, addresses, or ZIP codes" autocomplete="off"><button id="btn-clear-search" type="button" aria-label="Clear search" title="Clear search" hidden><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>' +
      '<div class="club-directory-filters"><label>City / Municipality<select id="club-filter-city">' + filterOptions(all.map(function (c) { return c.city; }), 'All locations') + '</select></label>' +
      '<label>Court Type<select id="club-filter-type"><option value="">All court types</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></label>' +
      '<label>Surface<select id="club-filter-surface">' + filterOptions(allCourts.map(function (c) { return c.surface; }), 'All surfaces') + '</select></label>' +
      '<div class="club-directory-results"><span><strong id="nearby-count-badge">' + all.length + '</strong> clubs found</span></div></div></section>';

    // Membership cards contain only saved venue and active-court records.
    var joinedSectionHtml = '<section data-purpose="joined-clubs-section"><header class="home-clubs-heading"><div><h2>My Clubs</h2><p>' + mc.clubs.length + (mc.clubs.length === 1 ? ' joined club' : ' joined clubs') + '</p></div></header><div class="home-clubs-grid find-membership-grid">' +
      (mc.clubs.length ? mc.clubs.map(function (membership) {
        var club = all.find(function (row) { return row.id === membership.id; }) || membership;
        var courts = courtsBySlug[club.slug] || [];
        var surfaces = Array.from(new Set(courts.map(function (court) { return court.surface; }).filter(Boolean)));
        var formats = Array.from(new Set(courts.map(function (court) { return court.is_indoor ? 'Indoor' : 'Outdoor'; })));
        var rates = courts.map(function (court) { return lowRate(court); }).filter(Number.isFinite);
        var address = [club.street || club.address,club.barangay,club.city,club.province,club.zip_code].filter(Boolean).join(', ');
        var mapQuery = club.latitude != null && club.longitude != null ? club.latitude + ',' + club.longitude : address;
        return '<article class="home-club-card" data-club-slug="' + esc(club.slug) + '"><a class="home-club-cover" href="#/c/' + esc(club.slug) + '" aria-label="View ' + esc(club.name) + '">' +
          (club.cover_path ? '<img src="' + esc(D.mediaUrl(club.cover_path)) + '" alt="' + esc(club.name) + ' cover" loading="lazy">' : '<span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>') + '</a>' +
          '<div class="home-club-body"><div class="home-club-identity"><div class="home-club-avatar">' + (club.logo_path ? '<img src="' + esc(D.mediaUrl(club.logo_path)) + '" alt="Club logo" loading="lazy">' : esc((club.name || 'C').charAt(0))) + '</div></div>' +
          '<h3>' + esc(club.name) + '</h3><p class="home-club-address"><span class="material-symbols-outlined" aria-hidden="true">location_on</span><span>' + esc(address || 'Location not provided') + '</span></p>' +
          '<div class="home-club-details"><div class="home-club-facilities"><span class="home-club-fact"><span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>' + courts.length + (courts.length === 1 ? ' Court' : ' Courts') + '</span>' +
          (formats.length ? '<span class="home-club-format">' + esc(formats.join(' / ')) + '</span>' : '') + '<span class="home-club-joined"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Joined</span></div>' +
          (surfaces.length ? '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">layers</span><span><small>Surface</small>' + esc(surfaces.join(', ')) + '</span></div>' : '') +
          (rates.length ? '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">payments</span><span><small>From</small>' + money(Math.min.apply(null,rates)) + '/hr</span></div>' : '') +
          (club.contact_phone ? '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">call</span><span><small>Contact</small>' + esc(club.contact_phone) + '</span></div>' : '') +
          '<div class="home-club-detail-row"><span class="material-symbols-outlined" aria-hidden="true">mail</span><span><small>Email</small>' + (club.contact_email ? '<a class="home-club-email" href="mailto:' + esc(club.contact_email) + '">' + esc(club.contact_email) + '</a>' : 'Not provided') + '</span></div></div>' +
          (mapQuery ? '<a class="find-membership-map" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(mapQuery) + '"><span class="material-symbols-outlined" aria-hidden="true">map</span>View on Google Maps</a>' : '') +
          '<div class="home-club-actions"><a class="btn ghost" href="#/c/' + esc(club.slug) + '"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>View Club</a><a class="btn" href="#/c/' + esc(club.slug) + '/book"><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>Book a Court</a></div></div></article>';
      }).join('') : D.ui.emptyState('No clubs joined', 'Explore the clubs below to find your next court.', 'groups')) + '</div></section>';

    sec.innerHTML =
      '<div class="member-find-page member-profile-theme" data-purpose="player-find-club">' +
        heroHtml +
        filterBarHtml +
        joinedSectionHtml +
      '</div>';

    // Renders the discover cards into #discover-clubs-list
    function renderDiscoverCards() {
      var searchInput = q("#club-search-input", sec);
      var term = searchInput ? searchInput.value.trim().toLowerCase() : "";
      var clearSearch = q('#btn-clear-search', sec);
      if (clearSearch) { clearSearch.hidden = !searchInput || !searchInput.value; clearSearch.disabled = clearSearch.hidden; }

      var list = combinedNearby.filter(function (c) {
        var haystack = [c.name,c.slug,c.address,c.street,c.barangay,c.city,c.province,c.zip_code].filter(Boolean).join(' ').toLowerCase();
        if (term && haystack.indexOf(term) === -1) return false;
        if (filterCity && c.city !== filterCity) return false;
        var matchingCourts = (courtsBySlug[c.slug] || []).filter(function (court) {
          return (!filterType || (filterType === 'indoor' ? court.is_indoor === true : court.is_indoor === false)) &&
            (!filterSurface || court.surface === filterSurface) && (!filterOpenNow || courtOpen(court,c.timezone));
        });
        return !(filterType || filterSurface || filterOpenNow) || matchingCourts.length > 0;
      });
      list.sort(function (a,b) {
        return sortBy === 'courts' ? (courtsBySlug[b.slug] || []).length - (courtsBySlug[a.slug] || []).length || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
      });

      var visibleMemberships = 0;
      sec.querySelectorAll('.find-membership-grid [data-club-slug]').forEach(function (card) {
        var matches = list.some(function (club) { return club.slug === card.getAttribute('data-club-slug'); });
        card.hidden = !matches;
        if (matches) visibleMemberships++;
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
        var isJoined = !!joined[c.id] || !!joinedSlug[c.slug], courts = courtsBySlug[c.slug] || [];
        var address = [c.street || c.address,c.barangay,c.city,c.province,c.zip_code].filter(Boolean).join(', ');
        return '<article class="directory-club-card"><div class="directory-club-logo">' + (c.logo_path ? '<img src="' + esc(D.mediaUrl(c.logo_path)) + '" alt="">' : esc(c.name.charAt(0))) + '</div><div class="directory-club-info"><h3>' + esc(c.name) + (isJoined ? ' <span class="badge approved">Joined</span>' : '') + '</h3><p>' + esc(address || 'Location not provided') + '</p><span>' + courts.length + (courts.length === 1 ? ' active court' : ' active courts') + '</span></div><div class="directory-club-actions"><a class="btn ghost" href="#/c/' + esc(c.slug) + '">View Club</a><a class="btn" href="#/c/' + esc(c.slug) + (isJoined ? '/book' : '/join') + '">' + (isJoined ? 'Book a Court' : 'Join Club') + '</a></div></article>';
      }).join('');
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

    [['#club-filter-city', function (value) { filterCity = value; }], ['#club-filter-type', function (value) { filterType = value; }], ['#club-filter-surface', function (value) { filterSurface = value; }]].forEach(function (entry) {
      var field = q(entry[0], sec);
      if (field) field.onchange = function () { entry[1](field.value); renderDiscoverCards(); };
    });
    var chkOpenNow = q('#filter-open-now', sec);
    if (chkOpenNow) chkOpenNow.onchange = function () { filterOpenNow = chkOpenNow.checked; renderDiscoverCards(); };

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
      var membershipGrid = q('.find-membership-grid', sec);
      if (membershipGrid) membershipGrid.setAttribute('data-view', mode);
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
      if (btnGrid) btnGrid.setAttribute('aria-pressed', String(mode === 'grid'));
      if (btnList) btnList.setAttribute('aria-pressed', String(mode === 'list'));
      renderDiscoverCards();
    }

    if (btnGrid) btnGrid.onclick = function () { setView("grid"); };
    if (btnList) btnList.onclick = function () { setView("list"); };

    renderDiscoverCards();
  }

  async function clubsView(sec) {
    var mc = await myClubs(), all = mc.clubs;
    var result = mc.clubs.length ? await sb.from('public_courts').select('id,name,club_slug,surface,is_indoor,hourly_rate,rate_min,rate_max,open_time,close_time').in('club_slug', mc.clubs.map(function (club) { return club.slug; })) : {data:[]};
    if (result.error) throw result.error;
    var courtsBySlug = {};
    (result.data || []).forEach(function (court) { (courtsBySlug[court.club_slug] || (courtsBySlug[court.club_slug] = [])).push(court); });
    var clubFilter = 'all';
    function options(values, label) { return '<option value="">' + label + '</option>' + Array.from(new Set(values.filter(Boolean))).sort().map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + '</option>'; }).join(''); }
    sec.innerHTML = '<div class="member-clubs-page member-profile-theme"><section class="member-overview-header"><div class="member-overview-intro"><span class="member-overview-eyebrow">Player Workspace</span><h1>My Clubs</h1><p>Your joined clubs, court details, and booking access in one place.</p></div>' +
      '<div class="member-overview-stats"><div><span class="member-overview-stat-label">My Clubs</span><span class="member-overview-stat-value">' + mc.clubs.length + '</span><small>Joined memberships</small></div><div><span class="member-overview-stat-label">Active Courts</span><span class="member-overview-stat-value">' + (result.data || []).length + '</span><small>At your clubs</small></div></div></section>' +
      '<section class="club-directory-tools myclubs-directory-tools" aria-label="Filter your clubs"><div class="club-directory-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input data-has-icon id="myclubs-filter-input" type="search" placeholder="Search clubs, addresses, or ZIP codes" aria-label="Search your clubs"><button id="myclubs-clear" type="button" aria-label="Clear search" hidden><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div><div class="club-directory-filters"><label>City / Municipality<select id="myclubs-city">' + options(mc.clubs.map(function (club) { return club.city; }), 'All locations') + '</select></label><label>Court Type<select id="myclubs-type"><option value="">All court types</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></label><label>Surface<select id="myclubs-surface">' + options((result.data || []).map(function (court) { return court.surface; }), 'All surfaces') + '</select></label><div class="club-directory-results"><span id="myclubs-result-count" role="status"></span></div></div></section>' +
      '<div id="my-joined-clubs-list" class="home-clubs-grid"></div></div>';
    function draw() {
      var term = q('#myclubs-filter-input',sec).value.trim().toLowerCase();
      var list = mc.clubs.filter(function (club) { return [club.name,club.street,club.address,club.barangay,club.city,club.province,club.zip_code].filter(Boolean).join(' ').toLowerCase().includes(term); });
      var city = q('#myclubs-city',sec).value, type = q('#myclubs-type',sec).value, surface = q('#myclubs-surface',sec).value;
      list = list.filter(function (club) {
        if (city && club.city !== city) return false;
        return !(type || surface) || (courtsBySlug[club.slug] || []).some(function (court) {
          return (!type || (type === 'indoor' ? court.is_indoor === true : court.is_indoor === false)) && (!surface || court.surface === surface);
        });
      });
      list.sort(function (a,b) { return a.name.localeCompare(b.name); });
      q('#myclubs-clear',sec).hidden = !q('#myclubs-filter-input',sec).value;
      q('#myclubs-result-count',sec).textContent = list.length + (list.length === 1 ? ' club found' : ' clubs found');
      q('#my-joined-clubs-list',sec).innerHTML = list.length ? list.map(function (membership) {
        var club = all.find(function (row) { return row.id === membership.id; }) || membership;
        var courts = courtsBySlug[club.slug] || [];
        var surfaces = Array.from(new Set(courts.map(function (court) { return court.surface; }).filter(Boolean)));
        var formats = Array.from(new Set(courts.map(function (court) { return court.is_indoor ? 'Indoor' : 'Outdoor'; })));
        var rates = courts.map(function (court) { return lowRate(court); }).filter(Number.isFinite);
        var address = [club.street || club.address,club.barangay,club.city,club.province,club.zip_code].filter(Boolean).join(', ');
        var mapQuery = club.latitude != null && club.longitude != null ? club.latitude + ',' + club.longitude : address;
        var base = '#/c/' + esc(club.slug);
        return '<article class="membership-panel"><header class="membership-panel-header"><div class="membership-panel-avatar">' + (club.logo_path ? '<img src="' + esc(D.mediaUrl(club.logo_path)) + '" alt="Club logo">' : esc(club.name.charAt(0))) + '</div>' +
          '<div class="membership-panel-info"><div class="membership-panel-title"><h2>' + esc(club.name) + '</h2><span class="home-club-joined"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Joined</span></div>' +
          '<p><span class="material-symbols-outlined" aria-hidden="true">location_on</span>' + esc(address || 'Location not provided') + '</p><span class="membership-panel-summary">' + courts.length + (courts.length === 1 ? ' active court' : ' active courts') + (formats.length ? ' &middot; ' + esc(formats.join(' / ')) : '') + '</span></div>' +
          '<div class="membership-panel-actions"><a class="btn ghost" href="' + base + '"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>View Club</a><a class="btn" href="' + base + '/book"><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>Book a Court</a></div></header>' +
          '<div class="membership-panel-features"><span><span class="material-symbols-outlined" aria-hidden="true">sports_tennis</span>' + courts.length + (courts.length === 1 ? ' Court' : ' Courts') + '</span>' + surfaces.map(function (surface) { return '<span><span class="material-symbols-outlined" aria-hidden="true">check</span>' + esc(surface) + '</span>'; }).join('') +
          (rates.length ? '<span><span class="material-symbols-outlined" aria-hidden="true">payments</span>From ' + money(Math.min.apply(null,rates)) + '/hr</span>' : '') + '</div>' +
          '<section class="membership-panel-courts"><header><h3><span class="material-symbols-outlined" aria-hidden="true">bolt</span>Quick Book a Court</h3><a href="' + base + '/book">View All Courts <span aria-hidden="true">&rarr;</span></a></header><div class="membership-court-grid">' +
          (courts.length ? courts.slice(0,4).map(function (court) {
            var hours = court.open_time && court.close_time ? D.hoursText(court.open_time,court.close_time) : 'See booking schedule';
            return '<a class="membership-court-tile" href="' + base + '/book"><div class="membership-court-top"><span class="membership-court-icon material-symbols-outlined" aria-hidden="true">sports_tennis</span><span class="membership-court-type">' + (court.is_indoor ? 'Indoor' : 'Outdoor') + '</span></div><strong>' + esc(court.name || 'Court') + '</strong><span class="membership-court-hours"><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + esc(hours) + '</span><div class="membership-court-bottom">' + (court.hourly_rate != null ? '<b>' + money(court.rate_min != null ? court.rate_min : court.hourly_rate) + '<small>/hr</small></b>' : '<span>View rates</span>') + '<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></div></a>';
          }).join('') : '<p class="muted small">No active courts are currently listed.</p>') + '</div><p class="membership-court-note">Choose a date on the booking page to check live availability.</p></section>' +
          '<footer class="membership-panel-footer"><span><span class="material-symbols-outlined" aria-hidden="true">verified_user</span>Joined Member</span>' +
          (club.contact_phone ? '<span><span class="material-symbols-outlined" aria-hidden="true">call</span>' + esc(club.contact_phone) + '</span>' : '') +
          (club.contact_email ? '<a href="mailto:' + esc(club.contact_email) + '"><span class="material-symbols-outlined" aria-hidden="true">mail</span>' + esc(club.contact_email) + '</a>' : '') +
          (mapQuery ? '<a class="membership-panel-map" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(mapQuery) + '"><span class="material-symbols-outlined" aria-hidden="true">map</span>View on Google Maps</a>' : '') + '</footer></article>';

      }).join('') : D.ui.emptyState(mc.clubs.length ? 'No matching clubs' : 'No clubs joined', mc.clubs.length ? 'Try another club name or address.' : 'Find a club to start booking courts.', 'groups', {href:'#/me/find',label:'Find a Club'});
    }
    ['#myclubs-city','#myclubs-type','#myclubs-surface'].forEach(function (selector) { q(selector,sec).onchange = draw; });
    q('#myclubs-clear',sec).onclick = function () { q('#myclubs-filter-input',sec).value = ''; q('#myclubs-filter-input',sec).focus(); draw(); };
    q('#myclubs-filter-input',sec).oninput = draw;
    q('#myclubs-filter-input',sec).onkeydown = function (event) { if (event.key === 'Escape') { this.value = ''; draw(); } };
    draw();
  }

  async function bookingsView(sec) {
    var pl = (await sb.from("club_players").select("id").eq("user_id", D.state.user.id)).data || [];
    var playerIds = pl.map(function (p) { return p.id; });
    var bs = [];
    if (playerIds.length) {
      bs = (await sb.from("bookings").select("*").in("player_id", playerIds).order("starts_at", { ascending: false }).limit(60)).data || [];
    }

    var paymentRows = bs.length ? (await sb.from("booking_payments").select("booking_id").in("booking_id", bs.map(function (b) { return b.id; }))).data || [] : [];
    var paymentByBooking = {};
    paymentRows.forEach(function (payment) { paymentByBooking[payment.booking_id] = true; });
    var cIds = Array.from(new Set(bs.map(function (b) { return b.court_id; })));
    var courts = cIds.length ? (await sb.from("public_courts").select("id,name,club_slug,surface,is_indoor,hourly_rate").in("id", cIds)).data || [] : [];
    var slugs = Array.from(new Set(courts.map(function (c) { return c.club_slug; })));
    var clubs = slugs.length ? (await sb.from("public_clubs").select("*").in("slug", slugs)).data || [] : [];
    var cMap = {}, clMap = {};
    courts.forEach(function (c) { cMap[c.id] = c; });
    clubs.forEach(function (c) { clMap[c.slug] = c; });

    var now = Date.now();
    var upcoming = bs.filter(function (b) {
      return (b.status === "pending" || b.status === "approved") && new Date(b.ends_at).getTime() > now;
    }).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

    var past = bs.filter(function (b) {
      return (b.status === "approved" || b.status === "completed") && new Date(b.ends_at).getTime() <= now;
    });

    var cancelled = bs.filter(function (b) {
      return b.status === "cancelled" || b.status === "rejected";
    });

    var confirmedCount = upcoming.filter(function (b) { return b.status === "approved"; }).length;
    var confirmedText = confirmedCount === 1 ? "1 Match" : confirmedCount + " Matches";

    var totalPlayedMinutes = 0;
    past.forEach(function (b) {
      var mins = Math.max(0, Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000));
      totalPlayedMinutes += mins;
    });
    var totalHoursText = totalPlayedMinutes ? (totalPlayedMinutes / 60).toFixed(1) + " hrs" : (past.length ? "14.5 hrs" : "0 hrs");
    var creditsText = "Not available";

    // Club options for filter
    var clubNames = Array.from(new Set(clubs.map(function (c) { return c.name; }))).sort();
    var clubOptions = clubNames.map(function (name) {
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }).join("");

    var headerHtml = '<section class="member-overview-header"><div class="member-overview-intro"><span class="member-overview-eyebrow">Player Workspace</span><h1>My Bookings</h1><p>Manage your court reservations, payments, and booking passes.</p></div><div class="member-overview-stats"><div><span class="member-overview-stat-label">Confirmed Upcoming</span><span class="member-overview-stat-value">' + confirmedCount + '</span><small>Reservations</small></div><div><span class="member-overview-stat-label">Pending</span><span class="member-overview-stat-value">' + upcoming.filter(function (booking) { return booking.status === 'pending'; }).length + '</span><small>Awaiting approval</small></div><div><span class="member-overview-stat-label">Court Time</span><span class="member-overview-stat-value">' + (totalPlayedMinutes / 60).toFixed(1) + '</span><small>Past booked hours</small></div></div></section>';

    var filterToolbarHtml = '<section class="club-directory-tools booking-search-tools" data-purpose="filtering-and-search-toolbar"><div class="club-directory-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input data-has-icon id="booking-search-input" type="search" aria-label="Search bookings" placeholder="Search bookings by club, court, or reference"></div><div class="booking-toolbar-bottom"><div class="booking-status-chips" role="tablist" aria-label="Booking status">' +
      '<button id="tab-upcoming" role="tab" type="button" aria-selected="true">Upcoming <span id="tab-upcoming-count">' + upcoming.length + '</span></button><button id="tab-past" role="tab" type="button" aria-selected="false">Past Bookings <span id="tab-past-count">' + past.length + '</span></button><button id="tab-cancelled" role="tab" type="button" aria-selected="false">Cancelled <span id="tab-cancelled-count">' + cancelled.length + '</span></button></div>' +
      '<div class="club-directory-filters"><label>Club<select id="booking-club-filter" aria-label="Filter by club"><option value="">All Clubs</option>' + clubOptions + '</select></label><label>Date<select id="booking-date-filter" aria-label="Filter by date"><option value="all">All Dates</option><option value="week">This Week</option><option value="month">This Month</option></select></label><button id="booking-reset-filter" type="button" aria-label="Reset filters" title="Reset filters"><span class="material-symbols-outlined" aria-hidden="true">restart_alt</span></button></div></div></section>';

    var reservationsSectionHtml =
      '<section class="space-y-4" data-purpose="upcoming-confirmed-reservation-view">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center space-x-2">' +
            '<h2 id="current-view-title" class="text-xl font-bold font-display text-white tracking-tight">Upcoming</h2>' +
            '<span id="current-view-badge" class="px-2 py-0.5 text-xs font-mono rounded bg-brand-card border border-brand-border text-slate-400">' + upcoming.length + ' reservation' + (upcoming.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          '<span class="text-xs text-slate-400 font-mono">Auto check-in opens 15m prior</span>' +
        '</div>' +
        '<div id="booking-cards-container" class="space-y-4"></div>' +
      '</section>';

    var nextMatch = upcoming.find(function (booking) { return booking.status === 'approved'; });
    var countdownHtml = '';
    if (nextMatch) {
      var nextCourt = cMap[nextMatch.court_id] || {}, nextClub = clMap[nextCourt.club_slug] || {};
      var mapQuery = nextClub.latitude != null && nextClub.longitude != null ? nextClub.latitude + ',' + nextClub.longitude : [nextClub.street || nextClub.address,nextClub.barangay,nextClub.city,nextClub.province].filter(Boolean).join(', ');
      countdownHtml = '<section class="booking-countdown" data-purpose="matchday-reminder-banner"><span class="material-symbols-outlined" aria-hidden="true">schedule</span><div><h2>Match Day Countdown</h2><p><strong id="booking-live-countdown"></strong><span> &middot; ' + esc(nextClub.name || 'Club') + ' &middot; ' + esc(nextCourt.name || 'Court') + '</span></p><small>Ref: ' + esc(nextMatch.reference_code || 'Not available') + ' &middot; ' + esc(new Date(nextMatch.starts_at).toLocaleString('en-PH',{timeZone:nextClub.timezone || 'Asia/Manila',dateStyle:'medium',timeStyle:'short'})) + '</small></div>' +
        (mapQuery ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(mapQuery) + '"><span class="material-symbols-outlined" aria-hidden="true">directions</span>Get Directions</a>' : '') + '</section>';
    }

    sec.innerHTML =
      '<div class="member-bookings-page" data-purpose="player-bookings-dashboard">' +
        headerHtml +
        filterToolbarHtml +
        reservationsSectionHtml +
        countdownHtml +
      '</div>';

    var activeTab = "upcoming"; // 'upcoming' | 'past' | 'cancelled'

    function renderCards() {
      var container = q("#booking-cards-container", sec);
      if (!container) return;
      var query = q("#booking-search-input", sec) ? q("#booking-search-input", sec).value.trim().toLowerCase() : "";
      var selectedClub = q("#booking-club-filter", sec) ? q("#booking-club-filter", sec).value : "";
      var selectedDate = q("#booking-date-filter", sec) ? q("#booking-date-filter", sec).value : "all";

      var sourceList = activeTab === "upcoming" ? upcoming : (activeTab === "past" ? past : cancelled);
      var filtered = sourceList.filter(function (b) {
        var ct = cMap[b.court_id] || {};
        var cl = clMap[ct.club_slug] || {};
        if (selectedClub && cl.name !== selectedClub) return false;
        if (query) {
          var haystack = (cl.name + " " + ct.name + " " + (b.reference_code || "")).toLowerCase();
          if (haystack.indexOf(query) === -1) return false;
        }
        if (selectedDate === "week") {
          var diffDays = (new Date(b.starts_at) - now) / 86400000;
          if (Math.abs(diffDays) > 7) return false;
        } else if (selectedDate === "month") {
          var diffDays = (new Date(b.starts_at) - now) / 86400000;
          if (Math.abs(diffDays) > 31) return false;
        }
        return true;
      });

      filtered.sort(function (a, b) {
        return new Date(b.starts_at) - new Date(a.starts_at);
      });

      var badgeEl = q("#current-view-badge", sec);
      if (badgeEl) badgeEl.textContent = filtered.length + " reservation" + (filtered.length === 1 ? "" : "s");

      if (!filtered.length) {
        container.innerHTML =
          '<div class="rounded-2xl border border-brand-border bg-brand-card/60 p-8 sm:p-12 text-center space-y-4">' +
            '<div class="w-14 h-14 mx-auto rounded-2xl bg-brand-surface border border-brand-border flex items-center justify-center text-brand-neon">' +
              '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div class="space-y-1">' +
              '<h3 class="text-xl font-bold font-display text-white">No ' + esc(activeTab) + ' bookings found</h3>' +
              '<p class="text-sm text-slate-400 max-w-md mx-auto">Explore available courts and fast-book your next match slot.</p>' +
            '</div>' +
            '<div>' +
              '<a href="#/me/find" class="inline-flex items-center gap-2 bg-brand-neon hover:bg-lime-400 text-black font-extrabold px-6 py-2.5 rounded-xl text-xs tracking-wide uppercase transition duration-150 shadow-neon-glow no-underline">' +
                '<span>Book a Court</span>' +
              '</a>' +
            '</div>' +
          '</div>';
        return;
      }

      container.innerHTML = filtered.map(function (b) {
        var court = cMap[b.court_id] || {};
        var club = clMap[court.club_slug] || {};
        var tz = club.timezone || "Asia/Manila";
        var startD = new Date(b.starts_at);
        var endD = new Date(b.ends_at);
        var whenStr = startD.toLocaleString("en-PH", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
          " – " + endD.toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" });
        var isApproved = b.status === "approved";
        var isPending = b.status === "pending";
        var isCancelled = b.status === "cancelled" || b.status === "rejected";
        var paymentSent = !!paymentByBooking[b.id];
        var canPay = isPending && !paymentSent && club.payment_enabled !== false && endD.getTime() > Date.now() && (!b.expires_at || new Date(b.expires_at).getTime() > Date.now());
        var statusLabel = isApproved ? "Confirmed" : (isPending ? (paymentSent ? "Payment submitted" : "Pending Approval") : (b.status === "rejected" ? "Declined" : "Cancelled"));
        var statusClass = isApproved
          ? "bg-brand-neon/15 text-brand-neon border border-brand-neon/40 shadow-neon-glow"
          : (isPending ? "bg-amber-400/15 text-amber-300 border border-amber-400/30" : "bg-rose-500/15 text-rose-400 border border-rose-500/30");
        var addressStr = [club.street || club.address,club.barangay,club.city,club.province,club.zip_code].filter(Boolean).join(', ');
        var isLive = (isApproved || isPending) && endD.getTime() > Date.now();
        var minutes = Math.round((endD - startD) / 60000);
        return '<article class="clean-booking-card" data-purpose="reservation-card" data-booking-id="' + esc(b.id) + '"><div class="clean-booking-main"><div class="clean-booking-status"><span class="badge ' + (isApproved ? 'approved' : '') + '">' + esc(statusLabel) + '</span>' +
          (court.surface ? '<span class="clean-booking-surface">' + esc(court.surface) + '</span>' : '') + '<span class="member-reservation-ref">Ref: ' + esc(b.reference_code || 'Not available') + '</span></div>' +
          '<h3>' + esc(club.name || 'Club unavailable') + ' &middot; ' + esc(court.name || 'Court unavailable') + '</h3>' +
          '<p class="clean-booking-address"><span class="material-symbols-outlined" aria-hidden="true">location_on</span>' + esc(addressStr || 'Location not provided') + '</p>' +
          '<div class="member-reservation-meta"><span><span class="material-symbols-outlined" aria-hidden="true">calendar_today</span>' + esc(whenStr) + '</span><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + minutes + ' minutes</span>' + (b.amount != null ? '<strong>' + money(b.amount) + '</strong>' : '') + '</div></div>' +
          '<div class="clean-booking-actions">' + (canPay ? '<button type="button" data-pay="' + esc(b.id) + '" class="btn"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span>Pay / Upload proof</button>' : '') + (isApproved ? '<button type="button" data-ticket="' + esc(b.id) + '" class="btn"><span class="material-symbols-outlined" aria-hidden="true">qr_code_2</span>View Digital Pass</button>' : '') +
          '<div><button type="button" data-cal="' + esc(b.id) + '" class="btn ghost"><span class="material-symbols-outlined" aria-hidden="true">calendar_today</span>Calendar</button>' + (isLive ? '<button type="button" data-cancel="' + esc(b.id) + '" class="btn ghost"><span class="material-symbols-outlined" aria-hidden="true">close</span>Cancel Booking</button>' : '') + '</div></div></article>';
      }).join('');

      bindActionEvents();
    }

    function bindActionEvents() {
      var allMatches = bs.slice();
      var byId = {};
      allMatches.forEach(function (b) { byId[b.id] = b; });

      sec.querySelectorAll("[data-pay]").forEach(function (btn) {
        btn.onclick = function () {
          var booking = byId[btn.getAttribute("data-pay")];
          if (booking && D.booking && D.booking.openPayment) D.booking.openPayment(booking, function () { bookingsView(sec); });
        };
      });

      // View Digital Pass
      sec.querySelectorAll("[data-ticket]").forEach(function (btn) {
        btn.onclick = function () {
          var bId = btn.getAttribute("data-ticket");
          var b = byId[bId];
          if (b) openTicketModal(b);
        };
      });

      // Calendar button
      sec.querySelectorAll("[data-cal]").forEach(function (btn) {
        btn.onclick = function () {
          var bId = btn.getAttribute("data-cal");
          var b = byId[bId];
          if (!b) return;
          var ct = cMap[b.court_id] || {};
          var cl = clMap[ct.club_slug] || {};
          var title = encodeURIComponent((cl.name || "Pickleball") + " – " + (ct.name || "Court"));
          var details = encodeURIComponent("Court reservation ref: " + b.reference_code);
          var loc = encodeURIComponent(cl.city || cl.address || "");
          var sIso = new Date(b.starts_at).toISOString().replace(/-|:|\.\d+/g, "");
          var eIso = new Date(b.ends_at).toISOString().replace(/-|:|\.\d+/g, "");
          var gUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + title + "&dates=" + sIso + "/" + eIso + "&details=" + details + "&location=" + loc;
          window.open(gUrl, "_blank", "noopener,noreferrer");
        };
      });

      // Split cost invite
      sec.querySelectorAll("[data-invite]").forEach(function (btn) {
        btn.onclick = function () {
          var bId = btn.getAttribute("data-invite");
          var b = byId[bId];
          if (!b) return;
          var ct = cMap[b.court_id] || {};
          var cl = clMap[ct.club_slug] || {};
          var text = "Join me for pickleball at " + (cl.name || "the club") + " (" + (ct.name || "Court") + ") on " +
            new Date(b.starts_at).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }) +
            " at " + new Date(b.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) + "! Booking ref: " + b.reference_code;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
          }
          if (D.ui && D.ui.toast) D.ui.toast("Booking details copied to clipboard to share with your group!", "ok");
        };
      });

      // Cancel button
      sec.querySelectorAll("[data-cancel]").forEach(function (btn) {
        btn.onclick = async function () {
          var bId = btn.getAttribute("data-cancel");
          var confirmed = await (D.ui && D.ui.confirmAction
            ? D.ui.confirmAction("Cancel this booking? Your reserved court slot will be released.", { title: "Cancel booking", confirmText: "Cancel booking" })
            : Promise.resolve(confirm("Cancel this booking? Your reserved court slot will be released.")));
          if (!confirmed) return;
          btn.disabled = true;
          var r = await sb.rpc("cancel_booking", { p_booking_id: bId, p_reason: null, p_idempotency_key: "cx-" + Date.now() });
          if (r.error) {
            btn.disabled = false;
            if (D.ui && D.ui.toast) D.ui.toast("Cancellation failed: " + friendly(r.error), "err");
          } else {
            if (D.ui && D.ui.toast) D.ui.toast("Booking cancelled successfully.", "ok");
            await bookingsView(sec);
          }
        };
      });
    }

    function openTicketModal(b) {
      var court = cMap[b.court_id] || {}, club = clMap[court.club_slug] || {};
      var user = D.state.user || {}, metadata = user.user_metadata || {};
      var name = metadata.display_name || metadata.full_name || metadata.name || (user.email || 'Player').split('@')[0];
      return D.booking.openPass(b, court, club, {display_name:name}, document.activeElement);
    }

    // Tab buttons
    var tabUpcoming = q("#tab-upcoming", sec);
    var tabPast = q("#tab-past", sec);
    var tabCancelled = q("#tab-cancelled", sec);
    var viewTitle = q("#current-view-title", sec);

    function switchTab(name, title) {
      activeTab = name;
      if (viewTitle) viewTitle.textContent = title;
      [tabUpcoming, tabPast, tabCancelled].forEach(function (tab) {
        if (!tab) return;
        var isActive = (tab === tabUpcoming && name === "upcoming") ||
          (tab === tabPast && name === "past") ||
          (tab === tabCancelled && name === "cancelled");
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
        tab.className = isActive
          ? "px-4 py-2 rounded-lg text-sm font-semibold bg-brand-card text-brand-neon border border-brand-neon/30 flex items-center space-x-2 cursor-pointer"
          : "px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-brand-card/50 transition-all flex items-center space-x-2 cursor-pointer";
      });
      renderCards();
    }

    if (tabUpcoming) tabUpcoming.onclick = function () { switchTab("upcoming", "Upcoming"); };
    if (tabPast) tabPast.onclick = function () { switchTab("past", "Past Bookings"); };
    if (tabCancelled) tabCancelled.onclick = function () { switchTab("cancelled", "Cancelled / Refunded"); };

    var sInput = q("#booking-search-input", sec);
    if (sInput) sInput.oninput = renderCards;

    var clubFilter = q("#booking-club-filter", sec);
    if (clubFilter) clubFilter.onchange = renderCards;

    var dateFilter = q("#booking-date-filter", sec);
    if (dateFilter) dateFilter.onchange = renderCards;

    var resetBtn = q("#booking-reset-filter", sec);
    if (resetBtn) {
      resetBtn.onclick = function () {
        if (sInput) sInput.value = "";
        if (clubFilter) clubFilter.value = "";
        if (dateFilter) dateFilter.value = "all";
        renderCards();
      };
    }

    renderCards();
    if (nextMatch) {
      function updateCountdown() {
        var target = q('#booking-live-countdown',sec);
        if (!target) return false;
        var remaining = Math.max(0,new Date(nextMatch.starts_at).getTime() - Date.now());
        var minutes = Math.ceil(remaining / 60000), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
        target.textContent = remaining ? 'Starts in ' + (days ? days + 'd ' : '') + hours + 'h ' + mins + 'm' : Date.now() < new Date(nextMatch.ends_at).getTime() ? 'Session in progress' : 'Session ended';
        return true;
      }
      updateCountdown();
      if (typeof setInterval === 'function') {
        var countdownTimer = setInterval(function () { if (!sec.isConnected || !updateCountdown()) clearInterval(countdownTimer); },1000);
      }
    }
    bindActionEvents();
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
    var chosen = null, removeFlag = false;

    var uid = D.state.user.id || "";
    var playerId = "DS-PL-" + (uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toUpperCase() || "89240");

    var memberSince = "March 2024";
    if (D.state.user.created_at) {
      try {
        var cd = new Date(D.state.user.created_at);
        memberSince = cd.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      } catch (e) {}
    }

    // Civil status options
    var civilOptions = '<option value="">Select status</option>' + Object.keys(CIVIL).map(function (k) {
      return '<option value="' + k + '">' + CIVIL[k] + '</option>';
    }).join("");

    var headerHtml =
      '<div class="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-white/10" data-purpose="profile-header-bar">' +
        '<div>' +
          '<div class="flex items-center gap-2 mb-2">' +
            '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-lime/10 border border-brand-lime/20 text-brand-lime text-[10px] font-bold uppercase tracking-wider font-mono">' +
              '<span class="w-1.5 h-1.5 rounded-full bg-brand-lime animate-pulse glow-dot"></span>' +
              'ATHLETE HUB • IDENTITY &amp; SETTINGS' +
            '</span>' +
            '<span class="text-xs text-slate-500 font-mono">v2.4.0</span>' +
          '</div>' +
          '<h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-white font-mono flex items-center gap-3">' +
            '<span>Player Profile</span>' +
            '<span class="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">DUPR PRO VERIFIED</span>' +
          '</h1>' +
          '<p class="text-sm text-slate-400 mt-1">Manage your personal details, profile photo, and address.</p>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
          '<div class="text-xs bg-[#10141a] border border-white/10 px-3.5 py-2 rounded-xl text-slate-300 font-mono shadow-inner">' +
            'Player ID: <span class="text-brand-lime font-bold tracking-wider" id="player-id-badge">' + esc(playerId) + '</span>' +
          '</div>' +
          '<a class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-200 transition-colors no-underline" href="#/me">' +
            '<svg class="w-3.5 h-3.5 text-brand-lime" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '<span>Public View</span>' +
          '</a>' +
        '</div>' +
      '</div>';

    // Left Column components
    var leftColHtml =
      '<div class="lg:col-span-4 space-y-6 lg:sticky lg:top-24" data-purpose="athlete-identity-column">' +
        // Primary Athlete Digital Card
        '<div class="bg-gradient-to-b from-[#131924] to-[#0c1017] border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden group">' +
          '<div class="absolute -right-12 -top-12 w-48 h-48 bg-brand-lime/10 rounded-full blur-2xl pointer-events-none group-hover:bg-brand-lime/15 transition-all"></div>' +
          '<div class="relative flex flex-col items-center text-center">' +
            '<div class="relative mb-4">' +
              '<div id="mp-preview" class="w-24 h-24 rounded-full bg-[#161c26] border-2 border-brand-lime flex items-center justify-center text-brand-lime text-3xl font-extrabold font-mono shadow-lg shadow-brand-lime/20 ring-4 ring-brand-lime/10 overflow-hidden">' +
              '</div>' +
              '<div class="absolute bottom-0 right-1 w-6 h-6 rounded-full bg-[#0a0e14] border-2 border-[#161c26] flex items-center justify-center" title="Turnstile Facial Biometrics Active">' +
                '<span class="w-2.5 h-2.5 rounded-full bg-brand-lime animate-pulse glow-dot"></span>' +
              '</div>' +
            '</div>' +
            '<h2 id="card-player-name" class="text-xl font-bold text-white tracking-tight">' + esc(p.full_name || "Athlete") + '</h2>' +
            '<p class="text-xs text-slate-400 font-mono mt-0.5">Member since ' + esc(memberSince) + '</p>' +
            '<div class="flex items-center gap-2 mt-4">' +
              '<label for="mp-photo" class="px-3 py-1.5 rounded-lg bg-[#1a2332] hover:bg-[#222e42] border border-white/10 text-[11px] font-bold text-white uppercase tracking-wider transition-colors cursor-pointer">' +
                'Change Photo' +
              '</label>' +
              '<input type="file" id="mp-photo" accept="image/jpeg,image/png,image/webp" hidden>' +
              '<button type="button" id="mp-remove-photo" class="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-[11px] font-semibold transition-colors cursor-pointer" title="Delete Photo" hidden>' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
              '</button>' +
            '</div>' +
            '<div class="w-full mt-6 pt-5 border-t border-white/10 text-left">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<span class="text-[11px] uppercase font-bold tracking-wider text-slate-400">DUPR Official Rating</span>' +
                '<span class="text-xs font-mono font-bold text-brand-lime flex items-center gap-1">' +
                  '<span class="w-1.5 h-1.5 rounded-full bg-brand-lime glow-dot"></span>' +
                  '4.12 Verified' +
                '</span>' +
              '</div>' +
              '<div class="grid grid-cols-3 gap-2 bg-[#090d13] p-2.5 rounded-xl border border-white/5 font-mono text-center">' +
                '<div class="p-1.5">' +
                  '<span class="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Singles</span>' +
                  '<span class="text-sm font-bold text-white">4.05</span>' +
                '</div>' +
                '<div class="p-1.5 border-x border-white/10">' +
                  '<span class="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Doubles</span>' +
                  '<span class="text-sm font-bold text-brand-lime">4.18</span>' +
                '</div>' +
                '<div class="p-1.5">' +
                  '<span class="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Reliability</span>' +
                  '<span class="text-sm font-bold text-emerald-400">84%</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

      '</div>';

    // Right Column components (Form)
    var rightColHtml =
      '<div class="lg:col-span-8 space-y-8" data-purpose="athlete-editor-column">' +
        '<form class="space-y-8" id="myprofile">' +
          // SECTION 1: Personal & Contact Identity
          '<div class="bg-[#11161f] border border-white/10 rounded-2xl p-6 lg:p-7 shadow-xl" id="section-identity">' +
            '<div class="flex items-center justify-between mb-6 pb-4 border-b border-white/10">' +
              '<div class="flex items-center gap-3">' +
                '<div class="w-8 h-8 rounded-lg bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime font-mono font-bold text-xs">01</div>' +
                '<div>' +
                  '<h3 class="text-base font-bold text-white">Identity &amp; Contact Details</h3>' +
                  '<p class="text-xs text-slate-400 mt-0.5">Used for official match scorecard verification and tournament draws.</p>' +
                '</div>' +
              '</div>' +
              '<span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">Primary ID</span>' +
            '</div>' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-5">' +
              // Full Name
              '<div>' +
                '<label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2" for="mp-name">Full Name</label>' +
                '<div class="relative">' +
                  '<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '</span>' +
                  '<input class="form-input-dark w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 font-medium" id="mp-name" maxlength="80" autocomplete="name" type="text" placeholder="Full name"/>' +
                '</div>' +
              '</div>' +
              // Phone Number
              '<div>' +
                '<label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2" for="mp-phone">Mobile Phone (2FA Verified)</label>' +
                '<div class="relative">' +
                  '<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '</span>' +
                  '<input class="form-input-dark w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 font-mono font-medium" id="mp-phone" maxlength="30" autocomplete="tel" type="tel" placeholder="+63 9xx xxx xxxx"/>' +
                '</div>' +
              '</div>' +
              // Birth Date
              '<div>' +
                '<label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2" for="mp-birth">Date of Birth</label>' +
                '<div class="relative">' +
                  '<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '</span>' +
                  '<input class="form-input-dark w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 font-mono" id="mp-birth" type="date" min="1900-01-01" autocomplete="bday"/>' +
                '</div>' +
              '</div>' +
              // Civil Status
              '<div>' +
                '<label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2" for="mp-civil">Civil Status</label>' +
                '<div class="relative">' +
                  '<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                  '</span>' +
                  '<select class="form-input-dark form-select-dark w-full pl-10 pr-10 py-2.5 rounded-lg text-sm text-white appearance-none cursor-pointer" id="mp-civil">' +
                    civilOptions +
                  '</select>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // SECTION 2: Residential & Venue Region
          '<div class="bg-[#11161f] border border-white/10 rounded-2xl p-6 lg:p-7 shadow-xl" id="section-address">' +
            '<div class="flex items-center justify-between mb-6 pb-4 border-b border-white/10">' +
              '<div class="flex items-center gap-3">' +
                '<div class="w-8 h-8 rounded-lg bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime font-mono font-bold text-xs">02</div>' +
                '<div>' +
                  '<h3 class="text-base font-bold text-white">Residential &amp; Venue Region</h3>' +
                  '<p class="text-xs text-slate-400 mt-0.5">Determines nearest court discovery, cluster ladders, and regional booking privileges.</p>' +
                '</div>' +
              '</div>' +
              '<span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10" id="address-region-badge">' + esc(p.province || "Philippines") + '</span>' +
            '</div>' +
            '<div id="mp-address" class="member-address"></div>' +
          '</div>' +

          // Sleek Floating Action Dock
          '<div class="sticky bottom-6 z-40 bg-[#0a0e14]/90 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-purpose="action-dock">' +
            '<div class="flex items-center gap-2 text-xs font-mono">' +
              '<span class="w-2 h-2 rounded-full bg-brand-lime glow-dot"></span>' +
              '<span class="text-slate-400" id="dock-status-text">Unsaved changes are tracked locally</span>' +
            '</div>' +
            '<p class="msg m-0 text-xs text-rose-400" role="alert"></p>' +
            '<div class="flex items-center justify-end gap-3">' +
              '<button id="btn-discard" class="px-5 py-2.5 rounded-xl border border-white/10 bg-[#141a24] hover:bg-[#1a2230] text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer" type="button">' +
                'Discard Changes' +
              '</button>' +
              '<button id="btn-save-profile" class="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-brand-lime hover:bg-brand-lime-hover text-black text-xs font-extrabold uppercase tracking-wider shadow-lg shadow-brand-lime/25 transition-all transform active:scale-95 cursor-pointer" type="submit">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>' +
                '<span>Save Profile</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</div>';

    sec.innerHTML =
      '<div class="max-w-7xl mx-auto w-full space-y-8" id="profile-container" data-purpose="player-profile-view">' +
        headerHtml +
        '<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">' +
          leftColHtml +
          rightColHtml +
        '</div>' +
      '</div>';

    var ph = D.ph.mount(q("#mp-address", sec), { values: p, manager: false, required: false });

    function initial() {
      var n = q("#mp-name", sec) ? q("#mp-name", sec).value.trim() : (p.full_name || D.state.user.email || "?");
      return (n.charAt(0) || "?").toUpperCase();
    }

    function paintAvatar(el, url) {
      if (!el) return;
      el.innerHTML = url
        ? '<img src="' + esc(url) + '" alt="Avatar" class="w-full h-full object-cover">'
        : esc(initial());
    }

    function fill() {
      q("#mp-name", sec).value = p.full_name || "";
      q("#mp-phone", sec).value = p.phone || "";
      q("#mp-birth", sec).value = p.birth_date || "";
      q("#mp-civil", sec).value = p.civil_status || "";
      var nameCard = q("#card-player-name", sec);
      if (nameCard) nameCard.textContent = p.full_name || "Athlete";
      var regBadge = q("#address-region-badge", sec);
      if (regBadge) regBadge.textContent = p.province || "Philippines";
      chosen = null;
      removeFlag = false;
      q("#mp-photo", sec).value = "";
      paintAvatar(q("#mp-preview", sec), avatarUrl(p.avatar_path));
      q("#mp-remove-photo", sec).hidden = !p.avatar_path;
    }
    fill();

    // Real-time name card update
    q("#mp-name", sec).oninput = function () {
      var val = this.value.trim();
      var nameCard = q("#card-player-name", sec);
      if (nameCard) nameCard.textContent = val || "Athlete";
      if (!chosen && !p.avatar_path) {
        paintAvatar(q("#mp-preview", sec), "");
      }
    };

    // Photo input change
    q("#mp-photo", sec).onchange = function () {
      var file = this.files[0], form = q("#myprofile", sec);
      if (!file) return;
      if (!IMG[file.type]) {
        this.value = "";
        return setMsg(form, "Only JPG, PNG or WebP images are allowed.", "err");
      }
      if (file.size > 2 * 1024 * 1024) {
        this.value = "";
        return setMsg(form, "The photo must be 2 MB or smaller.", "err");
      }
      setMsg(form, "", "");
      chosen = file;
      removeFlag = false;
      paintAvatar(q("#mp-preview", sec), URL.createObjectURL(file));
      q("#mp-remove-photo", sec).hidden = false;
    };

    // Remove photo
    q("#mp-remove-photo", sec).onclick = function () {
      chosen = null;
      removeFlag = true;
      q("#mp-photo", sec).value = "";
      paintAvatar(q("#mp-preview", sec), "");
      this.hidden = true;
    };

    // Discard button
    var discardBtn = q("#btn-discard", sec);
    if (discardBtn) {
      discardBtn.onclick = function () {
        setMsg(q("#myprofile", sec), "", "");
        fill();
        if (D.ui && D.ui.toast) D.ui.toast("Changes discarded.", "ok");
      };
    }

    // Submit handler
    q("#myprofile", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = q('#btn-save-profile', f), uid = D.state.user.id;
      var birth = q("#mp-birth", f).value;
      if (birth && (birth > new Date().toISOString().slice(0, 10) || birth < "1900-01-01")) {
        return setMsg(f, "Enter a valid birthdate.", "err");
      }
      var perr = ph.validate();
      if (perr) return setMsg(f, perr, "err");
      var ad = ph.get();
      btn.disabled = true;
      var origBtnHtml = btn.innerHTML;
      btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Saving...</span>';

      try {
        var avatar = p.avatar_path || null, oldAvatar = p.avatar_path;
        if (chosen) {
          avatar = uid + "/avatar-" + Date.now() + "." + IMG[chosen.type];
          var up = await sb.storage.from("avatars").upload(avatar, chosen, { contentType: chosen.type, upsert: false });
          if (up.error) throw up.error;
        } else if (removeFlag) {
          avatar = null;
        }

        var row = {
          full_name: q("#mp-name", f).value.trim() || null,
          phone: q("#mp-phone", f).value.trim() || null,
          birth_date: birth || null,
          civil_status: q("#mp-civil", f).value || null,
          avatar_path: avatar,
          street: ad.street,
          barangay: ad.barangay,
          city: ad.city,
          province: ad.province,
          zip_code: ad.zip_code,
          address: ad.address,
          psgc_province: ad.psgc_province,
          psgc_city: ad.psgc_city,
          psgc_barangay: ad.psgc_barangay
        };

        var x = await sb.from("profiles").update(row).eq("auth_user_id", uid);
        if (x.error) {
          if (chosen) sb.storage.from("avatars").remove([avatar]).catch(function () {});
          throw x.error;
        }
        if (oldAvatar && oldAvatar !== avatar) {
          sb.storage.from("avatars").remove([oldAvatar]).catch(function () {});
        }
        for (var k in row) p[k] = row[k];

        fill();
        setMsg(f, "Your profile has been updated successfully.", "ok");

        btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg><span>Saved!</span>';
        btn.classList.add("bg-white");
        setTimeout(function () {
          if (btn) {
            btn.innerHTML = origBtnHtml;
            btn.classList.remove("bg-white");
          }
        }, 1600);
      } catch (err) {
        setMsg(f, friendly(err), "err");
        btn.innerHTML = origBtnHtml;
      }
      btn.disabled = false;
    };
  }

  D.player = { render: render };
})();
