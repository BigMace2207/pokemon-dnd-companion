import { useEffect, useState, type FormEvent } from "react";
import { embedUrl, fetchSong, isOwner, parseSpotify, saveSong } from "./spotify";

/** "Know me better by listening to what I like": my Spotify pick, playable here. The site owner, signed in to
 *  fluxdev.org, also gets a box to paste a new link. */
export default function Listen() {
  const [song, setSong] = useState<string | null>(null);   // null while loading
  const [owner, setOwner] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchSong().then((s) => live && setSong(s));
    void isOwner().then((o) => live && setOwner(o));
    return () => { live = false; };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = parseSpotify(text);
    if (clean === null) { setNote("That isn't a Spotify track, album, playlist, artist, episode or show link."); return; }
    setBusy(true); setNote("");
    try {
      const saved = await saveSong(text);
      setSong(saved); setText(""); setNote(saved ? "Saved. It's live on the site." : "Cleared.");
    } catch (err) { setNote(err instanceof Error ? err.message : "Couldn't save that."); }
    setBusy(false);
  };

  return (
    <aside className="pf-listen" aria-label="Music I like">
      <p className="pf-listen-title">
        <span className="pf-eq" aria-hidden="true"><i /><i /><i /><i /></span>
        Know me better by listening to what I like!
      </p>
      {song ? (
        <iframe className="pf-listen-frame" title="Music I like, on Spotify" src={embedUrl(song)} width="100%" height="152"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
      ) : (
        <p className="pf-listen-empty">{song === null ? "Tuning in…" : "Nothing queued yet. Check back soon."}</p>
      )}
      {owner && (
        <form className="pf-listen-form" onSubmit={submit}>
          <label htmlFor="pf-song">Change the song (only you see this)</label>
          <div>
            <input id="pf-song" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="Paste a Spotify link" value={text}
              onChange={(e) => { setText(e.target.value); setNote(""); }} />
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {note && <p role="status" className="pf-listen-note">{note}</p>}
        </form>
      )}
    </aside>
  );
}
