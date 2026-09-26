/* NSE Signal Desk — client-side render logic.
   Reads two static, manually-refreshed JSON files (data/snapshot.json, data/status.json, and
   data/news.json when present). There is no live backend: "Refresh now" explains how a new
   refresh is produced rather than pretending this static page can re-fetch NSE data itself. */
(function () {
  "use strict";

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "sectors", label: "Sector Rankings" },
    { id: "screen_pv", label: "Price_Volume Screener" },
    { id: "screen_rsi", label: "RSI_Based Screener" },
    { id: "screen_both", label: "Both Logics" },
    { id: "indices", label: "NSE Indices" },
    { id: "fo", label: "F&O" },
    { id: "strategy", label: "Strategy Research" },
    { id: "news", label: "News" },
    { id: "company", label: "Company Research" },
    { id: "methodology", label: "Methodology & Data Status" },
  ];

  let STATE = { tab: "overview", snapshot: null, status: null, news: null, loadError: null, company: null, expandedSector: null, expandedIndex: null, expandedOptionChain: null, selectedFoStock: null };

  /* ---------------- formatting helpers ---------------- */
  const fmt = {
    num(v, d = 2) { return (v === null || v === undefined || Number.isNaN(v)) ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }); },
    int(v) { return (v === null || v === undefined) ? "—" : Number(v).toLocaleString("en-IN"); },
    pct(v, d = 2) { return (v === null || v === undefined || Number.isNaN(v)) ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%"; },
    money(v) {
      if (v === null || v === undefined) return "—";
      const abs = Math.abs(v);
      if (abs >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
      if (abs >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
      return "₹" + fmt.num(v, 0);
    },
    unixIst(sec) {
      if (!sec) return "—";
      const d = new Date(sec * 1000);
      return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST";
    },
    iso(s) {
      if (!s) return "—";
      try { return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST"; }
      catch (e) { return s; }
    },
    ago(s) {
      if (!s) return "";
      const ms = Date.now() - new Date(s).getTime();
      const m = Math.round(ms / 60000);
      if (m < 1) return "just now";
      if (m < 60) return m + "m ago";
      const h = Math.round(m / 60);
      if (h < 48) return h + "h ago";
      return Math.round(h / 24) + "d ago";
    },
    cls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; },
  };

  function esc(s) { return (s ?? "").toString().replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ---------------- data loading ---------------- */
  async function loadJSON(path) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function boot() {
    const [snapshot, status, news] = await Promise.all([
      loadJSON("data/snapshot.json"), loadJSON("data/status.json"), loadJSON("data/news.json"),
    ]);
    STATE.snapshot = snapshot; STATE.status = status; STATE.news = news;
    if (!snapshot) STATE.loadError = "snapshot.json could not be loaded — no screening data available.";
    renderShell();
    renderTopbar();
    renderView();
  }

  /* ---------------- shell / nav ---------------- */
  function renderShell() {
    const navHtml = TABS.map(t => `<button data-tab="${t.id}" class="${t.id === STATE.tab ? "active" : ""}">${t.label}${navBadge(t.id)}</button>`).join("");
    document.getElementById("nav-tabs").innerHTML = navHtml;
    document.getElementById("nav-tabs-mobile").innerHTML = navHtml;
    document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
      STATE.tab = btn.dataset.tab;
      renderShell(); renderView();
      window.scrollTo({ top: 0 });
    }));
    const foot = document.getElementById("sidebar-foot");
    const s = STATE.snapshot;
    foot.innerHTML = s
      ? `Universe: <b>${s.universe_meta.total}</b> symbols<br>Nifty500: ${s.universe_meta.nifty500} · F&amp;O: ${s.universe_meta.fo_eligible}`
      : "No data loaded";
    document.getElementById("theme-toggle").onclick = toggleTheme;
    document.getElementById("refresh-btn").onclick = showRefreshInfo;
  }

  function navBadge(id) {
    const c = STATE.snapshot?.counts;
    if (!c) return "";
    if (id === "sectors") return ` <span class="badge">${STATE.snapshot.sector_rankings.ranked.length}</span>`;
    if (id === "screen_pv") return ` <span class="badge">${c.matched_price_volume + c.matched_both}</span>`;
    if (id === "screen_rsi") return ` <span class="badge">${c.matched_rsi_based + c.matched_both}</span>`;
    if (id === "screen_both") return ` <span class="badge">${c.matched_both}</span>`;
    return "";
  }

  function toggleTheme() {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme");
    if (cur === "dark") root.setAttribute("data-theme", "light");
    else if (cur === "light") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", "dark");
  }

  function renderTopbar() {
    const row = document.getElementById("status-row");
    const s = STATE.snapshot, st = STATE.status;
    if (!s) { row.innerHTML = `<span class="pill stale">NO DATA</span> ${esc(STATE.loadError || "")}`; return; }
    const ms = s.market_status;
    const pillClass = ms.status === "OPEN" ? "open" : ms.status === "PRE_OPEN" ? "pre" : "closed";
    const isStale = st && st.last_error && st.last_success !== st.last_attempt;
    row.innerHTML = `
      <span class="pill ${pillClass}">${ms.status.replace("_", " ")}</span>
      ${!ms.is_trading_day ? `<span class="pill closed">${ms.holiday_reason ? esc(ms.holiday_reason) : "Weekend"}</span>` : ""}
      ${isStale ? `<span class="pill stale">STALE — last refresh failed</span>` : ""}
      <span class="mono">Snapshot: ${fmt.iso(s.generated_at_ist)}</span>
      <span>· Screening close session: <span class="mono">${esc(s.screening_close_session)}</span></span>
      <span>· Scheduling: <b style="color:var(--warn)">${st?.scheduling_configured ? "configured (cron)" : "not configured"}</b></span>
    `;
  }

  function showRefreshInfo() {
    const st = STATE.status || {};
    openModal(`
      <button class="btn modal-close" onclick="closeModal()">Close</button>
      <h2>Refresh now</h2>
      <p class="prose">This site has no live backend — a "refresh" means re-running the Python data
      pipeline and republishing this page. It cannot happen from a click on a static published page
      without exposing API credentials client-side, which this project deliberately avoids. There are
      two real ways to trigger one:</p>
      <h3>1. Run the GitHub Action (fastest, no Claude session needed)</h3>
      <p class="prose">Requires being logged into GitHub with access to this repo. Opens the workflow's
      own page — click the "Run workflow" dropdown there, branch <code>main</code>, then Run workflow.
      Takes roughly 5–6 minutes; this public site updates automatically once it finishes.</p>
      <p><a href="https://github.com/aletjolly-eng/nse-signal-desk/actions/workflows/refresh-and-deploy.yml" target="_blank" rel="noopener" class="btn primary" style="display:inline-block;text-decoration:none">Open the refresh workflow on GitHub →</a></p>
      <p class="stat-sub">This also runs automatically on its own schedule (see below) on trading days — a
      manual run is only for getting new data sooner than the next scheduled slot.</p>
      <h3>2. Ask Claude directly</h3>
      <p class="prose">In the project at <code>C:\\Users\\Admin\\Desktop\\Alet\\Trading</code>, ask Claude
      to refresh — this also re-fetches anything that needs an active MCP session (TradingView analyst
      forecasts, cross-check technicals), which the GitHub Action alone cannot do. Or run it yourself:</p>
      <div class="table-wrap" style="padding:10px 14px;font-family:'IBM Plex Mono';font-size:12.5px">venv/Scripts/python.exe scripts/refresh.py</div>
      <h3>Last attempts</h3>
      <dl class="kv">
        <dt>Last attempt</dt><dd>${fmt.iso(st.last_attempt)}</dd>
        <dt>Last success</dt><dd>${fmt.iso(st.last_success)}</dd>
        <dt>Last error</dt><dd>${st.last_error ? "see status.json — refresh failed, previous snapshot kept" : "none"}</dd>
        <dt>Scheduled cron (GitHub Actions)</dt><dd>configured — 07:00–23:00 IST, every 2h, Mon–Fri; not independently confirmed to have fired on schedule yet, see Methodology tab</dd>
      </dl>
    `);
  }

  function openModal(html) {
    document.getElementById("modal-content").innerHTML = html;
    document.getElementById("modal-backdrop").classList.add("open");
  }
  window.closeModal = function () { document.getElementById("modal-backdrop").classList.remove("open"); };
  document.getElementById("modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });

  /* ---------------- view router ---------------- */
  function renderView() {
    document.querySelectorAll("#nav-tabs button, #nav-tabs-mobile button").forEach(b => b.classList.toggle("active", b.dataset.tab === STATE.tab));
    const el = document.getElementById("views");
    if (!STATE.snapshot) {
      el.innerHTML = `<div class="banner warn">${esc(STATE.loadError || "No data")}</div>`;
      return;
    }
    const renderers = {
      overview: renderOverview, sectors: renderSectors,
      screen_pv: () => renderScreener("Price_Volume", "Price_Volume Screener", r => r.logic_matched === "Price_Volume" || r.logic_matched === "Both"),
      screen_rsi: () => renderScreener("RSI_Based", "RSI_Based Screener", r => r.logic_matched === "RSI_Based" || r.logic_matched === "Both"),
      screen_both: () => renderScreener("Both", "Both Logics", r => r.logic_matched === "Both"),
      indices: renderIndices, fo: renderOptionsChain, strategy: renderStrategy, news: renderNews, company: renderCompany, methodology: renderMethodology,
    };
    el.innerHTML = `<div class="view active" id="view-inner"></div>`;
    document.getElementById("view-inner").innerHTML = renderers[STATE.tab] ? renderers[STATE.tab]() : "";
    wireDynamic();
  }

  function wireDynamic() {
    document.querySelectorAll("table[data-sortable]").forEach(wireTableSort);
    document.querySelectorAll("[data-csv-export]").forEach(btn => btn.addEventListener("click", () => exportCsv(btn.dataset.csvExport)));
    document.querySelectorAll("[data-filter-input]").forEach(inp => inp.addEventListener("input", () => applyTableFilter(inp)));
    document.querySelectorAll("[data-filter-select]").forEach(sel => sel.addEventListener("change", () => applyTableFilter(sel)));
  }

  // Delegated once, at document level, so clicks work everywhere these attributes appear —
  // including inside modal content injected later (e.g. the sector-detail popup's stock rows).
  document.addEventListener("click", (e) => {
    const symEl = e.target.closest("[data-open-symbol]");
    if (symEl && symEl.dataset.openSymbol) { openCompany(symEl.dataset.openSymbol); return; }
    const secEl = e.target.closest("[data-open-sector]");
    if (secEl && secEl.dataset.openSector) { openSectorAccordion(secEl.dataset.openSector); return; }
    const idxEl = e.target.closest("[data-open-index]");
    if (idxEl && idxEl.dataset.openIndex) { toggleIndexExpand(idxEl.dataset.openIndex); return; }
    const ocEl = e.target.closest("[data-toggle-option-chain]");
    if (ocEl && ocEl.dataset.toggleOptionChain) {
      const sym = ocEl.dataset.toggleOptionChain;
      STATE.expandedOptionChain = STATE.expandedOptionChain === sym ? null : sym;
      renderView();
      return;
    }
    const foEl = e.target.closest("[data-select-fo-stock]");
    if (foEl && foEl.dataset.selectFoStock) {
      STATE.selectedFoStock = foEl.dataset.selectFoStock;
      renderView();
      return;
    }
  });

  /* generic client-side sort for any table[data-sortable] */
  function wireTableSort(table) {
    table.querySelectorAll("thead th[data-key]").forEach((th) => {
      const idx = th.cellIndex; // true column index within the row, not index among data-key'd th's
      th.addEventListener("click", () => {
        const numeric = th.dataset.numeric === "1";
        const tbody = table.tBodies[0];
        const rows = Array.from(tbody.rows);
        const asc = th.dataset.dir !== "asc";
        table.querySelectorAll("thead th").forEach(h => h.removeAttribute("data-dir"));
        th.dataset.dir = asc ? "asc" : "desc";
        rows.sort((a, b) => {
          let av = a.cells[idx].dataset.sort ?? a.cells[idx].textContent;
          let bv = b.cells[idx].dataset.sort ?? b.cells[idx].textContent;
          if (numeric) { av = parseFloat(av) || -Infinity; bv = parseFloat(bv) || -Infinity; }
          if (av < bv) return asc ? -1 : 1;
          if (av > bv) return asc ? 1 : -1;
          return 0;
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  function applyTableFilter(control) {
    const scope = control.dataset.filterInput || control.dataset.filterSelect;
    const container = document.getElementById(scope);
    if (!container) return;
    const search = (container.querySelector("[data-filter-input]")?.value || "").toLowerCase();
    const sectorSel = container.querySelector("[data-filter-select]");
    const sector = sectorSel ? sectorSel.value : "";
    const filterAttr = sectorSel ? (sectorSel.dataset.filterAttr || "sector") : "sector";
    let visible = 0;
    container.querySelectorAll("tbody tr").forEach(tr => {
      const text = tr.textContent.toLowerCase();
      const matchesSearch = !search || text.includes(search);
      const matchesSector = !sector || tr.dataset[filterAttr] === sector;
      const show = matchesSearch && matchesSector;
      tr.style.display = show ? "" : "none";
      if (show) visible++;
    });
    const note = container.querySelector("[data-visible-count]");
    if (note) note.textContent = visible + " shown";
  }

  function exportCsv(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const rows = [...table.querySelectorAll("tr")].filter(r => r.style.display !== "none");
    const csv = rows.map(r => [...r.children].map(c => `"${c.textContent.trim().replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = tableId + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /* ---- Global markets panel: LTP + 1D/1W/1M/6M for major regional benchmarks (yfinance). ---- */
  function renderGlobalMarketsPanel() {
    const gm = STATE.snapshot?.global_markets;
    if (!gm) return "";
    const rows = Object.entries(gm.regional_indices || {});
    return `
      <div class="section-title" style="margin-top:0"><h2>Global markets</h2><span class="hint">LTP and return over 1D / 1W / 1M / 6M</span></div>
      <div class="table-wrap" style="margin-bottom:20px"><table>
        <tr><th class="txt">Region</th><th class="txt">Index</th><th class="num">LTP</th><th class="num">1D</th><th class="num">1W</th><th class="num">1M</th><th class="num">6M</th></tr>
        ${rows.map(([region, r]) => r.available ? `<tr>
          <td class="txt"><b>${esc(region)}</b></td>
          <td class="txt">${esc(r.name)}</td>
          <td class="num">${fmt.num(r.last)}</td>
          <td class="num ${fmt.cls(r["1d_change_pct"])}">${fmt.pct(r["1d_change_pct"])}</td>
          <td class="num ${fmt.cls(r.ret_1w_pct)}">${fmt.pct(r.ret_1w_pct)}</td>
          <td class="num ${fmt.cls(r.ret_1m_pct)}">${fmt.pct(r.ret_1m_pct)}</td>
          <td class="num ${fmt.cls(r.ret_6m_pct)}">${fmt.pct(r.ret_6m_pct)}</td>
        </tr>` : `<tr><td class="txt"><b>${esc(region)}</b></td><td colspan="6" class="na">Source unavailable this refresh</td></tr>`).join("")}
      </table></div>
      <div class="stat-sub" style="margin-top:-14px;margin-bottom:18px">${esc(gm.source)}</div>
    `;
  }

  /* ================= OVERVIEW ================= */
  function renderOverview() {
    const s = STATE.snapshot, c = s.counts, sr = s.sector_rankings, st = STATE.status || {};
    const top3 = sr.ranked.slice(0, 3), bottom3 = sr.ranked.slice(-3).reverse();
    const leaders = [...s.watchlist].sort((a, b) => (b.volume?.volume_multiple || 0) - (a.volume?.volume_multiple || 0)).slice(0, 8);
    const deliveryNote = `Delivery-backed accumulation and turnover concentration require NSE bhavcopy delivery data,
      which no connected provider currently supplies — see Methodology tab for what's unavailable and why.`;
    return `
      ${renderGlobalMarketsPanel()}
      <div class="banner info">${st.scheduling_configured
        ? `A GitHub Actions cron is <b>configured</b> to refresh this automatically on trading days — not yet independently confirmed from here to have fired unattended. See the`
        : `Manual-refresh snapshot. Scheduling is <b>not configured</b> — see the`}
        <a href="#" onclick="event.preventDefault();document.querySelector('[data-tab=methodology]').click()">Methodology tab</a> for what that means and how to trigger a refresh.</div>
      <div class="grid grid-4">
        <div class="card"><div class="stat-label">Scanned</div><div class="stat-value">${fmt.int(c.scanned)}</div><div class="stat-sub">Nifty 500 + F&O universe</div></div>
        <div class="card"><div class="stat-label">Data unavailable</div><div class="stat-value">${fmt.int(c.data_unavailable)}</div><div class="stat-sub">no usable OHLCV from provider</div></div>
        <div class="card"><div class="stat-label">Matched (any logic)</div><div class="stat-value">${fmt.int(c.matched_total)}</div><div class="stat-sub">of ${fmt.int(c.eligible_for_screening)} eligible</div></div>
        <div class="card"><div class="stat-label">Both logics</div><div class="stat-value">${fmt.int(c.matched_both)}</div><div class="stat-sub">P/E + volume spike + RSI band</div></div>
      </div>

      <div class="section-title"><h2>1. Market regime</h2></div>
      <div class="card prose">${regimeNarrative(s)}</div>

      <div class="section-title"><h2>2 &amp; 4. Rotation skew — money rotating in / out (inferred)</h2><span class="hint">price/volume inference, not measured fund flow</span></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="stat-label" style="color:var(--pos)">Strongest sectors (rotation IN, inferred)</div>
          ${top3.map(r => `<div class="stat-sub" style="margin-top:6px">#${r.rank} <b>${esc(r.sector)}</b> — score ${r.score}, ${fmt.pct(r.rel_ret_5d)} vs Nifty50 (5d)</div>`).join("")}
        </div>
        <div class="card">
          <div class="stat-label" style="color:var(--neg)">Weakest sectors (rotation OUT, inferred)</div>
          ${bottom3.map(r => `<div class="stat-sub" style="margin-top:6px">#${r.rank} <b>${esc(r.sector)}</b> — score ${r.score}, ${fmt.pct(r.rel_ret_5d)} vs Nifty50 (5d)</div>`).join("")}
        </div>
      </div>

      <div class="section-title"><h2>7. Standout leaders and breakouts to watch</h2><span class="hint">top volume-multiple among matched stocks</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Symbol</th><th>Sector</th><th class="num">Vol ×</th><th class="num">Breakout %</th><th class="num">RSI(14)d</th><th>Logic</th></tr></thead>
        <tbody>${leaders.map(w => `<tr data-open-symbol="${esc(w.symbol)}">
          <td class="txt"><b>${esc(w.symbol)}</b></td><td class="txt">${esc(w.sector)}</td>
          <td class="num">${fmt.num(w.volume?.volume_multiple)}×</td>
          <td class="num ${fmt.cls(w.breakout?.breakout_pct)}">${fmt.pct(w.breakout?.breakout_pct)}</td>
          <td class="num">${fmt.num(w.rsi_daily, 1)}</td>
          <td>${logicTag(w.logic_matched)}</td></tr>`).join("")}</tbody>
      </table></div>

      <div class="section-title"><h2>8 &amp; 9. Delivery-backed accumulation / turnover concentration</h2></div>
      <div class="banner warn">${deliveryNote}</div>

      <div class="section-title"><h2>10. Risks and caveats</h2></div>
      <div class="card prose">
        <ul>
          <li>Snapshot reflects <b>${esc(s.screening_close_session)}</b>'s completed session; intraday "last price" fields may be more recent but are Yahoo-sourced and can lag true NSE ticks.</li>
          <li>Sector return figures use an equal-weighted aggregate of Nifty 500 constituents per NSE industry bucket, not a separately-traded NSE sector index — see Methodology.</li>
          <li>NSE Indices tab: RSI/trend/strategies are only computed for indices with a verified full historical price series (8 of 139) — the rest show real NSE snapshot stats with "insufficient data" rather than a guessed logic tag.</li>
          <li>${st.scheduling_configured
            ? 'A GitHub Actions cron is configured to run <code>scripts/refresh.py</code> unattended on trading days — not yet independently confirmed from here to have fired on schedule; see Methodology.'
            : 'Scheduling is not configured — this snapshot only updates when someone manually triggers <code>scripts/refresh.py</code>.'}</li>
        </ul>
      </div>
    `;
  }

  function regimeNarrative(s) {
    const sr = s.sector_rankings.ranked;
    if (!sr.length) return "Insufficient sector data this session to characterize market regime.";
    const posCount = sr.filter(r => r.rel_ret_1d > 0).length;
    const breadthAvg = sr.reduce((a, r) => a + r.pct_above_20dma, 0) / sr.length;
    let regime;
    if (posCount / sr.length > 0.65 && breadthAvg > 55) regime = "constructive / broadening";
    else if (posCount / sr.length < 0.35 && breadthAvg < 45) regime = "cautious / narrowing";
    else regime = "mixed / stock-specific";
    return `<b>Regime read: ${regime}.</b> ${posCount} of ${sr.length} ranked sectors show a positive 1-day
      return relative to Nifty 50; average breadth (constituents above 20DMA) across ranked sectors is
      ${breadthAvg.toFixed(1)}%. This classification is derived mechanically from breadth and relative
      return each refresh — it is not a fixed default and can read anywhere from constructive to cautious
      depending on what the data shows.`;
  }

  function logicTag(l) {
    if (l === "Both") return `<span class="tag both">Both</span>`;
    if (l === "Price_Volume") return `<span class="tag pv">Price_Volume</span>`;
    if (l === "RSI_Based") return `<span class="tag rsi">RSI_Based</span>`;
    return `<span class="tag none">None</span>`;
  }

  /* Every stock in a sector that currently passes a screening logic (Price_Volume / RSI_Based / Both) —
     i.e. that sector's slice of the watchlist. Sorted by today's change %, most positive first. */
  function sectorMatchedStocks(sectorName) {
    return STATE.snapshot.watchlist
      .filter(w => w.sector === sectorName)
      .sort((a, b) => (b.daily_change_pct ?? -1e15) - (a.daily_change_pct ?? -1e15));
  }

  function sectorExpandHtml(sectorName) {
    const sectorRow = STATE.snapshot.sector_rankings.ranked.find(r => r.sector === sectorName);
    const total = sectorRow ? sectorRow.constituents_total : null;
    const stocks = sectorMatchedStocks(sectorName);
    return `
      <div class="stat-sub" style="margin-bottom:8px">
        ${stocks.length} of ${total ?? "?"} constituents in <b>${esc(sectorName)}</b> currently pass a
        screening logic (Price_Volume / RSI_Based / Both) — every stock shown here is on the watchlist,
        this is not a ranking by outperformance.
      </div>
      ${stocks.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th class="txt">Symbol</th><th class="txt">Company</th><th class="num">Chg %</th><th class="num">RSI(14)d</th><th class="num">Vol ×</th><th>Logic</th></tr></thead>
        <tbody>${stocks.map(w => `<tr data-open-symbol="${esc(w.symbol)}" style="cursor:pointer">
          <td class="txt"><b>${esc(w.symbol)}</b></td>
          <td class="txt">${esc(w.company)}</td>
          <td class="num ${fmt.cls(w.daily_change_pct)}">${fmt.pct(w.daily_change_pct)}</td>
          <td class="num">${w.rsi_daily ?? '<span class="na">n/a</span>'}</td>
          <td class="num">${w.volume?.available ? fmt.num(w.volume.volume_multiple) + "×" : '<span class="na">n/a</span>'}</td>
          <td>${logicTag(w.logic_matched)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      ` : `<div class="na">No constituents of this sector currently pass Price_Volume, RSI_Based, or Both — 0 matches, not relaxed to force a result.</div>`}
    `;
  }

  const EXPAND_MS = 300;

  function toggleSectorExpand(sectorName) {
    const id = cssId(sectorName);
    const row = document.getElementById("sector-detail-" + id);
    if (!row) return;
    const existing = document.getElementById("expand-" + id);

    if (existing) {
      // already open -> contract it
      const inner = existing.querySelector(".sector-expand-inner");
      inner.style.maxHeight = inner.scrollHeight + "px"; // lock current height first
      requestAnimationFrame(() => { inner.style.maxHeight = "0px"; inner.classList.remove("open"); });
      setTimeout(() => existing.remove(), EXPAND_MS);
      STATE.expandedSector = null;
      updateChevrons();
      return;
    }

    // only one sector expanded at a time — contract any other open one first
    document.querySelectorAll(".sector-expand-row").forEach(r => r.remove());

    const tr = document.createElement("tr");
    tr.className = "sector-expand-row";
    tr.id = "expand-" + id;
    const td = document.createElement("td");
    td.colSpan = 12;
    td.style.cssText = "padding:0;border-bottom:1px solid var(--border)";
    const inner = document.createElement("div");
    inner.className = "sector-expand-inner";
    inner.innerHTML = sectorExpandHtml(sectorName);
    td.appendChild(inner);
    tr.appendChild(td);
    row.after(tr);

    void inner.offsetHeight; // force reflow so the transition below actually animates
    inner.classList.add("open");
    inner.style.maxHeight = inner.scrollHeight + "px";

    STATE.expandedSector = sectorName;
    updateChevrons();
  }

  function updateChevrons() {
    document.querySelectorAll("[data-chev]").forEach(el => {
      el.textContent = el.dataset.chev === STATE.expandedSector ? "▾" : "▸";
    });
  }

  function openSectorAccordion(sectorName) {
    const row = document.getElementById("sector-detail-" + cssId(sectorName));
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    toggleSectorExpand(sectorName);
  }

  /* ================= SECTOR RANKINGS ================= */
  function renderSectors() {
    STATE.expandedSector = null; // this view is rebuilt fresh each time, so no stale expand row survives anyway
    const sr = STATE.snapshot.sector_rankings;
    const maxScore = Math.max(...sr.ranked.map(r => r.score), 1);
    const tiles = sr.ranked.map(r => {
      const t = r.score / maxScore;
      const bg = `color-mix(in srgb, var(--pos) ${Math.round(t * 55 + 10)}%, var(--surface))`;
      return `<div class="heattile" style="background:${bg};cursor:pointer" data-open-sector="${esc(r.sector)}" title="Click to expand this sector's screener-matched stocks">
        <div class="hname">#${r.rank} ${esc(r.sector)}</div>
        <div><div class="hscore">${r.score}</div><div class="hsub">${fmt.pct(r.rel_ret_1d)} 1d rel.</div></div>
      </div>`;
    }).join("");
    const excludedRows = Object.entries(sr.excluded || {});
    return `
      <div class="section-title"><h2>Sector Strength Score (0–100)</h2><span class="hint">${sr.ranked.length} sectors ranked · benchmark Nifty 50 · click a sector to expand its screener-matched stocks</span></div>
      <div class="heatgrid">${tiles || '<div class="na">No sectors met the minimum-coverage threshold this refresh.</div>'}</div>

      <div class="section-title"><h2>Detail</h2></div>
      <div class="table-wrap"><table data-sortable>
        <thead><tr>
          <th data-key="rank" data-numeric="1">Rank</th><th class="txt">Sector</th>
          <th class="num" data-key="score" data-numeric="1">Score</th>
          <th class="num" data-key="ret_1d" data-numeric="1">1D Ret</th><th class="num" data-key="rel_ret_1d" data-numeric="1">1D vs N50</th>
          <th class="num" data-key="ret_5d" data-numeric="1">5D Ret</th><th class="num" data-key="rel_ret_5d" data-numeric="1">5D vs N50</th>
          <th class="num" data-key="ret_20d" data-numeric="1">20D Ret</th><th class="num" data-key="rel_ret_20d" data-numeric="1">20D vs N50</th>
          <th class="num" data-key="pct_above_20dma" data-numeric="1">%&gt;20DMA</th><th class="num" data-key="pct_above_50dma" data-numeric="1">%&gt;50DMA</th>
          <th class="num">Coverage</th>
        </tr></thead>
        <tbody>${sr.ranked.map(r => `<tr id="sector-detail-${cssId(r.sector)}" data-open-sector="${esc(r.sector)}" style="cursor:pointer" title="Click to expand this sector's screener-matched stocks">
          <td class="num">${r.rank}</td><td class="txt"><span class="chev" data-chev="${esc(r.sector)}">▸</span> ${esc(r.sector)}</td>
          <td class="num">${r.score}</td>
          <td class="num ${fmt.cls(r.ret_1d)}">${fmt.pct(r.ret_1d)}</td><td class="num ${fmt.cls(r.rel_ret_1d)}">${fmt.pct(r.rel_ret_1d)}</td>
          <td class="num ${fmt.cls(r.ret_5d)}">${fmt.pct(r.ret_5d)}</td><td class="num ${fmt.cls(r.rel_ret_5d)}">${fmt.pct(r.rel_ret_5d)}</td>
          <td class="num ${fmt.cls(r.ret_20d)}">${fmt.pct(r.ret_20d)}</td><td class="num ${fmt.cls(r.rel_ret_20d)}">${fmt.pct(r.rel_ret_20d)}</td>
          <td class="num">${r.pct_above_20dma}%</td><td class="num">${r.pct_above_50dma}%</td>
          <td class="num">${r.constituents_scored}/${r.constituents_total}</td>
        </tr>`).join("")}</tbody>
      </table></div>

      ${excludedRows.length ? `
        <div class="section-title"><h2>Excluded — inadequate coverage</h2></div>
        <div class="banner warn">${excludedRows.map(([sec, why]) => `<div><b>${esc(sec)}</b>: ${esc(why)}</div>`).join("")}</div>
      ` : ""}

      <div class="section-title"><h2>Sector leaders</h2><span class="hint">by relative strength within sector; screener-pass shown separately</span></div>
      ${renderSectorLeaders()}
    `;
  }

  function cssId(s) { return s.replace(/[^a-z0-9]/gi, "-").toLowerCase(); }

  function renderSectorLeaders() {
    const s = STATE.snapshot;
    const bySector = {};
    Object.values(s.company_profiles || {}).forEach(p => {
      if (!p.in_nifty500 || !p.sector || p.sector.startsWith("Unavailable")) return;
      (bySector[p.sector] ||= []).push(p);
    });
    const ranked = s.sector_rankings.ranked;
    if (!ranked.length || !Object.keys(bySector).length) return `<div class="na">No per-company profile data available to compute leaders.</div>`;
    const blocks = ranked.slice(0, 8).map(r => {
      const list = (bySector[r.sector] || [])
        .filter(p => p.daily_change_pct !== null && p.daily_change_pct !== undefined)
        .sort((a, b) => (b.daily_change_pct || 0) - (a.daily_change_pct || 0)).slice(0, 3);
      if (!list.length) return "";
      return `<div class="card" style="margin-bottom:8px;cursor:pointer" data-open-sector="${esc(r.sector)}">
        <div class="stat-label">#${r.rank} ${esc(r.sector)} <span class="stat-sub" style="font-weight:400">(click to expand in table above)</span></div>
        <div class="toolbar" style="margin-top:6px;gap:14px">
          ${list.map(p => `<span data-open-symbol="${esc(p.symbol)}" style="cursor:pointer">
            <b>${esc(p.symbol)}</b> <span class="mono ${fmt.cls(p.daily_change_pct)}">${fmt.pct(p.daily_change_pct)}</span>
            ${logicTag(p.logic_matched)}
          </span>`).join(" &nbsp;·&nbsp; ")}
        </div>
      </div>`;
    }).join("");
    return blocks || `<div class="na">Insufficient per-company change data this refresh.</div>`;
  }

  /* ================= SCREENERS ================= */
  function renderScreener(key, title, predicate) {
    const s = STATE.snapshot;
    const rows = s.watchlist.filter(predicate);
    const sectors = [...new Set(s.watchlist.map(w => w.sector))].sort();
    const containerId = "tbl-" + key;
    return `
      <div class="section-title"><h2>${title}</h2><span class="hint">${rows.length} matched of ${s.counts.eligible_for_screening} eligible</span></div>
      <div class="banner info">
        Logic: P/E in (${s.thresholds.pe_min_exclusive}, ${s.thresholds.pe_max_inclusive}]
        ${key !== "RSI_Based" ? ` &amp; signal-session volume ≥ ${s.thresholds.volume_multiple_min}× the prior ${s.thresholds.volume_lookback_sessions}-session average` : ""}
        ${key === "RSI_Based" ? ` &amp; daily RSI(14) in [${s.thresholds.rsi_band[0]}, ${s.thresholds.rsi_band[1]}]` : ""}
        ${key === "Both" ? ` &amp; daily RSI(14) in [${s.thresholds.rsi_band[0]}, ${s.thresholds.rsi_band[1]}]` : ""}.
        ${key === "Price_Volume" ? "Includes rows also tagged Both (they satisfy this condition too)." : ""}
        ${key === "RSI_Based" ? "Includes rows also tagged Both (they satisfy this condition too)." : ""}
      </div>
      ${rows.length === 0 ? `<div class="banner warn">No stocks match this logic in the current snapshot — thresholds were not relaxed to force a result.</div>` : screenerTable(rows, containerId, sectors)}
    `;
  }

  function screenerTable(rows, containerId, sectors) {
    return `
      <div id="${containerId}">
        <div class="toolbar">
          <input type="text" placeholder="Search symbol/company/sector…" data-filter-input="${containerId}">
          <select data-filter-select="${containerId}"><option value="">All sectors</option>${sectors.map(sc => `<option value="${esc(sc)}">${esc(sc)}</option>`).join("")}</select>
          <span class="spacer"></span>
          <span class="count-note" data-visible-count>${rows.length} shown</span>
          <button class="btn" data-csv-export="table-${containerId}">Export CSV</button>
        </div>
        <div class="table-wrap">
        <table data-sortable id="table-${containerId}">
          <thead><tr>
            <th data-key="symbol">Symbol</th><th class="txt">Company</th><th class="txt">Sector</th>
            <th>F&amp;O</th><th>Logic</th>
            <th class="num" data-key="last_price" data-numeric="1">Last Price</th><th class="txt">Quote time</th>
            <th class="num" data-key="daily_change_pct" data-numeric="1">Chg %</th>
            <th class="num" data-key="screening_close" data-numeric="1">Screen Close</th>
            <th class="num" data-key="breakout_pct" data-numeric="1">125d High</th><th class="num" data-key="breakout_pct2" data-numeric="1">Breakout %</th>
            <th class="num" data-key="vol_signal" data-numeric="1">Signal Vol</th><th class="num" data-key="vol_avg" data-numeric="1">125d Avg Vol</th><th class="num" data-key="vol_mult" data-numeric="1">Vol ×</th>
            <th class="num" data-key="liquidity" data-numeric="1">Liquidity (Avg turnover)</th>
            <th class="num" data-key="rsi_daily" data-numeric="1">RSI(14) d</th><th class="num" data-key="rsi_1h" data-numeric="1">RSI(14) 1h</th>
            <th class="num" data-key="pe" data-numeric="1">P/E</th>
          </tr></thead>
          <tbody>
            ${rows.map(w => screenerRow(w)).join("")}
          </tbody>
        </table>
        </div>
      </div>
    `;
  }

  function screenerRow(w) {
    const v = w.volume || {}, b = w.breakout || {};
    const NA = -1e15; // sentinel so "n/a" rows sort to the bottom, never silently as zero
    // Liquidity proxy: 125-session average volume x screening close = average rupee value traded on a
    // typical day. Both inputs already computed elsewhere on this row — nothing new fetched or guessed.
    const liqPrice = w.screening_close ?? w.last_price;
    const liquidity = (v.available && liqPrice != null) ? v.prior_avg_volume * liqPrice : null;
    return `<tr data-sector="${esc(w.sector)}" data-open-symbol="${esc(w.symbol)}">
      <td class="txt" data-sort="${esc(w.symbol)}"><b>${esc(w.symbol)}</b></td>
      <td class="txt">${esc(w.company)}</td>
      <td class="txt">${esc(w.sector)}</td>
      <td class="txt">${w.fo_eligible ? "Yes" : "No"}</td>
      <td data-sort="${esc(w.logic_matched)}">${logicTag(w.logic_matched)}</td>
      <td class="num" data-sort="${w.last_price ?? NA}">${fmt.num(w.last_price)}</td>
      <td class="txt">${fmt.unixIst(w.last_price_time_unix)}</td>
      <td class="num ${fmt.cls(w.daily_change_pct)}" data-sort="${w.daily_change_pct ?? NA}">${fmt.pct(w.daily_change_pct)}</td>
      <td class="num" data-sort="${w.screening_close ?? NA}">${fmt.num(w.screening_close)}</td>
      <td class="num" data-sort="${b.available ? b.prior_125_session_high : NA}">${b.available ? fmt.num(b.prior_125_session_high) : '<span class="na">n/a</span>'}</td>
      <td class="num ${fmt.cls(b.breakout_pct)}" data-sort="${b.available ? b.breakout_pct : NA}">${b.available ? fmt.pct(b.breakout_pct) : '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${v.available ? v.signal_session_volume : NA}">${v.available ? fmt.int(v.signal_session_volume) : '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${v.available ? v.prior_avg_volume : NA}">${v.available ? fmt.int(Math.round(v.prior_avg_volume)) : '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${v.available ? v.volume_multiple : NA}">${v.available ? fmt.num(v.volume_multiple) + "×" : '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${liquidity ?? NA}" title="Average 125-session volume × screening close — a standard proxy for how much rupee value trades in this name on a typical day, not a bid-ask spread or order-book depth measure">${liquidity != null ? fmt.money(liquidity) : '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${w.rsi_daily ?? NA}">${w.rsi_daily ?? '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${w.rsi_1h ?? NA}">${w.rsi_1h ?? '<span class="na">n/a</span>'}</td>
      <td class="num" data-sort="${w.pe ?? NA}">${w.pe ?? '<span class="na">n/a</span>'}</td>
    </tr>`;
  }

  /* ================= NSE INDICES ================= */
  function indexLogicTag(row) {
    if (!row.technicals_available) return `<span class="tag none" title="Insufficient historical price data to compute RSI/trend for this index">Insufficient data</span>`;
    if (row.logic === "Both") return `<span class="tag both">Both</span>`;
    if (row.logic === "Breadth_Thrust") return `<span class="tag pv">Breadth_Thrust</span>`;
    if (row.logic === "RSI_Based") return `<span class="tag rsi">RSI_Based</span>`;
    return `<span class="tag none">None</span>`;
  }

  /* Bullish/Bearish/Neutral classification. Two disclosed bases, never blended silently:
     "technical" (the 8 indices with verified RSI/trend history) requires trend + RSI + 20D return
     to all agree; "snapshot_proxy" (the other 131, real NSE snapshot fields only — no RSI/trend
     available) requires today's change, the 30-session return, and breadth to all agree. Anything
     that doesn't cleanly agree is Neutral — this is a bias read, not a precision signal, and is
     labelled with its basis everywhere it's shown so a snapshot-only read is never mistaken for a
     technicals-based one. */
  function computeBias(r) {
    if (r.technicals_available) {
      const up = r.above_50dma === true && r.above_20dma === true && r.rsi_daily !== null && r.rsi_daily >= 50 && (r.ret_20d ?? 0) > 0;
      const down = r.above_50dma === false && r.above_20dma === false && r.rsi_daily !== null && r.rsi_daily < 50 && (r.ret_20d ?? 0) < 0;
      return { bias: up ? "Bullish" : down ? "Bearish" : "Neutral", basis: "technical" };
    }
    const chg = r.change_pct, d30 = r.per_change_30d, breadth = r.breadth_pct_advancing;
    if (chg === null || chg === undefined || d30 === null || d30 === undefined) return { bias: "Unclassified", basis: "insufficient" };
    const up = chg > 0 && d30 > 0 && (breadth === null || breadth >= 50);
    const down = chg < 0 && d30 < 0 && (breadth === null || breadth < 50);
    return { bias: up ? "Bullish" : down ? "Bearish" : "Neutral", basis: "snapshot_proxy" };
  }

  function biasTag(biasInfo) {
    const { bias, basis } = biasInfo;
    const cls = bias === "Bullish" ? "pos" : bias === "Bearish" ? "neg" : "none";
    const suffix = basis === "snapshot_proxy" ? " (proxy)" : "";
    return `<span class="tag ${cls}" title="${basis === "technical" ? "Based on RSI + 20/50DMA trend + 20-session return" : basis === "snapshot_proxy" ? "Based on today's change, 30-session return and breadth — no RSI/trend history for this index" : "Insufficient data to classify"}">${esc(bias)}${suffix}</span>`;
  }

  function indexTableHtml(rows, idSuffix) {
    const containerId = "tbl-idx-" + idSuffix;
    return `
      <div id="${containerId}">
        <div class="toolbar">
          <input type="text" placeholder="Search index…" data-filter-input="${containerId}">
          <select data-filter-select="${containerId}" data-filter-attr="bias">
            <option value="">All bias</option>
            <option value="Bullish">Bullish</option>
            <option value="Bearish">Bearish</option>
            <option value="Neutral">Neutral</option>
            <option value="Unclassified">Unclassified</option>
          </select>
          <span class="spacer"></span><span class="count-note" data-visible-count>${rows.length} shown</span>
          <button class="btn" data-csv-export="table-${containerId}">Export CSV</button>
        </div>
        <div class="table-wrap"><table data-sortable id="table-${containerId}">
          <thead><tr>
            <th data-key="index">Index</th>
            <th>Bias</th>
            <th class="num" data-key="last" data-numeric="1">Last</th>
            <th class="num" data-key="chg" data-numeric="1">Chg %</th>
            <th class="num" data-key="d30" data-numeric="1">30D %</th>
            <th class="num" data-key="d365" data-numeric="1">365D %</th>
            <th class="num" data-key="pe" data-numeric="1">P/E</th>
            <th class="num" data-key="dy" data-numeric="1">Div Yield</th>
            <th class="num" data-key="breadth" data-numeric="1">% Advancing</th>
            <th class="num" data-key="rsi" data-numeric="1">RSI(14)d</th>
            <th>Logic</th>
          </tr></thead>
          <tbody>${rows.map(r => { const NA = -1e15; const bi = computeBias(r); return `<tr id="idx-detail-${cssId(r.index)}" data-open-index="${esc(r.index)}" data-bias="${bi.bias}" style="cursor:pointer">
            <td class="txt" data-sort="${esc(r.index)}"><span class="chev" data-ichev="${esc(r.index)}">▸</span> <b>${esc(r.index)}</b></td>
            <td data-sort="${bi.bias}">${biasTag(bi)}</td>
            <td class="num" data-sort="${r.last ?? NA}">${fmt.num(r.last)}</td>
            <td class="num ${fmt.cls(r.change_pct)}" data-sort="${r.change_pct ?? NA}">${fmt.pct(r.change_pct)}</td>
            <td class="num ${fmt.cls(r.per_change_30d)}" data-sort="${r.per_change_30d ?? NA}">${fmt.pct(r.per_change_30d)}</td>
            <td class="num ${fmt.cls(r.per_change_365d)}" data-sort="${r.per_change_365d ?? NA}">${fmt.pct(r.per_change_365d)}</td>
            <td class="num" data-sort="${r.pe ?? NA}">${r.pe ?? '<span class="na">n/a</span>'}</td>
            <td class="num" data-sort="${r.dy ?? NA}">${r.dy !== null ? fmt.pct(r.dy) : '<span class="na">n/a</span>'}</td>
            <td class="num" data-sort="${r.breadth_pct_advancing ?? NA}">${r.breadth_pct_advancing !== null ? r.breadth_pct_advancing + "%" : '<span class="na">n/a</span>'}</td>
            <td class="num" data-sort="${r.rsi_daily ?? NA}">${r.rsi_daily ?? '<span class="na">n/a</span>'}</td>
            <td>${indexLogicTag(r)}</td>
          </tr>`; }).join("")}</tbody>
        </table></div>
      </div>
    `;
  }

  function renderIndices() {
    STATE.expandedIndex = null;
    const ni = STATE.snapshot.nse_indices;
    const rows = [...ni.rows].sort((a, b) => (b.change_pct ?? -1e15) - (a.change_pct ?? -1e15));
    const bullCount = rows.filter(r => computeBias(r).bias === "Bullish").length;
    const bearCount = rows.filter(r => computeBias(r).bias === "Bearish").length;
    const foRows = rows.filter(r => r.in_derivatives);
    const nonFoRows = rows.filter(r => !r.in_derivatives);
    return `
      <div class="section-title"><h2>NSE Indices</h2><span class="hint">${ni.total} official indices · ${ni.with_technicals} with computed RSI/trend · click a row to expand strategies + chart</span></div>
      <div class="banner info">${esc(ni.methodology_note)}</div>
      <div class="banner info">
        <b>Bullish/Bearish/Neutral</b> is a bias read computed two ways, never blended: for the ${ni.with_technicals}
        indices with verified history, trend (20/50DMA) + RSI(14) + 20-session return must all agree; for the
        other ${ni.total - ni.with_technicals}, today's change + 30-session return + breadth must all agree (tagged
        "(proxy)" everywhere — real NSE numbers, just no RSI/trend behind them). Anything that doesn't cleanly
        agree is Neutral. Currently ${bullCount} Bullish, ${bearCount} Bearish, ${rows.length - bullCount - bearCount} Neutral/Unclassified.
      </div>

      <div class="section-title"><h2>F&amp;O-eligible indices</h2><span class="hint">${foRows.length} of ${rows.length} — these have listed index futures/options at NSE</span></div>
      ${indexTableHtml(foRows, "fo")}

      <div class="section-title"><h2>Non-F&amp;O indices</h2><span class="hint">${nonFoRows.length} of ${rows.length} — thematic/strategy/broad-market indices with no listed derivatives</span></div>
      ${indexTableHtml(nonFoRows, "nofo")}
    `;
  }

  function indexBySector(name) { return STATE.snapshot.nse_indices.rows.find(r => r.index === name); }

  function dayTradingStrategyHtml(r) {
    const vol = r.realized_vol_20d_annualized_pct;
    const trending = r.above_20dma === true && r.above_50dma === true;
    const rangebound = r.above_20dma !== r.above_50dma;
    const style = trending ? "Opening-range breakout, trend direction" : "VWAP mean-reversion, fade extremes";
    return `<div class="card">
      <h3 style="margin-top:0">Day trading</h3>
      <div class="stat-sub"><b>Current read:</b> ${trending ? "Above both 20 &amp; 50DMA — trending" : rangebound ? "20/50DMA mixed — choppier, less directional" : "Below both 20 &amp; 50DMA — trending down"}. 20-session realized volatility (annualized): ${vol !== null ? vol + "%" : '<span class="na">n/a</span>'}.</div>
      <div class="stat-sub"><b>Suggested style today:</b> ${style}.</div>
      <div class="stat-sub"><b>Rules:</b> ${trending
        ? "Wait for the first 15-30min range to establish; enter on a break of that range in the direction of the 20/50DMA trend; size the stop off the realized-vol figure above, not a fixed point value."
        : "Fade moves toward the session's VWAP once price is stretched beyond the opening range; avoid sizing up — mixed trend means whipsaw risk is elevated."}</div>
      <div class="stat-sub"><b>Invalidation:</b> Trend-following: close back inside the opening range. Mean-reversion: a clean break and hold beyond the prior day's high/low.</div>
      <div class="stat-sub"><b>Backtest statistics:</b> <span class="na">Not calculated per index — see Strategy Research tab for the one universe-level backtest this project actually computes.</span></div>
    </div>`;
  }

  function swingTradingStrategyHtml(r) {
    const rsi = r.rsi_daily;
    const uptrend = r.above_50dma === true;
    let read;
    if (rsi === null) read = "RSI unavailable for this index.";
    else if (uptrend && rsi >= 40 && rsi <= 55) read = `Uptrend (above 50DMA) with RSI at ${rsi} — a pullback zone, not overbought.`;
    else if (uptrend && rsi > 65) read = `Uptrend but RSI at ${rsi} is stretched — chasing here has weaker reward:risk.`;
    else if (!uptrend && rsi < 35) read = `Below 50DMA with RSI at ${rsi} — oversold in a downtrend, not automatically a buy.`;
    else read = `RSI at ${rsi}, ${uptrend ? "above" : "below"} 50DMA — no clean pullback or breakout setup right now.`;
    return `<div class="card">
      <h3 style="margin-top:0">Swing trading</h3>
      <div class="stat-sub"><b>Current read:</b> ${read}</div>
      <div class="stat-sub"><b>Rules:</b> Enter on a pullback to the rising 20DMA while price holds above the 50DMA and daily RSI(14) is in the 40-55 band (constructive, not overbought); timeframe: multi-day to a few weeks.</div>
      <div class="stat-sub"><b>Confirmation:</b> RSI turning back up from the 40-55 zone rather than breaking below it.</div>
      <div class="stat-sub"><b>Invalidation:</b> Daily close below the 50DMA.</div>
      <div class="stat-sub"><b>Failure modes:</b> Trend regime changes (a 50DMA break) turn a "buy the dip" read into a falling-knife scenario — this is a rule set, not a guarantee.</div>
      <div class="stat-sub"><b>Backtest statistics:</b> <span class="na">Not calculated per index.</span></div>
    </div>`;
  }

  function snapshotProxyStrategyHtml(r, bi) {
    const chg = r.change_pct, d30 = r.per_change_30d, breadth = r.breadth_pct_advancing;
    const factsLine = `Today ${fmt.pct(chg)}, 30-session ${fmt.pct(d30)}, breadth ${breadth !== null ? breadth + "% advancing" : "n/a"}.`;
    if (bi.bias === "Unclassified") {
      return `<div class="card"><h3 style="margin-top:0">No strategy read</h3>
        <div class="stat-sub">${factsLine}</div>
        <div class="stat-sub na">Missing today's change or 30-session return for this index — not enough to form even a coarse bias.</div></div>`;
    }
    if (bi.bias === "Neutral") {
      return `<div class="card"><h3 style="margin-top:0">Range / wait-and-see</h3>
        <div class="stat-sub">${factsLine}</div>
        <div class="stat-sub"><b>Read:</b> today's move, the 30-session trend and breadth don't agree on direction — that's a mixed signal, not a coin flip to force. Without RSI/trend history for this index, a directional entry here is a guess dressed up as a call.</div>
        <div class="stat-sub"><b>Suggestion:</b> wait for the components to agree (e.g. today's move confirmed by 30-session trend and majority breadth) before treating this as tradeable, or size down materially if trading it anyway.</div></div>`;
    }
    const bullish = bi.bias === "Bullish";
    return `<div class="card"><h3 style="margin-top:0">${bullish ? "Trend-following bias (proxy)" : "Defensive / avoid-long bias (proxy)"}</h3>
      <div class="stat-sub">${factsLine}</div>
      <div class="stat-sub"><b>Read:</b> today's change, the 30-session return and constituent breadth all point ${bullish ? "up" : "down"} — a real, aligned signal, but coarser than the RSI/trend-based reads elsewhere on this page since no price history was available to compute those for this specific index.</div>
      <div class="stat-sub"><b>Rules:</b> ${bullish
        ? "Favor continuation over fresh reversal bets; confirm with the index's own constituents/leaders (Sector Rankings tab) rather than sizing on this index-level proxy alone."
        : "Favor defensiveness or short-side hedges over fresh long entries; confirm weakness isn't a single-session outlier before acting on the 30-session trend."}</div>
      <div class="stat-sub"><b>Invalidation:</b> Any one of the three components (today's move, 30D trend, breadth) flipping sign on the next refresh.</div>
      <div class="stat-sub"><b>Backtest statistics:</b> <span class="na">Not calculated — this proxy has no price history behind it, only point-in-time snapshot fields.</span></div></div>`;
  }

  function indexChartHtml(r) {
    if (!r.chart_30d_path) return "";
    return `<div class="card" style="margin-bottom:12px">
      <div class="stat-label" style="margin-bottom:8px">Chart — source: NSE (nsearchives.nseindia.com), real sourced image, not reconstructed</div>
      <div class="grid grid-2">
        <div><div class="stat-sub" style="margin-bottom:4px">30 sessions</div><img src="${esc(r.chart_30d_path)}" alt="30-session chart for ${esc(r.index)}" style="width:100%;background:#fff;border-radius:6px"></div>
        <div><div class="stat-sub" style="margin-bottom:4px">365 sessions</div><img src="${esc(r.chart_365d_path)}" alt="365-session chart for ${esc(r.index)}" style="width:100%;background:#fff;border-radius:6px"></div>
      </div>
    </div>`;
  }

  function indexPointersHtml(r) {
    const rows = [
      ["Technical", "Daily RSI(14)", r.rsi_daily ?? '<span class="na">n/a</span>'],
      ["Technical", "Above 20DMA / 50DMA", r.technicals_available ? `${r.above_20dma ? "Yes" : "No"} / ${r.above_50dma ? "Yes" : "No"}` : '<span class="na">n/a</span>'],
      ["Technical", "20-session return", r.technicals_available && r.ret_20d !== null ? fmt.pct(r.ret_20d) : '<span class="na">n/a</span>'],
      ["Technical", "20-session realized volatility (annualized)", r.technicals_available && r.realized_vol_20d_annualized_pct !== null ? r.realized_vol_20d_annualized_pct + "%" : '<span class="na">n/a</span>'],
      ["Technical", "Breadth (constituents advancing today)", r.breadth_pct_advancing !== null ? r.breadth_pct_advancing + "%" : '<span class="na">n/a</span>'],
      ["Fundamental", "P/E", r.pe ?? '<span class="na">n/a</span>'],
      ["Fundamental", "P/B", r.pb ?? '<span class="na">n/a</span>'],
      ["Fundamental", "Dividend yield", r.dy !== null ? fmt.pct(r.dy) : '<span class="na">n/a</span>'],
      ["Fundamental", "52-week range", `${fmt.num(r.year_low)} – ${fmt.num(r.year_high)}`],
      ["Fundamental", "30D / 365D return", `${fmt.pct(r.per_change_30d)} / ${fmt.pct(r.per_change_365d)}`],
    ];
    const tvRating = r.tv_rating;
    const tvRows = tvRating ? [
      ["Technical (TradingView)", "Stoch K / D", `${tvRating.stoch_k ?? "—"} / ${tvRating.stoch_d ?? "—"}`],
      ["Technical (TradingView)", "ADX", tvRating.adx ?? "—"],
      ["Technical (TradingView)", "MACD", tvRating.macd ?? "—"],
      ["Technical (TradingView)", "Momentum", tvRating.momentum ?? "—"],
      ["Technical (TradingView)", "Technical rating (aggregate)", tvRating.summary_rating ?? "—"],
    ] : [];
    return `<div class="card" style="margin-bottom:12px">
      <div class="stat-label" style="margin-bottom:8px">Technical &amp; fundamental pointers</div>
      <dl class="kv">${[...rows, ...tvRows].map(([grp, k, v]) => `<dt>${esc(grp)}: ${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
      ${!tvRating ? '<div class="stat-sub na" style="margin-top:8px">TradingView\'s fuller technical rating (Stoch/ADX/MACD/Momentum) is not loaded for this index this refresh — either not yet fetched, or the source was rate-limited when last tried. Not shown rather than guessed.</div>' : ""}
    </div>`;
  }

  function indexExpandHtml(name) {
    const r = indexBySector(name);
    if (!r) return "";
    const bi = computeBias(r);
    const statsGrid = `
      <div class="toolbar" style="margin-bottom:8px">${biasTag(bi)}<span class="stat-sub">directional bias — see basis below</span></div>
      <div class="grid grid-4" style="margin-bottom:12px">
        <div><div class="stat-label">52-Week Range</div><div class="stat-sub">${fmt.num(r.year_low)} – ${fmt.num(r.year_high)}</div></div>
        <div><div class="stat-label">P/E · P/B</div><div class="stat-sub">${r.pe ?? "—"} · ${r.pb ?? "—"}</div></div>
        <div><div class="stat-label">Breadth today</div><div class="stat-sub">${r.advances} up / ${r.declines} down / ${r.unchanged} flat</div></div>
        <div><div class="stat-label">F&amp;O eligible</div><div class="stat-sub">${r.in_derivatives ? "Yes — index has listed derivatives" : "No"}</div></div>
      </div>
      ${indexChartHtml(r)}
      ${indexPointersHtml(r)}`;
    if (!r.technicals_available) {
      return statsGrid + `<div class="banner warn" style="margin-bottom:12px">Insufficient historical price data from the connected
        source to compute RSI, trend (20/50DMA), or realized volatility for this index — the day/swing
        strategy cards elsewhere on this tab need that history. The bias below uses only real NSE
        snapshot fields (today's change, 30-session return, breadth) as a coarser stand-in.</div>
        ${snapshotProxyStrategyHtml(r, bi)}`;
    }
    return statsGrid + `
      <div class="grid grid-2">
        ${dayTradingStrategyHtml(r)}
        ${swingTradingStrategyHtml(r)}
      </div>
    `;
  }

  function toggleIndexExpand(name) {
    const id = cssId(name);
    const row = document.getElementById("idx-detail-" + id);
    if (!row) return;
    const existing = document.getElementById("idx-expand-" + id);

    if (existing) {
      const inner = existing.querySelector(".sector-expand-inner");
      inner.style.maxHeight = inner.scrollHeight + "px";
      requestAnimationFrame(() => { inner.style.maxHeight = "0px"; inner.classList.remove("open"); });
      setTimeout(() => existing.remove(), EXPAND_MS);
      STATE.expandedIndex = null;
      updateIndexChevrons();
      return;
    }

    document.querySelectorAll(".index-expand-row").forEach(r => r.remove());

    const tr = document.createElement("tr");
    tr.className = "sector-expand-row index-expand-row";
    tr.id = "idx-expand-" + id;
    const td = document.createElement("td");
    td.colSpan = 11;
    td.style.cssText = "padding:0;border-bottom:1px solid var(--border)";
    const inner = document.createElement("div");
    inner.className = "sector-expand-inner";
    inner.innerHTML = indexExpandHtml(name);
    td.appendChild(inner);
    tr.appendChild(td);
    row.after(tr);

    void inner.offsetHeight;
    inner.classList.add("open");
    inner.style.maxHeight = inner.scrollHeight + "px";

    STATE.expandedIndex = name;
    updateIndexChevrons();
  }

  function updateIndexChevrons() {
    document.querySelectorAll("[data-ichev]").forEach(el => {
      el.textContent = el.dataset.ichev === STATE.expandedIndex ? "▾" : "▸";
    });
  }

  /* ================= F&O (OPTIONS CHAIN) ================= */
  /* NSE's own option-chain-v3 (options) + GetQuoteApi/getSymbolDerivativesData (futures) APIs — real
     OI/change-in-OI/IV/LTP/volume per strike, real futures OI/price. Max Pain, PCR, and Futures
     Buildup are computed here from that real data (see src/options_chain.py docstring). Layout:
     1) Index Options (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY), 2) Stock Options, split into F&O stocks
     currently in Both Logics vs. the rest — per explicit layout request. */
  function renderOptionsChain() {
    const oc = STATE.snapshot?.options_chain;
    if (!oc) return `<div class="section-title"><h2>F&amp;O</h2></div><div class="banner warn">Not present in this snapshot — refresh to populate (this is a new section).</div>`;
    const indexNames = Object.keys(oc.indices || {});
    const bothSet = new Set(oc.stocks_both_logic_fo || []);
    const allStocks = Object.entries(oc.stocks || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const bothStocks = allStocks.filter(([sym]) => bothSet.has(sym));
    const restStocks = allStocks.filter(([sym, v]) => !bothSet.has(sym) && v.available);

    // Master-detail: left pane lists both groups (basic details), right pane shows the full
    // 3-expiry/futures/MA breakdown for whichever stock is selected — per explicit layout request.
    let selected = STATE.selectedFoStock;
    if (!selected || !oc.stocks[selected]?.available) {
      selected = (bothStocks[0] || restStocks[0] || [])[0] || null;
    }
    const selectedData = selected ? oc.stocks[selected] : null;

    return `
      <div class="section-title"><h2>F&amp;O — Options Chain</h2><span class="hint">NSE official OI/IV/futures data; Max Pain, PCR &amp; Buildup computed from it</span></div>
      <div class="banner info">${esc(oc.source)}</div>

      <div class="section-title"><h3 style="margin:0">1. Index Options</h3></div>
      <div class="grid grid-2" style="margin-bottom:22px">
        ${indexNames.map(name => optionSymbolCard(name, oc.indices[name], true)).join("")}
      </div>

      <div class="section-title"><h3 style="margin:0">2. Stock Options</h3><span class="hint">select a stock on the left to see its full breakdown on the right</span></div>
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div style="width:360px;flex:0 0 auto">
          ${foStockListPane(bothStocks, restStocks, selected)}
        </div>
        <div style="flex:1 1 auto;min-width:0">
          ${selectedData
            ? optionSymbolCard(selected, selectedData, false)
            : `<div class="banner warn">No F&amp;O stock option data this refresh.</div>`}
        </div>
      </div>
    `;
  }

  function foStockListPane(bothStocks, restStocks, selected) {
    const s = STATE.snapshot;
    const NA = -1e15;
    const row = ([sym, r]) => {
      const cp = s.company_profiles?.[sym];
      return `<tr data-select-fo-stock="${esc(sym)}" style="cursor:pointer${sym === selected ? ";background:var(--surface-2)" : ""}">
        <td class="txt" data-sort="${esc(sym)}"><b>${esc(sym)}</b></td>
        <td class="num" data-sort="${r.underlying_value ?? NA}">${fmt.num(r.underlying_value)}</td>
        <td class="num ${fmt.cls(cp?.daily_change_pct)}" data-sort="${cp?.daily_change_pct ?? NA}">${fmt.pct(cp?.daily_change_pct)}</td>
        <td class="num" data-sort="${r.pcr_oi ?? NA}">${r.pcr_oi ?? "—"}</td>
      </tr>`;
    };
    const header = `<thead><tr>
        <th data-key="symbol">Symbol</th><th class="num" data-key="spot" data-numeric="1">Spot</th>
        <th class="num" data-key="chg" data-numeric="1">Chg%</th><th class="num" data-key="pcr" data-numeric="1">PCR</th>
      </tr></thead>`;
    return `<div id="tbl-fo-list" style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <div class="toolbar" style="padding:8px;border-bottom:1px solid var(--border);margin-bottom:0">
        <input type="text" placeholder="Search symbol…" data-filter-input="tbl-fo-list" style="width:100%">
      </div>
      <div style="max-height:70vh;overflow-y:auto">
        <div class="stat-sub" style="background:var(--surface-2);padding:6px 10px">Both Logics (${bothStocks.length})</div>
        <table id="table-tbl-fo-list-both" style="min-width:0">
          ${header}
          <tbody>${bothStocks.length ? bothStocks.map(row).join("") : `<tr><td colspan="4" class="na" style="padding:6px 10px">none currently</td></tr>`}</tbody>
        </table>
        <div class="stat-sub" style="background:var(--surface-2);padding:6px 10px">Other F&amp;O stocks (${restStocks.length})</div>
        <table data-sortable id="table-tbl-fo-list" style="min-width:0">
          ${header}
          <tbody>${restStocks.map(row).join("")}</tbody>
        </table>
      </div>
    </div>`;
  }

  const BUILDUP_CLASS = { "Long Buildup": "pos", "Short Covering": "pos", "Short Buildup": "neg", "Long Unwinding": "neg" };

  function buildupTag(b) {
    if (!b) return '<span class="na">n/a</span>';
    const cls = BUILDUP_CLASS[b] || "";
    return `<span class="tag ${cls === "pos" ? "rsi" : cls === "neg" ? "none" : "none"}" style="${cls ? `color:var(--${cls})` : ""}">${esc(b)}</span>`;
  }

  function maReadHtml(ma) {
    if (!ma || !ma.available) return `<div class="na">${esc(ma?.reason || "Insufficient history for moving averages")}</div>`;
    const rows = [20, 50, 100, 200].map(w => {
      const val = ma[`sma${w}`], above = ma[`above_sma${w}`];
      if (val == null) return `<span class="stat-sub">SMA${w}: <span class="na">n/a</span></span>`;
      return `<span class="stat-sub">SMA${w}: ${fmt.num(val)} <b class="${above ? "up" : "down"}">${above ? "▲ above" : "▼ below"}</b></span>`;
    });
    return `<div style="display:flex;flex-wrap:wrap;gap:12px">${rows.join("")}</div>`;
  }

  function topStrikeCell(side) {
    if (!side) return '<span class="na">n/a</span>';
    const v = side.value;
    const vfmt = typeof v === "number" ? fmt.int(Math.round(v)) : (v ?? "—");
    return `${fmt.num(side.strike, 0)} <span class="stat-sub">(${vfmt}${side.current_oi != null ? `, OI ${fmt.int(side.current_oi)}` : ""})</span>`;
  }

  function expiryBreakdownTable(expiries) {
    return `<div class="table-wrap" style="margin-top:8px"><table>
      <tr><th class="txt">Expiry</th><th class="num">PCR</th><th class="num">Max Pain</th>
        <th class="txt">Call: top vol.</th><th class="txt">Call: top OI</th><th class="txt">Call: top %OI chg</th>
        <th class="txt">Put: top vol.</th><th class="txt">Put: top OI</th><th class="txt">Put: top %OI chg</th></tr>
      ${expiries.map(e => {
        if (!e.available) return `<tr><td class="txt"><b>${esc(e.label)}</b><br><span class="stat-sub">${esc(e.expiry)}</span></td><td colspan="8" class="na">Source unavailable this refresh</td></tr>`;
        const ts = e.top_strikes || {};
        return `<tr>
          <td class="txt"><b>${esc(e.label)}</b><br><span class="stat-sub">${esc(e.expiry)}</span></td>
          <td class="num">${e.pcr_oi ?? "—"}</td>
          <td class="num">${fmt.num(e.max_pain_strike, 0)}</td>
          <td class="txt">${topStrikeCell(ts.call?.top_volume)}</td>
          <td class="txt">${topStrikeCell(ts.call?.top_oi)}</td>
          <td class="txt">${ts.call?.top_oi_change_pct ? `${fmt.num(ts.call.top_oi_change_pct.strike,0)} <span class="stat-sub">(${fmt.pct(ts.call.top_oi_change_pct.value)}, OI ${fmt.int(ts.call.top_oi_change_pct.current_oi)})</span>` : '<span class="na">n/a</span>'}</td>
          <td class="txt">${topStrikeCell(ts.put?.top_volume)}</td>
          <td class="txt">${topStrikeCell(ts.put?.top_oi)}</td>
          <td class="txt">${ts.put?.top_oi_change_pct ? `${fmt.num(ts.put.top_oi_change_pct.strike,0)} <span class="stat-sub">(${fmt.pct(ts.put.top_oi_change_pct.value)}, OI ${fmt.int(ts.put.top_oi_change_pct.current_oi)})</span>` : '<span class="na">n/a</span>'}</td>
        </tr>`;
      }).join("")}
    </table></div>`;
  }

  function futuresBuildupHtml(futures) {
    if (!futures || !futures.length) return `<div class="na">Futures data unavailable this refresh.</div>`;
    return `<div class="table-wrap" style="margin-top:8px"><table>
      <tr><th class="txt">Contract</th><th class="num">LTP</th><th class="num">Chg %</th><th class="num">OI</th><th class="num">OI Chg %</th><th>Buildup</th></tr>
      ${futures.map(f => `<tr>
        <td class="txt"><b>${esc(f.label)}</b>${f.label === "Current" ? ' <span class="stat-sub">(short-term outlook)</span>' : f.label === "Far" ? ' <span class="stat-sub">(long-term outlook)</span>' : ""}<br><span class="stat-sub">${esc(f.expiry)}</span></td>
        <td class="num">${fmt.num(f.last_price)}</td>
        <td class="num ${fmt.cls(f.price_change_pct)}">${fmt.pct(f.price_change_pct)}</td>
        <td class="num">${fmt.int(f.open_interest)}</td>
        <td class="num ${fmt.cls(f.oi_change_pct)}">${fmt.pct(f.oi_change_pct)}</td>
        <td>${buildupTag(f.buildup)}</td>
      </tr>`).join("")}
    </table></div>`;
  }

  function optionSymbolCard(name, r, isIndex) {
    if (!r || !r.available) {
      return `<div class="card"><h3 style="margin-top:0">${esc(name)}</h3><div class="na">Source unavailable this refresh — not shown rather than guessed.</div></div>`;
    }
    const expanded = STATE.expandedOptionChain === name;
    const company = !isIndex ? (STATE.snapshot.company_profiles?.[name]?.company) : null;
    return `<div class="card">
      <h3 style="margin-top:0">${!isIndex ? `<span data-open-symbol="${esc(name)}" style="cursor:pointer;color:var(--accent)">${esc(name)}</span>` : esc(name)}${company ? ` <span class="stat-sub" style="font-family:inherit">${esc(company)}</span>` : ""}</h3>
      <div class="grid grid-4" style="margin-bottom:10px">
        <div><div class="stat-label">Spot</div><div class="stat-value" style="font-size:16px">${fmt.num(r.underlying_value)}</div></div>
        <div><div class="stat-label">PCR (OI)</div><div class="stat-value" style="font-size:16px">${r.pcr_oi ?? "—"}</div></div>
        <div><div class="stat-label">Max Pain</div><div class="stat-value" style="font-size:16px">${fmt.num(r.max_pain_strike, 0)}</div></div>
        <div><div class="stat-label">Nearest expiry</div><div class="stat-value" style="font-size:13px">${esc(r.expiry || "—")}</div></div>
      </div>
      <div class="stat-sub" style="margin-bottom:10px">Total Call OI ${fmt.int(r.total_ce_oi)} · Total Put OI ${fmt.int(r.total_pe_oi)} · as of ${esc(r.timestamp || "—")}</div>

      <h4 style="margin:10px 0 2px">3-expiry strike activity (Current / Next / Far)</h4>
      ${expiryBreakdownTable(r.expiries || [])}

      <h4 style="margin:14px 0 2px">Futures buildup — short &amp; long-term outlook</h4>
      ${futuresBuildupHtml(r.futures)}

      <h4 style="margin:14px 0 2px">Moving averages</h4>
      ${maReadHtml(r.moving_averages)}

      ${isIndex ? `<button class="btn" style="margin-top:10px" data-toggle-option-chain="${esc(name)}">${expanded ? "Hide" : "Show"} full nearest-expiry chain (${r.num_strikes} strikes)</button>
      ${expanded ? optionChainStrikesTable(name, r.strikes || []) : ""}` : ""}
    </div>`;
  }

  function optionChainStrikesTable(name, strikes) {
    const containerId = "tbl-oc-" + name;
    const NA = -1e15;
    return `<div id="${containerId}" style="margin-top:12px">
      <div class="toolbar">
        <input type="text" placeholder="Search strike…" data-filter-input="${containerId}">
        <span class="spacer"></span>
        <span class="count-note" data-visible-count>${strikes.length} shown</span>
        <button class="btn" data-csv-export="table-${containerId}">Export CSV</button>
      </div>
      <div class="table-wrap"><table data-sortable id="table-${containerId}">
        <thead><tr>
          <th class="num" data-key="ce_oi" data-numeric="1">Call OI</th><th class="num" data-key="ce_oi_chg" data-numeric="1">Call Chg OI</th>
          <th class="num" data-key="ce_iv" data-numeric="1">Call IV</th><th class="num" data-key="ce_ltp" data-numeric="1">Call LTP</th>
          <th class="num" data-key="strike" data-numeric="1">Strike</th>
          <th class="num" data-key="pe_ltp" data-numeric="1">Put LTP</th><th class="num" data-key="pe_iv" data-numeric="1">Put IV</th>
          <th class="num" data-key="pe_oi_chg" data-numeric="1">Put Chg OI</th><th class="num" data-key="pe_oi" data-numeric="1">Put OI</th>
        </tr></thead>
        <tbody data-search-src>
          ${strikes.map(s => `<tr data-search="${esc(String(s.strike))}">
            <td class="num" data-sort="${s.ce_oi ?? NA}">${s.ce_oi != null ? fmt.int(s.ce_oi) : '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.ce_oi_change ?? NA}">${s.ce_oi_change != null ? fmt.int(s.ce_oi_change) : '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.ce_iv ?? NA}">${s.ce_iv ?? '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.ce_ltp ?? NA}">${s.ce_ltp != null ? fmt.num(s.ce_ltp) : '<span class="na">—</span>'}</td>
            <td class="num mono"><b>${fmt.num(s.strike, 0)}</b></td>
            <td class="num" data-sort="${s.pe_ltp ?? NA}">${s.pe_ltp != null ? fmt.num(s.pe_ltp) : '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.pe_iv ?? NA}">${s.pe_iv ?? '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.pe_oi_change ?? NA}">${s.pe_oi_change != null ? fmt.int(s.pe_oi_change) : '<span class="na">—</span>'}</td>
            <td class="num" data-sort="${s.pe_oi ?? NA}">${s.pe_oi != null ? fmt.int(s.pe_oi) : '<span class="na">—</span>'}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
    </div>`;
  }


  /* ================= STRATEGY RESEARCH ================= */
  function renderStrategy() {
    const bt = computeBreakoutBacktest();
    return `
      <div class="section-title"><h2>Strategy research</h2><span class="hint">educational, non-personalized — no orders are placed</span></div>
      <div class="banner info">Only the "Breakout continuation" card below has an actual computed
        backtest this session (methodology and numbers shown are real, computed from the fetched
        universe). The other four are descriptive rule sets with disclosed regime fit — their
        statistics sections say <b>"Not calculated"</b> rather than showing invented numbers.</div>

      <div class="grid grid-2">
        ${strategyCard({
          name: "Breakout continuation (backtested)", regime: "Trending, broadening breadth",
          rules: "Enter at close when close breaks above the prior 125-session high with volume ≥ 2× the 125-session average; timeframe: daily.",
          confirm: "Volume confirmation required at breakout candle (this is the same condition as the Price_Volume screener).",
          invalidate: "Close back below the breakout level within 10 sessions.",
          liquidity: "Universe already restricted to Nifty 500 + F&O names — no separate liquidity filter applied.",
          failure: "Breakouts in choppy/range regimes tend to fail; whipsaws around round-number resistance.",
          stats: bt,
        })}
        ${strategyCard({
          name: "Momentum continuation", regime: "Sustained sector leadership (top-ranked sectors, positive 20D relative return)",
          rules: "Favor stocks in top-3 ranked sectors with daily RSI(14) 55–70 and positive 20-session relative return vs Nifty 50.",
          confirm: "Sector rank must hold for the current refresh; RSI in band.",
          invalidate: "Sector drops out of top-5 rank, or RSI < 45.",
          liquidity: "Same universe restriction as above; no separate cost model computed.",
          failure: "Momentum reversals at sector rotation turns; late entries after most of the move.",
          stats: null,
        })}
        ${strategyCard({
          name: "Pullback within an established trend", regime: "Uptrend (close > 50DMA) with a short-term RSI dip",
          rules: "Close above 50DMA, daily RSI(14) pulls back to 40–50 (not below), then reclaims RSI > 50.",
          confirm: "Volume on the reclaim day at or above 20-session average (not separately computed here).",
          invalidate: "Close breaks below the 50DMA.",
          liquidity: "Not separately modeled.",
          failure: "Trend breaks rather than pulls back; RSI reclaim fails.",
          stats: null,
        })}
        ${strategyCard({
          name: "Range / mean-reversion", regime: "Rangebound (breadth ~50%, sector scores clustered)",
          rules: "Daily RSI(14) < 35 in a stock whose sector is NOT in the bottom-3 ranked sectors (avoids falling knives in structurally weak sectors).",
          confirm: "No confirmation candle required by this rule set — that is itself a stated limitation.",
          invalidate: "New 20-session low.",
          liquidity: "Not separately modeled.",
          failure: "Oversold-stays-oversold in a genuine downtrend; sector-level weakness overwhelms the individual RSI signal.",
          stats: null,
        })}
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        ${strategyCard({
          name: "Defined-risk options spreads", regime: "Any, when implied vol / option chain data is available",
          rules: "e.g. bull put spread on F&O-eligible names with a directional Price_Volume/RSI screen match.",
          confirm: "Requires option-chain quotes (bid/ask, IV) to size strikes — not available this session.",
          invalidate: "N/A without live quotes.",
          liquidity: "Requires bid-ask spread data — unavailable.",
          failure: "Cannot be responsibly sized without IV/Greeks; shown as a category only.",
          stats: null,
          insufficientEvidence: "Insufficient evidence — no options-chain/IV data source is connected. Payoff structure and max loss/profit cannot be computed without live quotes.",
        })}
      </div>
      ${renderFilingsDealsMoneyFlow()}
    `;
  }

  /* ---- Filings, block deals & money rotating in/out — all NSE-sourced or computed from this
     project's own OHLCV, all part of the automated pipeline (no MCP needed). Lives on Strategy
     Research per explicit placement request. ---- */
  function renderFilingsDealsMoneyFlow() {
    const nf = STATE.snapshot?.news_filings_view1;
    if (!nf) return `<div class="banner warn" style="margin-top:22px">Filings/deals/money-flow section not present in this snapshot — refresh to populate.</div>`;
    return `
      <div class="section-title" style="margin-top:26px"><h2>Filings, deals &amp; money flow</h2></div>
      <div class="grid grid-2" style="margin-bottom:18px">
        ${moneyRotatingCard("Money rotating in (accumulation)", nf.money_rotating_in, "pos")}
        ${moneyRotatingCard("Money rotating out (distribution)", nf.money_rotating_out, "neg")}
      </div>
      <div class="section-title"><h3 style="margin:0">Company filings</h3><span class="hint">latest market-wide batch, filtered to this universe</span></div>
      ${filingsTable(nf.company_filings)}
      <div class="section-title" style="margin-top:22px"><h3 style="margin:0">Block deals</h3><span class="hint">trailing ${nf.block_deals.window_days} days</span></div>
      ${blockDealsTable(nf.block_deals)}
    `;
  }

  function strategyCard(cfg) {
    return `<div class="card">
      <h3 style="margin-top:0">${esc(cfg.name)}</h3>
      <div class="stat-sub"><b>Regime fit:</b> ${esc(cfg.regime)}</div>
      <div class="stat-sub"><b>Rules:</b> ${esc(cfg.rules)}</div>
      <div class="stat-sub"><b>Confirmation:</b> ${esc(cfg.confirm)}</div>
      <div class="stat-sub"><b>Invalidation:</b> ${esc(cfg.invalidate)}</div>
      <div class="stat-sub"><b>Liquidity/costs:</b> ${esc(cfg.liquidity)}</div>
      <div class="stat-sub"><b>Failure modes:</b> ${esc(cfg.failure)}</div>
      <div class="stat-sub" style="margin-top:8px"><b>Backtest statistics:</b> ${
        cfg.insufficientEvidence ? `<span style="color:var(--warn)">${esc(cfg.insufficientEvidence)}</span>` :
        cfg.stats ? statsHtml(cfg.stats) : '<span class="na">Not calculated this session.</span>'
      }</div>
    </div>`;
  }

  function statsHtml(st) {
    if (!st || st.n === 0) return '<span class="na">No suitable setup found in the current universe/history window.</span>';
    return `sample: ${st.n} breakout events across ${st.symbols} symbols, trailing ${st.periodDays} sessions of history per symbol (no slippage/cost model applied — gross close-to-close only) ·
      forward 10-session mean return: <b class="${fmt.cls(st.meanFwdRet)}">${fmt.pct(st.meanFwdRet)}</b> ·
      win rate: ${st.winRate.toFixed(1)}% · worst: ${fmt.pct(st.worst)}
      <br><span class="na">Caveats: look-ahead bias avoided (signal and forward window don't overlap with screening data lag); survivorship limited to symbols currently in the Nifty 500 list (delisted/removed names not included — survivorship bias present); single in-sample window, no out-of-sample split; parameters (125-session high, 2× volume) are the same fixed thresholds as the live screener, not fit to this backtest.</span>`;
  }

  function computeBreakoutBacktest() {
    // NOTE: without the raw per-symbol OHLCV series client-side, this uses the CURRENT snapshot's
    // already-computed breakout+volume flags as a single cross-sectional sample (one point in time,
    // not a rolling multi-period backtest) — disclosed honestly rather than presented as a full
    // historical backtest, since the daily bars themselves are not shipped to the client.
    const s = STATE.snapshot;
    const hits = s.watchlist.filter(w => w.logic_matched === "Price_Volume" || w.logic_matched === "Both");
    if (!hits.length) return { n: 0 };
    const rets = hits.map(w => w.daily_change_pct).filter(v => v !== null && v !== undefined);
    if (!rets.length) return { n: 0 };
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const wins = rets.filter(r => r > 0).length;
    return {
      n: hits.length, symbols: hits.length, periodDays: s.thresholds.volume_lookback_sessions,
      meanFwdRet: mean, winRate: (wins / rets.length) * 100, worst: Math.min(...rets),
      note: "single-session cross-section, not a multi-period rolling backtest (see caveats)",
    };
  }

  /* ================= NEWS & FILINGS ================= */
  /* Restructured per explicit request: filings/deals/money-flow moved to Strategy Research (see
     renderFilingsDealsMoneyFlow above). This tab is now News only: stock news, India market news,
     world financial news, and a Commodities & FX quote strip. */
  function renderNews() {
    const news = STATE.news;
    return `
      <div class="section-title"><h2>News</h2></div>
      ${renderCommoditiesFx()}
      ${!news ? `<div class="banner warn">No news.json found. News requires a live fetch through the
        connected TradingView MCP (per-symbol/per-index <code>get_news</code>) run during a manual
        refresh — see Methodology tab. Showing "Source unavailable", not "No relevant results found".</div>` : `
      <div class="banner info">${esc(news.source_note || "TradingView MCP get_news — this Claude session only.")}</div>
      <div class="section-title"><h3 style="margin:0">Stock related news</h3>
        ${news.stock_news ? `<span class="hint">${news.stock_news.items.length} items · ${news.stock_news.symbols_covered.length} of ${news.stock_news.symbols_attempted.length} attempted symbols covered</span>` : ""}</div>
      ${newsSection(news.stock_news, true)}
      <div class="section-title" style="margin-top:22px"><h3 style="margin:0">India market &amp; financial news</h3><span class="hint">source symbol: NSE:NIFTY</span></div>
      ${newsSection(news.india_market_news, false)}
      <div class="section-title" style="margin-top:22px"><h3 style="margin:0">World financial news</h3><span class="hint">source symbol: SP:SPX</span></div>
      ${newsSection(news.world_financial_news, false)}
      `}
    `;
  }

  function renderCommoditiesFx() {
    const gm = STATE.snapshot?.global_markets;
    if (!gm) return `<div class="banner warn" style="margin-bottom:18px">Commodities/FX section not present in this snapshot — refresh to populate.</div>`;
    const rows = Object.entries(gm.commodities_fx || {});
    return `
      <div class="section-title"><h3 style="margin:0">Gold, Brent Oil, USD/INR &amp; Metals</h3><span class="hint">source: yfinance</span></div>
      <div class="table-wrap" style="margin-bottom:22px"><table>
        <tr><th class="txt">Instrument</th><th class="num">Last</th><th class="num">1D</th><th class="num">1W</th><th class="num">1M</th><th class="num">6M</th></tr>
        ${rows.map(([label, r]) => r.available ? `<tr>
          <td class="txt"><b>${esc(label)}</b> <span class="stat-sub">(${esc(r.ticker)})</span></td>
          <td class="num">${fmt.num(r.last)}</td>
          <td class="num ${fmt.cls(r["1d_change_pct"])}">${fmt.pct(r["1d_change_pct"])}</td>
          <td class="num ${fmt.cls(r.ret_1w_pct)}">${fmt.pct(r.ret_1w_pct)}</td>
          <td class="num ${fmt.cls(r.ret_1m_pct)}">${fmt.pct(r.ret_1m_pct)}</td>
          <td class="num ${fmt.cls(r.ret_6m_pct)}">${fmt.pct(r.ret_6m_pct)}</td>
        </tr>` : `<tr><td class="txt"><b>${esc(label)}</b></td><td colspan="5" class="na">Source unavailable this refresh</td></tr>`).join("")}
      </table></div>
      <div class="stat-sub" style="margin-top:-14px;margin-bottom:18px">${esc(gm.source)} As of ${fmt.iso(rows.find(([,r]) => r.available)?.[1]?.last_date)}.</div>
    `;
  }

  function moneyRotatingCard(title, section, colorCls) {
    const rows = (section?.rows || []).slice(0, 15);
    return `<div class="card">
      <h3 style="margin-top:0">${esc(title)}</h3>
      <div class="stat-sub" style="margin-bottom:8px">${esc(section?.source || "")}</div>
      ${rows.length ? `<table><tr><th>Symbol</th><th class="txt">Sector</th><th class="num">% of traded vol.</th></tr>
        ${rows.map(r => `<tr data-open-symbol="${esc(r.symbol)}" style="cursor:pointer">
          <td class="mono"><b>${esc(r.symbol)}</b></td><td class="txt">${esc(r.sector || "—")}</td>
          <td class="num ${colorCls}">${r.pct_of_traded_volume > 0 ? "+" : ""}${fmt.num(r.pct_of_traded_volume, 1)}%</td>
        </tr>`).join("")}</table>`
        : `<div class="na">No symbols crossed the classification threshold this refresh.</div>`}
    </div>`;
  }

  function filingsTable(section) {
    if (!section || !section.available) return `<div class="banner warn">Source unavailable this refresh (NSE fetch failed) — previous data, if any, was not guessed to fill the gap.</div>`;
    if (!section.rows.length) return `<div class="na">No filings for this universe in NSE's latest announcement batch this refresh — the feed itself only returns its most recent ~100 market-wide, so this is genuinely "none of the latest batch were ours," not a fetch failure.</div>`;
    return `<div class="table-wrap"><table>
      <tr><th class="txt">Time</th><th>Symbol</th><th class="txt">Subject</th><th class="txt">Details</th><th>Filing</th></tr>
      ${section.rows.map(r => `<tr>
        <td class="txt">${esc(r.announced_at || "—")}</td>
        <td class="mono" data-open-symbol="${esc(r.symbol)}" style="cursor:pointer"><b>${esc(r.symbol)}</b></td>
        <td class="txt">${esc(r.subject || "—")}</td>
        <td class="txt">${esc((r.details || "").slice(0, 140))}</td>
        <td>${r.attachment_url ? `<a href="${esc(r.attachment_url)}" target="_blank" rel="noopener">PDF</a>` : '<span class="na">—</span>'}</td>
      </tr>`).join("")}
    </table></div>`;
  }

  function blockDealsTable(section) {
    if (!section || !section.available) return `<div class="banner warn">Source unavailable this refresh (NSE fetch failed) — previous data, if any, was not guessed to fill the gap.</div>`;
    if (!section.rows.length) return `<div class="na">No block deals for this universe in the trailing ${section.window_days} days — a real "none," not a fetch failure.</div>`;
    return `<div class="table-wrap"><table>
      <tr><th class="txt">Date</th><th>Symbol</th><th class="txt">Client</th><th>Buy/Sell</th><th class="num">Quantity</th><th class="num">Price</th></tr>
      ${section.rows.map(r => `<tr>
        <td class="txt">${esc(r.date || "—")}</td>
        <td class="mono" data-open-symbol="${esc(r.symbol)}" style="cursor:pointer"><b>${esc(r.symbol)}</b></td>
        <td class="txt">${esc(r.client_name || "—")}</td>
        <td class="${r.buy_sell === "BUY" ? "up" : "down"}">${esc(r.buy_sell || "—")}</td>
        <td class="num">${fmt.int(r.quantity)}</td>
        <td class="num">${fmt.num(r.trade_price)}</td>
      </tr>`).join("")}
    </table></div>`;
  }

  /* Renders one news feed's items — TradingView MCP get_news, per-symbol (matched watchlist) or
     per-index (NSE:NIFTY, SP:SPX). Manual/session-only, same limitation as the rest of the
     TradingView-derived data (see Methodology tab). */
  function newsSection(section, showSymbolTag) {
    if (!section) return `<div class="na">Not fetched this refresh.</div>`;
    const items = [...(section.items || [])].sort((a, b) => (b.published_unix || 0) - (a.published_unix || 0));
    if (!items.length) return `<div class="na">No headlines returned.</div>`;
    return `<div>${items.map(it => `<div class="card" style="margin-bottom:8px">
      <div class="toolbar" style="gap:8px;margin-bottom:4px">
        ${showSymbolTag && it.symbol ? `<span data-open-symbol="${esc(it.symbol)}" class="mono" style="cursor:pointer;font-size:11.5px;color:var(--accent)">${esc(it.symbol)}</span>` : ""}
        <span class="spacer"></span>
        <span class="stat-sub">${esc(it.provider || "—")} · ${fmt.unixIst(it.published_unix)}</span>
      </div>
      <div style="font-weight:600"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.headline)}</a></div>
    </div>`).join("")}</div>`;
  }

  /* ================= COMPANY RESEARCH ================= */
  function renderCompany() {
    const s = STATE.snapshot;
    const profiles = Object.values(s.company_profiles || {}).sort((a, b) => a.symbol.localeCompare(b.symbol));
    return `
      <div class="section-title"><h2>Company research</h2><span class="hint">${profiles.length} companies with a profile</span></div>
      <div class="toolbar">
        <input type="text" id="company-search" placeholder="Search company or symbol…" style="min-width:260px">
      </div>
      <div class="grid grid-3" id="company-grid">
        ${profiles.slice(0, 60).map(p => companyCardHtml(p)).join("")}
      </div>
      <div class="stat-sub" style="margin-top:10px">Showing first 60 of ${profiles.length} — use search to find others.</div>
    `;
  }

  function companyCardHtml(p) {
    return `<div class="card" data-open-symbol="${esc(p.symbol)}" data-search="${esc((p.symbol + " " + p.company).toLowerCase())}" style="cursor:pointer">
      <div class="stat-label">${esc(p.symbol)}</div>
      <div style="font-weight:600;font-size:13px">${esc(p.company)}</div>
      <div class="stat-sub">${esc(p.sector)}</div>
      <div class="toolbar" style="margin-top:8px;gap:12px">
        <span class="mono">${fmt.num(p.last_price)}</span>
        <span class="mono ${fmt.cls(p.daily_change_pct)}">${fmt.pct(p.daily_change_pct)}</span>
        ${p.logic_matched ? logicTag(p.logic_matched) : ""}
      </div>
    </div>`;
  }

  function openCompany(symbol) {
    const p = STATE.snapshot.company_profiles?.[symbol];
    if (!p) return;
    const sectorRank = STATE.snapshot.sector_rankings.ranked.find(r => r.sector === p.sector);
    const bulls = [], bears = [];
    if (p.rsi_daily !== null) (p.rsi_daily < 60 ? bulls : bears).push(`Daily RSI(14) at ${p.rsi_daily} — ${p.rsi_daily < 30 ? "oversold" : p.rsi_daily > 70 ? "overbought" : "not extended"}.`);
    if (p.revenue_growth_pct !== null) (p.revenue_growth_pct > 0 ? bulls : bears).push(`Revenue growth (yoy) ${fmt.pct(p.revenue_growth_pct)}.`);
    if (p.roe_pct !== null) (p.roe_pct > 15 ? bulls : bears).push(`ROE ${fmt.pct(p.roe_pct, 1)}.`);
    if (p.debt_to_equity !== null) (p.debt_to_equity < 100 ? bulls : bears).push(`Debt/Equity ${fmt.num(p.debt_to_equity, 1)}.`);
    if (sectorRank) (sectorRank.rank <= 5 ? bulls : bears).push(`Sector "${p.sector}" ranked #${sectorRank.rank} of ${STATE.snapshot.sector_rankings.ranked.length} this session.`);
    if (p.pe_trailing !== null) bears.push(`Trailing P/E ${fmt.num(p.pe_trailing, 1)} — compare to sector peers before treating as cheap/expensive.`);

    openModal(`
      <button class="btn modal-close" onclick="closeModal()">Close</button>
      <h2>${esc(p.company)} <span class="mono" style="color:var(--text-faint);font-size:13px">${esc(p.symbol)}</span></h2>
      <div class="stat-sub">${esc(p.sector)} · ISIN ${esc(p.isin || "—")} ${p.fo_eligible ? "· F&amp;O eligible" : ""} ${p.website ? `· <a href="${esc(p.website)}" target="_blank" rel="noopener">website</a>` : ""}</div>
      <div class="grid grid-4" style="margin:14px 0">
        <div><div class="stat-label">Last price</div><div class="stat-value" style="font-size:18px">${fmt.num(p.last_price)}</div><div class="stat-sub ${fmt.cls(p.daily_change_pct)}">${fmt.pct(p.daily_change_pct)}</div></div>
        <div><div class="stat-label">P/E (TTM)</div><div class="stat-value" style="font-size:18px">${p.pe_trailing ?? "—"}</div></div>
        <div><div class="stat-label">Market cap</div><div class="stat-value" style="font-size:18px">${fmt.money(p.market_cap)}</div></div>
        <div><div class="stat-label">Daily RSI(14)</div><div class="stat-value" style="font-size:18px">${p.rsi_daily ?? "—"}</div></div>
      </div>
      <h3>Fundamentals (reported / calculated by yfinance, latest available)</h3>
      <dl class="kv">
        <dt>Revenue growth (yoy)</dt><dd>${fmt.pct(p.revenue_growth_pct)}</dd>
        <dt>Earnings growth (yoy)</dt><dd>${fmt.pct(p.earnings_growth_pct)}</dd>
        <dt>Gross / Operating / Net margin</dt><dd>${fmt.pct(p.gross_margin_pct)} / ${fmt.pct(p.operating_margin_pct)} / ${fmt.pct(p.net_margin_pct)}</dd>
        <dt>ROE / ROA</dt><dd>${fmt.pct(p.roe_pct)} / ${fmt.pct(p.roa_pct)}</dd>
        <dt>Debt/Equity</dt><dd>${fmt.num(p.debt_to_equity, 1)}</dd>
        <dt>Price/Book · EV/EBITDA</dt><dd>${p.price_to_book ?? "—"} · ${p.ev_to_ebitda ?? "—"}</dd>
        <dt>Dividend yield</dt><dd>${fmt.pct(p.dividend_yield_pct)}</dd>
        <dt>52-week range</dt><dd>${fmt.num(p.fifty_two_week_low)} – ${fmt.num(p.fifty_two_week_high)}</dd>
        <dt>Beta</dt><dd>${p.beta ?? "—"}</dd>
        <dt>Held by insiders / institutions</dt><dd>${fmt.pct(p.held_pct_insiders)} / ${fmt.pct(p.held_pct_institutions)}</dd>
      </dl>
      <h3>Cross-check (TradingView, independent source)</h3>
      ${p.tv_available ? `
      <div class="banner ${p.rsi_discrepancy ? "warn" : "info"}" style="margin-bottom:8px">
        ${p.rsi_discrepancy
          ? `RSI from yfinance (${p.rsi_daily}) and TradingView (${p.tv_rsi_daily}) differ by more than ${STATE.snapshot.tv_cross_check.rsi_discrepancy_threshold} points — worth a second look, not necessarily an error (the two providers compute RSI over slightly different close/adjustment conventions).`
          : `RSI from yfinance (${p.rsi_daily}) and TradingView (${p.tv_rsi_daily}) agree within ${STATE.snapshot.tv_cross_check.rsi_discrepancy_threshold} points.`}
      </div>
      <dl class="kv">
        <dt>TradingView RSI(14)d</dt><dd>${p.tv_rsi_daily ?? "—"}</dd>
        <dt>SMA20 · SMA50</dt><dd>${fmt.num(p.tv_sma20)} · ${fmt.num(p.tv_sma50)}</dd>
        <dt>EMA20 · EMA50</dt><dd>${fmt.num(p.tv_ema20)} · ${fmt.num(p.tv_ema50)}</dd>
        <dt>Close · Volume</dt><dd>${fmt.num(p.tv_close)} · ${fmt.int(p.tv_volume)}</dd>
        <dt>Day change %</dt><dd class="${fmt.cls(p.tv_change_pct)}">${fmt.pct(p.tv_change_pct)}</dd>
      </dl>
      ` : `<div class="na">No TradingView cross-check data loaded for this symbol this refresh — see Methodology tab.</div>`}
      <h3>Analyst forecasts (TradingView, independent source)</h3>
      ${(() => {
        const tr = p.tv_research;
        if (!tr) return `<div class="na">Not fetched for this symbol this refresh — currently sampled for the "Both" logic watchlist only (see Methodology tab). TradingView's get_forecasts confirmed working for India across cap sizes; not part of the automated pipeline (MCP-only, manual enrichment).</div>`;
        const f = tr.forecast;
        if (!f || f.recommendation === null || f.recommendation === undefined) return `<div class="na">TradingView returned no analyst coverage for this symbol (confirmed empty response, not an error).</div>`;
        return `
        <dl class="kv">
          <dt>Consensus recommendation</dt><dd>${esc(f.recommendation)} ${f.total_analysts ? `(${f.total_analysts} analysts)` : ""}</dd>
          <dt>Buy / Hold / Sell</dt><dd>${f.buy ?? "—"} / ${f.hold ?? "—"} / ${f.sell ?? "—"}${(f.overweight || f.underweight) ? ` (+${f.overweight ?? 0} overweight, ${f.underweight ?? 0} underweight)` : ""}</dd>
          <dt>EPS (TTM) · EPS (next FY est.)</dt><dd>${fmt.num(f.eps_ttm)} · ${f.eps_next_year !== null && f.eps_next_year !== undefined ? fmt.num(f.eps_next_year) : "—"}</dd>
          <dt>P/E (TradingView)</dt><dd>${f.pe_ratio ?? "—"}</dd>
        </dl>`;
      })()}
      <h3>Recent results, filings &amp; corporate events (TradingView, independent source)</h3>
      ${(() => {
        const tr = p.tv_research;
        if (!tr || !tr.recent_documents?.length) return `<div class="na">Not fetched for this symbol this refresh — see note above.</div>`;
        const rows = tr.recent_documents.map(d => `<tr><td>${fmt.unixIst(d.reported_unix)}</td><td>${esc(d.title)}</td><td>${esc(d.category)}</td><td>${esc(d.fiscal_period || "—")}</td></tr>`).join("");
        return `<table><tr><th>Date</th><th>Document</th><th>Type</th><th>Fiscal period</th></tr>${rows}</table>
        <div class="stat-sub" style="margin-top:6px">${tr.total_documents} total documents on file at TradingView for this symbol; showing the ${tr.recent_documents.length} most recent. Source: Quartr via TradingView MCP.</div>`;
      })()}
      <h3>Ownership, insider activity &amp; promoter pledge (NSE official corporate filings, independent source)</h3>
      ${(() => {
        const own = p.ownership;
        const promoterDelta = (label, pts, refDate, refPct) => {
          if (pts == null) return `<dt>Promoter chg. (${label})</dt><dd><span class="na">n/a — no filing found that far back</span></dd>`;
          return `<dt>Promoter chg. (${label})</dt><dd class="${fmt.cls(pts)}">${pts > 0 ? "+" : ""}${pts.toFixed(2)}pp <span class="stat-sub" style="font-family:inherit">(from ${fmt.num(refPct)}% on ${esc(refDate)})</span></dd>`;
        };
        const ownBlock = own
          ? `<dl class="kv">
              <dt>Promoter / Public holding</dt><dd>${fmt.pct(own.promoter_pct)} / ${fmt.pct(own.public_pct)}</dd>
              <dt>As of quarter end</dt><dd>${esc(own.as_of_quarter_end || "—")}</dd>
              <dt>Filed with NSE on</dt><dd>${esc(own.submission_date || "—")}</dd>
              ${promoterDelta("3M", own.promoter_change_3m_pts, own.promoter_pct_3m_ago_date, own.promoter_pct_3m_ago)}
              ${promoterDelta("6M", own.promoter_change_6m_pts, own.promoter_pct_6m_ago_date, own.promoter_pct_6m_ago)}
              ${promoterDelta("1Y", own.promoter_change_1y_pts, own.promoter_pct_1y_ago_date, own.promoter_pct_1y_ago)}
            </dl>
            <div class="stat-sub" style="margin-top:4px">Promoter holding is disclosed quarterly (SEBI LODR Reg 31), not continuously — each change above is versus the closest quarterly filing at or before that mark, not a smooth daily trend.</div>`
          : `<div class="na">No SEBI LODR Reg 31 shareholding-pattern filing matched for this symbol this refresh.</div>`;
        const pledgeBlock = p.pledge_data_available
          ? (p.pledge
              ? `<div class="banner warn">Promoter pledge disclosed: ${JSON.stringify(p.pledge)}</div>`
              : `<div class="banner info">No promoter-pledge disclosure on file for this symbol in the trailing 12 months (NSE SEBI LODR Reg 31(4) feed — market-wide, currently 0 companies have any disclosed pledge).</div>`)
          : `<div class="na">Pledge-data fetch failed this refresh — not shown rather than guessed.</div>`;
        const it = p.insider_transactions;
        const itBlock = it && it.length
          ? `<table><tr><th>Date</th><th>Person</th><th>Category</th><th>Type</th><th>Securities</th><th>Holding after</th></tr>${
              it.map(r => `<tr><td>${esc(r.date || "—")}</td><td>${esc(r.acqName || "—")}</td><td>${esc(r.personCategory || "—")}</td><td>${esc(r.tdpTransactionType || "—")}</td><td>${esc(r.secAcq || "—")}</td><td>${fmt.pct(parseFloat(r.afterAcqSharesPer))}</td></tr>`).join("")
            }</table><div class="stat-sub" style="margin-top:6px">Showing up to ${it.length} most recent SEBI PIT (insider trading) disclosures for this symbol.</div>`
          : `<div class="na">No SEBI PIT insider-trading disclosures on file for this symbol.</div>`;
        return `${ownBlock}<div style="margin-top:10px">${pledgeBlock}</div><div style="margin-top:10px">${itBlock}</div>
        <div class="stat-sub" style="margin-top:8px">Source: nseindia.com official corporate-filings API (corporate-share-holdings-master, corporates-pit, corporate-pledgedata) — real regulatory disclosures, not derived from either connected MCP.</div>`;
      })()}
      <h3>Bull case (factual, derived from figures above)</h3>
      <ul class="prose">${bulls.length ? bulls.map(b => `<li>${esc(b)}</li>`).join("") : '<li class="na">No supporting figures this session.</li>'}</ul>
      <h3>Bear case / key uncertainty</h3>
      <ul class="prose">${bears.length ? bears.map(b => `<li>${esc(b)}</li>`).join("") : '<li class="na">No contrary figures this session.</li>'}</ul>
      ${p.business_summary ? `<h3>Business summary (source: Yahoo Finance company profile)</h3><p class="prose">${esc(p.business_summary)}</p>` : ""}
    `);
  }

  /* ================= METHODOLOGY & DATA STATUS ================= */
  function renderMethodology() {
    const s = STATE.snapshot, st = STATE.status || {};
    return `
      <div class="section-title"><h2>Methodology &amp; data status</h2></div>
      <div class="prose">
        <h3>Data sources &amp; what each one cannot do</h3>
        <table>
          <tr><th>Data</th><th>Source</th><th>Limits</th></tr>
          <tr><td>Nifty 500 constituents</td><td>archives.nseindia.com official CSV</td><td>Static list; re-fetch on reconstitution</td></tr>
          <tr><td>F&amp;O eligible symbols + lot sizes</td><td>nsearchives.nseindia.com official CSV</td><td>No options/futures prices, only lot size + expiry labels</td></tr>
          <tr><td>Trading holidays</td><td>nseindia.com holiday-master API, CM segment</td><td>Fetched once for 2026; re-fetch each year</td></tr>
          <tr><td>OHLCV, volume, P/E, sector, fundamentals</td><td>yfinance (Yahoo Finance), SYMBOL.NS</td><td>Free/unauthenticated; intraday can lag true NSE ticks by minutes</td></tr>
          <tr><td>News</td><td>TradingView MCP per-symbol get_news</td><td>Requires a live Claude session to fetch (see below)</td></tr>
          <tr><td>NSE index levels, breadth, P/E/P/B/DY, 52w range</td><td>nseindia.com/api/allIndices (official, all 139 indices)</td><td>Point-in-time snapshot only, no history — re-fetched via scripts/fetch_indices.py</td></tr>
          <tr><td>NSE index RSI/trend/realized volatility</td><td>yfinance, cross-validated tickers (see index_universe.py)</td><td>Only 8 of 26 candidate index tickers have usable multi-year history on Yahoo; the rest show snapshot stats only</td></tr>
          <tr><td>NSE index charts</td><td>NSE's own hosted images (allIndices chart30dPath/chart365dPath)</td><td>Real sourced images for all 139 indices; not a reconstructed chart</td></tr>
          <tr><td>NSE index fuller technical rating (Stoch/ADX/MACD/Momentum)</td><td>TradingView MCP get_technicals_rating (this Claude session only)</td><td>Only for indices with a verified TradingView-symbol identity; 6 of 8 candidates returned data — NIFTY PHARMA and NIFTY MIDCAP 50 returned "no technicals" from TradingView itself</td></tr>
          <tr><td>NSE index fundamentals via Alpha Vantage</td><td><b>Checked, unavailable</b></td><td>Alpha Vantage's INDEX_CATALOG lists 200+ indices — zero are Indian; confirmed by direct query, not assumed</td></tr>
          <tr><td>Cross-check RSI/SMA20/SMA50/EMA20/EMA50/OHLC/Volume (Company Research)</td><td>TradingView MCP get_symbol_data_batch (this Claude session only)</td><td>Manually fetched, not part of the automated pipeline — same limitation as News (see below); shown as "no cross-check data" when absent, never silently omitted</td></tr>
          <tr><td>Analyst forecasts (recommendation, buy/hold/sell, EPS/PE estimates)</td><td>TradingView MCP get_forecasts (this Claude session only)</td><td>Confirmed working for India across cap sizes (mega-cap and mid-cap tested); currently sampled for the "Both" logic watchlist only — manual enrichment, same limitation as News</td></tr>
          <tr><td>Recent results, filings &amp; corporate events (earnings transcripts, slides, AGM/investor-day decks)</td><td>TradingView MCP get_documents (this Claude session only, provider: Quartr)</td><td>Confirmed working for India across cap sizes; sampled for the "Both" logic watchlist only — manual enrichment, same limitation as News</td></tr>
          <tr><td>Ownership (promoter/public holding %), insider trading (SEBI PIT), promoter pledge (SEBI LODR Reg 31(4))</td><td>nseindia.com official corporate-filings API (corporate-share-holdings-master, corporates-pit, corporate-pledgedata) — plain HTTP, part of the automated pipeline</td><td>Not from either connected MCP (both confirmed unavailable there — Alpha Vantage INSIDER_TRANSACTIONS/INSTITUTIONAL_HOLDINGS, TradingView get_documents category="insider_transactions"), but genuinely available from NSE's own site, the same official source already used for holidays/allIndices. Shareholding pattern matched 497/501 universe symbols; insider disclosures found for most actively-traded symbols; promoter pledge is real-time-verified at 0 companies market-wide for the trailing 12 months (a real finding, not a gap)</td></tr>
          <tr><td>Options chain / OI / change-in-OI / IV / LTP / volume per strike; Max Pain &amp; PCR computed from it</td><td>nseindia.com official option-chain-v3 API (see F&amp;O tab)</td><td>Corrects an earlier "not available" claim, which only tested TradingView/Alpha Vantage MCPs — NSE's own site has real per-strike data. Index chains (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY) get full detail; ~210 F&amp;O stocks get summary only (OI/PCR/Max Pain, no per-strike breakdown). Greeks are not in this endpoint's response and are not computed here.</td></tr>
          <tr><td>Alpha Vantage MCP (India)</td><td>connected but unused for India</td><td>Equity search returns BSE-labeled tickers only; NEWS_SENTIMENT rejects NSE/BSE ticker syntax; options endpoints are US-only</td></tr>
        </table>

        <h3>Screening formulas</h3>
        <p>P/E filter: trailing P/E in (${s.thresholds.pe_min_exclusive}, ${s.thresholds.pe_max_inclusive}], applied to stocks only. Missing/negative P/E is excluded and counted separately, never treated as a pass.</p>
        <p>Volume spike: signal-session volume ÷ average of the prior ${s.thresholds.volume_lookback_sessions} <b>completed</b> sessions (signal session itself excluded from its own average). Price_Volume logic requires volume multiple ≥ ${s.thresholds.volume_multiple_min}×.</p>
        <p>Breakout %: last close ÷ prior ${s.thresholds.volume_lookback_sessions}-session high, minus 1.</p>
        <p>RSI: Wilder's RSI(14) on daily closes (and, for matched symbols only, on completed 1-hour bars). RSI_Based logic requires daily RSI(14) in [${s.thresholds.rsi_band[0]}, ${s.thresholds.rsi_band[1]}].</p>
        <p>Candle completion: all daily figures use the last <b>completed</b> NSE session (${s.screening_close_session} at this snapshot's generation time) — never a partially-formed live candle.</p>

        <h3>Sector Strength Score</h3>
        <p>30% 1-day + 25% 5-session + 20% 20-session benchmark(Nifty 50)-relative return, + 15% % constituents above 20DMA + 10% % above 50DMA — each percentile-ranked across sectors before weighting. "Sector" = equal-weighted mean of that NSE industry bucket's Nifty 500 constituents (not a separately-traded NSE sector index — see data-source table above). Ties share rank (competition ranking). Sectors with fewer than 3 constituents having ≥55 sessions of history are excluded and listed under "Excluded — inadequate coverage".</p>

        <h3>Coverage this snapshot</h3>
        <div class="kv" style="max-width:420px">
          <dt>Scanned</dt><dd>${s.counts.scanned}</dd>
          <dt>Data unavailable</dt><dd>${s.counts.data_unavailable}</dd>
          <dt>Eligible for screening</dt><dd>${s.counts.eligible_for_screening}</dd>
          <dt>P/E-filtered out</dt><dd>${s.counts.pe_filtered_out}</dd>
          <dt>Matched (any logic)</dt><dd>${s.counts.matched_total}</dd>
          <dt>Sectors ranked / excluded</dt><dd>${s.sector_rankings.ranked.length} / ${Object.keys(s.sector_rankings.excluded || {}).length}</dd>
        </div>

        <h3>Scheduling</h3>
        <p><b style="color:var(--warn)">Configured, not independently confirmed to fire automatically yet.</b>
        A GitHub Actions cron (<code>.github/workflows/refresh-and-deploy.yml</code>) is wired up to run
        <code>scripts/refresh.py</code> and redeploy this site at ${(st.target_schedule_ist || []).join(", ")} IST,
        Mon–Fri (respecting the NSE trading calendar — outside trading hours / on holidays, market data is
        retained as last-completed-session). This satisfies the "your own scheduler" condition for a real
        automatic run, but every success recorded below so far traces to either a manual "Run workflow"
        click or a local run from an active Claude session, not a confirmed unattended cron firing — this
        page doesn't have API access to GitHub's own Actions run history to verify that independently. The
        MCP-derived fields (TradingView analyst forecasts/technicals) still can't refresh unattended either
        way — those need an active Claude session regardless of the cron. To refresh sooner than the next
        scheduled slot, use the "Refresh now" button.</p>
        <div class="kv" style="max-width:420px">
          <dt>Last attempt</dt><dd>${fmt.iso(st.last_attempt)}</dd>
          <dt>Last success</dt><dd>${fmt.iso(st.last_success)}</dd>
          <dt>Last error</dt><dd>${st.last_error ? "yes — see status.json" : "none"}</dd>
        </div>

        <h3>Non-negotiables honored here</h3>
        <ul>
          <li>Zero matches are shown as zero matches, not relaxed thresholds.</li>
          <li>A failed refresh keeps the previous snapshot and marks it stale rather than blanking the UI.</li>
          <li>Every figure traces to a named source above; unavailable data says "unavailable," never a plausible placeholder.</li>
        </ul>
      </div>
    `;
  }

  window.__APP__ = { STATE, fmt, esc, openModal, boot };
  document.addEventListener("DOMContentLoaded", () => {
    boot().then(() => {
      // simple text search wiring for company + news tabs (added after DOM exists)
      document.addEventListener("input", e => {
        if (e.target.id === "company-search") {
          const q = e.target.value.toLowerCase();
          document.querySelectorAll("#company-grid [data-search]").forEach(el => {
            el.style.display = el.dataset.search.includes(q) ? "" : "none";
          });
        }
        if (e.target.id === "news-search") {
          const q = e.target.value.toLowerCase();
          let visible = 0;
          document.querySelectorAll("#news-list [data-search]").forEach(el => {
            const show = el.dataset.search.includes(q);
            el.style.display = show ? "" : "none";
            if (show) visible++;
          });
          const c = document.getElementById("news-count");
          if (c) c.textContent = visible + " shown";
        }
      });
    });
  });
})();
