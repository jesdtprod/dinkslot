// Shared layout helpers. DS.ui.dash() renders the modern sidebar dashboard shell used by the club
// dashboard and the super admin console. Icons are Material Symbols (loaded in index.html).
(function () {
  "use strict";
  var D = window.DS, esc = D.esc;
  document.addEventListener("pointerdown", function (event) {
    var menu = document.querySelector(".facility-account[open]");
    if (menu && !menu.contains(event.target)) menu.open = false;
  });

  function icon(name) { return '<span class="material-symbols-outlined text-xl shrink-0" aria-hidden="true">' + esc(name) + "</span>"; }

  // Shared account card for the public navigation and facility dashboard.
  function accountMenu(h, signoutId) {
    h = h || {};
    var initial = esc((h.initial || h.title || "?").charAt(0).toUpperCase());
    return '<div class="facility-menu-header">' +
      '<div class="facility-menu-header-top">' +
        '<div class="facility-menu-header-avatar">' + (h.img ? '<img src="' + esc(h.img) + '" alt="">' : initial) + '</div>' +
        '<div class="facility-menu-header-info">' +
          '<span class="facility-menu-header-name">' + esc(h.title || "Facility") + '</span>' +
          '<span class="facility-menu-header-role">' + esc(h.sub || "Director") + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="facility-menu-header-email">' + esc((D.state.user && D.state.user.email) || "") + '</div>' +
      '<div class="facility-menu-header-meta">' +
        '<span class="facility-meta-status"><span class="facility-meta-status-dot"></span> Cloud Sync Active</span>' +
        (h.city ? '<span class="facility-meta-city"><span class="material-symbols-outlined">location_on</span>' + esc(h.city) + '</span>' : '') +
      '</div>' +
    '</div>' +
    (h.slug ?
      '<div class="facility-menu-label">Facility Management</div>' +
      '<a href="#/c/' + esc(h.slug) + '" target="_blank" rel="noopener" class="facility-menu-item">' +
        '<div class="facility-item-main">' +
          '<div class="facility-item-icon"><span class="material-symbols-outlined">storefront</span></div>' +
          '<div class="facility-item-copy">' +
            '<span class="facility-item-title">Public Club Page</span>' +
            '<span class="facility-item-sub">View live member booking page</span>' +
          '</div>' +
        '</div>' +
        '<span class="material-symbols-outlined facility-item-arrow">arrow_outward</span>' +
      '</a>' +
      '<a href="#/admin/' + esc(h.slug) + '/profile" class="facility-menu-item">' +
        '<div class="facility-item-main">' +
          '<div class="facility-item-icon"><span class="material-symbols-outlined">tune</span></div>' +
          '<div class="facility-item-copy">' +
            '<span class="facility-item-title">Club Configuration</span>' +
            '<span class="facility-item-sub">Courts, payouts & rules</span>' +
          '</div>' +
        '</div>' +
        '<span class="material-symbols-outlined facility-item-arrow">chevron_right</span>' +
      '</a>'
    : '') +
    '<div class="facility-menu-label">Network & Account</div>' +
    '<a href="#/me" class="facility-menu-item">' +
      '<div class="facility-item-main">' +
        '<div class="facility-item-icon"><span class="material-symbols-outlined">person</span></div>' +
        '<div class="facility-item-copy">' +
          '<span class="facility-item-title">Personal Profile</span>' +
          '<span class="facility-item-sub">Player stats & reservations</span>' +
        '</div>' +
      '</div>' +
      '<span class="material-symbols-outlined facility-item-arrow">chevron_right</span>' +
    '</a>' +
    '<a href="#/" class="facility-menu-item">' +
      '<div class="facility-item-main">' +
        '<div class="facility-item-icon"><span class="material-symbols-outlined">sports_tennis</span></div>' +
        '<div class="facility-item-copy">' +
          '<span class="facility-item-title">Browse Courts</span>' +
          '<span class="facility-item-sub">Explore national venue network</span>' +
        '</div>' +
      '</div>' +
      '<span class="material-symbols-outlined facility-item-arrow">chevron_right</span>' +
    '</a>' +
    '<div class="facility-menu-divider"></div>' +
    '<button type="button" id="' + esc(signoutId || "facility-signout") + '" class="facility-menu-item signout-item">' +
      '<div class="facility-item-main">' +
        '<div class="facility-item-icon"><span class="material-symbols-outlined">logout</span></div>' +
        '<div class="facility-item-copy">' +
          '<span class="facility-item-title">Sign out</span>' +
          '<span class="facility-item-sub">End current active session</span>' +
        '</div>' +
      '</div>' +
      '<kbd class="facility-shortcut">Esc</kbd>' +
    '</button>';
  }

  // o = { head:{title, sub, status, img, initial, city}, items:[{key,label,icon,href|(button),badge}|{type:'label',label}],
  //       foot:[{label,icon,href}], active, onSelect(key) }
  // returns { main, setTitle(title, sub, actionsHtml), setActive(key), setBadge(key, value), setStatusPill(courtsLive, util) }
  function dash(root, o) {
    var h = o.head || {};
    var initial = esc((h.initial || h.title || "?").charAt(0).toUpperCase());

    var items = (o.items || []).map(function (it) {
      if (it.type === "label") {
        return '<div class="px-space-md pt-space-sm pb-1 font-label-sm text-label-sm uppercase tracking-wider text-outline font-semibold">' + esc(it.label) + '</div>';
      }
      var on = it.key === o.active;
      var badge = it.badge
        ? '<span class="px-2 py-0.5 rounded-full bg-error text-on-error font-label-sm text-label-sm font-bold shadow-sm" data-badge="' + esc(it.key) + '">' + esc(it.badge) + '</span>'
        : '<span class="px-2 py-0.5 rounded-full bg-error text-on-error font-label-sm text-label-sm font-bold shadow-sm" data-badge="' + esc(it.key) + '" hidden></span>';
      var cls = on
        ? "flex items-center gap-space-sm px-space-md py-space-sm dashboard-rounded transition-all bg-primary-container text-on-primary-container font-semibold shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline"
        : "flex items-center gap-space-sm px-space-md py-space-sm dashboard-rounded font-body-md text-body-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all no-underline";
      var inner = icon(it.icon) + '<span class="flex-1 min-w-0 truncate">' + esc(it.label) + "</span>" + badge;
      return it.href
        ? '<a class="' + cls + '" data-key="' + esc(it.key) + '" href="' + esc(it.href) + '">' + inner + "</a>"
        : '<button type="button" class="' + cls + ' w-full text-left border-0 bg-transparent cursor-pointer" data-key="' + esc(it.key) + '">' + inner + "</button>";
    }).join("");

    var foot = (o.foot || []).map(function (f) {
      return '<a class="flex items-center gap-space-sm px-space-md py-space-sm dashboard-rounded font-body-md text-body-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all no-underline" href="' + esc(f.href) + '">' +
        icon(f.icon) + '<span class="flex-1 min-w-0 truncate">' + esc(f.label) + '</span>' +
        '<span class="material-symbols-outlined text-sm text-outline">chevron_right</span>' +
        '</a>';
    }).join("");

    root.innerHTML =
      '<div id="ds-tenant-dashboard" class="flex w-full min-h-screen bg-surface text-on-surface relative">' +
        '<!-- Fixed Left Sidebar -->' +
        '<aside id="ds-side" class="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest z-50 flex flex-col justify-between py-space-md border-r border-outline-variant/20 -translate-x-full md:translate-x-0 transition-transform duration-200">' +
          '<div class="flex flex-col gap-space-md overflow-y-auto">' +
            '<div class="facility-brand-row">' +
              '<a href="#/" class="facility-brand" aria-label="DINKSLOT home">' +
                '<img src="assets/dinkslot-logo.png" alt="" width="42" height="42" />' +
                '<span class="facility-brand-copy"><strong>DINKSLOT</strong><span>' + esc(o.workspace || "Tenant Workspace") + '</span></span>' +
              '</a>' +
            '</div>' +
            '<nav class="flex flex-col gap-space-xs px-space-sm" aria-label="Facility menu">' + items + '</nav>' +
          '</div>' +
          '<div class="px-space-md flex flex-col gap-space-sm pt-space-sm border-t border-outline-variant/20">' +
            (o.hideStatus ? '' : '<div class="bg-surface-container-low p-space-sm dashboard-rounded flex items-center justify-between border border-outline-variant/20" id="side-status-box">' +
              '<div class="flex items-center gap-space-xs">' +
                '<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>' +
                '<span class="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant" id="side-status-courts">Live Facility</span>' +
              '</div>' +
              '<span class="font-label-sm text-label-sm font-semibold text-primary" id="side-status-util">ACTIVE</span>' +
            '</div>') +
            '<div class="flex flex-col gap-1">' + foot + '</div>' +
          '</div>' +
        '</aside>' +

        '<!-- Backdrop for mobile drawer -->' +
        '<div id="ds-backdrop" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 hidden md:hidden"></div>' +

        '<!-- Content Wrapper -->' +
        '<div class="w-full md:pl-64 min-h-screen flex flex-col bg-surface flex-1">' +
          '<!-- Top Header -->' +
          '<header class="fixed top-0 left-0 md:left-64 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.4)] z-40 flex items-center justify-between px-gutter md:px-gutter-desktop border-b border-outline-variant/20">' +
            '<div class="flex items-center gap-space-md flex-1 max-w-xl">' +
              '<button type="button" id="side-toggle-btn" class="md:hidden p-2 rounded-full text-on-surface-variant hover:text-on-surface border-0 bg-transparent cursor-pointer flex items-center justify-center">' +
                '<span class="material-symbols-outlined text-2xl">menu</span>' +
              '</button>' +
              '<div class="flex items-center gap-space-xs bg-surface-container-high px-space-md py-space-xs rounded-full border border-outline-variant/30">' +
                '<span class="material-symbols-outlined text-primary text-sm">location_on</span>' +
                '<span class="font-label-md text-label-md text-on-surface font-semibold truncate">' + esc(o.chip || ((h.title || "Facility") + (h.city ? ' - ' + h.city : ''))) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-space-md">' +
              '<div class="hidden lg:flex items-center gap-space-xs bg-primary/10 px-space-md py-space-xs rounded-full border border-primary/20">' +
                '<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>' +
                '<span class="font-label-md text-label-md text-primary font-semibold">' + (o.pill != null ? esc(o.pill) : (h.status === "approved" ? "Approved Partner" : esc(h.status || "Active Partner"))) + '</span>' +
              '</div>' +
              '<span id="dashboard-bellslot" class="dashboard-bellslot"></span>' +
              '<details class="facility-account"><summary aria-label="Account menu">' +
                '<div class="facility-avatar-wrap">' +
                  '<span class="facility-avatar">' + (h.img ? '<img src="' + esc(h.img) + '" alt="">' : initial) + '</span>' +
                  '<span class="facility-status-dot" aria-hidden="true"></span>' +
                '</div>' +
                '<span class="facility-account-text">' +
                  '<strong>' + esc(h.title || "Facility") + '</strong>' +
                  '<small>' + esc(h.sub || "Director") + '</small>' +
                '</span>' +
                '<span class="material-symbols-outlined facility-chevron" aria-hidden="true">expand_more</span>' +
              '</summary><div class="facility-account-menu">' +
                accountMenu(h) +
              '</div></details>' +
            '</div>' +
          '</header>' +

          '<!-- Main Workspace -->' +
          '<main class="w-full pt-16 bg-surface min-h-screen flex-1 flex flex-col">' +
            '<div id="sec" class="px-gutter md:px-gutter-desktop py-space-lg flex flex-col gap-space-lg max-w-[1560px] mx-auto w-full"></div>' +
          '</main>' +
        '</div>' +
      '</div>';

    if (D.notify) D.notify.mount();
    var accountMenu = root.querySelector(".facility-account");
    accountMenu.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { accountMenu.open = false; accountMenu.querySelector("summary").focus(); }
    });
    accountMenu.addEventListener("focusout", function (event) { if (!accountMenu.contains(event.relatedTarget)) accountMenu.open = false; });
    accountMenu.querySelectorAll(".facility-account-menu a").forEach(function (link) {
      link.addEventListener("click", function () { accountMenu.open = false; });
    });
    root.querySelector("#facility-signout").onclick = async function () {
      var result = await D.sb.auth.signOut();
      if (result.error) return D.setMsg(root, D.friendly(result.error), "err");
      location.hash = "#/auth";
      location.reload();
    };
    var aside = root.querySelector("#ds-side");
    var toggleBtn = root.querySelector("#side-toggle-btn");
    var backdrop = root.querySelector("#ds-backdrop");
    function closeDrawer() {
      if (!aside) return;
      aside.classList.add("-translate-x-full");
      aside.classList.remove("translate-x-0");
      if (backdrop) backdrop.classList.add("hidden");
    }
    function openDrawer() {
      if (!aside) return;
      aside.classList.remove("-translate-x-full");
      aside.classList.add("translate-x-0");
      if (backdrop) backdrop.classList.remove("hidden");
    }
    if (toggleBtn) {
      toggleBtn.onclick = function () {
        var open = aside.classList.contains("translate-x-0");
        if (open) closeDrawer(); else openDrawer();
      };
    }
    if (backdrop) backdrop.onclick = closeDrawer;

    var api = {
      main: root.querySelector("#sec"),
      setTitle: function (t, s, actions) {
        var sec = root.querySelector("#sec");
        if (!sec) return;
        var top = sec.querySelector(".dashtop-banner");
        if (top) {
          var tEl = top.querySelector("#dtitle"), sEl = top.querySelector("#dsub"), aEl = top.querySelector("#dact");
          if (tEl) tEl.textContent = t || "";
          if (sEl) sEl.textContent = s ? "— " + s : "";
          if (aEl) aEl.innerHTML = actions || "";
        }
      },
      setActive: function (key) {
        Array.prototype.forEach.call(root.querySelectorAll("#ds-side nav a[data-key], #ds-side nav button[data-key]"), function (e) {
          var on = e.getAttribute("data-key") === key;
          e.className = on
            ? "flex items-center gap-space-sm px-space-md py-space-sm dashboard-rounded transition-all bg-primary-container text-on-primary-container font-semibold shadow-[0_0_12px_rgba(163,230,53,0.25)] no-underline"
            : "flex items-center gap-space-sm px-space-md py-space-sm dashboard-rounded font-body-md text-body-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all no-underline";
        });
      },
      setBadge: function (key, value) {
        var b = root.querySelector('[data-badge="' + key + '"]');
        if (!b) return;
        b.textContent = value == null ? "" : String(value);
        b.hidden = value == null || value === "" || value === 0;
      },
      setStatusPill: function (courtsLive, util) {
        var c = root.querySelector("#side-status-courts");
        var u = root.querySelector("#side-status-util");
        if (c && courtsLive) c.textContent = courtsLive;
        if (u && util) u.textContent = util;
      }
    };

    if (o.onSelect) {
      Array.prototype.forEach.call(root.querySelectorAll("#ds-side nav button[data-key]"), function (b) {
        b.onclick = function () {
          api.setActive(b.getAttribute("data-key"));
          closeDrawer();
          o.onSelect(b.getAttribute("data-key"));
        };
      });
    }

    return api;
  }

  D.ui = { dash: dash, icon: icon, accountMenu: accountMenu };
})();
