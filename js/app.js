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
  document.addEventListener("pointerdown", function (event) {
    document.querySelectorAll(".city-menu[open]").forEach(function (menu) {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });
  var state = { avatarPath: null, user: null, isPlatform: false, managedSlug: null, accountType: null };
  var liveChannel = null, livePoll = null;
  var cleanupAuthPattern = function () {};
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
    already_has_club: "Your account already manages a club. One account can manage one club.",
    user_in_other_club: "That person already manages another club. One account can manage one club only.",
    rate_limited: "You are doing that too often. Please wait a few minutes and try again.",
    "Failed to fetch": "Cannot reach the server. Check your internet connection and try again.",
    "NetworkError": "Cannot reach the server. Check your internet connection and try again.",
    "Load failed": "Cannot reach the server. Check your internet connection and try again.",
    club_account_cannot_book: "Club accounts cannot book as players. Use a player account to book a court.",
    player_account_cannot_register_club: "This is a player account. Club owners register with a separate club account.",
    user_is_player: "That email belongs to a player account. Staff need a club account.",
    account_type_locked: "This account is already set up as a different type.",
    forbidden: "You do not have permission to do that."
  };
  function friendly(err) {
    var m = (err && (err.message || err.msg)) || String(err || "");
    for (var k in MESSAGES) if (m.indexOf(k) !== -1) return MESSAGES[k];
    return m || "Something went wrong.";
  }
  function setMsg(root, text, kind, action) {
    if (!text) return function () {};
    return window.DS.ui.toast(text, kind, action);
  }
  // "06:00 - midnight", "Open 24 hours" ... (a closing time of 00:00 means midnight, the end of the day)
  function hoursText(open, close) {
    var o = String(open).slice(0, 5), c = String(close).slice(0, 5);
    if (o === "00:00" && c === "00:00") return "Open 24 hours";
    return o + " - " + (c === "00:00" ? "midnight" : c);
  }
  function mediaUrl(path) {
    return path ? sb.storage.from("club-media").getPublicUrl(path).data.publicUrl : "";
  }

  // -------------------------------------------------------------- Turnstile
  function mountCaptcha(container) {
    var h = { token: null, id: null };
    var tries = 0;
    var challengeRetries = 0, retryTimer;
    var dismissCaptchaToast = function () {};
    function showCaptchaError(text) {
      if (!container.isConnected) return;
      dismissCaptchaToast = setMsg(app, text, "err", {
        label: "Retry check",
        run: function () { challengeRetries = 0; h.reset(); }
      }) || function () {};
    }
    var slow;
    function arm() {
      clearTimeout(slow);
      slow = setTimeout(function () {
        if (!h.token) showCaptchaError("The human check is taking longer than expected.");
      }, 20000);
    }
    function wait() {
      if (!container.isConnected) return;
      if (window.turnstile) {
        h.id = window.turnstile.render(container, {
          sitekey: cfg.TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          retry: "never",
          callback: function (t) { h.token = t; challengeRetries = 0; dismissCaptchaToast(); clearTimeout(slow); clearTimeout(retryTimer); },
          "expired-callback": function () { h.token = null; },
          "error-callback": function (code) {
            h.token = null; clearTimeout(slow);
            if (/^(300|600|200)/.test(String(code)) && challengeRetries < 2) {
              challengeRetries++;
              clearTimeout(retryTimer);
              retryTimer = setTimeout(function () { if (container.isConnected) h.reset(); }, challengeRetries * 1500);
              return true;
            }
            showCaptchaError("Human check error" + (code ? " (" + code + ")" : "") + ". Check your connection or disable ad blockers for this site, then retry.");
            return true;
          }
        });
        arm();
      } else if (tries++ < 100) {
        setTimeout(wait, 100);
      } else {
        showCaptchaError("The human check could not load. Check your connection and try again.");
      }
    }
    h.reset = function () {
      h.token = null; clearTimeout(slow); clearTimeout(retryTimer); dismissCaptchaToast();
      if (!container.isConnected) return;
      if (window.turnstile && h.id != null) { window.turnstile.remove(h.id); h.id = null; }
      tries = 0; wait();
    };
    wait();
    return h;
  }

  // ---------------------------------------------------------------- session
  // "I wanted to book at club X": remembered across the email-confirmation / Google redirect so the
  // person lands on the booking page afterwards instead of an empty home page. Expires after a day.
  var PENDING_KEY = "ds_pending_intent";
  function setPending(o) {
    try { o.at = Date.now(); localStorage.setItem(PENDING_KEY, JSON.stringify(o)); } catch (e) { /* storage blocked */ }
  }
  function takePending() {
    try {
      var v = localStorage.getItem(PENDING_KEY);
      if (!v) return null;
      var o = JSON.parse(v);
      return o && Date.now() - o.at < 86400000 && (!o.join || /^[a-z0-9-]+$/.test(o.join)) ? o : null;
    } catch (e) { return null; }
  }
  async function resumePending() {
    if (!state.user) return;
    var o = takePending();
    if (!o) return;
    if (state.isPlatform) { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} return go("/platform"); }
    if (o.as && !state.accountType && !state.managedSlug) { // a Google sign-in cannot carry the account type, so set it now (locked after the first choice)
      var ct = await sb.rpc("choose_account_type", { p_type: o.as });
      if (ct.error) throw ct.error;
      state.accountType = o.as; renderNav();
    }
    if (o.join) {
      var j = await sb.rpc("join_club", { p_slug: o.join, p_display_name: (o.dn || (state.user.email || "").split("@")[0] || "Player").slice(0, 60) });
      if (j.error) throw j.error;
    }
    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
    if (o.next && o.next.charAt(0) === "/") go(o.next);
  }

  var sessionRefresh = null;
  function refreshSession() {
    if (sessionRefresh) return sessionRefresh;
    sessionRefresh = refreshSessionOnce().finally(function () { sessionRefresh = null; });
    return sessionRefresh;
  }
  async function refreshSessionOnce() {
    var r = await sb.auth.getSession();
    state.user = r.data.session ? r.data.session.user : null;
    state.isPlatform = false;
    state.managedSlug = null;
    state.accountType = null;
    state.avatarPath = null;
    if (state.user) {
      // Filter to our own row: a platform admin can read every profile, so maybeSingle() alone would fail.
      var p = await sb.from("profiles").select("is_platform_admin,account_type,avatar_path").eq("auth_user_id", state.user.id).maybeSingle();
      state.isPlatform = !!(p.data && p.data.is_platform_admin);
      state.avatarPath = (p.data && p.data.avatar_path) || null;
      state.accountType = (p.data && p.data.account_type) || null; // 'player' | 'tenant' | null (not chosen yet)
      if (!state.isPlatform) {
        // Club owners and staff go straight to their dashboard instead of a separate account page.
        var m = await sb.from("tenant_members").select("tenants(slug)").eq("user_id", state.user.id).order("created_at").limit(1);
        var row = m.data && m.data[0];
        state.managedSlug = row && row.tenants ? row.tenants.slug : null;
      }
    }
    renderNav();
    if (state.user) await resumePending(); // Complete the redirect before rendering the current route.
  }
  function renderNav() {
    var h = "";
    nav.classList.toggle("member-nav", !!state.user && !state.isPlatform);
    document.body.classList.toggle("sa", !!state.isPlatform);
    if (state.isPlatform) {
      // Super admin has its own chrome: no tenant items (register club, my account).
      nav.innerHTML = '<span class="sa-tag">SUPER ADMIN</span><a href="#/platform">Console</a>' +
        '<a href="#/">Public site</a><span id="bellslot"></span><span class="muted-w">' + esc(state.user.email) + "</span>" +
        '<button id="signout" class="linkbtn">Sign out</button>';
      document.getElementById("signout").onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/"); };
      if (window.DS && window.DS.notify) window.DS.notify.mount();
      return;
    }
    if (state.user) {
      var profileName = (state.user.user_metadata && state.user.user_metadata.full_name) || state.user.email || "Player";
      var initial = profileName.trim().charAt(0).toUpperCase() || "P";
      // Club owners and staff go straight to their dashboard; everyone else keeps My account.
      var acctLabel = state.managedSlug ? "Facility Director" : state.accountType === "tenant" ? "Club Account" : "Player";
      h += '<span id="bellslot" class="dashboard-bellslot"></span>' +
        '<details class="facility-account"><summary aria-label="Account menu"><span class="facility-avatar" data-initial="' + esc(initial) + '">' + (window.DS.avatar.mine() ? '<img src="' + esc(window.DS.avatar.mine()) + '" alt="">' : esc(initial)) + '</span>' +
        '<span class="facility-account-text"><strong>' + esc(profileName) + '</strong><small>' + acctLabel + '</small></span>' +
        '<span class="material-symbols-outlined facility-chevron" aria-hidden="true">expand_more</span></summary>' +
        '<div class="facility-account-menu public-account-menu">' + window.DS.ui.accountMenu({
          title: profileName,
          sub: state.managedSlug ? "Facility Director" : state.accountType === "tenant" ? "Club Account" : "Player",
          slug: state.managedSlug
        }, "signout") + '</div></details>' +
        (state.managedSlug || state.accountType === "player" ? "" : '<a href="#/register-club" class="pill nav-register"><span class="material-symbols-outlined" aria-hidden="true">add</span><span>Register club</span></a>');
    } else {
      var authHash = (location.hash || "").slice(1);
      var authPath = authHash.split("?")[0];
      var authParams = new URLSearchParams(authHash.indexOf("?") < 0 ? "" : authHash.slice(authHash.indexOf("?") + 1));
      var authIcon = function (name) { return '<span class="material-symbols-outlined" aria-hidden="true">' + name + '</span>'; };
      if (authPath === "/auth") {
        var isSignup = authParams.get("mode") === "up";
        authParams.set("mode", isSignup ? "in" : "up");
        h += '<a class="auth-nav-switch" href="#/auth?' + esc(authParams.toString()) + '">' + authIcon(isSignup ? "login" : "person_add") + '<span>' + (isSignup ? "Sign in" : "Create account") + '</span></a>';
      } else if (authPath === "/register-club") {
        h += '<a class="auth-nav-switch" href="#/auth?mode=in&next=%2Fregister-club">' + authIcon("login") + '<span>Sign in</span></a>' +
          '<a class="auth-nav-switch" href="#/auth?mode=up">' + authIcon("person_add") + '<span>Create account</span></a>';
      } else {
        h += '<a class="auth-nav-switch" href="#/auth?mode=in">' + authIcon("login") + '<span>Sign in</span></a>';
      }
      if (authPath !== "/register-club") h += '<a href="#/register-club" class="pill mobile-icon-nav" aria-label="Register your club" title="Register your club"><span class="material-symbols-outlined" aria-hidden="true">add</span><span>Register your club</span></a>';
    }
    nav.innerHTML = h;
    nav.querySelectorAll('.auth-nav-switch').forEach(function (link) {
      var label = link.querySelector('span:last-child');
      if (label) { link.setAttribute('aria-label', label.textContent); link.title = label.textContent; }
    });
    var accountMenu = nav.querySelector(".facility-account");
    if (accountMenu) {
      accountMenu.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { accountMenu.open = false; accountMenu.querySelector("summary").focus(); }
      });
      accountMenu.addEventListener("focusout", function (event) { if (!accountMenu.contains(event.relatedTarget)) accountMenu.open = false; });
      accountMenu.querySelectorAll("a").forEach(function (link) { link.onclick = function () { accountMenu.open = false; }; });
    }
    var so = document.getElementById("signout");
    if (so) so.onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/"); };
    if (window.DS && window.DS.notify) window.DS.notify.mount(); // bell (or clean up when signed out)
  }
  // Where a signed-in person belongs.
  function homePath() {
    if (state.isPlatform) return "/platform";
    if (state.managedSlug) return "/admin/" + state.managedSlug;
    if (state.accountType === "tenant") return "/club-setup"; // club account that still has to add its club
    return "/me";
  }
  function requireUser(next) {
    if (state.user) return true;
    go("/auth?next=" + encodeURIComponent(next));
    return false;
  }

  // ------------------------------------------------------------------ views
  async function viewHome() {
    var fallbackImages = ["assets/landing-court.jpg", "https://lh3.googleusercontent.com/aida-public/AB6AXuDa-S4ZZLLHmDYjKc8jdOeivM48hq2Qj2IqFuRxX2hADLZf5dpoz_DzwkjANk85daWcgZKSX1cffRITeTLxzyjSsjNlO1Bqz_tgV4j4U6poyMx0TQPg8_yyefZEeoJTy72ReeAY9qFY1iO-YZi4GFAuAxUlxggfu_u3G1iXveA0waHB6wpajCG39pvud6Emlh1fLyERceM6GY6GWbYQkiHSA9iPFl9a2VFe05ZWoBM", "https://lh3.googleusercontent.com/aida-public/AB6AXuBGSaPhy8orPp4MmLU3UD1NAkEuv79MCKLmSqux31YkuqHjdJDO2Siblof4trUQnf9-Q5xI2ZUm6A55A3VlOclA1NJQVbPOs0ZEwbKHu92YIqANJlYhfpj9dszyZVYixENabP05CJAkqj4CK8meuL-94T-WvSTZiAdf_k7jg1U2tnkt5lwRCTuKBOYnKPZQnpe7SHAZmoRGtDrJMogZM7Uu9X3ORmH_aD3-r5w_pf4", "https://lh3.googleusercontent.com/aida-public/AB6AXuATvYY4K5iAfE5lS_suDm_W8wbLn-XYQRWEKVNVsajW4P1gcSGGc6DkVSbltkjSd3eOy6R8Pfbgqtbam8L2-lL97ZZq8jIm0RY8nOlK8wPokMfv4Uu3l8fNc3f0ikHRcFcr1qP7R6rFo7L4efLsPVkl6WeGh3ZJNAJoZXSK_WqcZ27qwuRAYMnc2HWUiZOCCfp3s7dzU3KKaXgpUC81F__IMMJSKPGUsDO_WcXD7dc"];
    document.body.classList.add("landing-page");
    app.innerHTML = window.DINKSLOT_LANDING;
    if (cleanupAuthPattern) cleanupAuthPattern();
    var sectionPatterns = Array.from(app.querySelectorAll("#ds-landing > section")).map(function (section) {
      return mountAuthPattern(section);
    });
    cleanupAuthPattern = function () { sectionPatterns.forEach(function (cleanup) { cleanup(); }); };
    app.querySelectorAll('a[href="#clubs-section"]').forEach(function (link) {
      link.onclick = function (event) { event.preventDefault(); $("#clubs-section").scrollIntoView({ behavior: "smooth" }); };
    });

    var r = await sb.from("public_clubs").select("*").order("name");
    if (!$("#ds-landing")) return;
    var clubs = r.data || [];
    var cr = (await sb.from("public_courts").select("club_slug,hourly_rate,rate_min,is_indoor,surface")).data || [];
    var info = {};
    cr.forEach(function (c) {
      var i = info[c.club_slug] || (info[c.club_slug] = { n: 0, min: Infinity, indoor: 0, outdoor: 0, surfaces: [] });
      i.n++;
      i.min = Math.min(i.min, Number(c.rate_min != null ? c.rate_min : c.hourly_rate));
      if (c.is_indoor) i.indoor++; else i.outdoor++;
      if (c.surface && i.surfaces.indexOf(c.surface) === -1) i.surfaces.push(c.surface);
    });
    if (!$("#ds-landing")) return;
    function cityKey(value) { return String(value || "").trim().replace(/\s+/g, " ").toLowerCase(); }
    var cityNames = new Map();
    clubs.forEach(function (club) {
      var name = String(club.city || "").trim().replace(/\s+/g, " ");
      if (name && !cityNames.has(cityKey(name))) cityNames.set(cityKey(name), name);
    });
    var cities = Array.from(cityNames.values()).sort(function (a,b) { return a.localeCompare(b); });
    var cityEl = $("#city"), cityMenu = $(".city-menu");
    if (cityMenu) {
      cityMenu.querySelector(".city-options").innerHTML = [''].concat(cities).map(function (city) {
        return '<button type="button" data-city="' + esc(cityKey(city)) + '" aria-pressed="' + String(!city) + '">' + esc(city || "All Cities") + '</button>';
      }).join("");
      cityMenu.querySelectorAll("[data-city]").forEach(function (option) {
        option.onclick = function () {
          cityEl.value = option.getAttribute("data-city");
          cityMenu.querySelector(".city-selected").textContent = option.textContent;
          cityMenu.querySelectorAll("[data-city]").forEach(function (item) { item.setAttribute("aria-pressed", String(item === option)); });
          cityMenu.open = false; cityMenu.querySelector("summary").focus();
          if (cityEl.onchange) cityEl.onchange();
        };
      });
      cityMenu.onkeydown = function (event) {
        if (event.key === "Escape") { cityMenu.open = false; cityMenu.querySelector("summary").focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); cityMenu.open = true;
          var options = Array.from(cityMenu.querySelectorAll("[data-city]"));
          var index = options.indexOf(document.activeElement);
          options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
        }
      };
      cityMenu.onfocusout = function (event) { if (!cityMenu.contains(event.relatedTarget)) cityMenu.open = false; };
    }

    var surfaceFilter = "all";

    function draw() {
      var qEl = $("#q");
      var q = qEl ? qEl.value.trim().toLowerCase() : "";
      var city = cityEl ? cityEl.value : "";
      var list = clubs.filter(function (c) {
        var i = info[c.slug];
        var matchText = (!city || cityKey(c.city) === city) && (!q || (c.name + " " + (c.city || "") + " " + (c.address || "")).toLowerCase().indexOf(q) !== -1);
        if (!matchText) return false;
        if (surfaceFilter === "indoor") return !!(i && i.indoor > 0);
        if (surfaceFilter === "outdoor") return !!(i && i.outdoor > 0);
        return true;
      });
      var ccount = $("#ccount");
      if (ccount) {
        if (list.length > 0) {
          ccount.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span><span>' + list.length + (list.length === 1 ? ' club available now' : ' clubs available now') + '</span>';
        } else {
          ccount.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-error"></span><span>0 clubs matching current filters</span>';
        }
      }
      var grid = $("#grid");
      if (!grid) return;
      if (list.length) {
        grid.innerHTML = list.map(function (c, idx) {
          var i = info[c.slug];
          var coverSrc = c.cover_path ? mediaUrl(c.cover_path) : fallbackImages[idx % fallbackImages.length];
          var courtLabel = i
            ? i.n + (i.n === 1 ? " Court" : " Courts") + " (" + (i.indoor > 0 ? "Indoor" : "Outdoor") + (i.surfaces.length ? " • " + i.surfaces[0] : "") + ")"
            : "Court schedule open";
          var priceHtml = i && isFinite(i.min)
            ? '<span class="font-headline-sm text-on-surface">PHP ' + esc(i.min.toFixed(0)) + '</span><span class="font-label-sm text-outline">/hr</span>'
            : '<span class="font-label-sm text-outline">View rates</span>';

          return '<article class="group flex flex-col rounded-2xl bg-surface-container-high overflow-hidden shadow-lg hover:shadow-[0_0_24px_rgba(163,230,53,0.15)] transition-all duration-300">' +
            '<a href="#/c/' + esc(c.slug) + '" class="relative h-48 w-full overflow-hidden bg-surface-container block no-underline">' +
              '<img src="' + esc(coverSrc) + '" alt="' + esc(c.name) + '" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>' +
              '<div class="absolute top-3 left-3 px-space-sm py-1 rounded-full bg-surface-container-lowest/80 backdrop-blur-md font-label-sm text-label-sm text-primary font-semibold flex items-center gap-1">' +
                '<span class="w-1.5 h-1.5 rounded-full bg-primary"></span> ' + esc(i ? i.n + (i.n === 1 ? " Pro Court" : " Pro Courts") : "12 Pro Courts") +
              '</div>' +
              '<div class="absolute top-3 right-3 px-space-sm py-1 rounded-full bg-surface-container-lowest/80 backdrop-blur-md font-label-sm text-label-sm text-on-surface flex items-center gap-1">' +
                '<span class="material-symbols-outlined text-primary text-label-sm" style="font-variation-settings: \'FILL\' 1;">star</span> 4.9' +
              '</div>' +
            '</a>' +
            '<div class="p-space-lg flex flex-col flex-1 justify-between gap-space-md">' +
              '<div>' +
                '<div class="flex items-center gap-1 text-on-surface-variant font-label-sm text-label-sm">' +
                  '<span class="material-symbols-outlined text-label-md">pin_drop</span> ' + esc([c.city, c.province].filter(Boolean).join(", ") || c.address || "Metro Manila") +
                '</div>' +
                '<h3 class="font-headline-sm text-headline-sm text-on-surface font-bold mt-1 group-hover:text-primary transition-colors">' +
                  '<a href="#/c/' + esc(c.slug) + '" class="text-inherit no-underline">' + esc(c.name) + '</a>' +
                '</h3>' +
                '<div class="mt-space-sm flex items-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm">' +
                  '<span class="material-symbols-outlined text-primary text-label-md">schedule</span> ' + esc(courtLabel) +
                '</div>' +
              '</div>' +
              '<div class="pt-space-md flex items-center justify-between border-t border-outline-variant/20">' +
                '<div>' + priceHtml + '</div>' +
                '<a href="#/c/' + esc(c.slug) + '" class="px-space-md py-2 rounded-full bg-primary hover:bg-secondary-fixed text-on-primary font-label-md text-label-md font-bold transition-all shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline">' +
                  'Instant Book' +
                '</a>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join("");
      } else {
        grid.innerHTML = '<div class="col-span-full py-16 px-6 sm:px-10 rounded-3xl bg-surface-container-low/70 border border-outline-variant/30 flex flex-col items-center justify-center text-center my-6 shadow-2xl backdrop-blur-md max-w-2xl mx-auto w-full">' +
          '<div class="relative w-20 h-20 rounded-3xl bg-surface-container-high border border-outline-variant/40 flex items-center justify-center text-primary mb-5 shadow-[0_0_30px_rgba(163,230,53,0.15)]">' +
            '<span class="material-symbols-outlined text-4xl">sports_tennis</span>' +
            '<span class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-surface-container-lowest border border-outline-variant/40 flex items-center justify-center text-on-surface-variant">' +
              '<span class="material-symbols-outlined text-xs">search_off</span>' +
            '</span>' +
          '</div>' +
          '<h3 class="font-headline-md text-xl font-bold text-on-surface mb-2">No Matching Pickleball Clubs</h3>' +
          '<p class="font-body-md text-sm text-on-surface-variant max-w-md leading-relaxed mb-6">' +
            'We couldn\'t find any venues matching your current filters. Try switching between indoor/outdoor courts, or reset to view all clubs across all cities.' +
          '</p>' +
          '<div class="flex flex-wrap items-center justify-center gap-3">' +
            '<button type="button" id="clear-filters-btn" class="px-6 py-3 rounded-full bg-primary hover:bg-secondary-fixed text-on-primary font-bold text-xs tracking-wider uppercase transition-all shadow-[0_0_20px_rgba(163,230,53,0.3)] border-0 cursor-pointer flex items-center gap-2">' +
              '<span class="material-symbols-outlined text-base">refresh</span>' +
              '<span>Show All Clubs</span>' +
            '</button>' +
            '<a href="#/register-club" class="px-6 py-3 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface font-semibold text-xs tracking-wider uppercase transition-all border border-outline-variant/30 no-underline flex items-center gap-2">' +
              '<span class="material-symbols-outlined text-base">add_business</span>' +
              '<span>Register a Facility</span>' +
            '</a>' +
          '</div>' +
        '</div>';

        var clearBtn = grid.querySelector("#clear-filters-btn");
        if (clearBtn) {
          clearBtn.onclick = function () {
            surfaceFilter = "all";
            if (qEl) qEl.value = "";
            if (cityEl) cityEl.value = "";
            var cityMenu = $("#city-menu");
            if (cityMenu) {
              var sel = cityMenu.querySelector(".city-selected");
              if (sel) sel.textContent = "All cities";
              cityMenu.querySelectorAll("[data-city]").forEach(function (item) {
                item.setAttribute("aria-pressed", String(item.getAttribute("data-city") === ""));
              });
            }
            document.querySelectorAll(".club-tab").forEach(function (b) {
              b.setAttribute("aria-pressed", String((b.getAttribute("data-tab") || "all") === "all"));
            });
            draw();
          };
        }
      }
    }

    var qInput = $("#q");
    if (qInput) qInput.oninput = draw;
    if (cityEl) cityEl.onchange = draw;
    var findBtn = $("#find-courts-btn");
    if (findBtn) {
      findBtn.onclick = function () {
        draw();
        var sec = document.getElementById("clubs-section");
        if (sec) sec.scrollIntoView({ behavior: "smooth" });
      };
    }
    document.querySelectorAll(".surf-pill").forEach(function (btn) {
      btn.onclick = function () {
        surfaceFilter = btn.getAttribute("data-filter") || "all";
        document.querySelectorAll(".surf-pill").forEach(function (b) {
          var active = (b.getAttribute("data-filter") === surfaceFilter);
          b.className = active
            ? "surf-pill px-3 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-label-sm transition-colors cursor-pointer"
            : "surf-pill px-3 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant font-label-sm transition-colors border-0 cursor-pointer";
        });
        document.querySelectorAll(".club-tab").forEach(function (b) {
          b.setAttribute("aria-pressed", String((b.getAttribute("data-tab") || "all") === surfaceFilter));
        });
        draw();
      };
    });
    document.querySelectorAll(".club-tab").forEach(function (btn) {
      btn.onclick = function () {
        var tab = btn.getAttribute("data-tab") || "all";
        surfaceFilter = (tab === "indoor" || tab === "outdoor") ? tab : "all";
        document.querySelectorAll(".club-tab").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        document.querySelectorAll(".surf-pill").forEach(function (b) {
          var active = (b.getAttribute("data-filter") === surfaceFilter);
          b.className = active
            ? "surf-pill px-3 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-label-sm transition-colors cursor-pointer"
            : "surf-pill px-3 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant font-label-sm transition-colors border-0 cursor-pointer";
        });
        draw();
      };
    });
    if (r.error) setMsg(app, "Club listings could not load. Please try again shortly.", "err");
    draw();
  }

  async function viewClub(slug) {
    app.innerHTML = '<div class="pubwrap">' +
      '<div class="h-44 sm:h-64 w-full rounded-2xl bg-surface-container-high/60 ds-skeleton mb-6"></div>' +
      '<div class="flex items-center gap-4 mb-8">' +
        '<div class="w-16 h-16 rounded-2xl bg-surface-container-high/60 ds-skeleton shrink-0"></div>' +
        '<div class="flex flex-col gap-2 flex-1">' +
          '<div class="h-6 w-48 bg-surface-container-high/70 rounded-lg ds-skeleton"></div>' +
          '<div class="h-4 w-72 bg-surface-container-high/40 rounded ds-skeleton"></div>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">' +
        '<div class="h-40 rounded-xl bg-surface-container-low border border-outline-variant/20 ds-skeleton"></div>' +
        '<div class="h-40 rounded-xl bg-surface-container-low border border-outline-variant/20 ds-skeleton"></div>' +
        '<div class="h-40 rounded-xl bg-surface-container-low border border-outline-variant/20 ds-skeleton"></div>' +
      '</div></div>';
    var r = await sb.from("public_clubs").select("*").eq("slug", slug).maybeSingle();
    var c = r.data;
    if (!c) { app.innerHTML = '<div class="pubwrap"><h2>Club not found</h2><p>This club does not exist or is not approved yet.</p><a class="btn" href="#/">Back to clubs</a></div>'; return; }
    var courts = (await sb.from("public_courts").select("*").eq("club_slug", slug).order("name")).data || [];
    // earliest opening to latest closing; a closing time of 00:00 means midnight (end of day)
    var hrs = "";
    if (courts.length) {
      var toM = function (t) { var x = String(t).slice(0, 5).split(":"); return +x[0] * 60 + +x[1]; };
      var fm = function (m) { return (m < 600 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60); };
      var om = Math.min.apply(null, courts.map(function (k) { return toM(k.open_time); }));
      var cm = Math.max.apply(null, courts.map(function (k) { return toM(k.close_time) === 0 ? 1440 : toM(k.close_time); }));
      hrs = om === 0 && cm === 1440 ? "Open 24 hours" : fm(om) + " - " + (cm === 1440 ? "midnight" : fm(cm));
    }
    return renderClubPage(c, courts, hrs);
  }

  // Public club page: venue hero, live per-day availability for every court, and a quick path into booking.
  // Availability comes from court_availability (taken/blocked time only) and court_slot_rates; the database
  // still decides everything when the player actually books.
  function renderClubPage(c, courts, hrs) {
    var slug = c.slug, tz = c.timezone || "Asia/Manila";
    var B = window.DS.booking;
    var DAYS = 7;
    var S = { day: 0, dur: 60, sel: {}, taken: {}, rates: {} };
    var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
    var hm = function (t) { var x = String(t).slice(0, 5).split(":"); return +x[0] * 60 + +x[1]; };
    var closeM = function (k) { var m = hm(k.close_time); return m === 0 ? 1440 : m; };
    var money = function (n) { return "PHP " + Number(n).toFixed(2); };
    var today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    var addDays = function (ymd, n) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    var dates = []; for (var i = 0; i < DAYS; i++) dates.push(addDays(today, i));
    var toUtc = function (ymd, m) { return B.zonedToUtc(ymd + "T" + pad2(Math.floor(m / 60)) + ":" + pad2(m % 60), tz); };
    var timeLabel = function (d) { return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); };
    var dayLabel = function (i) {
      if (i === 0) return "Today";
      if (i === 1) return "Tomorrow";
      return new Date(dates[i] + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
    };
    var dateLabel = function (i) { return new Date(dates[i] + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); };

    // Every start time on a court for one date, marked unavailable when past, taken, or too short for the chosen length.
    function slotsFor(k, ymd) {
      var step = k.slot_minutes, need = Math.max(1, Math.ceil(S.dur / step)), endM = closeM(k), now = Date.now(), out = [];
      var taken = S.taken[k.id] || [], rates = (S.rates[k.id] || {})[ymd] || {};
      for (var m = hm(k.open_time); m + step <= endM; m += step) {
        var s = toUtc(ymd, m), e = new Date(s.getTime() + step * 60000);
        out.push({ m: m, s: s, e: e, rate: rates[m], busy: s.getTime() <= now || taken.some(function (t) { return t[0] < e && t[1] > s; }) });
      }
      out.forEach(function (x, idx) {
        x.off = idx + need > out.length;
        for (var j = idx; !x.off && j < idx + need; j++) if (out[j].busy) x.off = true;
      });
      return out;
    }
    function openCount(ymd) {
      return courts.reduce(function (n, k) { return n + slotsFor(k, ymd).filter(function (x) { return !x.off; }).length; }, 0);
    }
    function bookHref(k, m) {
      var p = "/c/" + slug + "/book";
      if (k) {
        p += "?court=" + encodeURIComponent(k.id) + "&date=" + dates[S.day] + "&len=" + S.dur;
        if (m != null) p += "&start=" + m;
      }
      return state.user ? "#" + p : "#/auth?mode=up&join=" + encodeURIComponent(slug) + "&next=" + encodeURIComponent(p);
    }
    var signInHref = "#/auth?mode=in&join=" + encodeURIComponent(slug) + "&next=" + encodeURIComponent("/c/" + slug + "/book");

    var address = [c.address, c.city, c.province].filter(Boolean).join(", ") + (c.zip_code ? " " + c.zip_code : "");
    var mapHref = c.latitude != null && c.longitude != null
      ? "https://www.google.com/maps/search/?api=1&query=" + c.latitude + "," + c.longitude
      : (address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.name + ", " + address) : "");
    var surfaces = courts.map(function (k) { return k.surface; }).filter(function (v, idx, a) { return v && a.indexOf(v) === idx; });
    var nIn = courts.filter(function (k) { return k.is_indoor; }).length, nOut = courts.length - nIn;
    var setting = !courts.length ? "" : nIn && nOut ? "Indoor & Outdoor" : nIn ? "Indoor" : "Outdoor";
    var courtWord = courts.length + (courts.length === 1 ? " Court" : " Courts");
    var steps = courts.map(function (k) { return k.slot_minutes; }).filter(function (v, idx, a) { return a.indexOf(v) === idx; });
    var stepText = steps.length === 1 ? steps[0] + " min slots" : "Flexible slot lengths";
    var tiered = courts.some(function (k) { return k.rate_max != null && Number(k.rate_max) > Number(k.rate_min); });

    var badge = function (icon, iconCls, text) {
      return '<span class="backdrop-blur-md bg-black/60 text-white text-xs font-semibold px-3 py-1.5 rounded-[8px] border border-white/10 flex items-center gap-1.5 shadow-lg">' +
        '<i class="fa-solid ' + icon + " " + iconCls + '" aria-hidden="true"></i> ' + esc(text) + "</span>";
    };
    var pill = function (icon, tone, label, valueHtml, title) {
      return '<div class="club-fact-card flex items-center gap-3 p-3 rounded-[12px] bg-dink-surfaceLight/60 border border-dink-border min-w-0">' +
        '<div class="club-fact-icon w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0"><i class="' + icon + '" aria-hidden="true"></i></div>' +
        '<div class="min-w-0"><p class="text-[11px] text-slate-400 font-medium">' + label + '</p><div class="text-slate-200 font-semibold truncate"' +
        (title ? ' title="' + esc(title) + '"' : "") + ">" + valueHtml + "</div></div></div>";
    };
    var phoneDigits = String(c.contact_phone || "").replace(/[^\d+]/g, "");
    var contactPill = c.contact_phone
      ? pill("fa-solid fa-phone", "bg-blue-500/10 text-blue-400", "Phone Support", '<a class="hover:text-dink-lime transition font-label-md" href="tel:' + esc(phoneDigits) + '">' + esc(c.contact_phone) + "</a>")
      : c.contact_email
        ? pill("fa-solid fa-envelope", "bg-blue-500/10 text-blue-400", "Email", '<a class="hover:text-dink-lime transition" href="mailto:' + esc(c.contact_email) + '">' + esc(c.contact_email) + "</a>", c.contact_email)
        : pill("fa-solid fa-phone", "bg-blue-500/10 text-blue-400", "Phone Support", '<span class="text-slate-500">Not listed</span>');

    var logo = c.logo_path
      ? '<img src="' + esc(mediaUrl(c.logo_path)) + '" alt="' + esc(c.name) + ' logo" class="w-full h-full object-cover">'
      : '<div class="flex flex-col items-center justify-center p-2 text-center"><i class="fa-solid fa-table-tennis-paddle-ball text-3xl text-dink-pinkAccent mb-1" aria-hidden="true"></i>' +
        '<span class="text-2xl font-extrabold uppercase text-dink-lime leading-tight font-display">' + esc(c.name.charAt(0).toUpperCase()) + "</span></div>";

    app.innerHTML =
      '<div id="club-profile-stage"><div id="ds-club-page" class="club-public w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 text-slate-100">' +
      // breadcrumbs
      '<section class="club-page-context pt-6 pb-2"><div class="flex items-center justify-between flex-wrap gap-3">' +
        '<nav class="club-breadcrumb" aria-label="Breadcrumb">' +
          '<a class="club-back-link" href="#/"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>All clubs</span></a>' +
          '<ol class="club-breadcrumb-trail">' +
          (c.province || c.city ? '<li class="club-breadcrumb-location"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>' + esc(c.province || c.city) + '</span></li><li class="club-breadcrumb-separator" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></li>' : "") +
          '<li class="club-breadcrumb-current" aria-current="page">' + esc(c.name) + '</li></ol>' +
        "</nav>" +
        '<div class="flex items-center gap-2">' +
          '<span class="club-live-badge inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Live Availability</span>' +
          '<button type="button" id="club-share" class="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-md bg-dink-surface border border-dink-border hover:border-slate-600 transition flex items-center gap-1.5"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> Share</button>' +
        "</div></div></section>" +
      '<div class="space-y-8">' +
      // hero
      '<section class="mt-3 bg-dink-surface rounded-2xl border border-dink-border overflow-hidden shadow-2xl relative">' +
        '<div class="relative h-64 sm:h-80 md:h-96 w-full overflow-hidden bg-slate-900">' +
          (c.cover_path
            ? '<img alt="' + esc(c.name) + ' courts" class="w-full h-full object-cover object-center brightness-95 contrast-105" src="' + esc(mediaUrl(c.cover_path)) + '">'
            : '<div class="w-full h-full bg-[radial-gradient(circle_at_20%_20%,rgba(163,230,53,.18),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(236,72,153,.14),transparent_45%)]"></div>') +
          '<div class="absolute inset-0 bg-gradient-to-t from-dink-surface via-dink-surface/40 to-transparent"></div>' +
          '<div class="absolute top-4 left-4 sm:left-6 right-4 flex flex-wrap items-center gap-2">' +
            (surfaces.length ? badge("fa-layer-group", "text-dink-lime", surfaces.join(" / ")) : "") +
            (setting ? badge("fa-table-tennis-paddle-ball", "text-dink-pinkAccent", setting + " Courts") : "") +
            (hrs ? '<span class="backdrop-blur-md bg-emerald-950/80 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-[8px] border border-emerald-500/30 flex items-center gap-1.5 shadow-lg"><i class="fa-solid fa-clock" aria-hidden="true"></i> Hours: ' + esc(hrs) + "</span>" : "") +
          "</div>" +
        "</div>" +
        '<div class="px-6 pb-6 pt-0 relative -mt-16 sm:-mt-20">' +
          '<div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6">' +
            '<div class="flex flex-col sm:flex-row items-start sm:items-end gap-5 min-w-0">' +
              '<div class="relative shrink-0"><div class="club-profile-frame w-24 h-24 sm:w-28 sm:h-28">' +
                '<div class="club-profile-image w-full h-full flex items-center justify-center overflow-hidden">' + logo + "</div></div>" +
                '<span class="absolute bottom-1 right-1 w-5 h-5 bg-dink-lime rounded-full border-2 border-dink-surface flex items-center justify-center text-[10px] text-black font-bold" title="Verified venue"><i class="fa-solid fa-check" aria-hidden="true"></i></span></div>' +
              '<div class="space-y-1.5 min-w-0">' +
                '<div class="flex flex-wrap items-center gap-3"><h1 class="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-display m-0">' + esc(c.name) + "</h1>" +
                  '<span class="bg-dink-lime/10 text-dink-lime border border-dink-lime/30 text-xs px-2.5 py-0.5 rounded-md font-semibold flex items-center gap-1"><i class="fa-solid fa-shield-halved text-[10px]" aria-hidden="true"></i> Verified Club</span></div>' +
                '<div class="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-slate-300">' +
                  (c.city ? '<span class="flex items-center gap-1.5 text-slate-300"><i class="fa-solid fa-location-dot text-dink-lime text-xs" aria-hidden="true"></i>' + esc(c.city) + "</span><span class=\"text-slate-500\">&bull;</span>" : "") +
                  '<span class="text-dink-lime font-medium">' + courtWord + (setting ? " &bull; " + esc(setting) : "") + "</span>" +
                "</div>" +
              "</div>" +
            "</div>" +
            '<div class="club-booking-actions flex flex-col gap-2 self-stretch lg:self-end lg:items-end">' +
              '<div class="club-booking-buttons flex flex-wrap sm:flex-nowrap items-center gap-3">' +
                '<a class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-[12px] font-bold text-black bg-dink-lime hover:bg-dink-limeHover active:scale-95 transition font-display text-sm uppercase tracking-wider no-underline" href="#club-courts" data-scroll="club-courts">' +
                  '<i class="fa-solid fa-bolt-lightning text-sm" aria-hidden="true"></i>' + (state.user ? "Book a court" : "Sign up to book") + "</a>" +
                '<button type="button" data-scroll="club-dates" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-[12px] font-semibold text-slate-200 bg-dink-surfaceLight hover:bg-slate-700/80 border border-dink-border hover:border-slate-500 transition text-sm">' +
                  '<i class="fa-solid fa-calendar-check text-slate-400" aria-hidden="true"></i>Court Schedule</button>' +
              "</div>" +
              (state.user ? "" : '<div class="club-account-prompt"><a class="club-account-signin" href="#/c/' + esc(slug) + '/book?guest=1">Book as Guest</a><span class="club-account-returning">Already registered? <a class="club-account-signin" href="' + signInHref + '">Sign in<span aria-hidden="true"> &rarr;</span></a></span></div>') +
            "</div>" +
          "</div>" +
          '<div class="mt-6 pt-5 border-t border-dink-border/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">' +
            pill("fa-solid fa-location-dot", "bg-dink-lime/10 text-dink-lime", "Address",
              address ? (mapHref ? '<a class="hover:text-dink-lime transition" href="' + esc(mapHref) + '" target="_blank" rel="noopener">' + esc(address) + "</a>" : esc(address)) : '<span class="text-slate-500">Not listed</span>', address) +
            contactPill +
            pill("fa-regular fa-clock", "bg-purple-500/10 text-purple-400", "Operating Hours", hrs ? esc(hrs) + " (Daily)" : '<span class="text-slate-500">Not listed</span>') +
            pill("fa-solid fa-table-tennis-paddle-ball", "bg-pink-500/10 text-pink-400", "Capacity &amp; Surface", esc(courtWord + (surfaces.length ? " \u2022 " + surfaces.join(", ") : setting ? " \u2022 " + setting : ""))) +
          "</div>" +
        "</div>" +
      "</section>" +
      // date + duration strip
      (courts.length ? '<section id="club-dates" class="bg-dink-surface p-5 rounded-2xl border border-dink-border shadow-md space-y-4 scroll-mt-20">' +
        '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">' +
          '<div><h2 class="text-lg font-bold text-white font-display flex items-center gap-2 m-0"><i class="fa-solid fa-calendar-days text-dink-lime" aria-hidden="true"></i> Select Booking Date &amp; Slot</h2>' +
            '<p class="text-xs text-slate-400 m-0">' + esc(courtWord + " \u2022 " + stepText + " \u2022 Times in " + tz) + "</p></div>" +
          '<div class="flex items-center gap-2" role="group" aria-label="Booking length"><span class="text-xs text-slate-400 font-medium mr-1">Duration:</span>' +
            [60, 120].map(function (d) { return '<button type="button" data-dur="' + d + '" aria-pressed="false" class="club-dur px-3 py-1.5 rounded-[8px] text-xs transition">' + (d / 60) + (d === 60 ? " Hour" : " Hours") + "</button>"; }).join("") +
          "</div>" +
        "</div>" +
        '<div id="club-daystrip" class="flex items-center gap-2.5 overflow-x-auto pb-2 pt-3 border-t border-dink-border/60"></div>' +
      "</section>" : "") +
      // courts
      '<section id="club-courts" class="space-y-4 scroll-mt-20">' +
        '<div class="flex items-center justify-between flex-wrap gap-3"><div><h2 class="text-2xl font-bold text-white font-display m-0">Courts Available</h2>' +
          '<p id="club-avail-note" class="text-xs text-slate-400 m-0"></p></div>' +
          (courts.length ? '<div class="court-availability-legend" aria-label="Court availability legend"><span class="court-legend-badge available"><span class="court-legend-dot" aria-hidden="true"></span>Available</span>' +
            '<span class="court-legend-badge booked"><span class="court-legend-dot" aria-hidden="true"></span>Booked</span>' +
            (tiered ? '<span class="court-legend-badge peak"><span class="material-symbols-outlined" aria-hidden="true">bolt</span>Peak Rate</span>' : "") + "</div>" : "") +
        "</div>" +
        (courts.length ? '<div id="club-courtgrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>'
          : '<div class="bg-dink-surface rounded-2xl border border-dink-border p-8 text-center text-slate-400"><i class="fa-solid fa-table-tennis-paddle-ball text-2xl text-slate-600 mb-2" aria-hidden="true"></i><p class="m-0">This club has not listed its courts yet.</p></div>') +
      "</section>" +
      // about + booking info
      '<section class="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">' +
        '<div class="lg:col-span-2 bg-dink-surface p-6 rounded-2xl border border-dink-border shadow-md">' +
          '<h3 class="text-lg font-bold text-white font-display mb-4 flex items-center gap-2"><i class="fa-solid fa-circle-info text-dink-lime" aria-hidden="true"></i> About ' + esc(c.name) + "</h3>" +
          (c.description ? '<p class="text-sm text-slate-300 leading-relaxed whitespace-pre-line m-0">' + esc(c.description) + "</p>"
            : '<p class="text-sm text-slate-300 leading-relaxed m-0">' + esc(c.name + (c.city ? " is located in " + [c.city, c.province].filter(Boolean).join(", ") : "") + "." + (courts.length ? " Explore " + courtWord.toLowerCase() + (setting ? " for " + setting.toLowerCase() + " play" : "") + " and choose an available time above." : " Contact the club for court availability.")) + "</p>") +
          '<div class="club-about-details grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">' +
            (courts.length ? [["fa-table-tennis-paddle-ball", courtWord, setting ? setting + " play" : "Pickleball"],
             ["fa-layer-group", surfaces.length ? surfaces.join(", ") : "Court surface", surfaces.length ? "Playing surface" : "Ask the club"],
             ["fa-clock", hrs || "Hours vary", stepText]] : []).concat([
             ["fa-location-dot", address || "Not provided", "Address", mapHref],
             ["fa-phone", c.contact_phone || "Not provided", "Phone support", phoneDigits ? "tel:" + phoneDigits : ""],
             ["fa-envelope", c.contact_email || "Not provided", "Email", c.contact_email ? "mailto:" + c.contact_email : ""]
            ]).map(function (a) {
              return '<div class="p-3.5 rounded-[12px] bg-dink-surfaceLight border border-dink-border flex items-start gap-3"><div class="text-dink-lime text-base mt-0.5"><i class="fa-solid ' + a[0] + '" aria-hidden="true"></i></div>' +
                '<div class="min-w-0"><p class="club-about-value text-xs font-bold text-white m-0" title="' + esc(a[1]) + '">' + (a[3] ? '<a href="' + esc(a[3]) + '" class="hover:text-dink-lime transition"' + (a[0] === "fa-location-dot" ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a[1]) + '</a>' : esc(a[1])) + '</p><p class="text-[11px] text-slate-400 m-0">' + esc(a[2]) + "</p></div></div>";
            }).join("") + "</div>" +
        "</div>" +
        '<div class="bg-dink-surface p-6 rounded-2xl border border-dink-border shadow-md">' +
          '<h3 class="text-lg font-bold text-white font-display mb-4 flex items-center gap-2"><i class="fa-solid fa-circle-exclamation text-dink-lime" aria-hidden="true"></i> Before You Book</h3>' +
          '<ul class="space-y-3 text-xs text-slate-300 list-none p-0 m-0">' +
            '<li class="flex items-start gap-2.5"><i class="fa-solid fa-user-check text-dink-lime mt-0.5" aria-hidden="true"></i><span><strong>Booking:</strong> Sign in or book as a guest.</span></li>' +
            '<li class="flex items-start gap-2.5"><i class="fa-solid fa-earth-asia text-dink-lime mt-0.5" aria-hidden="true"></i><span><strong>Time zone:</strong> All times are shown in ' + esc(tz) + ".</span></li>" +
            (tiered ? '<li class="flex items-start gap-2.5"><i class="fa-solid fa-tags text-dink-lime mt-0.5" aria-hidden="true"></i><span><strong>Pricing:</strong> Rates vary by time of day. Your total is shown before you confirm.</span></li>' : "") +
            '<li class="flex items-start gap-2.5"><i class="fa-solid fa-receipt text-dink-lime mt-0.5" aria-hidden="true"></i><span><strong>Confirmation:</strong> The club reviews each request; you will see the status in My Bookings.</span></li>' +
            (c.contact_phone || c.contact_email ? '<li class="flex items-start gap-2.5"><i class="fa-solid fa-headset text-dink-lime mt-0.5" aria-hidden="true"></i><span><strong>Questions:</strong> Contact the club at ' +
              esc([c.contact_phone, c.contact_email].filter(Boolean).join(" or ")) + ".</span></li>" : "") +
          "</ul>" +
        "</div>" +
      "</section>" +
      "</div></div></div>";

    cleanupAuthPattern = mountAuthPattern($("#club-profile-stage"));
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    function drawDays() {
      var strip = $("#club-daystrip");
      if (!strip) return;
      strip.innerHTML = dates.map(function (d, idx) {
        var n = openCount(d), on = idx === S.day;
        var tone = on ? "opacity-90" : n === 0 ? "text-slate-500" : n <= 6 ? "text-amber-400" : "text-dink-lime";
        return '<button type="button" data-day="' + idx + '" aria-pressed="' + on + '" class="flex-shrink-0 flex flex-col items-center justify-center w-24 py-2.5 px-3 rounded-[12px] transition ' +
          (on ? "bg-dink-lime text-black font-semibold" : "bg-dink-surfaceLight hover:bg-slate-700/60 border border-dink-border text-slate-300") + '">' +
          '<span class="text-[10px] uppercase font-bold tracking-wider ' + (on ? "opacity-80" : "text-slate-400") + '">' + dayLabel(idx) + "</span>" +
          '<span class="text-base font-extrabold font-display ' + (on ? "" : "text-white") + '">' + dateLabel(idx) + "</span>" +
          '<span class="text-[10px] font-medium ' + tone + '">' + (n === 0 ? "Fully booked" : n + (n === 1 ? " slot left" : " slots left")) + "</span></button>";
      }).join("");
      document.querySelectorAll(".club-dur").forEach(function (b) {
        var on = +b.getAttribute("data-dur") === S.dur;
        b.setAttribute("aria-pressed", String(on));
        b.className = "club-dur px-3 py-1.5 rounded-[8px] text-xs transition " + (on ? "font-bold bg-dink-lime text-black shadow-sm" : "font-medium text-slate-400 bg-dink-surfaceLight hover:bg-slate-700/60");
      });
    }

    function drawCourts() {
      var grid = $("#club-courtgrid"), note = $("#club-avail-note");
      if (note) note.innerHTML = courts.length ? "Real-time availability for <span class=\"text-dink-lime font-semibold\">" + dayLabel(S.day) + " (" + dateLabel(S.day) + ")</span> at " + esc(c.name) : "";
      if (!grid) return;
      var ymd = dates[S.day];
      grid.innerHTML = courts.map(function (k) {
        var slots = slotsFor(k, ymd), free = slots.filter(function (x) { return !x.off; }).length;
        var lo = Number(k.rate_min != null ? k.rate_min : k.hourly_rate), hi = Number(k.rate_max != null ? k.rate_max : lo);
        var sel = S.sel[k.id], selSlot = slots.filter(function (x) { return x.m === sel && !x.off; })[0];
        if (!selSlot) delete S.sel[k.id];
        var selectedTotal = null;
        if (selSlot) {
          var remaining = S.dur, total = 0;
          for (var idx = slots.indexOf(selSlot); remaining > 0 && idx < slots.length; idx++) {
            var rate = slots[idx].rate;
            if (rate == null || !Number.isFinite(Number(rate))) break;
            var minutes = Math.min(k.slot_minutes, remaining);
            total += Number(rate) * minutes / 60;
            remaining -= minutes;
          }
          if (remaining === 0) selectedTotal = total;
        }
        var slotHtml = slots.length ? slots.map(function (x) {
          var peak = hi > lo && x.rate != null && x.rate >= hi;
          var picked = selSlot && x.m === selSlot.m;
          var cls = x.off
            ? "bg-slate-800/40 border-transparent text-slate-600 cursor-not-allowed line-through"
            : picked ? "bg-dink-lime border-dink-lime text-black font-bold"
              : "bg-dink-surfaceLight border-dink-border text-slate-200 hover:border-dink-lime hover:text-dink-lime";
          return '<button type="button" class="club-slot relative py-1.5 px-2 rounded-[8px] border text-[11px] font-label-md font-medium transition text-center ' + cls + '" data-court="' + esc(k.id) + '" data-m="' + x.m + '"' +
            (x.off ? " disabled" : "") + ' aria-pressed="' + !!picked + '" title="' + esc(timeLabel(x.s) + (x.rate != null ? " \u2022 " + money(x.rate) + "/hr" : "")) + '">' + esc(timeLabel(x.s)) +
            (peak && !x.off ? '<span class="absolute -top-1.5 -right-1 text-[8px] bg-dink-pinkAccent text-white px-1 rounded-sm uppercase font-sans font-bold">Peak</span>' : "") + "</button>";
        }).join("") : "";
        var features = [
          ["fa-regular fa-clock", hoursText(k.open_time, k.close_time) + " \u2022 " + k.slot_minutes + " min slots"],
          k.surface ? ["fa-solid fa-layer-group", k.surface] : null,
          ["fa-solid " + (k.is_indoor ? "fa-warehouse" : "fa-sun"), k.is_indoor ? "Indoor court" : "Outdoor court"]
        ].filter(Boolean);
        return '<article class="bg-dink-surface rounded-2xl border border-dink-border hover:border-slate-600 transition flex flex-col justify-between overflow-hidden shadow-lg">' +
          '<div class="p-6 pb-4">' +
            '<div class="flex items-center justify-between gap-2 mb-4"><div class="flex items-center gap-2 min-w-0"><span class="w-2.5 h-2.5 rounded-full shrink-0 ' + (free ? "bg-dink-lime animate-pulse" : "bg-slate-700") + '"></span>' +
              '<h3 class="text-xl font-bold text-white font-display m-0 truncate">' + esc(k.name) + "</h3></div>" +
              '<span class="px-3 py-1 rounded-full text-xs font-semibold bg-dink-surfaceLight text-slate-300 border border-dink-border shrink-0">' + (k.is_indoor ? "Indoor" : "Outdoor") + "</span></div>" +
            '<div class="club-court-price my-3" aria-live="polite"><div class="flex items-baseline flex-wrap gap-1"><span class="text-2xl sm:text-3xl font-extrabold text-dink-lime font-display tracking-tight">' + esc(money(selectedTotal != null ? selectedTotal : lo)) + "</span>" +
              (selectedTotal == null && hi > lo ? '<span class="text-sm font-bold text-dink-lime/80 font-display">&ndash; ' + esc(money(hi)) + "</span>" : "") +
              '<span class="text-xs font-semibold text-slate-400">' + (selectedTotal != null && S.dur !== 60 ? '/ ' + S.dur / 60 + ' hours' : '/ hr') + '</span></div>' +
              (selSlot && selectedTotal == null ? '<p class="text-[11px] text-slate-400 mt-1 mb-0">Scheduled price unavailable. Confirm the price at checkout.</p>' : '') + '</div>' +
            '<div class="space-y-1.5 text-xs text-slate-300 pt-2 border-t border-dink-border">' + features.map(function (f) {
              return '<div class="flex items-center gap-2"><i class="' + f[0] + ' text-slate-500 w-4" aria-hidden="true"></i><span>' + esc(f[1]) + "</span></div>";
            }).join("") + "</div>" +
            '<div class="mt-5"><p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex justify-between"><span>Available Time Slots</span><span class="normal-case tracking-normal ' + (free ? "text-dink-lime" : "text-slate-500") + '">' +
              (free ? free + " open" : "Fully booked") + "</span></p>" +
              (slots.length ? '<div class="club-time-slots grid grid-cols-3 gap-1.5 pt-1.5">' + slotHtml + "</div>" : '<p class="text-xs text-slate-500 m-0">No times on this date.</p>') +
            "</div>" +
          "</div>" +
          '<div class="p-6 pt-2 bg-dink-surface">' +
            '<a href="' + esc(bookHref(k, selSlot ? selSlot.m : null)) + '" class="w-full py-3 rounded-[12px] bg-dink-lime hover:bg-dink-limeHover active:scale-[0.98] text-black font-bold font-display text-sm transition flex items-center justify-center gap-2 no-underline">' +
              '<i class="fa-solid ' + (selSlot ? "fa-check" : "fa-bolt-lightning") + ' text-xs" aria-hidden="true"></i>' +
              esc((state.user ? "Book " : "Sign up to book ") + k.name + (selSlot ? " \u2022 " + timeLabel(selSlot.s) : "")) + "</a>" +
          "</div></article>";
      }).join("");
    }

    async function loadAvailability() {
      if (!courts.length) return;
      var from = toUtc(dates[0], 0).toISOString(), to = toUtc(addDays(dates[DAYS - 1], 1), 0).toISOString();
      var res = await Promise.all(courts.map(function (k) { return sb.rpc("court_availability", { p_court_id: k.id, p_from: from, p_to: to }); }));
      res.forEach(function (r, idx) {
        if (r.error) return;
        S.taken[courts[idx].id] = (r.data || []).map(function (x) { return [new Date(x.starts_at), new Date(x.ends_at)]; });
      });
    }
    async function loadRates(ymd) {
      await Promise.all(courts.map(function (k) {
        var per = S.rates[k.id] = S.rates[k.id] || {};
        if (per[ymd]) return null;
        return sb.rpc("court_slot_rates", { p_court_id: k.id, p_date: ymd }).then(function (r) {
          var by = {};
          (r.data || []).forEach(function (x) { by[x.start_min] = Number(x.hourly_rate); });
          per[ymd] = by;
        });
      }));
    }
    function alive() { return !!$(".club-public"); }

    // events
    app.querySelectorAll("[data-scroll]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        var t = document.getElementById(b.getAttribute("data-scroll"));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
    var share = $("#club-share");
    if (share) share.onclick = async function () {
      var url = location.origin + location.pathname + "#/c/" + slug;
      try {
        if (navigator.share) await navigator.share({ title: c.name + " | DINKSLOT", url: url });
        else { await navigator.clipboard.writeText(url); setMsg(app, "Club link copied.", "ok"); }
      } catch (err) { if (err && err.name !== "AbortError") setMsg(app, "Could not share this link.", "err"); }
    };
    var dateBox = $("#club-dates");
    if (dateBox) dateBox.addEventListener("click", async function (e) {
      var day = e.target.closest("[data-day]"), dur = e.target.closest("[data-dur]");
      if (day) { S.day = +day.getAttribute("data-day"); drawDays(); drawCourts(); await loadRates(dates[S.day]); if (alive()) drawCourts(); }
      else if (dur) { S.dur = +dur.getAttribute("data-dur"); drawDays(); drawCourts(); }
    });
    var grid = $("#club-courtgrid");
    if (grid) grid.addEventListener("click", function (e) {
      var b = e.target.closest(".club-slot");
      if (!b || b.disabled) return;
      var id = b.getAttribute("data-court"), m = +b.getAttribute("data-m");
      if (S.sel[id] === m) delete S.sel[id]; else S.sel[id] = m;
      drawCourts();
    });

    drawDays(); drawCourts();
    if (!courts.length) return;
    var grid0 = $("#club-courtgrid");
    if (grid0) grid0.innerHTML = courts.map(function () { return '<div class="h-[30rem] rounded-2xl bg-dink-surface border border-dink-border ds-skeleton"></div>'; }).join("");
    return Promise.all([loadAvailability(), loadRates(dates[0])]).then(function () {
      if (!alive()) return;
      drawDays(); drawCourts();
      // keep availability fresh while the page is open (stopped by stopLive() on navigation)
      livePoll = setInterval(async function () {
        if (!alive()) { stopLive(); return; }
        if (document.hidden) return;
        await loadAvailability();
        if (alive()) { drawDays(); drawCourts(); }
      }, 60000);
    });
  }

  // Bend only the decorative mesh; the form remains on a stationary surface.
  function mountAuthPattern(stage) {
    var sharedBackdrop = stage.matches(".auth-stage, #club-signup-screen, #club-profile-stage, #ds-book-page, .member-workspace-stage");
    var glow;
    if (sharedBackdrop) {
      // Replace route-specific ambient artwork with the sign-in backdrop on every page.
      Array.from(stage.children).forEach(function (child) {
        if (child.classList.contains("absolute") && child.classList.contains("pointer-events-none")) child.remove();
      });
      stage.classList.add("shared-auth-backdrop");
      glow = document.createElement("div");
      glow.className = "shared-auth-glow";
      glow.setAttribute("aria-hidden", "true");
      stage.prepend(glow);
    }
    var canvas = document.createElement("canvas");
    canvas.className = "auth-pattern";
    canvas.setAttribute("aria-hidden", "true");
    stage.prepend(canvas);
    var ctx = canvas.getContext("2d");
    if (!ctx) return function () { canvas.remove(); };
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    var width = 0, height = 0, frame = 0, disposed = false;
    var tx = 0, ty = 0, x = 0, y = 0, strength = 0, target = 0;
    var spacing = 36, radius = 240;
    function project(gx, gy) {
      var dx = gx - x, dy = gy - y, distance = Math.hypot(dx, dy);
      if (distance >= radius) return { x: gx, y: gy, lift: 0 };
      var t = distance / radius;
      var lift = Math.pow(1 - t * t, 2) * strength;
      var push = Math.sin(t * Math.PI) * (1 - t * .45) * 24 * strength;
      return { x: gx + dx / (distance || 1) * push, y: gy + dy / (distance || 1) * push, lift: lift };
    }
    function draw() {
      ctx.clearRect(0, 0, width, height);
      var cols = Math.ceil(width / spacing) + 2, rows = Math.ceil(height / spacing) + 2;
      var points = [];
      for (var r = 0; r < rows; r++) {
        var row = [];
        for (var c = 0; c < cols; c++) row.push(project(c * spacing - 17, r * spacing - 17));
        points.push(row);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(134,186,158,.09)";
      ctx.beginPath();
      points.forEach(function (row, r) {
        row.forEach(function (p, c) {
          if (c + 1 < cols) { ctx.moveTo(p.x, p.y); ctx.lineTo(row[c + 1].x, row[c + 1].y); }
          if (r + 1 < rows) { ctx.moveTo(p.x, p.y); ctx.lineTo(points[r + 1][c].x, points[r + 1][c].y); }
        });
      });
      ctx.stroke();
      points.forEach(function (row) {
        row.forEach(function (p) {
          ctx.fillStyle = "rgba(134,186,158," + (.24 + p.lift * .34).toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.7 + p.lift * 1.1, 0, Math.PI * 2); ctx.fill();
        });
      });
      // Small crosses sit between the dots and follow the same convex field.
      for (var r = 0; r + 1 < rows; r++) {
        for (var c = 0; c + 1 < cols; c++) {
          var cross = project(c * spacing + 1, r * spacing + 1);
          var arm = 2.5 + cross.lift * 1.2;
          ctx.strokeStyle = "rgba(134,186,158," + (.18 + cross.lift * .22).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cross.x - arm, cross.y); ctx.lineTo(cross.x + arm, cross.y);
          ctx.moveTo(cross.x, cross.y - arm); ctx.lineTo(cross.x, cross.y + arm);
          ctx.stroke();
        }
      }
    }
    function tick() {
      frame = 0;
      if (disposed || !stage.isConnected) return;
      x += (tx - x) * .18; y += (ty - y) * .18;
      strength += (target - strength) * .14;
      draw();
      if (Math.hypot(tx - x, ty - y) > .35 || Math.abs(target - strength) > .004) schedule();
    }
    function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(tick); }
    function resize() {
      width = stage.clientWidth; height = stage.clientHeight;
      if (stage.id === "ds-landing") {
        var origin = stage.getBoundingClientRect().top;
        var stops = [];
        Array.from(stage.children).filter(function (element) { return element.tagName === "SECTION"; }).forEach(function (section) {
          var bounds = section.getBoundingClientRect();
          var top = bounds.top - origin, bottom = bounds.bottom - origin;
          var fade = Math.min(48, bounds.height / 4);
          stops.push("transparent " + top + "px", "#000 " + (top + fade) + "px", "#000 " + (bottom - fade) + "px", "transparent " + bottom + "px");
        });
        if (stops.length) {
          var mask = "linear-gradient(to bottom, " + stops.join(", ") + ")";
          canvas.style.maskImage = mask;
          canvas.style.webkitMaskImage = mask;
        }
      }
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    function move(event) {
      if (reduced.matches || !fine.matches || event.pointerType !== "mouse") return;
      var bounds = stage.getBoundingClientRect();
      tx = event.clientX - bounds.left; ty = event.clientY - bounds.top;
      if (!target && strength < .01) { x = tx; y = ty; }
      target = 1; schedule();
    }
    function leave() { target = 0; schedule(); }
    function preferenceChanged() {
      if (reduced.matches || !fine.matches) {
        cancelAnimationFrame(frame); frame = 0; strength = target = 0; draw();
      }
    }
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("pointercancel", leave);
    reduced.addEventListener("change", preferenceChanged);
    fine.addEventListener("change", preferenceChanged);
    var observer = new ResizeObserver(resize);
    observer.observe(stage); resize();
    return function () {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("pointercancel", leave);
      reduced.removeEventListener("change", preferenceChanged);
      fine.removeEventListener("change", preferenceChanged);
      canvas.remove();
      if (glow) glow.remove();
      if (sharedBackdrop) stage.classList.remove("shared-auth-backdrop");
    };
  }

  // Sign in / sign up. After success: optional join_club for /c/<slug>/join.
  function viewAuth(opts) {
    opts = opts || {};
    var next = opts.next || "/me";
    var mode = opts.mode === "up" ? "up" : "in";
    function rememberAuthScreen(screen) {
      mode = screen;
      var raw = (location.hash || "#/auth").slice(1);
      var split = raw.indexOf("?");
      var path = split < 0 ? raw : raw.slice(0, split);
      var params = new URLSearchParams(split < 0 ? "" : raw.slice(split + 1));
      if (path !== "/auth") {
        params = new URLSearchParams();
        if (opts.join) params.set("join", opts.join);
        if (opts.next) params.set("next", opts.next);
      }
      params.set("mode", screen);
      history.replaceState(null, "", location.pathname + location.search + "#/auth?" + params.toString());
      renderNav();
    }
    function rememberIntent(dn) { setPending({ as: "player", join: opts.join || null, next: next, dn: dn || "" }); }
    // Google sign-in / sign-up. Works only once the Google provider is enabled in Supabase
    // (docs/google-signin.md); until then people get a clear message instead of an error page.
    async function googleAuth() {
      try {
        var st = await fetch(cfg.SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: cfg.SUPABASE_ANON_KEY } }).then(function (r) { return r.json(); });
        if (!st || !st.external || !st.external.google) {
          return setMsg(app, "Google sign-in is not available yet. Please use your email and password for now.", "err");
        }
      } catch (e) { return setMsg(app, friendly(e), "err"); }
      rememberIntent();
      var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
      if (r.error) setMsg(app, friendly(r.error), "err");
    }
    var selectedSkill = "unrated";

    var defaultTitleIn = opts.title || "Welcome back to the court";
    var defaultTitleUp = opts.title || 'Join the premier <span class="text-primary tracking-normal">pickleball</span> network';
    var defaultIntroIn = opts.intro || "Enter your credentials to access your bookings and club schedule.";
    var defaultIntroUp = opts.intro || "Book courts, join rated leagues, and connect with top local players in real time.";
    document.body.classList.add("auth-page");

    function renderSignIn() {
      rememberAuthScreen("in");
      mode = "in";
      if (cleanupAuthPattern) { cleanupAuthPattern(); cleanupAuthPattern = null; }
      app.innerHTML =
        '<div id="ds-auth-screen" class="flex flex-col w-full">' +
        '<div class="auth-stage relative w-full min-h-[calc(100vh-4rem)] flex items-center justify-center p-gutter lg:p-gutter-desktop overflow-hidden bg-surface">' +
        '<!-- Ambient Court Kinetic Background Glows -->' +
        '<div class="pointer-events-none absolute -top-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[140px] mix-blend-screen"></div>' +
        '<div class="pointer-events-none absolute -bottom-48 -right-32 w-[30rem] h-[30rem] bg-primary-container/15 rounded-full blur-[160px] mix-blend-screen"></div>' +
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
        '<p class="font-label-sm text-label-sm text-primary tracking-wider uppercase font-semibold">Pro Match Engine &bull; Club Sync</p>' +
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
        '<span class="font-label-sm text-label-sm px-2.5 py-0.5 rounded-full bg-primary-container text-on-primary font-bold">GAME POINT &bull; 10-9</span>' +
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
        '<!-- Quick Social Auth -->' +
        '<button id="oauth-google-in" class="group flex w-full items-center justify-center gap-space-sm py-3 px-space-md rounded-full bg-surface-container-high hover:bg-surface-bright transition-all text-on-surface font-label-lg text-label-lg shadow-sm" type="button">' +
        '<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335"></path>' +
        '<path d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z" fill="#4285F4"></path>' +
        '<path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z" fill="#FBBC05"></path>' +
        '<path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" fill="#34A853"></path>' +
        '</svg><span>Sign in with Google</span></button>' +
        '<div class="relative flex items-center justify-center"><div class="w-full h-px bg-surface-container-highest"></div>' +
        '<span class="absolute px-3 bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest">or with email</span></div>' +
        '<!-- Interactive Form -->' +
        '<form class="space-y-4" id="f" novalidate>' +
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
        '<input id="pw" type="password" autocomplete="current-password" minlength="6" placeholder="Enter your password" required class="w-full pl-11 pr-12 py-3 rounded-full bg-surface-container text-on-surface font-body-md text-body-md placeholder-on-surface-variant/40 focus:outline-none focus:bg-surface-container-high transition-all" />' +
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
        '<input id="remember-me" type="checkbox" checked />' +
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
        '<span id="go-text">Sign in</span>' +
        '<span class="material-symbols-outlined text-[20px]" aria-hidden="true">login</span>' +
        '</button>' +
        '</div>' +
        '</form>' +
        '<!-- Register Prompt & Switcher -->' +
        '<div class="text-center pt-2">' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
        '<span id="switch-text">New to DINKSLOT?</span> ' +
        '<a id="switch-btn" class="font-label-md text-label-md text-primary font-bold hover:text-secondary-fixed transition-colors ml-1 inline-flex items-center gap-1" href="#">' +
        '<span id="switch-btn-label">Create an account</span>' +
        '<span class="material-symbols-outlined auth-switch-icon" aria-hidden="true">arrow_forward</span>' +
        '</a>' +
        '</p>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      cleanupAuthPattern = mountAuthPattern($(".auth-stage"));
      var cap = mountCaptcha($("#cap"));
      function setBtnIdle() {
        $("#go").innerHTML = '<span id="go-text">Sign in</span><span class="material-symbols-outlined text-[20px]" aria-hidden="true">login</span>';
      }

      $("#switch-btn").onclick = function (e) {
        e.preventDefault();
        window.scrollTo(0, 0);
        renderSignUp();
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
      $("#oauth-google-in").onclick = googleAuth;
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
        var res = await sb.auth.signInWithPassword({ email: email, password: pw, options: { captchaToken: cap.token } });
        cap.reset();
        if (res.error) {
          btn.disabled = false;
          setBtnIdle();
          return setMsg(app, friendly(res.error), "err");
        }
        btn.innerHTML = '<span class="material-symbols-outlined text-[22px]">sports_tennis</span><span>Access Granted &bull; Entering Court</span>';
        await refreshSession();
        if (state.isPlatform) return go("/platform");
        if (opts.join) {
          var dn = ($("#dn") && $("#dn").value.trim()) || email.split("@")[0];
          takePending();
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

    function renderSignUp() {
      rememberAuthScreen("up");
      mode = "up";
      if (cleanupAuthPattern) { cleanupAuthPattern(); cleanupAuthPattern = null; }
      app.innerHTML =
        '<div id="ds-auth-screen" class="signup-screen flex flex-col w-full">' +
        '<div class="auth-stage flex flex-col w-full relative overflow-hidden py-space-xl px-gutter lg:px-gutter-desktop items-center justify-center min-h-[calc(100vh-8rem)]">' +
        '<!-- Ambient Stadium Glow Effects -->' +
        '<div class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-primary-container/10 blur-[130px] rounded-full pointer-events-none -z-10"></div>' +
        '<div class="absolute -bottom-24 -right-20 w-[420px] h-[420px] bg-tertiary-container/5 blur-[100px] rounded-full pointer-events-none -z-10"></div>' +
        '<!-- Decorative Court Line Elements (Subtle Neo-Athletic Grid) -->' +
        '<div class="absolute inset-0 pointer-events-none opacity-20 -z-10 flex justify-between px-16">' +
        '<div class="w-px h-full bg-gradient-to-b from-transparent via-outline-variant to-transparent"></div>' +
        '<div class="w-px h-full bg-gradient-to-b from-transparent via-primary/20 to-transparent"></div>' +
        '<div class="w-px h-full bg-gradient-to-b from-transparent via-outline-variant to-transparent"></div>' +
        '</div>' +
        '<div class="signup-wrap w-full max-w-2xl flex flex-col gap-space-lg relative z-10">' +
        '<!-- Header Badge & Headline Group -->' +
        '<div class="flex flex-col items-center text-center gap-space-xs">' +
        '<div class="inline-flex items-center gap-space-xs px-space-md py-1 rounded-full bg-surface-container-high text-primary font-label-md text-label-md tracking-wider uppercase mb-space-xs shadow-sm">' +
        '<span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>' +
        'DS League Entry &bull; Season 2025' +
        '</div>' +
        '<h1 id="auth-title" class="font-headline-lg text-headline-lg md:text-headline-display tracking-tight text-on-surface">' +
        defaultTitleUp +
        '</h1>' +
        '<p id="auth-sub" class="font-body-lg text-body-lg text-on-surface-variant max-w-lg mt-1">' +
        defaultIntroUp +
        '</p>' +
        '</div>' +
        '<!-- Main Card Container -->' +
        '<div class="signup-card w-full bg-surface-container/85 backdrop-blur-2xl rounded-lg p-space-lg md:p-space-xl shadow-xl flex flex-col gap-space-lg border border-white/5">' +
        '<!-- Perks Micro-Banner -->' +
        '<div class="w-full rounded-DEFAULT bg-surface-container-highest/60 px-space-md py-space-sm flex items-center justify-between gap-space-sm">' +
        '<div class="flex items-center gap-space-sm min-w-0">' +
        '<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">' +
        '<span class="material-symbols-outlined text-primary text-[18px]">verified</span>' +
        '</div>' +
        '<p class="font-body-sm text-body-sm text-on-surface font-medium truncate">' +
        'Includes <span class="text-primary font-semibold">14 days free</span> priority booking &amp; DUPR Ready play' +
        '</p>' +
        '</div>' +
        '<span class="hidden sm:inline-block font-label-sm text-label-sm text-primary uppercase tracking-widest shrink-0 font-semibold px-2 py-0.5 rounded bg-surface-container-low">' +
        'VIP TIER' +
        '</span>' +
        '</div>' +
        '<!-- Quick Social Auth -->' +
        '<div class="signup-social">' +
        '<button id="oauth-google-up" class="group flex items-center justify-center gap-space-sm py-3 px-space-md rounded-full bg-surface-container-high hover:bg-surface-bright transition-all text-on-surface font-label-lg text-label-lg shadow-sm" type="button">' +
        '<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24">' +
        '<path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335"></path>' +
        '<path d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z" fill="#4285F4"></path>' +
        '<path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z" fill="#FBBC05"></path>' +
        '<path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" fill="#34A853"></path>' +
        '</svg>' +
        '<span>Sign up with Google</span>' +
        '</button>' +
        '</div>' +
        '<!-- Divider -->' +
        '<div class="relative flex items-center justify-center">' +
        '<div class="w-full h-px bg-surface-container-highest"></div>' +
        '<span class="absolute px-space-md bg-surface-container text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest">' +
        'or register with email' +
        '</span>' +
        '</div>' +
        '<!-- Form Inputs Group -->' +
        '<form class="flex flex-col gap-space-md" id="f" novalidate>' +
        '<!-- First & Last Name Dual Column -->' +
        '<div class="signup-name-grid">' +
        '<div class="flex flex-col gap-1.5">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="first_name">First Name</label>' +
        '<div class="relative">' +
        '<input class="w-full bg-surface-container-low rounded-DEFAULT px-space-md py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="first_name" autocomplete="given-name" placeholder="Marcus" required type="text" />' +
        '</div>' +
        '</div>' +
        '<div class="flex flex-col gap-1.5">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="last_name">Last Name</label>' +
        '<div class="relative">' +
        '<input class="w-full bg-surface-container-low rounded-DEFAULT px-space-md py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="last_name" autocomplete="family-name" placeholder="Vance" required type="text" />' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<!-- Email Address -->' +
        '<div class="flex flex-col gap-1.5">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="email">Email Address</label>' +
        '<div class="relative flex items-center">' +
        '<span class="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none text-[20px]">alternate_email</span>' +
        '<input class="w-full bg-surface-container-low rounded-DEFAULT pl-11 pr-space-md py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="email" autocomplete="email" placeholder="marcus.vance@dinkslot.club" required type="email" />' +
        '</div>' +
        '</div>' +
        '<!-- Skill Level Selector (Dynamic Pills) -->' +
        '<div class="flex flex-col gap-2 mt-1">' +
        '<div class="flex items-center justify-between">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Official DUPR Classification</label>' +
        '<a class="font-label-sm text-label-sm text-primary hover:underline flex items-center gap-1" href="https://www.dupr.com/how-it-works" target="_blank" rel="noopener noreferrer">' +
        '<span>Find my rating</span>' +
        '<span class="material-symbols-outlined text-[14px]">arrow_outward</span>' +
        '</a>' +
        '</div>' +
        '<div id="skill-selector" class="signup-skills official-dupr-options" role="group" aria-label="DUPR classification">' +
        '<button type="button" class="skill-pill" data-skill="unrated" aria-pressed="true"><span class="font-label-md">Not Rated</span><span class="font-label-sm">NR</span></button>' +
        '<button type="button" class="skill-pill" data-skill="novice" aria-pressed="false"><span class="font-label-md">Novice</span><span class="font-label-sm">2.000 - 2.999</span></button>' +
        '<button type="button" class="skill-pill" data-skill="intermediate" aria-pressed="false"><span class="font-label-md">Intermediate</span><span class="font-label-sm">3.000 - 3.999</span></button>' +
        '<button type="button" class="skill-pill" data-skill="advanced" aria-pressed="false"><span class="font-label-md">Advanced</span><span class="font-label-sm">4.000 - 4.999</span></button>' +
        '<button type="button" class="skill-pill" data-skill="professional" aria-pressed="false"><span class="font-label-md">Professional</span><span class="font-label-sm">5.000 - 8.000</span></button>' +
        '</div>' +
        '<p class="signup-skill-help">Select your current DUPR classification, or Not Rated. Self-reported; not verified with DUPR.</p>' +
        '</div>' +
        '<!-- Password Field with Interactive Strength Meter -->' +
        '<div class="flex flex-col gap-1.5 mt-1">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="pw">Password</label>' +
        '<div class="relative flex items-center">' +
        '<span class="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none text-[20px]">lock</span>' +
        '<input class="w-full bg-surface-container-low rounded-DEFAULT pl-11 pr-11 py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="pw" autocomplete="new-password" minlength="6" placeholder="Create a password" required type="password" />' +
        '<button aria-label="Toggle password visibility" class="absolute right-3.5 text-on-surface-variant hover:text-on-surface transition-colors flex items-center justify-center" id="toggle-password-btn" type="button">' +
        '<span class="material-symbols-outlined text-[20px]" id="eye-icon">visibility</span>' +
        '</button>' +
        '</div>' +
        '<!-- Strength Meter Bars -->' +
        '<div class="signup-strength-meter">' +
        '<div class="signup-strength-bars">' +
        '<div class="h-full rounded-full bg-surface-container-highest transition-all duration-300" id="bar-1"></div>' +
        '<div class="h-full rounded-full bg-surface-container-highest transition-all duration-300" id="bar-2"></div>' +
        '<div class="h-full rounded-full bg-surface-container-highest transition-all duration-300" id="bar-3"></div>' +
        '</div>' +
        '<div class="flex justify-between items-center text-label-sm font-label-sm">' +
        '<span class="text-on-surface-variant">Strength rating:</span>' +
        '<span class="text-primary font-semibold tracking-wide" id="strength-label">Enter a password</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<hr class="signup-password-divider" />' +
          '<div id="l-dn" class="flex flex-col gap-1.5 mt-1">' +
          '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="dn">Display Name</label>' +
          '<div class="relative flex items-center">' +
          '<span class="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none text-[20px]">badge</span>' +
          '<input class="w-full bg-surface-container-low rounded-DEFAULT pl-11 pr-space-md py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="dn" autocomplete="nickname" maxlength="60" placeholder="How other players see you" />' +
          '</div>' +
          '</div>' +
        '<!-- Terms and Conditions Checkbox -->' +
        '<div class="signup-consent">' +
        '<input id="terms" type="checkbox" required />' +
        '<label for="terms">I agree to the <a class="text-primary underline" href="#/auth">Terms of Service</a>, ' +
        '<a class="text-primary underline" href="#/auth">Privacy Policy</a>, and tournament fair-play conduct standard.</label>' +
        '</div>' +
        '<!-- Turnstile & Feedback -->' +
        '<div id="cap" class="cap"></div>' +
        '<p class="msg" role="alert"></p>' +
        '<!-- Neon Primary CTA Button -->' +
        '<button id="go" class="w-full mt-2 py-4 px-space-xl rounded-full bg-primary-container hover:bg-primary text-on-primary-container font-headline-sm text-headline-sm uppercase tracking-wider font-bold transition-all shadow-[0_0_24px_rgba(163,230,53,0.35)] hover:shadow-[0_0_32px_rgba(163,230,53,0.55)] flex items-center justify-center gap-space-sm" type="submit">' +
        '<span>Create account</span>' +
        '<span class="material-symbols-outlined text-[22px]">sports_tennis</span>' +
        '</button>' +
        '</form>' +
        '<!-- Bottom Card Switcher -->' +
        '<div class="account-signin-prompt flex items-center justify-center gap-1.5 pt-2 font-body-sm text-body-sm text-on-surface-variant">' +
        '<span>Already have an account?</span>' +
        '<a id="switch-btn" class="auth-switch-link font-label-md text-label-md text-primary font-semibold" href="#"><span id="switch-btn-label">Sign in</span><span class="material-symbols-outlined auth-switch-icon" aria-hidden="true">arrow_forward</span></a>' +
        '</div>' +
        '</div>' +
        '<!-- Micro Highlights / Proof Stats -->' +
        '<div class="grid grid-cols-3 gap-space-md text-center py-space-sm">' +
        '<div class="flex flex-col">' +
        '<span class="font-headline-md text-headline-md text-on-surface font-bold">14,200+</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Active Players</span>' +
        '</div>' +
        '<div class="flex flex-col">' +
        '<span class="font-headline-md text-headline-md text-primary font-bold">640+</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Partner Courts</span>' +
        '</div>' +
        '<div class="flex flex-col">' +
        '<span class="font-headline-md text-headline-md text-on-surface font-bold">4.9 / 5</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Player Rating</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      cleanupAuthPattern = mountAuthPattern($(".auth-stage"));
      var cap = mountCaptcha($("#cap"));
      function setBtnIdle() {
        $("#go").innerHTML = '<span>Create account</span><span class="material-symbols-outlined text-[20px]" aria-hidden="true">person_add</span>';
      }

      var passInput = $("#pw"), toggleBtn = $("#toggle-password-btn"), eyeIcon = $("#eye-icon");
      if (toggleBtn && passInput) {
        toggleBtn.onclick = function () {
          var isPassword = passInput.getAttribute("type") === "password";
          passInput.setAttribute("type", isPassword ? "text" : "password");
          eyeIcon.textContent = isPassword ? "visibility_off" : "visibility";
        };
      }

      var b1 = $("#bar-1"), b2 = $("#bar-2"), b3 = $("#bar-3"), strengthLabel = $("#strength-label");
      if (passInput && b1 && b2 && b3 && strengthLabel) {
        passInput.oninput = function (e) {
          var val = e.target.value;
          if (val.length === 0) {
            b1.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            b2.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            b3.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            strengthLabel.textContent = "ENTER SECURE KEY";
            strengthLabel.className = "text-on-surface-variant font-semibold tracking-wide";
          } else if (val.length < 6) {
            b1.className = "h-full rounded-full bg-error transition-all duration-300";
            b2.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            b3.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            strengthLabel.textContent = "WEAK - NEEDS 6+ CHARS";
            strengthLabel.className = "text-error font-semibold tracking-wide";
          } else if (val.length < 10) {
            b1.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b2.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b3.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            strengthLabel.textContent = "GOOD - MATCH READY";
            strengthLabel.className = "text-primary font-semibold tracking-wide";
          } else {
            b1.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b2.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b3.className = "h-full rounded-full bg-primary-container transition-all duration-300 shadow-[0_0_8px_rgba(163,230,53,0.5)]";
            strengthLabel.textContent = "EXCELLENT - PRO SECURED";
            strengthLabel.className = "text-primary font-bold tracking-wide";
          }
        };
      }

      var pills = app.querySelectorAll(".skill-pill");
      pills.forEach(function (pill) {
        pill.setAttribute("aria-pressed", String(pill.getAttribute("data-skill") === selectedSkill));
        pill.onclick = function () {
          selectedSkill = pill.getAttribute("data-skill");
              pills.forEach(function (item) { item.setAttribute("aria-pressed", String(item === pill)); });
        };
      });

      $("#switch-btn").onclick = function (e) {
        e.preventDefault();
        window.scrollTo(0, 0);
        renderSignIn();
      };

      $("#oauth-google-up").onclick = googleAuth;


      $("#f").onsubmit = async function (e) {
        e.preventDefault();
        var firstName = ($("#first_name") && $("#first_name").value.trim()) || "";
        var lastName = ($("#last_name") && $("#last_name").value.trim()) || "";
        var fullName = [firstName, lastName].filter(Boolean).join(" ");
        var displayName = $("#dn").value.trim() || fullName;
        var email = $("#email").value.trim(), pw = $("#pw").value;
        if (!email || pw.length < 6) return setMsg(app, "Enter your email and a password of at least 6 characters.", "err");
        if ($("#terms") && !$("#terms").checked) return setMsg(app, "Please agree to the Terms of Service and Privacy Policy.", "err");
        if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
        var btn = $("#go");
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[22px]">progress_activity</span><span>Creating Account...</span>';
        setMsg(app, "", "");
        var res = await sb.auth.signUp({
          email: email,
          password: pw,
          options: {
            captchaToken: cap.token,
            emailRedirectTo: location.origin + location.pathname,
            data: { account_type: "player", full_name: fullName, display_name: displayName, skill_level: selectedSkill, dupr_classification: selectedSkill }
          }
        });
        cap.reset();
        if (res.error) {
          btn.disabled = false;
          setBtnIdle();
          return setMsg(app, friendly(res.error), "err");
        }
        // Reset only after signup succeeds; keep saved values for confirmation/join.
        var signupForm = $("#f");
        if (signupForm) signupForm.reset();
        selectedSkill = "unrated";
        pills.forEach(function (pill) { pill.setAttribute("aria-pressed", String(pill.getAttribute("data-skill") === "unrated")); });
        if (passInput) {
          passInput.type = "password";
          if (passInput.oninput) passInput.oninput({ target: passInput });
        }
        if (eyeIcon) eyeIcon.textContent = "visibility";
        if (!res.data.session) {
          btn.disabled = false;
          setBtnIdle();
          rememberIntent(displayName);
          return setMsg(app, "Account created. Check your email and click the confirmation link" +
            (opts.join ? ", and you will come straight back to book your court." : ", then sign in."), "ok");
        }
        await refreshSession();
        if (state.isPlatform) return go("/platform");
        if (opts.join) {
          var dn = displayName || email.split("@")[0];
          takePending();
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

    if (mode === "up") renderSignUp();
    else renderSignIn();
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
        go("/c/" + slug + "/book");
      };
      return;
    }
    viewAuth({ title: "Join " + esc(c.name), intro: "Sign in or create an account to join this club.", join: slug, next: "/c/" + slug + "/book" });
  }

  // Google for a CLUB account: same provider, but the person is marked as a club owner and lands on club setup.
  async function googleForClub() {
    try {
      var st = await fetch(cfg.SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: cfg.SUPABASE_ANON_KEY } }).then(function (r) { return r.json(); });
      if (!st || !st.external || !st.external.google) return setMsg(app, "Google sign-in is not available yet. Please use your email and password.", "err");
    } catch (e) { return setMsg(app, friendly(e), "err"); }
    var clubName = $("#oclub") ? $("#oclub").value.trim() : "";
    var name = $("#oname") ? $("#oname").value.trim() : "";
    setPending({ as: "tenant", join: null, next: "/register-club", dn: name, club_name: clubName });
    var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
    if (r.error) setMsg(app, friendly(r.error), "err");
  }

  // Step 1 for clubs, separate from player sign-up: create a CLUB account.
  function viewClubSignup() {
    app.innerHTML =
      '<div id="club-signup-screen" class="w-full flex-1 flex items-center justify-center px-4 py-8 lg:py-14">' +
      '<div class="club-signup-layout max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">' +
      '<!-- BEGIN: LeftFeatureHero (Value Proposition for Venues) -->' +
      '<div class="club-signup-story lg:col-span-5 flex flex-col justify-between rounded-3xl p-7 lg:p-9 relative overflow-hidden border border-brand-border">' +
      '<!-- Background Ambient Glow -->' +
      '<div class="absolute -top-24 -left-24 w-72 h-72 bg-brand-neon/10 rounded-full blur-3xl pointer-events-none"></div>' +
      '<div>' +
      '<!-- Verified Partner Badge -->' +
      '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-surfaceLow border border-brand-neon/30 text-brand-neon text-xs font-mono font-medium tracking-wide mb-6">' +
      '<span class="relative flex h-2 w-2">' +
      '<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-neon opacity-75"></span>' +
      '<span class="relative inline-flex rounded-full h-2 w-2 bg-brand-neon"></span>' +
      '</span>' +
      '<span>FOR CLUBS &amp; COURT OPERATORS</span>' +
      '</div>' +
      '<!-- Headline & Pitch -->' +
      '<h1 class="text-3xl lg:text-4xl font-mono font-bold tracking-tight text-white leading-tight mb-4">' +
      'Maximize Court Revenue. <br class="hidden sm:inline"/>' +
      '<span class="text-transparent bg-clip-text bg-gradient-to-r from-brand-neon to-lime-200">Zero Idle Hours.</span>' +
      '</h1>' +
      '<p class="text-slate-400 text-sm leading-relaxed mb-8">' +
      'The next-generation pickleball management system designed for indoor arenas, country clubs, and community parks.' +
      '</p>' +
      '<!-- Core Feature Bullets -->' +
      '<div class="space-y-4">' +
      '<div class="club-feature-card flex items-start gap-3.5 p-3 rounded-xl bg-brand-surfaceDim/80 border border-brand-border/60 hover:border-brand-neon/40 transition-colors">' +
      '<div class="w-8 h-8 rounded-lg bg-brand-neon/10 flex items-center justify-center text-brand-neon shrink-0 mt-0.5">' +
      '<i class="fa-solid fa-bolt text-xs"></i>' +
      '</div>' +
      '<div>' +
      '<h4 class="text-xs font-mono font-bold text-white uppercase tracking-wider">IoT Door &amp; Court Lighting</h4>' +
      '<p class="text-[11px] text-slate-400 mt-0.5">Automated keypad PINs and court light toggling tied directly to reservations.</p>' +
      '</div>' +
      '</div>' +
      '<div class="club-feature-card flex items-start gap-3.5 p-3 rounded-xl bg-brand-surfaceDim/80 border border-brand-border/60 hover:border-brand-neon/40 transition-colors">' +
      '<div class="w-8 h-8 rounded-lg bg-brand-neon/10 flex items-center justify-center text-brand-neon shrink-0 mt-0.5">' +
      '<i class="fa-solid fa-ranking-star text-xs"></i>' +
      '</div>' +
      '<div>' +
      '<h4 class="text-xs font-mono font-bold text-white uppercase tracking-wider">DUPR Integrated Leagues</h4>' +
      '<p class="text-[11px] text-slate-400 mt-0.5">Real-time dynamic rating sync, round-robin generators, and bracket automation.</p>' +
      '</div>' +
      '</div>' +
      '<div class="club-feature-card flex items-start gap-3.5 p-3 rounded-xl bg-brand-surfaceDim/80 border border-brand-border/60 hover:border-brand-neon/40 transition-colors">' +
      '<div class="w-8 h-8 rounded-lg bg-brand-neon/10 flex items-center justify-center text-brand-neon shrink-0 mt-0.5">' +
      '<i class="fa-solid fa-hand-holding-dollar text-xs"></i>' +
      '</div>' +
      '<div>' +
      '<h4 class="text-xs font-mono font-bold text-white uppercase tracking-wider">Zero Booking Fees on Open Play</h4>' +
      '<p class="text-[11px] text-slate-400 mt-0.5">Keep 100% of open play proceeds with instant Stripe Connect daily payouts.</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<!-- Venue Endorsement Social Proof Card -->' +
      '<div class="mt-8 pt-6 border-t border-brand-border">' +
      '<div class="flex items-center justify-between text-xs text-slate-400 mb-2">' +
      '<span class="font-mono text-slate-300 font-semibold flex items-center gap-1.5">' +
      '<i class="fa-solid fa-award text-brand-neon"></i>' +
      'Trusted by 500+ Facilities' +
      '</span>' +
      '<div class="flex text-brand-neon text-[10px]">' +
      '<i class="fa-solid fa-star"></i>' +
      '<i class="fa-solid fa-star"></i>' +
      '<i class="fa-solid fa-star"></i>' +
      '<i class="fa-solid fa-star"></i>' +
      '<i class="fa-solid fa-star"></i>' +
      '</div>' +
      '</div>' +
      '<p class="text-xs italic text-slate-300">' +
      '"DinkSlot cut our desk check-in backlog to zero and spiked our 9 PM court utilization by 38% in 60 days."' +
      '</p>' +
      '<div class="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">' +
      '<span class="font-medium text-white">Austin Pickle Club</span>' +
      '<span class="font-mono text-brand-neon/80">14 Courts Active</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<!-- END: LeftFeatureHero -->' +
      '<!-- BEGIN: RightRegisterForm -->' +
      '<div class="club-signup-form lg:col-span-7 rounded-3xl p-7 sm:p-10 border border-brand-border flex flex-col justify-center relative">' +
      '<!-- Registration Stage Badge & Title -->' +
      '<div class="mb-6">' +
      '<div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-neon/15 text-brand-neon text-[11px] font-mono font-semibold tracking-wider uppercase mb-3 border border-brand-neon/30">' +
      '<i class="fa-solid fa-shield-halved text-[10px]"></i>' +
      'FOR CLUBS AND COURT OWNERS' +
      '</div>' +
      '<h2 class="text-2xl sm:text-3xl font-mono font-bold text-white tracking-tight">' +
      'Register your club' +
      '</h2>' +
      '<p class="text-xs sm:text-sm text-slate-400 mt-2 leading-relaxed">' +
      'Create a club account first. After you confirm your email you add your club details, and the platform admin approves it before it goes public.' +
      '</p>' +
      '<!-- Contextual Switch to Player -->' +
      '<div class="mt-2 text-xs">' +
      '<span class="text-slate-400">Want to book a court instead?</span>' +
      '<a class="text-brand-neon hover:text-brand-neonHover underline font-medium ml-1 transition-colors" href="#/auth?mode=up">' +
      'Sign up as a player.' +
      '</a>' +
      '</div>' +
      '</div>' +
      '<!-- Form Elements -->' +
      '<form id="f" class="space-y-4" novalidate>' +
      '<!-- Grid: Your Name & Club Name -->' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<!-- Full Name Input -->' +
      '<div class="space-y-1.5">' +
      '<label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="oname">' +
      'Your Name' +
      '</label>' +
      '<div class="relative rounded-xl shadow-sm">' +
      '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
      '<i class="fa-regular fa-user text-sm" aria-hidden="true"></i>' +
      '</div>' +
      '<input class="w-full pl-10 pr-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all" id="oname" name="owner-name" placeholder="e.g. Alex Morgan" required type="text" autocomplete="name" />' +
      '</div>' +
      '</div>' +
      '<!-- Club / Facility Name Input -->' +
      '<div class="space-y-1.5">' +
      '<label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="oclub">' +
      'Club / Facility Name' +
      '</label>' +
      '<div class="relative rounded-xl shadow-sm">' +
      '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
      '<i class="fa-regular fa-building text-sm" aria-hidden="true"></i>' +
      '</div>' +
      '<input class="w-full pl-10 pr-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all" id="oclub" name="club-name" placeholder="e.g. Apex Pickleball Center" type="text" />' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<!-- Email Input -->' +
      '<div class="space-y-1.5">' +
      '<label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="oemail">' +
      'Email' +
      '</label>' +
      '<div class="relative rounded-xl shadow-sm">' +
      '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
      '<i class="fa-regular fa-envelope text-sm" aria-hidden="true"></i>' +
      '</div>' +
      '<input class="w-full pl-10 pr-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all" id="oemail" name="email" placeholder="manager@yourclub.com" required type="email" autocomplete="email" />' +
      '</div>' +
      '</div>' +
      '<!-- Password Input with Helper Details -->' +
      '<div class="space-y-1.5">' +
      '<div class="flex items-center justify-between">' +
      '<label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="opw">' +
      'Password (6 or more characters)' +
      '</label>' +
      '<span class="text-[10px] font-mono text-brand-neon/80 flex items-center gap-1">' +
      '<i class="fa-solid fa-lock text-[9px]"></i> Encrypted' +
      '</span>' +
      '</div>' +
      '<div class="relative rounded-xl shadow-sm">' +
      '<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">' +
      '<i class="fa-solid fa-lock text-sm" aria-hidden="true"></i>' +
      '</div>' +
      '<input class="w-full pl-10 pr-10 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all" id="opw" minlength="6" name="password" placeholder="Create a password" required type="password" autocomplete="new-password" />' +
      '<button id="pw-toggle" class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 text-xs transition-colors" title="Toggle password view" type="button">' +
      '<i id="pw-toggle-icon" class="fa-regular fa-eye"></i>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<!-- Cloudflare Turnstile & Message Container -->' +
      '<div class="club-captcha-block">' +
      '<div id="cap" class="cap"></div>' +
      '<p class="msg" role="alert"></p>' +
      '</div>' +
      '<!-- Primary Submit Action CTA -->' +
      '<div class="club-submit-block">' +
      '<button id="go" class="w-full py-3.5 px-6 rounded-xl font-mono text-sm font-bold uppercase tracking-wider bg-brand-neon hover:bg-brand-neonHover text-brand-dark neon-glow-btn flex items-center justify-center gap-2 group transition-all" type="submit">' +
      '<span>Create club account</span>' +
      '<i class="fa-solid fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>' +
      '</button>' +
      '</div>' +
      '<!-- Divider -->' +
      '<div class="relative py-2 flex items-center justify-center">' +
      '<div class="absolute inset-0 flex items-center">' +
      '<div class="w-full border-t border-brand-border/80"></div>' +
      '</div>' +
      '<span class="relative px-4 text-xs font-mono lowercase text-slate-400 bg-brand-surfaceCard">or</span>' +
      '</div>' +
      '<!-- Google Social Authentication -->' +
      '<div>' +
      '<button id="ogoogle" class="w-full py-3 px-4 rounded-xl font-mono text-xs font-semibold uppercase tracking-wider bg-brand-surfaceDim hover:bg-brand-surfaceLow text-slate-200 border border-brand-border/80 hover:border-brand-neon/40 flex items-center justify-center gap-3 transition-colors shadow-sm" type="button">' +
      '<svg class="w-4 h-4" viewBox="0 0 24 24">' +
      '<path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335"></path>' +
      '<path d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z" fill="#4285F4"></path>' +
      '<path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.8l3.7-2.9z" fill="#FBBC05"></path>' +
      '<path d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.3L1.9 16.4C3.7 20.1 7.5 23.5 12 23.5z" fill="#34A853"></path>' +
      '</svg>' +
      '<span>Continue with Google</span>' +
      '</button>' +
      '</div>' +
      '<!-- Bottom Prompt: Sign In Switch -->' +
      '<div class="account-signin-prompt">' +
      '<span>Already have a club account?</span>' +
      '<a class="club-signin-link text-primary transition-colors" href="#/auth?mode=in&next=%2Fregister-club">' +
      '<span class="club-signin-label">Sign in</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>' +
      '</a>' +
      '</div>' +
      '</form>' +
      '</div>' +
      '<!-- END: RightRegisterForm -->' +
      '</div>' +
      '</div>';

    if (cleanupAuthPattern) cleanupAuthPattern();
    cleanupAuthPattern = mountAuthPattern($("#club-signup-screen"));
    var cap = mountCaptcha($("#cap"));
    $("#ogoogle").onclick = googleForClub;
    var pwInput = $("#opw");
    var pwToggle = $("#pw-toggle");
    if (pwToggle && pwInput) {
      pwToggle.onclick = function () {
        var isPass = pwInput.type === "password";
        pwInput.type = isPass ? "text" : "password";
        var icon = $("#pw-toggle-icon");
        if (icon) {
          icon.className = isPass ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
        }
      };
    }
    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#oemail").value.trim(), pw = $("#opw").value, name = $("#oname").value.trim();
      var clubName = $("#oclub") ? $("#oclub").value.trim() : "";
      if (!name || !email || pw.length < 6) return setMsg(app, "Enter your name, your email and a password of at least 6 characters.", "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      var btn = $("#go");
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[20px]">progress_activity</span><span>Creating Club Account...</span>';
      setMsg(app, "", "");
      var res = await sb.auth.signUp({
        email: email,
        password: pw,
        options: {
          captchaToken: cap.token,
          emailRedirectTo: location.origin + location.pathname,
          data: { account_type: "tenant", full_name: name, club_name: clubName }
        }
      });
      cap.reset();
      btn.disabled = false;
      if (res.error) {
        btn.innerHTML = '<span>Create club account</span><i class="fa-solid fa-arrow-right text-xs"></i>';
        return setMsg(app, friendly(res.error), "err");
      }
      $("#f").reset();
      if (pwInput) pwInput.type = "password";
      var passwordIcon = $("#pw-toggle-icon");
      if (passwordIcon) passwordIcon.className = "fa-regular fa-eye";
      if (!res.data.session) {
        setPending({ as: "tenant", join: null, next: "/register-club", dn: name, club_name: clubName });
        return setMsg(app, "Club account created. Check your email and click the confirmation link, then add your club details.", "ok");
      }
      await refreshSession();
      go("/register-club");
    };
  }

  function viewRegisterClub() {
    if (!state.user) return viewClubSignup(); // clubs have their own sign-up, separate from players
    if (state.accountType === "player" && !state.managedSlug) {
      app.innerHTML =
        '<div class="w-full flex-1 flex items-center justify-center px-4 py-8 lg:py-14 court-grid-pattern">' +
        '<div class="max-w-xl w-full mx-auto rounded-3xl glass-panel glow-border p-7 sm:p-10 border border-brand-border text-center">' +
        '<div class="w-12 h-12 rounded-2xl bg-brand-neon/10 border border-brand-neon/30 text-brand-neon flex items-center justify-center mx-auto mb-4"><i class="fa-solid fa-user-lock text-lg"></i></div>' +
        '<h1 class="text-2xl font-mono font-bold text-white mb-2">This is a player account</h1>' +
        '<p class="text-slate-400 text-sm leading-relaxed mb-6">Club owners register with a separate <strong class="text-white">club account</strong>, so players and clubs never mix. Sign out and register your club with a different email.</p>' +
        '<div class="flex flex-col sm:flex-row items-center justify-center gap-3">' +
        '<button class="w-full sm:w-auto px-6 py-3 rounded-full bg-brand-neon hover:bg-brand-neonHover text-brand-dark font-mono text-xs font-bold uppercase tracking-wider neon-glow-btn" id="so-club" type="button">Sign out and register a club</button>' +
        '<a class="w-full sm:w-auto px-6 py-3 rounded-full bg-brand-surfaceDim hover:bg-brand-surfaceLow text-slate-200 border border-brand-border font-mono text-xs font-semibold no-underline text-center" href="#/me">Back to my account</a>' +
        '</div>' +
        '</div></div>';
      $("#so-club").onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/register-club"); };
      return;
    }
    if (state.managedSlug) {
      app.innerHTML =
        '<div class="w-full flex-1 flex items-center justify-center px-4 py-8 lg:py-14 court-grid-pattern">' +
        '<div class="max-w-xl w-full mx-auto rounded-3xl glass-panel glow-border p-7 sm:p-10 border border-brand-border text-center">' +
        '<div class="w-12 h-12 rounded-2xl bg-brand-neon/10 border border-brand-neon/30 text-brand-neon flex items-center justify-center mx-auto mb-4"><i class="fa-solid fa-circle-check text-lg"></i></div>' +
        '<h1 class="text-2xl font-mono font-bold text-white mb-2">You already have a club</h1>' +
        '<p class="text-slate-400 text-sm leading-relaxed mb-6">One account can manage one club. Open your dashboard to manage courts, schedules, and bookings.</p>' +
        '<p><a class="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-brand-neon hover:bg-brand-neonHover text-brand-dark font-mono text-xs font-bold uppercase tracking-wider neon-glow-btn no-underline" href="#/admin/' + esc(state.managedSlug) + '"><span>Open my dashboard</span><i class="fa-solid fa-arrow-right text-xs"></i></a></p>' +
        '</div></div>';
      return;
    }

    var pendingClub = (getPending() && getPending().club_name) || (state.user && state.user.user_metadata && state.user.user_metadata.club_name) || "";
    app.innerHTML =
      '<div class="w-full flex-1 flex items-center justify-center px-4 py-8 lg:py-14 court-grid-pattern">' +
      '<div class="max-w-3xl w-full mx-auto rounded-3xl glass-panel glow-border p-7 sm:p-10 border border-brand-border">' +
      '<div class="mb-6">' +
      '<div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-neon/15 text-brand-neon text-[11px] font-mono font-semibold tracking-wider uppercase mb-3 border border-brand-neon/30">' +
      '<i class="fa-solid fa-building text-[10px]"></i> STEP 2: CLUB PROFILE' +
      '</div>' +
      '<h1 class="text-2xl sm:text-3xl font-mono font-bold text-white tracking-tight">Complete your club profile</h1>' +
      '<p class="text-xs sm:text-sm text-slate-400 mt-2 leading-relaxed">Your club appears publicly after the platform admin approves it. You can configure courts and pricing in the meantime.</p>' +
      '</div>' +
      '<form id="f" class="space-y-4" novalidate>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div class="space-y-1.5"><label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="name">Club name</label>' +
      '<input class="w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" id="name" maxlength="80" required placeholder="e.g. Apex Pickleball Center" value="' + esc(pendingClub) + '"></div>' +
      '<div class="space-y-1.5"><label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="slug">Club address link</label>' +
      '<input class="w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" id="slug" maxlength="40" required placeholder="apex-pickleball"></div>' +
      '</div>' +
      '<p class="text-xs font-mono text-brand-neon/80" id="slugprev"></p>' +
      '<div class="space-y-1.5"><label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="desc">Description</label>' +
      '<textarea class="w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" id="desc" rows="3" placeholder="Tell players about your facility, courts, and amenities..."></textarea></div>' +
      '<div id="phbox"></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div class="space-y-1.5"><label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="cemail">Contact email</label>' +
      '<input class="w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" id="cemail" type="email" placeholder="contact@yourclub.com"></div>' +
      '<div class="space-y-1.5"><label class="block font-mono text-xs uppercase font-medium text-slate-300 tracking-wider" for="cphone">Contact phone</label>' +
      '<input class="w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" id="cphone" placeholder="(555) 000-0000"></div>' +
      '</div>' +
      '<div class="pt-1"><div id="cap" class="cap"></div><p class="msg" role="alert"></p></div>' +
      '<div class="pt-3">' +
      '<button class="w-full py-3.5 px-6 rounded-xl font-mono text-sm font-bold uppercase tracking-wider bg-brand-neon hover:bg-brand-neonHover text-brand-dark neon-glow-btn flex items-center justify-center gap-2" id="go" type="submit">' +
      '<span>Submit for approval</span><i class="fa-solid fa-arrow-right text-xs"></i>' +
      '</button></div>' +
      '</form></div></div>';

    var phc = window.DS.ph.mount($("#phbox"), { manager: true, required: true, cls: {
      label: "font-mono text-xs uppercase font-medium text-slate-300 tracking-wider",
      input: "w-full px-4 py-2.5 bg-brand-surfaceDim/90 border border-brand-border text-slate-100 rounded-xl text-sm placeholder:text-slate-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon" } });
    var cap = mountCaptcha($("#cap")), touched = !!pendingClub;
    function prev() { $("#slugprev").textContent = "Your page: #/c/" + ($("#slug").value || "..."); }
    if (pendingClub) {
      $("#slug").value = slugify(pendingClub);
      prev();
    }
    $("#name").oninput = function () { if (!touched) $("#slug").value = slugify($("#name").value); prev(); };
    $("#slug").oninput = function () { touched = true; this.value = slugify(this.value); prev(); };
    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      var addrErr = phc.validate();
      if (addrErr) return setMsg(app, addrErr, "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      var ad = phc.get();
      $("#go").disabled = true;
      $("#go").innerHTML = '<span class="material-symbols-outlined animate-spin text-[20px]">progress_activity</span><span>Submitting Profile...</span>';
      setMsg(app, "", "");
      var v = await sb.functions.invoke("verify-turnstile", { body: { token: cap.token, purpose: "register_club" } });
      if (v.error || !v.data || !v.data.success) {
        var why = "";
        try {
          var body = v.error && v.error.context && v.error.context.json ? await v.error.context.json() : v.data;
          why = body ? (body.error || "") + (body.codes && body.codes.length ? " [" + body.codes.join(", ") + "]" : "") +
            (body.detail ? ": " + body.detail : "") + (body.message ? ": " + body.message : "") : "";
        } catch (_) { why = (v.error && v.error.message) || ""; }
        cap.reset();
        $("#go").disabled = false;
        $("#go").innerHTML = '<span>Submit for approval</span><i class="fa-solid fa-arrow-right text-xs"></i>';
        return setMsg(app, MESSAGES.captcha_failed + (why ? " (" + why + ")" : ""), "err");
      }
      var r = await sb.rpc("register_club", {
        p_name: $("#name").value.trim(), p_slug: $("#slug").value, p_description: $("#desc").value.trim() || null,
        p_address: ad.address, p_city: ad.city,
        p_contact_email: $("#cemail").value.trim() || null, p_contact_phone: $("#cphone").value.trim() || null
      });
      cap.reset();
      $("#go").disabled = false;
      $("#go").innerHTML = '<span>Submit for approval</span><i class="fa-solid fa-arrow-right text-xs"></i>';
      if (r.error) return setMsg(app, friendly(r.error), "err");
      // the registration function takes the basic fields; the full Philippine address is saved on the new club right after
      await sb.from("tenants").update({ manager_name: ad.manager_name, street: ad.street, barangay: ad.barangay, province: ad.province,
        zip_code: ad.zip_code, psgc_province: ad.psgc_province, psgc_city: ad.psgc_city, psgc_barangay: ad.psgc_barangay }).eq("id", r.data.id);
      await refreshSession();
      app.innerHTML =
        '<div class="w-full flex-1 flex items-center justify-center px-4 py-8 lg:py-14 court-grid-pattern">' +
        '<div class="max-w-xl w-full mx-auto rounded-3xl glass-panel glow-border p-7 sm:p-10 border border-brand-border text-center">' +
        '<div class="w-12 h-12 rounded-2xl bg-brand-neon/10 border border-brand-neon/30 text-brand-neon flex items-center justify-center mx-auto mb-4"><i class="fa-solid fa-circle-check text-lg"></i></div>' +
        '<h1 class="text-2xl font-mono font-bold text-white mb-2">Club Submitted!</h1>' +
        '<p class="text-slate-400 text-sm leading-relaxed mb-6"><strong class="text-white">' + esc(r.data.name) +
        '</strong> was submitted. It stays hidden until the platform admin approves it. You can configure your courts and slots in the meantime.</p>' +
        '<p><a class="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-brand-neon hover:bg-brand-neonHover text-brand-dark font-mono text-xs font-bold uppercase tracking-wider neon-glow-btn no-underline" href="#/admin/' + esc(r.data.slug) + '"><span>Open my dashboard</span><i class="fa-solid fa-arrow-right text-xs"></i></a></p>' +
        '</div></div>';
    };
  }

  // /#/me is the PLAYER dashboard (js/player.js). Club accounts never land here.
  async function viewMe(section) {
    if (!requireUser("/me")) return;
    if (state.managedSlug) return go("/admin/" + state.managedSlug); // owners and staff use the dashboard
    if (state.accountType === "tenant") return go("/club-setup"); // club account: add the club first
    return (await ensureViewModule("player")).render(section || "overview");
  }

  async function viewPlatform() {
    if (!requireUser("/platform")) return;
    if (!state.isPlatform) { app.innerHTML = '<div class="pubwrap"><h2>Not allowed</h2><p>This page is for the platform admin.</p></div>'; return; }
    var filter = "pending", all = [];
    var TITLES = {
      pending: ["Pending approval", "Clubs waiting for your decision."], approved: ["Approved clubs", "Clubs visible to the public."],
      rejected: ["Rejected clubs", "Clubs you declined."], suspended: ["Suspended clubs", "Clubs hidden from the public."],
      all: ["All clubs", "Every club on DINKSLOT."]
    };
    var ui = window.DS.ui.dash(app, {
      head: { title: "Super admin", sub: state.user.email, initial: "S" },
      items: [
        { type: "label", label: "Clubs" },
        { key: "pending", label: "Pending approval", icon: "hourglass_top", badge: "" },
        { key: "approved", label: "Approved", icon: "check_circle", badge: "" },
        { key: "rejected", label: "Rejected", icon: "cancel", badge: "" },
        { key: "suspended", label: "Suspended", icon: "block", badge: "" },
        { key: "all", label: "All clubs", icon: "apps", badge: "" }
      ],
      foot: [{ label: "View public site", icon: "public", href: "#/" }],
      active: "pending",
      onSelect: function (k) { filter = k; draw(); }
    });
    ui.main.innerHTML = '<div class="tiles" id="stats"></div>' +
      '<div class="searchrow"><span class="mi" aria-hidden="true">search</span><input id="sq" type="search" placeholder="Search clubs, owners, cities" aria-label="Search"></div>' +
      '<p class="msg" role="alert"></p><div id="list" class="space-y-3"><div class="h-16 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-16 rounded-xl bg-surface-container-high/40 ds-skeleton"></div><div class="h-16 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div>';
    function draw() {
      var q = $("#sq").value.trim().toLowerCase();
      var rows = all.filter(function (c) {
        return (filter === "all" || c.status === filter) &&
          (!q || [c.name, c.slug, c.city, c.owner_name, c.contact_email].join(" ").toLowerCase().indexOf(q) !== -1);
      });
      var counts = { pending: 0, approved: 0, rejected: 0, suspended: 0 };
      all.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      ["pending", "approved", "rejected", "suspended"].forEach(function (k) { ui.setBadge(k, counts[k] || ""); });
      ui.setBadge("all", all.length || "");
      var t = TITLES[filter]; ui.setTitle(t[0], t[1]);
      $("#stats").innerHTML = [["pending", "Pending", "hourglass_top"], ["approved", "Approved", "check_circle"], ["rejected", "Rejected", "cancel"], ["suspended", "Suspended", "block"]].map(function (x) {
        return '<div class="tile ' + (x[0] === "pending" && counts.pending ? "warn" : "") + '"><span class="mi">' + x[2] + "</span><b>" + counts[x[0]] + "</b><span>" + x[1] + "</span></div>";
      }).join("");
      $("#list").innerHTML = rows.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Club</th><th>Owner</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(function (c) {
          var b = function (d, label, cls) { return '<button class="btn sm ' + (cls || "") + '" data-id="' + esc(c.id) + '" data-d="' + d + '">' + label + "</button> "; };
          return "<tr><td><strong>" + esc(c.name) + '</strong><br><span class="muted small">/c/' + esc(c.slug) + (c.city ? " - " + esc(c.city) : "") + "</span></td><td>" +
            esc(c.manager_name || c.owner_name || "") + (c.manager_name && c.owner_name && c.manager_name !== c.owner_name ? ' <span class="muted small">(account: ' + esc(c.owner_name) + ")</span>" : "") + (c.province ? '<br><span class="muted small">' + esc([c.city, c.province].filter(Boolean).join(", ")) + "</span>" : "") + (c.contact_email ? '<br><span class="muted small">' + esc(c.contact_email) + "</span>" : "") + '</td><td class="small">' +
            esc(new Date(c.created_at).toLocaleDateString()) + '</td><td><span class="badge ' + esc(c.status) + '">' + esc(c.status) + '</span></td><td class="nowrap">' +
            (c.status !== "approved" ? b("approved", "Approve") : "") + (c.status === "pending" ? b("rejected", "Reject", "danger") : "") +
            (c.status === "approved" ? b("suspended", "Suspend", "danger") : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : window.DS.ui.emptyState('No clubs to display', 'Clubs will appear here when they are available.', 'storefront');
      bind();
    }
    $("#sq").oninput = draw;
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
          var confirmation = await window.DS.ui.confirmAction("Change this club?s status to " + d + "?", { title: "Update club status", confirmText: "Confirm change", danger: d !== "approved", reason: d !== "approved" });
          if (!confirmation) return;
          reason = confirmation.reason;
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
    requireUser: requireUser, mediaUrl: mediaUrl, hoursText: hoursText, root: function () { return app; },
    mountPublicBackdrop: function (stage) {
      if (cleanupAuthPattern) cleanupAuthPattern();
      cleanupAuthPattern = mountAuthPattern(stage);
    }
  };

  // ----------------------------------------------------------------- router
  var pendingViewModules = {};
  async function ensureViewModule(name) {
    if (window.DS[name]) return window.DS[name];
    if (!pendingViewModules[name]) {
      pendingViewModules[name] = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "js/" + name + ".js?recover=" + Date.now();
        script.onload = function () {
          script.remove();
          if (window.DS[name]) resolve(window.DS[name]);
          else reject(new Error("This page could not finish loading. Please retry."));
        };
        script.onerror = function () {
          script.remove();
          reject(new Error("Unable to load this page. Check your connection and retry."));
        };
        document.head.appendChild(script);
      });
    }
    try { return await pendingViewModules[name]; }
    finally { delete pendingViewModules[name]; }
  }

  function syncBootRouteClass(path, mode) {
    var cl = document.documentElement.classList;
    cl.remove("boot-dashboard", "boot-home", "boot-signin", "boot-signup", "boot-club");
    if (/^\/(admin|platform|me)(\/|\?|$)/.test(path)) cl.add("boot-dashboard");
    else if (path === "/register-club" || path === "/club-setup") cl.add("boot-club");
    else if (path === "/auth") cl.add(mode === "up" ? "boot-signup" : "boot-signin");
    else cl.add("boot-home");
  }

  async function render() {
    var raw = (location.hash || "#/").slice(1) || "/";
    var qs = raw.indexOf("?"), path = qs === -1 ? raw : raw.slice(0, qs);
    var q = new URLSearchParams(qs === -1 ? "" : raw.slice(qs + 1));
    syncBootRouteClass(path, q.get("mode"));
    var m;
    // Restore the current cross-tab session before rendering public account forms.
    if (path === "/auth" || path === "/register-club" || path === "/club-setup") {
      await refreshSession();
      if ((location.hash || "#/").slice(1) !== raw) return;
    }
    window.scrollTo(0, 0);
    stopLive();
    cleanupAuthPattern();
    document.body.classList.remove("auth-page", "landing-page", "tenant-dashboard-mode");
    document.body.classList.toggle("club-registration-page", path === "/register-club");
    renderNav();
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
      if (state.isPlatform && (path === "/me" || path.indexOf("/me/") === 0 || path === "/register-club" || path === "/auth")) return go("/platform");
      // Signed-in people never see sign-in / sign-up / club sign-up again: send them to their own home.
      if (state.user && path === "/auth") return go(homePath());
      if (state.user && path === "/register-club") return go(homePath());
      if (path === "/club-setup") {
        if (!state.user) return go("/auth?next=%2Fclub-setup");
        if (state.isPlatform || state.managedSlug || state.accountType === "player") return go(homePath());
        return viewRegisterClub();
      }
      if (path === "/") return await viewHome();
      if (path === "/auth") {
        var n = q.get("next"), mMode = q.get("mode"), jn = q.get("join");
        var ao = { next: n && n.charAt(0) === "/" ? n : "/me", mode: mMode };
        if (jn && /^[a-z0-9-]+$/.test(jn)) { // coming from a club page: "register to book at <club>"
          var jc = (await sb.from("public_clubs").select("name").eq("slug", jn).maybeSingle()).data;
          if (jc) {
            ao.join = jn;
            if (!ao.mode) ao.mode = "up";
            ao.title = "Register to book at " + esc(jc.name);
            ao.intro = "Create a free account to book courts at " + esc(jc.name) + ". Already registered? Switch to sign in below.";
          }
        }
        return viewAuth(ao);
      }
      if (path === "/register-club") return viewRegisterClub();
      if (path === "/guest/recover") return (await ensureViewModule("booking")).guestBookingRecover();
      if (path === "/guest/booking") return await (await ensureViewModule("booking")).guestBookingStatus(q.get("token"));
      if ((m = path.match(/^\/me(?:\/(find|clubs|bookings|profile))?$/))) return await viewMe(m[1]);
      if (path === "/platform") return await viewPlatform();
      if ((m = path.match(/^\/c\/([a-z0-9-]+)$/))) return await viewClub(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/join$/))) return await viewJoin(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/book$/))) {
        // Booking needs an account: visitors are sent to register (or sign in) for this club first.
        if (!state.user && q.get("guest") !== "1") return go("/auth?mode=up&join=" + m[1] + "&next=" + encodeURIComponent("/c/" + m[1] + "/book"));
        return await (await ensureViewModule("booking")).renderBook(m[1]);
      }
      if ((m = path.match(/^\/admin\/([a-z0-9-]+)(?:\/(courts|settings|bookings|profile|payments|staff|account))?$/))) {
        if (!requireUser(path)) return;
        return await (await ensureViewModule("admin")).render(m[1], m[2] || "dashboard");
      }
      window.DS.ui.errorPage(app, { icon: "search_off", title: "Page not found", text: "That page does not exist or has moved.", home: true });
    } catch (err) {
      window.DS.ui.errorPage(app, { icon: "error", title: "Something went wrong", text: friendly(err), retry: render, home: true });
    }
  }

  // Last line of defence: a failed request or script error should never be silent.
  window.addEventListener("unhandledrejection", function (e) {
    if (window.DS && window.DS.ui) window.DS.ui.toast(friendly(e.reason), "err");
  });
  window.addEventListener("hashchange", render);
  sb.auth.onAuthStateChange(function (ev) {
    if (ev !== "SIGNED_IN" && ev !== "SIGNED_OUT" && ev !== "USER_UPDATED") return;
    // Supabase callbacks must return before issuing more auth/database requests.
    setTimeout(async function () {
      await refreshSession();
      var path = (location.hash || "#/").slice(1).split("?")[0];
      if (path === "/auth" || path === "/register-club" || path === "/club-setup" || ev === "SIGNED_OUT") render();
    }, 0);
  });
  var startupAttempt = 0;
  async function startApp() {
    var attempt = ++startupAttempt, timer;
    document.body.classList.add("app-booting");
    var startup = document.getElementById("app-startup");
    try {
      var startupPath = (location.hash || "#/").slice(1).split("?")[0];
      var oauthCallback = new URLSearchParams(location.search).has("code");
      var publicLanding = (startupPath === "/" || startupPath === "") && !oauthCallback;
      var sessionTask = refreshSession();
      if (publicLanding) {
        // A slow auth service must not block the public landing page.
        await Promise.race([
          sessionTask.catch(function (error) { console.warn("Session restoration delayed", error); }),
          new Promise(function (resolve) { timer = setTimeout(resolve, 4000); })
        ]);
      } else {
        await Promise.race([
          sessionTask,
          new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Session restoration timed out.")); }, 20000); })
        ]);
      }
      clearTimeout(timer);
      if (attempt !== startupAttempt) return;
      await render();
      document.body.classList.remove("app-booting");
      if (startup) startup.remove();
    } catch (error) {
      clearTimeout(timer);
      console.error("Startup failed:", error);
      if (attempt !== startupAttempt || !startup) return;
      startup.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">cloud_off</span><h1>Unable to load this page</h1><p>Please check your connection and try again.</p><button type="button">Retry</button>';
      startup.querySelector("button").onclick = function () { location.reload(); };
    }
  }
  window.addEventListener("load", startApp, { once: true });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();

