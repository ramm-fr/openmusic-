const SaavnAPI = (() => {
  const BASE = "https://jiosaavn.rajputhemant.dev";

  // Supported languages
  const SUPPORTED_LANGS = new Set([
    "english", "hindi", "telugu", "tamil",
    "kannada", "malayalam", "punjabi", "bengali", "marathi"
  ]);

  // ── Rate limiter ──────────────────────────────────────────────────────────
  const queue = [];
  let busy = false;
  let lastSentAt = 0;
  const INTERVAL   = 1200;
  const BACKOFF_MS = 4000;
  const MAX_RETRY  = 3;

  function enqueue(url) {
    return new Promise((resolve, reject) => {
      queue.push({ url, resolve, reject, attempts: 0 });
      drain();
    });
  }

  async function drain() {
    if (busy || !queue.length) return;
    busy = true;

    const gap = INTERVAL - (Date.now() - lastSentAt);
    if (gap > 0) await sleep(gap);

    const item = queue[0];
    item.attempts++;
    lastSentAt = Date.now();

    let res;
    try {
      res = await fetch(item.url);
    } catch (err) {
      queue.shift();
      busy = false;
      item.reject(err);
      drain();
      return;
    }

    if (res.status === 429 && item.attempts < MAX_RETRY) {
      busy = false;
      await sleep(BACKOFF_MS * item.attempts);
      drain();
      return;
    }

    queue.shift();
    busy = false;
    item.resolve(res);
    drain();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Language helpers ──────────────────────────────────────────────────────
  function getLang(track) {
    return (track.language || track.lang || "").toLowerCase().trim();
  }

  function isLangAllowed(track, filter = "all") {
    if (filter === "all") return true;
    return getLang(track) === filter.toLowerCase();
  }

  // Keep backward compat — used by old code
  function isEnglish(track) { return getLang(track) === "english"; }

  function langBadge(lang) {
    const map = {
      english:   "EN",
      hindi:     "HI",
      telugu:    "TE",
      tamil:     "TA",
      kannada:   "KN",
      malayalam: "ML",
      punjabi:   "PA",
      bengali:   "BN",
      marathi:   "MR",
    };
    return map[lang] || (lang ? lang.slice(0, 2).toUpperCase() : "—");
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  function dedupeById(tracks) {
    const seen = new Set();
    return tracks.filter(t => {
      if (!t?.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }

  function smartDedupe(tracks) {
    const seen = new Map();
    return tracks.filter(t => {
      if (!t?.name || !t?.artist) return false;
      const key = `${t.name.toLowerCase().trim()}|${t.artist.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.set(key, t);
      return true;
    });
  }

  // ── Original-only filter ─────────────────────────────────────────────────
  // Blocks covers, remixes, karaoke, tributes, mashups, instrumentals etc.
  const NON_ORIGINAL_PATTERNS = [
    /\bremix\b/i,
    /\bcover\b/i,
    /\bkaraoke\b/i,
    /\btribute\b/i,
    /\bmashup\b/i,
    /\binstrumental\b/i,
    /\bacoustic version\b/i,
    /\bacoustic cover\b/i,
    /\bpiano version\b/i,
    /\bstring version\b/i,
    /\borchestral\b/i,
    /\bnightcore\b/i,
    /\bslowed\b/i,
    /\breverb\b/i,
    /\blofi\b/i,
    /\blo-fi\b/i,
    /\b8 bit\b/i,
    /\b8bit\b/i,
    /\bchillout\b/i,
    /\bbollywood mix\b/i,
    /\bjukebox\b/i,
    /\bfull album\b/i,
    /\bmedley\b/i,
    /\bmade famous\b/i,
    /\bin the style of\b/i,
    /\boriginally performed\b/i,
    /\bsped up\b/i,
    /\btiktok\b/i,
  ];

  function isOriginal(raw) {
    const name   = (raw.name   || "").toLowerCase();
    const album  = (typeof raw.album === "string" ? raw.album : raw.album?.name || "").toLowerCase();
    const artist = (raw.primaryArtists || raw.music || "").toLowerCase();

    // Check name, album and artist for non-original patterns
    for (const pat of NON_ORIGINAL_PATTERNS) {
      if (pat.test(name))   return false;
      if (pat.test(album))  return false;
      if (pat.test(artist)) return false;
    }
    return true;
  }
  function getImage(track, preferLarge = false) {
    const images = track.image || [];
    if (!images.length) return "";
    const order = preferLarge
      ? ["500x500", "150x150", "50x50"]
      : ["150x150", "500x500", "50x50"];
    for (const q of order) {
      const found = images.find(i => i.quality === q || i.quality?.includes(q));
      if (found?.link) return found.link;
      if (found?.url)  return found.url;
    }
    return images[images.length - 1]?.link || images[images.length - 1]?.url || "";
  }

  function getArtist(track) {
    if (track.primaryArtists) return track.primaryArtists;
    if (track.music)          return track.music;
    const artists = track.artist_map?.artists;
    if (artists?.length) return artists.map(a => a.name).join(", ");
    return track.subtitle?.split(" - ")[0] || "Unknown artist";
  }

  function getAlbumName(track) {
    const album = track.album;
    if (!album) return "";
    if (typeof album === "string") return album === track.name ? "" : album;
    return album.name === track.name ? "" : album.name || "";
  }

  function getDownloadUrls(track) {
    const urls = track.download_url || track.downloadUrl || [];
    const map = {};
    urls.forEach((u, i) => {
      const quality = u.quality || `${i}`;
      map[quality] = u.link || u.url;
    });
    return map;
  }

  function getStreamUrl(track, quality = "160kbps") {
    const source = track?.raw || track;
    const map    = track?.downloadMap || getDownloadUrls(source);
    const order  = [quality, "320kbps", "160kbps", "96kbps", "48kbps", "12kbps"];
    for (const q of order) {
      if (map[q]) return map[q];
    }
    return Object.values(map)[0] || "";
  }

  function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return "--:--";
    const s = Math.floor(Number(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function normalizeTrack(raw) {
    const lang = getLang(raw);
    return {
      id:            raw.id,
      name:          raw.name,
      album:         getAlbumName(raw),
      artist:        getArtist(raw),
      year:          raw.year || "",
      language:      lang,
      langBadge:     langBadge(lang),
      image:         getImage(raw, true),
      duration:      raw.duration,
      durationLabel: formatDuration(raw.duration),
      downloadMap:   getDownloadUrls(raw),
      raw,
    };
  }

  // ── Public searchSongs ────────────────────────────────────────────────────
  // langFilter: "all" | "english" | "hindi" | "telugu" | "tamil" | ...
  async function searchSongs(query, page = 1, limit = 20, langFilter = "all") {
    const q   = encodeURIComponent(query.trim());
    const url = `${BASE}/search/songs?q=${q}&page=${page}&n=${limit}`;
    const res = await enqueue(url);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const json = await res.json();
    if (json.status !== "Success" && json.status !== "success") {
      throw new Error(json.message || "Search failed");
    }
    const results = json.data?.results || [];

    // Filter by language — keep only supported languages unless "all"
    // Also filter out non-original tracks (covers, remixes, karaoke etc.)
    const filtered = results.filter(t => {
      const l = getLang(t);
      if (!SUPPORTED_LANGS.has(l)) return false;
      if (!isOriginal(t)) return false;
      if (langFilter === "all") return true;
      return l === langFilter.toLowerCase();
    });

    return {
      tracks: dedupeById(filtered).map(normalizeTrack),
      total:  json.data?.total || filtered.length,
      page,
    };
  }

  // backward-compat wrapper used by loadHome / catalog fetches
  function filterEnglishOnly(tracks) {
    return dedupeById(tracks.filter(isEnglish));
  }

  return {
    BASE,
    SUPPORTED_LANGS,
    searchSongs,
    filterEnglishOnly,
    isOriginal,
    dedupeById,
    smartDedupe,
    normalizeTrack,
    getStreamUrl,
    formatDuration,
    getLang,
    langBadge,
    isEnglish,
  };
})();
