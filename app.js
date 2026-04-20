(function () {
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  let teamMembers = [];
  let thresholds = { greenMaxHours: 12, yellowMaxHours: 24 };
  let lastData = null;
  let lastReviewCounts = null;
  let lastReviewLatencies = null;

  function getVisibility() {
    try {
      return JSON.parse(localStorage.getItem("pr-reviews-visibility")) || {};
    } catch {
      return {};
    }
  }

  function setVisibility(visibility) {
    localStorage.setItem("pr-reviews-visibility", JSON.stringify(visibility));
  }

  function isMemberVisible(member) {
    const saved = getVisibility();
    if (saved.hasOwnProperty(member.github)) {
      return saved[member.github];
    }
    return !member.defaultHidden;
  }

  function toggleMember(member) {
    const saved = getVisibility();
    saved[member.github] = !isMemberVisible(member);
    setVisibility(saved);
  }

  function formatWaitTime(requestedAt) {
    const now = new Date();
    const requested = new Date(requestedAt);
    const diffMs = now - requested;
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) {
      const mins = Math.floor(diffMs / (1000 * 60));
      return { text: `${mins}m`, hours: diffHours };
    } else if (diffHours < 24) {
      const hrs = Math.floor(diffHours);
      return { text: `${hrs}h`, hours: diffHours };
    } else {
      const days = Math.floor(diffHours / 24);
      const hrs = Math.floor(diffHours % 24);
      return { text: `${days}d ${hrs}h`, hours: diffHours };
    }
  }

  function getWaitClass(hours) {
    if (hours <= thresholds.greenMaxHours) return "green";
    if (hours <= thresholds.yellowMaxHours) return "yellow";
    return "red";
  }

  function renderToggles() {
    const container = document.getElementById("toggles");
    container.innerHTML = "";

    for (const member of teamMembers) {
      const btn = document.createElement("button");
      btn.className = "toggle-btn";
      btn.textContent = member.name;

      if (isMemberVisible(member)) {
        btn.classList.add("active");
      } else {
        btn.classList.add("hidden");
      }

      btn.addEventListener("click", () => {
        toggleMember(member);
        renderToggles();
        if (lastData) renderCards(lastData);
        if (lastReviewCounts) renderReviewCounts(lastReviewCounts);
        if (lastReviewLatencies) renderReviewLatencies(lastReviewLatencies);
      });

      container.appendChild(btn);
    }
  }

  function renderCards(data) {
    lastData = data;
    const grid = document.getElementById("card-grid");
    grid.innerHTML = "";

    for (const member of teamMembers) {
      if (!isMemberVisible(member)) continue;

      const reviews = data.reviews[member.github] || [];

      const card = document.createElement("div");
      card.className = "card";

      const header = document.createElement("div");
      header.className = "card-header";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = member.name;

      const countSpan = document.createElement("span");
      countSpan.className = "review-count";
      countSpan.textContent =
        reviews.length === 0 ? "" : `${reviews.length} pending`;

      header.appendChild(nameSpan);
      header.appendChild(countSpan);
      card.appendChild(header);

      if (reviews.length === 0) {
        const noReviews = document.createElement("div");
        noReviews.className = "no-reviews";
        noReviews.textContent = "No pending reviews";
        card.appendChild(noReviews);
      } else {
        const sorted = [...reviews].sort(
          (a, b) => new Date(a.requestedAt) - new Date(b.requestedAt)
        );

        for (const pr of sorted) {
          const item = document.createElement("div");
          item.className = "pr-item";

          const title = document.createElement("div");
          title.className = "pr-title";
          const link = document.createElement("a");
          link.href = pr.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = pr.title;
          title.appendChild(link);

          const meta = document.createElement("div");
          meta.className = "pr-meta";

          const repoInfo = document.createElement("span");
          repoInfo.className = "pr-repo";
          repoInfo.textContent = `${pr.repo}#${pr.number} by ${pr.author}`;

          const wait = formatWaitTime(pr.requestedAt);
          const waitSpan = document.createElement("span");
          waitSpan.className = `wait-time ${getWaitClass(wait.hours)}`;
          waitSpan.textContent = wait.text;

          meta.appendChild(repoInfo);
          meta.appendChild(waitSpan);

          item.appendChild(title);
          item.appendChild(meta);
          card.appendChild(item);
        }
      }

      grid.appendChild(card);
    }
  }

  function formatShortDate(iso) {
    const d = new Date(iso);
    const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
    return `${month} ${d.getUTCDate()}`;
  }

  function renderBarChart(chartId, title, getRow) {
    const chart = document.getElementById(chartId);
    chart.querySelector(".bar-chart-title").textContent = title;
    const list = chart.querySelector(".bar-list");
    list.innerHTML = "";

    const visibleMembers = teamMembers.filter(isMemberVisible);
    const rows = visibleMembers.map((m) => {
      const r = getRow(m.github) || {};
      return {
        name: m.name,
        value: r.value == null ? null : r.value,
        label: r.label != null ? r.label : String(r.value ?? 0),
        colorClass: r.colorClass || null,
        sortKey: r.sortKey != null ? r.sortKey : (r.value == null ? -Infinity : r.value),
        suffix: r.suffix || null,
      };
    });

    const order = rows.some((r) => r.colorClass) ? 1 : -1; // latency: asc; counts: desc
    rows.sort((a, b) => (a.sortKey - b.sortKey) * order);

    const max = rows.reduce(
      (m, r) => Math.max(m, r.value == null ? 0 : r.value),
      0
    );

    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "bar-row";

      const name = document.createElement("span");
      name.className = "bar-name";
      name.textContent = row.name;

      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className =
        "bar-fill" + (row.colorClass ? ` ${row.colorClass}` : "");
      const width =
        max > 0 && row.value != null ? (100 * row.value) / max : 0;
      fill.style.width = `${width}%`;
      track.appendChild(fill);

      const count = document.createElement("span");
      count.className = "bar-count" + (row.value == null ? " dim" : "");
      count.textContent = row.label;
      if (row.suffix) {
        const s = document.createElement("span");
        s.className = "bar-count-n";
        s.textContent = row.suffix;
        count.appendChild(s);
      }

      li.appendChild(name);
      li.appendChild(track);
      li.appendChild(count);
      list.appendChild(li);
    }
  }

  function formatHours(hours) {
    if (hours == null) return "—";
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 48) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
  }

  function latencyColorClass(hours) {
    if (hours == null) return null;
    if (hours <= thresholds.greenMaxHours) return "green";
    if (hours <= thresholds.yellowMaxHours) return "yellow";
    return "red";
  }

  function renderReviewCounts(data) {
    lastReviewCounts = data;

    const counts = data.counts || {};
    const windows = data.windows || {};
    const weekLabel = windows.weekStart
      ? `This Week (${formatShortDate(windows.weekStart)} – today)`
      : "This Week";
    const monthLabel = windows.monthStart
      ? `This Month (${MONTH_NAMES[new Date(windows.monthStart).getUTCMonth()]})`
      : "This Month";
    const yearLabel = "2026 YTD";

    const countRow = (key) => (gh) => {
      const v = (counts[gh] && counts[gh][key]) || 0;
      return { value: v, label: String(v) };
    };
    renderBarChart("chart-week", weekLabel, countRow("week"));
    renderBarChart("chart-month", monthLabel, countRow("month"));
    renderBarChart("chart-year", yearLabel, countRow("year"));

    const freshness = document.getElementById("review-counts-freshness");
    if (data.computedAt) {
      const ts = new Date(data.computedAt).toUTCString();
      freshness.textContent = `Updated daily · last updated ${ts}`;
    } else {
      freshness.textContent = "Updated daily";
    }
  }

  function renderReviewLatencies(data) {
    lastReviewLatencies = data;

    const latencies = data.latencies || {};
    const windows = data.windows || {};
    const weekLabel = windows.weekStart
      ? `This Week (${formatShortDate(windows.weekStart)} – today)`
      : "This Week";
    const monthLabel = windows.monthStart
      ? `This Month (${MONTH_NAMES[new Date(windows.monthStart).getUTCMonth()]})`
      : "This Month";
    const yearLabel = "2026 YTD";

    const latencyRow = (key) => (gh) => {
      const w = latencies[gh] && latencies[gh][key];
      const hours = w ? w.medianHours : null;
      const n = w ? w.n : 0;
      return {
        value: hours,
        label: formatHours(hours),
        colorClass: latencyColorClass(hours),
        // Sort: null/zero-sample reviewers last; else ascending by latency.
        sortKey: hours == null ? Infinity : hours,
        suffix: n > 0 ? `n=${n}` : null,
      };
    };

    renderBarChart("latency-chart-week", weekLabel, latencyRow("week"));
    renderBarChart("latency-chart-month", monthLabel, latencyRow("month"));
    renderBarChart("latency-chart-year", yearLabel, latencyRow("year"));

    const freshness = document.getElementById("review-latencies-freshness");
    if (data.computedAt) {
      const ts = new Date(data.computedAt).toUTCString();
      freshness.textContent = `Updated daily · last updated ${ts}`;
    } else {
      freshness.textContent = "Updated daily";
    }
  }

  function updatePendingFreshness(fetchedAt) {
    const el = document.getElementById("pending-freshness");
    const time = new Date(fetchedAt).toLocaleTimeString();
    el.textContent = `Updated every 5 minutes · last refreshed ${time}`;
  }

  async function fetchAndRenderPending() {
    const loading = document.getElementById("loading");
    const errorEl = document.getElementById("error");

    try {
      const response = await fetch("data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      teamMembers = data.teamMembers;
      thresholds = data.thresholds;

      loading.style.display = "none";
      errorEl.style.display = "none";

      renderToggles();
      renderCards(data);
      updatePendingFreshness(data.fetchedAt);

      // If review counts/latencies are already loaded, re-render so they use
      // the authoritative teamMembers list from data.json.
      if (lastReviewCounts) renderReviewCounts(lastReviewCounts);
      if (lastReviewLatencies) renderReviewLatencies(lastReviewLatencies);
    } catch (err) {
      loading.style.display = "none";
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load reviews: ${err.message}`;
    }
  }

  async function fetchAndRenderReviewCounts() {
    const errorEl = document.getElementById("review-counts-error");
    try {
      const response = await fetch("review-counts.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      errorEl.style.display = "none";
      // teamMembers may not be set yet if this resolves before data.json;
      // renderReviewCounts will be re-invoked from fetchAndRenderPending.
      if (teamMembers.length > 0) renderReviewCounts(data);
      else lastReviewCounts = data;
    } catch (err) {
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load review counts: ${err.message}`;
    }
  }

  async function fetchAndRenderReviewLatencies() {
    const errorEl = document.getElementById("review-latencies-error");
    try {
      const response = await fetch("review-latencies.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      errorEl.style.display = "none";
      if (teamMembers.length > 0) renderReviewLatencies(data);
      else lastReviewLatencies = data;
    } catch (err) {
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load review latencies: ${err.message}`;
    }
  }

  function wireCollapsibleSections() {
    const sections = document.querySelectorAll("details.collapsible");
    for (const section of sections) {
      const key = `pr-reviews-collapsed-${section.id}`;
      const stored = localStorage.getItem(key);
      if (stored === "true") section.removeAttribute("open");
      else if (stored === "false") section.setAttribute("open", "");
      section.addEventListener("toggle", () => {
        localStorage.setItem(key, String(!section.open));
      });
    }
  }

  async function fetchAndRenderBuildInfo() {
    const el = document.getElementById("build-info");
    if (!el) return;
    try {
      const response = await fetch("build-info.json");
      if (!response.ok) return;
      const data = await response.json();
      if (!data || typeof data.sha !== "string" || typeof data.repo !== "string") return;
      const shortSha = data.sha.slice(0, 7);
      const link = document.createElement("a");
      link.href = `https://github.com/${data.repo}/commit/${data.sha}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `build: ${shortSha}`;
      el.appendChild(link);
    } catch {
      // Silently ignore — non-critical metadata.
    }
  }

  wireCollapsibleSections();

  // Initial fetches (run in parallel)
  fetchAndRenderPending();
  fetchAndRenderReviewCounts();
  fetchAndRenderReviewLatencies();
  fetchAndRenderBuildInfo();

  // Auto-refresh pending reviews every 5 minutes.
  // Review counts/latencies are regenerated daily server-side, so we don't poll them
  // more often than pending reviews — we just re-fetch on the same cadence.
  setInterval(() => {
    fetchAndRenderPending();
    fetchAndRenderReviewCounts();
    fetchAndRenderReviewLatencies();
  }, REFRESH_INTERVAL_MS);
})();
