(function () {
  "use strict";

  const config = window.AIHORIZON_CONFIG || {};
  const backend = window.AIHorizonBackend;
  const localKey = "ai-horizon-radar.signal_assessments.v1";
  const selectedKey = "ai-horizon-radar.signal_assessments.last_selected.v1";
  const signalsKey = "ai-horizon-signal-tracker.signals.dynamic_json.v1";
  const url = new URL(window.location.href);
  const workshopSlug = url.searchParams.get("workshop") || config.defaultWorkshopSlug || "prototype";
  const enabled = Boolean(backend && backend.state.configured && config.enableCollaborativeRatings !== false);
  const pollIntervalMs = 4000;
  let workshop = null;
  let aggregates = new Map();
  let syncTimer = null;
  let pollTimer = null;
  let renderTimer = null;
  let lastPayload = "";
  let lastRefreshAt = null;
  let refreshing = false;
  let openDriverId = "";
  let exportStatus = { message: "", isError: false };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function onRadarPage() {
    return (window.location.hash || "").includes("/radar");
  }

  function selectedId() {
    try { return localStorage.getItem(selectedKey) || ""; } catch (error) { return ""; }
  }

  function localRating(id) {
    try {
      const all = JSON.parse(localStorage.getItem(localKey) || "{}");
      return all[id] || null;
    } catch (error) { return null; }
  }

  function workshopVersionKey() {
    return "ai-horizon-radar.workshop-version." + workshopSlug;
  }

  function applyWorkshopVersion(nextWorkshop) {
    if (!nextWorkshop || nextWorkshop.ratings_version == null) return false;
    try {
      const key = workshopVersionKey();
      const nextVersion = String(Number(nextWorkshop.ratings_version) || 0);
      const previousVersion = localStorage.getItem(key);
      const hasOldAssessments = Boolean(localStorage.getItem(localKey));
      const shouldClear = previousVersion !== null
        ? previousVersion !== nextVersion
        : Number(nextVersion) > 0 && hasOldAssessments;
      localStorage.setItem(key, nextVersion);
      if (!shouldClear) return false;
      localStorage.removeItem(localKey);
      localStorage.removeItem(selectedKey);
      lastPayload = "";
      setTimeout(function () { window.location.reload(); }, 80);
      return true;
    } catch (error) {
      console.error("Could not apply workshop assessment reset", error);
      return false;
    }
  }

  function readSignals() {
    if (Array.isArray(window.__AIHORIZON_LIVE_SIGNALS)) return window.__AIHORIZON_LIVE_SIGNALS;
    try {
      const parsed = JSON.parse(localStorage.getItem(signalsKey) || "null");
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
    } catch (error) {}
    return Array.isArray(window.__EMBEDDED_SIGNALS) ? window.__EMBEDDED_SIGNALS : [];
  }

  function signalTitles() {
    return new Map(readSignals().map(function (signal) {
      const id = String(signal.signalId || signal.signalID || signal.id || "");
      return [id, String(signal.title || signal.Title || id)];
    }));
  }

  function findSignal(signalId) {
    const wanted = String(signalId || "");
    return readSignals().find(function (signal) {
      return String(signal.signalId || signal.signalID || signal.id || "") === wanted;
    }) || null;
  }

  function signalValue(signal, keys, fallback) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = signal && signal[keys[index]];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return fallback || "";
  }

  function safeSourceUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
    } catch (error) { return ""; }
  }

  function strategicNotes(item) {
    if (!item || item.strategic_notes == null) return [];
    let notes = item.strategic_notes;
    if (typeof notes === "string") {
      try {
        const parsed = JSON.parse(notes);
        notes = Array.isArray(parsed) ? parsed : [notes];
      } catch (error) { notes = [notes]; }
    }
    return (Array.isArray(notes) ? notes : []).map(function (note) {
      return String(note == null ? "" : note).trim();
    }).filter(Boolean);
  }

  function noteListHtml(item) {
    const notes = strategicNotes(item);
    if (!notes.length) return '<div class="sr-collab-empty">No shared strategic notes for this signal yet.</div>';
    return '<ol class="sr-collab-note-list">' + notes.map(function (note) {
      return '<li><span class="sr-collab-note-author">Anonymous participant</span>' + esc(note) + '</li>';
    }).join("") + "</ol>";
  }

  function scoreLabel(value) {
    const rounded = Math.round(Number(value) || 0);
    return ["—", "Low", "Medium", "High"][rounded] || "—";
  }

  function modalResponse(item) {
    return [
      ["Watch", Number(item.watch_count) || 0],
      ["Prepare", Number(item.prepare_count) || 0],
      ["Act", Number(item.act_count) || 0]
    ].sort(function (a, b) { return b[1] - a[1]; })[0][0];
  }

  function isGroupPriority(item) {
    const forwardVotes = Number(item.prepare_count || 0) + Number(item.act_count || 0);
    return Number(item.avg_impact || 0) >= 2.5
      && (forwardVotes > Number(item.watch_count || 0) || Number(item.important_count || 0) > 0);
  }

  function isScenarioDriver(item) {
    return Number(item.avg_impact || 0) >= 2.5 && Number(item.avg_uncertainty || 0) >= 2.5;
  }

  function workshopSnapshot() {
    const rows = Array.from(aggregates.values()).filter(function (item) {
      return Number(item.rating_count) > 0;
    }).map(function (item) {
      const signalId = String(item.signal_id || "");
      const signal = findSignal(signalId) || {};
      return {
        signalId: signalId,
        title: signalValue(signal, ["title", "Title"], signalId),
        description: signalValue(signal, ["description", "Description"], ""),
        pestecClass: signalValue(signal, ["pestecClass", "PESTEC class"], "Unspecified"),
        responseStage: signalValue(signal, ["responseStage", "Organisational response stage"], "Unspecified"),
        direction: signalValue(signal, ["direction", "Direction"], "Mixed"),
        source: signalValue(signal, ["source", "Source"], ""),
        ratingCount: Number(item.rating_count || 0),
        avgImpact: Number(item.avg_impact || 0),
        avgUncertainty: Number(item.avg_uncertainty || 0),
        commonResponse: modalResponse(item),
        watchCount: Number(item.watch_count || 0),
        prepareCount: Number(item.prepare_count || 0),
        actCount: Number(item.act_count || 0),
        importantCount: Number(item.important_count || 0),
        scenarioDriver: isScenarioDriver(item),
        groupPriority: isGroupPriority(item),
        notes: strategicNotes(item)
      };
    }).sort(function (a, b) {
      return Number(b.scenarioDriver) - Number(a.scenarioDriver)
        || Number(b.groupPriority) - Number(a.groupPriority)
        || (b.avgImpact + b.avgUncertainty) - (a.avgImpact + a.avgUncertainty)
        || a.signalId.localeCompare(b.signalId, undefined, { numeric: true });
    });
    const ratingCount = rows.reduce(function (total, row) { return total + row.ratingCount; }, 0);
    const noteCount = rows.reduce(function (total, row) { return total + row.notes.length; }, 0);
    return {
      exportedAt: new Date(),
      workshopTitle: workshop && workshop.title ? String(workshop.title) : workshopSlug,
      workshopSlug: workshopSlug,
      workshopStatus: workshop && workshop.status ? String(workshop.status) : (enabled ? "Unavailable" : "Local prototype"),
      rows: rows,
      totals: {
        signalCount: rows.length,
        ratingCount: ratingCount,
        priorityCount: rows.filter(function (row) { return row.groupPriority; }).length,
        scenarioDriverCount: rows.filter(function (row) { return row.scenarioDriver; }).length,
        noteCount: noteCount
      }
    };
  }

  const exportHeaders = [
    "Signal ID", "Title", "PESTEC", "Signal response stage", "Direction", "Ratings",
    "Mean impact", "Mean uncertainty", "Common workshop response", "Watch votes",
    "Prepare votes", "Act votes", "Important votes", "Scenario driver", "Group priority",
    "Strategic notes", "Description", "Source"
  ];

  function exportRow(row) {
    return [
      row.signalId, row.title, row.pestecClass, row.responseStage, row.direction, row.ratingCount,
      row.avgImpact, row.avgUncertainty, row.commonResponse, row.watchCount, row.prepareCount,
      row.actCount, row.importantCount, row.scenarioDriver ? "Yes" : "No",
      row.groupPriority ? "Yes" : "No", row.notes.join(" | "), row.description, row.source
    ];
  }

  function filenameBase(snapshot) {
    const date = snapshot.exportedAt.toISOString().slice(0, 10);
    const slug = String(snapshot.workshopSlug || "workshop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workshop";
    return "AI-Horizon-Radar-workshop-" + slug + "-" + date;
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function snapshotCsv(snapshot) {
    return [exportHeaders].concat(snapshot.rows.map(exportRow)).map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\r\n");
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
  }

  function styleSheetHeader(sheet, rowIndex, lastColumn) {
    for (let column = 0; column <= lastColumn; column += 1) {
      const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: column });
      if (!sheet[address]) continue;
      sheet[address].s = {
        fill: { fgColor: { rgb: "180061" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { vertical: "center", wrapText: true }
      };
    }
  }

  function exportExcel(snapshot) {
    if (!window.XLSX) throw new Error("The Excel export library did not load. Refresh the page and try again.");
    const summaryRows = [
      ["AI Horizon Radar - Workshop results snapshot"],
      [],
      ["Workshop", snapshot.workshopTitle],
      ["Workshop slug", snapshot.workshopSlug],
      ["Workshop status", snapshot.workshopStatus],
      ["Exported", snapshot.exportedAt.toISOString()],
      [],
      ["Snapshot totals", "Count"],
      ["Group-rated signals", snapshot.totals.signalCount],
      ["Submitted ratings", snapshot.totals.ratingCount],
      ["Group priorities", snapshot.totals.priorityCount],
      ["Scenario drivers", snapshot.totals.scenarioDriverCount],
      ["Strategic notes", snapshot.totals.noteCount],
      [],
      ["Scenario drivers", "Title", "Mean impact", "Mean uncertainty", "Ratings"]
    ];
    const driverRows = snapshot.rows.filter(function (row) { return row.scenarioDriver; });
    if (driverRows.length) driverRows.forEach(function (row) {
      summaryRows.push([row.signalId, row.title, row.avgImpact, row.avgUncertainty, row.ratingCount]);
    });
    else summaryRows.push(["None at export time"]);
    summaryRows.push([]);
    const priorityHeaderRow = summaryRows.length;
    summaryRows.push(["Group priorities", "Title", "Mean impact", "Workshop response", "Ratings"]);
    const priorityRows = snapshot.rows.filter(function (row) { return row.groupPriority; });
    if (priorityRows.length) priorityRows.forEach(function (row) {
      summaryRows.push([row.signalId, row.title, row.avgImpact, row.commonResponse, row.ratingCount]);
    });
    else summaryRows.push(["None at export time"]);

    const workbook = window.XLSX.utils.book_new();
    const summarySheet = window.XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 24 }, { wch: 44 }, { wch: 16 }, { wch: 20 }, { wch: 12 }];
    summarySheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
    summarySheet.A1.s = { font: { bold: true, sz: 16, color: { rgb: "180061" } } };
    [7, 14, priorityHeaderRow].forEach(function (rowIndex) { styleSheetHeader(summarySheet, rowIndex, 4); });
    window.XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const resultsSheet = window.XLSX.utils.aoa_to_sheet([exportHeaders].concat(snapshot.rows.map(exportRow)));
    resultsSheet["!cols"] = [
      { wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 10 },
      { wch: 13 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 13 }, { wch: 10 },
      { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 48 }, { wch: 60 }, { wch: 42 }
    ];
    resultsSheet["!autofilter"] = { ref: "A1:R" + Math.max(1, snapshot.rows.length + 1) };
    resultsSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    styleSheetHeader(resultsSheet, 0, exportHeaders.length - 1);
    snapshot.rows.forEach(function (_row, index) {
      [6, 7].forEach(function (column) {
        const cell = resultsSheet[window.XLSX.utils.encode_cell({ r: index + 1, c: column })];
        if (cell) cell.z = "0.0";
      });
    });
    window.XLSX.utils.book_append_sheet(workbook, resultsSheet, "Signal results");

    const noteRows = [["Signal ID", "Title", "Note number", "Strategic note"]];
    snapshot.rows.forEach(function (row) {
      row.notes.forEach(function (note, index) { noteRows.push([row.signalId, row.title, index + 1, note]); });
    });
    if (noteRows.length === 1) noteRows.push(["", "", "", "No strategic notes at export time"]);
    const notesSheet = window.XLSX.utils.aoa_to_sheet(noteRows);
    notesSheet["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 13 }, { wch: 80 }];
    notesSheet["!autofilter"] = { ref: "A1:D" + noteRows.length };
    notesSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    styleSheetHeader(notesSheet, 0, 3);
    window.XLSX.utils.book_append_sheet(workbook, notesSheet, "Strategic notes");
    workbook.Props = {
      Title: "AI Horizon Radar workshop results - " + snapshot.workshopTitle,
      Subject: "Aggregated anonymous workshop assessments",
      Author: "AI Horizon Radar",
      CreatedDate: snapshot.exportedAt
    };
    window.XLSX.writeFile(workbook, filenameBase(snapshot) + ".xlsx", { compression: true });
  }

  function printList(rows, emptyText) {
    if (!rows.length) return '<p class="empty">' + esc(emptyText) + "</p>";
    return "<ol>" + rows.map(function (row) {
      return "<li><strong>" + esc(row.signalId) + " - " + esc(row.title) + "</strong><span>Impact "
        + row.avgImpact.toFixed(1) + " · Uncertainty " + row.avgUncertainty.toFixed(1)
        + " · n=" + row.ratingCount + "</span></li>";
    }).join("") + "</ol>";
  }

  function snapshotPrintHtml(snapshot) {
    const drivers = snapshot.rows.filter(function (row) { return row.scenarioDriver; });
    const priorities = snapshot.rows.filter(function (row) { return row.groupPriority; });
    const detailRows = snapshot.rows.map(function (row) {
      return "<tr><td><strong>" + esc(row.signalId) + "</strong></td><td>" + esc(row.title) + "</td><td>" + row.ratingCount
        + "</td><td>" + row.avgImpact.toFixed(1) + "</td><td>" + row.avgUncertainty.toFixed(1)
        + "</td><td>" + esc(row.commonResponse) + "</td><td>" + row.watchCount + " / " + row.prepareCount + " / " + row.actCount
        + "</td><td>" + (row.scenarioDriver ? "Yes" : "") + "</td><td>" + (row.groupPriority ? "Yes" : "") + "</td></tr>";
    }).join("");
    const noteRows = snapshot.rows.filter(function (row) { return row.notes.length; }).map(function (row) {
      return '<section class="note"><h3>' + esc(row.signalId) + " - " + esc(row.title) + "</h3><ul>"
        + row.notes.map(function (note) { return "<li>" + esc(note) + "</li>"; }).join("") + "</ul></section>";
    }).join("");
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(filenameBase(snapshot)) + '</title><style>'
      + '@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#180061;font:10px/1.4 Arial,sans-serif}h1{margin:0;font-size:22px}h2{margin:22px 0 8px;font-size:14px;border-bottom:2px solid #180061;padding-bottom:4px}h3{margin:0 0 5px;font-size:11px}.meta{margin:4px 0 14px;color:#655c7b}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.card{border:1px solid #d8d3e2;border-radius:7px;padding:8px}.card strong{display:block;font-size:18px}.card span{color:#655c7b}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.columns ol{margin:0;padding-left:18px}.columns li{margin:0 0 6px}.columns li span{display:block;color:#655c7b}table{width:100%;border-collapse:collapse;font-size:8px}th{background:#180061;color:#fff;text-align:left}th,td{border:1px solid #d8d3e2;padding:4px;vertical-align:top}tr:nth-child(even) td{background:#f7f5fa}.notes{columns:2;column-gap:18px}.note{break-inside:avoid;border:1px solid #d8d3e2;border-left:3px solid #2a9d62;border-radius:5px;padding:8px;margin:0 0 8px}.note ul{margin:0;padding-left:16px}.empty{color:#655c7b}.footer{margin-top:16px;color:#655c7b;font-size:8px}@media print{.note{break-inside:avoid}thead{display:table-header-group}}</style></head><body>'
      + '<h1>AI Horizon Radar - Workshop results snapshot</h1><p class="meta"><strong>' + esc(snapshot.workshopTitle) + '</strong> · '
      + esc(snapshot.workshopSlug) + ' · ' + esc(snapshot.workshopStatus) + ' · Exported ' + esc(snapshot.exportedAt.toLocaleString()) + '</p>'
      + '<div class="cards"><div class="card"><strong>' + snapshot.totals.signalCount + '</strong><span>group-rated signals</span></div><div class="card"><strong>'
      + snapshot.totals.ratingCount + '</strong><span>submitted ratings</span></div><div class="card"><strong>' + snapshot.totals.priorityCount
      + '</strong><span>group priorities</span></div><div class="card"><strong>' + snapshot.totals.scenarioDriverCount + '</strong><span>scenario drivers</span></div><div class="card"><strong>'
      + snapshot.totals.noteCount + '</strong><span>strategic notes</span></div></div>'
      + '<div class="columns"><section><h2>Scenario drivers</h2>' + printList(drivers, "No scenario drivers at export time.")
      + '</section><section><h2>Group priorities</h2>' + printList(priorities, "No group priorities at export time.") + '</section></div>'
      + '<h2>Aggregated signal assessments</h2><table><thead><tr><th>ID</th><th>Signal</th><th>n</th><th>Impact</th><th>Uncertainty</th><th>Response</th><th>Watch / Prepare / Act</th><th>Driver</th><th>Priority</th></tr></thead><tbody>'
      + detailRows + '</tbody></table><h2>Shared strategic notes</h2><div class="notes">' + (noteRows || '<p class="empty">No strategic notes at export time.</p>')
      + '</div><p class="footer">Anonymous aggregated workshop snapshot generated by AI Horizon Radar.</p></body></html>';
  }

  function setExportStatus(message, isError) {
    exportStatus = { message: String(message || ""), isError: Boolean(isError) };
    const status = document.querySelector(".sr-collab-export-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function handleWorkshopExport(format) {
    const snapshot = workshopSnapshot();
    if (!snapshot.rows.length) {
      setExportStatus("No group-rated signals are available to export yet.", true);
      return;
    }
    try {
      if (format === "xlsx") {
        exportExcel(snapshot);
        setExportStatus("Excel snapshot downloaded.");
      } else if (format === "csv") {
        downloadBlob(new Blob(["\ufeff", snapshotCsv(snapshot)], { type: "text/csv;charset=utf-8" }), filenameBase(snapshot) + ".csv");
        setExportStatus("CSV snapshot downloaded.");
      } else if (format === "pdf") {
        const printWindow = window.open("", "_blank");
        if (!printWindow) throw new Error("The print window was blocked. Allow pop-ups for this site and try again.");
        printWindow.opener = null;
        printWindow.document.open();
        printWindow.document.write(snapshotPrintHtml(snapshot));
        printWindow.document.close();
        setExportStatus("Print-ready snapshot opened. Choose Save as PDF in the print dialog.");
        setTimeout(function () { printWindow.focus(); printWindow.print(); }, 250);
      }
    } catch (error) {
      console.error("Could not export workshop snapshot", error);
      setExportStatus(error && error.message ? error.message : "Workshop export failed.", true);
    }
  }

  function aggregateHtml(item) {
    if (!item || !Number(item.rating_count)) {
      return '<div class="sr-collab-empty">No group ratings for this signal yet.</div>';
    }
    return `
      <div class="sr-collab-metrics">
        <div><strong>${esc(item.rating_count)}</strong><span>anonymous ratings</span></div>
        <div><strong>${esc(scoreLabel(item.avg_impact))}</strong><span>mean impact ${Number(item.avg_impact || 0).toFixed(1)}</span></div>
        <div><strong>${esc(scoreLabel(item.avg_uncertainty))}</strong><span>mean uncertainty ${Number(item.avg_uncertainty || 0).toFixed(1)}</span></div>
        <div><strong>${esc(modalResponse(item))}</strong><span>most common response</span></div>
      </div>
      <div class="sr-collab-distribution">Watch ${Number(item.watch_count) || 0} · Prepare ${Number(item.prepare_count) || 0} · Act ${Number(item.act_count) || 0} · Important ${Number(item.important_count) || 0}</div>
      <div class="sr-collab-selected-notes">
        <div class="sr-mvp-label">Shared strategic notes · ${strategicNotes(item).length}</div>
        ${noteListHtml(item)}
      </div>
    `;
  }

  function driverDetailHtml(signalId) {
    if (!signalId) return "";
    const signal = findSignal(signalId);
    if (!signal) return "";
    const title = signalValue(signal, ["title", "Title"], signalId);
    const description = signalValue(signal, ["description", "Description"], "No description is available for this signal.");
    const pestec = signalValue(signal, ["pestecClass", "PESTEC class"], "Unspecified");
    const response = signalValue(signal, ["responseStage", "Organisational response stage"], "Unspecified");
    const direction = signalValue(signal, ["direction", "Direction"], "Mixed");
    const source = safeSourceUrl(signalValue(signal, ["source", "Source"], ""));
    return `
      <div class="sr-collab-driver-detail" id="sr-collab-driver-detail" tabindex="-1">
        <div class="sr-collab-driver-detail-heading"><strong>${esc(signalId)}</strong><span>${esc(title)}</span></div>
        <p>${esc(description)}</p>
        <div class="sr-collab-driver-meta"><span>${esc(pestec)}</span><span>${esc(response)}</span><span>${esc(direction)}</span></div>
        ${source ? '<a href="' + esc(source) + '" target="_blank" rel="noreferrer">Open source ↗</a>' : ""}
      </div>`;
  }

  function sharedNotesHtml(rows, titles) {
    const withNotes = rows.map(function (item) {
      return { item: item, notes: strategicNotes(item) };
    }).filter(function (entry) { return entry.notes.length > 0; });
    const noteCount = withNotes.reduce(function (total, entry) { return total + entry.notes.length; }, 0);
    if (!withNotes.length) {
      return `
        <div class="sr-collab-notes-board">
          <div class="sr-mvp-label">Shared strategic notes</div>
          <div class="sr-collab-empty">Saved workshop notes will appear here anonymously.</div>
        </div>`;
    }
    return `
      <div class="sr-collab-notes-board">
        <div class="sr-mvp-label">Shared strategic notes · ${noteCount}</div>
        <div class="sr-collab-notes-help">Notes are grouped by signal and shown without participant identifiers.</div>
        <div class="sr-collab-note-groups">
          ${withNotes.map(function (entry) {
            const id = String(entry.item.signal_id || "");
            return '<details class="sr-collab-note-group"' + (id === selectedId() ? " open" : "") + '><summary><span><strong>'
              + esc(id) + '</strong> · ' + esc(titles.get(id) || id) + '</span><small>'
              + entry.notes.length + ' note' + (entry.notes.length === 1 ? "" : "s") + '</small></summary>'
              + noteListHtml(entry.item) + '</details>';
          }).join("")}
        </div>
      </div>`;
  }

  function groupSummaryHtml() {
    const rows = Array.from(aggregates.values()).filter(function (item) { return Number(item.rating_count) > 0; });
    const ratingCount = rows.reduce(function (total, item) { return total + Number(item.rating_count || 0); }, 0);
    const priorities = rows.filter(isGroupPriority);
    const scenarioDrivers = rows.filter(isScenarioDriver);
    if (openDriverId && !scenarioDrivers.some(function (item) { return item.signal_id === openDriverId; })) openDriverId = "";
    const titles = signalTitles();
    const priorityList = priorities.slice().sort(function (a, b) {
      return (Number(b.avg_impact || 0) + Number(b.important_count || 0) * 0.1) - (Number(a.avg_impact || 0) + Number(a.important_count || 0) * 0.1);
    }).slice(0, 4).map(function (item) {
      return '<li><strong>' + esc(item.signal_id) + '</strong> · ' + esc(titles.get(item.signal_id) || item.signal_id) + '</li>';
    }).join("");
    const scenarioDriverList = scenarioDrivers.slice().sort(function (a, b) {
      const scoreDifference = (Number(b.avg_impact || 0) + Number(b.avg_uncertainty || 0))
        - (Number(a.avg_impact || 0) + Number(a.avg_uncertainty || 0));
      return scoreDifference || Number(b.rating_count || 0) - Number(a.rating_count || 0);
    }).map(function (item) {
      const expanded = openDriverId === item.signal_id;
      return '<li><button type="button" class="sr-collab-driver-button" data-collab-driver="' + esc(item.signal_id)
        + '" aria-expanded="' + (expanded ? "true" : "false") + '" aria-controls="sr-collab-driver-detail"><strong>'
        + esc(item.signal_id) + '</strong> · ' + esc(titles.get(item.signal_id) || item.signal_id)
        + '<span class="sr-collab-driver-scores">Impact ' + Number(item.avg_impact || 0).toFixed(1)
        + ' · Uncertainty ' + Number(item.avg_uncertainty || 0).toFixed(1)
        + ' · n=' + Number(item.rating_count || 0) + '</span><span class="sr-collab-driver-open">'
        + (expanded ? "Hide description" : "View description") + '</span></button></li>';
    }).join("");

    return `
      <div class="foresight-kicker">Workshop group snapshot</div>
      <div class="foresight-grid foresight-grid-3" style="margin-top:10px;">
        <div class="foresight-card"><div class="foresight-kicker">Group-rated</div><div class="foresight-stat" style="font-size:24px;">${rows.length}</div><div class="foresight-body">signals with ${ratingCount} submitted ratings</div></div>
        <div class="foresight-card"><div class="foresight-kicker">Group priorities</div><div class="foresight-stat" style="font-size:24px;">${priorities.length}</div><div class="foresight-body">high-impact signals leaning Prepare or Act</div></div>
        <div class="foresight-card"><div class="foresight-kicker">Scenario drivers</div><div class="foresight-stat" style="font-size:24px;">${scenarioDrivers.length}</div><div class="foresight-body">high mean impact and uncertainty</div></div>
      </div>
      <div class="sr-collab-export">
        <div>
          <div class="sr-mvp-label">Export workshop results</div>
          <div class="sr-collab-notes-help">Download the current anonymous aggregate, scenario drivers, priorities and strategic notes.</div>
        </div>
        <div class="sr-collab-export-actions" aria-label="Workshop result export formats">
          <button type="button" data-collab-export="xlsx" ${rows.length ? "" : "disabled"}>Excel</button>
          <button type="button" data-collab-export="csv" ${rows.length ? "" : "disabled"}>CSV</button>
          <button type="button" data-collab-export="pdf" ${rows.length ? "" : "disabled"}>PDF</button>
        </div>
        <div class="sr-collab-export-status${exportStatus.isError ? " is-error" : ""}" aria-live="polite">${esc(exportStatus.message)}</div>
      </div>
      <div class="sr-collab-driver-key"><span aria-hidden="true"></span>Violet rings mark scenario drivers: mean impact and uncertainty are both at least 2.5 on the 1–3 scale.</div>
      <div class="sr-collab-summary-columns">
        <div>
          <div class="sr-mvp-label">Scenario drivers</div>
          ${scenarioDriverList ? '<ul class="sr-mvp-summary-list sr-collab-driver-list">' + scenarioDriverList + '</ul>' : '<div class="sr-collab-empty">Scenario drivers will appear when a group-rated signal crosses both thresholds.</div>'}
          ${driverDetailHtml(openDriverId)}
        </div>
        <div>
          <div class="sr-mvp-label">Leading group priorities</div>
          ${priorityList ? '<ul class="sr-mvp-summary-list">' + priorityList + '</ul>' : '<div class="sr-collab-empty">Group priorities will appear after participants submit ratings.</div>'}
        </div>
      </div>
      ${sharedNotesHtml(rows, titles)}
    `;
  }

  function ensureStyles() {
    if (document.getElementById("sr-collab-styles")) return;
    const style = document.createElement("style");
    style.id = "sr-collab-styles";
    style.textContent = `
      .sr-collab-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 14px;padding:9px 11px;border:1px solid rgba(24,0,97,.14);border-radius:12px;background:rgba(24,0,97,.035);font-size:12px;color:rgba(24,0,97,.72)}
      .sr-collab-live{width:8px;height:8px;border-radius:50%;background:#2a9d62;box-shadow:0 0 0 4px rgba(42,157,98,.12)}
      .sr-collab-panel{width:100%;box-sizing:border-box}
      .sr-collab-snapshot{margin:14px 0;padding:14px;border:1px solid rgba(42,157,98,.22);border-radius:16px;background:rgba(42,157,98,.035)}
      .sr-collab-group{margin-top:14px;padding:13px;border:1px solid rgba(42,157,98,.22);border-radius:14px;background:rgba(42,157,98,.035)}
      .sr-collab-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px}
      .sr-collab-metrics div{padding:9px;border:1px solid rgba(24,0,97,.1);border-radius:10px;background:white}
      .sr-collab-metrics strong,.sr-collab-metrics span{display:block}.sr-collab-metrics strong{font-size:16px;color:#180061}.sr-collab-metrics span{font-size:10px;color:rgba(24,0,97,.6);margin-top:2px}
      .sr-collab-distribution,.sr-collab-empty{font-size:11px;color:rgba(24,0,97,.64);margin-top:8px}
      .sr-collab-group-ring{fill:none;stroke:#2a9d62;stroke-width:2.5;stroke-dasharray:3 2;opacity:.9;pointer-events:none}
      [data-testid^="radar-dot-"].sr-collab-group-rated{filter:drop-shadow(0 0 3px rgba(42,157,98,.28))}
      [data-testid^="radar-dot-"].sr-collab-scenario-driver{filter:drop-shadow(0 0 5px rgba(124,58,237,.5))}
      [data-testid^="radar-dot-"].sr-collab-scenario-driver .sr-collab-group-ring{stroke:#7c3aed;stroke-width:4;stroke-dasharray:none;opacity:1}
      .sr-collab-driver-key{display:flex;align-items:center;gap:8px;margin-top:13px;font-size:11px;line-height:1.45;color:rgba(24,0,97,.68)}
      .sr-collab-driver-key span{width:11px;height:11px;flex:0 0 11px;border:3px solid #7c3aed;border-radius:50%;box-shadow:0 0 0 2px rgba(124,58,237,.11)}
      .sr-collab-export{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;align-items:center;margin-top:14px;padding:12px;border:1px solid rgba(24,0,97,.11);border-radius:12px;background:rgba(255,255,255,.72)}
      .sr-collab-export-actions{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}
      .sr-collab-export-actions button{min-width:62px;padding:7px 10px;border:1px solid rgba(24,0,97,.22);border-radius:8px;background:#fff;color:#180061;font:inherit;font-size:11px;font-weight:750;cursor:pointer}
      .sr-collab-export-actions button:hover,.sr-collab-export-actions button:focus-visible{border-color:#7c3aed;color:#6d28d9;outline:none;box-shadow:0 0 0 3px rgba(124,58,237,.11)}
      .sr-collab-export-actions button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
      .sr-collab-export-status{grid-column:1/-1;min-height:15px;font-size:10px;color:#237a4d}.sr-collab-export-status.is-error{color:#b42318}
      .sr-collab-summary-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:14px}
      .sr-collab-driver-list li:before{color:#7c3aed}
      .sr-collab-driver-scores{display:block;margin-top:2px;font-size:10px;color:rgba(24,0,97,.58)}
      .sr-collab-driver-button{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
      .sr-collab-driver-button:hover strong,.sr-collab-driver-button:focus-visible strong{color:#7c3aed;text-decoration:underline;text-underline-offset:3px}
      .sr-collab-driver-button:focus-visible{outline:2px solid #7c3aed;outline-offset:4px;border-radius:5px}
      .sr-collab-driver-open{display:inline-block;margin-top:4px;font-size:10px;font-weight:700;color:#6d28d9}
      .sr-collab-driver-detail{margin-top:10px;padding:12px;border:1px solid rgba(124,58,237,.24);border-radius:12px;background:rgba(124,58,237,.055)}
      .sr-collab-driver-detail-heading{display:grid;gap:2px;font-size:13px;color:#180061}.sr-collab-driver-detail-heading span{font-weight:700}
      .sr-collab-driver-detail p{margin-top:8px;font-size:12px;line-height:1.52;color:rgba(24,0,97,.76)}
      .sr-collab-driver-detail>a{display:inline-block;margin-top:9px;font-size:11px;font-weight:700;color:#6d28d9;text-decoration:underline;text-underline-offset:3px}
      .sr-collab-driver-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.sr-collab-driver-meta span{padding:3px 7px;border:1px solid rgba(124,58,237,.18);border-radius:999px;font-size:10px;color:rgba(24,0,97,.7);background:white}
      .sr-collab-selected-notes{margin-top:13px;padding-top:12px;border-top:1px solid rgba(42,157,98,.18)}
      .sr-collab-notes-board{margin-top:18px;padding-top:15px;border-top:1px solid rgba(24,0,97,.11)}
      .sr-collab-notes-help{margin-top:4px;font-size:11px;color:rgba(24,0,97,.62)}
      .sr-collab-note-groups{display:grid;gap:8px;margin-top:10px}
      .sr-collab-note-group{border:1px solid rgba(24,0,97,.11);border-radius:11px;background:white;overflow:hidden}
      .sr-collab-note-group summary{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:9px 11px;cursor:pointer;font-size:12px;color:rgba(24,0,97,.78)}
      .sr-collab-note-group summary small{white-space:nowrap;color:rgba(24,0,97,.55)}
      .sr-collab-note-list{display:grid;gap:7px;margin:8px 0 0;padding:0;list-style:none}
      .sr-collab-note-group .sr-collab-note-list{margin:0;padding:0 11px 11px}
      .sr-collab-note-list li{padding:8px 10px;border-left:3px solid #2a9d62;border-radius:0 8px 8px 0;background:rgba(42,157,98,.055);font-size:12px;line-height:1.48;color:rgba(24,0,97,.78)}
      .sr-collab-note-author{display:block;margin-bottom:2px;font-size:9px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:rgba(24,0,97,.48)}
      .dark .sr-collab-banner,.dark .sr-collab-snapshot,.dark .sr-collab-group,.dark .sr-collab-metrics div,.dark .sr-collab-note-group,.dark .sr-collab-driver-meta span,.dark .sr-collab-export,.dark .sr-collab-export-actions button{background:hsl(var(--card)/.88);border-color:hsl(var(--border));color:hsl(var(--foreground))}.dark .sr-collab-metrics strong,.dark .sr-collab-driver-detail-heading{color:hsl(var(--foreground))}.dark .sr-collab-metrics span,.dark .sr-collab-distribution,.dark .sr-collab-empty,.dark .sr-collab-driver-key,.dark .sr-collab-driver-scores,.dark .sr-collab-notes-help,.dark .sr-collab-note-group summary,.dark .sr-collab-note-group summary small,.dark .sr-collab-note-list li,.dark .sr-collab-driver-detail p,.dark .sr-collab-driver-meta span{color:hsl(var(--muted-foreground))}.dark .sr-collab-note-list li,.dark .sr-collab-driver-detail{background:hsl(var(--muted)/.3)}
      @media(max-width:700px){.sr-collab-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sr-collab-summary-columns{grid-template-columns:1fr}.sr-collab-export{grid-template-columns:1fr}.sr-collab-export-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function markGroupDots() {
    document.querySelectorAll('[data-testid^="radar-dot-"]').forEach(function (dot) {
      const id = dot.getAttribute("data-testid").replace(/^radar-dot-/, "");
      const item = aggregates.get(id);
      const hasGroupRating = Boolean(item && Number(item.rating_count));
      const scenarioDriver = Boolean(hasGroupRating && isScenarioDriver(item));
      dot.classList.toggle("sr-collab-group-rated", hasGroupRating);
      dot.classList.toggle("sr-collab-scenario-driver", scenarioDriver);
      let ring = dot.querySelector(".sr-collab-group-ring");
      if (!hasGroupRating) {
        if (ring) ring.remove();
        return;
      }
      const mainCircle = Array.from(dot.children).find(function (child) {
        return child.tagName && child.tagName.toLowerCase() === "circle" && !child.classList.contains("sr-collab-group-ring");
      });
      if (!mainCircle) return;
      if (!ring) {
        ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ring.setAttribute("class", "sr-collab-group-ring");
        dot.insertBefore(ring, mainCircle);
      }
      ring.setAttribute("cx", mainCircle.getAttribute("cx"));
      ring.setAttribute("cy", mainCircle.getAttribute("cy"));
      ring.setAttribute("r", String(Number(mainCircle.getAttribute("r") || 8) + 5));
    });
  }

  function render() {
    if (!onRadarPage()) return;
    ensureStyles();
    const assessmentPanel = document.getElementById("signal-radar-mvp-panel");
    if (!assessmentPanel) return;
    let panel = document.getElementById("signal-radar-collaboration-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "signal-radar-collaboration-panel";
      panel.className = "foresight-panel sr-collab-panel";
      panel.setAttribute("aria-label", "Workshop group results");
      assessmentPanel.insertAdjacentElement("afterend", panel);
    } else if (panel.previousElementSibling !== assessmentPanel) {
      // Keep the individual assessment workspace first so participants can
      // move efficiently from one signal to the next during a workshop.
      assessmentPanel.insertAdjacentElement("afterend", panel);
    }

    let banner = panel.querySelector(".sr-collab-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "sr-collab-banner";
      panel.insertBefore(banner, panel.firstChild);
    }
    const refreshed = lastRefreshAt ? " · refreshed " + lastRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const bannerHtml = enabled && workshop
      ? '<span class="sr-collab-live"></span><strong>Live workshop:</strong> ' + esc(workshop.title) + '<span>· anonymous contributions · one editable rating per browser' + esc(refreshed) + '</span>'
      : '<strong>Local prototype mode</strong><span>· configure Supabase to aggregate workshop ratings</span>';
    if (banner.innerHTML !== bannerHtml) banner.innerHTML = bannerHtml;

    let snapshot = panel.querySelector(".sr-collab-snapshot");
    if (!snapshot) {
      snapshot = document.createElement("section");
      snapshot.className = "sr-collab-snapshot";
      panel.appendChild(snapshot);
    }
    const snapshotHtml = groupSummaryHtml();
    if (snapshot.innerHTML !== snapshotHtml) snapshot.innerHTML = snapshotHtml;

    const id = selectedId();
    let group = panel.querySelector(".sr-collab-group");
    if (!group) {
      group = document.createElement("div");
      group.className = "sr-collab-group";
      panel.appendChild(group);
    }
    const groupHtml = '<div class="sr-mvp-label">Workshop group assessment' + (id ? " · " + esc(id) : "") + "</div>" + aggregateHtml(aggregates.get(id));
    if (group.innerHTML !== groupHtml) group.innerHTML = groupHtml;
    markGroupDots();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  async function refreshAggregates() {
    if (!enabled || !workshop || workshop.status !== "open" || refreshing) return;
    refreshing = true;
    try {
      const latestWorkshop = await backend.getWorkshop(workshopSlug);
      if (latestWorkshop) {
        const resetDetected = applyWorkshopVersion(latestWorkshop);
        workshop = latestWorkshop;
        if (resetDetected) return;
      }
      const rows = await backend.getAggregates(workshopSlug);
      aggregates = new Map(rows.map(function (row) { return [row.signal_id, row]; }));
      lastRefreshAt = new Date();
      render();
    } catch (error) {
      console.error("Could not load workshop aggregates", error);
    } finally {
      refreshing = false;
    }
  }

  async function syncSelected() {
    if (!enabled || !workshop || workshop.status !== "open") return;
    const id = selectedId();
    if (!id) return;
    const rating = localRating(id);
    const payload = JSON.stringify([id, rating]);
    if (payload === lastPayload) return;
    lastPayload = payload;
    try {
      const latestWorkshop = await backend.getWorkshop(workshopSlug);
      if (latestWorkshop) {
        const resetDetected = applyWorkshopVersion(latestWorkshop);
        workshop = latestWorkshop;
        if (resetDetected) return;
      }
      if (rating) await backend.saveRating(workshop.id, id, rating, workshop.ratings_version);
      else await backend.deleteRating(workshop.id, id);
      await refreshAggregates();
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Saved anonymously to workshop.";
    } catch (error) {
      lastPayload = "";
      const status = document.getElementById("sr-mvp-status");
      if (status) status.textContent = "Workshop sync failed; saved in this browser.";
      console.error("Could not sync workshop rating", error);
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncSelected();
      render();
    }, 180);
  }

  function startPolling() {
    clearInterval(pollTimer);
    if (!enabled) return;
    pollTimer = setInterval(function () {
      if (onRadarPage() && document.visibilityState !== "hidden") refreshAggregates();
    }, pollIntervalMs);
  }

  async function initialise() {
    if (enabled) {
      try {
        await backend.ensureAnonymousSession();
        workshop = await backend.getWorkshop(workshopSlug);
        if (applyWorkshopVersion(workshop)) return;
        if (workshop && workshop.status === "open") await refreshAggregates();
      } catch (error) {
        console.error("Workshop collaboration could not initialise", error);
      }
    }
    render();
    startPolling();
  }

  document.addEventListener("click", function (event) {
    const exportButton = event.target.closest && event.target.closest("[data-collab-export]");
    if (exportButton) {
      event.preventDefault();
      if (!exportButton.disabled) handleWorkshopExport(exportButton.getAttribute("data-collab-export") || "");
      return;
    }
    const driverButton = event.target.closest && event.target.closest("[data-collab-driver]");
    if (driverButton) {
      event.preventDefault();
      const signalId = driverButton.getAttribute("data-collab-driver") || "";
      openDriverId = openDriverId === signalId ? "" : signalId;
      render();
      if (openDriverId) setTimeout(function () {
        const detail = document.getElementById("sr-collab-driver-detail");
        if (detail) { detail.focus({ preventScroll: true }); detail.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      }, 0);
      return;
    }
    if (event.target.closest && (event.target.closest("[data-sr-field]") || event.target.closest("[data-sr-action]") || event.target.closest('[data-testid^="radar-dot-"]'))) scheduleSync();
  }, false);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && onRadarPage()) refreshAggregates();
  });
  window.addEventListener("hashchange", function () {
    scheduleRender();
    if (onRadarPage()) refreshAggregates();
  });
  window.AIHorizonWorkshopExports = {
    getSnapshot: workshopSnapshot,
    createCsv: snapshotCsv,
    createPrintHtml: snapshotPrintHtml
  };
  new MutationObserver(function () { if (onRadarPage()) scheduleRender(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise); else initialise();
})();
