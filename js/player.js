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
    sec.insertAdjacentHTML('afterbegin', '<header class="member-page-heading"><div><h1>' + esc(SECTIONS[section][0]) + '</h1><p>' + esc(SECTIONS[section][1]) + '</p></div>' + (section === 'overview' || section === 'bookings' || section === 'clubs' ? '<a class="btn" href="#/me/find"><span class="material-symbols-outlined" aria-hidden="true">search</span>Find a Club</a>' : '') + '</header>');
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
    var up = 0, pending = 0, next = null, courtName = "", clubName = "", tz = "Asia/Manila";
    if (pids.length) {
      var bs = (await sb.from("bookings").select("*").in("player_id", pids).in("status", ["pending", "approved"])
        .gte("ends_at", new Date().toISOString()).order("starts_at")).data || [];
      up = bs.filter(function (b) { return b.status === "approved"; }).length;
      pending = bs.filter(function (b) { return b.status === "pending"; }).length;
      next = bs.filter(function (b) { return b.status === "approved"; })[0] || bs[0] || null;
      if (next) {
        var c = (await sb.from("public_courts").select("name,club_slug").eq("id", next.court_id).maybeSingle()).data;
        courtName = c ? c.name : "Court";
        var cl = c ? mc.clubs.filter(function (x) { return x.slug === c.club_slug; })[0] : null;
        clubName = cl ? cl.name : "";
        if (c) { var t = (await sb.from("public_clubs").select("timezone").eq("slug", c.club_slug).maybeSingle()).data; if (t && t.timezone) tz = t.timezone; }
      }
    }
    var tile = function (n, label, icon, href, tone) {
      return '<a class="metric-card" href="' + href + '"><div class="metric-heading"><span class="metric-icon material-symbols-outlined" aria-hidden="true">' + icon + '</span><span class="metric-badge">Your account</span></div><h2 class="metric-label">' + esc(label) + '</h2><div class="metric-reading"><strong>' + n + '</strong></div><div class="metric-footer"><span>View details</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></div></a>';
    };
    var when = next ? new Date(next.starts_at).toLocaleString("en-PH", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    sec.innerHTML = '<div class="member-metrics">' + tile(up, "Confirmed upcoming", "event_available", "#/me/bookings") +
      tile(pending, "Waiting for payment or approval", "pending_actions", "#/me/bookings", pending ? "warn" : "") +
      tile(mc.clubs.length, "Clubs joined", "groups", "#/me/clubs") + "</div>" +
      '<div class="panel wide"><h2>Next booking</h2>' + (next
        ? '<p><b>' + esc(clubName) + "</b> - " + esc(courtName) + '<br><span class="muted">' + esc(when) + "</span></p>" +
          '<p><span class="badge ' + esc(next.status) + '">' + esc(next.status) + "</span> <span class=\"muted small\">" + money(next.amount) + " - code " + esc(next.reference_code) + '</span></p><a class="btn sm" href="#/me/bookings">Manage bookings</a>'
        : D.ui.emptyState('No upcoming bookings', 'Find a club and reserve your next court.', 'event_available', { href: '#/me/find', label: 'Find a club' })) + "</div>" +
      (mc.clubs.length ? "" : '<div class="panel wide"><h2>Get started</h2><p class="muted">Join a club, pick a court and a time, then pay by QR. It takes a minute.</p>' +
        '<a class="btn" href="#/me/find">Find a club</a></div>');
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

    sec.innerHTML = '<section class="panel wide member-profile-summary"><div class="member-id"><span class="member-avatar" id="member-avatar"></span><div class="member-facts"><h2>Personal details</h2><p id="member-display-name"></p><p>' + esc(D.state.user.email) + '</p><dl id="member-facts"></dl></div></div><button type="button" class="btn ghost" id="edit-member-profile">Edit Profile</button></section>' +
      '<dialog class="member-profile-modal" aria-labelledby="member-profile-title"><form id="myprofile"><header><div><span>Account settings</span><h2 id="member-profile-title">Edit Profile</h2></div><button type="button" class="member-profile-close" aria-label="Close profile editor"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header>' +
      '<div class="member-photo"><span class="member-avatar big" id="mp-preview"></span><div class="member-photo-actions"><label class="btn ghost member-photo-btn" for="mp-photo">Add photo</label><input type="file" id="mp-photo" accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="btn ghost" id="mp-remove-photo" hidden>Remove photo</button><small>JPG, PNG or WebP, up to 2 MB.</small></div></div>' +
      '<div class="grid2">' +
      '<label>Full Name<input id="mp-name" maxlength="80" autocomplete="name"></label><label>Phone<input id="mp-phone" maxlength="30" autocomplete="tel"></label>' +
      '<label>Birthdate<input id="mp-birth" type="date" min="1900-01-01" autocomplete="bday"></label>' +
      '<label>Civil status<select id="mp-civil"><option value="">Select</option>' + Object.keys(CIVIL).map(function (k) { return '<option value="' + k + '">' + CIVIL[k] + '</option>'; }).join("") + '</select></label></div>' +
      '<div id="mp-address" class="member-address"></div>' +
      '<p class="msg" role="alert"></p><footer><button type="button" id="cancel-member-profile" class="btn ghost">Cancel</button><button class="btn" type="submit">Save Profile</button></footer></form></dialog>';

    var modal = q('.member-profile-modal', sec), opener = q('#edit-member-profile', sec);
    var ph = D.ph.mount(q("#mp-address", sec), { values: p, manager: false, required: false });

    function initial() { return ((p.full_name || D.state.user.email || "?").charAt(0) || "?").toUpperCase(); }
    function paintAvatar(el, url) { el.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : esc(initial()); }
    function paintSummary() {
      q("#member-display-name", sec).textContent = p.full_name || "Your profile";
      paintAvatar(q("#member-avatar", sec), avatarUrl(p.avatar_path));
      var rows = [["Phone", p.phone], ["Birthdate", niceDate(p.birth_date)], ["Civil status", CIVIL[p.civil_status]],
        ["Address", [p.street, p.barangay && "Brgy. " + p.barangay, p.city, p.province, p.zip_code].filter(Boolean).join(", ")]]
        .filter(function (x) { return x[1]; });
      q("#member-facts", sec).innerHTML = rows.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("");
    }
    function fill() {
      q("#mp-name", sec).value = p.full_name || ""; q("#mp-phone", sec).value = p.phone || "";
      q("#mp-birth", sec).value = p.birth_date || ""; q("#mp-civil", sec).value = p.civil_status || "";
      chosen = null; removeFlag = false; q("#mp-photo", sec).value = "";
      paintAvatar(q("#mp-preview", sec), avatarUrl(p.avatar_path));
      q("#mp-remove-photo", sec).hidden = !p.avatar_path;
    }
    paintSummary(); fill();

    opener.onclick = function () { fill(); setMsg(q("#myprofile", sec), "", ""); modal.showModal(); };
    q('.member-profile-close', sec).onclick = function () { modal.close(); };
    q('#cancel-member-profile', sec).onclick = function () { modal.close(); };
    modal.addEventListener('close', function () { opener.focus(); });

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
        paintSummary(); modal.close();
      } catch (err) { setMsg(f, friendly(err), "err"); }
      btn.disabled = false;
    };
  }

  D.player = { render: render };
})();
