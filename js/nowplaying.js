/**
 * nowplaying.js — Fullscreen Now Playing overlay
 *
 * Opens when user clicks the player bar track area.
 * Left: album art + controls  |  Right: synced lyrics
 *
 * Lyrics sync: api.lyrics.ovh returns plain text lyrics (no timestamps).
 * We split into lines and highlight the current line by estimating position
 * based on audio currentTime / duration.
 */

const NowPlaying = (() => {

  let isOpen       = false;
  let lyricsLines  = [];   // array of strings
  let currentLine  = -1;
  let rafId        = null;

  // ── DOM refs (set after inject) ──────────────────────────────────────────

  const $ = id => document.getElementById(id);

  // ── Inject overlay HTML ──────────────────────────────────────────────────

  function inject() {
    if ($("np-overlay")) return;

    const el = document.createElement("div");
    el.id = "np-overlay";
    el.className = "np-overlay np-hidden";
    el.innerHTML = `
      <!-- Close button -->
      <button class="np-close icon-btn" id="np-close" title="Close">
        <i data-lucide="chevron-down"></i>
      </button>

      <!-- Two-column layout -->
      <div class="np-layout">

        <!-- LEFT — art + info + controls -->
        <div class="np-left">
          <div class="np-art-wrap">
            <img id="np-art" src="" alt="" class="np-art hidden" />
            <div class="np-art-placeholder hidden" id="np-art-placeholder">
              <i data-lucide="music-4"></i>
            </div>
            <!-- Spinning vinyl ring -->
            <div class="np-vinyl-ring" id="np-vinyl-ring"></div>
          </div>

          <div class="np-track-info">
            <h2 id="np-title" class="np-title">—</h2>
            <p  id="np-artist" class="np-artist">—</p>
          </div>

          <!-- Like + download row -->
          <div class="np-actions">
            <button type="button" class="icon-btn" id="np-btn-like" title="Like">
              <i data-lucide="heart"></i>
            </button>
            <button type="button" class="icon-btn" id="np-btn-download" title="Download">
              <i data-lucide="download"></i>
            </button>
            <button type="button" class="icon-btn" id="np-btn-queue" title="Add to queue">
              <i data-lucide="list-plus"></i>
            </button>
          </div>

          <!-- Progress bar -->
          <div class="np-progress-wrap">
            <span id="np-time-current" class="np-time">0:00</span>
            <input type="range" id="np-progress" class="np-progress" min="0" max="100" value="0" />
            <span id="np-time-total" class="np-time">0:00</span>
          </div>

          <!-- Controls -->
          <div class="np-controls">
            <button type="button" class="icon-btn" id="np-btn-shuffle" title="Shuffle">
              <i data-lucide="shuffle"></i>
            </button>
            <button type="button" class="icon-btn" id="np-btn-prev" title="Previous">
              <i data-lucide="skip-back"></i>
            </button>
            <button type="button" class="icon-btn np-play-btn" id="np-btn-play" title="Play/Pause">
              <i data-lucide="play"  id="np-icon-play"></i>
              <i data-lucide="pause" id="np-icon-pause" class="hidden"></i>
            </button>
            <button type="button" class="icon-btn" id="np-btn-next" title="Next">
              <i data-lucide="skip-forward"></i>
            </button>
            <button type="button" class="icon-btn" id="np-btn-repeat" title="Repeat">
              <i data-lucide="repeat"></i>
            </button>
          </div>

          <!-- Volume -->
          <div class="np-volume-wrap">
            <i data-lucide="volume-1" class="np-vol-icon"></i>
            <input type="range" id="np-volume" class="np-volume" min="0" max="100" value="80" />
            <i data-lucide="volume-2" class="np-vol-icon"></i>
          </div>
        </div>

        <!-- RIGHT — lyrics -->
        <div class="np-right">
          <div class="np-lyrics-header">
            <i data-lucide="mic-2"></i>
            <span>Lyrics</span>
          </div>
          <div class="np-lyrics-scroll" id="np-lyrics-scroll">
            <div class="np-lyrics-loading" id="np-lyrics-loading">
              <i data-lucide="loader-2" class="np-lyrics-spinner"></i>
              <span>Loading lyrics…</span>
            </div>
          </div>
        </div>

      </div>
    `;
    document.body.appendChild(el);

    bindControls();
  }

  // ── Bind control buttons ─────────────────────────────────────────────────

  function bindControls() {
    $("np-close").addEventListener("click", hide);

    // Close on Escape
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isOpen) hide();
    });

    // Progress seek
    $("np-progress").addEventListener("input", () => {
      const a = document.getElementById("audio-player");
      if (a?.duration) a.currentTime = ($("np-progress").value / 100) * a.duration;
    });

    // Volume
    $("np-volume").addEventListener("input", () => {
      const a = document.getElementById("audio-player");
      if (a) a.volume = $("np-volume").value / 100;
      // sync main volume slider
      const mainVol = document.getElementById("volume");
      if (mainVol) mainVol.value = $("np-volume").value;
    });

    // Play/Pause
    $("np-btn-play").addEventListener("click", () => {
      if (window.Player) Player.togglePlay?.() || (() => {
        const a = document.getElementById("audio-player");
        if (!a) return;
        a.paused ? a.play() : a.pause();
      })();
    });

    // Prev / Next
    $("np-btn-prev").addEventListener("click", () => window.Player?.playPrev());
    $("np-btn-next").addEventListener("click", () => window.Player?.playNext());

    // Shuffle / Repeat — mirror the main player buttons
    $("np-btn-shuffle").addEventListener("click", () => {
      document.getElementById("btn-shuffle")?.click();
      $("np-btn-shuffle").classList.toggle("active",
        document.getElementById("btn-shuffle")?.classList.contains("active"));
    });
    $("np-btn-repeat").addEventListener("click", () => {
      document.getElementById("btn-repeat")?.click();
      $("np-btn-repeat").classList.toggle("active",
        document.getElementById("btn-repeat")?.classList.contains("active"));
    });

    // Like
    $("np-btn-like").addEventListener("click", () => {
      const track = window.Player?.current;
      if (track && window.App) App.toggleLike(track);
      updateLikeBtn();
    });

    // Download
    $("np-btn-download").addEventListener("click", () => {
      const track = window.Player?.current;
      if (track && window.App) App.downloadTrack(track.id, track);
    });

    // Add to queue
    $("np-btn-queue").addEventListener("click", () => {
      const track = window.Player?.current;
      if (track && window.App) App.addToQueue(track);
    });

    // Audio events → update overlay UI
    const audio = document.getElementById("audio-player");
    if (audio) {
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("play",  () => updatePlayPauseUI(true));
      audio.addEventListener("pause", () => updatePlayPauseUI(false));
    }
  }

  // ── Audio sync ───────────────────────────────────────────────────────────

  function onTimeUpdate() {
    if (!isOpen) return;
    const a = document.getElementById("audio-player");
    if (!a?.duration) return;

    const cur   = a.currentTime;
    const total = a.duration;
    const pct   = (cur / total) * 100;

    $("np-progress").value        = pct;
    $("np-time-current").textContent = formatTime(cur);
    $("np-time-total").textContent   = formatTime(total);

    // Sync lyrics highlight
    if (lyricsLines.length > 1) {
      const lineIdx = Math.floor((cur / total) * lyricsLines.length);
      const clamped = Math.min(lineIdx, lyricsLines.length - 1);
      if (clamped !== currentLine) {
        currentLine = clamped;
        highlightLine(currentLine);
      }
    }
  }

  function highlightLine(idx) {
    const scroll = $("np-lyrics-scroll");
    if (!scroll) return;
    const lines = scroll.querySelectorAll(".np-lyric-line");
    lines.forEach((el, i) => {
      el.classList.toggle("np-lyric-active",   i === idx);
      el.classList.toggle("np-lyric-past",     i < idx);
      el.classList.toggle("np-lyric-upcoming", i > idx);
    });
    // Auto-scroll active line into centre
    const activeLine = lines[idx];
    if (activeLine) {
      activeLine.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function updatePlayPauseUI(playing) {
    $("np-icon-play")?.classList.toggle("hidden", playing);
    $("np-icon-pause")?.classList.toggle("hidden", !playing);
  }

  function updateLikeBtn() {
    const track = window.Player?.current;
    const liked = track && window.App ? App.isLiked(track.id) : false;
    $("np-btn-like")?.classList.toggle("liked", liked);
    const icon = $("np-btn-like");
    if (icon && window.lucide) {
      icon.innerHTML = `<i data-lucide="heart"></i>`;
      lucide.createIcons();
    }
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ── Update overlay with current track ────────────────────────────────────

  function updateTrack(track) {
    if (!track) return;

    $("np-title").textContent  = track.name   || "—";
    $("np-artist").textContent = track.artist || "—";

    const art         = $("np-art");
    const placeholder = $("np-art-placeholder");
    if (track.image) {
      art.onload  = () => { art.classList.remove("hidden"); placeholder?.classList.add("hidden"); };
      art.onerror = () => { art.classList.add("hidden"); placeholder?.classList.remove("hidden"); };
      art.src = track.image;
      // If already cached, onload may not fire — force show
      if (art.complete && art.naturalWidth) {
        art.classList.remove("hidden");
        placeholder?.classList.add("hidden");
      }
    } else {
      art.classList.add("hidden");
      placeholder?.classList.remove("hidden");
    }

    // Sync volume
    const mainVol = document.getElementById("volume");
    if (mainVol) $("np-volume").value = mainVol.value;

    // Sync play state
    const a = document.getElementById("audio-player");
    updatePlayPauseUI(a ? !a.paused : false);

    updateLikeBtn();

    // Load lyrics
    loadLyrics(track);
  }

  // ── Lyrics loading ────────────────────────────────────────────────────────

  async function loadLyrics(track) {
    const scroll = $("np-lyrics-scroll");
    if (!scroll) return;

    lyricsLines = [];
    currentLine = -1;

    scroll.innerHTML = `
      <div class="np-lyrics-loading">
        <i data-lucide="loader-2" class="np-lyrics-spinner"></i>
        <span>Loading lyrics…</span>
      </div>`;
    if (window.lucide) lucide.createIcons();

    try {
      const text = await fetchLyrics(track.artist, track.name);
      // Split into non-empty lines
      lyricsLines = text.split("\n").map(l => l.trim());

      scroll.innerHTML = lyricsLines.map((line, i) =>
        line
          ? `<p class="np-lyric-line np-lyric-upcoming" data-i="${i}">${escHtml(line)}</p>`
          : `<p class="np-lyric-spacer"></p>`
      ).join("");

      // Immediately highlight based on current time
      const a = document.getElementById("audio-player");
      if (a?.duration) {
        const idx = Math.floor((a.currentTime / a.duration) * lyricsLines.length);
        currentLine = Math.min(idx, lyricsLines.length - 1);
        highlightLine(currentLine);
      }
    } catch {
      scroll.innerHTML = `
        <div class="np-lyrics-not-found">
          <i data-lucide="mic-off"></i>
          <p>Lyrics not available for this track.</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  async function fetchLyrics(artist, title) {
    const cleanArtist = artist.split(",")[0].split("feat.")[0].split("ft.")[0].trim();
    const cleanTitle  = title.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim();

    // Attempt 1 — direct with cleaned artist + title
    try {
      const r = await window.fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`
      );
      if (r.ok) {
        const d = await r.json();
        if (d.lyrics) return d.lyrics.trim();
      }
    } catch (_) {}

    // Attempt 2 — suggest by title to find correct artist
    try {
      const res = await window.fetch(
        `https://api.lyrics.ovh/suggest/${encodeURIComponent(cleanTitle)}`
      );
      if (res.ok) {
        const data = await res.json();
        const titleLower = cleanTitle.toLowerCase();
        const match = (data.data || []).find(s =>
          s.title?.toLowerCase().includes(titleLower) ||
          titleLower.includes(s.title?.toLowerCase())
        ) || (data.data || [])[0];
        if (match) {
          const r2 = await window.fetch(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(match.artist.name)}/${encodeURIComponent(match.title)}`
          );
          if (r2.ok) {
            const d2 = await r2.json();
            if (d2.lyrics) return d2.lyrics.trim();
          }
        }
      }
    } catch (_) {}

    // Attempt 3 — first word of artist only
    const shortArtist = cleanArtist.split(" ")[0];
    if (shortArtist !== cleanArtist) {
      try {
        const r = await window.fetch(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(shortArtist)}/${encodeURIComponent(cleanTitle)}`
        );
        if (r.ok) {
          const d = await r.json();
          if (d.lyrics) return d.lyrics.trim();
        }
      } catch (_) {}
    }

    throw new Error("not found");
  }

  function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function show() {
    inject();

    const overlay = $("np-overlay");
    overlay.classList.remove("np-hidden");
    overlay.classList.add("np-visible");
    isOpen = true;

    // Use requestAnimationFrame to ensure DOM is painted before updating
    requestAnimationFrame(() => {
      const track = window.Player?.current;
      console.log("[NowPlaying] show() — track:", track);
      console.log("[NowPlaying] np-art el:", $("np-art"));
      console.log("[NowPlaying] np-lyrics-scroll el:", $("np-lyrics-scroll"));
      if (track) updateTrack(track);
      if (window.lucide) lucide.createIcons();
    });

    // Prevent body scroll
    document.body.style.overflow = "hidden";
  }

  function hide() {
    const overlay = $("np-overlay");
    if (!overlay) return;
    overlay.classList.remove("np-visible");
    overlay.classList.add("np-hidden");
    isOpen = false;
    document.body.style.overflow = "";
  }

  // Called by player when track changes
  function onTrackChange(track) {
    if (!isOpen) return;
    updateTrack(track);
  }

  return { show, hide, onTrackChange, get isOpen() { return isOpen; } };
})();

window.NowPlaying = NowPlaying;
