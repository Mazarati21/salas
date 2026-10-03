(function () {
  var saved = localStorage.getItem("legendz-theme");
  var theme = saved === "light" || saved === "dark"
    ? saved
    : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}());
