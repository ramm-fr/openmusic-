/**
 * db.js — Appwrite Database + Storage helpers for openmusic
 *
 * Schema (Appwrite Console):
 *   Database  ID : "openmusic"
 *   Collection ID: "userdata"
 *     Attributes (all string, size 1 000 000, required: false, default: "[]" / "{}")
 *       liked     — JSON array of track objects
 *       queue     — JSON array of track objects
 *       recent    — JSON array of track objects
 *       playlists — JSON array of playlist objects
 *       settings  — JSON object of user preferences
 *
 *   Storage Bucket ID: "playlist-covers"
 *     Max file size: 2 MB, allowed MIME: image/*
 *
 * Permissions:
 *   Collection / Bucket — "Any" read/write is OFF.
 *   Use "Users" role: read + write for document owner only.
 *   Easiest: set document-level security ON, then each document gets
 *   Permission.read(Role.user(userId)) + Permission.write(Role.user(userId))
 *   automatically when created via DB.createDocument with permissions array.
 *
 * NOTE: All functions are async and return { ok, data?, error? }.
 */

const DB = (() => {

  // ── Internal helpers ────────────────────────────────────────────────────

  function sdk() {
    if (!window.AppwriteDB) throw new Error("Appwrite DB not initialised.");
    return window.AppwriteDB;
  }

  function storage() {
    if (!window.AppwriteStorage) throw new Error("Appwrite Storage not initialised.");
    return window.AppwriteStorage;
  }

  function userId() {
    const s = Auth.getSession();
    if (!s) throw new Error("Not logged in.");
    return s.id;
  }

  /** Parse a JSON field that may be undefined / null / empty string. */
  function parse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  // ── User-data document ───────────────────────────────────────────────────
  // One document per user; document ID === user ID for easy lookup.

  /**
   * Load all user data from Appwrite.
   * Returns { liked, queue, recent, playlists, settings }
   */
  async function loadUserData() {
    try {
      const doc = await sdk().getDocument(
        window.APPWRITE_DB_ID,
        window.APPWRITE_COL_ID,
        userId()
      );
      return {
        ok: true,
        data: {
          liked:     parse(doc.liked,     []),
          queue:     parse(doc.queue,     []),
          recent:    parse(doc.recent,    []),
          playlists: parse(doc.playlists, []),
          settings:  parse(doc.settings,  {}),
        }
      };
    } catch (e) {
      // 404 = first time — document doesn't exist yet
      if (e.code === 404) {
        return { ok: true, data: { liked: [], queue: [], recent: [], playlists: [], settings: {} } };
      }
      console.error("[DB] loadUserData failed:", e.message);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Save (upsert) a partial set of user-data fields.
   * Pass only the fields you want to update, e.g. { liked: [...] }
   * Each value should be a plain JS object/array — it will be JSON-stringified.
   */
  async function saveUserData(fields) {
    const uid = userId();

    // Stringify each field
    const payload = {};
    for (const [key, val] of Object.entries(fields)) {
      payload[key] = JSON.stringify(val);
    }

    try {
      // Try update first
      await sdk().updateDocument(
        window.APPWRITE_DB_ID,
        window.APPWRITE_COL_ID,
        uid,
        payload
      );
      return { ok: true };
    } catch (e) {
      if (e.code === 404) {
        // Document doesn't exist yet — create it
        try {
          const { Permission, Role } = window.Appwrite;
          await sdk().createDocument(
            window.APPWRITE_DB_ID,
            window.APPWRITE_COL_ID,
            uid,          // document ID = user ID
            payload,
            [
              Permission.read(Role.user(uid)),
              Permission.write(Role.user(uid)),
            ]
          );
          return { ok: true };
        } catch (ce) {
          console.error("[DB] createDocument failed:", ce.message);
          return { ok: false, error: ce.message };
        }
      }
      console.error("[DB] saveUserData failed:", e.message);
      return { ok: false, error: e.message };
    }
  }

  // ── Convenience wrappers ─────────────────────────────────────────────────

  async function saveLiked(liked)         { return saveUserData({ liked }); }
  async function saveQueue(queue)         { return saveUserData({ queue }); }
  async function saveRecent(recent)       { return saveUserData({ recent }); }
  async function savePlaylists(playlists) { return saveUserData({ playlists }); }
  async function saveSettings(settings)  { return saveUserData({ settings }); }

  // ── Playlist cover images (Appwrite Storage) ─────────────────────────────

  /**
   * Upload a playlist cover image (File object).
   * Returns { ok, fileId?, previewUrl?, error? }
   */
  async function uploadPlaylistCover(playlistId, file) {
    try {
      const { ID } = window.Appwrite;
      const uid  = userId();
      const fileId = `cover_${uid}_${playlistId}`;

      // Delete old cover if it exists
      try {
        await storage().deleteFile(window.APPWRITE_BUCKET_ID, fileId);
      } catch (_) { /* no existing file — fine */ }

      const uploaded = await storage().createFile(
        window.APPWRITE_BUCKET_ID,
        fileId,
        file
      );

      const previewUrl = storage().getFilePreview(
        window.APPWRITE_BUCKET_ID,
        uploaded.$id,
        400, 400   // width, height
      ).toString();

      return { ok: true, fileId: uploaded.$id, previewUrl };
    } catch (e) {
      console.error("[DB] uploadPlaylistCover failed:", e.message);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Get the preview URL for a stored cover file.
   */
  function getPlaylistCoverUrl(fileId) {
    if (!fileId || !window.AppwriteStorage) return null;
    return storage().getFilePreview(
      window.APPWRITE_BUCKET_ID,
      fileId,
      400, 400
    ).toString();
  }

  /**
   * Delete a stored cover file.
   */
  async function deletePlaylistCover(fileId) {
    if (!fileId) return { ok: true };
    try {
      await storage().deleteFile(window.APPWRITE_BUCKET_ID, fileId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    loadUserData,
    saveUserData,
    saveLiked,
    saveQueue,
    saveRecent,
    savePlaylists,
    saveSettings,
    uploadPlaylistCover,
    getPlaylistCoverUrl,
    deletePlaylistCover,
  };
})();

window.DB = DB;
