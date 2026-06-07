/**
 * Saavn search module — multi-language with live filter chips.
 * Languages: All · English · Hindi · Telugu · Tamil
 */
const SaavnSearch = (() => {
  let resultsContainer = null;
  let resultsObjects   = {};
  let lastSearch       = "top hits";
  let currentLang      = "all";   // active language filter
  let pageIndex        = 1;
  let catalog          = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function textAbstract(text, length) {
    if (text == null) return "";
    if (text.length <= length) return text;
    text = text.substring(0, length);
    const last = text.lastIndexOf(" ");
    return (last > 0 ? text.substring(0, last) : text) + "...";
  }

  function getBitrate() {
    return document.getElementById("saavn-bitrate")?.value || "160kbps";
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    try {
      const res = await fetch("data/catalog.json");
      catalog   = await res.json();
    } catch {
      catalog = {
        defaultSearch:   "top hits",
        featuredQueries: ["hindi hits", "telugu hits", "english pop"],
        featuredArtists: ["Arijit Singh", "Sid Sriram", "Tame Impala"],
        langQueries:     {},
        homeTracks:      [],
      };
    }
    return catalog;
  }

  function getDefaultQuery() {
    if (currentLang !== "all") {
      const q = catalog?.langQueries?.[currentLang]?.[0];
      if (q) return q;
    }
    return catalog?.defaultSearch || "top hits";
  }

  // ── Language filter chips ──────────────────────────────────────────────────
  const LANG_LABELS = [
    { key: "all",     label: "All" },
    { key: "english", label: "English" },
    { key: "hindi",   label: "Hindi" },
    { key: "telugu",  label: "Telugu" },
    { key: "tamil",   label: "Tamil" },
  ];

  function buildLangFilter() {
    const bar = document.getElementById("lang-filter-bar");
    if (!bar) return;
    bar.innerHTML = LANG_LABELS.map(({ key, label }) =>
      `<button type="button" class="lang-chip ${key === currentLang ? "active" : ""}"
         data-lang="${key}">${label}</button>`
    ).join("");

    bar.querySelectorAll(".lang-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        currentLang = btn.dataset.lang;
        // Update active state
        bar.querySelectorAll(".lang-chip").forEach(b =>
          b.classList.toggle("active", b.dataset.lang === currentLang)
        );
        // Re-search with new language
        const q = document.getElementById("saavn-search-box")?.value.trim() || getDefaultQuery();
        doSaavnSearch(q, true);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init(containerSelector = "#saavn-results") {
    resultsContainer = document.querySelector(containerSelector);

    const form = document.getElementById("saavn-search-form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        const query = document.getElementById("saavn-search-box")?.value.trim();
        if (query) {
          window.location.hash = encodeURIComponent(query);
          doSaavnSearch(query);
        }
      });
    }

    document.getElementById("loadmore")?.addEventListener("click", nextPage);

    document.getElementById("saavn-bitrate")?.addEventListener("change", () => {
      if (lastSearch) doSaavnSearch(lastSearch, true);
    });

    // Hash changes only after 3s (avoid firing on init)
    let hashReady = false;
    setTimeout(() => { hashReady = true; }, 3000);
    window.addEventListener("hashchange", () => {
      if (!hashReady) return;
      const q = decodeURIComponent(window.location.hash.substring(1) || "");
      if (q) doSaavnSearch(q, true);
    });

    return loadCatalog().then(() => buildLangFilter());
  }

  function nextPage() {
    const q = document.getElementById("saavn-search-box")?.value.trim() || lastSearch;
    doSaavnSearch(q, true, true);
  }

  // ── Core search ───────────────────────────────────────────────────────────
  async function doSaavnSearch(query, notScroll, appendPage) {
    if (!resultsContainer) resultsContainer = document.querySelector("#saavn-results");
    if (!query) return;

    const decoded = decodeURIComponent(query);
    lastSearch    = decoded;
    window.location.hash = encodeURIComponent(decoded);

    const box = document.getElementById("saavn-search-box");
    if (box) box.value = decoded;

    if (!appendPage) { pageIndex = 1; resultsObjects = {}; }
    else              { pageIndex += 1; }

    resultsContainer.innerHTML = `
      <div class="running-loader">
        <div class="runner-track">
          <img class="runner-gif" src="ani/Run/Run.gif" alt="Loading" />
        </div>
      </div>`;

    try {
      const { tracks } = await SaavnAPI.searchSongs(decoded, pageIndex, 20, currentLang);

      if (!tracks.length) {
        const langName = LANG_LABELS.find(l => l.key === currentLang)?.label || "selected language";
        resultsContainer.innerHTML = `
          <div class="empty-state-anim">
            <div class="empty-state-runner">
              <img src="ani/Dead/Dead.gif" alt="" class="empty-gif" />
              <div class="empty-gif-shadow"></div>
            </div>
            <p class="empty-state-msg">No ${langName} results found</p>
            <p class="empty-state-sub">Try a different search or switch language above.</p>
          </div>`;
        return;
      }

      const prev   = Object.values(resultsObjects).map(o => o.normalized);
      const merged = appendPage ? SaavnAPI.dedupeById([...prev, ...tracks]) : tracks;

      resultsObjects = {};
      const html = merged.map(t => {
        resultsObjects[t.id] = { track: t.raw, normalized: t };
        return window.App
          ? App.renderTrackCard(t, { context: "search" })
          : renderFallbackCard(t);
      }).join("");

      resultsContainer.innerHTML = html;
      if (window.lucide) lucide.createIcons();
      if (!notScroll) resultsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      if (window.App) App.bindTrackActions(resultsContainer, merged);

    } catch (err) {
      let errorMsg = "Something went wrong. Please try again.";
      let errorSub = "Check your connection and search again.";

      if (err.message.includes("429")) {
        errorMsg = "Too many requests";
        errorSub = "Please wait a moment and try again. The API has rate limits.";
      } else if (err.message.includes("400")) {
        errorMsg = "Invalid search query";
        errorSub = "Try a different search term or check for special characters.";
      } else if (err.message.includes("network") || err.message.includes("fetch")) {
        errorMsg = "Network error";
        errorSub = "Check your internet connection and try again.";
      }

      resultsContainer.innerHTML = `
        <div class="empty-state-anim">
          <div class="empty-state-runner">
            <img src="ani/Dead/Dead.gif" alt="" class="empty-gif" />
            <div class="empty-gif-shadow"></div>
          </div>
          <p class="error-msg">${errorMsg}</p>
          <p class="empty-state-sub">${errorSub}</p>
        </div>`;
    }
  }

  function renderFallbackCard(track) {
    const url    = SaavnAPI.getStreamUrl(track.raw, getBitrate());
    const name   = textAbstract(track.name, 40);
    const artist = textAbstract(track.artist, 32);
    const badge  = track.langBadge || "—";
    return `
      <article class="song-card" data-id="${track.id}">
        <img src="${track.image}" alt="" loading="lazy" width="56" height="56" />
        <div class="song-info">
          <h4>${name} <span class="song-badge">${badge}</span></h4>
          <p>${artist}</p>
        </div>
        <div class="song-actions">
          <span class="song-duration">${track.durationLabel}</span>
          <button type="button" class="icon-btn" data-action="play" data-url="${url}" data-id="${track.id}">
            <i data-lucide="play"></i>
          </button>
        </div>
      </article>`;
  }

  function getTrack(id)    { return resultsObjects[id]?.normalized || null; }
  function getAllTracks()  { return Object.values(resultsObjects).map(o => o.normalized); }

  async function runInitialSearch() {
    await loadCatalog();
    buildLangFilter();
    const hashQ = window.location.hash
      ? decodeURIComponent(window.location.hash.substring(1))
      : "";
    await doSaavnSearch(hashQ || getDefaultQuery(), true);
  }

  return {
    init,
    doSaavnSearch,
    nextPage,
    getTrack,
    getAllTracks,
    loadCatalog,
    runInitialSearch,
    get lastSearch() { return lastSearch; },
    get currentLang() { return currentLang; },
  };
})();

function PlayAudio(url, id) { if (window.Player) Player.playById(id, url); }
function AddDownload(id)    { if (window.App)    App.downloadTrack(id); }
