// In-app notifications: bell, unread badge, dropdown, live toast.
// Rows come from public.notifications (RLS: a user sees only their own). Realtime delivers new ones.
(function () {
  "use strict";
  var D = window.DS, sb = D.sb, esc = D.esc;
  var items = [], tenants = {}, chan = null, poll = null, uid = null, openMenu = false;

  function ago(iso) {
    var s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }
  function club(n) { return (tenants[n.tenant_id] || {}).name || "your club"; }

  // Readable text and where a click should go.
  function describe(n) {
    var code = n.message || "";
    var t = n.type, mine = !!tenants[n.tenant_id], slug = (tenants[n.tenant_id] || {}).slug;
    switch (t) {
      case "booking_received": return { icon: "event", text: "Booking " + code + " received. Pay and upload your proof to confirm it.", to: "/me" };
      case "booking_requested": return { icon: "pending_actions", text: "New booking request " + code + ".", to: "/admin/" + slug + "/bookings" };
      case "proof_uploaded": return { icon: "receipt_long", text: "Payment proof uploaded for " + code + ". Ready to review.", to: "/admin/" + slug + "/bookings" };
      case "booking_approved": return { icon: "check_circle", text: "Booking " + code + " is confirmed. See you on the court!", to: "/me" };
      case "booking_rejected": return { icon: "cancel", text: "Booking was not approved: " + (code || "no reason given"), to: "/me" };
      case "booking_cancelled":
        return mine ? { icon: "event_busy", text: "A player cancelled booking " + code + ".", to: "/admin/" + slug + "/bookings" }
                    : { icon: "event_busy", text: "Your booking was cancelled" + (code ? ": " + code : "."), to: "/me" };
      case "booking_expired": return { icon: "timer_off", text: "Booking " + code + " expired because payment was not received in time.", to: "/me" };
      case "club_registered": return { icon: "storefront", text: "New club registered: " + code + ". Review it.", to: "/platform" };
      case "club_approved": return { icon: "verified", text: club(n) + " was approved. It is now public!", to: "/me" };
      case "club_rejected": return { icon: "block", text: club(n) + " was not approved" + (code ? ": " + code : "."), to: "/me" };
      case "club_suspended": return { icon: "block", text: club(n) + " was suspended" + (code ? ": " + code : "."), to: "/me" };
      case "staff_added": return { icon: "group_add", text: "You were added as staff of " + club(n) + ".", to: slug ? "/admin/" + slug : "/me" };
      default: return { icon: "notifications", text: t, to: "/me" };
    }
  }

  function toast(text) {
    var t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status");
    t.innerHTML = '<span class="mi">notifications_active</span><span>' + esc(text) + "</span>";
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 400); }, 6000);
  }

  function slotEl() { return document.getElementById("bellslot"); }

  function paint() {
    var slot = slotEl();
    if (!slot) return;
    var unread = items.filter(function (n) { return !n.read_at; }).length;
    slot.innerHTML =
      '<div class="bell"><button type="button" class="bellbtn" aria-label="Notifications' + (unread ? ", " + unread + " unread" : "") + '" aria-expanded="' + openMenu + '">' +
      '<span class="mi">notifications</span><span class="bellbadge"' + (unread ? "" : " hidden") + ">" + (unread > 9 ? "9+" : unread) + "</span></button>" +
      '<div class="bellmenu"' + (openMenu ? "" : " hidden") + '><div class="bellhead"><b>Notifications</b>' +
      (unread ? '<button type="button" class="linkbtn" id="markall">Mark all read</button>' : "") + "</div>" +
      '<div class="belllist">' + (items.length ? items.map(function (n) {
        var d = describe(n);
        return '<button type="button" class="nitem' + (n.read_at ? "" : " unread") + '" data-id="' + esc(n.id) + '"><span class="mi">' + esc(d.icon) + "</span>" +
          '<span class="ntext">' + esc(d.text) + '<small>' + esc(ago(n.created_at)) + "</small></span></button>";
      }).join("") : '<p class="muted small nempty">You are all caught up.</p>') + "</div></div></div>";

    slot.querySelector(".bellbtn").onclick = function (e) { e.stopPropagation(); openMenu = !openMenu; paint(); };
    var all = slot.querySelector("#markall");
    if (all) all.onclick = function (e) { e.stopPropagation(); markRead(items.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; })); };
    Array.prototype.forEach.call(slot.querySelectorAll(".nitem"), function (b) {
      b.onclick = function () {
        var n = items.filter(function (x) { return x.id === b.getAttribute("data-id"); })[0];
        if (!n) return;
        if (!n.read_at) markRead([n.id]);
        openMenu = false; paint();
        D.go(describe(n).to);
      };
    });
  }

  async function markRead(ids) {
    if (!ids.length) return;
    var now = new Date().toISOString();
    items.forEach(function (n) { if (ids.indexOf(n.id) !== -1) n.read_at = now; });
    paint();
    await sb.from("notifications").update({ read_at: now }).in("id", ids); // own rows only (RLS + column grant)
  }

  async function load() {
    var r = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(25);
    if (r.error) return;
    items = r.data || [];
    paint();
  }

  function teardown() {
    if (chan) { sb.removeChannel(chan); chan = null; }
    if (poll) { clearInterval(poll); poll = null; }
    items = []; tenants = {}; uid = null; openMenu = false;
  }

  async function mount() {
    if (!D.state.user) { teardown(); return; }
    if (uid === D.state.user.id) { paint(); return; } // nav was re-rendered: just redraw the bell
    teardown();
    uid = D.state.user.id;
    paint();
    // clubs this user may read (members only; platform admin reads all) -> names and dashboard links
    var tr = await sb.from("tenants").select("id,slug,name");
    (tr.data || []).forEach(function (t) { tenants[t.id] = t; });
    await load();
    chan = sb.channel("notif-" + uid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + uid }, function (p) {
        items.unshift(p.new); paint(); toast(describe(p.new).text);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: "user_id=eq." + uid }, function () { load(); })
      .subscribe();
    poll = setInterval(load, 60000); // safety net if the live connection drops
  }

  document.addEventListener("click", function (e) {
    if (openMenu && !e.target.closest(".bell")) { openMenu = false; paint(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && openMenu) { openMenu = false; paint(); } });

  D.notify = { mount: mount };
  if (D.state.user) mount(); // nav may already be drawn
})();
