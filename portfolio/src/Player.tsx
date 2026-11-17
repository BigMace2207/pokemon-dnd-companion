import { useEffect, useState, type FormEvent } from "react";
import { embedUrl, fetchSong, isOwner, openUrl, parseSpotify, saveSong, type Song } from "./spotify";

const Pencil = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10.5 2.8 2.7 2.7-7.4 7.4-3.3.6.6-3.3z" /></svg>
);

/** "Maybe you'll know me better if you listen to what I like": one song, on every screen, in a hand-lettered frame.
 *  The sound comes from Spotify's own embedded player. The signed-in site owner also gets a pencil to paste a new link. */
export default function Player() {
  const [song, setSong] = useState<Song | null>(null);   // null while loading
  const [owner, setOwner] = useState(false);
  const [editing, setEditing] = useState(false);
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
    if (parseSpotify(text) === null) { setNote("That isn't a Spotify track, album, playlist, artist, episode or show link."); return; }
    setBusy(true); setNote("");
    try {
      const saved = await saveSong(text);
      setSong(saved); setText(""); setNote(saved.spotify ? "Saved. It's live." : "Cleared.");
      if (saved.spotify) setEditing(false);
    } catch (err) { setNote(err instanceof Error ? err.message : "Couldn't save that."); }
    setBusy(false);
  };

  if (song === null || (!song.spotify && !owner)) return null;

  return (
    <aside className="pf-player" aria-label="Music I like">
      <p className="pf-note">
        maybe you'll know me better
        <br />if you listen to what i like!
        <svg className="pf-note-arrow" viewBox="0 0 40 46" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 3C14 4 6 14 9 28c1 5 3 8 6 11" /><path d="M7 33l8 7 3-10" />
        </svg>
      </p>

      {song.spotify ? (
        <>
          <div className="pf-frame">
            <iframe title={song.title ? `${song.title}, on Spotify` : "Music I like, on Spotify"} src={embedUrl(song.spotify)} width="100%" height="80"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
          </div>
          <p className="pf-caption">
            <a href={openUrl(song.spotify)} target="_blank" rel="noopener noreferrer">{song.title ? `${song.title} · open in Spotify` : "open in Spotify"}</a>
            {owner && <button type="button" className="pf-pencil" aria-label="Change the song" aria-expanded={editing} onClick={() => setEditing((v) => !v)}><Pencil /></button>}
          </p>
        </>
      ) : (
        <p className="pf-caption pf-caption-empty">No song picked yet.
          <button type="button" className="pf-pencil" aria-label="Pick a song" aria-expanded={editing} onClick={() => setEditing((v) => !v)}><Pencil /></button>
        </p>
      )}

      {owner && editing && (
        <form className="pf-song-form" onSubmit={submit}>
          <label htmlFor="pf-song">Paste a Spotify link (only you see this)</label>
          <div>
            <input id="pf-song" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://open.spotify.com/…" value={text}
              onChange={(e) => { setText(e.target.value); setNote(""); }} />
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {note && <p role="status">{note}</p>}
        </form>
      )}
    </aside>
  );
}
