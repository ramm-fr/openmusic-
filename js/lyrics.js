/**
 * lyrics.js — Lyrics fetcher using api.lyrics.ovh (free, no key needed)
 *
 * Usage: Lyrics.show(track)
 */

const Lyrics = (() => {

  // ── Fetch lyrics ──────────────────────────────────────────────────────────

  async function fetch(artist, title) {
    // Clean up artist/title — remove features, brackets etc.
    const cleanArtist = artist.split(",")[0].split("feat.")[0].split("ft.")[0].trim();
    const cleanTitle  = title.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim();

    // Attempt 1 — exact artist + title
    try {
      const res = await window.fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.lyrics) return data.lyrics.trim();
      }
    } catch (_) {}

    // Attempt 2 — first word of artist + title (handles "Artist feat. X" cases)
    const shortArtist = cleanArtist.split(" ")[0];
    if (shortArtist !== cleanArtist) {
      try {
        const res = await window.fetch(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(shortArtist)}/${encodeURIComponent(cleanTitle)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.lyrics) return data.lyrics.trim();
        }
      } catch (_) {}
    }

    // Attempt 3 — suggest search (show partial results from lyrics.ovh suggest)
    try {
      const res = await window.fetch(
        `https://api.lyrics.ovh/suggest/${encodeURIComponent(cleanTitle)}`
      );
      if (res.ok) {
        const data = await res.json();
        const match = (data.data || []).find(s =>
          s.artist?.name?.toLowerCase().includes(cleanArtist.toLowerCase()) ||
          cleanArtist.toLowerCase().includes(s.artist?.name?.toLowerCase())
        );
        if (match) {
          const res2 = await window.fetch(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(match.artist.name)}/${encodeURIComponent(match.title)}`
          );
          if (res2.ok) {
            const data2 = await res2.json();
            if (data2.lyrics) return data2.lyrics.trim();
          }
        }
      }
    } catch (_) {}

    throw new Error("Lyrics not found");
  }

  // ── Modal HTML (injected once) ────────────────────────────────────────────

  function ensureModal() {
    if (document.getElementById("lyrics-modal")) return;
    const modal = document.createElement("div");
    modal.id = "lyrics-modal";
    modal.className = "lyrics-modal-backdrop hidden";
    modal.innerHTML = `
      <div class="lyrics-modal" role="dialog" aria-modal="true" aria-labelledby="lyrics-title">
        <div class="lyrics-modal-header">
          <div class="lyrics-modal-track">
            <img id="lyrics-art" src="" alt="" class="lyrics-art hidden" />
            <div>
              <h3 id="lyrics-title" class="lyrics-track-name">—</h3>
              <p id="lyrics-artist" class="lyrics-track-artist">—</p>
            </div>
          </div>
          <button type="button" class="icon-btn" id="lyrics-close" title="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="lyrics-body" id="lyrics-body">
          <div class="lyrics-loading">
            <i data-lucide="loader-2" class="lyrics-spinner"></i>
            <span>Loading lyrics…</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on backdrop click
    modal.addEventListener("click", e => {
      if (e.target === modal) hide();
    });
    document.getElementById("lyrics-close").addEventListener("click", hide);

    // Close on Escape
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) hide();
    });
  }

  // ── Show / hide ───────────────────────────────────────────────────────────

  function hide() {
    document.getElementById("lyrics-modal")?.classList.add("hidden");
  }

  async function show(track) {
    if (!track) return;
    ensureModal();

    const modal     = document.getElementById("lyrics-modal");
    const titleEl   = document.getElementById("lyrics-title");
    const artistEl  = document.getElementById("lyrics-artist");
    const artEl     = document.getElementById("lyrics-art");
    const bodyEl    = document.getElementById("lyrics-body");

    // Set track info
    titleEl.textContent  = track.name  || "—";
    artistEl.textContent = track.artist || "—";
    if (track.image) {
      artEl.src = track.image;
      artEl.classList.remove("hidden");
    } else {
      artEl.classList.add("hidden");
    }

    // Show loading state
    bodyEl.innerHTML = `
      <div class="lyrics-loading">
        <i data-lucide="loader-2" class="lyrics-spinner"></i>
        <span>Loading lyrics…</span>
      </div>`;
    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();

    // Fetch
    try {
      const text = await fetch(track.artist, track.name);
      // Format: each line as a <p>
      const lines = text.split("\n");
      bodyEl.innerHTML = lines.map(line =>
        line.trim()
          ? `<p class="lyrics-line">${escapeHtml(line)}</p>`
          : `<p class="lyrics-line-break"></p>`
      ).join("");
    } catch {
      bodyEl.innerHTML = `
        <div class="lyrics-not-found">
          <i data-lucide="mic-off"></i>
          <p>Lyrics not found for this track.</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  return { show, hide };
})();

window.Lyrics = Lyrics;
