/**
 * appwrite.js — Appwrite SDK setup for openmusic
 *
 * Exposes on window:
 *   AppwriteClient    — raw Client
 *   AppwriteAccount   — Account API
 *   AppwriteDB        — Databases API
 *   AppwriteStorage   — Storage API
 *
 * ── Database / Storage IDs ──────────────────────────────────────────
 *  Database  : "openmusic"
 *  Collection: "userdata"   (one document per user, document ID = user.$id)
 *  Bucket    : "playlist-covers"
 * ────────────────────────────────────────────────────────────────────
 */

const APPWRITE_ENDPOINT    = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID  = "6a2432cd003b7deb6da1";

// These must match what you create in the Appwrite Console
const APPWRITE_DB_ID       = "openmusic";
const APPWRITE_COL_ID      = "userdata";
const APPWRITE_BUCKET_ID   = "playlist-covers";

// Expose IDs so db.js can import them without re-declaring
window.APPWRITE_DB_ID      = APPWRITE_DB_ID;
window.APPWRITE_COL_ID     = APPWRITE_COL_ID;
window.APPWRITE_BUCKET_ID  = APPWRITE_BUCKET_ID;

function initAppwrite() {
  if (!window.Appwrite) {
    console.warn("[Appwrite] SDK not loaded yet.");
    return;
  }

  const { Client, Account, Databases, Storage } = window.Appwrite;

  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

  window.AppwriteClient  = client;
  window.AppwriteAccount = new Account(client);
  window.AppwriteDB      = new Databases(client);
  window.AppwriteStorage = new Storage(client);

  console.log("[Appwrite] SDK initialised.");
}

// Run immediately — scripts are at bottom of body so DOM is ready
initAppwrite();
