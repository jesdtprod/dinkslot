// Philippine address picker: Province -> City/Municipality -> Barangay (+ ZIP) from the PSGC Cloud API.
//   https://psgc.cloud/api  (public, CORS enabled, official PSGC codes, ZIP code per city/municipality)
// Used by the club registration form and the club profile. Values are stored with the PSGC codes.
//
//   var ph = DS.ph.mount(box, { values: tenantRow, cls: { label: "...", input: "..." }, manager: true, required: true });
//   ph.validate()  -> error text or null          ph.get() -> { manager_name, street, province, city, barangay, zip_code, psgc_*, address }
//
// Notes
// * ZIP autofill uses the API, then a unique province/city match in the bundled PHLPost directory.
//   Missing or ambiguous ZIPs stay editable (4 digits); saved ZIPs remain for the saved city.
// * Metro Manila has no provinces in PSGC: it appears as "Metro Manila (NCR)". Manila's barangays belong to its
//   districts (Binondo, Quiapo, ...), shown as "City of Manila - Binondo".
// * If the API cannot be reached the three dropdowns become text boxes, so registration is never blocked.
(function () {
  "use strict";
  var D = window.DS, esc = D.esc;
  var API = "https://psgc.cloud/api";
  var NCR = { name: "Metro Manila (NCR)", code: "NCR" };
  var mem = {};
  var postalIndexPromise;
  function postalName(name) {
    return clean(name).toLowerCase().replace(/\([^)]*\)/g, '').replace(/^city of\s+|\s+city$/g, '').replace(/[^a-z0-9]/g, '');
  }
  function postalIndex() {
    if (!postalIndexPromise) postalIndexPromise = fetch('assets/ph-zip-codes.json').then(function (r) {
      if (!r.ok) throw new Error('ZIP lookup unavailable');
      return r.json();
    }).then(function (data) {
      var index = {};
      data.places.forEach(function (place) {
        var key = postalName(place[0]) + ':' + postalName(place[1]);
        var codes = index[key] || (index[key] = []);
        if (codes.indexOf(place[2]) < 0) codes.push(place[2]);
      });
      return index;
    }).catch(function () { return {}; });
    return postalIndexPromise;
  }


  // The API double-encodes some accents ("Las PiÃ±as"); repair them and trim stray spaces.
  function clean(s) {
    s = String(s == null ? "" : s);
    if (/[ÃÂ]/.test(s)) { try { s = decodeURIComponent(escape(s)); } catch (e) { /* keep as is */ } }
    return s.trim();
  }
  async function get(path) {
    if (mem[path]) return mem[path];
    try { var c = sessionStorage.getItem("ph:" + path); if (c) { mem[path] = JSON.parse(c); return mem[path]; } } catch (e) { /* storage blocked */ }
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 12000);
    try {
      var r = await fetch(API + path, { signal: ctl.signal });
      if (!r.ok) throw new Error("PSGC " + r.status);
      var j = await r.json();
      if (!Array.isArray(j)) throw new Error("PSGC bad response");
      mem[path] = j;
      try { sessionStorage.setItem("ph:" + path, JSON.stringify(j)); } catch (e) { /* too large or blocked */ }
      return j;
    } finally { clearTimeout(timer); }
  }
  function byName(a, b) { return a.name.localeCompare(b.name, "en"); }

  async function loadProvinces() {
    var list = (await get("/provinces")).map(function (p) { return { code: p.code, name: clean(p.name) }; }).sort(byName);
    return [NCR].concat(list);
  }
  async function loadCities(prov) {
    var raw = await get(prov.code === "NCR" ? "/regions/1300000000/cities-municipalities" : "/provinces/" + prov.code + "/cities-municipalities");
    var hasDistricts = raw.some(function (c) { return c.type === "SubMun"; });
    var out = [];
    raw.forEach(function (c) {
      var name = clean(c.name);
      if (c.type === "SubMun") out.push({ code: c.code, label: "City of Manila - " + name, city: "City of Manila", zip: c.zip_code || "" });
      else if (hasDistricts && /^City of Manila$/i.test(name)) return; // its barangays are listed under the districts
      else out.push({ code: c.code, label: name, city: name, zip: c.zip_code || "" });
    });
    var postcodes = await postalIndex();
    out.forEach(function (city) {
      var codes = postcodes[postalName(prov.name) + ':' + postalName(city.label)];
      if (!city.zip && codes && codes.length === 1) city.zip = codes[0];
    });
    return out.sort(function (a, b) { return a.label.localeCompare(b.label, "en"); });
  }
  async function loadBarangays(city) {
    return (await get("/cities-municipalities/" + city.code + "/barangays"))
      .map(function (b) { return { code: b.code, name: clean(b.name) }; }).sort(byName);
  }

  function mount(box, o) {
    o = o || {};
    var v = o.values || {}, cls = o.cls || {}, req = !!o.required;
    var L = cls.label || "", I = cls.input || "";
    var sel = { prov: null, city: null, brgy: null }, manual = false, apiZip = "";
    var field = function (label, inner, extra) {
      return '<label class="ph-field ' + L + (extra ? " " + extra : "") + '"><span>' + label + (req ? " *" : "") + "</span>" + inner + "</label>";
    };
    var input = function (id, val, max, ph) {
      return '<input id="' + id + '" class="ph-input ' + I + '" maxlength="' + max + '" autocomplete="off" placeholder="' + esc(ph || "") + '" value="' + esc(val || "") + '">';
    };
    box.innerHTML = '<div class="ph-grid">' +
      (o.manager ? field("Manager name", input("ph-manager", v.manager_name, 80, "Person in charge of the club"), "ph-wide") : "") +
      field("Street / Purok / Sitio", input("ph-street", v.street, 120, "e.g. 12 Purok Uno, Mabini St."), "ph-wide") +
      field("Province", '<select id="ph-prov" class="ph-input ' + I + '"><option value="">Loading...</option></select>') +
      field("City / Municipality", '<select id="ph-city" class="ph-input ' + I + '" disabled><option value="">Choose a province first</option></select>') +
      field("Barangay", '<select id="ph-brgy" class="ph-input ' + I + '" disabled><option value="">Choose a city first</option></select>') +
      field("ZIP code", input("ph-zip", v.zip_code, 4, "4 digits")) +
      '</div><p class="ph-status ph-note" id="ph-status"></p>';
    var $ = function (id) { return box.querySelector("#" + id); };
    $('ph-zip').inputMode = 'numeric';
    $('ph-zip').autocomplete = 'postal-code';
    var status = function (t) { $("ph-status").textContent = t || ""; };

    function options(list, placeholder, valueOf, labelOf) {
      return '<option value="">' + esc(placeholder) + "</option>" + list.map(function (x, i) {
        return '<option value="' + i + '">' + esc(labelOf(x)) + "</option>"; }).join("");
    }
    function setZip(zip) {
      apiZip = zip || "";
      var z = $("ph-zip");
      if (apiZip) { z.value = apiZip; z.readOnly = true; }
      else { z.readOnly = false; z.value = ""; } // never keep another city's ZIP
    }
    function toText(id, val, ph) { // a dropdown that cannot be filled becomes a text box
      var s = $(id);
      var t = document.createElement("input");
      t.id = id; t.className = s.className; t.maxLength = 80; t.placeholder = ph; t.value = val || ""; t.autocomplete = "off";
      s.replaceWith(t);
    }

    var provs = [], cities = [], brgys = [];
    async function pickCities() {
      var cs = $("ph-city"), bs = $("ph-brgy");
      sel.city = null; sel.brgy = null; setZip("");
      if (!sel.prov) { cs.innerHTML = '<option value="">Choose a province first</option>'; cs.disabled = true; bs.innerHTML = '<option value="">Choose a city first</option>'; bs.disabled = true; return; }
      cs.disabled = true; cs.innerHTML = '<option value="">Loading...</option>';
      try { cities = await loadCities(sel.prov); } catch (e) { status("Could not load cities. Type your city and barangay below."); toText("ph-prov", sel.prov ? sel.prov.name : v.province, "Province"); toText("ph-city", v.city, "City / Municipality"); toText("ph-brgy", v.barangay, "Barangay"); $("ph-city").disabled = false; $("ph-brgy").disabled = false; manual = true; return; }
      cs.innerHTML = options(cities, "Choose a city or municipality", null, function (c) { return c.label; }); cs.disabled = false;
      var i = -1;
      if (v.psgc_city) i = cities.findIndex(function (c) { return c.code === v.psgc_city; });
      if (i >= 0) { cs.value = String(i); await pickBarangays(); }
      else { bs.innerHTML = '<option value="">Choose a city first</option>'; bs.disabled = true; }
    }
    async function pickBarangays() {
      var cs = $("ph-city"), bs = $("ph-brgy");
      sel.city = cs.value === "" ? null : cities[+cs.value]; sel.brgy = null;
      if (!sel.city) { bs.innerHTML = '<option value="">Choose a city first</option>'; bs.disabled = true; setZip(""); return; }
      // keep the saved ZIP when the saved city is still selected and the API has none
      setZip(sel.city.zip);
      if (!sel.city.zip && v.psgc_city === sel.city.code && v.zip_code) $("ph-zip").value = v.zip_code;
      bs.disabled = true; bs.innerHTML = '<option value="">Loading...</option>';
      try { brgys = await loadBarangays(sel.city); } catch (e) { brgys = []; }
      if (!brgys.length) { status("No barangay list for this place in the address API. Type your barangay."); toText("ph-brgy", v.barangay, "Barangay"); return; }
      status("");
      bs.innerHTML = options(brgys, "Choose a barangay", null, function (b) { return b.name; }); bs.disabled = false;
      var j = v.psgc_barangay ? brgys.findIndex(function (b) { return b.code === v.psgc_barangay; }) : -1;
      if (j >= 0) { bs.value = String(j); sel.brgy = brgys[j]; }
    }

    var ready = (async function () {
      var ps = $("ph-prov");
      try { provs = await loadProvinces(); } catch (e) {
        manual = true; status("The address service could not be reached. Type your province, city and barangay.");
        toText("ph-prov", v.province, "Province"); toText("ph-city", v.city, "City / Municipality"); toText("ph-brgy", v.barangay, "Barangay");
        $("ph-city").disabled = false; $("ph-brgy").disabled = false; return;
      }
      ps.innerHTML = options(provs, "Choose a province", null, function (p) { return p.name; });
      var k = v.psgc_province ? provs.findIndex(function (p) { return p.code === v.psgc_province; }) : -1;
      if (k >= 0) { ps.value = String(k); sel.prov = provs[k]; await pickCities(); }
      ps.onchange = function () { sel.prov = ps.value === "" ? null : provs[+ps.value]; v = Object.assign({}, v, { psgc_city: null, psgc_barangay: null }); pickCities(); };
      $("ph-city").onchange = function () { v = Object.assign({}, v, { psgc_barangay: null }); pickBarangays(); };
      $("ph-brgy").onchange = function () { var s = $("ph-brgy"); sel.brgy = s.value === "" ? null : brgys[+s.value]; };
    })();

    function text(id) { var e = $(id); return e ? e.value.trim() : ""; }
    function get() {
      var barangay = manual || !sel.brgy ? text("ph-brgy") : sel.brgy.name;
      var street = text("ph-street");
      var prov = manual || !sel.prov ? text("ph-prov") : (sel.prov.code === "NCR" ? "Metro Manila" : sel.prov.name);
      var city = manual || !sel.city ? text("ph-city") : sel.city.city;
      var brgyPart = barangay ? (/^(brgy|barangay)\b/i.test(barangay) ? barangay : "Brgy. " + barangay) : "";
      return {
        manager_name: o.manager ? (text("ph-manager") || null) : undefined,
        street: street || null, barangay: barangay || null, city: city || null, province: prov || null,
        zip_code: text("ph-zip") || null,
        psgc_province: sel.prov ? sel.prov.code : null, psgc_city: sel.city ? sel.city.code : null, psgc_barangay: sel.brgy ? sel.brgy.code : null,
        address: [street, brgyPart].filter(Boolean).join(", ") || null
      };
    }
    function validate() {
      var a = get();
      if (o.manager && req && (!a.manager_name || a.manager_name.length < 2)) return "Enter the manager's name.";
      if (req && !a.street) return "Enter the street, purok or sitio.";
      if (req && !a.province) return "Choose a province.";
      if (req && !a.city) return "Choose a city or municipality.";
      if (req && !a.barangay) return "Choose a barangay.";
      if ((req || a.zip_code) && !/^[0-9]{4}$/.test(a.zip_code || "")) return "Enter a 4-digit ZIP code.";
      return null;
    }
    return { get: get, validate: validate, ready: ready };
  }

  D.ph = { mount: mount };
})();
