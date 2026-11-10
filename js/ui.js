// Shared layout helpers. DS.ui.dash() renders the sidebar dashboard shell used by the club
// dashboard and the super admin console. Icons are Material Symbols (loaded in index.html).
(function () {
  "use strict";
  var D = window.DS, esc = D.esc;

  function icon(name) { return '<span class="mi" aria-hidden="true">' + esc(name) + "</span>"; }

  // o = { head:{title, sub, status, img, initial}, items:[{key,label,icon,href|(button),badge}|{type:'label',label}],
  //       foot:[{label,icon,href}], active, onSelect(key) }
  // returns { main, setTitle(title, sub, actionsHtml), setActive(key), setBadge(key, value) }
  function dash(root, o) {
    var h = o.head || {};
    var avatar = h.img ? '<img class="avatar" src="' + esc(h.img) + '" alt="">'
      : '<span class="avatar ph">' + esc((h.initial || h.title || "?").charAt(0).toUpperCase()) + "</span>";
    var items = (o.items || []).map(function (it) {
      if (it.type === "label") return '<div class="navlabel">' + esc(it.label) + "</div>";
      var badge = it.badge ? '<span class="navbadge" data-badge="' + esc(it.key) + '">' + esc(it.badge) + "</span>" : '<span class="navbadge" data-badge="' + esc(it.key) + '" hidden></span>';
      var inner = icon(it.icon) + '<span class="navtext">' + esc(it.label) + "</span>" + badge;
      var cls = "navitem" + (it.key === o.active ? " on" : "");
      return it.href
        ? '<a class="' + cls + '" data-key="' + esc(it.key) + '" href="' + esc(it.href) + '">' + inner + "</a>"
        : '<button type="button" class="' + cls + '" data-key="' + esc(it.key) + '">' + inner + "</button>";
    }).join("");
    var foot = (o.foot || []).map(function (f) {
      return '<a class="navitem sub" href="' + esc(f.href) + '">' + icon(f.icon) + '<span class="navtext">' + esc(f.label) + "</span></a>";
    }).join("");

    root.innerHTML =
      '<div class="dashwrap"><div class="dash"><aside class="side">' +
      '<div class="sidehead">' + avatar + '<div class="sidehead-text"><b>' + esc(h.title || "") + "</b>" +
      (h.status ? '<span class="badge ' + esc(h.status) + '">' + esc(h.status) + "</span>" : "") +
      (h.sub ? '<span class="muted small">' + esc(h.sub) + "</span>" : "") + "</div></div>" +
      '<nav class="sidenav" aria-label="Dashboard menu">' + items + "</nav>" +
      (foot ? '<div class="sidefoot">' + foot + "</div>" : "") + "</aside>" +
      '<section class="dashmain"><div class="dashtop"><div><h1 id="dtitle"></h1><p class="muted" id="dsub"></p></div>' +
      '<div class="dashactions" id="dact"></div></div><div id="sec"></div></section></div></div>';

    var api = {
      main: root.querySelector("#sec"),
      setTitle: function (t, s, actions) {
        root.querySelector("#dtitle").textContent = t || "";
        root.querySelector("#dsub").textContent = s || "";
        root.querySelector("#dact").innerHTML = actions || "";
      },
      setActive: function (key) {
        Array.prototype.forEach.call(root.querySelectorAll(".sidenav .navitem"), function (e) {
          e.classList.toggle("on", e.getAttribute("data-key") === key);
        });
      },
      setBadge: function (key, value) {
        var b = root.querySelector('[data-badge="' + key + '"]');
        if (!b) return;
        b.textContent = value == null ? "" : String(value);
        b.hidden = value == null || value === "" || value === 0;
      }
    };
    if (o.onSelect) {
      Array.prototype.forEach.call(root.querySelectorAll("button.navitem"), function (b) {
        b.onclick = function () { api.setActive(b.getAttribute("data-key")); o.onSelect(b.getAttribute("data-key")); };
      });
    }
    return api;
  }

  D.ui = { dash: dash, icon: icon };
})();
