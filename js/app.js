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
  var state = { user: null, isPlatform: false, managedSlug: null, accountType: null };
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
  var toastTimer = null, toastRegion = null;
  function setMsg(root, text, kind, action) {
    clearTimeout(toastTimer);
    if (toastRegion) toastRegion.replaceChildren();
    if (!text) return;
    if (!toastRegion) {
      toastRegion = document.createElement("div");
      toastRegion.className = "toast-region";
      toastRegion.setAttribute("aria-label", "Notifications");
      document.body.appendChild(toastRegion);
    }
    var toast = document.createElement("div");
    toast.className = "toast " + (kind === "err" ? "toast-error" : kind === "ok" ? "toast-success" : "toast-info");
    toast.setAttribute("role", kind === "err" ? "alert" : "status");
    toast.setAttribute("aria-atomic", "true");
    var icon = document.createElement("span");
    icon.className = "material-symbols-outlined toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = kind === "err" ? "error" : kind === "ok" ? "check_circle" : "info";
    var message = document.createElement("p");
    message.textContent = text;
    var close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u00d7";
    function dismiss() { if (toast.parentNode) { toast.remove(); if (!toastRegion.children.length) clearTimeout(toastTimer); } }
    function scheduleDismiss() {
      clearTimeout(toastTimer);
      if (!action) toastTimer = setTimeout(dismiss, kind === "err" ? 10000 : 7000);
    }
    close.onclick = dismiss;
    toast.onpointerenter = function () { clearTimeout(toastTimer); };
    toast.onpointerleave = function () { if (!toast.contains(document.activeElement)) scheduleDismiss(); };
    toast.onfocusin = function () { clearTimeout(toastTimer); };
    toast.onfocusout = scheduleDismiss;
    toast.append(icon, message);
    if (action) {
      var retry = document.createElement("button");
      retry.type = "button"; retry.className = "toast-action"; retry.textContent = action.label;
      retry.onclick = function () { dismiss(); action.run(); };
      toast.appendChild(retry);
    }
    toast.appendChild(close);
    toastRegion.appendChild(toast);
    if (!action) scheduleDismiss();
    return dismiss;
  }
  function mediaUrl(path) {
    return path ? sb.storage.from("club-media").getPublicUrl(path).data.publicUrl : "";
  }

  // -------------------------------------------------------------- Turnstile
  function mountCaptcha(container) {
    var h = { token: null, id: null };
    var tries = 0;
    var dismissCaptchaToast = function () {};
    function showCaptchaError(text) {
      if (!container.isConnected) return;
      dismissCaptchaToast = setMsg(app, text, "err", {
        label: "Retry check",
        run: function () { h.reset(); arm(); }
      }) || function () {};
    }
    var slow;
    function arm() {
      clearTimeout(slow);
      slow = setTimeout(function () {
        if (!h.token) showCaptchaError("The human check is taking longer than expected.");
      }, 20000);
    }
    (function wait() {
      if (!container.isConnected) return;
      if (window.turnstile) {
        h.id = window.turnstile.render(container, {
          sitekey: cfg.TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          callback: function (t) { h.token = t; dismissCaptchaToast(); clearTimeout(slow); },
          "expired-callback": function () { h.token = null; },
          "error-callback": function (code) {
            h.token = null; clearTimeout(slow);
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
    })();
    h.reset = function () { h.token = null; if (window.turnstile && h.id != null) window.turnstile.reset(h.id); else location.reload(); };
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
      localStorage.removeItem(PENDING_KEY);
      var o = JSON.parse(v);
      return o && Date.now() - o.at < 86400000 && (!o.join || /^[a-z0-9-]+$/.test(o.join)) ? o : null;
    } catch (e) { return null; }
  }
  async function resumePending() {
    var o = takePending();
    if (!o || !state.user) return;
    if (state.isPlatform) return go("/platform");
    if (o.as) { // a Google sign-in cannot carry the account type, so set it now (locked after the first choice)
      var ct = await sb.rpc("choose_account_type", { p_type: o.as });
      if (!ct.error) { state.accountType = o.as; renderNav(); }
    }
    if (o.join) {
      var j = await sb.rpc("join_club", { p_slug: o.join, p_display_name: (o.dn || (state.user.email || "").split("@")[0] || "Player").slice(0, 60) });
      if (j.error) return;
    }
    if (o.next && o.next.charAt(0) === "/") go(o.next);
  }

  async function refreshSession() {
    var r = await sb.auth.getSession();
    state.user = r.data.session ? r.data.session.user : null;
    state.isPlatform = false;
    state.managedSlug = null;
    state.accountType = null;
    if (state.user) {
      // Filter to our own row: a platform admin can read every profile, so maybeSingle() alone would fail.
      var p = await sb.from("profiles").select("is_platform_admin,account_type").eq("auth_user_id", state.user.id).maybeSingle();
      state.isPlatform = !!(p.data && p.data.is_platform_admin);
      state.accountType = (p.data && p.data.account_type) || null; // 'player' | 'tenant' | null (not chosen yet)
      if (!state.isPlatform) {
        // Club owners and staff go straight to their dashboard instead of a separate account page.
        var m = await sb.from("tenant_members").select("tenants(slug)").eq("user_id", state.user.id).order("created_at").limit(1);
        var row = m.data && m.data[0];
        state.managedSlug = row && row.tenants ? row.tenants.slug : null;
      }
    }
    renderNav();
    if (state.user) resumePending(); // finish a booking intent started before sign-up / confirmation
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
      var acctHref = state.managedSlug ? "#/admin/" + esc(state.managedSlug) : state.accountType === "tenant" ? "#/register-club" : "#/me";
      var acctLabel = state.managedSlug ? "Dashboard" : state.accountType === "tenant" ? "Set up my club" : "My account";
      h += '<span id="bellslot" class="dashboard-bellslot"></span>' +
        '<details class="facility-account"><summary aria-label="Account menu"><span class="facility-avatar">' + esc(initial) + '</span>' +
        '<span class="facility-account-text"><strong>' + esc(profileName) + '</strong><small>' + acctLabel + '</small></span>' +
        '<span class="material-symbols-outlined facility-chevron" aria-hidden="true">expand_more</span></summary>' +
        '<div class="facility-account-menu public-account-menu"><div class="public-account-heading"><span class="public-account-caption">Signed in as</span><strong>' + esc(profileName) + '</strong><span class="facility-account-email">' + esc(state.user.email || "") + '</span></div>' +
        '<a href="' + acctHref + '"><span class="material-symbols-outlined" aria-hidden="true">dashboard</span><span>' + acctLabel + '</span></a>' +
        '<a href="#/me"><span class="material-symbols-outlined" aria-hidden="true">account_circle</span><span>My Profile</span></a>' +
        '<button id="signout" type="button"><span class="material-symbols-outlined" aria-hidden="true">logout</span><span>Sign out</span></button></div></details>' +
        (state.managedSlug || state.accountType === "player" ? "" : '<a href="#/register-club" class="pill nav-register"><span class="material-symbols-outlined" aria-hidden="true">add</span><span>Register club</span></a>');
    } else {
      h += '<a href="#/auth?mode=in">Sign in</a><a href="#/auth?mode=up">Sign up</a><a href="#/register-club" class="pill">Register your club</a>';
    }
    nav.innerHTML = h;
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
    var cr = (await sb.from("public_courts").select("club_slug,hourly_rate,is_indoor,surface")).data || [];
    var info = {};
    cr.forEach(function (c) {
      var i = info[c.club_slug] || (info[c.club_slug] = { n: 0, min: Infinity, indoor: 0, outdoor: 0, surfaces: [] });
      i.n++;
      i.min = Math.min(i.min, Number(c.hourly_rate));
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
                  '<span class="material-symbols-outlined text-label-md">pin_drop</span> ' + esc(c.city || c.address || "Metro Manila") +
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
    var hrs = courts.length ? String(courts.map(function (k) { return String(k.open_time).slice(0, 5); }).sort()[0]) + " - " +
      String(courts.map(function (k) { return String(k.close_time).slice(0, 5); }).sort().slice(-1)[0]) : "";
    var nextPath = encodeURIComponent("/c/" + slug + "/book");
    var bookHref = state.user ? "#/c/" + esc(slug) + "/book" : "#/auth?mode=up&join=" + esc(slug) + "&next=" + nextPath;
    var signInHref = "#/auth?mode=in&join=" + esc(slug) + "&next=" + nextPath;
    var chip = function (icon, text) { return text ? '<span class="chip"><span class="mi">' + icon + "</span>" + esc(text) + "</span>" : ""; };
    app.innerHTML =
      '<div class="pubwrap"><a class="back" href="#/">&larr; All clubs</a>' +
      '<section class="clubbanner">' + (c.cover_path ? '<img src="' + esc(mediaUrl(c.cover_path)) + '" alt="">' : '<div class="ph"></div>') + "</section>" +
      '<section class="clubid"><div class="bigcircle">' + (c.logo_path ? '<img src="' + esc(mediaUrl(c.logo_path)) + '" alt="">' : "<span>" + esc(c.name.charAt(0).toUpperCase()) + "</span>") + "</div>" +
      '<div class="clubid-text"><h1>' + esc(c.name) + '</h1><div class="chips">' +
      chip("location_on", [c.address, c.city].filter(Boolean).join(", ")) + chip("call", c.contact_phone) + chip("schedule", hrs) +
      chip("sports_tennis", courts.length + (courts.length === 1 ? " court" : " courts")) + "</div></div>" +
      '<div class="bookcta"><a class="btn" href="' + bookHref + '">' + (state.user ? "Book a court" : "Sign up to book") + "</a>" +
      (state.user ? "" : '<span class="muted small">Free account needed. Already registered? <a href="' + signInHref + '">Sign in</a></span>') + "</div></section>" +
      (c.description ? '<section class="about"><h2>About</h2><p>' + esc(c.description) + "</p></section>" : "") +
      '<div class="sectionhead"><h2>Courts</h2></div>' +
      (courts.length ? '<div class="courtgrid">' + courts.map(function (k) {
        return '<div class="courtcard"><div class="cc-top"><h3>' + esc(k.name) + '</h3><span class="chip">' + (k.is_indoor ? "Indoor" : "Outdoor") + "</span></div>" +
          '<p class="cc-rate"><b>PHP ' + esc(Number(k.hourly_rate).toFixed(2)) + "</b><span>/hr</span></p>" +
          '<p class="muted small"><span class="mi">schedule</span>' + esc(String(k.open_time).slice(0, 5)) + " - " + esc(String(k.close_time).slice(0, 5)) +
          " &middot; " + esc(String(k.slot_minutes)) + " min slots" + (k.surface ? " &middot; " + esc(k.surface) : "") + "</p>" +
          '<a class="btn sm" href="' + bookHref + '">' + (state.user ? "Book" : "Sign up to book") + "</a></div>";
      }).join("") + "</div>" : '<p class="muted">This club has not listed its courts yet.</p>') + "</div>";
  }

  // Bend only the decorative mesh; the form remains on a stationary surface.
  function mountAuthPattern(stage) {
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
        '<span id="go-text">Sign In to Court</span>' +
        '<span class="material-symbols-outlined text-[22px] font-bold">arrow_forward</span>' +
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
        $("#go").innerHTML = '<span id="go-text">Sign In to Court</span><span class="material-symbols-outlined text-[22px] font-bold">arrow_forward</span>';
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
        '<span>Create Free Account</span>' +
        '<span class="material-symbols-outlined text-[22px]">sports_tennis</span>' +
        '</button>' +
        '</form>' +
        '<!-- Bottom Card Switcher -->' +
        '<div class="flex items-center justify-center gap-1.5 pt-2 font-body-sm text-body-sm text-on-surface-variant">' +
        '<span>Already have an account?</span>' +
        '<a id="switch-btn" class="font-label-md text-label-md text-primary font-semibold hover:underline" href="#">Sign In</a>' +
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
        $("#go").innerHTML = '<span>Create Free Account</span><span class="material-symbols-outlined text-[22px]">sports_tennis</span>';
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
          var dn = ($("#dn") && $("#dn").value.trim()) || fullName || email.split("@")[0];
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
    setPending({ as: "tenant", join: null, next: "/register-club", dn: "" });
    var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
    if (r.error) setMsg(app, friendly(r.error), "err");
  }

  // Step 1 for clubs, separate from player sign-up: create a CLUB account.
  function viewClubSignup() {
    app.innerHTML =
      '<section class="panel"><span class="eyebrow">For clubs and court owners</span><h1>Register your club</h1>' +
      '<p>Create a club account first. After you confirm your email you add your club details, and the platform admin approves it before it goes public.</p>' +
      '<p class="muted small">Want to book a court instead? <a href="#/auth?mode=up">Sign up as a player</a>.</p>' +
      '<form id="f" novalidate><label>Your name<input id="oname" maxlength="80" autocomplete="name" required></label>' +
      '<label>Email<input id="oemail" type="email" autocomplete="email" required></label>' +
      '<label>Password (6 or more characters)<input id="opw" type="password" minlength="6" autocomplete="new-password" required></label>' +
      '<div id="cap" class="cap"></div><p class="msg" role="alert"></p>' +
      '<button class="btn" id="go" type="submit">Create club account</button></form>' +
      '<p class="muted small" style="text-align:center;margin:.9rem 0">or</p>' +
      '<button class="btn ghost" id="ogoogle" type="button" style="width:100%">Continue with Google</button>' +
      '<p class="muted small">Already have a club account? <a href="#/auth?mode=in&next=%2Fregister-club">Sign in</a></p></section>';
    var cap = mountCaptcha($("#cap"));
    $("#ogoogle").onclick = googleForClub;
    $("#f").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#oemail").value.trim(), pw = $("#opw").value, name = $("#oname").value.trim();
      if (!name || !email || pw.length < 6) return setMsg(app, "Enter your name, your email and a password of at least 6 characters.", "err");
      if (!cap.token) return setMsg(app, MESSAGES.captcha_required, "err");
      var btn = $("#go"); btn.disabled = true; setMsg(app, "Creating your club account...", "");
      var res = await sb.auth.signUp({ email: email, password: pw, options: { captchaToken: cap.token,
        emailRedirectTo: location.origin + location.pathname, data: { account_type: "tenant", full_name: name } } });
      cap.reset(); btn.disabled = false;
      if (res.error) return setMsg(app, friendly(res.error), "err");
      if (!res.data.session) {
        setPending({ as: "tenant", join: null, next: "/register-club", dn: name });
        return setMsg(app, "Club account created. Check your email and click the confirmation link, then add your club details.", "ok");
      }
      await refreshSession();
      go("/register-club");
    };
  }

  function viewRegisterClub() {
    if (!state.user) return viewClubSignup(); // clubs have their own sign-up, separate from players
    if (state.accountType === "player" && !state.managedSlug) {
      app.innerHTML = '<section class="panel"><h1>This is a player account</h1>' +
        '<p>Club owners register with a separate <b>club account</b>, so players and clubs never mix. Sign out and register your club with a different email.</p>' +
        '<p><button class="btn" id="so-club" type="button">Sign out and register a club</button> <a class="btn ghost" href="#/me">Back to my account</a></p></section>';
      $("#so-club").onclick = async function () { await sb.auth.signOut(); await refreshSession(); go("/register-club"); };
      return;
    }
    if (state.managedSlug) {
      app.innerHTML = '<section class="panel"><h1>You already have a club</h1>' +
        '<p>One account can manage one club. Open your dashboard to manage it.</p>' +
        '<p><a class="btn" href="#/admin/' + esc(state.managedSlug) + '">Open my dashboard</a></p></section>';
      return;
    }
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
      await refreshSession();
      app.innerHTML = '<section class="panel"><h1>Thanks!</h1><p><strong>' + esc(r.data.name) +
        '</strong> was submitted. It stays hidden until the platform admin approves it. You can set it up in the meantime.</p>' +
        '<p><a class="btn" href="#/admin/' + esc(r.data.slug) + '">Open my dashboard</a></p></section>';
    };
  }

  async function viewMe() {
    if (!requireUser("/me")) return;
    if (state.managedSlug) return go("/admin/" + state.managedSlug); // owners and staff use the dashboard
    if (state.accountType === "tenant") return go("/register-club"); // club account: add the club first
    var initial = (state.user.email || "?").charAt(0).toUpperCase();
    app.innerHTML =
      '<div class="pubwrap narrow"><div class="acchead"><span class="avatar big ph">' + esc(initial) + "</span>" +
      '<div><h1>My account</h1><p class="muted">' + esc(state.user.email) + "</p></div></div>" +
      '<p class="msg ok" role="status"></p>' +
      '<section class="card2"><h2>My Profile</h2><form id="myprofile"><div class="grid2">' +
      '<label>Full name<input id="mp-name" maxlength="80" autocomplete="name"></label>' +
      '<label>Phone<input id="mp-phone" maxlength="30" autocomplete="tel"></label></div>' +
      '<p class="muted small">Email: ' + esc(state.user.email) + '</p><p class="msg" role="alert"></p>' +
      '<button class="btn sm" type="submit">Save profile</button></form></section>' +
      '<section class="card2"><h2>Clubs you manage</h2><div id="mine"><div class="space-y-3"><div class="h-14 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-14 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div></div></section>' +
      '<section class="card2"><h2>My bookings</h2><div id="mybookings"><div class="space-y-3"><div class="h-16 rounded-xl bg-surface-container-high/60 ds-skeleton"></div><div class="h-16 rounded-xl bg-surface-container-high/40 ds-skeleton"></div></div></div></section></div>';
    var known = {};
    async function loadMine(announce) {
      var m = await sb.from("tenant_members").select("role, tenants(id, slug, name, status, logo_path)").eq("user_id", state.user.id);
      if (!$("#mine")) return; // user navigated away
      var rows = m.data || [];
      rows.forEach(function (x) {
        var t = x.tenants || {};
        if (announce && known[t.id] && known[t.id] !== t.status) {
          setMsg(app, t.name + " is now " + t.status + "!", t.status === "approved" ? "ok" : "err");
        }
        known[t.id] = t.status;
      });
      $("#mine").innerHTML = rows.length ? rows.map(function (x) {
        var t = x.tenants || {};
        return '<div class="clubrow"><span class="avatar ph">' + (t.logo_path ? '<img src="' + esc(mediaUrl(t.logo_path)) + '" alt="">' : esc((t.name || "?").charAt(0).toUpperCase())) + "</span>" +
          '<div class="clubrow-text"><b>' + esc(t.name) + '</b> <span class="badge ' + esc(t.status) + '">' + esc(t.status) + "</span>" +
          '<span class="muted small"> ' + esc(x.role) + "</span>" +
          (t.status === "pending" ? '<p class="muted small">Waiting for approval. This page updates by itself.</p>' : "") + "</div>" +
          '<div class="clubrow-actions"><a class="btn sm" href="#/admin/' + esc(t.slug) + '">Dashboard</a>' +
          (t.status === "approved" ? ' <a class="btn sm ghost" href="#/c/' + esc(t.slug) + '">Public page</a>' : "") + "</div></div>";
      }).join("") : '<p class="muted">You do not manage a club yet.</p><a class="btn sm" href="#/register-club">Register your club</a>';
    }
    // Personal profile (own row only; RLS and column grants allow full_name and phone).
    sb.from("profiles").select("full_name,phone").eq("auth_user_id", state.user.id).maybeSingle().then(function (r) {
      if (!$("#mp-name")) return;
      $("#mp-name").value = (r.data && r.data.full_name) || "";
      $("#mp-phone").value = (r.data && r.data.phone) || "";
    });
    $("#myprofile").onsubmit = async function (e) {
      e.preventDefault();
      var f = this, btn = f.querySelector("button");
      btn.disabled = true;
      var r = await sb.from("profiles").update({ full_name: $("#mp-name").value.trim() || null, phone: $("#mp-phone").value.trim() || null })
        .eq("auth_user_id", state.user.id);
      btn.disabled = false;
      setMsg(f, r.error ? friendly(r.error) : "Profile saved.", r.error ? "err" : "ok");
    };
    await loadMine(false);
    if (window.DS.booking) window.DS.booking.myBookings($("#mybookings"));
    // Live update: when the super admin decides, the status changes here without a refresh.
    // Realtime only delivers rows this user may read (RLS). Polling is a safety net.
    liveChannel = sb.channel("my-clubs-" + state.user.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenants" }, function () { loadMine(true); })
      .subscribe();
    livePoll = setInterval(function () { loadMine(true); }, 20000);
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
            esc(c.owner_name || "") + (c.contact_email ? '<br><span class="muted small">' + esc(c.contact_email) + "</span>" : "") + '</td><td class="small">' +
            esc(new Date(c.created_at).toLocaleDateString()) + '</td><td><span class="badge ' + esc(c.status) + '">' + esc(c.status) + '</span></td><td class="nowrap">' +
            (c.status !== "approved" ? b("approved", "Approve") : "") + (c.status === "pending" ? b("rejected", "Reject", "danger") : "") +
            (c.status === "approved" ? b("suspended", "Suspend", "danger") : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<p class="muted">No clubs here.</p>';
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
    cleanupAuthPattern();
    document.body.classList.remove("auth-page", "landing-page", "tenant-dashboard-mode");
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
      if (path === "/me") return await viewMe();
      if (path === "/platform") return await viewPlatform();
      if ((m = path.match(/^\/c\/([a-z0-9-]+)$/))) return await viewClub(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/join$/))) return await viewJoin(m[1]);
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/book$/))) {
        // Booking needs an account: visitors are sent to register (or sign in) for this club first.
        if (!state.user) return go("/auth?mode=up&join=" + m[1] + "&next=" + encodeURIComponent("/c/" + m[1] + "/book"));
        return await window.DS.booking.renderBook(m[1]);
      }
      if ((m = path.match(/^\/admin\/([a-z0-9-]+)(?:\/(courts|settings|bookings|profile|payments|staff|account))?$/))) {
        if (!requireUser(path)) return;
        return await window.DS.admin.render(m[1], m[2] || "dashboard");
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
  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") refreshSession(); });
  refreshSession().then(render);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();

