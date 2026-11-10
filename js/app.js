(function () {
  var app = document.getElementById("app");
  var routes = {
    "/": function () {
      return '<section class="hero"><img src="assets/dinkslot-logo.png" alt="DINKSLOT logo"><h1>DINKSLOT</h1><p>Book Your Slot. Own the Court.</p><p>Clubs coming soon.</p></section>';
    }
  };
  function render() {
    var path = (location.hash || "#/").slice(1) || "/";
    var view = routes[path];
    app.innerHTML = view ? view() : "<h2>Coming soon</h2><p>" + path.replace(/[<>&]/g, "") + "</p>";
  }
  window.addEventListener("hashchange", render);
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
