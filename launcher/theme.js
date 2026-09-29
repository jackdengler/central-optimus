/* Light / dark theme, shared by Central Optimus and its apps.

   The launcher and the apps live on one origin (jackdengler.github.io), so
   a single localStorage key, `co.theme` ("dark" | "light", default dark),
   drives all of them, and the `storage` event keeps an app open inside the
   launcher in step when either side toggles. Each app carries its own copy
   of this contract; keep the key and values identical.

   Classic (non-module) script loaded in <head> so the theme is applied
   before first paint — no flash of the wrong palette. */
(function () {
  var KEY = "co.theme";
  var BAR = { dark: "#0b0b0b", light: "#f5f2ea" };

  function read() {
    try {
      return localStorage.getItem(KEY) === "light" ? "light" : "dark";
    } catch (_) {
      return "dark";
    }
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BAR[theme]);
    document.dispatchEvent(new CustomEvent("co:theme", { detail: theme }));
  }

  apply(read());
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) apply(read());
  });

  window.coTheme = {
    get: read,
    set: function (theme) {
      try {
        localStorage.setItem(KEY, theme);
      } catch (_) {}
      apply(theme);
    },
    toggle: function () {
      this.set(read() === "light" ? "dark" : "light");
    },
  };
})();
