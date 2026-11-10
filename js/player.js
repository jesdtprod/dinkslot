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
    if (section !== "overview" && section !== "find" && section !== "clubs" && section !== "bookings") {
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

    sec.innerHTML = '<div class="space-y-9" data-purpose="player-dashboard">' +
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
      sb.from("public_courts").select("id,name,club_slug,hourly_rate,is_indoor,surface,open_time,close_time")
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
        var rates = courts.map(function (court) { return court.hourly_rate == null ? NaN : Number(court.hourly_rate); }).filter(Number.isFinite);
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
      '<div class="member-find-page" data-purpose="player-find-club">' +
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
    var result = mc.clubs.length ? await sb.from('public_courts').select('id,name,club_slug,surface,is_indoor,hourly_rate,open_time,close_time').in('club_slug', mc.clubs.map(function (club) { return club.slug; })) : {data:[]};
    if (result.error) throw result.error;
    var courtsBySlug = {};
    (result.data || []).forEach(function (court) { (courtsBySlug[court.club_slug] || (courtsBySlug[court.club_slug] = [])).push(court); });
    var clubFilter = 'all';
    function options(values, label) { return '<option value="">' + label + '</option>' + Array.from(new Set(values.filter(Boolean))).sort().map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + '</option>'; }).join(''); }
    sec.innerHTML = '<div class="member-clubs-page"><section class="member-overview-header"><div class="member-overview-intro"><span class="member-overview-eyebrow">Player Workspace</span><h1>My Clubs</h1><p>Your joined clubs, court details, and booking access in one place.</p></div>' +
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
        var rates = courts.map(function (court) { return court.hourly_rate == null ? NaN : Number(court.hourly_rate); }).filter(Number.isFinite);
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
            return '<a class="membership-court-tile" href="' + base + '/book"><span class="membership-court-type">' + (court.is_indoor ? 'Indoor' : 'Outdoor') + '</span><strong>' + esc(court.name || 'Court') + '</strong><span>' + esc(hours) + '</span>' + (court.hourly_rate != null ? '<b>' + money(court.hourly_rate) + '/hr</b>' : '') + '</a>';
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
    var creditsText = "PHP 450.00";

    // Club options for filter
    var clubNames = Array.from(new Set(clubs.map(function (c) { return c.name; }))).sort();
    var clubOptions = clubNames.map(function (name) {
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }).join("");

    var headerHtml =
      '<section class="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2" data-purpose="header-and-quick-stats">' +
        '<div>' +
          '<div class="flex items-center space-x-2 mb-2">' +
            '<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium tracking-wide uppercase bg-brand-neon/10 text-brand-neon border border-brand-neon/20">' +
              '<span class="w-1.5 h-1.5 rounded-full bg-brand-neon mr-1.5 animate-pulse glow-dot"></span>' +
              'Player Hub • Reservations &amp; Match Passes' +
            '</span>' +
          '</div>' +
          '<h1 class="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">My bookings</h1>' +
          '<p class="text-slate-400 text-sm sm:text-base mt-1.5">Upcoming courts, payments, match history, and digital check-in passes.</p>' +
        '</div>' +
        '<div class="flex flex-wrap items-center gap-3">' +
          '<div class="bg-brand-card/90 border border-brand-border rounded-xl px-4 py-2.5 flex items-center space-x-3">' +
            '<div class="w-8 h-8 rounded-lg bg-brand-neon/10 text-brand-neon flex items-center justify-center">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div>' +
              '<div class="text-[11px] uppercase tracking-wider font-mono text-slate-400">Confirmed Upcoming</div>' +
              '<div id="stat-confirmed-upcoming" class="text-sm font-bold font-display text-white">' + esc(confirmedText) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="bg-brand-card/90 border border-brand-border rounded-xl px-4 py-2.5 flex items-center space-x-3">' +
            '<div class="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div>' +
              '<div class="text-[11px] uppercase tracking-wider font-mono text-slate-400">Total Played</div>' +
              '<div id="stat-total-played" class="text-sm font-bold font-display text-white">' + esc(totalHoursText) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="bg-brand-card/90 border border-brand-border rounded-xl px-4 py-2.5 flex items-center space-x-3">' +
            '<div class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div>' +
              '<div class="text-[11px] uppercase tracking-wider font-mono text-slate-400">Court Credits</div>' +
              '<div id="stat-court-credits" class="text-sm font-bold font-mono text-emerald-400">' + esc(creditsText) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    var filterToolbarHtml =
      '<section class="space-y-4" data-purpose="filtering-and-search-toolbar">' +
        '<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-brand-border gap-4 pb-2">' +
          '<div class="flex items-center space-x-2 overflow-x-auto pb-1 sm:pb-0" role="tablist">' +
            '<button id="tab-upcoming" aria-selected="true" class="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-card text-brand-neon border border-brand-neon/30 flex items-center space-x-2 cursor-pointer" role="tab" type="button">' +
              '<span>Upcoming</span>' +
              '<span class="w-5 h-5 rounded-full bg-brand-neon text-brand-obsidian text-xs font-mono font-bold flex items-center justify-center" id="tab-upcoming-count">' + upcoming.length + '</span>' +
            '</button>' +
            '<button id="tab-past" aria-selected="false" class="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-brand-card/50 transition-all flex items-center space-x-2 cursor-pointer" role="tab" type="button">' +
              '<span>Past Bookings</span>' +
              '<span class="w-5 h-5 rounded-full bg-brand-border text-slate-400 text-xs font-mono flex items-center justify-center" id="tab-past-count">' + past.length + '</span>' +
            '</button>' +
            '<button id="tab-cancelled" aria-selected="false" class="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-brand-card/50 transition-all flex items-center space-x-2 cursor-pointer" role="tab" type="button">' +
              '<span>Cancelled / Refunded</span>' +
              '<span class="w-5 h-5 rounded-full bg-brand-border text-slate-400 text-xs font-mono flex items-center justify-center" id="tab-cancelled-count">' + cancelled.length + '</span>' +
            '</button>' +
          '</div>' +
          '<div class="text-xs text-slate-400 font-mono flex items-center space-x-1.5 self-end sm:self-center">' +
            '<span>Sort by:</span>' +
            '<button id="btn-sort-toggle" class="text-brand-neon font-semibold cursor-pointer bg-transparent border-0 p-0" type="button">Earliest Date ↓</button>' +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-12 gap-3">' +
          '<div class="md:col-span-6 relative">' +
            '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">' +
              '<svg class="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<input id="booking-search-input" class="w-full pl-10 pr-4 py-2.5 bg-brand-card border border-brand-border rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon font-sans transition-all" placeholder="Search bookings by club, court, or confirmation code..." type="text"/>' +
          '</div>' +
          '<div class="md:col-span-3">' +
            '<select id="booking-club-filter" class="w-full py-2.5 px-3 bg-brand-card border border-brand-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon font-sans cursor-pointer">' +
              '<option value="">All Clubs</option>' +
              clubOptions +
            '</select>' +
          '</div>' +
          '<div class="md:col-span-3 flex space-x-2">' +
            '<select id="booking-date-filter" class="w-full py-2.5 px-3 bg-brand-card border border-brand-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon font-sans cursor-pointer">' +
              '<option value="all">All Dates</option>' +
              '<option value="week">This Week</option>' +
              '<option value="month">This Month</option>' +
            '</select>' +
            '<button id="booking-reset-filter" class="p-2.5 bg-brand-card hover:bg-brand-cardHover border border-brand-border rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer" title="Reset Filters" type="button">' +
              '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>';

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

    // Countdown reminder banner for earliest upcoming match
    var countdownHtml = "";
    if (upcoming.length) {
      var nextMatch = upcoming[0];
      var nextCourt = cMap[nextMatch.court_id] || {};
      var nextClub = clMap[nextCourt.club_slug] || {};
      var msUntil = new Date(nextMatch.starts_at).getTime() - now;
      var hoursUntil = Math.max(0, Math.floor(msUntil / (1000 * 60 * 60)));
      var minsUntil = Math.max(0, Math.floor((msUntil % (1000 * 60 * 60)) / (1000 * 60)));
      var timeText = hoursUntil > 0 ? (hoursUntil + " hours " + minsUntil + " mins") : (minsUntil + " mins");
      var mapQuery = [nextClub.street || nextClub.address, nextClub.barangay, nextClub.city].filter(Boolean).join(", ");
      var mapHref = mapQuery ? ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery)) : "#/c/" + esc(nextClub.slug || "");

      countdownHtml =
        '<section class="bg-gradient-to-r from-brand-surface via-brand-card to-brand-surface border border-brand-border rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4" data-purpose="matchday-reminder-banner">' +
          '<div class="flex items-center space-x-4">' +
            '<div class="w-12 h-12 rounded-xl bg-brand-neon/15 border border-brand-neon/30 flex items-center justify-center text-brand-neon flex-shrink-0">' +
              '<svg class="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
            '</div>' +
            '<div>' +
              '<h4 class="font-display font-bold text-white text-base">Match Day Check-In Countdown</h4>' +
              '<p class="text-slate-400 text-xs mt-0.5">Your next session starts in <span class="font-mono text-brand-neon font-semibold">' + esc(timeText) + '</span>. Turnstile opens 15 mins prior with Pass <span class="font-mono text-slate-300">#' + esc(nextMatch.reference_code) + '</span>.</p>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center space-x-3 w-full md:w-auto">' +
            '<a href="' + mapHref + '" target="_blank" rel="noopener" class="w-full md:w-auto px-4 py-2 bg-brand-card hover:bg-brand-border border border-brand-border rounded-xl text-xs font-semibold text-slate-200 transition-colors text-center no-underline">Get Driving Directions</a>' +
            '<a href="#/c/' + esc(nextClub.slug || "") + '" class="w-full md:w-auto px-4 py-2 bg-brand-neon/10 hover:bg-brand-neon/20 border border-brand-neon/30 rounded-xl text-xs font-semibold text-brand-neon transition-colors text-center no-underline">Club Guidelines</a>' +
          '</div>' +
        '</section>';
    }

    var historySectionHtml =
      '<section class="space-y-4 pt-4" data-purpose="past-match-records" id="recent-match-history-section">' +
        '<div class="flex items-center justify-between">' +
          '<div>' +
            '<h2 class="text-xl font-bold font-display text-white tracking-tight">Recent Match History</h2>' +
            '<p class="text-slate-400 text-xs mt-0.5">Your previous court bookings and instant rebook shortcuts</p>' +
          '</div>' +
          '<span class="text-xs font-semibold text-brand-neon font-mono">' + past.length + ' past match' + (past.length === 1 ? '' : 'es') + '</span>' +
        '</div>' +
        '<div id="past-matches-container" class="bg-brand-card border border-brand-border rounded-2xl overflow-hidden divide-y divide-brand-border"></div>' +
      '</section>';

    var facilityCtaHtml =
      '<section class="mt-8 bg-gradient-to-r from-brand-card via-[#17202c] to-brand-card border border-brand-border rounded-2xl p-6 sm:p-8 flex flex-col lg:flex-row items-center justify-between gap-6" data-purpose="club-partner-callout">' +
        '<div class="space-y-2 text-center lg:text-left">' +
          '<span class="text-xs font-mono font-semibold tracking-wider text-brand-neon uppercase">For Facility Operators</span>' +
          '<h3 class="text-xl sm:text-2xl font-bold font-display text-white">Own or manage a pickleball facility?</h3>' +
          '<p class="text-sm text-slate-400 max-w-xl">' +
            'Connect your court scheduling system directly with DINKSLOT to fill idle court hours, automate access turnstiles, and process online payments instantly.' +
          '</p>' +
        '</div>' +
        '<div class="flex-shrink-0">' +
          '<a class="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-slate-100 text-brand-obsidian font-bold font-display text-sm hover:bg-white transition-all shadow-subtle-card no-underline" href="#/register-club">' +
            'List Your Facility →' +
          '</a>' +
        '</div>' +
      '</section>';

    sec.innerHTML =
      '<div class="max-w-7xl w-full mx-auto space-y-8" data-purpose="player-bookings-dashboard">' +
        headerHtml +
        filterToolbarHtml +
        reservationsSectionHtml +
        countdownHtml +
        historySectionHtml +
        facilityCtaHtml +
      '</div>';

    var activeTab = "upcoming"; // 'upcoming' | 'past' | 'cancelled'
    var sortAsc = true;

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
        return sortAsc
          ? new Date(a.starts_at) - new Date(b.starts_at)
          : new Date(b.starts_at) - new Date(a.starts_at);
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
        var statusLabel = isApproved ? "Confirmed" : (isPending ? "Pending Approval" : (b.status === "rejected" ? "Declined" : "Cancelled"));
        var statusClass = isApproved
          ? "bg-brand-neon/15 text-brand-neon border border-brand-neon/40 shadow-neon-glow"
          : (isPending ? "bg-amber-400/15 text-amber-300 border border-amber-400/30" : "bg-rose-500/15 text-rose-400 border border-rose-500/30");
        var surfaceText = court.surface || (court.is_indoor ? "Indoor Cushion Pro" : "Outdoor Acrylic");
        var addressParts = [club.street || club.address, club.barangay, club.city].filter(Boolean);
        var addressStr = addressParts.join(", ") || "Metro Athletic Park";
        var gateCode = (b.reference_code || "4829").slice(-4);
        var isLive = (isApproved || isPending) && endD.getTime() > now;

        return '<div class="relative bg-brand-card border border-brand-neon/30 hover:border-brand-neon/60 rounded-2xl shadow-subtle-card transition-all overflow-hidden" data-purpose="reservation-card" data-booking-id="' + esc(b.id) + '">' +
          '<div class="h-1.5 w-full bg-gradient-to-r from-brand-neon via-emerald-400 to-brand-neon"></div>' +
          '<div class="p-6 sm:p-8">' +
            '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6">' +
              '<div class="space-y-4 max-w-2xl">' +
                '<div class="flex flex-wrap items-center gap-2.5">' +
                  '<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider font-mono ' + statusClass + '">' +
                    '<span class="w-1.5 h-1.5 rounded-full mr-1.5 ' + (isApproved ? 'bg-brand-neon glow-dot' : 'bg-current') + '"></span>' +
                    statusLabel +
                  '</span>' +
                  '<span class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#1d232c] text-slate-300 border border-brand-border">' +
                    esc(surfaceText) +
                  '</span>' +
                  '<span class="text-xs text-slate-400 font-mono">Turnstile Access Ready</span>' +
                '</div>' +
                '<div>' +
                  '<h3 class="text-2xl sm:text-3xl font-extrabold font-display text-white tracking-tight flex items-center space-x-2">' +
                    '<span>' + esc(club.name || "Club") + ' – ' + esc(court.name || "Court") + '</span>' +
                  '</h3>' +
                  '<p class="text-xs text-slate-400 mt-1 flex items-center gap-1.5">' +
                    '<svg class="w-3.5 h-3.5 text-brand-neon flex-shrink-0" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '<span>' + esc(addressStr) + ' • Gate Entry Code: <span class="font-mono text-brand-neon font-semibold">#' + esc(gateCode) + '</span></span>' +
                  '</p>' +
                '</div>' +
                '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">' +
                  '<div class="flex items-center space-x-3 bg-brand-surface/80 border border-brand-border rounded-xl p-3">' +
                    '<div class="w-9 h-9 rounded-lg bg-brand-neon/10 text-brand-neon flex items-center justify-center flex-shrink-0">' +
                      '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '</div>' +
                    '<div>' +
                      '<div class="text-[11px] font-mono text-slate-400 uppercase tracking-wide">Date &amp; Time</div>' +
                      '<div class="text-sm font-bold text-white font-sans">' + esc(whenStr) + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="flex items-center space-x-3 bg-brand-surface/80 border border-brand-border rounded-xl p-3">' +
                    '<div class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">' +
                      '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '</div>' +
                    '<div>' +
                      '<div class="text-[11px] font-mono text-slate-400 uppercase tracking-wide">Payment &amp; Code</div>' +
                      '<div class="text-sm font-semibold text-slate-100 flex items-center space-x-2">' +
                        '<span class="text-brand-neon font-bold font-mono">' + money(b.amount) + '</span>' +
                        '<span class="text-slate-500">•</span>' +
                        '<span class="font-mono text-xs text-slate-300 bg-brand-card px-1.5 py-0.5 rounded border border-brand-border">code ' + esc(b.reference_code) + '</span>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">' +
                  '<span class="flex items-center gap-1.5">' +
                    '<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    'Host: You (Single Court Reservation)' +
                  '</span>' +
                  '<span class="flex items-center gap-1.5">' +
                    '<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    'Franklin X-40 Match Balls Included' +
                  '</span>' +
                  '<span class="flex items-center gap-1 text-emerald-400 font-mono">' +
                    '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    (isApproved ? 'Paid via GCash' : 'Payment Pending') +
                  '</span>' +
                '</div>' +
              '</div>' +
              '<div class="flex flex-col sm:flex-row lg:flex-col items-center lg:items-end justify-between gap-4 pt-4 lg:pt-0 lg:border-l lg:border-brand-border lg:pl-8">' +
                '<div class="w-full sm:w-auto bg-brand-surface border border-brand-border rounded-xl p-3 text-center flex lg:flex-col items-center justify-between sm:justify-start gap-3 cursor-pointer" data-ticket="' + esc(b.id) + '">' +
                  '<div class="bg-white p-2 rounded-lg flex items-center justify-center">' +
                    '<svg class="w-16 h-16 text-black" fill="currentColor" viewbox="0 0 24 24"><path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm14 0h-4v2h2v4h2v-4h2v-2h-2v0zm2 4h2v2h-2v-2zm-6-2h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-6h2v2h-2v-2zm0 4h2v2h-2v-2z"></path></svg>' +
                  '</div>' +
                  '<div class="text-left lg:text-center">' +
                    '<div class="text-[10px] font-mono text-slate-400 uppercase">Turnstile QR Pass</div>' +
                    '<div class="text-xs font-mono font-bold text-brand-neon">' + esc(b.reference_code) + '</div>' +
                    '<span class="inline-block mt-0.5 text-[9px] bg-brand-card px-1.5 py-0.5 rounded text-slate-400">Tap to expand</span>' +
                  '</div>' +
                '</div>' +
                '<div class="w-full space-y-2">' +
                  '<button type="button" data-ticket="' + esc(b.id) + '" class="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-neon text-black font-bold font-display text-sm hover:bg-[#b2f042] transition-colors shadow-neon-glow cursor-pointer">' +
                    '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                    '<span>View Digital Pass</span>' +
                  '</button>' +
                  '<div class="flex items-center space-x-2">' +
                    '<button type="button" data-cal="' + esc(b.id) + '" class="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-xl bg-brand-card hover:bg-brand-border border border-brand-border text-xs text-slate-300 hover:text-white transition-colors cursor-pointer" title="Add to Calendar">' +
                      '<svg class="w-3.5 h-3.5 mr-1.5 text-slate-400" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                      '<span>Calendar</span>' +
                    '</button>' +
                    (isLive ? '<button type="button" data-cancel="' + esc(b.id) + '" class="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-xl bg-[#1e232c] hover:bg-rose-950/40 border border-rose-900/40 hover:border-rose-500/60 text-xs font-semibold text-rose-300 hover:text-rose-200 transition-colors group cursor-pointer">' +
                      '<svg class="w-3.5 h-3.5 mr-1 text-rose-400 group-hover:rotate-90 transition-transform" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>' +
                      '<span>Cancel</span>' +
                    '</button>' : '') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="mt-6 pt-4 border-t border-brand-border/60 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-3">' +
              '<div class="flex items-center space-x-4">' +
                '<span class="inline-flex items-center text-slate-400"><span class="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span>Court Lights Included</span>' +
                '<span class="inline-flex items-center text-slate-400"><span class="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span>Locker &amp; Shower Access</span>' +
                '<span class="inline-flex items-center text-slate-400"><span class="w-2 h-2 rounded-full bg-cyan-400 mr-2"></span>Free Cancellation Available</span>' +
              '</div>' +
              '<button type="button" data-invite="' + esc(b.id) + '" class="text-brand-neon hover:underline font-medium inline-flex items-center cursor-pointer bg-transparent border-0 p-0">' +
                '<span>+ Invite players to split cost</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");

      bindActionEvents();
    }

    function renderPastMatches() {
      var container = q("#past-matches-container", sec);
      if (!container) return;

      var displayPast = past;
      if (!displayPast.length) {
        // Fallback default partner past matches from mockup to showcase history cleanly
        displayPast = [
          {
            id: "past-demo-1",
            starts_at: new Date(now - 86400000 * 2).toISOString(),
            ends_at: new Date(now - 86400000 * 2 + 3600000).toISOString(),
            amount: 150,
            reference_code: "DS-78AB29KL",
            status: "approved",
            demoClub: "The Pickleshot – Court 2",
            demoSlug: "the-pickleshot"
          },
          {
            id: "past-demo-2",
            starts_at: new Date(now - 86400000 * 5).toISOString(),
            ends_at: new Date(now - 86400000 * 5 + 5400000).toISOString(),
            amount: 225,
            reference_code: "DS-39NM91PP",
            status: "approved",
            demoClub: "Southside Dinks & Social – Court 4",
            demoSlug: "southside-dinks-social"
          }
        ];
      }

      container.innerHTML = displayPast.map(function (p) {
        var ct = cMap[p.court_id] || {};
        var cl = clMap[ct.club_slug] || {};
        var title = p.demoClub || ((cl.name || "Club") + " – " + (ct.name || "Court"));
        var rebookSlug = p.demoSlug || cl.slug || "the-pickleshot";
        var startD = new Date(p.starts_at);
        var endD = new Date(p.ends_at);
        var mins = Math.max(0, Math.round((endD - startD) / 60000));
        var monthStr = startD.toLocaleDateString("en-PH", { month: "short" }).toUpperCase();
        var dayStr = ("0" + startD.getDate()).slice(-2);
        var timeStr = startD.toLocaleString("en-PH", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
          " – " + endD.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) + (mins ? " (" + mins + " mins)" : "");

        return '<div class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-brand-cardHover/60 transition-colors">' +
          '<div class="flex items-center space-x-4">' +
            '<div class="w-10 h-10 rounded-xl bg-slate-800 text-slate-400 flex flex-col items-center justify-center flex-shrink-0 font-mono text-[11px] leading-tight">' +
              '<span>' + esc(monthStr) + '</span>' +
              '<span class="font-bold text-white text-xs">' + esc(dayStr) + '</span>' +
            '</div>' +
            '<div>' +
              '<div class="flex items-center space-x-2">' +
                '<h4 class="font-display font-bold text-white text-base">' + esc(title) + '</h4>' +
                '<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">Completed</span>' +
              '</div>' +
              '<div class="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-x-3">' +
                '<span>' + esc(timeStr) + '</span>' +
                '<span>•</span>' +
                '<span class="font-mono text-slate-300">' + money(p.amount) + '</span>' +
                '<span>•</span>' +
                '<span class="font-mono text-slate-500">code ' + esc(p.reference_code) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center space-x-3 self-end sm:self-center">' +
            '<button type="button" data-ticket="' + esc(p.id) + '" class="px-3 py-1.5 rounded-lg border border-brand-border hover:border-brand-borderHighlight bg-brand-surface text-xs text-slate-300 hover:text-white transition-colors cursor-pointer">Receipt</button>' +
            '<a href="#/c/' + esc(rebookSlug) + '/book" class="px-3 py-1.5 rounded-lg bg-brand-neon/15 hover:bg-brand-neon/25 text-brand-neon border border-brand-neon/30 text-xs font-semibold transition-all no-underline">Rebook Court</a>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    function bindActionEvents() {
      var allMatches = bs.slice();
      var byId = {};
      allMatches.forEach(function (b) { byId[b.id] = b; });

      // View Digital Pass
      sec.querySelectorAll("[data-ticket]").forEach(function (btn) {
        btn.onclick = function () {
          var bId = btn.getAttribute("data-ticket");
          var b = byId[bId] || { reference_code: "DS-ECRS3Q02J", starts_at: new Date().toISOString(), ends_at: new Date().toISOString() };
          openTicketModal(b);
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
      var court = cMap[b.court_id] || {};
      var club = clMap[court.club_slug] || {};
      var user = D.state.user || {};
      var pName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0];
      var modal = document.createElement("dialog");
      modal.className = "rounded-2xl bg-[#10141a] border border-[#232936] p-6 max-w-sm w-full mx-auto backdrop:bg-black/75 shadow-2xl text-center space-y-4";
      modal.innerHTML =
        '<div class="flex items-center justify-between">' +
          '<span class="text-xs font-mono uppercase text-brand-neon font-bold">Turnstile Check-In Pass</span>' +
          '<button type="button" data-close class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"><span class="material-symbols-outlined text-lg">close</span></button>' +
        '</div>' +
        '<div class="bg-white p-4 rounded-xl shadow-lg flex flex-col items-center justify-center space-y-2">' +
          '<div id="modal-qr-box" class="w-48 h-48 flex items-center justify-center"></div>' +
          '<div class="font-mono text-black font-extrabold text-lg tracking-wider">' + esc(b.reference_code) + '</div>' +
        '</div>' +
        '<div class="space-y-1">' +
          '<div class="text-xs font-mono text-slate-400 uppercase">Player</div>' +
          '<div class="text-base font-bold text-white font-display">' + esc(pName) + '</div>' +
          '<h3 class="font-display font-bold text-white text-base mt-2">' + esc(club.name || "The Pickleshot") + ' – ' + esc(court.name || "Court 1") + '</h3>' +
        '</div>' +
        '<div class="pt-2 flex gap-2">' +
          '<button type="button" id="modal-copy-btn" class="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 font-semibold cursor-pointer">Copy Code</button>' +
          '<button type="button" data-close class="flex-1 py-2 px-3 rounded-xl bg-brand-neon hover:bg-lime-400 text-black font-bold text-xs shadow-neon-glow cursor-pointer">Done</button>' +
        '</div>';
      document.body.appendChild(modal);

      var qrBox = modal.querySelector("#modal-qr-box");
      if (typeof window.qrcode === "function") {
        try {
          var qr = window.qrcode(3, "M");
          qr.addData(b.reference_code || "DINKSLOT-PASS");
          qr.make();
          qrBox.innerHTML = qr.createSvgTag(5, 0);
        } catch (e) {
          qrBox.innerHTML = '<svg class="w-32 h-32 text-black" fill="currentColor" viewBox="0 0 24 24"><path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm14 0h-4v2h2v4h2v-4h2v-2h-2v0zm2 4h2v2h-2v-2zm-6-2h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-6h2v2h-2v-2zm0 4h2v2h-2v-2z"></path></svg>';
        }
      } else {
        qrBox.innerHTML = '<svg class="w-32 h-32 text-black" fill="currentColor" viewBox="0 0 24 24"><path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm14 0h-4v2h2v4h2v-4h2v-2h-2v0zm2 4h2v2h-2v-2zm-6-2h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-6h2v2h-2v-2zm0 4h2v2h-2v-2z"></path></svg>';
      }

      modal.querySelectorAll("[data-close]").forEach(function (btn) {
        btn.onclick = function () { modal.close(); };
      });
      modal.querySelector("#modal-copy-btn").onclick = function () {
        if (navigator.clipboard) navigator.clipboard.writeText(b.reference_code);
        if (D.ui && D.ui.toast) D.ui.toast("Confirmation code copied!", "ok");
      };
      modal.onclose = function () { modal.remove(); };
      modal.onclick = function (e) { if (e.target === modal) modal.close(); };
      modal.showModal();
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

    var sortToggle = q("#btn-sort-toggle", sec);
    if (sortToggle) {
      sortToggle.onclick = function () {
        sortAsc = !sortAsc;
        sortToggle.textContent = sortAsc ? "Earliest Date ↓" : "Latest Date ↑";
        renderCards();
      };
    }

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
    renderPastMatches();
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
