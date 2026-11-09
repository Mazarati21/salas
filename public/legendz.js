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
  function readCache(key, maxAge) {
    try {
      var cached = JSON.parse(localStorage.getItem("legendz-cache:" + key) || "null");
      return cached && Date.now() - cached.savedAt <= maxAge ? cached.payload : null;
    } catch (_) { return null; }
  }
  function writeCache(key, payload) {
    try { localStorage.setItem("legendz-cache:" + key, JSON.stringify({ savedAt: Date.now(), payload: payload })); } catch (_) {}
  }
  function setServerState(online) {
    setText("[data-server-state]", online ? "Operacional" : "Indisponível");
    all("[data-server-light]").forEach(function (node) { node.classList.toggle("is-offline", !online); });
  }
  function renderStatusHistory(history) {
    if (!history) return;
    setText("[data-availability]", history.availability30d == null ? "A recolher" : Number(history.availability30d).toFixed(2) + "%");
    setText("[data-coverage]", history.coverage30d == null ? "A recolher" : Number(history.coverage30d).toFixed(2) + "%");
    setText("[data-coverage-note]", history.coverage30d == null ? "Ainda não existem dados suficientes." : "Baseado em " + history.sampleCount + " verificações desde " + new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(new Date(history.periodStartedAt)) + ".");
    all("[data-coverage-meter]").forEach(function (node) { node.style.width = Math.max(0, Math.min(100, Number(history.coverage30d) || 0)) + "%"; });
    setText("[data-peak]", String(Number(history.peakSlots30d) || 0));
    setText("[data-sample-count]", String(Number(history.sampleCount) || 0));
    var chart = document.querySelector("[data-status-chart]");
    if (chart) {
      chart.replaceChildren();
      (history.hourly || []).forEach(function (hour, index) {
        var item = document.createElement("div");
        var bar = document.createElement("i");
        var label = document.createElement("span");
        var value = hour.onlinePercent;
        item.className = "status-hour" + (value === null ? " is-empty" : value < 100 ? " is-partial" : "");
        item.title = value === null ? "Sem dados" : value + "% operacional · pico " + (hour.peakSlots || 0) + " utilizadores";
        bar.style.height = (value === null ? 8 : Math.max(8, Number(value))) + "%";
        label.textContent = index % 4 === 0 ? new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" }).format(new Date(hour.at)) : "";
        item.append(bar, label);
        chart.appendChild(item);
      });
    }
    var incidents = document.querySelector("[data-incidents]");
    if (incidents) {
      incidents.replaceChildren();
      if (!(history.incidents || []).length) {
        var empty = document.createElement("p");
        empty.className = "incident-empty";
        empty.textContent = "Nenhum incidente registado nos últimos 30 dias.";
        incidents.appendChild(empty);
      } else {
        history.incidents.forEach(function (incident) {
          var row = document.createElement("article"), marker = document.createElement("span"), body = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("small"), state = document.createElement("b"), note;
          row.className = "incident-row " + (incident.resolvedAt ? "is-resolved" : "is-open");
          marker.textContent = incident.resolvedAt ? "✓" : "!";
          title.textContent = incident.summary;
          detail.textContent = new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.startedAt));
          state.textContent = incident.resolvedAt ? "Resolvido" : "Em análise";
          body.append(title, detail);
          if (incident.note) { note = document.createElement("p"); note.className = "incident-note"; note.textContent = incident.note; body.appendChild(note); }
          row.append(marker, body, state); incidents.appendChild(row);
        });
      }
    }
  }
  function updateMetrics() {
    return requestJson("/salas/api/status", 8000).then(function (payload) {
      writeCache("status", payload);
      var metrics = payload && payload.teamSpeakOnline && payload.metrics;
      setServerState(Boolean(metrics));
      all("[data-maintenance]").forEach(function (node) { node.hidden = !payload.maintenance || !payload.maintenance.enabled; });
      if (payload.maintenance && payload.maintenance.enabled) setText("[data-maintenance-message]", payload.maintenance.message || "O painel de salas está temporariamente indisponível.");
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
      renderStatusHistory(payload.history);
    }).catch(function () { setServerState(false); setText("[data-updated]", "Sem resposta"); })
      .finally(function () { document.body.classList.remove("is-loading-data"); });
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
    var filter = document.querySelector("[data-ban-filter]");
    var pagination = document.querySelector("[data-ban-pagination]");
    var previous = document.querySelector("[data-ban-prev]");
    var next = document.querySelector("[data-ban-next]");
    var bans = [], pageIndex = 0, pageSize = 15;
    function usePayload(payload, cached) {
      bans = Array.isArray(payload && payload.bans) ? payload.bans : [];
      setText("[data-ban-count]", String(bans.length).padStart(2, "0"));
      setText("[data-ban-summary]", bans.length === 1 ? "1 ban ativo" : bans.length + " bans ativos");
      setText("[data-ban-updated]", cached ? "A mostrar a última leitura guardada" : "Atualizado " + relativeTime(payload.fetchedAt).toLowerCase());
      render();
    }
    function render() {
      var query = search.value.trim().toLocaleLowerCase("pt-PT");
      var durationFilter = filter ? filter.value : "all";
      var visible = bans.filter(function (item) {
        var matchesQuery = [item.name, item.reason, item.staff].join(" ").toLocaleLowerCase("pt-PT").includes(query);
        var matchesDuration = durationFilter === "all" || (durationFilter === "permanent" && item.permanent) || (durationFilter === "temporary" && !item.permanent);
        return matchesQuery && matchesDuration;
      });
      var pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
      pageIndex = Math.min(pageIndex, pageCount - 1);
      var pageItems = visible.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
      rows.replaceChildren();
      if (!visible.length) {
        var emptyRow = document.createElement("tr"), emptyCell = document.createElement("td");
        emptyCell.colSpan = 5;
        emptyCell.className = "records-empty";
        emptyCell.textContent = query ? "Nenhum registo corresponde à pesquisa." : "Não existem bans ativos.";
        emptyRow.appendChild(emptyCell);
        rows.appendChild(emptyRow);
        if (pagination) pagination.hidden = true;
        setText("[data-ban-visible]", "0 registos encontrados");
        return;
      }
      pageItems.forEach(function (item) {
        var row = document.createElement("tr");
        [item.name, item.reason, item.staff, formatDate(item.createdAt), item.permanent ? "Permanente" : formatDate(item.expiresAt)].forEach(function (value, index) {
          var cell = document.createElement("td");
          cell.textContent = value;
          if (index === 0) {
            cell.className = "record-user";
            if (Number(item.technicalRecords) > 1) {
              var grouped = document.createElement("small");
              grouped.className = "record-grouped";
              grouped.textContent = item.technicalRecords + " registos técnicos agrupados";
              cell.appendChild(grouped);
            }
          }
          if (index === 4 && item.permanent) cell.className = "record-permanent";
          row.appendChild(cell);
        });
        rows.appendChild(row);
      });
      setText("[data-ban-visible]", visible.length === bans.length ? visible.length + " registos" : visible.length + " de " + bans.length + " registos");
      setText("[data-ban-page]", "Página " + (pageIndex + 1) + " de " + pageCount);
      if (pagination) pagination.hidden = pageCount <= 1;
      if (previous) previous.disabled = pageIndex === 0;
      if (next) next.disabled = pageIndex >= pageCount - 1;
    }
    search.addEventListener("input", function () { pageIndex = 0; render(); });
    if (filter) filter.addEventListener("change", function () { pageIndex = 0; render(); });
    if (previous) previous.addEventListener("click", function () { pageIndex = Math.max(0, pageIndex - 1); render(); });
    if (next) next.addEventListener("click", function () { pageIndex += 1; render(); });
    var cached = readCache("bans", 60 * 60 * 1000);
    if (cached) usePayload(cached, true);
    requestJson("/salas/api/bans", 8000).then(function (payload) {
      writeCache("bans", payload);
      usePayload(payload, false);
    }).catch(function () {
      if (cached) { setText("[data-ban-updated]", "Sem ligação · última leitura guardada"); return; }
      setText("[data-ban-summary]", "Serviço indisponível");
      setText("[data-ban-updated]", "Não foi possível sincronizar");
      rows.replaceChildren();
      var row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 5; cell.className = "records-empty"; cell.textContent = "Não foi possível obter os registos. Tenta novamente dentro de instantes.";
      row.appendChild(cell); rows.appendChild(row);
    }).finally(function () { document.body.classList.remove("is-loading-data"); });
  }

  setupTheme();
  setText("[data-year]", new Date().getFullYear());
  if (page === "home" || page === "status") {
    var cachedStatus = readCache("status", 60 * 60 * 1000);
    if (cachedStatus && cachedStatus.metrics) {
      var cachedMetrics = cachedStatus.metrics;
      setServerState(Boolean(cachedStatus.teamSpeakOnline));
      setText("[data-slots]", cachedMetrics.slotsUsed + "/" + cachedMetrics.slotsTotal);
      setText("[data-uptime]", Math.floor(Number(cachedMetrics.uptimeSeconds) / 86400) + " dias");
      setText("[data-download]", formatBytes(cachedMetrics.bytesDownloaded));
      setText("[data-upload]", formatBytes(cachedMetrics.bytesUploaded));
      setText("[data-updated]", "Última leitura guardada");
      renderStatusHistory(cachedStatus.history);
    }
    updateMetrics(); metricsTimer = setInterval(updateMetrics, 30000);
  }
  if (page === "home") setupRadio();
  if (page === "bans") setupBans();
  addEventListener("pagehide", function () { if (metricsTimer) clearInterval(metricsTimer); });
}());
