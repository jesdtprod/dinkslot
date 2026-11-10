// DINKSLOT frontend (vanilla JS). Hash routes: /#/c/<slug>. No business rules live here:
// the database decides; this file only calls views and functions.
(function () {
  "use strict";
  var cfg = window.DINKSLOT_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });
  var app = document.getElementById("app");
  var nav = document.getElementById("nav");
  var state = { user: null, isPlatform: false };

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function go(path) { location.hash = "#" + path; }
  function slugify(s) {
    return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }
  var MESSAGES = {
    slug_taken: "That club address is already taken. Try another.",
    invalid_slug_or_name: "Club address must be 3-40 lowercase letters, digits or hyphens, and not a reserved word.",
    captcha_required: "Please complete the human check and try again.",
    captcha_failed: "The human check failed. Please try again.",
    not_authenticated: "Please sign in first.",
    club_not_found: "That club was not found.",
    player_blocked: "You are blocked from this club.",
    forbidden: "You do not have permission to do that."
  };
  function friendly(err) {
    var m = (err && (err.message || err.msg)) || String(err || "");
    for (var k in MESSAGES) if (m.indexOf(k) !== -1) return MESSAGES[k];
    return m || "Something went wrong.";
  }
  function setMsg(root, text, kind) {
    var box = $(".msg", root);
    if (!box) return;
    box.className = "msg " + (kind || "");
    box.textContent = text || "";
  }
  function mediaUrl(path) {
    return path ? sb.storage.from("club-media").getPublicUrl(path).data.publicUrl : "";
  }

  // -------------------------------------------------------------- Turnstile
  function mountCaptcha(container) {
    var h = { token: null, id: null };
    var tries = 0;
    (function wait() {
      if (window.turnstile) {
        h.id = window.turnstile.render(container, {
          sitekey: cfg.TURNSTILE_SITE_KEY,
          callback: function (t) { h.token = t; },
          "expired-callback": function () { h.token = null; },
          "error-callback": function () { h.token = null; }
        });
      } else if (tries++ < 100) {
        setTimeout(wait, 100);
      } else {
        container.textContent = "Human check could not load. Check your connection and reload.";
      }
    })();
    h.reset = function () { h.token = null; if (window.turnstile && h.id != null) window.turnstile.reset(h.id); };
    return h;
  }

  // ---------------------------------------------------------------- session
  async function refreshSession() {
    var r = await sb.auth.getSession();
    state.user = r.data.session ? r.data.session.user : null;
    state.isPlatform = false;
    if (state.user) {
      var p = await sb.from("profiles").select("is_platform_admin").maybeSingle();
      state.isPlatform = !!(p.data && p.data.is_platform_admin);
    }
    renderNav();
  }
  function renderNav() {
    var h = "";
    document.body.classList.toggle("sa", !!state.isPlatform);
    if (state.isPlatform) {
      // Super admin has its own chrome: no tenant items (register club, my account).
      nav.innerHTML = '<span class="sa-tag">SUPER ADMIN</span><a href="#/platform">Console</a>' +
        '<a href="#/">Public site</a><span class="muted-w">' + esc(state.user.email) + "</span>" +
        '<button id="signout" class="linkbtn">Sign out</button>';
      document.getElementById("signout").onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/"); };
      return;
    }
    if (state.user) {
      h += '<a href="#/me">My account</a><a href="#/register-club" class="pill">Register your club</a>' +
           '<button id="signout" class="linkbtn">Sign out</button>';
    } else {
      h += '<a href="#/auth">Sign in</a><a href="#/register-club" class="pill">Register your club</a>';
    }
    nav.innerHTML = h;
    var so = document.getElementById("signout");
    if (so) so.onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/"); };
  }
  function requireUser(next) {
    if (state.user) return true;
    go("/auth?next=" + encodeURIComponent(next));
    return false;
  }

  // ------------------------------------------------------------------ views
  async function viewHome() {
    app.innerHTML =
      '<section class="hero"><img src="assets/logo.png" alt="DINKSLOT logo"><h1>DINKSLOT</h1>' +
      '<p>Book Your Slot. Own the Court.</p></section>' +
      '<div class="filters"><input id="q" type="search" placeholder="Search clubs" aria-label="Search clubs">' +
      '<select id="city" aria-label="City"><option value="">All cities</option></select></div>' +
      '<div id="grid" class="grid"><p class="muted">Loading clubs...</p></div>';
    var r = await sb.from("public_clubs").select("*").order("name");
    var clubs = r.data || [];
    var cities = Array.from(new Set(clubs.map(function (c) { return c.city; }).filter(Boolean))).sort();
    $("#city").innerHTML += cities.map(function (c) { return '<option>' + esc(c) + "</option>"; }).join("");
    function draw() {
      var q = $("#q").value.trim().toLowerCase(), city = $("#city").value;
      var list = clubs.filter(function (c) {
        return (!city || c.city === city) && (!q || (c.name + " " + (c.city || "")).toLowerCase().indexOf(q) !== -1);
      });
      $("#grid").innerHTML = list.length ? list.map(function (c) {
        return '<a class="card" href="#/c/' + esc(c.slug) + '">' +
          (c.cover_path ? '<img class="cover" src="' + esc(mediaUrl(c.cover_path)) + '" alt="">' : '<div class="cover ph"></div>') +
          '<div class="cbody"><h3>' + esc(c.name) + '</h3><p class="muted">' + esc(c.city || "") + "</p></div></a>";
      }).join("") : '<p class="muted">No clubs yet. Be the first to <a href="#/register-club">register your club</a>.</p>';
    }
    $("#q").oninput = draw; $("#city").onchange = draw; draw();
  }

  async function viewClub(slug) {
    app.innerHTML = '<p class="muted">Loading...</p>';
    var r = await sb.from("public_clubs").select("*").eq("slug", slug).maybeSingle();
    var c = r.data;
    if (!c) { app.innerHTML = "<h2>Club not found</h2><p>This club does not exist or is not approved yet.</p>"; return; }
    var courts = (await sb.from("public_courts").select("*").eq("club_slug", slug).order("name")).data || [];
    app.innerHTML =
      (c.cover_path ? '<img class="clubcover" src="' + esc(mediaUrl(c.cover_path)) + '" alt="">' : '<div class="clubcover ph"></div>') +
      '<div class="clubhead">' + (c.logo_path ? '<img class="logo" src="' + esc(mediaUrl(c.logo_path)) + '" alt="">' : "") +
      "<div><h1>" + esc(c.name) + '</h1><p class="muted">' + esc([c.address, c.city].filter(Boolean).join(", ")) + "</p></div></div>" +
      (c.description ? "<p>" + esc(c.description) + "</p>" : "") +
      "<h2>Courts</h2>" + (courts.length ? '<ul class="list">' + courts.map(function (k) {
        return "<li><strong>" + esc(k.name) + "</strong> " + (k.is_indoor ? "(indoor)" : "(outdoor)") +
          " - PHP " + esc(Number(k.hourly_rate).toFixed(2)) + "/hr, " + esc(String(k.open_time).slice(0, 5)) + "-" + esc(String(k.close_time).slice(0, 5)) + "</li>";
      }).join("") + "</ul>" : '<p class="muted">No courts listed yet.</p>') +
      '<p><a class="btn" href="#/c/' + esc(slug) + '/join">Join and book</a></p>';
  }

  // Sign in / sign up. After success: optional join_club for /c/<slug>/join.
  function viewAuth(opts) {
    opts = opts || {};
    var next = opts.next || "/me";
    app.innerHTML =
      '<section class="panel"><h1>' + (opts.title || "Sign in") + "</h1>" +
      (opts.intro ? "<p>" + opts.intro + "</p>" : "") +
      '<div class="tabs"><button type="button" id="tab-in" class="tab on">Sign in</button>' +
      '<button type="button" id="tab-up" class="tab">Create account</button></div>' +
      '<form id="f" novalidate><label id="l-name" hidden>Full name<input id="name" autocomplete="name"></label>' +
      '<label>Email<input id="email" type="email" autocomplete="email" required></label>' +
      '<label>Password<input id="pw" type="password" autocomplete="current-password" minlength="6" required></label>' +
      (opts.join ? '<label id="l-dn">Display name at this club<input id="dn" maxlength="60"></label>' : "") +
      '<div id="cap" class="cap"></div><p class="msg" role="alert"></p>' +
      '<button class="btn" id="go" type="submit">Sign in</button></form></section>';
    var mode = "in", cap = mountCaptcha($("#cap"));
    function setMode(m) {
      mode = m;
      $("#tab-in").classList.toggle("on", m === "in"); $("#tab-up").classList.toggle("on", m === "up");
      $("#l-name").hidden = m !== "up"; $("#go").textContent = m === "up" ? "Create account" : "Sign in";
      $("#pw").autocomplete = m === "up" ? "new-password" : "current-password";
    }
    $("#tab-in").onclick = function () { setMode("in"); }; $("#tab-up").onclick = function () { setMode("up"); };
    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#email").value.trim(), pw = $("#pw").value;
      if (!email || pw.length < 6) return setMsg(app, "Enter your email and a password of at least 6 characters.", "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      $("#go").disabled = true; setMsg(app, "Please wait...", "");
      var res;
      if (mode === "up") {
        res = await sb.auth.signUp({ email: email, password: pw, options: { captchaToken: cap.token, data: { full_name: $("#name").value.trim() } } });
      } else {
        res = await sb.auth.signInWithPassword({ email: email, password: pw, options: { captchaToken: cap.token } });
      }
      cap.reset(); $("#go").disabled = false;
      if (res.error) return setMsg(app, friendly(res.error), "err");
      if (!res.data.session) return setMsg(app, "Account created. Check your email to confirm, then sign in.", "ok");
      await refreshSession();
      if (state.isPlatform) return go("/platform");
      if (opts.join) {
        var dn = ($("#dn") && $("#dn").value.trim()) || $("#name").value.trim() || email.split("@")[0];
        var j = await sb.rpc("join_club", { p_slug: opts.join, p_display_name: dn });
        if (j.error) return setMsg(app, friendly(j.error), "err");
      }
      go(next);
    };
  }

  async function viewJoin(slug) {
    var c = (await sb.from("public_clubs").select("name").eq("slug", slug).maybeSingle()).data;
    if (!c) { app.innerHTML = "<h2>Club not found</h2>"; return; }
    if (state.user) {
      app.innerHTML = '<section class="panel"><h1>Join ' + esc(c.name) + '</h1><form id="f"><label>Display name at this club' +
        '<input id="dn" maxlength="60" required></label><p class="msg" role="alert"></p><button class="btn" type="submit">Join club</button></form></section>';
      $("#f").onsubmit = async function (e) {
        e.preventDefault();
        var j = await sb.rpc("join_club", { p_slug: slug, p_display_name: $("#dn").value.trim() });
        if (j.error) return setMsg(app, friendly(j.error), "err");
        go("/c/" + slug);
      };
      return;
    }
    viewAuth({ title: "Join " + esc(c.name), intro: "Sign in or create an account to join this club.", join: slug, next: "/c/" + slug });
  }

  function viewRegisterClub() {
    if (!requireUser("/register-club")) return;
    app.innerHTML =
      '<section class="panel"><h1>Register your club</h1><p>Your club appears publicly after the platform admin approves it.</p>' +
      '<form id="f" novalidate><label>Club name<input id="name" maxlength="80" required></label>' +
      '<label>Club address (web link)<input id="slug" maxlength="40" required placeholder="my-club"></label>' +
      '<p class="muted small" id="slugprev"></p>' +
      '<label>Description<textarea id="desc" rows="3"></textarea></label>' +
      '<label>Street address<input id="addr"></label><label>City<input id="city"></label>' +
      '<label>Contact email<input id="cemail" type="email"></label><label>Contact phone<input id="cphone"></label>' +
      '<div id="cap" class="cap"></div><p class="msg" role="alert"></p><button class="btn" id="go" type="submit">Submit for approval</button></form></section>';
    var cap = mountCaptcha($("#cap")), touched = false;
    function prev() { $("#slugprev").textContent = "Your page: #/c/" + ($("#slug").value || "..."); }
    $("#name").oninput = function () { if (!touched) $("#slug").value = slugify($("#name").value); prev(); };
    $("#slug").oninput = function () { touched = true; this.value = slugify(this.value); prev(); };
    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      $("#go").disabled = true; setMsg(app, "Submitting...", "");
      var v = await sb.functions.invoke("verify-turnstile", { body: { token: cap.token, purpose: "register_club" } });
      if (v.error || !v.data || !v.data.success) {
        cap.reset(); $("#go").disabled = false; return setMsg(app, MESSAGES.captcha_failed, "err");
      }
      var r = await sb.rpc("register_club", {
        p_name: $("#name").value.trim(), p_slug: $("#slug").value, p_description: $("#desc").value.trim() || null,
        p_address: $("#addr").value.trim() || null, p_city: $("#city").value.trim() || null,
        p_contact_email: $("#cemail").value.trim() || null, p_contact_phone: $("#cphone").value.trim() || null
      });
      cap.reset(); $("#go").disabled = false;
      if (r.error) return setMsg(app, friendly(r.error), "err");
      app.innerHTML = '<section class="panel"><h1>Thanks!</h1><p><strong>' + esc(r.data.name) +
        '</strong> was submitted. It stays hidden until the platform admin approves it.</p><p><a class="btn" href="#/me">Go to my account</a></p></section>';
    };
  }

  async function viewMe() {
    if (!requireUser("/me")) return;
    app.innerHTML = '<h1>My account</h1><p class="muted">' + esc(state.user.email) + '</p><div id="mine">Loading...</div>';
    var m = await sb.from("tenant_members").select("role, tenants(id, slug, name, status)").eq("user_id", state.user.id);
    var rows = m.data || [];
    $("#mine").innerHTML = "<h2>Clubs you manage</h2>" + (rows.length ? '<ul class="list">' + rows.map(function (x) {
      var t = x.tenants || {};
      return "<li><strong>" + esc(t.name) + '</strong> <span class="badge ' + esc(t.status) + '">' + esc(t.status) + "</span> (" + esc(x.role) + ")" +
        (t.status === "approved" ? ' - <a href="#/c/' + esc(t.slug) + '">public page</a>' : "") +
        ' - <a href="#/admin/' + esc(t.slug) + '">dashboard</a></li>';
    }).join("") + "</ul>" : '<p class="muted">None yet. <a href="#/register-club">Register your club</a>.</p>') +
      "<h2>My bookings</h2><p class=\"muted\">Booking comes in a later stage.</p>";
  }

  async function viewPlatform() {
    if (!requireUser("/platform")) return;
    if (!state.isPlatform) { app.innerHTML = "<h2>Not allowed</h2><p>This page is for the platform admin.</p>"; return; }
    app.innerHTML = '<h1>Super admin console</h1><p class="muted">Review and control every club on DINKSLOT.</p>' +
      '<div id="stats" class="stats"></div>' +
      '<div class="filters"><input id="sq" type="search" placeholder="Search clubs, owners, cities" aria-label="Search">' +
      '<select id="sf" aria-label="Status filter"><option value="pending">Pending approval</option><option value="">All clubs</option>' +
      '<option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></div>' +
      '<p class="msg" role="alert"></p><div id="list">Loading...</div>';
    var all = [];
    function draw() {
      var q = $("#sq").value.trim().toLowerCase(), f = $("#sf").value;
      var rows = all.filter(function (c) {
        return (!f || c.status === f) &&
          (!q || [c.name, c.slug, c.city, c.owner_name, c.contact_email].join(" ").toLowerCase().indexOf(q) !== -1);
      });
      var counts = { pending: 0, approved: 0, rejected: 0, suspended: 0 };
      all.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      $("#stats").innerHTML = ["pending", "approved", "rejected", "suspended"].map(function (s) {
        return '<div class="stat ' + s + '"><b>' + counts[s] + "</b><span>" + s + "</span></div>";
      }).join("") + '<div class="stat"><b>' + all.length + "</b><span>total</span></div>";
      $("#list").innerHTML = rows.length ? '<table class="tbl"><thead><tr><th>Club</th><th>Owner</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(function (c) {
          var b = function (d, label) { return '<button class="btn sm" data-id="' + esc(c.id) + '" data-d="' + d + '">' + label + "</button> "; };
          return "<tr><td><strong>" + esc(c.name) + '</strong><br><span class="muted small">/c/' + esc(c.slug) + (c.city ? " - " + esc(c.city) : "") + "</span></td><td>" +
            esc(c.owner_name || "") + (c.contact_email ? '<br><span class="muted small">' + esc(c.contact_email) + "</span>" : "") + '</td><td class="small">' +
            esc(new Date(c.created_at).toLocaleDateString()) + '</td><td><span class="badge ' + esc(c.status) + '">' + esc(c.status) + "</span></td><td>" +
            (c.status !== "approved" ? b("approved", "Approve") : "") + (c.status === "pending" ? b("rejected", "Reject") : "") +
            (c.status === "approved" ? b("suspended", "Suspend") : "") + "</td></tr>";
        }).join("") + "</tbody></table>" : '<p class="muted">No clubs match.</p>';
      bind();
    }
    $("#sq").oninput = draw; $("#sf").onchange = draw;
    async function load() {
      var r = await sb.rpc("platform_list_clubs");
      if (r.error) return setMsg(app, friendly(r.error), "err");
      all = r.data || [];
      draw();
    }
    function bind() {
      Array.prototype.forEach.call(app.querySelectorAll("button[data-d]"), function (btn) {
        btn.onclick = async function () {
          var d = btn.getAttribute("data-d"), reason = null;
          if (d !== "approved") { reason = prompt("Reason (optional):") || null; }
          btn.disabled = true;
          var x = await sb.rpc("decide_club", { p_tenant_id: btn.getAttribute("data-id"), p_decision: d, p_reason: reason });
          if (x.error) setMsg(app, friendly(x.error), "err"); else setMsg(app, "Club " + d + ".", "ok");
          load();
        };
      });
    }
    load();
  }

  function viewAdminStub(slug) {
    if (!requireUser("/admin/" + slug)) return;
    app.innerHTML = "<h1>Club dashboard</h1><p>" + esc(slug) + " - courts, settings and the approval queue arrive in the next stages.</p>";
  }

  // ----------------------------------------------------------------- router
  async function render() {
    var raw = (location.hash || "#/").slice(1) || "/";
    var qs = raw.indexOf("?"), path = qs === -1 ? raw : raw.slice(0, qs);
    var q = new URLSearchParams(qs === -1 ? "" : raw.slice(qs + 1));
    var m;
    window.scrollTo(0, 0);
    try {
      // Super admin never uses tenant/player screens.
      if (state.isPlatform && (path === "/me" || path === "/register-club" || path === "/auth")) return go("/platform");
      if (path === "/") return await viewHome();
      if (path === "/auth") { var n = q.get("next"); return viewAuth({ next: n && n.charAt(0) === "/" ? n : "/me" }); }
      if (path === "/register-club") return viewRegisterClub();
      if (path === "/me") return await viewMe();
      if (path === "/platform") return await viewPlatform();
      if ((m = path.match(/^\/c\/([a-z0-9-]+)$/))) return await viewClub(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/join$/))) return await viewJoin(m[1]);
      if ((m = path.match(/^\/admin\/([a-z0-9-]+)$/))) return viewAdminStub(m[1]);
      app.innerHTML = "<h2>Page not found</h2><p><a href=\"#/\">Back to home</a></p>";
    } catch (err) {
      app.innerHTML = '<h2>Something went wrong</h2><p class="muted">' + esc(friendly(err)) + "</p>";
    }
  }

  window.addEventListener("hashchange", render);
  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") refreshSession(); });
  refreshSession().then(render);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
