/* Light / dark theme, shared by Central Optimus and its apps, plus an
   optional team palette on top of it.

   The launcher and the apps live on one origin (jackdengler.github.io), so
   a single localStorage key, `co.theme` ("dark" | "light", default dark),
   drives all of them, and the `storage` event keeps an app open inside the
   launcher in step when either side toggles. Each app carries its own copy
   of this contract; keep the key and values identical.

   `co.team` ("" | "steelers" | "psu" | "amherst", default "") is a second,
   independent key: it recolours the accent and ground and works in either
   mode. It lands on <html data-team>. Apps that don't know it ignore it.

   Classic (non-module) script loaded in <head> so the theme is applied
   before first paint — no flash of the wrong palette. */
(function () {
  var KEY = "co.theme";
  var TEAM_KEY = "co.team";
  var TEAMS = ["", "steelers", "psu", "amherst"];
  // Browser chrome colour per team and mode; matches --ground in input.css.
  var BAR = {
    "": { dark: "#0b0b0b", light: "#f5f2ea" },
    steelers: { dark: "#101820", light: "#f8edcf" },
    psu: { dark: "#041e42", light: "#f3f6fb" },
    amherst: { dark: "#1a0f2e", light: "#f6f3fa" },
  };

  function read() {
    try {
      return localStorage.getItem(KEY) === "light" ? "light" : "dark";
    } catch (_) {
      return "dark";
    }
  }

  function readTeam() {
    try {
      var t = localStorage.getItem(TEAM_KEY) || "";
      return TEAMS.indexOf(t) >= 0 ? t : "";
    } catch (_) {
      return "";
    }
  }

  function apply() {
    var theme = read();
    var team = readTeam();
    var root = document.documentElement;
    root.dataset.theme = theme;
    if (team) root.dataset.team = team;
    else delete root.dataset.team;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BAR[team][theme]);
    document.dispatchEvent(
      new CustomEvent("co:theme", { detail: { theme: theme, team: team } }),
    );
  }

  function save(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) {}
    apply();
  }

  apply();
  window.addEventListener("storage", function (e) {
    if (e.key === KEY || e.key === TEAM_KEY) apply();
  });

  window.coTheme = {
    get: read,
    set: function (theme) {
      save(KEY, theme);
    },
    toggle: function () {
      this.set(read() === "light" ? "dark" : "light");
    },
    teams: TEAMS.slice(),
    getTeam: readTeam,
    setTeam: function (team) {
      save(TEAM_KEY, TEAMS.indexOf(team) >= 0 ? team : "");
    },
    nextTeam: function () {
      this.setTeam(TEAMS[(TEAMS.indexOf(readTeam()) + 1) % TEAMS.length]);
    },
  };
})();
