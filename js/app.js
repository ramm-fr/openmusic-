const App = (() => {
  const trackCache = new Map();
  let liked = [];
  let userQueue = [];
  let recent = [];
  let playlists = []; // [{ id, name, trackIds: [] }]
  let activePLId = null;

  /* ── Custom Alert/Confirm/Prompt ── */
  let alertResolve = null;
  let alertReject = null;

  function showAlert(options = {}) {
    const {
      title = "Confirm",
      message = "",
      icon = "info",
      iconType = "info",
      showInput = false,
      inputPlaceholder = "",
      confirmText = "Confirm",
      cancelText = "Cancel"
    } = options;

    const backdrop = document.getElementById("alert-backdrop");
    const iconEl = document.getElementById("alert-icon");
    const titleEl = document.getElementById("alert-title");
    const messageEl = document.getElementById("alert-message");
    const inputEl = document.getElementById("alert-input");
    const confirmBtn = document.getElementById("alert-confirm");
    const cancelBtn = document.getElementById("alert-cancel");

    if (!backdrop) return Promise.reject("Alert dialog not found");

    // Set icon
    iconEl.className = `alert-icon ${iconType}`;
    iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    // Show/hide input
    if (showInput) {
      inputEl.classList.remove("hidden");
      inputEl.value = "";
      inputEl.placeholder = inputPlaceholder;
    } else {
      inputEl.classList.add("hidden");
    }

    // Show dialog
    backdrop.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();

    // Focus input if shown
    if (showInput) {
      setTimeout(() => inputEl.focus(), 100);
    }

    return new Promise((resolve, reject) => {
      alertResolve = resolve;
      alertReject = reject;
    });
  }

  function hideAlert(result = null) {
    const backdrop = document.getElementById("alert-backdrop");
    if (backdrop) backdrop.classList.add("hidden");
    if (alertResolve) {
      alertResolve(result);
      alertResolve = null;
    }
  }

  function setupAlertDialog() {
    const backdrop = document.getElementById("alert-backdrop");
    const confirmBtn = document.getElementById("alert-confirm");
    const cancelBtn = document.getElementById("alert-cancel");
    const inputEl = document.getElementById("alert-input");

    confirmBtn?.addEventListener("click", () => {
      const inputValue = inputEl.classList.contains("hidden") ? true : inputEl.value;
      hideAlert(inputValue);
    });

    cancelBtn?.addEventListener("click", () => {
      hideAlert(false);
    });

    backdrop?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) hideAlert(false);
    });

    inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirmBtn?.click();
      if (e.key === "Escape") cancelBtn?.click();
    });
  }

  function customConfirm(message, title = "Confirm") {
    return showAlert({
      title,
      message,
      icon: "alert-triangle",
      iconType: "warning",
      confirmText: "Delete",
      cancelText: "Cancel"
    }).then(result => result === true);
  }

  function customPrompt(message, placeholder = "", title = "Input") {
    return showAlert({
      title,
      message,
      icon: "edit",
      iconType: "info",
      showInput: true,
      inputPlaceholder: placeholder,
      confirmText: "OK",
      cancelText: "Cancel"
    }).then(result => (result === false || result === null) ? null : result);
  }

  /* ── persistence ── */

  /**
   * Load all user lists from Appwrite.
   * Falls back to empty arrays if the document doesn't exist yet.
   */
  async function loadUserLists() {
    const result = await DB.loadUserData();
    if (!result.ok) {
      console.warn("[App] Could not load user data from Appwrite:", result.error);
      // Don't log out — keep user on dashboard with empty data
      liked = []; userQueue = []; recent = []; playlists = [];
      return;
    }
    const d = result.data;
    liked     = SaavnAPI.dedupeById(d.liked     || []);
    userQueue = SaavnAPI.dedupeById(d.queue     || []);
    recent    = SaavnAPI.dedupeById(d.recent    || []);
    playlists = d.playlists || [];

    if (d.settings && typeof d.settings === "object") {
      applyPersistedSettings(d.settings);
    }
  }

  /**
   * Debounced persist helper — batches rapid changes into one write.
   * Saves liked, queue, recent, playlists all together so we never
   * leave the document partially updated.
   */
  let _persistTimer = null;
  function persist(immediate = false) {
    clearTimeout(_persistTimer);
    const run = () => DB.saveUserData({ liked, queue: userQueue, recent, playlists });
    if (immediate) { run(); }
    else { _persistTimer = setTimeout(run, 800); }
  }

  /**
   * Persist only the settings object (separate field).
   */
  let _settingsTimer = null;
  function persistSettings(settings, immediate = false) {
    clearTimeout(_settingsTimer);
    const run = () => DB.saveSettings(settings);
    if (immediate) { run(); }
    else { _settingsTimer = setTimeout(run, 800); }
  }

  /**
   * Apply a saved settings object to the UI (called on load).
   */
  function applyPersistedSettings(s) {
    // Theme
    if (s.theme) applyTheme(s.theme);

    // Quality / bitrate
    const bitrateEl = document.getElementById("saavn-bitrate");
    if (bitrateEl && s.defaultQuality) {
      bitrateEl.value = s.defaultQuality;
      bitrateEl.dispatchEvent(new Event("change"));
    }

    // Crossfade
    if (s.crossfadeDur && window.Player) {
      Player.setCrossfadeDuration(parseFloat(s.crossfadeDur) * 1000);
    }

    // Compact sidebar
    if (s.compactSidebar) {
      document.getElementById("sidebar")?.classList.add("sidebar--compact");
    }
  }

  /**
   * Collect all current settings into a plain object for saving.
   */
  function collectSettings() {
    return {
      theme:          document.documentElement.getAttribute("data-theme") || "light",
      defaultQuality: document.getElementById("saavn-bitrate")?.value || "160kbps",
      crossfade:      document.getElementById("set-crossfade")?.checked ?? true,
      crossfadeDur:   parseFloat(document.getElementById("set-crossfade-dur")?.value || "1.8"),
      compactSidebar: document.getElementById("set-compact-sidebar")?.checked ?? false,
      devMode:        document.getElementById("set-dev-mode")?.checked ?? false,
      devLogging:     document.getElementById("set-dev-logging")?.checked ?? false,
      devStats:       document.getElementById("set-dev-stats")?.checked ?? true,
      devLatency:     document.getElementById("set-dev-latency")?.checked ?? false,
    };
  }

  function cacheTrack(track) {
    if (track?.id) trackCache.set(track.id, track);
  }

  function findTrackById(id) {
    if (trackCache.has(id)) return trackCache.get(id);
    const fromSaavn = SaavnSearch.getTrack(id);
    if (fromSaavn) return fromSaavn;
    return [...liked, ...userQueue, ...recent].find((t) => t.id === id) || null;
  }

  /* ── escaping ── */
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  /* ── liked ── */
  function isLiked(id) { return liked.some((t) => t.id === id); }

  function toggleLike(track) {
    cacheTrack(track);
    const idx = liked.findIndex((t) => t.id === track.id);
    if (idx >= 0) liked.splice(idx, 1); else liked.unshift(track);
    liked = SaavnAPI.dedupeById(liked);
    persist();
    refreshIcons();
    renderLibrary();
    updatePlayerLike();
  }

  function updatePlayerLike() {
    const btn = document.getElementById("btn-player-like");
    const cur = Player.current;
    if (!btn || !cur) return;
    btn.classList.toggle("liked", isLiked(cur.id));
    if (window.lucide) { btn.innerHTML = `<i data-lucide="heart"></i>`; lucide.createIcons(); }
  }

  /* ── queue ── */
  function addToQueue(track) {
    if (userQueue.some((t) => t.id === track.id)) return;
    cacheTrack(track);
    userQueue.push(track);
    userQueue = SaavnAPI.dedupeById(userQueue);
    persist();
    renderQueue();
  }

  function getQueue() { return userQueue; }

  function onTrackPlayed(track) {
    cacheTrack(track);
    recent = [track, ...recent.filter((t) => t.id !== track.id)];
    recent = SaavnAPI.dedupeById(recent).slice(0, 50);
    persist();
    renderRecent();
    // Only set queue if it's not already set with context tracks (more than 1 track)
    if (Player.queue.length <= 1) {
      Player.setQueue(userQueue.length ? userQueue : [track], 0);
    }
  }

  /* ── download ── */
  function downloadTrack(id, track) {
    const t = track || findTrackById(id);
    if (!t) return;
    const url = SaavnAPI.getStreamUrl(t.raw || t, getQuality());
    if (!url) return;
    
    // Fetch the file as a blob to force download
    fetch(url)
      .then(response => response.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `${t.name || "track"}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(err => {
        console.error("Download failed:", err);
        // Fallback to direct link if fetch fails
        const a = document.createElement("a");
        a.href = url;
        a.download = `${t.name || "track"}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

  function getQuality() {
    return document.getElementById("saavn-bitrate")?.value || "160kbps";
  }

  /* ── play ── */
  function playTrack(track, contextTracks = null) {
    cacheTrack(track);
    const url = SaavnAPI.getStreamUrl(track.raw || track, getQuality());

    // If context tracks are provided (e.g., from search results), queue them
    const queueTracks = contextTracks || (userQueue.length ? userQueue : [track]);
    // Filter out undefined elements that may exist during progressive loading
    const validQueueTracks = queueTracks.filter(t => t && t.id);
    const startIndex = validQueueTracks.findIndex((q) => q.id === track.id);
    Player.setQueue(validQueueTracks, startIndex >= 0 ? startIndex : 0);
    Player.playTrack(track, url);
  }

  /* ── render track card ── */
  function renderTrackCard(track, opts = {}) {
    cacheTrack(track);
    const { context = "search" } = opts;
    const likedClass = isLiked(track.id) ? "liked" : "";
    const url = SaavnAPI.getStreamUrl(track.raw, getQuality());
    const name = track.name.length > 48 ? track.name.slice(0, 45) + "…" : track.name;

    // playlist add options for context menu
    const plOpts = playlists.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
    ).join("");

    return `
      <article class="song-card" data-id="${track.id}" data-context="${context}">
        <img src="${track.image}" alt="" loading="lazy" width="56" height="56" />
        <div class="song-info">
          <h4>${escapeHtml(name)} <span class="song-badge">EN</span></h4>
          <p>${escapeHtml(track.artist)}${track.album ? " · " + escapeHtml(track.album) : ""}</p>
        </div>
        <div class="song-actions">
          <span class="song-duration">${track.durationLabel}</span>
          <button type="button" class="icon-btn" data-action="play" data-id="${track.id}" data-url="${url}" title="Play">
            <i data-lucide="play"></i>
          </button>
          <button type="button" class="icon-btn ${likedClass}" data-action="like" data-id="${track.id}" title="Like">
            <i data-lucide="heart"></i>
          </button>
          <button type="button" class="icon-btn" data-action="queue" data-id="${track.id}" title="Add to queue">
            <i data-lucide="list-plus"></i>
          </button>
          <button type="button" class="icon-btn" data-action="add-to-playlist" data-id="${track.id}" title="Add to playlist">
            <i data-lucide="library"></i>
          </button>
          <button type="button" class="icon-btn" data-action="download" data-id="${track.id}" title="Download">
            <i data-lucide="download"></i>
          </button>
        </div>
      </article>`;
  }

  function bindTrackActions(container, contextTracks = null) {
    if (!container) return;
    container.querySelectorAll("[data-action]").forEach((btn) => btn.replaceWith(btn.cloneNode(true)));
    container.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const track = findTrackById(id) || SaavnSearch.getTrack(id);
        if (!track) return;

        if (action === "play") playTrack(track, contextTracks);
        else if (action === "like") toggleLike(track);
        else if (action === "queue") {
          addToQueue(track);
          showTickMark(btn);
        }
        else if (action === "download") downloadTrack(id, track);
        else if (action === "add-to-playlist") {
          const added = await showAddToPlaylistPicker(track);
          if (added) showTickMark(btn);
        }
      });
    });
    container.querySelectorAll(".song-card").forEach(card => {
      card.addEventListener("click", () => {
        const track = findTrackById(card.dataset.id);
        if (track) playTrack(track, contextTracks);
      });
    });
  }

  function showTickMark(btn) {
    const originalIcon = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="check"></i>`;
    btn.classList.add("success-tick");
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      btn.innerHTML = originalIcon;
      btn.classList.remove("success-tick");
      if (window.lucide) lucide.createIcons();
    }, 1500);
  }

  /* ── list helpers ── */
  function renderList(containerId, tracks, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    tracks.forEach(cacheTrack);
    if (!tracks.length) { el.innerHTML = `<p class="empty-state">${emptyMsg}</p>`; return; }
    el.innerHTML = tracks.map((t) => renderTrackCard(t, { context: containerId })).join("");
    bindTrackActions(el, tracks);
    observeReveal(el, ".song-card");
    if (window.lucide) lucide.createIcons();
  }

  function renderLibrary() {
    renderList("library-results", liked, "No liked songs yet. Heart a track to save it.");
    const count = document.getElementById("library-count");
    if (count) count.textContent = `${liked.length} song${liked.length === 1 ? "" : "s"}`;
  }

  function renderQueue() {
    renderList("queue-results", userQueue, "Queue is empty. Add songs with the list icon.");
    const count = document.getElementById("queue-count");
    if (count) count.textContent = `${userQueue.length} song${userQueue.length === 1 ? "" : "s"}`;
  }

  function renderRecent() {
    renderList("recent-results", recent, "Nothing played yet.");
    const count = document.getElementById("recent-count");
    if (count) count.textContent = `${recent.length} song${recent.length === 1 ? "" : "s"}`;
  }

  /* ── PLAYLISTS ── */
  function getPlaylistTracks(pl) {
    return pl.trackIds
      .map(id => findTrackById(id))
      .filter(Boolean);
  }

  function playlistCoverImages(pl) {
    return getPlaylistTracks(pl).slice(0, 4).map(t => t.image).filter(Boolean);
  }

  function renderPlaylistCard(pl) {
    const count = pl.trackIds.length;
    let coverHtml;

    if (pl.cover) {
      // Custom cover image takes priority
      coverHtml = `<div class="playlist-card-cover" style="grid-template-columns:1fr;">
        <img src="${pl.cover}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
      </div>`;
    } else {
      const imgs = playlistCoverImages(pl);
      if (imgs.length === 0) {
        coverHtml = `<div class="playlist-card-cover-empty"><i data-lucide="library"></i></div>`;
      } else if (imgs.length < 4) {
        coverHtml = `<div class="playlist-card-cover" style="grid-template-columns:1fr;">
          <img src="${imgs[0]}" alt="" loading="lazy" />
        </div>`;
      } else {
        coverHtml = `<div class="playlist-card-cover">
          ${imgs.map(src => `<img src="${src}" alt="" loading="lazy" />`).join("")}
        </div>`;
      }
    }

    return `
      <button type="button" class="playlist-card" data-pl-id="${pl.id}">
        ${coverHtml}
        <div class="playlist-card-info">
          <strong>${escapeHtml(pl.name)}</strong>
          <span>${count} song${count === 1 ? "" : "s"}</span>
        </div>
      </button>`;
  }

  function renderPlaylists() {
    const grid = document.getElementById("playlists-grid");
    const homeGrid = document.getElementById("home-playlists");
    const count = document.getElementById("playlists-count");

    const html = playlists.length
      ? playlists.map(renderPlaylistCard).join("")
      : `<div class="playlist-empty"><i data-lucide="library"></i><p>No playlists yet. Create one above.</p></div>`;

    if (grid) {
      grid.innerHTML = html;
      grid.querySelectorAll(".playlist-card").forEach((btn, i) => {
        btn.style.setProperty("--i", i);
        btn.addEventListener("click", () => openPlaylistDetail(btn.dataset.plId));
      });
      observeReveal(grid, ".playlist-card");
      if (window.lucide) lucide.createIcons();
    }

    if (homeGrid) {
      homeGrid.innerHTML = playlists.length
        ? playlists.slice(0, 6).map(renderPlaylistCard).join("")
        : `<div class="playlist-empty" style="padding:20px 0;"><i data-lucide="library"></i><p>No playlists yet.</p></div>`;
      homeGrid.querySelectorAll(".playlist-card").forEach((btn, i) => {
        btn.style.setProperty("--i", i);
        btn.addEventListener("click", () => openPlaylistDetail(btn.dataset.plId));
      });
      observeReveal(homeGrid, ".playlist-card");
      if (window.lucide) lucide.createIcons();
    }

    if (count) count.textContent = `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`;
  }

  function openPlaylistDetail(id) {
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    activePLId = id;

    const detail = document.getElementById("playlist-detail");
    const gridEl = document.getElementById("playlists-grid");
    if (detail) detail.classList.remove("hidden");
    if (gridEl) gridEl.classList.add("hidden");

    const nameEl  = document.getElementById("playlist-detail-name");
    const countEl = document.getElementById("playlist-detail-count");
    if (nameEl)  nameEl.textContent  = pl.name;

    // Render cover preview
    const coverEl = document.getElementById("playlist-detail-cover");
    if (coverEl) {
      if (pl.cover) {
        coverEl.style.backgroundImage = `url(${pl.cover})`;
        coverEl.classList.add("has-cover");
        coverEl.innerHTML = "";
      } else {
        const imgs = playlistCoverImages(pl);
        coverEl.style.backgroundImage = "";
        coverEl.classList.remove("has-cover");
        if (imgs.length === 0) {
          coverEl.innerHTML = `<i data-lucide="library"></i>`;
        } else if (imgs.length < 4) {
          coverEl.innerHTML = `<img src="${imgs[0]}" alt="" />`;
          coverEl.classList.add("has-cover");
        } else {
          coverEl.innerHTML = `<div class="pl-cover-grid">${imgs.map(s => `<img src="${s}" alt="" />`).join("")}</div>`;
          coverEl.classList.add("has-cover");
        }
      }
      if (window.lucide) lucide.createIcons();
    }

    // Wire file input for custom cover
    const fileInput = document.getElementById("playlist-cover-input");
    if (fileInput) {
      // Remove old listener by cloning
      const newInput = fileInput.cloneNode(true);
      fileInput.parentNode.replaceChild(newInput, fileInput);
      newInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          alert("Image must be under 2 MB.");
          return;
        }

        const plObj = playlists.find(p => p.id === activePLId);
        if (!plObj) return;

        // Show uploading state
        if (coverEl) {
          coverEl.innerHTML = `<span style="color:#999;font-size:12px;">Uploading…</span>`;
        }

        // Upload to Appwrite Storage
        const result = await DB.uploadPlaylistCover(plObj.id, file);
        if (!result.ok) {
          alert("Cover upload failed: " + result.error);
          return;
        }

        // Delete old cover file if different
        if (plObj.coverId && plObj.coverId !== result.fileId) {
          await DB.deletePlaylistCover(plObj.coverId);
        }

        // Save fileId reference in playlist object
        plObj.coverId = result.fileId;
        plObj.cover   = result.previewUrl;   // cached URL for instant render
        persist(true);
        renderPlaylists();

        // Update cover preview live
        if (coverEl) {
          coverEl.style.backgroundImage = `url(${result.previewUrl})`;
          coverEl.classList.add("has-cover");
          coverEl.innerHTML = "";
        }
      });
    }

    const tracks = getPlaylistTracks(pl);
    if (countEl) countEl.textContent = `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;

    const trackList = document.getElementById("playlist-detail-tracks");
    if (!trackList) return;
    if (!tracks.length) {
      trackList.innerHTML = `<p class="empty-state">No songs yet. Add some from any track list.</p>`;
    } else {
      trackList.innerHTML = tracks.map((t) => renderTrackCard(t, { context: "playlist-detail" })).join("");
      bindTrackActions(trackList, tracks);
    }
    if (window.lucide) lucide.createIcons();
  }

  function closePlaylistDetail() {
    activePLId = null;
    document.getElementById("playlist-detail")?.classList.add("hidden");
    document.getElementById("playlists-grid")?.classList.remove("hidden");
  }

  function createPlaylist(name) {
    if (!name.trim()) return;
    playlists.push({ id: crypto.randomUUID(), name: name.trim(), trackIds: [] });
    persist();
    renderPlaylists();
  }

  function deletePlaylist(id) {
    const pl = playlists.find(p => p.id === id);
    // Delete cover from Storage if it exists
    if (pl?.coverId) DB.deletePlaylistCover(pl.coverId);
    playlists = playlists.filter(p => p.id !== id);
    persist(true);
    closePlaylistDetail();
    renderPlaylists();
  }

  function addTrackToPlaylist(plId, track) {
    const pl = playlists.find(p => p.id === plId);
    if (!pl || pl.trackIds.includes(track.id)) return;
    cacheTrack(track);
    pl.trackIds.push(track.id);
    persist();
    renderPlaylists();
  }

  async function showAddToPlaylistPicker(track) {
    if (!playlists.length) {
      openModal(name => { createPlaylist(name); addTrackToPlaylist(playlists[playlists.length - 1].id, track); });
      return true;
    }
    // Simple inline picker using a select prompt (lightweight, no extra UI needed)
    const names = playlists.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    const input = await customPrompt(`Add to playlist:\n${names}\n\nEnter number:`, "Enter number...", "Add to Playlist");
    if (!input) return false;
    const idx = parseInt(input, 10) - 1;
    if (idx >= 0 && idx < playlists.length) {
      addTrackToPlaylist(playlists[idx].id, track);
      return true;
    }
    return false;
  }

  /* ── Modal ── */
  let modalCallback = null;

  function openModal(callback) {
    modalCallback = callback;
    const backdrop = document.getElementById("modal-backdrop");
    const input = document.getElementById("playlist-name-input");
    if (backdrop) backdrop.classList.remove("hidden");
    if (input) { input.value = ""; input.focus(); }
    if (window.lucide) lucide.createIcons();
  }

  function closeModal() {
    document.getElementById("modal-backdrop")?.classList.add("hidden");
    modalCallback = null;
  }

  function setupModal() {
    document.getElementById("btn-modal-close")?.addEventListener("click", closeModal);
    document.getElementById("btn-modal-cancel")?.addEventListener("click", closeModal);
    document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById("btn-modal-create")?.addEventListener("click", () => {
      const name = document.getElementById("playlist-name-input")?.value || "";
      if (!name.trim()) return;
      if (modalCallback) modalCallback(name);
      else createPlaylist(name);
      closeModal();
    });
    document.getElementById("playlist-name-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("btn-modal-create")?.click();
      if (e.key === "Escape") closeModal();
    });
    // New playlist buttons
    document.getElementById("btn-new-playlist")?.addEventListener("click", () => openModal(null));
    document.getElementById("btn-new-playlist-home")?.addEventListener("click", () => openModal(null));
    // Playlist detail actions
    document.getElementById("btn-back-playlists")?.addEventListener("click", closePlaylistDetail);
    document.getElementById("btn-play-playlist")?.addEventListener("click", () => {
      if (!activePLId) return;
      const pl = playlists.find(p => p.id === activePLId);
      if (!pl) return;
      const tracks = getPlaylistTracks(pl);
      if (!tracks.length) return;
      playTrack(tracks[0], tracks);
    });
    document.getElementById("btn-delete-playlist")?.addEventListener("click", async () => {
      if (!activePLId) {
        console.error("No active playlist ID");
        return;
      }
      const pl = playlists.find(p => p.id === activePLId);
      if (!pl) {
        console.error("Playlist not found:", activePLId);
        return;
      }
      if (await customConfirm(`Delete "${pl.name}"?`, "Delete Playlist")) {
        deletePlaylist(activePLId);
      }
    });
  }

  /* ── Dark mode toggle ── */
  function setupTheme() {
    // Theme is loaded from Appwrite via applyPersistedSettings() in loadUserLists.
    // Fallback to localStorage for the very first paint before Appwrite responds.
    const saved = localStorage.getItem("openmusic_theme") || "light";
    applyTheme(saved);

    const themeBtn = document.getElementById("btn-theme");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme");
        const newTheme = current === "dark" ? "light" : "dark";
        applyTheme(newTheme);
      });
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("openmusic_theme", theme);   // fast local cache for next load
    const moonIcon = document.getElementById("icon-moon");
    const sunIcon  = document.getElementById("icon-sun");
    if (moonIcon) moonIcon.classList.toggle("hidden", theme === "dark");
    if (sunIcon)  sunIcon.classList.toggle("hidden",  theme === "light");
    // Persist to Appwrite (debounced)
    persistSettings(collectSettings());
  }

  /* ── Sidebar mobile toggle ── */
  function setupSidebarToggle() {
    const sidebar  = document.getElementById("sidebar");
    const overlay  = document.getElementById("sidebar-overlay");
    const btnOpen  = document.getElementById("btn-sidebar-open");
    const btnClose = document.getElementById("btn-sidebar-close");

    function openSidebar() {
      sidebar?.classList.add("open");
      overlay?.classList.add("active");
    }
    function closeSidebar() {
      sidebar?.classList.remove("open");
      overlay?.classList.remove("active");
    }

    btnOpen?.addEventListener("click", openSidebar);
    btnClose?.addEventListener("click", closeSidebar);
    overlay?.addEventListener("click", closeSidebar);

    // Close on nav item click (mobile)
    document.querySelectorAll(".nav-item").forEach(item => {
      item.addEventListener("click", () => {
        if (window.innerWidth <= 900) closeSidebar();
      });
    });
  }

  /* ── home poster helpers ── */
  function runnerLoader(label = "") {
    return `
      <div class="running-loader">
        <div class="runner-track">
          <img class="runner-gif" src="ani/Run/Run.gif" alt="Loading" />
        </div>
      </div>`;
  }

  function renderPosterSkeleton(count) {
    const el = document.getElementById("home-posters");
    if (!el) return;
    // Show the runner gif loader centered in the poster row area
    el.innerHTML = runnerLoader("Fetching tracks…");
  }

  function renderPosterCard(track) {
    cacheTrack(track);
    const url  = SaavnAPI.getStreamUrl(track.raw, getQuality());
    const name = track.name.length > 32 ? track.name.slice(0, 29) + "…" : track.name;
    const artist = track.artist.length > 26 ? track.artist.slice(0, 23) + "…" : track.artist;
    return `
      <article class="song-poster" data-id="${track.id}">
        <div style="position:relative;overflow:hidden;">
          <img class="song-poster-img" src="${track.image}" alt="" loading="lazy" width="200" height="200" />
          <div class="song-poster-overlay">
            <button type="button" class="song-poster-play" data-action="play" data-id="${track.id}" data-url="${url}" title="Play">
              <i data-lucide="play"></i>
            </button>
            <div class="song-poster-meta">
              <strong>${escapeHtml(name)}</strong>
              <span>${escapeHtml(artist)}</span>
            </div>
          </div>
        </div>
        <div class="song-poster-info">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(artist)}</span>
        </div>
      </article>`;
  }

  function bindPosterActions(container, posterTracks = null) {
    if (!container) return;
    container.querySelectorAll("[data-action]").forEach(btn => btn.replaceWith(btn.cloneNode(true)));
    container.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const track = findTrackById(btn.dataset.id);
        if (track && btn.dataset.action === "play") playTrack(track, posterTracks);
      });
    });
    container.querySelectorAll(".song-poster").forEach(card => {
      card.addEventListener("click", () => {
        const track = findTrackById(card.dataset.id);
        if (track) playTrack(track, posterTracks);
      });
    });
  }

  /* ── loadHome ── */
  async function loadHome() {
    const catalog   = await SaavnSearch.loadCatalog();
    const artists   = document.getElementById("featured-artists");
    const postersEl = document.getElementById("home-posters");
    const homeEl    = document.getElementById("home-results");

    // ── Artists ──
    if (artists) {
      artists.innerHTML = (catalog.featuredArtists || [])
        .map(a => `<button type="button" class="artist-card" data-query="${escapeHtml(a)}">
          <i data-lucide="mic-2"></i><span>${escapeHtml(a)}</span>
        </button>`).join("");
      artists.querySelectorAll(".artist-card").forEach((card, i) => {
        card.style.setProperty("--i", i);
        card.addEventListener("click", () => {
          document.getElementById("saavn-search-box").value = card.dataset.query;
          switchView("search");
          SaavnSearch.doSaavnSearch(card.dataset.query);
        });
      });
      observeReveal(artists, ".artist-card");
      if (window.lucide) lucide.createIcons();
    }

    // ── Show loaders ──
    renderPosterSkeleton(8);
    if (homeEl) homeEl.innerHTML = runnerLoader("Loading tracks…");

    // ── Progressive fetch — one song per catalog entry, rate-limited ──
    const homeTracks = catalog.homeTracks || [];
    const collected  = [];   // resolved track objects in order
    let postersSet   = false;

    function flushRender() {
      // Re-render everything collected so far
      const statEl = document.getElementById("hero-stat-count");
      if (statEl) statEl.textContent = collected.length;

      // Posters: first 12, set once they're all available or after 12 loaded
      if (!postersSet && collected.length >= Math.min(12, homeTracks.length) && postersEl) {
        postersSet = true;
        const posterTracks = collected.slice(0, 12);
        postersEl.innerHTML = posterTracks.map(renderPosterCard).join("");
        bindPosterActions(postersEl, collected);
        observeReveal(postersEl, ".song-poster");
        if (window.lucide) lucide.createIcons();
      }

      // Track list: only append new tracks to avoid refreshing
      if (homeEl && collected.length > 0) {
        const currentCount = homeEl.querySelectorAll(".song-card").length;
        const newTracks = collected.slice(currentCount);

        // Clear loading animation on first render
        if (currentCount === 0 && newTracks.length > 0) {
          homeEl.innerHTML = "";
        }

        if (newTracks.length > 0) {
          const newHtml = newTracks
            .map((t, i) => renderTrackCard(t, { context: "home" }))
            .join("");
          homeEl.insertAdjacentHTML("beforeend", newHtml);
          bindTrackActions(homeEl, collected);
          // Stagger index for new items only
          homeEl.querySelectorAll(".song-card").forEach((el, i) => {
            el.style.setProperty("--i", i);
          });
          observeReveal(homeEl, ".song-card");
          if (window.lucide) lucide.createIcons();
        }
      }
    }

    // Kick off sequential fetches — each goes through the rate limiter
    // We don't await all at once; we use a loop so they queue up one-by-one
    const fetchPromises = homeTracks.map(async (entry, idx) => {
      try {
        // Search with English language filter
        const { tracks } = await SaavnAPI.searchSongs(entry.q, 1, 5, "english");
        // Pick the best match: prefer exact title match, fall back to first result
        const titleLower = entry.name.toLowerCase();
        const match =
          tracks.find(t => t.name.toLowerCase() === titleLower) ||
          tracks.find(t => t.name.toLowerCase().includes(titleLower.slice(0, 10))) ||
          tracks[0];
        if (match) {
          cacheTrack(match);
          // Insert at the correct position to preserve catalog order
          collected[idx] = match;
          flushRender();
        }
      } catch {
        // silent — skip failed individual tracks, don't break the whole list
      }
    });

    // Wait for all fetches (they're sequential via the rate limiter queue)
    await Promise.allSettled(fetchPromises);

    // Final render with complete ordered list (remove holes from failed fetches)
    const final = SaavnAPI.dedupeById(collected.filter(Boolean));
    if (final.length === 0) {
      if (postersEl) postersEl.innerHTML = "";
      if (homeEl) homeEl.innerHTML = `<p class="error-msg">Could not load tracks. Check your connection.</p>`;
      return;
    }

    // Update poster actions with full list for queue continuity
    if (postersEl) bindPosterActions(postersEl, final);
    if (homeEl)    bindTrackActions(homeEl, final);
    if (window.lucide) lucide.createIcons();
  }

  /* ── navigation ── */
  function switchView(view) {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
    // Reset playlist detail when switching away
    if (view !== "playlists") closePlaylistDetail();
  }

  function refreshIcons() { if (window.lucide) lucide.createIcons(); }

  /* ── Settings view ── */
  function setupSettingsView() {
    if (!Auth.getSession()) return;

    // Prevent double-binding — mark as already set up
    if (document.getElementById("view-settings")._bound) return;
    document.getElementById("view-settings")._bound = true;

    // ── Helpers ──
    function savePref(key, val) {
      const s = collectSettings();
      s[key] = val;
      persistSettings(s);
    }

    // ── Playback — Crossfade toggle ──
    const cfCheck = document.getElementById("set-crossfade");
    if (cfCheck) {
      cfCheck.addEventListener("change", () => {
        const enabled = cfCheck.checked;
        Player.setCrossfadeDuration(enabled
          ? parseFloat(document.getElementById("set-crossfade-dur")?.value || "1.8") * 1000
          : 0);
        savePref("crossfade", enabled);
      });
    }

    // ── Playback — Crossfade duration ──
    const cfDur   = document.getElementById("set-crossfade-dur");
    const cfLabel = document.getElementById("set-crossfade-label");
    if (cfDur) {
      cfDur.addEventListener("input", () => {
        const val = parseFloat(cfDur.value);
        if (cfLabel) cfLabel.textContent = val.toFixed(1) + " s";
        if (cfCheck?.checked) Player.setCrossfadeDuration(val * 1000);
        savePref("crossfadeDur", val);
      });
    }

    // ── Playback — Default quality ──
    const defQ = document.getElementById("set-default-quality");
    if (defQ) {
      defQ.addEventListener("change", () => {
        const bitrateEl = document.getElementById("saavn-bitrate");
        if (bitrateEl) {
          bitrateEl.value = defQ.value;
          bitrateEl.dispatchEvent(new Event("change"));
        }
        savePref("defaultQuality", defQ.value);
      });
    }

    // ── Appearance — Dark mode ──
    const darkToggle = document.getElementById("set-dark-mode");
    if (darkToggle) {
      darkToggle.addEventListener("change", () => {
        applyTheme(darkToggle.checked ? "dark" : "light");
        // applyTheme already calls persistSettings via its own path
      });
    }

    // ── Appearance — Compact sidebar ──
    const compactToggle = document.getElementById("set-compact-sidebar");
    if (compactToggle) {
      compactToggle.addEventListener("change", () => {
        document.getElementById("sidebar")?.classList.toggle("sidebar--compact", compactToggle.checked);
        savePref("compactSidebar", compactToggle.checked);
      });
    }

    // ── Developer — Enable toggle ──
    const devToggle = document.getElementById("set-dev-mode");
    const devPanel  = document.getElementById("dev-panel");
    const devBadge  = document.getElementById("dev-badge");

    function applyDevMode(on) {
      devPanel?.classList.toggle("hidden", !on);
      if (devBadge) {
        devBadge.textContent = on ? "ON" : "OFF";
        devBadge.classList.toggle("dev-badge--on", on);
      }
    }

    if (devToggle) {
      devToggle.addEventListener("change", () => {
        applyDevMode(devToggle.checked);
        savePref("devMode", devToggle.checked);
      });
      applyDevMode(devToggle.checked); // apply current state on open
    }

    // ── Developer — Console logging ──
    const logToggle = document.getElementById("set-dev-logging");
    if (logToggle) {
      logToggle.addEventListener("change", () => {
        window._devLogging = logToggle.checked;
        savePref("devLogging", logToggle.checked);
      });
    }

    // ── Developer — Show system stats ──
    const statsToggle = document.getElementById("set-dev-stats");
    if (statsToggle) {
      statsToggle.addEventListener("change", () => {
        document.getElementById("sys-stats")?.classList.toggle("hidden", !statsToggle.checked);
        savePref("devStats", statsToggle.checked);
      });
    }

    // ── Developer — API latency ──
    const latToggle = document.getElementById("set-dev-latency");
    if (latToggle) {
      latToggle.addEventListener("change", () => savePref("devLatency", latToggle.checked));
    }

    // ── Developer — Appwrite status ──
    const appwriteStatus = document.getElementById("dev-appwrite-status");
    if (appwriteStatus && window.AppwriteClient) {
      appwriteStatus.textContent = "Checking…";
      window.AppwriteClient.ping()
        .then(() => { appwriteStatus.textContent = "✓ Connected"; appwriteStatus.style.color = "#22c55e"; })
        .catch(() => { appwriteStatus.textContent = "✗ Unreachable"; appwriteStatus.style.color = "#ef4444"; });
    }

    // ── Developer — Appwrite data inspector ──
    document.getElementById("btn-ls-inspect")?.addEventListener("click", async () => {
      const out = document.getElementById("dev-ls-output");
      if (!out) return;
      out.classList.remove("hidden");
      out.textContent = "Loading…";
      const result = await DB.loadUserData();
      if (!result.ok) { out.textContent = "Failed to load: " + result.error; return; }
      out.innerHTML = Object.entries(result.data).map(([k, v]) => {
        const str = typeof v === "string" ? v : JSON.stringify(v, null, 2);
        return `<div class="dev-ls-key">${escapeHtml(k)}</div><pre class="dev-ls-val">${escapeHtml(str)}</pre>`;
      }).join("");
    });

    // ── Developer — Clear all data ──
    document.getElementById("btn-dev-clear-storage")?.addEventListener("click", async () => {
      const confirmed = await customConfirm("Wipe all your data from Appwrite? This cannot be undone.", "Clear All Data");
      if (!confirmed) return;
      await DB.saveUserData({ liked: [], queue: [], recent: [], playlists: [], settings: {} });
      Object.keys(localStorage).filter(k => k.startsWith("openmusic")).forEach(k => localStorage.removeItem(k));
      Auth.logout();
    });

    // ── Danger zone — Sign out ──
    const logoutBtn = document.getElementById("btn-account-logout");
    if (logoutBtn) {
      const fresh = logoutBtn.cloneNode(true);
      logoutBtn.parentNode.replaceChild(fresh, logoutBtn);
      fresh.addEventListener("click", () => Auth.logout());
    }

    // ── Danger zone — Delete account ──
    const deleteBtn = document.getElementById("btn-delete-account");
    if (deleteBtn) {
      const fresh = deleteBtn.cloneNode(true);
      deleteBtn.parentNode.replaceChild(fresh, deleteBtn);
      fresh.addEventListener("click", async () => {
        const confirmed = await customConfirm(
          "This will permanently delete your account and all your data. This cannot be undone.",
          "Delete Account"
        );
        if (!confirmed) return;
        await DB.saveUserData({ liked: [], queue: [], recent: [], playlists: [], settings: {} });
        await Auth.deleteAccount();
      });
    }
  }

  /* Sync the settings UI to reflect current saved values — called on open */
  function syncSettingsUI() {
    const s = collectSettings();

    // Crossfade
    const cfCheck = document.getElementById("set-crossfade");
    const cfDur   = document.getElementById("set-crossfade-dur");
    const cfLabel = document.getElementById("set-crossfade-label");
    if (cfCheck) cfCheck.checked = s.crossfade ?? true;
    if (cfDur)   { cfDur.value = s.crossfadeDur ?? 1.8; }
    if (cfLabel) cfLabel.textContent = (s.crossfadeDur ?? 1.8).toFixed(1) + " s";

    // Default quality
    const defQ = document.getElementById("set-default-quality");
    if (defQ) defQ.value = s.defaultQuality || "160kbps";

    // Dark mode
    const darkToggle = document.getElementById("set-dark-mode");
    if (darkToggle) darkToggle.checked = s.theme === "dark";

    // Compact sidebar
    const compactToggle = document.getElementById("set-compact-sidebar");
    if (compactToggle) compactToggle.checked = s.compactSidebar ?? false;

    // Dev mode
    const devToggle = document.getElementById("set-dev-mode");
    if (devToggle) devToggle.checked = s.devMode ?? false;
    document.getElementById("dev-panel")?.classList.toggle("hidden", !(s.devMode ?? false));
    const devBadge = document.getElementById("dev-badge");
    if (devBadge) {
      devBadge.textContent = s.devMode ? "ON" : "OFF";
      devBadge.classList.toggle("dev-badge--on", !!s.devMode);
    }

    // Dev sub-toggles
    const logToggle = document.getElementById("set-dev-logging");
    if (logToggle) logToggle.checked = s.devLogging ?? false;
    window._devLogging = s.devLogging ?? false;

    const statsToggle = document.getElementById("set-dev-stats");
    if (statsToggle) {
      statsToggle.checked = s.devStats ?? true;
      document.getElementById("sys-stats")?.classList.toggle("hidden", !(s.devStats ?? true));
    }

    const latToggle = document.getElementById("set-dev-latency");
    if (latToggle) latToggle.checked = s.devLatency ?? false;
  }

  function setupNav() {
    document.querySelectorAll(".nav-item").forEach(item => {
      item.addEventListener("click", () => {
        switchView(item.dataset.view);
        if (item.dataset.view === "library")   renderLibrary();
        if (item.dataset.view === "queue")     renderQueue();
        if (item.dataset.view === "recent")    renderRecent();
        if (item.dataset.view === "playlists") renderPlaylists();
        if (item.dataset.view === "settings")  syncSettingsUI();
      });
    });

    // Search form — always switch to search view then run the search
    document.getElementById("saavn-search-form")?.addEventListener("submit", () => {
      switchView("search");
    }, true); // capture phase so it fires before saavn-search.js handler

    document.getElementById("btn-clear-queue")?.addEventListener("click", () => {
      userQueue = []; persist(); renderQueue();
    });
    document.getElementById("btn-clear-recent")?.addEventListener("click", () => {
      recent = []; persist(); renderRecent();
    });
  }

  function setupUser(session) {
    const nick = session.nickname || session.name || "listener";
    const name   = document.getElementById("user-name");
    const email  = document.getElementById("user-email");
    const avatar = document.getElementById("user-avatar");
    if (name)   name.textContent   = nick;
    if (email)  email.textContent  = session.email;
    if (avatar) avatar.textContent = nick.charAt(0).toUpperCase();

    // Populate popup
    const popupName   = document.getElementById("popup-name");
    const popupEmail  = document.getElementById("popup-email");
    const popupAvatar = document.getElementById("popup-avatar");
    if (popupName)   popupName.textContent   = nick;
    if (popupEmail)  popupEmail.textContent  = session.email;
    if (popupAvatar) popupAvatar.textContent = nick.charAt(0).toUpperCase();

    // Populate account poster (settings page)
    const posterName   = document.getElementById("poster-name");
    const posterEmail  = document.getElementById("poster-email");
    const posterAvatar = document.getElementById("poster-avatar");
    if (posterName)   posterName.textContent   = nick;
    if (posterEmail)  posterEmail.textContent  = session.email;
    if (posterAvatar) posterAvatar.textContent = nick.charAt(0).toUpperCase();

    // User popup toggle
    const triggerBtn = document.getElementById("sidebar-user-btn");
    const popup      = document.getElementById("user-popup");
    if (triggerBtn && popup) {
      // Remove old listeners by cloning
      const freshTrigger = triggerBtn.cloneNode(true);
      triggerBtn.parentNode.replaceChild(freshTrigger, triggerBtn);

      function positionPopup() {
        const rect = freshTrigger.getBoundingClientRect();
        popup.style.left   = rect.left + "px";
        popup.style.width  = rect.width + "px";
        popup.style.bottom = (window.innerHeight - rect.top + 8) + "px";
        popup.style.top    = "auto";
      }

      function openPopup() {
        positionPopup();
        popup.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
      }

      function closePopup() {
        popup.classList.add("hidden");
      }

      freshTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        popup.classList.contains("hidden") ? openPopup() : closePopup();
      });
      freshTrigger.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          popup.classList.contains("hidden") ? openPopup() : closePopup();
        }
      });

      // Close on outside click
      document.addEventListener("click", (e) => {
        if (!popup.classList.contains("hidden") &&
            !popup.contains(e.target) &&
            !freshTrigger.contains(e.target)) {
          closePopup();
        }
      });

      // Reposition on scroll/resize
      window.addEventListener("resize", () => {
        if (!popup.classList.contains("hidden")) positionPopup();
      });

      // Popup buttons
      document.getElementById("popup-settings")?.addEventListener("click", () => {
        closePopup();
        switchView("settings");
        syncSettingsUI();
      });
      document.getElementById("popup-logout")?.addEventListener("click", () => Auth.logout());
    }
  }

  /* ── stagger index helpers ── */
  function applyStagger(container, selector) {
    if (!container) return;
    container.querySelectorAll(selector).forEach((el, i) => {
      el.style.setProperty("--i", i);
    });
  }

  /* Intersection observer for scroll-reveal */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  function observeReveal(container, selector) {
    if (!container) return;
    container.querySelectorAll(selector).forEach((el, i) => {
      el.style.setProperty("--i", i);
      revealObserver.observe(el);
    });
  }

  /* ── Character Animation ── */
  function setupCharacterAnimation() {
    const sprite = document.getElementById("character-sprite");
    if (!sprite) return;

    // Animation states
    const animations = {
      idle: "ani/Idle/Idle.gif",
      run: "ani/Run/Run.gif",
      jump: "ani/Jump/Jump.gif",
      jumpStart: "ani/Jump-Start/Jump-Start.gif",
      jumpEnd: "ani/Jump-End/Jump-End.gif",
      attack: "ani/Attack-01/Attack-01.gif",
      dead: "ani/Dead/Dead.gif"
    };

    let currentAnim = "idle";
    let animationTimeout = null;

    function setAnimation(anim, duration = null) {
      if (anim === currentAnim || !animations[anim]) return;
      currentAnim = anim;
      sprite.src = animations[anim];

      if (animationTimeout) clearTimeout(animationTimeout);
      if (duration) {
        animationTimeout = setTimeout(() => {
          const audioEl = document.getElementById("audio-player");
          const isPlaying = audioEl && !audioEl.paused;
          setAnimation(isPlaying ? "run" : "idle");
        }, duration);
      }
    }

    // Hook into audio events
    const audioEl = document.getElementById("audio-player");
    if (audioEl) {
      audioEl.addEventListener("play", () => setAnimation("run"));
      audioEl.addEventListener("pause", () => setAnimation("idle"));
      audioEl.addEventListener("ended", () => setAnimation("idle"));
    }

    // Click interaction - jump sequence
    sprite.style.cursor = "pointer";
    sprite.addEventListener("click", () => {
      setAnimation("jumpStart", 200);
      setTimeout(() => setAnimation("jump", 600), 200);
      setTimeout(() => setAnimation("jumpEnd", 200), 800);
    });

    // Double click - attack
    let lastClick = 0;
    sprite.addEventListener("dblclick", () => {
      setAnimation("attack", 800);
    });

    // Right click - dead animation (fun easter egg)
    sprite.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setAnimation("dead", 2000);
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space" && document.activeElement === document.body) {
        e.preventDefault();
        setAnimation("jump");
        setTimeout(() => {
          const isPlaying = audioEl && !audioEl.paused;
          setAnimation(isPlaying ? "run" : "idle");
        }, 600);
      }
    });
  }

  function setupQualityIndicator() {
    const select = document.getElementById("saavn-bitrate");
    const label  = select?.closest("label");
    if (!select || !label) return;

    function update() {
      label.classList.remove("q-320", "q-160", "q-96", "q-48");
      const val = select.value;
      if (val === "320kbps") label.classList.add("q-320");
      else if (val === "160kbps") label.classList.add("q-160");
      else if (val === "96kbps")  label.classList.add("q-96");
      else if (val === "48kbps")  label.classList.add("q-48");
    }

    select.addEventListener("change", update);
    update(); // set on load
  }

  /* ── System Stats (JS load + ping) ── */
  function setupSysStats() {
    const cpuBar   = document.getElementById("cpu-bar");
    const cpuValue = document.getElementById("cpu-value");
    const pingBar  = document.getElementById("ping-bar");
    const pingValue = document.getElementById("ping-value");
    if (!cpuBar || !pingBar) return;

    // ── JS thread busyness via scheduler timing ──
    // Measures how long a 0ms timeout actually takes → proxy for main-thread load
    let lastCpuPct = 0;
    function measureCpu() {
      const start = performance.now();
      setTimeout(() => {
        const delta = performance.now() - start; // ideal=0, busy=higher
        // Map 0–200ms delay → 0–100%
        const pct = Math.min(100, Math.round((delta / 200) * 100));
        // Smooth with EMA
        lastCpuPct = Math.round(lastCpuPct * 0.6 + pct * 0.4);
        const display = lastCpuPct;
        cpuValue.textContent = display + "%";
        cpuBar.style.width = display + "%";
        cpuBar.className = "sys-stat-bar" +
          (display > 75 ? " bar-red" : display > 40 ? " bar-amber" : " bar-green");
        setTimeout(measureCpu, 1500);
      }, 0);
    }
    measureCpu();

    // ── Network ping via fetch timing ──
    let pingUrl = "https://www.gstatic.com/generate_204"; // tiny Google endpoint
    let lastPing = 0;

    async function measurePing() {
      try {
        const t0 = performance.now();
        await fetch(pingUrl + "?t=" + t0, {
          method: "HEAD", mode: "no-cors", cache: "no-store"
        });
        const ms = Math.round(performance.now() - t0);
        lastPing = Math.round(lastPing * 0.5 + ms * 0.5);
        const display = lastPing;
        pingValue.textContent = display + " ms";
        // Bar: 0–500ms range, capped
        const pct = Math.min(100, Math.round((display / 500) * 100));
        pingBar.style.width = pct + "%";
        pingBar.className = "sys-stat-bar" +
          (display > 300 ? " bar-red" : display > 100 ? " bar-amber" : " bar-green");
      } catch {
        pingValue.textContent = "offline";
        pingBar.style.width = "100%";
        pingBar.className = "sys-stat-bar bar-red";
      }
      setTimeout(measurePing, 4000);
    }
    measurePing();
  }

  /* ── init ── */
  async function init() {
    const session = Auth.requireAuth();
    if (!session) return;

    setupTheme();
    setupUser(session);
    setupQualityIndicator();
    setupSysStats();

    // Load all user data from Appwrite before rendering
    await loadUserLists();

    setupNav();
    setupSidebarToggle();
    setupModal();
    setupAlertDialog();
    setupSettingsView();   // bind listeners once
    Player.init();
    setupCharacterAnimation();

    await SaavnSearch.init("#saavn-results");
    renderLibrary();
    renderQueue();
    renderRecent();
    renderPlaylists();
    syncSettingsUI();      // reflect loaded prefs in the UI
    await loadHome();
    await new Promise(r => setTimeout(r, 2500));
    await SaavnSearch.runInitialSearch();

    // Refresh Appwrite session silently in background after everything loads.
    // Never log out on failure — localStorage session is the source of truth.
    Auth.refreshSession().then(fresh => {
      if (fresh && fresh.id) setupUser(fresh);
    }).catch(() => {});
  }

  return {
    init,
    renderTrackCard,
    bindTrackActions,
    findTrackById,
    isLiked,
    toggleLike,
    addToQueue,
    getQueue,
    onTrackPlayed,
    downloadTrack,
    playTrack,
  };
})();

window.App = App;
