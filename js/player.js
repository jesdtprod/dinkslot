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
      '<div class="club-directory-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="club-search-input" type="search" aria-label="Search clubs" placeholder="Search clubs, addresses, or ZIP codes" autocomplete="off"><button id="btn-clear-search" type="button"><span class="material-symbols-outlined" aria-hidden="true">close</span>Clear</button></div>' +
      '<div class="club-directory-filters"><label>City / Municipality<select id="club-filter-city">' + filterOptions(all.map(function (c) { return c.city; }), 'All locations') + '</select></label>' +
      '<label>Court Type<select id="club-filter-type"><option value="">All court types</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></label>' +
      '<label>Surface<select id="club-filter-surface">' + filterOptions(allCourts.map(function (c) { return c.surface; }), 'All surfaces') + '</select></label>' +
      '<label class="club-directory-open"><input id="filter-open-now" type="checkbox"><span>Open Now</span></label>' +
      '<div class="club-directory-results"><span><strong id="nearby-count-badge">' + all.length + '</strong> clubs found</span><div class="club-directory-view" role="group" aria-label="View format"><button id="btn-view-grid" type="button" aria-label="Grid view" aria-pressed="true"><span class="material-symbols-outlined" aria-hidden="true">grid_view</span></button><button id="btn-view-list" type="button" aria-label="List view" aria-pressed="false"><span class="material-symbols-outlined" aria-hidden="true">view_list</span></button></div></div></div></section>';

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
        return '<article class="home-club-card"><a class="home-club-cover" href="#/c/' + esc(club.slug) + '" aria-label="View ' + esc(club.name) + '">' +
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
              '<option value="name">Club Name</option>' +
              '<option value="courts">Most Courts</option>' +
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
      '<div class="member-find-page" data-purpose="player-find-club">' +
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
      var clearSearch = q('#btn-clear-search', sec);
      if (clearSearch) clearSearch.disabled = !searchInput || !searchInput.value;

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
