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
    sec.insertAdjacentHTML('afterbegin', '<header class="member-page-heading"><div><h1>' + esc(SECTIONS[section][0]) + '</h1><p>' + esc(SECTIONS[section][1]) + '</p></div>' + (section === 'bookings' || section === 'clubs' ? '<a class="btn" href="#/me/find"><span class="material-symbols-outlined" aria-hidden="true">search</span>Find a Club</a>' : '') + '</header>');
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
    if (pids.length) {
      var bs = (await sb.from("bookings").select("*").in("player_id", pids).in("status", ["pending", "approved"])
        .gte("ends_at", new Date().toISOString()).order("starts_at")).data || [];
      up = bs.filter(function (b) { return b.status === "approved"; }).length;
      pending = bs.filter(function (b) { return b.status === "pending"; }).length;
      next = bs.filter(function (b) { return b.status === "approved"; })[0] || bs[0] || null;
      var cnt = await sb.from("bookings").select("id", { count: "exact", head: true }).in("player_id", pids);
      total = cnt.count || 0;
      if (next) {
        var c = (await sb.from("public_courts").select("name,club_slug").eq("id", next.court_id).maybeSingle()).data;
        courtName = c ? c.name : "Court";
        clubSlug = c ? c.club_slug : "";
        var cl = c ? mc.clubs.filter(function (x) { return x.slug === c.club_slug; })[0] : null;
        clubName = cl ? cl.name : "";
        if (c) { var t = (await sb.from("public_clubs").select("timezone").eq("slug", c.club_slug).maybeSingle()).data; if (t && t.timezone) tz = t.timezone; }
      }
    }
    var user = D.state.user;
    var who = ((user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0]).split(" ")[0];
    var GLOW = "shadow-[0_0_18px_rgba(163,230,53,0.3)] hover:shadow-[0_0_26px_rgba(163,230,53,0.45)]";
    var tile = function (n, label, icon, note, href, linkLabel) {
      return '<a href="' + href + '" class="group relative flex flex-col justify-between rounded-2xl bg-[#121822] border border-[#202c3d] p-5 shadow-lg transition-all duration-200 hover:border-[#a3e635]/45 hover:shadow-[0_0_25px_-4px_rgba(163,230,53,0.15)]">' +
        '<div class="flex items-center justify-between"><div class="w-10 h-10 rounded-xl bg-[#a3e635]/10 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]"><span class="material-symbols-outlined text-xl" aria-hidden="true">' + icon + '</span></div>' +
        '<span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#192330] text-gray-400 border border-[#28374a]">Your account</span></div>' +
        '<div class="mt-5 mb-6"><p class="text-xs uppercase tracking-wider font-mono text-gray-400">' + esc(label) + '</p>' +
        '<div class="flex items-baseline gap-2 mt-2"><span class="text-4xl font-extrabold text-white tracking-tight">' + n + '</span></div>' +
        '<p class="text-xs text-gray-400 mt-2 truncate">' + esc(note) + '</p></div>' +
        '<span class="pt-3 border-t border-[#1d2737] text-xs font-semibold text-gray-400 group-hover:text-[#a3e635] flex items-center justify-between transition-colors"><span>' + esc(linkLabel) + '</span><span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span></span></a>';
    };
    var when = next ? new Date(next.starts_at).toLocaleString("en-PH", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    var until = next ? new Date(next.ends_at).toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "";
    var mins = next ? Math.round((new Date(next.ends_at) - new Date(next.starts_at)) / 60000) : 0;

    var hero = '<section class="relative overflow-hidden rounded-2xl bg-[#111722] border border-[#1f2b3b] p-6 sm:p-8 shadow-2xl">' +
      '<div class="absolute -right-20 -top-24 w-96 h-96 bg-[#a3e635]/10 rounded-full blur-3xl pointer-events-none"></div>' +
      '<div class="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">' +
        '<div class="space-y-2"><div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#182230] border border-[#293a50] text-[#a3e635] text-xs font-mono uppercase tracking-widest"><span class="w-2 h-2 rounded-full bg-[#a3e635] animate-pulse"></span>Player console</div>' +
        '<h2 class="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">Welcome back, ' + esc(who) + '</h2>' +
        '<p class="text-gray-400 text-sm sm:text-base">Your bookings and clubs at a glance.</p></div>' +
        '<div class="flex flex-wrap items-center gap-3">' +
          '<a href="#/me/find" class="inline-flex items-center gap-2 bg-[#a3e635] hover:bg-[#bef264] text-black font-bold text-sm px-5 py-2.5 rounded-xl transition-all ' + GLOW + '"><span class="material-symbols-outlined text-base" aria-hidden="true">search</span>Find a Club</a>' +
          '<a href="#/me/bookings" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2b3a4e] bg-[#16202d] hover:bg-[#1d2a3c] text-white text-sm font-semibold transition-all"><span class="material-symbols-outlined text-base text-[#a3e635]" aria-hidden="true">event_available</span>My Bookings</a>' +
        '</div></div></section>';

    var metrics = '<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">' +
      tile(up, "Confirmed upcoming", "event_available", up ? "Ready to play" : "Nothing confirmed yet", "#/me/bookings", "View bookings") +
      tile(pending, "Waiting for payment or approval", "hourglass_top", pending ? "Needs your attention" : "No pending actions", "#/me/bookings", "View details") +
      tile(mc.clubs.length, "Clubs joined", "groups", mc.clubs.length ? mc.clubs.map(function (x) { return x.name; }).join(", ") : "Join a club to start booking", "#/me/clubs", "My clubs") +
      tile(total, "Total bookings", "history", "All time", "#/me/bookings", "Booking history") + '</section>';

    var nextCard = '<section class="space-y-4"><h2 class="text-2xl font-bold text-white">Next booking</h2>' + (next
      ? '<div class="relative overflow-hidden rounded-2xl bg-[#121924] border border-[#202c3d] p-6 sm:p-7 shadow-xl"><div class="absolute left-0 top-0 bottom-0 w-2 bg-[#a3e635] shadow-[0_0_15px_#a3e635]"></div>' +
        '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pl-2"><div class="space-y-3">' +
          '<div class="flex flex-wrap items-center gap-2 sm:gap-3"><span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ' + (next.status === "approved" ? "bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/40" : "bg-amber-400/10 text-amber-300 border border-amber-300/30") + '"><span class="w-2 h-2 rounded-full ' + (next.status === "approved" ? "bg-[#a3e635]" : "bg-amber-300") + '"></span>' + (next.status === "approved" ? "Confirmed" : "Awaiting approval") + '</span>' +
          '<span class="text-xs font-mono text-gray-400">Ref: <strong class="text-white">' + esc(next.reference_code) + '</strong></span></div>' +
          '<h3 class="text-xl sm:text-2xl font-bold text-white">' + esc(clubName) + ' &bull; ' + esc(courtName) + '</h3>' +
          '<p class="text-sm text-gray-400 flex flex-wrap items-center gap-y-1 gap-x-3"><span class="flex items-center gap-1 text-white font-medium"><span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">calendar_today</span>' + esc(when) + ' &ndash; ' + esc(until) + '</span>' +
          '<span class="text-gray-600">&bull;</span><span class="text-[#a3e635]">' + mins + ' mins</span><span class="text-gray-600">&bull;</span><span>' + money(next.amount) + '</span></p>' +
        '</div><div class="flex flex-col sm:flex-row lg:flex-col gap-2.5 flex-shrink-0">' +
          '<a href="#/me/bookings" class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-bold text-sm transition-all ' + GLOW + '"><span class="material-symbols-outlined text-lg" aria-hidden="true">' + (next.status === "approved" ? "qr_code_2" : "payments") + '</span>' + (next.status === "approved" ? "View Pass / QR Ticket" : "Pay or upload proof") + '</a>' +
          (clubSlug ? '<a href="#/c/' + esc(clubSlug) + '" class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#192331] hover:bg-[#223043] text-gray-200 border border-[#2c3d52] text-xs font-semibold transition-colors">View club</a>' : "") +
        '</div></div></div>'
      : D.ui.emptyState('No upcoming bookings', 'Find a club and reserve your next court.', 'event_available', { href: '#/me/find', label: 'Find a club' })) + '</section>';

    var clubs = mc.clubs.length ? '<section class="space-y-4"><div class="flex items-center gap-3"><h2 class="text-2xl font-bold text-white">My Clubs</h2><span class="px-2.5 py-0.5 rounded-full bg-[#172230] text-[#a3e635] font-mono text-xs border border-[#2a3c53]">' + mc.clubs.length + ' joined</span></div>' +
      mc.clubs.slice(0, 3).map(function (cb) {
        var logo = cb.logo_path ? '<img src="' + esc(D.mediaUrl(cb.logo_path)) + '" alt="" class="w-full h-full object-cover">' : '<span class="text-[#a3e635] text-3xl font-black">' + esc(cb.name.charAt(0).toUpperCase()) + '</span>';
        return '<div class="relative overflow-hidden rounded-2xl bg-[#121924] border border-[#202c3d] p-5 sm:p-6 shadow-xl"><div class="absolute left-0 top-0 bottom-0 w-2 bg-[#a3e635] shadow-[0_0_15px_#a3e635]"></div>' +
          '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pl-2"><div class="flex items-center gap-4">' +
            '<div class="w-16 h-16 rounded-2xl bg-[#182332] border border-[#29394d] flex-shrink-0 flex items-center justify-center overflow-hidden">' + logo + '</div>' +
            '<div class="space-y-1"><div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-bold text-white">' + esc(cb.name) + '</h3><span class="px-3 py-1 rounded-full bg-[#a3e635] text-black font-mono text-xs font-bold uppercase tracking-wider">Joined</span></div>' +
            '<p class="flex items-center gap-1 text-gray-400 text-sm"><span class="material-symbols-outlined text-sm text-[#a3e635]" aria-hidden="true">location_on</span>' + esc(cb.city || "Location not provided") + '</p></div></div>' +
          '<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"><a href="#/c/' + esc(cb.slug) + '" class="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1b2533] hover:bg-[#253245] text-white text-sm font-semibold border border-[#2c3d52] transition-all">View Club Details</a>' +
          '<a href="#/c/' + esc(cb.slug) + '/book" class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black text-sm font-bold transition-all ' + GLOW + '"><span class="material-symbols-outlined text-lg" aria-hidden="true">calendar_month</span>Book a court</a></div></div></div>';
      }).join("") + '</section>'
      : '<section class="rounded-2xl bg-gradient-to-r from-[#111722] via-[#141d2a] to-[#182332] border border-[#212f42] p-7 flex flex-col md:flex-row items-center justify-between gap-5"><div><h3 class="font-bold text-lg text-white">Get started</h3><p class="text-sm text-gray-400 mt-1">Join a club, pick a court and a time, then pay by QR. It takes a minute.</p></div><a href="#/me/find" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black text-sm font-bold ' + GLOW + '">Find a club</a></section>';

    sec.innerHTML = '<div class="space-y-8">' + hero + metrics + nextCard + clubs + '</div>';
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
