import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { fetchSong, isOwner, openUrl, parseSpotify, saveSong, type Song } from "./spotify";
import { embedSrc, useDeck } from "./deck";
import { BorderBeam } from "./vendor/border-beam";
import { Highlighter } from "./vendor/highlighter";
import ShinyText from "./vendor/shiny-text";

const Pencil = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10.5 2.8 2.7 2.7-7.4 7.4-3.3.6.6-3.3z" /></svg>
);

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** "Maybe you'll know me better if you listen to what I like": one song, on every screen, played from our own record-and-buttons.
 *  Spotify's embedded player does the playing but is kept out of sight (see deck.ts); the signed-in site owner gets a pencil to paste a new link.
 *  `accent` is the region's colour as a real colour value, for the hand-drawn underline and the shimmer, which can't read CSS variables. */
export default function Player({ accent }: { accent: string }) {
  const [song, setSong] = useState<Song | null>(null);   // null while loading
  const [owner, setOwner] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reduced = !!useReducedMotion();

  const frame = useRef<HTMLIFrameElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const times = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const draw = useRef(() => {});
  const { deck, position, toggle, seek } = useDeck(song?.spotify || null, frame, () => draw.current());
  const preview = deck.duration > 0 && deck.duration <= 32_000;   // visitors who aren't signed in to Spotify get a short preview (20 to 30 seconds)

  // The bar and the clock move every frame, so they are written straight to the page rather than through React.
  draw.current = () => {
    const p = position(), d = deck.duration, bar = scrub.current;
    if (bar && !dragging.current) { bar.value = String(p); bar.style.setProperty("--p", d ? `${Math.min(100, (p / d) * 100)}%` : "0%"); }
    if (times.current && !dragging.current) times.current.textContent = d ? `${clock(p)} / ${clock(d)}` : "0:00";   // the length is only known once it has played
  };
  useLayoutEffect(() => { draw.current(); });
  useEffect(() => {
    if (!deck.playing) return;
    let raf = requestAnimationFrame(function step() { draw.current(); raf = requestAnimationFrame(step); });
    return () => cancelAnimationFrame(raf);
  }, [deck.playing]);

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
  const title = song.title || "a song I like";
  const label = deck.failed ? "The player didn't load" : !deck.ready ? "Tuning in" : deck.playing ? `Pause ${title}` : `Play ${title}`;

  return (
    <aside className="pf-player" aria-label="Music I like">
      <p className="pf-note">
        maybe you'll know me better
        <br />if you listen to <Highlighter action="underline" color={accent} strokeWidth={2} iterations={2} padding={1} animationDuration={900}>what i like</Highlighter>!
        <svg className="pf-note-arrow" viewBox="0 0 40 46" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 3C14 4 6 14 9 28c1 5 3 8 6 11" /><path d="M7 33l8 7 3-10" />
        </svg>
      </p>

      {song.spotify ? (
        <>
          <div className="pf-deck" data-playing={deck.playing ? "" : undefined} data-ready={deck.ready ? "" : undefined}>
            {deck.playing && !reduced && (
              <div className="pf-beam" aria-hidden="true">
                <BorderBeam size={110} duration={6} borderWidth={1.5} colorFrom="var(--acc)" colorTo="color-mix(in srgb, var(--acc), #fff 55%)" />
              </div>
            )}
            <div className="pf-disc" aria-hidden="true" />
            <div className="pf-deck-main">
              <p className="pf-track" title={title}>
                <ShinyText text={title} color="rgba(241, 236, 226, 0.86)" shineColor={accent} speed={2.8} delay={0.5} shineWidth={46} disabled={!deck.playing || reduced} />
              </p>
              <input ref={scrub} className="pf-scrub" type="range" min={0} max={deck.duration || 1} step={250} defaultValue={0} disabled={!deck.ready || !deck.duration}
                aria-label="Song position" onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; }} onBlur={() => { dragging.current = false; }}
                onChange={(e) => { const v = Number(e.currentTarget.value); e.currentTarget.style.setProperty("--p", `${(v / (deck.duration || 1)) * 100}%`); if (times.current) times.current.textContent = `${clock(v)} / ${clock(deck.duration)}`; seek(v); }} />
              <p className="pf-times">
                <span ref={times}>0:00</span>
                <span className="pf-times-note">{deck.failed ? "couldn't load, try the link below" : !deck.ready ? "tuning in…" : deck.buffering ? "loading…" : preview ? `${Math.round(deck.duration / 1000)}s preview` : ""}</span>
              </p>
            </div>
            <button type="button" className="pf-play" aria-label={label} aria-pressed={deck.playing} disabled={!deck.ready} onClick={toggle}>
              {deck.playing
                ? <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
                : <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4.6 2.9v10.2a.6.6 0 0 0 .92.5l8.1-5.1a.6.6 0 0 0 0-1L5.52 2.4a.6.6 0 0 0-.92.5z" /></svg>}
            </button>
          </div>
          {/* Spotify's player does the playing; it is kept in the page but out of sight, and this link always goes to the song on Spotify. */}
          <iframe ref={frame} className="pf-engine" title="Spotify player (controlled by the buttons above)" src={embedSrc(song.spotify)} width="300" height="80"
            allow="autoplay; encrypted-media" tabIndex={-1} aria-hidden="true" />
          <p className="pf-caption">
            <a href={openUrl(song.spotify)} target="_blank" rel="noopener noreferrer">{preview ? "hear the full song on Spotify" : "open in Spotify"}</a>
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
