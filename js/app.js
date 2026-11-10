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
    forbidden: "You do not have permission to do that."
  };
  function friendly(err) {
    var m = (err && (err.message || err.msg)) || String(err || "");
    for (var k in MESSAGES) if (m.indexOf(k) !== -1) return MESSAGES[k];
    return m || "Something went wrong.";
  }
  var toastTimer = null, toastRegion = null;
  function setMsg(root, text, kind) {
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
    function dismiss() { clearTimeout(toastTimer); toast.remove(); }
    function scheduleDismiss() {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(dismiss, kind === "err" ? 10000 : 7000);
    }
    close.onclick = dismiss;
    toast.onpointerenter = function () { clearTimeout(toastTimer); };
    toast.onpointerleave = function () { if (!toast.contains(document.activeElement)) scheduleDismiss(); };
    toast.onfocusin = function () { clearTimeout(toastTimer); };
    toast.onfocusout = scheduleDismiss;
    toast.append(icon, message, close);
    toastRegion.appendChild(toast);
    scheduleDismiss();
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
    var fallbackImages = [
      "https://lh3.googleusercontent.com/aida/ADBb0uhF1F56iA2o15k6p2p0x8V2u1xY7y9Z0q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c2v3b4n5m",
      "https://lh3.googleusercontent.com/aida/ADBb0ugw3e4r5t6y7u8i9o0p1a2s3d4f5g6h7j8k9l0z1x2c3v4b5n6m7q8w9e0r1t2y3u4i5o6p7a8s9d0f1g2h",
      "https://lh3.googleusercontent.com/aida/ADBb0ujk8l9z0x1c2v3b4n5m6q7w8e9r0t1y2u3i4o5p6a7s8d9f0g1h2j3k4l5z6x7c8v9b0n1m2q3w4e5r6t7y",
      "https://lh3.googleusercontent.com/aida/ADBb0ul1z2x3c4v5b6n7m8q9w0e1r2t3y4u5i6o7p8a9s0d1f2g3h4j5k6l7z8x9c0v1b2n3m4q5w6e7r8t9y0u"
    ];

    app.innerHTML =
      '<div id="ds-home-screen" class="relative overflow-hidden bg-surface text-on-surface">' +
        '<!-- HERO SECTION -->' +
        '<section class="relative pt-12 pb-20 lg:pt-20 lg:pb-28 overflow-hidden">' +
          '<div class="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-primary/10 blur-[140px] rounded-full pointer-events-none -z-10"></div>' +
          '<div class="absolute top-40 right-0 w-[400px] h-[400px] bg-secondary/5 blur-[120px] rounded-full pointer-events-none -z-10"></div>' +
          '<div class="max-w-7xl mx-auto px-margin lg:px-margin-desktop">' +
            '<div class="text-center max-w-4xl mx-auto mb-12">' +
              '<div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container-high border border-outline-variant/40 mb-6">' +
                '<span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>' +
                '<span class="font-label-md text-primary tracking-wider uppercase">🎾 THE #1 PICKLEBALL RESERVATION &amp; DUPR NETWORK</span>' +
              '</div>' +
              '<h1 class="font-headline-display-mobile lg:font-headline-display text-on-surface tracking-tight mb-6">' +
                'Book Your Slot. <br class="hidden sm:inline"/>' +
                '<span class="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary-container to-secondary">Own the Court.</span>' +
              '</h1>' +
              '<p class="font-body-lg text-on-surface-variant max-w-2xl mx-auto mb-10">' +
                'Instant court reservations, automated split-payments, and live DUPR skill-matched open play at premier pickleball venues near you.' +
              '</p>' +
              '<!-- Interactive Quick Search Bar -->' +
              '<div class="bg-surface-container/90 backdrop-blur-xl p-3 rounded-lg border border-outline-variant/40 shadow-2xl max-w-4xl mx-auto">' +
                '<div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">' +
                  '<div class="md:col-span-4 flex items-center gap-3 bg-surface-container-lowest px-4 py-3.5 rounded-DEFAULT border border-transparent focus-within:border-primary/50 transition-colors text-left">' +
                    '<span class="material-symbols-outlined text-primary text-xl">location_on</span>' +
                    '<div class="flex-1 min-w-0">' +
                      '<label for="q" class="block font-label-sm text-outline uppercase tracking-wider">Location or Club</label>' +
                      '<input id="q" type="search" placeholder="Search clubs or cities..." aria-label="Search clubs" class="w-full bg-transparent text-on-surface font-body-md focus:outline-none placeholder:text-outline/60 truncate border-0 p-0"/>' +
                    '</div>' +
                  '</div>' +
                  '<div class="md:col-span-3 flex items-center gap-3 bg-surface-container-lowest px-4 py-3.5 rounded-DEFAULT border border-transparent focus-within:border-primary/50 transition-colors text-left">' +
                    '<span class="material-symbols-outlined text-primary text-xl">apartment</span>' +
                    '<div class="flex-1 min-w-0">' +
                      '<label for="city" class="block font-label-sm text-outline uppercase tracking-wider">City Filter</label>' +
                      '<select id="city" aria-label="City" class="w-full bg-transparent text-on-surface font-body-md focus:outline-none border-0 p-0 cursor-pointer">' +
                        '<option value="" class="bg-surface-container-lowest text-on-surface">All cities</option>' +
                      '</select>' +
                    '</div>' +
                  '</div>' +
                  '<div class="md:col-span-2 flex items-center gap-3 bg-surface-container-lowest px-4 py-3.5 rounded-DEFAULT border border-transparent text-left">' +
                    '<span class="material-symbols-outlined text-primary text-xl">schedule</span>' +
                    '<div class="flex-1 min-w-0">' +
                      '<label class="block font-label-sm text-outline uppercase tracking-wider">Schedule</label>' +
                      '<div class="text-on-surface font-body-md truncate">Today • Prime</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="md:col-span-3">' +
                    '<button id="find-courts-btn" type="button" class="w-full h-full min-h-[56px] bg-primary-container hover:bg-primary text-on-primary font-body-md font-bold rounded-DEFAULT flex items-center justify-center gap-2 transition-all shadow-[0_0_25px_rgba(163,230,53,0.3)] border-0 cursor-pointer">' +
                      '<span class="material-symbols-outlined text-xl">search</span>' +
                      '<span>Find Courts</span>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                '<!-- Quick Surface Filter Pills -->' +
                '<div class="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-outline-variant/20 px-2">' +
                  '<div class="flex items-center gap-2 flex-wrap">' +
                    '<span class="font-label-sm text-outline uppercase mr-1">Surface:</span>' +
                    '<button type="button" data-filter="all" class="surf-pill px-3 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-label-sm transition-colors cursor-pointer">All Courts</button>' +
                    '<button type="button" data-filter="indoor" class="surf-pill px-3 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant font-label-sm transition-colors border-0 cursor-pointer">Indoor Cushioned</button>' +
                    '<button type="button" data-filter="outdoor" class="surf-pill px-3 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant font-label-sm transition-colors border-0 cursor-pointer">Outdoor Pro-Turf</button>' +
                  '</div>' +
                  '<div class="flex items-center gap-1.5 text-primary font-label-sm">' +
                    '<span class="material-symbols-outlined text-sm">bolt</span>' +
                    '<span id="ccount">Loading live slots...</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<!-- Trust Proof Stats -->' +
            '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-4 border-t border-outline-variant/20 text-center">' +
              '<div class="p-3">' +
                '<div class="font-headline-md text-on-surface">500+</div>' +
                '<div class="font-label-md text-on-surface-variant uppercase mt-0.5">Verified Clubs</div>' +
              '</div>' +
              '<div class="p-3">' +
                '<div class="font-headline-md text-primary">45,000+</div>' +
                '<div class="font-label-md text-on-surface-variant uppercase mt-0.5">Active Players</div>' +
              '</div>' +
              '<div class="p-3">' +
                '<div class="font-headline-md text-on-surface">99.8%</div>' +
                '<div class="font-label-md text-on-surface-variant uppercase mt-0.5">Booking Reliability</div>' +
              '</div>' +
              '<div class="p-3">' +
                '<div class="font-headline-md text-secondary">DUPR™</div>' +
                '<div class="font-label-md text-on-surface-variant uppercase mt-0.5">Direct API Sync</div>' +
              '</div>' +
            '</div>' +
            '<!-- Hero Court Visual Showcase -->' +
            '<div class="mt-12 relative rounded-lg overflow-hidden border border-outline-variant/30 shadow-2xl bg-surface-container-low">' +
              '<div class="aspect-[21/9] w-full relative">' +
                '<img alt="Modern indoor dark-mode pickleball stadium with neon green court lines and players in action" class="w-full h-full object-cover object-center opacity-80" src="https://lh3.googleusercontent.com/aida/ADBb0uiW6uG5_2dM5p9Y8fV4mN0c3xR1tL7qP2wK9jH4sB6vX8zC0nF2gD4kM6pQ8rS0tU2vW4xY6zA8bC0dE2fG4hI6jK8lM0nO2pQ4rS6tU8vW0xY2z"/>' +
                '<div class="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent"></div>' +
                '<div class="absolute bottom-4 left-4 right-4 md:bottom-8 md:left-8 md:right-8 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">' +
                  '<div class="bg-surface-container-lowest/90 backdrop-blur-md p-4 rounded-DEFAULT border border-outline-variant/40">' +
                    '<div class="flex items-center gap-2 mb-1">' +
                      '<span class="px-2 py-0.5 rounded bg-primary-container text-on-primary font-label-sm font-bold uppercase">Featured Arena</span>' +
                      '<span class="font-label-md text-on-surface-variant">• Championship Pro Surface</span>' +
                    '</div>' +
                    '<div class="font-headline-sm text-on-surface">Stadium Central Court No. 1</div>' +
                  '</div>' +
                  '<div class="flex items-center gap-3 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-3 rounded-DEFAULT border border-outline-variant/40">' +
                    '<span class="w-2.5 h-2.5 rounded-full bg-primary-container animate-ping"></span>' +
                    '<span class="font-label-md text-on-surface">LIVE BROADCAST &amp; INSTANT QR CHECK-IN ACTIVE</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- FEATURED CLUBS & LIVE AVAILABILITY -->' +
        '<section id="clubs-section" class="py-16 lg:py-24 bg-surface-container-lowest border-y border-outline-variant/20">' +
          '<div class="max-w-7xl mx-auto px-margin lg:px-margin-desktop">' +
            '<div class="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">' +
              '<div>' +
                '<div class="font-label-md text-primary uppercase tracking-widest mb-2">LIVE COURT INVENTORY</div>' +
                '<h2 class="font-headline-lg-mobile lg:font-headline-lg text-on-surface">Featured Clubs &amp; Availability</h2>' +
              '</div>' +
              '<div class="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">' +
                '<button type="button" data-tab="all" class="club-tab px-4 py-2 rounded-full bg-primary-container text-on-primary font-body-sm font-semibold whitespace-nowrap border-0 cursor-pointer">All Clubs</button>' +
                '<button type="button" data-tab="indoor" class="club-tab px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-body-sm font-medium whitespace-nowrap transition-colors border-0 cursor-pointer">Indoor AC</button>' +
                '<button type="button" data-tab="pro" class="club-tab px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-body-sm font-medium whitespace-nowrap transition-colors border-0 cursor-pointer">Pro Lit Courts</button>' +
                '<button type="button" data-tab="open" class="club-tab px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-body-sm font-medium whitespace-nowrap transition-colors border-0 cursor-pointer">Open Play Today</button>' +
              '</div>' +
            '</div>' +
            '<!-- Club Cards Grid -->' +
            '<div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-lg">' +
              '<p class="text-on-surface-variant font-body-md col-span-full">Loading clubs...</p>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- VALUE PROPOSITION SECTION -->' +
        '<section id="features" class="py-16 lg:py-24 bg-surface relative">' +
          '<div class="max-w-7xl mx-auto px-margin lg:px-margin-desktop">' +
            '<div class="text-center max-w-3xl mx-auto mb-16">' +
              '<div class="font-label-md text-primary uppercase tracking-widest mb-2">ENGINEERED FOR THE MODERN GAME</div>' +
              '<h2 class="font-headline-lg-mobile lg:font-headline-lg text-on-surface mb-4">Why Players &amp; Club Owners Choose DINKSLOT</h2>' +
              '<p class="font-body-md text-on-surface-variant">Everything you need to find a game, level up your rating, or run a high-margin multi-court pickleball facility.</p>' +
            '</div>' +
            '<div class="grid grid-cols-1 md:grid-cols-3 gap-space-lg">' +
              '<div class="bg-surface-container p-8 rounded-DEFAULT border border-outline-variant/30 hover:border-primary/40 transition-all group">' +
                '<div class="w-12 h-12 rounded-DEFAULT bg-primary/15 border border-primary/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">' +
                  '<span class="material-symbols-outlined text-primary text-2xl">bolt</span>' +
                '</div>' +
                '<div class="font-label-sm text-primary uppercase tracking-wider mb-2">01 / INSTANT ACCESS</div>' +
                '<h3 class="font-headline-md text-on-surface mb-3">Frictionless Booking &amp; Split-Pay</h3>' +
                '<p class="font-body-md text-on-surface-variant mb-6">' +
                  'Reserve courts in 3 taps. Automatically split court fees among all 4 players at checkout and unlock the facility gate with your dynamic QR pass.' +
                '</p>' +
                '<ul class="space-y-2.5 border-t border-outline-variant/20 pt-5">' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Automated 4-way payment splitting</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Apple Wallet &amp; smart-lock QR integration</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Instant SMS waitlist notifications</span>' +
                  '</li>' +
                '</ul>' +
              '</div>' +
              '<div class="bg-surface-container p-8 rounded-DEFAULT border border-outline-variant/30 hover:border-primary/40 transition-all group relative overflow-hidden">' +
                '<div class="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none"></div>' +
                '<div class="w-12 h-12 rounded-DEFAULT bg-primary/15 border border-primary/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">' +
                  '<span class="material-symbols-outlined text-primary text-2xl">Query_Stats</span>' +
                '</div>' +
                '<div class="font-label-sm text-primary uppercase tracking-wider mb-2">02 / COMPETITIVE BALANCING</div>' +
                '<h3 class="font-headline-md text-on-surface mb-3">Integrated DUPR Ratings</h3>' +
                '<p class="font-body-md text-on-surface-variant mb-6">' +
                  'Say goodbye to lopsided rec games. Join skill-verified Open Play sessions gated by real-time DUPR brackets and log match results directly from your phone.' +
                '</p>' +
                '<ul class="space-y-2.5 border-t border-outline-variant/20 pt-5">' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Two-way official DUPR rating sync</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Skill-gated round robins &amp; ladders</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Post-match partner &amp; opponent verification</span>' +
                  '</li>' +
                '</ul>' +
              '</div>' +
              '<div class="bg-surface-container p-8 rounded-DEFAULT border border-outline-variant/30 hover:border-primary/40 transition-all group">' +
                '<div class="w-12 h-12 rounded-DEFAULT bg-primary/15 border border-primary/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">' +
                  '<span class="material-symbols-outlined text-primary text-2xl">monitoring</span>' +
                '</div>' +
                '<div class="font-label-sm text-primary uppercase tracking-wider mb-2">03 / VENUE OPERATING SYSTEM</div>' +
                '<h3 class="font-headline-md text-on-surface mb-3">Club Management Suite</h3>' +
                '<p class="font-body-md text-on-surface-variant mb-6">' +
                  'Maximize court utilization with dynamic prime-time pricing, automated membership billing, pro-shop POS, and hardware lighting automation.' +
                '</p>' +
                '<ul class="space-y-2.5 border-t border-outline-variant/20 pt-5">' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Peak vs. off-peak dynamic pricing rules</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Automated court light &amp; PIN-pad control</span>' +
                  '</li>' +
                  '<li class="flex items-center gap-2 font-body-sm text-on-surface">' +
                    '<span class="material-symbols-outlined text-primary text-base">check_circle</span>' +
                    '<span>Real-time revenue &amp; utilization telemetry</span>' +
                  '</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- INTERACTIVE MATCHMAKING & OPEN PLAY PREVIEW -->' +
        '<section id="open-play" class="py-16 lg:py-24 bg-surface-container-low border-t border-outline-variant/20">' +
          '<div class="max-w-7xl mx-auto px-margin lg:px-margin-desktop">' +
            '<div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">' +
              '<div class="lg:col-span-5">' +
                '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 mb-4">' +
                  '<span class="font-label-sm text-primary uppercase">SOLO PLAYER? NO PROBLEM</span>' +
                '</div>' +
                '<h2 class="font-headline-lg-mobile lg:font-headline-lg text-on-surface mb-4">Drop Into Skill-Matched Open Play</h2>' +
                '<p class="font-body-md text-on-surface-variant mb-8">' +
                  'Don\'t have a full foursome? Browse live Open Play lobbies across your city, see the exact DUPR ratings of registered players, and claim the 4th spot in seconds.' +
                '</p>' +
                '<div class="space-y-4 mb-8">' +
                  '<div class="flex items-start gap-4 p-4 rounded-DEFAULT bg-surface-container border border-outline-variant/30">' +
                    '<span class="material-symbols-outlined text-primary text-2xl mt-0.5">verified_user</span>' +
                    '<div>' +
                      '<h4 class="font-body-md font-bold text-on-surface">Verified Skill Brackets</h4>' +
                      '<p class="font-body-sm text-on-surface-variant">Automatic enforcement prevents 2.5 beginners from accidentally booking into 4.5+ money-ball lobbies.</p>' +
                    '</div>' +
                  '</div>' +
                  '<div class="flex items-start gap-4 p-4 rounded-DEFAULT bg-surface-container border border-outline-variant/30">' +
                    '<span class="material-symbols-outlined text-primary text-2xl mt-0.5">group_add</span>' +
                    '<div>' +
                      '<h4 class="font-body-md font-bold text-on-surface">1-Click Rotating Round Robins</h4>' +
                      '<p class="font-body-sm text-on-surface-variant">Digital court-board assignments automatically rotate partners every 15 minutes.</p>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<a href="#clubs-section" class="inline-flex items-center gap-2 font-body-md font-bold text-primary hover:underline">' +
                  '<span>Explore all 142 Open Play sessions tonight</span>' +
                  '<span class="material-symbols-outlined text-lg">arrow_forward</span>' +
                '</a>' +
              '</div>' +
              '<div class="lg:col-span-7">' +
                '<div class="bg-surface-container rounded-lg border border-outline-variant/40 p-6 shadow-2xl">' +
                  '<div class="flex items-center justify-between pb-4 mb-6 border-b border-outline-variant/30">' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="w-2.5 h-2.5 rounded-full bg-primary-container"></span>' +
                      '<span class="font-headline-sm text-on-surface">Live Open Dinking Sessions</span>' +
                    '</div>' +
                    '<span class="font-label-sm text-outline uppercase">AUTO-REFRESHING</span>' +
                  '</div>' +
                  '<div class="space-y-4">' +
                    '<div class="p-4 rounded-DEFAULT bg-surface-container-high border border-outline-variant/40 hover:border-primary/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
                      '<div>' +
                        '<div class="flex items-center gap-2 mb-1">' +
                          '<span class="px-2 py-0.5 rounded bg-primary/20 text-primary font-label-sm font-bold">DUPR 4.0 – 4.5+</span>' +
                          '<span class="font-label-sm text-on-surface-variant">• Tonight, 7:00 PM – 9:00 PM</span>' +
                        '</div>' +
                        '<h4 class="font-body-lg font-bold text-on-surface">Advanced King of the Court Shootout</h4>' +
                        '<p class="font-body-sm text-on-surface-variant">BGC Kitchen Club • Court 1 &amp; 2 (Indoor Pro)</p>' +
                      '</div>' +
                      '<div class="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">' +
                        '<div class="flex items-center gap-2">' +
                          '<div class="flex -space-x-2">' +
                            '<span class="w-7 h-7 rounded-full bg-surface-bright border border-surface flex items-center justify-center font-label-sm text-primary">4.2</span>' +
                            '<span class="w-7 h-7 rounded-full bg-surface-bright border border-surface flex items-center justify-center font-label-sm text-primary">4.4</span>' +
                            '<span class="w-7 h-7 rounded-full bg-surface-bright border border-surface flex items-center justify-center font-label-sm text-primary">4.1</span>' +
                          '</div>' +
                          '<span class="font-label-sm text-tertiary">1 Spot Left!</span>' +
                        '</div>' +
                        '<a href="#clubs-section" class="px-4 py-2 rounded-full bg-primary-container hover:bg-primary text-on-primary font-body-sm font-bold transition-colors no-underline">' +
                          'Join Session • PHP 350' +
                        '</a>' +
                      '</div>' +
                    '</div>' +
                    '<div class="p-4 rounded-DEFAULT bg-surface-container-high border border-outline-variant/40 hover:border-primary/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
                      '<div>' +
                        '<div class="flex items-center gap-2 mb-1">' +
                          '<span class="px-2 py-0.5 rounded bg-secondary/20 text-secondary font-label-sm font-bold">DUPR 3.25 – 3.75</span>' +
                          '<span class="font-label-sm text-on-surface-variant">• Tonight, 7:30 PM – 9:30 PM</span>' +
                        '</div>' +
                        '<h4 class="font-body-lg font-bold text-on-surface">Intermediate Social Mixer &amp; Drinks</h4>' +
                        '<p class="font-body-sm text-on-surface-variant">Makati Smash Arena • Courts 3–6</p>' +
                      '</div>' +
                      '<div class="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">' +
                        '<div class="flex items-center gap-2">' +
                          '<div class="flex -space-x-2">' +
                            '<span class="w-7 h-7 rounded-full bg-surface-bright border border-surface flex items-center justify-center font-label-sm text-secondary">3.5</span>' +
                            '<span class="w-7 h-7 rounded-full bg-surface-bright border border-surface flex items-center justify-center font-label-sm text-secondary">3.4</span>' +
                          '</div>' +
                          '<span class="font-label-sm text-on-surface-variant">2 Spots Left</span>' +
                        '</div>' +
                        '<a href="#clubs-section" class="px-4 py-2 rounded-full bg-primary-container hover:bg-primary text-on-primary font-body-sm font-bold transition-colors no-underline">' +
                          'Join Session • PHP 300' +
                        '</a>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- FOR CLUB OWNERS BANNER -->' +
        '<section class="py-16 lg:py-20 bg-surface">' +
          '<div class="max-w-7xl mx-auto px-margin lg:px-margin-desktop">' +
            '<div class="rounded-lg bg-gradient-to-br from-surface-container-high via-surface-container to-surface-container-lowest border border-outline-variant/50 p-8 md:p-12 lg:p-16 relative overflow-hidden">' +
              '<div class="absolute -right-20 -bottom-20 w-96 h-96 bg-primary-container/10 rounded-full blur-3xl pointer-events-none"></div>' +
              '<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">' +
                '<div class="lg:col-span-8">' +
                  '<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 text-primary font-label-sm uppercase mb-4">' +
                    'DINKSLOT PARTNER PRO' +
                  '</div>' +
                  '<h2 class="font-headline-lg-mobile lg:font-headline-lg text-on-surface mb-4">' +
                    'Own or Operate a Pickleball Facility?' +
                  '</h2>' +
                  '<p class="font-body-lg text-on-surface-variant max-w-2xl mb-6">' +
                    'Boost off-peak court utilization by up to 42% and eliminate front-desk check-in bottlenecks. Migrate your courts to DINKSLOT in under 24 hours.' +
                  '</p>' +
                  '<div class="flex flex-wrap gap-6 text-on-surface font-body-sm">' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="material-symbols-outlined text-primary">verified</span>' +
                      '<span>Zero setup fees</span>' +
                    '</div>' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="material-symbols-outlined text-primary">verified</span>' +
                      '<span>Automated GCash &amp; QR payouts</span>' +
                    '</div>' +
                    '<div class="flex items-center gap-2">' +
                      '<span class="material-symbols-outlined text-primary">verified</span>' +
                      '<span>Custom white-label member app</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-end">' +
                  '<a href="#/register-club" class="w-full py-4 px-6 rounded-full bg-primary-container hover:bg-primary text-on-primary font-body-md font-bold text-center transition-all shadow-[0_0_25px_rgba(163,230,53,0.3)] no-underline">' +
                    'Register Your Club' +
                  '</a>' +
                  '<a href="#/register-club" class="w-full py-4 px-6 rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-body-md font-semibold text-center border border-outline-variant/40 transition-colors no-underline">' +
                    'Partner Onboarding' +
                  '</a>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<!-- BOTTOM CALL-TO-ACTION BANNER -->' +
        '<section class="py-16 lg:py-24 bg-surface-container-lowest relative overflow-hidden border-t border-outline-variant/20">' +
          '<div class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(163,230,53,0.12)_0%,transparent_70%)] pointer-events-none"></div>' +
          '<div class="max-w-4xl mx-auto px-margin lg:px-margin-desktop text-center relative z-10">' +
            '<h2 class="font-headline-display-mobile lg:font-headline-display text-on-surface mb-6">' +
              'Ready to rule the court?' +
            '</h2>' +
            '<p class="font-body-lg text-on-surface-variant max-w-xl mx-auto mb-10">' +
              'Create your free DINKSLOT player pass in 30 seconds. Connect your DUPR ID, discover local courts, and lock in your next match.' +
            '</p>' +
            '<div class="flex flex-col sm:flex-row items-center justify-center gap-4">' +
              '<a href="#/auth?mode=up" class="w-full sm:w-auto px-8 py-4 rounded-full bg-primary-container hover:bg-primary text-on-primary font-body-lg font-bold transition-all shadow-[0_0_30px_rgba(163,230,53,0.4)] flex items-center justify-center gap-2 no-underline">' +
                '<span>Get Started for Free</span>' +
                '<span class="material-symbols-outlined">sports_tennis</span>' +
              '</a>' +
              '<a href="#clubs-section" class="w-full sm:w-auto px-8 py-4 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface font-body-lg font-semibold border border-outline-variant/40 transition-colors no-underline">' +
                'Browse Courts Near Me' +
              '</a>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>';

    var r = await sb.from("public_clubs").select("*").order("name");
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
    var cities = Array.from(new Set(clubs.map(function (c) { return c.city; }).filter(Boolean))).sort();
    var cityEl = $("#city");
    if (cityEl) {
      cityEl.innerHTML += cities.map(function (c) {
        return '<option value="' + esc(c) + '" class="bg-surface-container-lowest text-on-surface">' + esc(c) + '</option>';
      }).join("");
    }

    var surfaceFilter = "all";

    function draw() {
      var qEl = $("#q");
      var q = qEl ? qEl.value.trim().toLowerCase() : "";
      var city = cityEl ? cityEl.value : "";
      var list = clubs.filter(function (c) {
        var i = info[c.slug];
        var matchText = (!city || c.city === city) && (!q || (c.name + " " + (c.city || "") + " " + (c.address || "")).toLowerCase().indexOf(q) !== -1);
        if (!matchText) return false;
        if (surfaceFilter === "indoor") return !!(i && i.indoor > 0);
        if (surfaceFilter === "outdoor") return !!(i && i.outdoor > 0);
        return true;
      });
      var ccount = $("#ccount");
      if (ccount) {
        ccount.textContent = list.length + (list.length === 1 ? " club available now" : " clubs available now");
      }
      var grid = $("#grid");
      if (!grid) return;
      grid.innerHTML = list.length ? list.map(function (c, idx) {
        var i = info[c.slug];
        var coverSrc = c.cover_path ? mediaUrl(c.cover_path) : fallbackImages[idx % fallbackImages.length];
        var courtLabel = i
          ? i.n + (i.n === 1 ? " Court" : " Courts") + " (" + (i.indoor > 0 ? "Indoor" : "Outdoor") + (i.surfaces.length ? " • " + i.surfaces[0] : "") + ")"
          : "Court schedule open";
        var priceHtml = i && isFinite(i.min)
          ? '<span class="font-headline-sm text-on-surface">PHP ' + esc(i.min.toFixed(0)) + '</span><span class="font-label-sm text-outline">/hr</span>'
          : '<span class="font-label-sm text-outline">View rates</span>';

        return '<article class="group bg-surface-container rounded-DEFAULT border border-outline-variant/30 hover:border-primary/60 transition-all duration-300 overflow-hidden flex flex-col justify-between shadow-lg">' +
          '<div>' +
            '<a href="#/c/' + esc(c.slug) + '" class="block relative h-48 overflow-hidden bg-surface-container-high">' +
              '<img src="' + esc(coverSrc) + '" alt="' + esc(c.name) + '" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>' +
              '<div class="absolute top-3 left-3 flex gap-1.5">' +
                '<span class="px-2.5 py-1 rounded-full bg-surface-container-lowest/90 backdrop-blur-md text-primary font-label-sm border border-primary/30">DUPR VERIFIED</span>' +
              '</div>' +
              '<div class="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-surface-container-lowest/90 backdrop-blur-md flex items-center gap-1">' +
                '<span class="material-symbols-outlined text-primary text-xs" style="font-variation-settings: \'FILL\' 1;">star</span>' +
                '<span class="font-label-sm text-on-surface">4.9</span>' +
              '</div>' +
              '<div class="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-primary-container text-on-primary font-label-sm font-bold">' +
                (i ? i.n + (i.n === 1 ? " COURT OPEN" : " COURTS OPEN") : "OPEN TODAY") +
              '</div>' +
            '</a>' +
            '<div class="p-5">' +
              '<div class="flex items-start justify-between gap-2 mb-1">' +
                '<h3 class="font-headline-sm text-on-surface group-hover:text-primary transition-colors">' +
                  '<a href="#/c/' + esc(c.slug) + '" class="text-inherit no-underline">' + esc(c.name) + '</a>' +
                '</h3>' +
                '<div>' + priceHtml + '</div>' +
              '</div>' +
              '<p class="font-body-sm text-on-surface-variant flex items-center gap-1 mb-4">' +
                '<span class="material-symbols-outlined text-sm text-outline">location_on</span>' +
                '<span>' + esc(c.city || c.address || "Metro Manila") + ' • ' + esc(courtLabel) + '</span>' +
              '</p>' +
              '<div class="mb-4">' +
                '<div class="font-label-sm text-outline uppercase mb-2">Available Today:</div>' +
                '<div class="grid grid-cols-3 gap-1.5">' +
                  '<a href="#/c/' + esc(c.slug) + '/book" class="py-1.5 px-2 rounded bg-surface-container-high hover:bg-primary-container hover:text-on-primary text-on-surface font-label-sm transition-colors border border-outline-variant/40 text-center no-underline">5:00 PM</a>' +
                  '<a href="#/c/' + esc(c.slug) + '/book" class="py-1.5 px-2 rounded bg-surface-container-high hover:bg-primary-container hover:text-on-primary text-on-surface font-label-sm transition-colors border border-outline-variant/40 text-center no-underline">6:30 PM</a>' +
                  '<a href="#/c/' + esc(c.slug) + '/book" class="py-1.5 px-2 rounded bg-primary/15 text-primary hover:bg-primary-container hover:text-on-primary font-label-sm transition-colors border border-primary/40 text-center no-underline">8:00 PM</a>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="px-5 pb-5 pt-3 border-t border-outline-variant/20 flex items-center justify-between">' +
            '<span class="font-label-sm text-on-surface-variant">Instant QR Confirmation</span>' +
            '<a href="#/c/' + esc(c.slug) + '" class="font-body-sm font-bold text-primary hover:underline flex items-center gap-1 no-underline">' +
              '<span>Book Slot</span>' +
              '<span class="material-symbols-outlined text-base">arrow_forward</span>' +
            '</a>' +
          '</div>' +
        '</article>';
      }).join("") : '<p class="text-on-surface-variant font-body-md col-span-full">No clubs match your search.</p>';
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
        draw();
      };
    });
    document.querySelectorAll(".club-tab").forEach(function (btn) {
      btn.onclick = function () {
        var tab = btn.getAttribute("data-tab") || "all";
        surfaceFilter = (tab === "indoor") ? "indoor" : "all";
        document.querySelectorAll(".club-tab").forEach(function (b) {
          var active = (b === btn);
          b.className = active
            ? "club-tab px-4 py-2 rounded-full bg-primary-container text-on-primary font-body-sm font-semibold whitespace-nowrap border-0 cursor-pointer"
            : "club-tab px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-body-sm font-medium whitespace-nowrap transition-colors border-0 cursor-pointer";
        });
        draw();
      };
    });
    draw();
  }

  async function viewClub(slug) {
    app.innerHTML = '<div class="pubwrap"><p class="muted">Loading...</p></div>';
    var r = await sb.from("public_clubs").select("*").eq("slug", slug).maybeSingle();
    var c = r.data;
    if (!c) { app.innerHTML = '<div class="pubwrap"><h2>Club not found</h2><p>This club does not exist or is not approved yet.</p><a class="btn" href="#/">Back to clubs</a></div>'; return; }
    var courts = (await sb.from("public_courts").select("*").eq("club_slug", slug).order("name")).data || [];
    var hrs = courts.length ? String(courts.map(function (k) { return String(k.open_time).slice(0, 5); }).sort()[0]) + " - " +
      String(courts.map(function (k) { return String(k.close_time).slice(0, 5); }).sort().slice(-1)[0]) : "";
    var chip = function (icon, text) { return text ? '<span class="chip"><span class="mi">' + icon + "</span>" + esc(text) + "</span>" : ""; };
    app.innerHTML =
      '<div class="pubwrap"><a class="back" href="#/">&larr; All clubs</a>' +
      '<section class="clubbanner">' + (c.cover_path ? '<img src="' + esc(mediaUrl(c.cover_path)) + '" alt="">' : '<div class="ph"></div>') + "</section>" +
      '<section class="clubid"><div class="bigcircle">' + (c.logo_path ? '<img src="' + esc(mediaUrl(c.logo_path)) + '" alt="">' : "<span>" + esc(c.name.charAt(0).toUpperCase()) + "</span>") + "</div>" +
      '<div class="clubid-text"><h1>' + esc(c.name) + '</h1><div class="chips">' +
      chip("location_on", [c.address, c.city].filter(Boolean).join(", ")) + chip("call", c.contact_phone) + chip("schedule", hrs) +
      chip("sports_tennis", courts.length + (courts.length === 1 ? " court" : " courts")) + "</div></div>" +
      '<a class="btn" href="#/c/' + esc(slug) + '/book">Book a court</a></section>' +
      (c.description ? '<section class="about"><h2>About</h2><p>' + esc(c.description) + "</p></section>" : "") +
      '<div class="sectionhead"><h2>Courts</h2></div>' +
      (courts.length ? '<div class="courtgrid">' + courts.map(function (k) {
        return '<div class="courtcard"><div class="cc-top"><h3>' + esc(k.name) + '</h3><span class="chip">' + (k.is_indoor ? "Indoor" : "Outdoor") + "</span></div>" +
          '<p class="cc-rate"><b>PHP ' + esc(Number(k.hourly_rate).toFixed(2)) + "</b><span>/hr</span></p>" +
          '<p class="muted small"><span class="mi">schedule</span>' + esc(String(k.open_time).slice(0, 5)) + " - " + esc(String(k.close_time).slice(0, 5)) +
          " &middot; " + esc(String(k.slot_minutes)) + " min slots" + (k.surface ? " &middot; " + esc(k.surface) : "") + "</p>" +
          '<a class="btn sm" href="#/c/' + esc(slug) + '/book">Book</a></div>';
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
    var selectedSkill = "intermediate";
    var defaultTitleIn = opts.title || "Welcome back to the court";
    var defaultTitleUp = opts.title || 'Join the premier <span class="text-primary tracking-normal">pickleball</span> network';
    var defaultIntroIn = opts.intro || "Enter your credentials to access your bookings and club schedule.";
    var defaultIntroUp = opts.intro || "Book courts, join rated leagues, and connect with top local players in real time.";
    document.body.classList.add("auth-page");

    function renderSignIn() {
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
      mode = "up";
      if (cleanupAuthPattern) { cleanupAuthPattern(); cleanupAuthPattern = null; }
      app.innerHTML =
        '<div id="ds-auth-screen" class="flex flex-col w-full">' +
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
        '<div class="w-full max-w-2xl flex flex-col gap-space-lg relative z-10">' +
        '<!-- Header Badge & Headline Group -->' +
        '<div class="flex flex-col items-center text-center gap-space-xs">' +
        '<div class="inline-flex items-center gap-space-xs px-space-md py-1 rounded-full bg-surface-container-high text-primary font-label-md text-label-md tracking-wider uppercase mb-space-xs shadow-sm">' +
        '<span class="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>' +
        'DS League Entry • Season 2025' +
        '</div>' +
        '<h1 id="auth-title" class="font-headline-lg text-headline-lg md:text-headline-display tracking-tight text-on-surface">' +
        defaultTitleUp +
        '</h1>' +
        '<p id="auth-sub" class="font-body-lg text-body-lg text-on-surface-variant max-w-lg mt-1">' +
        defaultIntroUp +
        '</p>' +
        '</div>' +
        '<!-- Main Card Container -->' +
        '<div class="w-full bg-surface-container/85 backdrop-blur-2xl rounded-lg p-space-lg md:p-space-xl shadow-xl flex flex-col gap-space-lg border border-white/5">' +
        '<!-- Perks Micro-Banner -->' +
        '<div class="w-full rounded-DEFAULT bg-surface-container-highest/60 px-space-md py-space-sm flex items-center justify-between gap-space-sm">' +
        '<div class="flex items-center gap-space-sm min-w-0">' +
        '<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">' +
        '<span class="material-symbols-outlined text-primary text-[18px]">verified</span>' +
        '</div>' +
        '<p class="font-body-sm text-body-sm text-on-surface font-medium truncate">' +
        'Includes <span class="text-primary font-semibold">14 days free</span> priority booking &amp; DUPR rating tracking' +
        '</p>' +
        '</div>' +
        '<span class="hidden sm:inline-block font-label-sm text-label-sm text-primary uppercase tracking-widest shrink-0 font-semibold px-2 py-0.5 rounded bg-surface-container-low">' +
        'VIP TIER' +
        '</span>' +
        '</div>' +
        '<!-- Quick Social Auth -->' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">' +
        '<button id="oauth-google-up" class="group flex items-center justify-center gap-space-sm py-3 px-space-md rounded-full bg-surface-container-high hover:bg-surface-bright transition-all text-on-surface font-label-lg text-label-lg shadow-sm" type="button">' +
        '<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24">' +
        '<path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335"></path>' +
        '<path d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z" fill="#4285F4"></path>' +
        '<path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z" fill="#FBBC05"></path>' +
        '<path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" fill="#34A853"></path>' +
        '</svg>' +
        '<span>Sign up with Google</span>' +
        '</button>' +
        '<button id="oauth-apple-up" class="group flex items-center justify-center gap-space-sm py-3 px-space-md rounded-full bg-surface-container-high hover:bg-surface-bright transition-all text-on-surface font-label-lg text-label-lg shadow-sm" type="button">' +
        '<svg class="w-4 h-4 fill-current shrink-0 text-on-surface" viewBox="0 0 24 24">' +
        '<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.87c.66-.82 1.11-1.96.99-3.11-.96.04-2.12.64-2.8 1.44-.6.69-1.12 1.83-1 2.97 1.08.08 2.16-.54 2.81-1.3"></path>' +
        '</svg>' +
        '<span>Sign up with Apple</span>' +
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
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-space-md">' +
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
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Official Skill Level / DUPR</label>' +
        '<a class="font-label-sm text-label-sm text-primary hover:underline flex items-center gap-1" href="#/">' +
        '<span>Find my rating</span>' +
        '<span class="material-symbols-outlined text-[14px]">arrow_outward</span>' +
        '</a>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2" id="skill-selector">' +
        '<button class="skill-pill flex flex-col items-start p-space-sm rounded-DEFAULT bg-surface-container-low hover:bg-surface-container-high transition-all text-left group" data-skill="beginner" type="button">' +
        '<span class="font-label-md text-label-md text-on-surface font-semibold group-hover:text-primary transition-colors">Beginner</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">1.0 – 2.5 DUPR</span>' +
        '</button>' +
        '<button class="skill-pill active-skill flex flex-col items-start p-space-sm rounded-DEFAULT bg-primary-container text-on-primary-container transition-all text-left shadow-[0_0_16px_rgba(163,230,53,0.25)]" data-skill="intermediate" type="button">' +
        '<div class="flex items-center justify-between w-full">' +
        '<span class="font-label-md text-label-md font-bold">Intermediate</span>' +
        '<span class="material-symbols-outlined text-[16px] font-bold">check_circle</span>' +
        '</div>' +
        '<span class="font-label-sm text-label-sm font-medium opacity-90">3.0 – 4.0 DUPR</span>' +
        '</button>' +
        '<button class="skill-pill flex flex-col items-start p-space-sm rounded-DEFAULT bg-surface-container-low hover:bg-surface-container-high transition-all text-left group" data-skill="advanced" type="button">' +
        '<span class="font-label-md text-label-md text-on-surface font-semibold group-hover:text-primary transition-colors">Advanced / Pro</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">4.5+ DUPR</span>' +
        '</button>' +
        '</div>' +
        '</div>' +
        '<!-- Password Field with Interactive Strength Meter -->' +
        '<div class="flex flex-col gap-1.5 mt-1">' +
        '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="pw">Password</label>' +
        '<div class="relative flex items-center">' +
        '<span class="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none text-[20px]">lock</span>' +
        '<input class="w-full bg-surface-container-low rounded-DEFAULT pl-11 pr-11 py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="pw" autocomplete="new-password" minlength="6" placeholder="••••••••••••" required type="password" />' +
        '<button aria-label="Toggle password visibility" class="absolute right-3.5 text-on-surface-variant hover:text-on-surface transition-colors flex items-center justify-center" id="toggle-password-btn" type="button">' +
        '<span class="material-symbols-outlined text-[20px]" id="eye-icon">visibility</span>' +
        '</button>' +
        '</div>' +
        '<!-- Strength Meter Bars -->' +
        '<div class="flex flex-col gap-1.5 mt-1">' +
        '<div class="grid grid-cols-3 gap-1.5 h-1.5 w-full">' +
        '<div class="h-full rounded-full bg-primary-container transition-all duration-300" id="bar-1"></div>' +
        '<div class="h-full rounded-full bg-primary-container transition-all duration-300" id="bar-2"></div>' +
        '<div class="h-full rounded-full bg-surface-container-highest transition-all duration-300" id="bar-3"></div>' +
        '</div>' +
        '<div class="flex justify-between items-center text-label-sm font-label-sm">' +
        '<span class="text-on-surface-variant">Strength rating:</span>' +
        '<span class="text-primary font-semibold tracking-wide" id="strength-label">GOOD • MATCH READY</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        (opts.join ?
          '<div id="l-dn" class="flex flex-col gap-1.5 mt-1">' +
          '<label class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider" for="dn">Display Name at This Club</label>' +
          '<div class="relative flex items-center">' +
          '<span class="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none text-[20px]">badge</span>' +
          '<input class="w-full bg-surface-container-low rounded-DEFAULT pl-11 pr-space-md py-3 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors" id="dn" maxlength="60" placeholder="How other players see you" />' +
          '</div>' +
          '</div>' : '') +
        '<!-- Terms and Conditions Checkbox -->' +
        '<div class="flex items-start gap-space-sm pt-2">' +
        '<label class="relative flex items-center cursor-pointer pt-0.5">' +
        '<input checked class="sr-only peer" id="terms" type="checkbox" />' +
        '<div class="w-5 h-5 rounded bg-surface-container-low peer-checked:bg-primary-container flex items-center justify-center transition-colors">' +
        '<span class="material-symbols-outlined text-[16px] text-on-primary-container scale-0 peer-checked:scale-100 transition-transform font-bold">check</span>' +
        '</div>' +
        '</label>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant leading-tight">' +
        'I agree to the <a class="text-primary underline hover:text-on-surface transition-colors" href="#/auth">Terms of Service</a>, ' +
        '<a class="text-primary underline hover:text-on-surface transition-colors" href="#/auth">Privacy Policy</a>, and tournament fair-play conduct standard.' +
        '</span>' +
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
            strengthLabel.textContent = "WEAK • NEEDS 6+ CHARS";
            strengthLabel.className = "text-error font-semibold tracking-wide";
          } else if (val.length < 10) {
            b1.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b2.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b3.className = "h-full rounded-full bg-surface-container-highest transition-all duration-300";
            strengthLabel.textContent = "GOOD • MATCH READY";
            strengthLabel.className = "text-primary font-semibold tracking-wide";
          } else {
            b1.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b2.className = "h-full rounded-full bg-primary-container transition-all duration-300";
            b3.className = "h-full rounded-full bg-primary-container transition-all duration-300 shadow-[0_0_8px_rgba(163,230,53,0.5)]";
            strengthLabel.textContent = "EXCELLENT • PRO SECURED";
            strengthLabel.className = "text-primary font-bold tracking-wide";
          }
        };
      }

      var pills = app.querySelectorAll(".skill-pill");
      Array.prototype.forEach.call(pills, function (pill) {
        pill.onclick = function () {
          selectedSkill = pill.getAttribute("data-skill") || "intermediate";
          Array.prototype.forEach.call(pills, function (p) {
            p.className = "skill-pill flex flex-col items-start p-space-sm rounded-DEFAULT bg-surface-container-low hover:bg-surface-container-high transition-all text-left group";
            var icon = p.querySelector(".material-symbols-outlined");
            if (icon) icon.remove();
            var title = p.querySelector(".font-label-md");
            if (title) title.className = "font-label-md text-label-md text-on-surface font-semibold group-hover:text-primary transition-colors";
            var sub = p.querySelector(".font-label-sm");
            if (sub) sub.className = "font-label-sm text-label-sm text-on-surface-variant";
          });

          pill.className = "skill-pill active-skill flex flex-col items-start p-space-sm rounded-DEFAULT bg-primary-container text-on-primary-container transition-all text-left shadow-[0_0_16px_rgba(163,230,53,0.25)]";
          var title = pill.querySelector(".font-label-md");
          if (title) {
            title.className = "font-label-md text-label-md font-bold text-on-primary-container";
            var wrap = document.createElement("div");
            wrap.className = "flex items-center justify-between w-full";
            title.parentNode.insertBefore(wrap, title);
            wrap.appendChild(title);
            var icon = document.createElement("span");
            icon.className = "material-symbols-outlined text-[16px] font-bold text-on-primary-container";
            icon.textContent = "check_circle";
            wrap.appendChild(icon);
          }
          var sub = pill.querySelector(".font-label-sm");
          if (sub) sub.className = "font-label-sm text-label-sm font-medium opacity-90 text-on-primary-container";
        };
      });

      $("#switch-btn").onclick = function (e) {
        e.preventDefault();
        window.scrollTo(0, 0);
        renderSignIn();
      };

      $("#oauth-google-up").onclick = async function () {
        var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
        if (r.error) setMsg(app, friendly(r.error), "err");
      };
      $("#oauth-apple-up").onclick = async function () {
        var r = await sb.auth.signInWithOAuth({ provider: "apple", options: { redirectTo: location.origin + location.pathname } });
        if (r.error) setMsg(app, friendly(r.error), "err");
      };

      $("#f").onsubmit = async function (e) {
        e.preventDefault();
        var firstName = ($("#first_name") && $("#first_name").value.trim()) || "";
        var lastName = ($("#last_name") && $("#last_name").value.trim()) || "";
        var fullName = [firstName, lastName].filter(Boolean).join(" ");
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
            data: { full_name: fullName, skill_level: selectedSkill }
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
          return setMsg(app, "Account created. Check your email to confirm, then sign in.", "ok");
        }
        await refreshSession();
        if (state.isPlatform) return go("/platform");
        if (opts.join) {
          var dn = ($("#dn") && $("#dn").value.trim()) || fullName || email.split("@")[0];
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
    var initial = (state.user.email || "?").charAt(0).toUpperCase();
    app.innerHTML =
      '<div class="pubwrap narrow"><div class="acchead"><span class="avatar big ph">' + esc(initial) + "</span>" +
      '<div><h1>My account</h1><p class="muted">' + esc(state.user.email) + "</p></div></div>" +
      '<p class="msg ok" role="status"></p>' +
      '<section class="card2"><h2>My profile</h2><form id="myprofile"><div class="grid2">' +
      '<label>Full name<input id="mp-name" maxlength="80" autocomplete="name"></label>' +
      '<label>Phone<input id="mp-phone" maxlength="30" autocomplete="tel"></label></div>' +
      '<p class="muted small">Email: ' + esc(state.user.email) + '</p><p class="msg" role="alert"></p>' +
      '<button class="btn sm" type="submit">Save profile</button></form></section>' +
      '<section class="card2"><h2>Clubs you manage</h2><div id="mine">Loading...</div></section>' +
      '<section class="card2"><h2>My bookings</h2><div id="mybookings">Loading...</div></section></div>';
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
      '<p class="msg" role="alert"></p><div id="list">Loading...</div>';
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
      if ((m = path.match(/^\/c\/([a-z0-9-]+)\/book$/))) return await window.DS.booking.renderBook(m[1]);
      if ((m = path.match(/^\/admin\/([a-z0-9-]+)(?:\/(courts|settings|bookings|profile|payments|staff))?$/))) {
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

