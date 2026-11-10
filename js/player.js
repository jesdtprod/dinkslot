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
    var root = D.root();
    if (!SECTIONS[section]) section = "overview";
    var user = D.state.user;
    var name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "Player").split("@")[0];
    var ui = D.ui.dash(root, {
      head: { title: name, sub: "Player", initial: name },
      workspace: "Player Workspace", hideStatus: true, pill: "Player", chip: name,
      items: [
        { type: "label", label: "Play" },
        { key: "overview", label: "Overview", icon: "dashboard", href: "#/me" },
        { key: "find", label: "Find a club", icon: "search", href: "#/me/find" },
        { key: "clubs", label: "My clubs", icon: "groups", href: "#/me/clubs" },
        { key: "bookings", label: "My bookings", icon: "event_available", href: "#/me/bookings" },
        { type: "label", label: "Account" },
        { key: "profile", label: "My profile", icon: "person", href: "#/me/profile" }
      ],
      foot: [{ label: "Browse all clubs", icon: "home", href: "#/" }],
      active: section
    });
    ui.setTitle(SECTIONS[section][0], SECTIONS[section][1]);
    var sec = ui.main;
    sec.innerHTML = '<p class="muted">Loading...</p>';
    if (section === "find") return findView(sec);
    if (section === "clubs") return clubsView(sec);
    if (section === "bookings") return bookingsView(sec);
    if (section === "profile") return profileView(sec);
    return overviewView(sec);
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
      (joined ? ' <span class="badge approved">joined</span>' : "") + '<p class="muted small">' + esc(c.city || "") + "</p></div>" +
      '<div class="clubrow-actions"><a class="btn sm ghost" href="#/c/' + esc(c.slug) + '">View</a> ' +
      '<a class="btn sm" href="#/c/' + esc(c.slug) + (joined ? "/book" : "/join") + '">' + (joined ? "Book a court" : "Join and book") + "</a></div></div>";
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
      return '<a class="tile ' + (tone || "") + '" href="' + href + '"><span class="mi">' + icon + "</span><b>" + n + "</b><span>" + label + "</span></a>";
    };
    var when = next ? new Date(next.starts_at).toLocaleString("en-PH", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    sec.innerHTML = '<div class="tiles">' + tile(up, "Confirmed upcoming", "event_available", "#/me/bookings") +
      tile(pending, "Waiting for payment or approval", "pending_actions", "#/me/bookings", pending ? "warn" : "") +
      tile(mc.clubs.length, "Clubs joined", "groups", "#/me/clubs") + "</div>" +
      '<div class="panel wide"><h2>Next booking</h2>' + (next
        ? '<p><b>' + esc(clubName) + "</b> - " + esc(courtName) + '<br><span class="muted">' + esc(when) + "</span></p>" +
          '<p><span class="badge ' + esc(next.status) + '">' + esc(next.status) + "</span> <span class=\"muted small\">" + money(next.amount) + " - code " + esc(next.reference_code) + '</span></p><a class="btn sm" href="#/me/bookings">Manage bookings</a>'
        : '<p class="muted">No upcoming bookings yet.</p><a class="btn sm" href="#/me/find">Find a club to book</a>') + "</div>" +
      (mc.clubs.length ? "" : '<div class="panel wide"><h2>Get started</h2><p class="muted">Join a club, pick a court and a time, then pay by QR. It takes a minute.</p>' +
        '<a class="btn" href="#/me/find">Find a club</a></div>');
  }

  async function findView(sec) {
    var mc = await myClubs(), joined = {};
    mc.players.forEach(function (p) { joined[p.tenant_id] = true; });
    var all = (await sb.from("public_clubs").select("id,slug,name,city,logo_path").order("name")).data || [];
    sec.innerHTML = '<div class="searchrow"><span class="mi" aria-hidden="true">search</span><input id="fq" type="search" placeholder="Search clubs or cities" aria-label="Search clubs"></div><div class="panel wide" id="flist"></div>';
    function draw() {
      var term = q("#fq", sec).value.trim().toLowerCase();
      var list = all.filter(function (c) { return !term || (c.name + " " + (c.city || "")).toLowerCase().indexOf(term) !== -1; });
      q("#flist", sec).innerHTML = list.length ? list.map(function (c) { return clubRow(c, !!joined[c.id]); }).join("") : '<p class="muted">No clubs match your search.</p>';
    }
    q("#fq", sec).oninput = draw; draw();
  }

  async function clubsView(sec) {
    var mc = await myClubs();
    sec.innerHTML = '<div class="panel wide">' + (mc.clubs.length ? mc.clubs.map(function (c) { return clubRow(c, true); }).join("")
      : '<p class="muted">You have not joined a club yet.</p><a class="btn sm" href="#/me/find">Find a club</a>') + "</div>";
  }

  function bookingsView(sec) {
    sec.innerHTML = '<div class="panel wide"><div id="mybookings">Loading...</div></div>';
    if (D.booking) D.booking.myBookings(q("#mybookings", sec));
  }

  async function profileView(sec) {
    sec.innerHTML = '<div class="panel wide"><h2>My profile</h2><form id="myprofile"><div class="grid2">' +
      '<label>Full name<input id="mp-name" maxlength="80" autocomplete="name"></label>' +
      '<label>Phone<input id="mp-phone" maxlength="30" autocomplete="tel"></label></div>' +
      '<p class="muted small">Email: ' + esc(D.state.user.email) + '</p><p class="msg" role="alert"></p>' +
      '<button class="btn sm" type="submit">Save profile</button></form></div>';
    var r = await sb.from("profiles").select("full_name,phone").eq("auth_user_id", D.state.user.id).maybeSingle();
    if (q("#mp-name", sec)) {
      q("#mp-name", sec).value = (r.data && r.data.full_name) || "";
      q("#mp-phone", sec).value = (r.data && r.data.phone) || "";
    }
    q("#myprofile", sec).onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = q("button", f);
      btn.disabled = true;
      var x = await sb.from("profiles").update({ full_name: q("#mp-name", f).value.trim() || null, phone: q("#mp-phone", f).value.trim() || null })
        .eq("auth_user_id", D.state.user.id);
      btn.disabled = false;
      setMsg(f, x.error ? friendly(x.error) : "Profile saved.", x.error ? "err" : "ok");
    };
  }

  D.player = { render: render };
})();
