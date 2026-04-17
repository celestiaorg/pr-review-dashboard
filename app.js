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

  function renderBarChart(chartId, title, getCount) {
    const chart = document.getElementById(chartId);
    chart.querySelector(".bar-chart-title").textContent = title;
    const list = chart.querySelector(".bar-list");
    list.innerHTML = "";

    const visibleMembers = teamMembers.filter(isMemberVisible);
    const rows = visibleMembers.map((m) => ({
      name: m.name,
      count: getCount(m.github) || 0,
    }));

    rows.sort((a, b) => b.count - a.count);

    const max = rows.reduce((m, r) => Math.max(m, r.count), 0);

    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "bar-row";

      const name = document.createElement("span");
      name.className = "bar-name";
      name.textContent = row.name;

      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = max > 0 ? `${(100 * row.count) / max}%` : "0%";
      track.appendChild(fill);

      const count = document.createElement("span");
      count.className = "bar-count";
      count.textContent = String(row.count);

      li.appendChild(name);
      li.appendChild(track);
      li.appendChild(count);
      list.appendChild(li);
    }
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

    renderBarChart("chart-week", weekLabel, (gh) => (counts[gh] && counts[gh].week) || 0);
    renderBarChart("chart-month", monthLabel, (gh) => (counts[gh] && counts[gh].month) || 0);
    renderBarChart("chart-year", yearLabel, (gh) => (counts[gh] && counts[gh].year) || 0);

    const freshness = document.getElementById("review-counts-freshness");
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

      // If review counts are already loaded, re-render so they use
      // the authoritative teamMembers list from data.json.
      if (lastReviewCounts) renderReviewCounts(lastReviewCounts);
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

  // Initial fetches (run in parallel)
  fetchAndRenderPending();
  fetchAndRenderReviewCounts();

  // Auto-refresh pending reviews every 5 minutes.
  // Review counts are regenerated daily server-side, so we don't poll them
  // more often than pending reviews — we just re-fetch on the same cadence.
  setInterval(() => {
    fetchAndRenderPending();
    fetchAndRenderReviewCounts();
  }, REFRESH_INTERVAL_MS);
})();
