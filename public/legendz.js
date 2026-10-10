(function () {
  "use strict";
  var root = document.documentElement;
  var page = document.body.dataset.page;
  var metricsTimer;

  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function setText(selector, value) { all(selector).forEach(function (node) { node.textContent = value; }); }
  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "--";
    if (value >= 1073741824) return (value / 1073741824).toFixed(2) + " GB";
    if (value >= 1048576) return (value / 1048576).toFixed(2) + " MB";
    return (value / 1024).toFixed(2) + " KB";
  }
  function relativeTime(value) {
    var seconds = Math.max(0, Math.floor((Date.now() - Number(value || Date.now())) / 1000));
    if (seconds < 10) return "Agora";
    if (seconds < 60) return "Há " + seconds + " s";
    return "Há " + Math.floor(seconds / 60) + " min";
  }
  function requestJson(url, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout || 8000);
    return fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); })
      .finally(function () { clearTimeout(timer); });
  }
  function setServerState(online) {
    setText("[data-server-state]", online ? "Operacional" : "Indisponível");
    all("[data-server-light]").forEach(function (node) { node.classList.toggle("is-offline", !online); });
  }
  function updateMetrics() {
    return requestJson("/salas/api/status", 8000).then(function (payload) {
      var metrics = payload && payload.teamSpeakOnline && payload.metrics;
      setServerState(Boolean(metrics));
      if (!metrics) throw new Error("Sem métricas");
      setText("[data-slots]", metrics.slotsUsed + "/" + metrics.slotsTotal);
      var days = Math.floor(Number(metrics.uptimeSeconds) / 86400);
      setText("[data-uptime]", days + (days === 1 ? " dia" : " dias"));
      setText("[data-download]", formatBytes(metrics.bytesDownloaded));
      setText("[data-upload]", formatBytes(metrics.bytesUploaded));
      setText("[data-updated]", relativeTime(payload.fetchedAt));
      all("[data-occupancy]").forEach(function (node) {
        var percent = metrics.slotsTotal ? Math.min(100, Math.max(0, metrics.slotsUsed / metrics.slotsTotal * 100)) : 0;
        node.style.width = percent + "%";
      });
    }).catch(function () { setServerState(false); setText("[data-updated]", "Sem resposta"); });
  }
  function setupTheme() {
    all("[data-theme-toggle]").forEach(function (button) {
      function sync() {
        var dark = root.dataset.theme === "dark";
        button.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
        button.setAttribute("aria-pressed", String(dark));
      }
      sync();
      button.addEventListener("click", function () {
        root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
        root.style.colorScheme = root.dataset.theme;
        try { localStorage.setItem("legendz-theme", root.dataset.theme); } catch (_) {}
        sync();
      });
    });
  }
  function setupRadio() {
    var audio = document.querySelector("[data-radio]");
    if (!audio) return;
    var state = document.querySelector("[data-radio-state]");
    audio.volume = 0.05;
    audio.addEventListener("playing", function () { state.textContent = "AO VIVO"; state.classList.add("is-live"); });
    audio.addEventListener("pause", function () { state.textContent = "EM PAUSA"; state.classList.remove("is-live"); });
    requestJson("https://api.hunter.fm/stations/live", 7000).then(function (stations) {
      var station = Array.isArray(stations) && stations.find(function (item) { return item.url === "pop"; });
      var current = station && station.live && station.live.now;
      if (!current || !current.name) return;
      setText("[data-track]", current.name);
      setText("[data-artist]", Array.isArray(current.singers) ? current.singers.join(", ") : (current.singers || "Hunter FM Pop"));
    }).catch(function () { setText("[data-track]", "Emissão Pop"); setText("[data-artist]", "Hunter FM"); });
  }
  function formatDate(seconds) {
    if (!seconds) return "Permanente";
    return new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(seconds) * 1000));
  }
  function setupBans() {
    var rows = document.querySelector("[data-ban-rows]");
    var search = document.querySelector("[data-ban-search]");
    if (!rows || !search) return;
    var bans = [];
    function render() {
      var query = search.value.trim().toLocaleLowerCase("pt-PT");
      var visible = bans.filter(function (item) { return [item.name, item.reason, item.staff].join(" ").toLocaleLowerCase("pt-PT").includes(query); });
      rows.replaceChildren();
      if (!visible.length) {
        var emptyRow = document.createElement("tr"), emptyCell = document.createElement("td");
        emptyCell.colSpan = 5;
        emptyCell.className = "records-empty";
        emptyCell.textContent = query ? "Nenhum registo corresponde à pesquisa." : "Não existem bans ativos.";
        emptyRow.appendChild(emptyCell);
        rows.appendChild(emptyRow);
        return;
      }
      visible.forEach(function (item) {
        var row = document.createElement("tr");
        [item.name, item.reason, item.staff, formatDate(item.createdAt), item.permanent ? "Permanente" : formatDate(item.expiresAt)].forEach(function (value, index) {
          var cell = document.createElement("td");
          cell.textContent = value;
          if (index === 0) cell.className = "record-user";
          if (index === 4 && item.permanent) cell.className = "record-permanent";
          row.appendChild(cell);
        });
        rows.appendChild(row);
      });
    }
    search.addEventListener("input", render);
    requestJson("/salas/api/bans", 8000).then(function (payload) {
      bans = Array.isArray(payload.bans) ? payload.bans : [];
      setText("[data-ban-count]", String(bans.length).padStart(2, "0"));
      setText("[data-ban-summary]", bans.length === 1 ? "1 ban ativo" : bans.length + " bans ativos");
      setText("[data-ban-updated]", "Atualizado " + relativeTime(payload.fetchedAt).toLowerCase());
      render();
    }).catch(function () {
      setText("[data-ban-summary]", "Serviço indisponível");
      setText("[data-ban-updated]", "Não foi possível sincronizar");
      rows.replaceChildren();
      var row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 5; cell.className = "records-empty"; cell.textContent = "Não foi possível obter os registos. Tenta novamente dentro de instantes.";
      row.appendChild(cell); rows.appendChild(row);
    });
  }

  setupTheme();
  setText("[data-year]", new Date().getFullYear());
  if (page === "home" || page === "status") { updateMetrics(); metricsTimer = setInterval(updateMetrics, 30000); }
  if (page === "home") setupRadio();
  if (page === "bans") setupBans();
  addEventListener("pagehide", function () { if (metricsTimer) clearInterval(metricsTimer); });
}());
