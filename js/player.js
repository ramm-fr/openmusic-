const Player = (() => {
  const audio = () => document.getElementById("audio-player");
  let currentTrack = null;
  let queue = [];
  let queueIndex = -1;
  let shuffle = false;
  let repeat = false;

  // ── Crossfade state ──────────────────────────────────────────────────────
  const FADE_DURATION_DEFAULT = 1800;
  let FADE_DURATION = FADE_DURATION_DEFAULT;
  let fadeOutAudio = null;      // the outgoing audio element
  let fadeInRaf    = null;      // requestAnimationFrame handle for fade-in
  let fadeOutRaf   = null;      // requestAnimationFrame handle for fade-out

  function cancelFades() {
    if (fadeInRaf)  { cancelAnimationFrame(fadeInRaf);  fadeInRaf  = null; }
    if (fadeOutRaf) { cancelAnimationFrame(fadeOutRaf); fadeOutRaf = null; }
    if (fadeOutAudio) {
      fadeOutAudio.pause();
      fadeOutAudio.src = "";
      fadeOutAudio = null;
    }
  }

  // Animate volume from `from` → `to` over FADE_DURATION ms
  function animateVolume(el, from, to, onDone) {
    const start = performance.now();
    el.volume = Math.max(0, Math.min(1, from));
    function step(now) {
      const t = Math.min(1, (now - start) / FADE_DURATION);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) {
        return requestAnimationFrame(step);
      } else {
        el.volume = Math.max(0, Math.min(1, to));
        onDone && onDone();
        return null;
      }
    }
    return requestAnimationFrame(step);
  }

  function getTargetVolume() {
    const vol = document.getElementById("volume");
    return vol ? vol.value / 100 : 0.8;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function updatePlayPauseUI(playing) {
    document.getElementById("icon-play")?.classList.toggle("hidden", playing);
    document.getElementById("icon-pause")?.classList.toggle("hidden", !playing);
  }

  function setNowPlaying(track) {
    currentTrack = track;
    const title = document.getElementById("player-title");
    const artist = document.getElementById("player-artist");
    const art = document.getElementById("player-art");
    const placeholder = document.getElementById("player-art-placeholder");
    const likeBtn = document.getElementById("btn-player-like");

    if (title) title.textContent = track?.name || "—";
    if (artist) artist.textContent = track?.artist || "Select a song to start";

    if (track?.image) {
      art.src = track.image;
      art.alt = track.name;
      art.classList.remove("hidden");
      art.classList.add("is-playing");
      placeholder?.classList.add("hidden");
    } else {
      art?.classList.add("hidden");
      art?.classList.remove("is-playing");
      placeholder?.classList.remove("hidden");
    }

    if (likeBtn && window.App) {
      likeBtn.classList.toggle("liked", App.isLiked(track?.id));
    }

    document.querySelectorAll(".song-card.playing").forEach((el) => el.classList.remove("playing"));
    if (track?.id) {
      document.querySelectorAll(`.song-card[data-id="${track.id}"]`).forEach((el) => {
        el.classList.add("playing");
      });
    }
  }

  function playTrack(track, streamUrl) {
    if (!track || !streamUrl) return;
    const a = audio();
    const quality = document.getElementById("saavn-bitrate")?.value || "160kbps";
    const url = streamUrl || SaavnAPI.getStreamUrl(track.raw || track, quality);
    const targetVol = getTargetVolume();

    // Cancel any in-progress fades
    cancelFades();

    // If something is already playing, crossfade out the old audio
    if (!a.paused && a.src && a.currentTime > 0) {
      // Clone the current audio element to let it fade out independently
      const outgoing = new Audio(a.src);
      outgoing.currentTime = a.currentTime;
      outgoing.volume = a.volume;
      outgoing.muted  = a.muted;
      outgoing.play().catch(() => {});
      fadeOutAudio = outgoing;

      // Fade out the outgoing clone
      fadeOutRaf = animateVolume(outgoing, outgoing.volume, 0, () => {
        outgoing.pause();
        outgoing.src = "";
        fadeOutAudio = null;
      });

      // Load new track at volume 0, fade in
      a.src = url;
      a.volume = 0;
      a.play().catch(() => {});
      fadeInRaf = animateVolume(a, 0, targetVol, () => {
        fadeInRaf = null;
      });
    } else {
      // Nothing playing — just start immediately, no fade needed
      a.src = url;
      a.volume = targetVol;
      a.play().catch(() => {});
    }

    setNowPlaying(track);
    updatePlayPauseUI(true);
    if (window.App) App.onTrackPlayed(track);
    if (window.NowPlaying) NowPlaying.onTrackChange(track);
  }

  function playById(id, url) {
    const track = window.App?.findTrackById(id);
    if (track) playTrack(track, url || SaavnAPI.getStreamUrl(track.raw, getQuality()));
  }

  function getQuality() {
    return document.getElementById("saavn-bitrate")?.value || "160kbps";
  }

  function togglePlay() {
    const a = audio();
    if (!a.src) return;
    if (a.paused) {
      a.play();
      updatePlayPauseUI(true);
    } else {
      a.pause();
      updatePlayPauseUI(false);
    }
  }

  function setQueue(tracks, startIndex = 0) {
    queue = tracks.slice();
    queueIndex = startIndex;
  }

  function playQueueIndex(idx) {
    if (!queue.length) return;
    queueIndex = idx;
    const track = queue[queueIndex];
    if (track) playTrack(track, SaavnAPI.getStreamUrl(track.raw, getQuality()));
  }

  function playNext() {
    if (!queue.length && window.App) {
      const q = App.getQueue();
      if (q.length) setQueue(q, 0);
    }
    if (!queue.length) return;

    if (shuffle) {
      let next = Math.floor(Math.random() * queue.length);
      if (queue.length > 1) {
        while (next === queueIndex) next = Math.floor(Math.random() * queue.length);
      }
      playQueueIndex(next);
      return;
    }

    let next = queueIndex + 1;
    if (next >= queue.length) {
      if (repeat) next = 0;
      else return;
    }
    playQueueIndex(next);
  }

  function playPrev() {
    const a = audio();
    if (a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    if (!queue.length) return;
    let prev = queueIndex - 1;
    if (prev < 0) prev = repeat ? queue.length - 1 : 0;
    playQueueIndex(prev);
  }

  function init() {
    const a = audio();
    const progress = document.getElementById("progress");
    const volume = document.getElementById("volume");

    a.volume = (volume?.value ?? 80) / 100;

    document.getElementById("btn-play-pause")?.addEventListener("click", togglePlay);
    document.getElementById("btn-next")?.addEventListener("click", playNext);
    document.getElementById("btn-prev")?.addEventListener("click", playPrev);

    document.getElementById("btn-shuffle")?.addEventListener("click", (e) => {
      shuffle = !shuffle;
      e.currentTarget.classList.toggle("active", shuffle);
    });

    document.getElementById("btn-repeat")?.addEventListener("click", (e) => {
      repeat = !repeat;
      e.currentTarget.classList.toggle("active", repeat);
    });

    document.getElementById("btn-mute")?.addEventListener("click", () => {
      a.muted = !a.muted;
      document.getElementById("icon-volume")?.classList.toggle("hidden", a.muted);
      document.getElementById("icon-muted")?.classList.toggle("hidden", !a.muted);
    });

    volume?.addEventListener("input", () => {
      cancelFades();
      a.volume = volume.value / 100;
      a.muted = false;
    });

    progress?.addEventListener("input", () => {
      if (a.duration) a.currentTime = (progress.value / 100) * a.duration;
    });

    a.addEventListener("timeupdate", () => {
      if (!a.duration) return;
      progress.value = (a.currentTime / a.duration) * 100;
      document.getElementById("time-current").textContent = formatTime(a.currentTime);
      document.getElementById("time-total").textContent = formatTime(a.duration);
    });

    a.addEventListener("play", () => updatePlayPauseUI(true));
    a.addEventListener("pause", () => updatePlayPauseUI(false));
    a.addEventListener("ended", () => playNext());

    document.getElementById("btn-player-like")?.addEventListener("click", () => {
      if (currentTrack && window.App) App.toggleLike(currentTrack);
    });

    document.getElementById("btn-add-queue")?.addEventListener("click", () => {
      if (currentTrack && window.App) App.addToQueue(currentTrack, true);
    });

    document.getElementById("btn-download")?.addEventListener("click", () => {
      if (currentTrack && window.App) App.downloadTrack(currentTrack.id, currentTrack);
    });

    document.getElementById("btn-lyrics")?.addEventListener("click", () => {
      if (currentTrack && window.Lyrics) Lyrics.show(currentTrack);
    });

    // Open Now Playing overlay on player track area click
    document.getElementById("player-track-btn")?.addEventListener("click", () => {
      if (window.NowPlaying) NowPlaying.show();
    });

    document.getElementById("saavn-bitrate")?.addEventListener("change", () => {
      if (currentTrack) {
        playTrack(currentTrack, SaavnAPI.getStreamUrl(currentTrack.raw, getQuality()));
      }
    });
  }

  return {
    init,
    playTrack,
    playById,
    playNext,
    playPrev,
    togglePlay,
    setQueue,
    setCrossfadeDuration(ms) { FADE_DURATION = ms; },
    get current() { return currentTrack; },
    get queue()   { return queue; },
  };
})();
