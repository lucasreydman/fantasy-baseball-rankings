(function () {
  const STORAGE_KEY = "draft_assistant";
  const SLOT_MAX = { C: 1, "1B": 1, "2B": 1, "3B": 1, SS: 1, OF: 3, UTIL: 1, SP: 4, RP: 1, Bench: 6 };

  let allPlayers = [];
  let draftedByOther = new Set();
  let myTeam = [];
  let actionHistory = [];

  function primaryPosition(player) {
    const s = (player.Position || "").toUpperCase();
    if (/\bC\b/.test(s)) return "C";
    if (/\b1B\b/.test(s)) return "1B";
    if (/\b2B\b/.test(s)) return "2B";
    if (/\b3B\b/.test(s)) return "3B";
    if (/\bSS\b/.test(s)) return "SS";
    if (/LF|CF|RF|OF/.test(s)) return "OF";
    return "UTIL";
  }

  function getSlotCounts() {
    const c = { C: 0, "1B": 0, "2B": 0, "3B": 0, SS: 0, OF: 0, UTIL: 0, SP: 0, RP: 0, Bench: 0 };
    myTeam.forEach(function (e) {
      const slot = e.slot;
      if (c.hasOwnProperty(slot)) c[slot]++;
    });
    return c;
  }

  function nextSlot(player) {
    const c = getSlotCounts();
    if (player.Role === "Hitter") {
      const pos = primaryPosition(player);
      if (pos !== "UTIL" && c[pos] < SLOT_MAX[pos]) return pos;
      if (c.UTIL < SLOT_MAX.UTIL) return "UTIL";
      return "Bench";
    }
    if (player.Role === "SP") return c.SP < SLOT_MAX.SP ? "SP" : "Bench";
    if (player.Role === "RP") return c.RP < SLOT_MAX.RP ? "RP" : "Bench";
    return "Bench";
  }

  function totalPicks() {
    return draftedByOther.size + myTeam.length;
  }

  function parseCSV(text) {
    const lines = [];
    let i = 0;
    while (i < text.length) {
      const row = [];
      while (i < text.length) {
        if (text[i] === '"') {
          i++;
          let cell = "";
          while (i < text.length) {
            if (text[i] === '"') {
              i++;
              if (text[i] === '"') { cell += '"'; i++; }
              else break;
            } else { cell += text[i]; i++; }
          }
          row.push(cell);
          if (text[i] === ",") i++;
          else if (text[i] === "\n" || text[i] === "\r") break;
        } else {
          let cell = "";
          while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
            cell += text[i];
            i++;
          }
          row.push(cell.trim());
          if (text[i] === "\n" || text[i] === "\r") {
            if (text[i] === "\r") i++;
            if (text[i] === "\n") i++;
            break;
          }
          if (text[i] === ",") i++;
        }
      }
      if (row.some(function (c) { return c.length > 0; })) lines.push(row);
    }
    return lines;
  }

  function csvToPlayers(lines) {
    if (lines.length < 2) return [];
    const headers = lines[0].map(function (h) { return h.trim(); });
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const o = { id: "r" + i };
      headers.forEach(function (h, j) {
        o[h] = row[j] != null ? String(row[j]).trim() : "";
      });
      o.Rank = parseInt(o.Rank, 10) || 0;
      o.VORP = parseFloat(o.VORP) || 0;
      o.Tier = parseInt(o.Tier, 10) || 1;
      o.TierDropStrength = parseFloat(o.TierDropStrength) || 0;
      o.FinalWeeklyImpact = parseFloat(o.FinalWeeklyImpact) || 0;
      o.PointsPerEvent = parseFloat(o.PointsPerEvent) || 0;
      out.push(o);
    }
    return out;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        draftedByOther = new Set(Array.isArray(data.draftedByOther) ? data.draftedByOther : []);
        myTeam = Array.isArray(data.myTeam) ? data.myTeam : [];
        actionHistory = Array.isArray(data.actionHistory) ? data.actionHistory : [];
      }
    } catch (_) {
      draftedByOther = new Set();
      myTeam = [];
      actionHistory = [];
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      draftedByOther: Array.from(draftedByOther),
      myTeam: myTeam,
      actionHistory: actionHistory
    }));
  }

  function getAvailable() {
    return allPlayers.filter(function (p) { return !draftedByOther.has(p.id); });
  }

  var currentFilter = "All";
  var currentSort = "VORP";

  function getFilteredAvailable() {
    var search = (document.getElementById("search") || {}).value || "";
    var filter = currentFilter;
    var list = getAvailable();
    if (filter !== "All") {
      if (filter === "Needed") {
        var c = getSlotCounts();
        list = list.filter(function (p) {
          var slot = nextSlot(p);
          if (slot === "Bench") return false;
          return c[slot] < SLOT_MAX[slot];
        });
      } else if (filter === "Hitter" || filter === "SP" || filter === "RP") {
        list = list.filter(function (p) { return p.Role === filter; });
      } else {
        list = list.filter(function (p) { return primaryPosition(p) === filter; });
      }
    }
    if (search.trim()) {
      var q = search.toLowerCase().trim();
      list = list.filter(function (p) { return (p.Name || "").toLowerCase().indexOf(q) !== -1; });
    }
    if (currentSort === "Weekly") {
      list = list.slice().sort(function (a, b) {
        var wa = Number(a.FinalWeeklyImpact) || 0;
        var wb = Number(b.FinalWeeklyImpact) || 0;
        return wb - wa;
      });
    } else {
      list = list.slice().sort(function (a, b) { return (b.VORP || 0) - (a.VORP || 0); });
    }
    return list;
  }

  function badgeClass(p) {
    if (p.Role === "SP") return "badge-sp";
    if (p.Role === "RP") return "badge-rp";
    const pos = primaryPosition(p);
    if (pos === "C") return "badge-c";
    if (pos === "OF") return "badge-of";
    if (pos === "1B" || pos === "2B" || pos === "3B" || pos === "SS") return "badge-if";
    return "badge-if";
  }

  function vorpBarClass(pct) {
    if (pct > 0.8) return "vp-80";
    if (pct > 0.6) return "vp-60";
    if (pct > 0.4) return "vp-40";
    if (pct > 0.2) return "vp-20";
    return "vp-0";
  }

  function isPositionUnfilled(player) {
    var c = getSlotCounts();
    var slot = nextSlot(player);
    return slot !== "Bench" && c[slot] < SLOT_MAX[slot];
  }

  function renderTable() {
    var list = getFilteredAvailable();
    var tbody = document.getElementById("playersBody");
    tbody.innerHTML = "";
    var maxVORP = list.length ? Math.max.apply(null, list.map(function (p) { return p.VORP || 0; })) : 1;
    var tierClass = function (t) { t = t || 1; return "tier-" + (((t - 1) % 10) + 1); };
    list.forEach(function (p, i) {
      var tr = document.createElement("tr");
      tr.classList.add(tierClass(p.Tier || 1));
      tr.dataset.id = p.id;
      var vorpPct = maxVORP > 0 ? (p.VORP || 0) / maxVORP : 0;
      var barW = Math.max(0, Math.min(100, vorpPct * 100));
      var barHtml = "<div class=\"vorp-bar-wrap\"><div class=\"vorp-bar " + vorpBarClass(vorpPct) + "\" style=\"width:" + barW + "%\"></div></div>";
      var neededDot = isPositionUnfilled(p) ? "<span class=\"needed-dot\" title=\"Position not yet filled\"></span>" : "";
      var badge = "<span class=\"badge " + badgeClass(p) + "\">" + (p.Role === "Hitter" ? primaryPosition(p) : p.Role) + "</span>";
      var nameHtml = "<div class=\"name-cell\">" + neededDot + badge + " " + escapeHtml(p.Name) + "</div>";
      var weekly = (p.FinalWeeklyImpact != null && Number(p.FinalWeeklyImpact)) ? Number(p.FinalWeeklyImpact).toFixed(2) : "";
      var ptsEvent = (p.PointsPerEvent != null && Number(p.PointsPerEvent)) ? Number(p.PointsPerEvent).toFixed(2) : "";
      tr.innerHTML =
        "<td class=\"col-cliff\">" + barHtml + "</td>" +
        "<td class=\"num\">" + p.Rank + "</td>" +
        "<td>" + nameHtml + "</td>" +
        "<td>" + escapeHtml(p.Position) + "</td>" +
        "<td class=\"col-role\">" + escapeHtml(p.Role) + "</td>" +
        "<td class=\"num col-vorp\">" + (p.VORP != null ? p.VORP.toFixed(2) : "") + "</td>" +
        "<td class=\"col-expanded num\">" + weekly + "</td>" +
        "<td class=\"col-expanded num\">" + ptsEvent + "</td>" +
        "<td>" + (p.Tier || 1) + "</td>" +
        "<td class=\"num col-tier-drop\">" + (p.TierDropStrength != null ? Number(p.TierDropStrength).toFixed(2) : "") + "</td>" +
        "<td class=\"col-actions\"><button type=\"button\" class=\"btn-row btn-other\" title=\"Drafted by other team\">Remove</button><button type=\"button\" class=\"btn-row btn-me\" title=\"Drafted by me\">Draft</button></td>";
      tr.querySelector(".btn-other").addEventListener("click", function (e) { e.stopPropagation(); draftByOther(p.id); });
      tr.querySelector(".btn-me").addEventListener("click", function (e) { e.stopPropagation(); draftByMe(p); });
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function openPopup(player) {
    document.getElementById("popupName").textContent = player.Name;
    document.getElementById("popupInfo").textContent = player.Position + " · " + player.Role + " · VORP " + (player.VORP != null ? player.VORP.toFixed(2) : "");
    document.getElementById("popupOverlay").classList.add("show");
    document.getElementById("btnOther").onclick = function () { draftByOther(player.id); closePopup(); };
    document.getElementById("btnMe").onclick = function () { draftByMe(player); closePopup(); };
  }

  function closePopup() {
    document.getElementById("popupOverlay").classList.remove("show");
  }

  function draftByOther(id) {
    draftedByOther.add(id);
    actionHistory.push({ type: "other", id: id });
    saveState();
    refresh();
  }

  function draftByMe(player) {
    const slot = nextSlot(player);
    draftedByOther.add(player.id);
    myTeam.push({ id: player.id, slot: slot });
    actionHistory.push({ type: "me", id: player.id });
    saveState();
    refresh();
  }

  function refresh() {
    renderTable();
    renderStatCards();
    renderDraftContext();
    renderSlotAlerts();
    renderMyTeam();
    renderSlots();
  }

  function renderDraftContext() {
    var c = getSlotCounts();
    var picks = myTeam.length;
    var hitterStarters = c.C + c["1B"] + c["2B"] + c["3B"] + c.SS + c.OF + c.UTIL;
    var el = function (id, text) {
      var n = document.getElementById(id);
      if (n) n.textContent = text;
    };
    el("ctxPicks", picks + " / 20");
    el("ctxSP", c.SP + " / 4");
    el("ctxRP", c.RP + " / 1");
    el("ctxHitters", hitterStarters + " / 9");
  }

  function renderSlotAlerts() {
    var c = getSlotCounts();
    var picks = myTeam.length;
    var alerts = [];
    if (picks >= 12 && c.SP < 4) alerts.push("Fewer than 4 SP by round 12 — consider drafting SP.");
    if (picks >= 14 && c.RP < 1) alerts.push("RP slot still empty after round 14 — consider drafting RP.");
    var container = document.getElementById("slotAlerts");
    if (!container) return;
    if (alerts.length === 0) {
      container.innerHTML = "";
      container.className = "slot-alerts";
      return;
    }
    container.className = "slot-alerts slot-alerts-warn";
    container.innerHTML = alerts.map(function (msg) { return "<p class=\"slot-alert-msg\">" + escapeHtml(msg) + "</p>"; }).join("");
  }

  function renderStatCards() {
    const available = getAvailable();
    const bestVORP = available.length ? available.reduce(function (best, p) { return (p.VORP || 0) > (best.VORP || 0) ? p : best; }, available[0]) : null;
    const bestSP = available.filter(function (p) { return p.Role === "SP"; }).reduce(function (best, p) { if (!best) return p; return (p.VORP || 0) > (best.VORP || 0) ? p : best; }, null);
    const bestHitter = available.filter(function (p) { return p.Role === "Hitter"; }).reduce(function (best, p) { if (!best) return p; return (p.VORP || 0) > (best.VORP || 0) ? p : best; }, null);
    const sorted = available.slice().sort(function (a, b) { return a.Rank - b.Rank; });
    let largestDrop = 0;
    for (var i = 1; i < sorted.length; i++) {
      const d = (sorted[i - 1].VORP || 0) - (sorted[i].VORP || 0);
      if (d > largestDrop) largestDrop = d;
    }
    document.getElementById("statBestVORP").textContent = bestVORP != null ? (bestVORP.VORP || 0).toFixed(2) : "—";
    document.getElementById("statBestSP").textContent = bestSP != null ? (bestSP.VORP || 0).toFixed(2) : "—";
    document.getElementById("statBestHitter").textContent = bestHitter != null ? (bestHitter.VORP || 0).toFixed(2) : "—";
    document.getElementById("statLargestDrop").textContent = largestDrop > 0 ? largestDrop.toFixed(2) : "—";
  }

  function renderMyTeam() {
    const ul = document.getElementById("myTeamList");
    ul.innerHTML = myTeam.map(function (e) {
      const p = allPlayers.find(function (x) { return x.id === e.id; });
      return p ? "<li><span>" + escapeHtml(p.Name) + " (" + escapeHtml(p.Role) + ")</span><span class=\"slot\">" + e.slot + "</span></li>" : "";
    }).join("");
  }

  function renderSlots() {
    const c = getSlotCounts();
    ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "Bench"].forEach(function (s) {
      const el = document.getElementById("slot" + s);
      if (el) el.textContent = c[s] || 0;
    });
  }

  function resetDraft() {
    draftedByOther.clear();
    myTeam = [];
    actionHistory = [];
    saveState();
    refresh();
  }

  function undoLastPick() {
    if (actionHistory.length === 0) return;
    const action = actionHistory.pop();
    draftedByOther.delete(action.id);
    if (action.type === "me") {
      const idx = myTeam.map(function (e) { return e.id; }).lastIndexOf(action.id);
      if (idx !== -1) myTeam.splice(idx, 1);
    }
    saveState();
    refresh();
  }

  function openConfirmReset() {
    document.getElementById("confirmResetOverlay").classList.add("show");
  }
  function closeConfirmReset() {
    document.getElementById("confirmResetOverlay").classList.remove("show");
  }

  document.getElementById("btnCancel").onclick = closePopup;
  document.getElementById("resetDraft").onclick = openConfirmReset;
  document.getElementById("confirmResetBtn").onclick = function () { resetDraft(); closeConfirmReset(); };
  document.getElementById("cancelResetBtn").onclick = closeConfirmReset;
  document.getElementById("undoPick").onclick = undoLastPick;
  document.getElementById("search").oninput = refresh;
  document.querySelectorAll(".filter-chips .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (chip.id === "sortVORP" || chip.id === "sortWeekly") return;
      document.querySelectorAll(".filter-chips .chip").forEach(function (c) { if (c.id !== "sortVORP" && c.id !== "sortWeekly") c.classList.remove("active"); });
      this.classList.add("active");
      currentFilter = this.getAttribute("data-filter") || "All";
      refresh();
    });
  });
  document.getElementById("sortVORP").addEventListener("click", function () {
    currentSort = "VORP";
    document.getElementById("sortVORP").classList.add("active");
    document.getElementById("sortWeekly").classList.remove("active");
    refresh();
  });
  document.getElementById("sortWeekly").addEventListener("click", function () {
    currentSort = "Weekly";
    document.getElementById("sortWeekly").classList.add("active");
    document.getElementById("sortVORP").classList.remove("active");
    refresh();
  });
  document.getElementById("sortVORP").classList.add("active");

  document.getElementById("popupOverlay").addEventListener("click", function (e) {
    if (e.target === this) closePopup();
  });
  document.getElementById("confirmResetOverlay").addEventListener("click", function (e) {
    if (e.target === this) closeConfirmReset();
  });

  loadState();
  fetch("/data")
    .then(function (r) { return r.text(); })
    .then(function (text) {
      allPlayers = csvToPlayers(parseCSV(text));
      refresh();
    })
    .catch(function () {
      document.getElementById("playersBody").innerHTML = "<tr><td colspan=\"6\">Failed to load rankings.</td></tr>";
    });
})();
