// The portfolio's song. The server keeps it as "kind/id" plus its title (see server.py: clean_spotify, fetch_spotify_title);
// the page builds Spotify addresses only from that, and checks a pasted link the same way before sending it.

const LINK = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,3}(?:-[A-Za-z]+)?\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{10,40})(?:[?#].*)?$/;
const URI = /^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{10,40})$/;

/** "kind/id" for a pasted Spotify link or URI, "" for an empty box, null for anything else. */
export function parseSpotify(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  const m = LINK.exec(t) ?? URI.exec(t);
  return m ? `${m[1]}/${m[2]}` : null;
}
export const embedUrl = (song: string) => `https://open.spotify.com/embed/${song}?utm_source=generator&theme=0`;
export const openUrl = (song: string) => `https://open.spotify.com/${song}`;

export type Song = { spotify: string; title: string };

const SESSION_KEY = "pokemon-dnd-session";   // the app's sign-in token (js/session.js); same origin, so the portfolio can see it
function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(SESSION_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

/** The current song, readable by everyone. */
export async function fetchSong(): Promise<Song> {
  try {
    const r = await fetch("/api/portfolio", { cache: "no-store" });
    if (!r.ok) return { spotify: "", title: "" };
    const j = await r.json();
    return { spotify: j.spotify ?? "", title: j.title ?? "" };
  } catch { return { spotify: "", title: "" }; }
}
/** True only for the signed-in site owner: the server answers 404 to everyone else. */
export async function isOwner(): Promise<boolean> {
  const headers = authHeaders();
  if (!headers.Authorization) return false;
  try { return (await fetch("/api/admin/portfolio", { headers, cache: "no-store" })).ok; } catch { return false; }
}
/** Owner only. Returns the saved song, or throws a sentence to show. */
export async function saveSong(text: string): Promise<Song> {
  const r = await fetch("/api/admin/portfolio", {
    method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ spotify: text }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Couldn't save that. Are you still signed in?");
  return { spotify: out.spotify ?? "", title: out.title ?? "" };
}
