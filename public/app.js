(function () {
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  let teamMembers = [];
  let thresholds = { greenMaxHours: 12, yellowMaxHours: 24 };

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
        renderCards(lastData);
      });

      container.appendChild(btn);
    }
  }

  let lastData = null;

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
        reviews.length === 0
          ? ""
          : `${reviews.length} pending`;

      header.appendChild(nameSpan);
      header.appendChild(countSpan);
      card.appendChild(header);

      if (reviews.length === 0) {
        const noReviews = document.createElement("div");
        noReviews.className = "no-reviews";
        noReviews.textContent = "No pending reviews";
        card.appendChild(noReviews);
      } else {
        // Sort by wait time descending (longest wait first)
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

  function updateLastRefreshed(fetchedAt) {
    const el = document.getElementById("last-refreshed");
    const time = new Date(fetchedAt).toLocaleTimeString();
    el.textContent = `Last refreshed: ${time}`;
  }

  async function fetchAndRender() {
    const loading = document.getElementById("loading");
    const errorEl = document.getElementById("error");

    try {
      const response = await fetch("/api/reviews");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      teamMembers = data.teamMembers;
      thresholds = data.thresholds;

      loading.style.display = "none";
      errorEl.style.display = "none";

      renderToggles();
      renderCards(data);
      updateLastRefreshed(data.fetchedAt);
    } catch (err) {
      loading.style.display = "none";
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load reviews: ${err.message}`;
    }
  }

  // Initial fetch
  fetchAndRender();

  // Auto-refresh every 5 minutes
  setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
})();
