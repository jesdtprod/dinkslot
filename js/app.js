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
  var liveChannel = null, livePoll = null;
  function stopLive() {
    if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
    if (livePoll) { clearInterval(livePoll); livePoll = null; }
  }

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
    var note = document.createElement("p");
    note.className = "msg err small";
    container.parentNode.insertBefore(note, container.nextSibling);
    function retryLink() {
      note.appendChild(document.createTextNode(" "));
      var retry = document.createElement("a");
      retry.href = "#"; retry.className = "retry"; retry.textContent = "Retry the check";
      note.appendChild(retry);
      note.querySelector(".retry").onclick = function (e) { e.preventDefault(); note.textContent = ""; h.reset(); arm(); };
    }
    var slow;
    function arm() {
      clearTimeout(slow);
      slow = setTimeout(function () {
        if (!h.token) { note.textContent = "The human check is taking long. "; retryLink(); }
      }, 20000);
    }
    (function wait() {
      if (window.turnstile) {
        h.id = window.turnstile.render(container, {
          sitekey: cfg.TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          callback: function (t) { h.token = t; note.textContent = ""; clearTimeout(slow); },
          "expired-callback": function () { h.token = null; },
          "error-callback": function (code) {
            h.token = null; clearTimeout(slow);
            note.textContent = "Human check error" + (code ? " (" + code + ")" : "") + ". Disable ad blockers for this site, check your connection, then ";
            retryLink();
            return true;
          }
        });
        arm();
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
      // Filter to our own row: a platform admin can read every profile, so maybeSingle() alone would fail.
      var p = await sb.from("profiles").select("is_platform_admin").eq("auth_user_id", state.user.id).maybeSingle();
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
      '<section class="hero"><img src="assets/dinkslot-logo.png" alt="DINKSLOT logo"><h1>DINKSLOT</h1>' +
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
    var defaultTitleIn = opts.title || "Welcome back to the court";
    var defaultTitleUp = opts.title || "Create your player account";
    var defaultIntroIn = opts.intro || "Enter your credentials to access your bookings and club schedule.";
    var defaultIntroUp = opts.intro || "Register your DINKSLOT profile to book courts or manage your club.";
    app.innerHTML =
      '<div id="ds-auth-screen" class="flex flex-col w-full">' +
      '<div class="auth-stage relative w-full min-h-[calc(100vh-4rem)] flex items-center justify-center p-gutter lg:p-gutter-desktop overflow-hidden bg-surface">' +
      '<!-- Ambient Court Kinetic Background Glows -->' +
      '<div class="pointer-events-none absolute -top-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[140px] mix-blend-screen"></div>' +
      '<div class="pointer-events-none absolute -bottom-48 -right-32 w-[30rem] h-[30rem] bg-primary-container/15 rounded-full blur-[160px] mix-blend-screen"></div>' +
      '<!-- Geometric Court Grid Motif Vector Underlay -->' +
      '<div class="pointer-events-none absolute inset-0 opacity-[0.035] flex items-center justify-center">' +
      '<svg class="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">' +
      '<line class="text-primary" stroke-width="2" x1="200" x2="200" y1="0" y2="800"></line>' +
      '<line class="text-primary" stroke-width="2" x1="1000" x2="1000" y1="0" y2="800"></line>' +
      '<line class="text-primary" stroke-dasharray="12 12" stroke-width="2" x1="600" x2="600" y1="0" y2="800"></line>' +
      '<circle class="text-primary" cx="600" cy="400" r="180" stroke-width="2"></circle>' +
      '<line class="text-primary" stroke-width="2" x1="200" x2="1000" y1="400" y2="400"></line>' +
      '</svg>' +
      '</div>' +
      '<!-- Main Dynamic Auth Card Container -->' +
      '<div class="auth-card relative z-10 w-full max-w-5xl my-auto grid grid-cols-1 lg:grid-cols-12 rounded-lg bg-surface-container-low shadow-2xl overflow-hidden">' +
      '<!-- Left Hero & Brand Identity Panel -->' +
      '<div class="auth-story lg:col-span-5 relative flex flex-col justify-between p-8 lg:p-10 bg-surface-container overflow-hidden">' +
      '<div class="absolute inset-0 bg-gradient-to-b from-surface-container-highest/20 via-transparent to-surface-container-lowest/80 pointer-events-none"></div>' +
      '<div class="absolute -right-20 -bottom-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>' +
      '<div class="relative z-10 space-y-6">' +
      '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-high">' +
      '<span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>' +
      '<span class="font-label-sm text-label-sm text-primary uppercase tracking-widest">DS COMPETITIVE PORTAL</span>' +
      '</div>' +
      '<div class="flex items-center gap-4 pt-2">' +
      '<div class="auth-logo-frame">' +
      '<img class="auth-logo" src="assets/dinkslot-logo.png" alt="DINKSLOT logo" width="80" height="80" />' +
      '</div>' +
      '<div>' +
      '<h2 class="font-headline-md text-headline-md text-on-surface uppercase tracking-tight">DINKSLOT</h2>' +
      '<p class="font-label-sm text-label-sm text-primary tracking-wider uppercase font-semibold">Pro Match Engine • Club Sync</p>' +
      '</div>' +
      '</div>' +
      '<div class="space-y-2 pt-2">' +
      '<h1 class="font-headline-lg text-headline-lg text-on-surface leading-tight">' +
      'Elevate your game. <span class="text-primary italic font-headline-display">Rule the court.</span>' +
      '</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant max-w-sm">' +
      'Instant court reservations, verified club memberships, real-time slot availability, and seamless QR booking approvals.' +
      '</p>' +
      '</div>' +
      '</div>' +
      '<!-- Mid Photo Card Inset -->' +
      '<div class="auth-photo relative z-10 my-6 rounded-DEFAULT overflow-hidden shadow-lg bg-surface-container-high group">' +
      '<img class="w-full h-44 object-cover object-center group-hover:scale-105 transition-transform duration-500 opacity-80" alt="Competitive Pickleball Court" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA3opnNx-xsTA73_2sEb3cw28fjSj6yHpaIXn0yCWSqxHyYYdmCYfIokpfSKl6P-dOTar3W4w7BC-8romQ67GnntAhYuXiGdngYUAbuuEuFmgVyV0YxFBkLznLBXIi2kOk2TOxNYVPw6zImufyd5hNpy9JTHAg6GQa0sZhT21WRW2WOkXTD0ZCFMeDa94rWdQVy9wD9EK3esyUKF4KRmQqJ2vtTBJctiucz-CRFTc4" />' +
      '<div class="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/40 to-transparent"></div>' +
      '<div class="absolute bottom-3 left-4 right-4 flex items-center justify-between">' +
      '<div class="flex items-center gap-2">' +
      '<span class="w-2.5 h-2.5 rounded-full bg-primary animate-ping"></span>' +
      '<span class="font-label-md text-label-md text-on-surface font-semibold">Center Court #4</span>' +
      '</div>' +
      '<span class="font-label-sm text-label-sm px-2.5 py-0.5 rounded-full bg-primary-container text-on-primary font-bold">GAME POINT • 10-9</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<!-- Right Interactive Auth Form Panel -->' +
      '<div class="auth-form-panel lg:col-span-7 p-8 lg:p-12 flex flex-col justify-center bg-surface-container-low">' +
      '<div class="auth-form-content max-w-md w-full mx-auto space-y-6">' +
      '<!-- Header Inside Card -->' +
      '<div class="space-y-1">' +
      '<span id="auth-kicker" class="font-label-sm text-label-sm text-primary uppercase font-bold tracking-widest">Player Access</span>' +
      '<h2 id="auth-title" class="font-headline-lg text-headline-lg text-on-surface">' + defaultTitleIn + '</h2>' +
      '<p id="auth-sub" class="font-body-sm text-body-sm text-on-surface-variant">' + defaultIntroIn + '</p>' +
      '</div>' +
      '<!-- Interactive Form -->' +
      '<form class="space-y-4" id="f" novalidate>' +
      '<!-- Full Name Field (Create Account mode) -->' +
      '<div id="l-name" class="space-y-1" hidden>' +
      '<label class="block font-label-md text-label-md text-on-surface font-semibold tracking-wide" for="name">Full Name</label>' +
      '<div class="relative flex items-center">' +
      '<span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none">person</span>' +
      '<input id="name" autocomplete="name" placeholder="Alex Rivera" class="w-full pl-11 pr-4 py-3 rounded-full bg-surface-container text-on-surface font-body-md text-body-md placeholder-on-surface-variant/40 focus:outline-none focus:bg-surface-container-high transition-all" />' +
      '</div>' +
      '</div>' +
      '<!-- Email Field -->' +
      '<div class="space-y-1">' +
      '<label class="block font-label-md text-label-md text-on-surface font-semibold tracking-wide" for="email">Email Address</label>' +
      '<div class="relative flex items-center">' +
      '<span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none">alternate_email</span>' +
      '<input id="email" type="email" autocomplete="email" placeholder="player@dinkslot.club" required class="w-full pl-11 pr-4 py-3 rounded-full bg-surface-container text-on-surface font-body-md text-body-md placeholder-on-surface-variant/40 focus:outline-none focus:bg-surface-container-high transition-all" />' +
      '</div>' +
      '</div>' +
      '<!-- Password Field -->' +
      '<div class="space-y-1">' +
      '<div class="flex items-center justify-between">' +
      '<label class="block font-label-md text-label-md text-on-surface font-semibold tracking-wide" for="pw">Password</label>' +
      '<a id="forgot-pw" class="font-label-sm text-label-sm text-primary hover:text-secondary-fixed transition-colors font-semibold" href="#">Forgot password?</a>' +
      '</div>' +
      '<div class="relative flex items-center">' +
      '<span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none">lock</span>' +
      '<input id="pw" type="password" autocomplete="current-password" minlength="6" placeholder="••••••••••••" required class="w-full pl-11 pr-12 py-3 rounded-full bg-surface-container text-on-surface font-body-md text-body-md placeholder-on-surface-variant/40 focus:outline-none focus:bg-surface-container-high transition-all" />' +
      '<button aria-label="Toggle password visibility" class="absolute right-3.5 text-on-surface-variant hover:text-primary transition-colors focus:outline-none p-1" id="toggle-password-btn" type="button">' +
      '<span class="material-symbols-outlined text-[20px]" id="eye-icon">visibility</span>' +
      '</button>' +
      '</div>' +
      '</div>' +
      (opts.join ?
        '<div id="l-dn" class="space-y-1">' +
        '<label class="block font-label-md text-label-md text-on-surface font-semibold tracking-wide" for="dn">Display Name at This Club</label>' +
        '<div class="relative flex items-center">' +
        '<span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none">badge</span>' +
        '<input id="dn" maxlength="60" placeholder="How other players see you" class="w-full pl-11 pr-4 py-3 rounded-full bg-surface-container text-on-surface font-body-md text-body-md placeholder-on-surface-variant/40 focus:outline-none focus:bg-surface-container-high transition-all" />' +
        '</div>' +
        '</div>' : '') +
      '<!-- Remember Me & Security Meta -->' +
      '<div class="flex items-center justify-between pt-1">' +
      '<label class="flex items-center gap-2.5 cursor-pointer select-none group">' +
      '<input class="sr-only peer" id="remember-me" type="checkbox" checked />' +
      '<div class="w-4 h-4 rounded bg-surface-container peer-checked:bg-primary-container peer-focus:ring-2 peer-focus:ring-primary flex items-center justify-center transition-colors">' +
      '<span class="material-symbols-outlined text-on-primary text-[14px] font-bold opacity-0 peer-checked:opacity-100 transition-opacity">check</span>' +
      '</div>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant group-hover:text-on-surface transition-colors">Remember me</span>' +
      '</label>' +
      '<div class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">' +
      '<span class="material-symbols-outlined text-[16px] text-primary">security</span>' +
      '<span>Secure sign in</span>' +
      '</div>' +
      '</div>' +
      '<!-- Turnstile & Feedback -->' +
      '<div id="cap" class="cap"></div>' +
      '<p class="msg" role="alert"></p>' +
      '<!-- Primary Neon CTA Action -->' +
      '<div class="pt-2">' +
      '<button class="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-full bg-primary-container text-on-primary font-headline-sm text-headline-sm uppercase tracking-wider hover:bg-secondary-fixed active:scale-[0.99] transition-all duration-150 shadow-[0_0_24px_rgba(163,230,53,0.35)]" id="go" type="submit">' +
      '<span id="go-text">Sign In to Court</span>' +
      '<span class="material-symbols-outlined text-[22px] font-bold">arrow_forward</span>' +
      '</button>' +
      '</div>' +
      '</form>' +
      '<!-- Register Prompt & Switcher -->' +
      '<div class="text-center pt-2">' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
      '<span id="switch-text">New to DINKSLOT?</span> ' +
      '<a id="switch-btn" class="font-label-md text-label-md text-primary font-bold hover:underline hover:text-secondary-fixed transition-colors ml-1 inline-flex items-center gap-1" href="#">' +
      '<span id="switch-btn-label">Create an account</span>' +
      '<span class="material-symbols-outlined text-[16px]">open_in_new</span>' +
      '</a>' +
      '</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.classList.add("auth-page");
    var mode = "in", cap = mountCaptcha($("#cap"));
    function setBtnIdle() {
      var label = mode === "up" ? "Create Player Account" : "Sign In to Court";
      $("#go").innerHTML = '<span id="go-text">' + label + '</span><span class="material-symbols-outlined text-[22px] font-bold">arrow_forward</span>';
    }

    function setMode(m) {
      mode = m;
      var isUp = m === "up";
      $("#l-name").hidden = !isUp;
      $("#forgot-pw").hidden = isUp;
      $("#auth-kicker").textContent = isUp ? "Player Registration" : "Player Access";
      $("#auth-title").textContent = isUp ? defaultTitleUp : defaultTitleIn;
      $("#auth-sub").textContent = isUp ? defaultIntroUp : defaultIntroIn;
      $("#pw").autocomplete = isUp ? "new-password" : "current-password";
      $("#switch-text").textContent = isUp ? "Already have an account?" : "New to DINKSLOT?";
      $("#switch-btn-label").textContent = isUp ? "Sign in to court" : "Create an account";
      setBtnIdle();
      setMsg(app, "", "");
    }

    $("#switch-btn").onclick = function (e) {
      e.preventDefault();
      setMode(mode === "in" ? "up" : "in");
    };
    $("#toggle-password-btn").onclick = function () {
      var passwordInput = $("#pw");
      var eyeIcon = $("#eye-icon");
      if (!passwordInput || !eyeIcon) return;
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        eyeIcon.textContent = "visibility_off";
      } else {
        passwordInput.type = "password";
        eyeIcon.textContent = "visibility";
      }
    };
    $("#forgot-pw").onclick = async function (e) {
      e.preventDefault();
      var email = $("#email").value.trim();
      if (!email) return setMsg(app, "Enter your email address above first, then click Forgot password.", "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      var r = await sb.auth.resetPasswordForEmail(email, {
        captchaToken: cap.token,
        redirectTo: location.origin + location.pathname
      });
      cap.reset();
      if (r.error) return setMsg(app, friendly(r.error), "err");
      setMsg(app, "Password reset instructions sent. Check your email inbox.", "ok");
    };

    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#email").value.trim(), pw = $("#pw").value;
      if (!email || pw.length < 6) return setMsg(app, "Enter your email and a password of at least 6 characters.", "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      var btn = $("#go");
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[22px]">progress_activity</span><span>Authenticating Player...</span>';
      setMsg(app, "", "");
      var res;
      if (mode === "up") {
        res = await sb.auth.signUp({ email: email, password: pw, options: {
          captchaToken: cap.token,
          emailRedirectTo: location.origin + location.pathname,
          data: { full_name: $("#name").value.trim() } } });
      } else {
        res = await sb.auth.signInWithPassword({ email: email, password: pw, options: { captchaToken: cap.token } });
      }
      cap.reset();
      if (res.error) {
        btn.disabled = false;
        setBtnIdle();
        return setMsg(app, friendly(res.error), "err");
      }
      if (!res.data.session) {
        btn.disabled = false;
        setBtnIdle();
        return setMsg(app, "Account created. Check your email to confirm, then sign in.", "ok");
      }
      btn.innerHTML = '<span class="material-symbols-outlined text-[22px]">sports_tennis</span><span>Access Granted &bull; Entering Court</span>';
      await refreshSession();
      if (state.isPlatform) return go("/platform");
      if (opts.join) {
        var dn = ($("#dn") && $("#dn").value.trim()) || $("#name").value.trim() || email.split("@")[0];
        var j = await sb.rpc("join_club", { p_slug: opts.join, p_display_name: dn });
        if (j.error) {
          btn.disabled = false;
          setBtnIdle();
          return setMsg(app, friendly(j.error), "err");
        }
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
        var why = "";
        try {
          var body = v.error && v.error.context && v.error.context.json ? await v.error.context.json() : v.data;
          why = body ? (body.error || "") + (body.codes && body.codes.length ? " [" + body.codes.join(", ") + "]" : "") +
            (body.detail ? ": " + body.detail : "") + (body.message ? ": " + body.message : "") : "";
        } catch (_) { why = (v.error && v.error.message) || ""; }
        cap.reset(); $("#go").disabled = false;
        return setMsg(app, MESSAGES.captcha_failed + (why ? " (" + why + ")" : ""), "err");
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
    app.innerHTML = '<h1>My account</h1><p class="muted">' + esc(state.user.email) + '</p><p class="msg ok" role="status"></p><div id="mine">Loading...</div>';
    var known = {};
    async function loadMine(announce) {
      var m = await sb.from("tenant_members").select("role, tenants(id, slug, name, status)").eq("user_id", state.user.id);
      if (!$("#mine")) return; // user navigated away
      var rows = m.data || [];
      rows.forEach(function (x) {
        var t = x.tenants || {};
        if (announce && known[t.id] && known[t.id] !== t.status) {
          setMsg(app, t.name + " is now " + t.status + "!", t.status === "approved" ? "ok" : "err");
        }
        known[t.id] = t.status;
      });
      $("#mine").innerHTML = "<h2>Clubs you manage</h2>" + (rows.length ? '<ul class="list">' + rows.map(function (x) {
        var t = x.tenants || {};
        return "<li><strong>" + esc(t.name) + '</strong> <span class="badge ' + esc(t.status) + '">' + esc(t.status) + "</span> (" + esc(x.role) + ")" +
          (t.status === "pending" ? ' <span class="muted small">- waiting for approval</span>' : "") +
          (t.status === "approved" ? ' - <a href="#/c/' + esc(t.slug) + '">public page</a>' : "") +
          ' - <a href="#/admin/' + esc(t.slug) + '">dashboard</a></li>';
      }).join("") + "</ul>" : '<p class="muted">None yet. <a href="#/register-club">Register your club</a>.</p>') +
        "<h2>My bookings</h2><p class=\"muted\">Booking comes in a later stage.</p>";
    }
    await loadMine(false);
    // Live update: when the super admin decides, the status changes here without a refresh.
    // Realtime only delivers rows this user may read (RLS). Polling is a safety net.
    liveChannel = sb.channel("my-clubs-" + state.user.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenants" }, function () { loadMine(true); })
      .subscribe();
    livePoll = setInterval(function () { loadMine(true); }, 20000);
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

  // Shared helpers for the club dashboard module (js/admin.js).
  window.DS = {
    sb: sb, state: state, esc: esc, $: $, go: go, setMsg: setMsg, friendly: friendly,
    requireUser: requireUser, mediaUrl: mediaUrl, root: function () { return app; }
  };

  // ----------------------------------------------------------------- router
  async function render() {
    var raw = (location.hash || "#/").slice(1) || "/";
    var qs = raw.indexOf("?"), path = qs === -1 ? raw : raw.slice(0, qs);
    var q = new URLSearchParams(qs === -1 ? "" : raw.slice(qs + 1));
    var m;
    window.scrollTo(0, 0);
    stopLive();
    document.body.classList.remove("auth-page");
    // Supabase Auth returns here with #error=... (expired/used link) or #access_token=... (signed in).
    // These are not page routes.
    if (/^(error|access_token|error_code|error_description)=/.test(raw)) {
      var ap = new URLSearchParams(raw);
      history.replaceState(null, "", location.pathname + location.search);
      if (ap.get("error")) {
        var expired = ap.get("error_code") === "otp_expired";
        app.innerHTML = '<section class="panel"><h1>' + (expired ? "Link already used or expired" : "Sign-in link problem") + "</h1>" +
          "<p>" + (expired
            ? "This confirmation link was already used or has expired. If you already clicked it, your email is confirmed: just sign in. Otherwise create the account again to get a fresh link."
            : esc((ap.get("error_description") || "Something went wrong.").replace(/\+/g, " "))) + '</p><p><a class="btn" href="#/auth">Sign in</a></p></section>';
        return;
      }
      return go(state.user ? "/me" : "/auth");
    }
    try {
      // Super admin never uses tenant/player screens.
      if (state.isPlatform && (path === "/me" || path === "/register-club" || path === "/auth")) return go("/platform");
      if (path === "/") return await viewHome();
      if (path === "/auth") { var n = q.get("next"), mMode = q.get("mode"); return viewAuth({ next: n && n.charAt(0) === "/" ? n : "/me", mode: mMode }); }
      if (path === "/register-club") return viewRegisterClub();
      if (path === "/me") return await viewMe();
      if (path === "/platform") return await viewPlatform();
      if ((m = path.match(/^\/c\/([a-z0-9-]+)$/))) return await viewClub(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/join$/))) return await viewJoin(m[1]);
      if ((m = path.match(/^\/admin\/([a-z0-9-]+)(?:\/(courts|settings))?$/))) {
        if (!requireUser(path)) return;
        return await window.DS.admin.render(m[1], m[2] || "dashboard");
      }
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

