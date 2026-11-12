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

  // Apply one action-button system to dynamically rendered screens and dialogs.
  function enhanceActions(root) {
    var rules = [
      [/google/i, 'login', 'secondary'],
      [/^(?:block time|block court|maintenance)/i, 'event_busy', 'primary'],
      [/^(?:today|tomorrow|select date)/i, 'calendar_today', 'secondary'],
      [/^add to calendar/i, 'calendar_today', 'secondary'],
      [/^(?:quick book|new booking|book now|book a|reserve|confirm booking)/i, 'calendar_today', 'primary'],
      [/^(?:save|confirm|approve|accept|complete|submit)/i, 'check', 'primary'],
      [/^(?:add staff|add player|invite)/i, 'person_add', 'secondary'],
      [/^(?:add|create|register|sign up)/i, 'add', 'primary'],
      [/^(?:upload|replace image)/i, 'upload', 'secondary'],
      [/^(?:export|download)/i, 'download', 'secondary'],
      [/^(?:view public|public club)/i, 'open_in_new', 'secondary'],
      [/^(?:manage|view|open|details)/i, 'arrow_forward', 'secondary'],
      [/^(?:edit|configure|set rules|connect)/i, 'edit', 'secondary'],
      [/^(?:cancel|close|back|clear|reset)/i, 'close', 'secondary'],
      [/^(?:delete|remove|reject)/i, 'delete', 'danger'],
      [/^(?:sign in|log in|continue)/i, 'login', 'primary'],
      [/^(?:sign out|log out)/i, 'logout', 'secondary'],
      [/^(?:apply|search|find courts)/i, 'check', 'primary']
    ];
    root.querySelectorAll('button, a.btn, a.pill, a.transactions-button, a.setup-action, a[class*="bg-"], label.qrfile').forEach(function (button) {
      if (button.matches('#grid > article > a.relative:first-child,[role="switch"],.booking-decision-action,.notification-filter,.payment-group,.qrtab')) return;
      if (button.matches('[role="tab"],.datetime-trigger,.segbtn,.slot,.slot-btn,.bellbtn,.nitem,.proof-icon-action,[data-date],[data-month],[data-landing-section],.court-icon-action') || button.closest('#ds-toast-stack,.toast-region,.confirmation-modal,.datetime-picker,.city-options,#ds-side,.facility-account-menu,#nslots,[role="tablist"],.club-public,.book-public,#ds-book-page')) return;
      var copy = button.cloneNode(true);
      copy.querySelectorAll('svg,i,.material-symbols-outlined,.mi').forEach(function (node) { node.remove(); });
      var label = copy.textContent.trim().replace(/\s+/g, ' ');
      if (label === 'Cancel booking') {
        var walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT), textNode;
        while ((textNode = walker.nextNode())) {
          if (textNode.nodeValue.includes('Cancel booking')) textNode.nodeValue = textNode.nodeValue.replace('Cancel booking', 'Cancel Booking');
        }
        label = 'Cancel Booking';
      }
      if (!label) return;
      var rule = rules.find(function (entry) { return entry[0].test(label); });
      if (!rule) {
        var primary = button.matches('.bg-primary,.bg-primary-container,.bg-brand-lime,button[type="submit"],.btn:not(.ghost):not(.danger)');
        rule = [null, primary ? 'check' : 'arrow_forward', primary ? 'primary' : 'secondary'];
      }
      button.classList.add('ds-action');
      button.classList.remove('ds-action-primary', 'ds-action-secondary', 'ds-action-danger');
      button.classList.add('ds-action-' + rule[2]);
      if (!button.querySelector('svg,i,.material-symbols-outlined,.mi')) {
        var symbol = document.createElement('span'); symbol.className = 'material-symbols-outlined ds-action-icon'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = rule[1]; button.prepend(symbol);
      }
    });
  }
  // Decorate controls without wrappers so form grids, labels and handlers stay intact.
  function enhanceInputs(root) {
    var paths = {
      text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
      date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
      time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
      phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 2.1L7.7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.6l2.8.5a2 2 0 0 1 2.1 2.4Z"/>',
      location: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      club: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
      number: '<path d="M4 9h16M3 15h16M10 3 8 21M17 3l-2 18"/>',
      money: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
      link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>'
    };
    root.querySelectorAll('input, textarea, select').forEach(function (field) {
      if (field.hasAttribute('data-has-icon') || field.classList.contains('ds-input-icon') || field.matches('[type="hidden"],[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"],[type="submit"],[type="button"],[type="reset"]')) return;
      // Custom date/time controls and search boxes already provide their own icons.
      if (field.closest('.datetime-picker,.leaflet-control,.book-public,#ds-book-page') || Array.from(field.parentElement.children).some(function (sibling) {
        return sibling !== field && (sibling.matches('svg,.material-symbols-outlined,.fa-search,.fa-magnifying-glass') ||
          (sibling.matches('.pointer-events-none') && sibling.querySelector('i,svg,.material-symbols-outlined')));
      })) return;
      var label = field.labels && field.labels[0];
      var hint = [field.type, field.name, field.id, field.placeholder, field.getAttribute('aria-label'), label && label.textContent].join(' ').toLowerCase();
      var kind = /password/.test(hint) ? 'lock' : /email|e-mail/.test(hint) ? 'mail' : /phone|mobile|tel/.test(hint) ? 'phone' : /search/.test(hint) ? 'search' : /latitude|longitude|coordinate|address|street|province|city|barangay|zip|location/.test(hint) ? 'location' : /rate|amount|price|fee/.test(hint) ? 'money' : /guest|manager|full.?name|player|account.?name|first.?name|last.?name/.test(hint) ? 'person' : /club|court|venue|surface/.test(hint) ? 'club' : /url|website/.test(hint) ? 'link' : field.type === 'number' ? 'number' : 'text';
      if (/^(date|datetime-local|month|week)$/.test(field.type)) kind = 'date';
      if (field.type === 'time') kind = 'time';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#91a99b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + paths[kind] + '</svg>';
      field.style.setProperty('--ds-field-icon', 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
      field.classList.add('ds-input-icon');
    });
  }
  if (typeof MutationObserver !== 'undefined') {
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; enhanceActions(document); enhanceInputs(document); });
    }).observe(document.body, { childList: true, subtree: true });
    enhanceActions(document);
    enhanceInputs(document);
  }

  // Shared account card for the public navigation and facility dashboard.
  function renderAccountMenu(h, signoutId) {
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
      '<a href="#/admin/' + esc(h.slug) + '" class="facility-menu-item">' +
        '<div class="facility-item-main">' +
          '<div class="facility-item-icon"><span class="material-symbols-outlined">dashboard</span></div>' +
          '<div class="facility-item-copy">' +
            '<span class="facility-item-title">Dashboard</span>' +
            '<span class="facility-item-sub">Facility overview & activity</span>' +
          '</div>' +
        '</div>' +
        '<span class="material-symbols-outlined facility-item-arrow">chevron_right</span>' +
      '</a>' +
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
    (!h.slug ? '<a href="#/me" class="facility-menu-item"><div class="facility-item-main"><div class="facility-item-icon"><span class="material-symbols-outlined">dashboard</span></div><div class="facility-item-copy"><span class="facility-item-title">Dashboard</span><span class="facility-item-sub">Your bookings & clubs at a glance</span></div></div><span class="material-symbols-outlined facility-item-arrow">chevron_right</span></a>' : '') +
    '<a href="' + (h.slug ? '#/admin/' + esc(h.slug) + '/profile' : '#/me') + '" class="facility-menu-item">' +
      '<div class="facility-item-main">' +
        '<div class="facility-item-icon"><span class="material-symbols-outlined">person</span></div>' +
        '<div class="facility-item-copy">' +
          '<span class="facility-item-title">Personal Profile</span>' +
          '<span class="facility-item-sub">' + (h.slug ? 'Club details, contact & media' : 'Player stats & reservations') + '</span>' +
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
    var user = D.state.user || {};
    var accountName = (user.user_metadata && user.user_metadata.full_name) || user.email || h.title || "Account";
    var accountInitial = esc(accountName.trim().charAt(0).toUpperCase() || "?");

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
        ? '<a class="' + cls + '" data-key="' + esc(it.key) + '"' + (on ? ' aria-current="page"' : '') + ' href="' + esc(it.href) + '">' + inner + "</a>"
        : '<button type="button" class="' + cls + ' w-full text-left border-0 bg-transparent cursor-pointer" data-key="' + esc(it.key) + '"' + (on ? ' aria-current="page"' : '') + '>' + inner + "</button>";
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
                '<span class="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant" id="side-status-courts">' + esc(o.statusLabel || "Live Facility") + '</span>' +
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
              '<div class="facility-partner-badge hidden lg:flex items-center gap-space-xs bg-primary/10 px-space-md py-space-xs rounded-full border border-primary/20">' +
                '<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>' +
                '<span class="font-label-md text-label-md text-primary font-semibold">' + (o.pill != null ? esc(o.pill) : (h.status === "approved" ? "Approved Partner" : esc(h.status || "Active Partner"))) + '</span>' +
              '</div>' +
              '<span id="dashboard-bellslot" class="dashboard-bellslot"></span>' +
              '<details class="facility-account"><summary aria-label="Account menu">' +
                '<div class="facility-avatar-wrap">' +
                  '<span class="facility-avatar">' + (h.img ? '<img src="' + esc(h.img) + '" alt="">' : accountInitial) + '</span>' +
                  '<span class="facility-status-dot" aria-hidden="true"></span>' +
                '</div>' +
                '<span class="facility-account-text">' +
                  '<strong>' + esc(accountName) + '</strong>' +
                  '<small>' + esc(h.sub || "Director") + '</small>' +
                '</span>' +
                '<span class="material-symbols-outlined facility-chevron" aria-hidden="true">expand_more</span>' +
              '</summary><div class="facility-account-menu">' +
                renderAccountMenu(h) +
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
          if (on) e.setAttribute("aria-current", "page");
          else e.removeAttribute("aria-current");
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

  function dateTimePickers(root, timezone) {
    if (typeof HTMLElement.prototype.showPopover !== 'function') return;
    root.querySelectorAll('input[type="datetime-local"], input[type="date"]').forEach(function (input) {
      var dateOnly = input.type === 'date';
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      var draft = input.value || today + 'T08:00', month = draft.slice(0, 7);
      var labelElement = input.closest('label') || root.querySelector('label[for="' + input.id + '"]');
      var label = dateOnly ? 'Booking date' : (labelElement ? labelElement.firstChild.textContent.trim() : 'Date and time');
      var host = document.createElement('span'); host.className = 'datetime-control';
      var trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'datetime-trigger';
      trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
      var panel = document.createElement('div'); panel.className = 'datetime-picker'; panel.id = input.id + '-picker';
      panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label);
      trigger.setAttribute('aria-controls', panel.id);
      input.type = 'hidden'; input.required = false; input.after(host); host.append(trigger, panel);
      function text() {
        trigger.innerHTML = '<span>' + (input.value ? esc(new Date(dateOnly ? input.value + 'T12:00:00' : input.value).toLocaleString('en-US', dateOnly ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })) : (dateOnly ? 'Select date' : 'Select date & time')) + '</span><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>';
        trigger.classList.toggle('has-value', !!input.value);
      }
      function position() {
        var rect = trigger.getBoundingClientRect(), width = Math.min(304, window.innerWidth - 24);
        panel.style.width = width + 'px';
        panel.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px';
        panel.style.top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - panel.offsetHeight - 12)) + 'px';
      }
      function draw() {
        var date = new Date(month + '-01T12:00:00'), year = date.getFullYear(), m = date.getMonth();
        var count = new Date(year, m + 1, 0).getDate(), days = '';
        for (var blank = 0; blank < date.getDay(); blank++) days += '<span></span>';
        for (var day = 1; day <= count; day++) {
          var value = month + '-' + pad(day);
          days += '<button type="button" data-date="' + value + '" aria-label="' + value + '" aria-pressed="' + (value === draft.slice(0, 10)) + '"' + (value === today ? ' aria-current="date"' : '') + (input.min && value < input.min.slice(0,10) ? ' disabled' : '') + '>' + day + '</button>';
        }
        function options(total, selected) {
          var html = ''; for (var n = 0; n < total; n++) html += '<option value="' + pad(n) + '"' + (pad(n) === selected ? ' selected' : '') + '>' + pad(n) + '</option>'; return html;
        }
        panel.innerHTML = '<div class="datetime-month"><strong aria-live="polite">' + date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + '</strong><button type="button" data-month="-1" aria-label="Previous month">‹</button><button type="button" data-month="1" aria-label="Next month">›</button></div>' +
          '<div class="datetime-week" aria-hidden="true">' + ['S','M','T','W','T','F','S'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="datetime-days">' + days + '</div>' +
          (dateOnly ? '' : '<div class="datetime-time"><span>Time <small>(24-hour)</small></span><select aria-label="Hour">' + options(24, draft.slice(11,13)) + '</select><span>:</span><select aria-label="Minute">' + options(60, draft.slice(14,16)) + '</select></div>') +
          '<div class="datetime-actions">' + (dateOnly ? '' : '<button type="button" data-clear>Clear</button>') + '<button type="button" data-today>Today</button><button type="button" data-apply>Apply</button></div>';
      }
      panel.addEventListener('change', function () {
        if (dateOnly) return;
        var fields = panel.querySelectorAll('select'); draft = draft.slice(0,10) + 'T' + fields[0].value + ':' + fields[1].value;
      });
      panel.addEventListener('click', function (event) {
        var button = event.target.closest('button'); if (!button) return;
        event.preventDefault();
        if (button.hasAttribute('data-month')) {
          var d = new Date(month + '-01T12:00:00'); d.setMonth(d.getMonth() + Number(button.dataset.month)); month = d.getFullYear() + '-' + pad(d.getMonth() + 1); draw(); panel.querySelector('[data-month="' + button.dataset.month + '"]').focus();
        } else if (button.dataset.date) {
          draft = button.dataset.date + draft.slice(10); draw(); panel.querySelector('[data-date="' + draft.slice(0,10) + '"]').focus();
        } else if (button.hasAttribute('data-today')) { draft = today + draft.slice(10); month = today.slice(0,7); draw(); panel.querySelector('[data-date="' + today + '"]').focus();
        } else {
          input.value = button.hasAttribute('data-clear') ? '' : (dateOnly ? draft.slice(0,10) : draft);
          input.dispatchEvent(new Event('change', { bubbles: true })); text(); panel.hidePopover(); trigger.focus();
        }
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); }
        var offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (event.target.dataset.date && offsets[event.key]) {
          event.preventDefault(); var d = new Date(event.target.dataset.date + 'T12:00:00'); d.setDate(d.getDate() + offsets[event.key]);
          var value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
          if (input.min && value < input.min.slice(0,10)) return;
          month = value.slice(0,7); draft = value + draft.slice(10); draw(); panel.querySelector('[data-date="' + value + '"]').focus();
        }
      });
      panel.addEventListener('toggle', function (event) { trigger.setAttribute('aria-expanded', String(event.newState === 'open')); });
      trigger.onclick = function (event) {
        event.preventDefault();
        if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
        draft = input.value || today + 'T08:00'; month = draft.slice(0,7); draw(); panel.showPopover(); position(); panel.querySelector('[aria-pressed="true"]').focus();
      };
      input.addEventListener('change', text);
      text();
    });
  }

  function timePickers(root) {
    if (typeof HTMLElement.prototype.showPopover !== 'function') return;
    root.querySelectorAll('input[type="time"]').forEach(function (input) {
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var host = document.createElement('span'); host.className = 'datetime-control';
      var trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'datetime-trigger';
      var name = input.closest('label').firstChild.textContent.trim();
      var title = name === 'Closes' ? 'Closing time' : name === 'Opens' ? 'Opening time' : name + ' time';
      trigger.setAttribute('aria-label', title); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
      var panel = document.createElement('div'); panel.className = 'datetime-picker time-picker'; panel.id = input.id + '-picker';
      panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title);
      trigger.setAttribute('aria-controls', panel.id);
      input.type = 'hidden'; input.required = false; input.after(host); host.append(trigger, panel);
      function text() {
        var parts = (input.value || '00:00').split(':'), hour = Number(parts[0]);
        trigger.innerHTML = '<span>' + (hour % 12 || 12) + ':' + parts[1] + ' ' + (hour >= 12 ? 'PM' : 'AM') + '</span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>';
        trigger.classList.add('has-value');
      }
      trigger.onclick = function (event) {
        event.preventDefault();
        if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
        var parts = (input.value || '08:00').split(':');
        function options(count, selected) {
          var html = ''; for (var n = 0; n < count; n++) html += '<option value="' + pad(n) + '"' + (Number(selected) === n ? ' selected' : '') + '>' + pad(n) + '</option>'; return html;
        }
        panel.innerHTML = '<div class="time-picker-title">' + esc(title) + '</div><div class="time-picker-fields"><label>Hour<select aria-label="Hour">' + options(24, parts[0]) + '</select></label><span>:</span><label>Minute<select aria-label="Minute">' + options(60, parts[1]) + '</select></label></div><p class="time-picker-hint">24-hour time · 00:00 is midnight</p><div class="datetime-actions"><button type="button" data-cancel>Cancel</button><button type="button" data-apply>Apply</button></div>';
        panel.showPopover();
        var rect = trigger.getBoundingClientRect(), width = Math.min(250, innerWidth - 24);
        panel.style.width = width + 'px'; panel.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
        panel.style.top = Math.max(12, Math.min(rect.bottom + 8, innerHeight - panel.offsetHeight - 12)) + 'px';
        panel.querySelector('select').focus();
      };
      panel.addEventListener('click', function (event) {
        var button = event.target.closest('button'); if (!button) return;
        event.preventDefault();
        if (button.hasAttribute('data-apply')) { var fields = panel.querySelectorAll('select'); input.value = fields[0].value + ':' + fields[1].value; input.dispatchEvent(new Event('change', { bubbles: true })); }
        panel.hidePopover(); trigger.focus();
      });
      panel.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); } });
      panel.addEventListener('toggle', function (event) { trigger.setAttribute('aria-expanded', String(event.newState === 'open')); });
      input.addEventListener('change', text); text();
    });
  }

  function notificationText(message) {
    var text = String(message || '').trim();
    var wording = {
      'End must be after start.': 'Select an end date and time later than the start.',
      'Choose an image first.': 'Select an image before uploading.',
      'Only JPG, PNG or WebP images are allowed.': 'Select a JPG, PNG, or WebP image.',
      'The image must be 5 MB or smaller.': 'Select an image no larger than 5 MB.',
      'Profile saved.': 'Your profile has been updated successfully.',
      'Saving court...': 'Saving court details…',
      'Uploading...': 'Uploading your image…',
      'Staff member successfully added.': 'The staff member has been added successfully.',
      'Payment and booking settings saved.': 'Payment preferences and booking rules have been updated.',
      "Enter the player's email.": 'Enter the player’s email address to continue.',
      'Choose a player first.': 'Select a registered player to continue.',
      'Enter the guest name.': 'Enter the guest’s name to continue.',
      'Pick a start time.': 'Select an available start time to continue.'
    };
    return wording[text] || text.replace(/^Saved (.+)\.$/, '$1 has been saved successfully.').replace(/^Cleared (.+)\.$/, '$1 has been cleared successfully.');
  }
  function toast(message, kind, action) {
    message = notificationText(message);
    if (!message) return function () {};
    var stack = document.getElementById('ds-toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'ds-toast-stack'; document.body.appendChild(stack); }
    stack.setAttribute('popover', 'manual');
    if (typeof stack.showPopover === 'function' && !stack.matches(':popover-open')) stack.showPopover();
    var item = document.createElement('div'); item.className = 'ds-toast' + (kind === 'err' ? ' is-error' : ''); item.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    item.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">' + (kind === 'err' ? 'error' : kind === 'ok' ? 'check_circle' : 'info') + '</span><span class="ds-toast-text"></span><button type="button" class="ds-toast-dismiss" aria-label="Dismiss notification"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>';
    var title = kind === 'err' ? 'Action Required' : kind === 'ok' ? 'Update Successful' : 'Notification';
    if (/invalid login credentials/i.test(message)) { title = 'Unable to Sign In'; message = 'The email address or password is incorrect. Please check your details and try again.'; }
    else if (/saved|updated successfully/i.test(message)) title = 'Changes Saved';
    else if (/booked|booking.*confirmed/i.test(message)) title = 'Booking Confirmed';
    else if (/uploading/i.test(message)) title = 'Upload in Progress';
    else if (/uploaded/i.test(message)) title = 'Upload Complete';
    else if (/copied/i.test(message)) title = 'Copied to Clipboard';
    else if (/downloaded/i.test(message)) title = 'Download Complete';
    var copy = item.querySelector('.ds-toast-text'), heading = document.createElement('strong'), description = document.createElement('span');
    heading.className = 'ds-toast-title'; heading.textContent = title;
    description.className = 'ds-toast-description'; description.textContent = message;
    copy.append(heading, description);
    item.setAttribute('aria-atomic', 'true');
    var timer;
    function dismiss() { clearTimeout(timer); item.remove(); }
    function schedule() { clearTimeout(timer); timer = setTimeout(dismiss, 3000); }
    item.querySelector('.ds-toast-dismiss').onclick = dismiss;
    if (action) {
      var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'ds-toast-action'; retry.textContent = action.label;
      retry.onclick = function () { dismiss(); action.run(); }; item.querySelector('.ds-toast-dismiss').before(retry);
    }
    item.addEventListener('mouseenter', function () { clearTimeout(timer); });
    item.addEventListener('mouseleave', schedule);
    item.addEventListener('focusin', function () { clearTimeout(timer); });
    item.addEventListener('focusout', schedule);
    stack.appendChild(item); schedule();
    while (stack.children.length > 3) stack.firstElementChild.remove();
    return dismiss;
  }

  // Legacy forms still write to .msg nodes directly. Forward them to the
  // floating notification system and clear their inline layout immediately.
  function forwardAlerts() {
    document.querySelectorAll('.msg,[role="alert"]').forEach(function (node) {
      if (!node.classList.contains('msg') && node.querySelector('button,input,form')) return;
      if (node.closest('#ds-toast-stack,.toast-region')) return;
      var message = node.textContent.trim();
      if (!message) return;
      var kind = node.classList.contains('err') ? 'err' : node.classList.contains('ok') ? 'ok' : 'info';
      node.replaceChildren();
      toast(message, kind);
    });
  }
  if (typeof MutationObserver !== 'undefined') {
    var alertsQueued = false;
    new MutationObserver(function () {
      if (alertsQueued) return;
      alertsQueued = true;
      queueMicrotask(function () { alertsQueued = false; forwardAlerts(); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    forwardAlerts();
  }

  var confirmationId = 0;
  function confirmAction(message, options) {
    options = options || {};
    return new Promise(function (resolve) {
      var previous = document.activeElement, modal = document.createElement('dialog');
      var id = 'ds-confirm-' + (++confirmationId), result = null;
      modal.className = 'confirmation-modal'; modal.setAttribute('aria-labelledby', id); modal.setAttribute('aria-describedby', id + '-message');
      modal.innerHTML = '<form><div class="confirmation-heading"><span class="material-symbols-outlined" aria-hidden="true">' + (options.danger === false ? 'help' : 'warning') + '</span><h2 id="' + id + '">' + esc(options.title || 'Confirm action') + '</h2></div><p id="' + id + '-message"></p>' +
        (options.reason ? '<label class="confirmation-reason">Reason' + (options.requireReason ? ' (required)' : ' (optional)') + '<textarea rows="3" maxlength="500"' + (options.requireReason ? ' required' : '') + '></textarea><small>The recipient will see this reason.</small></label>' : '') +
        '<div class="confirmation-actions"><button type="button" data-dismiss class="ds-action ds-action-secondary"><span class="material-symbols-outlined" aria-hidden="true">close</span>Go back</button><button type="submit" class="ds-action ' + (options.danger === false ? 'ds-action-primary' : 'ds-action-danger') + '"><span class="material-symbols-outlined" aria-hidden="true">' + (options.danger === false ? 'check' : 'warning') + '</span>' + esc(options.confirmText || 'Confirm') + '</button></div></form>';
      modal.querySelector('p').textContent = message;
      modal.querySelector('[data-dismiss]').onclick = function () { modal.close(); };
      modal.querySelector('form').onsubmit = function (event) {
        event.preventDefault(); var field = modal.querySelector('textarea'), reason = field ? field.value.trim() : '';
        if (options.requireReason && !reason) { field.setCustomValidity('Enter a reason.'); field.reportValidity(); field.oninput = function () { field.setCustomValidity(''); }; return; }
        result = { reason: reason || null }; modal.close();
      };
      modal.addEventListener('close', function () { modal.remove(); if (previous && previous.isConnected) previous.focus(); resolve(result); }, { once: true });
      document.body.appendChild(modal); modal.showModal(); modal.querySelector('[data-dismiss]').focus();
    });
  }

  function emptyState(title, description, symbol, action) {
    return '<div class="app-empty-state"><span class="material-symbols-outlined" aria-hidden="true">' + esc(symbol || 'inbox') + '</span><div><strong>' + esc(title) + '</strong><p>' + esc(description) + '</p>' + (action ? '<a href="' + esc(action.href) + '">' + esc(action.label) + '</a>' : '') + '</div></div>';
  }
  function errorPage(root, options) {
    root.innerHTML = '<section class="page-load-error"><span class="material-symbols-outlined" aria-hidden="true">' + esc(options.icon || 'error') + '</span><h1>' + esc(options.title || 'Unable to load this page') + '</h1><p>' + esc(options.text || 'Please try again.') + '</p><div>' + (options.retry ? '<button type="button">Retry</button>' : '') + '<a class="btn" href="#/">Return home</a></div></section>';
    if (options.retry) root.querySelector('button').onclick = options.retry;
  }
  D.ui = { dash: dash, icon: icon, accountMenu: renderAccountMenu, dateTimePickers: dateTimePickers, timePickers: timePickers, toast: toast, confirmAction: confirmAction, emptyState: emptyState, errorPage: errorPage };
})();
