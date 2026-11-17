import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/* Drives Spotify's embedded player from our own buttons, with no Spotify script on the page.
   Spotify's iFrame API (open.spotify.com/embed/iframe-api/v1) is only a wrapper round postMessage: the page sends the embed
   { command: "toggle" | "play" | "pause" | "resume" | "seek", timestamp? } and the embed answers { type: "ready" } once it has
   loaded and { type: "playback_update", payload: { isPaused, isBuffering, duration, position } } (milliseconds). That wrapper script
   needs 'unsafe-eval' in script-src, which this origin (it also holds the app's sign-in token) must not allow; the messages
   themselves need nothing beyond the frame-src open.spotify.com that is already there. Read from the API script on 2026-11-17;
   it is not a documented contract, so every message is checked and the page still works, as a link, if they ever change.

   Limits Spotify sets, not us: visitors who are not signed in to Spotify in this browser get a short preview (19 seconds for the
   current song when tested), and there is no volume command. The embed also reports `playingURI`, which we ignore. */

const ORIGIN = "https://open.spotify.com";
const GIVE_UP_MS = 10_000;

export const embedSrc = (song: string) => `${ORIGIN}/embed/${song}?utm_source=iframe-api&theme=0`;

type Command = { command: "toggle" | "resume" | "pause" | "seek"; timestamp?: number };
export type Deck = { ready: boolean; playing: boolean; buffering: boolean; duration: number; failed: boolean };
const IDLE: Deck = { ready: false, playing: false, buffering: false, duration: 0, failed: false };

export function useDeck(song: string | null, frame: RefObject<HTMLIFrameElement | null>, onMove: () => void) {
  const [deck, setDeck] = useState<Deck>(IDLE);
  const where = useRef({ pos: 0, at: 0, playing: false, duration: 0 });
  const queue = useRef<Command[]>([]);
  const ready = useRef(false);
  const move = useRef(onMove);
  const endTimer = useRef(0);
  move.current = onMove;

  const post = (msg: object) => frame.current?.contentWindow?.postMessage(msg, ORIGIN);
  const send = useCallback((cmd: Command) => { if (ready.current) post(cmd); else queue.current.push(cmd); }, []);

  useEffect(() => {
    ready.current = false; queue.current = [];
    where.current = { pos: 0, at: 0, playing: false, duration: 0 };
    setDeck(IDLE);
    if (!song) return;
    const giveUp = window.setTimeout(() => setDeck((d) => (d.ready ? d : { ...d, failed: true })), GIVE_UP_MS);

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type?: unknown; payload?: Record<string, unknown> } | null;
      if (!m || typeof m !== "object") return;
      if (m.type === "ready") {
        ready.current = true;
        post({ command: "load_complete_ack" });
        queue.current.splice(0).forEach(post);
        setDeck((d) => ({ ...d, ready: true, failed: false }));
      } else if (m.type === "playback_update" || m.type === "playback_started") {
        const p = m.payload ?? {};
        const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : 0);
        const duration = num(p.duration), playing = p.isPaused === false, buffering = p.isBuffering === true;
        where.current = { pos: num(p.position), at: performance.now(), playing: playing && !buffering, duration };
        // The embed sends nothing when a song ends (its last report still says "playing"), so if reports stop for as long as
        // the song has left to run, it has ended: back to the start, paused.
        window.clearTimeout(endTimer.current);
        if (where.current.playing && duration) {
          endTimer.current = window.setTimeout(() => {
            where.current = { pos: 0, at: performance.now(), playing: false, duration };
            setDeck((d) => ({ ...d, playing: false }));
            move.current();
          }, Math.max(0, duration - where.current.pos) + 700);
        }
        setDeck((d) => (d.playing === playing && d.buffering === buffering && d.duration === duration && d.ready ? d : { ...d, ready: true, playing, buffering, duration }));
        move.current();
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.clearTimeout(giveUp); window.clearTimeout(endTimer.current); window.removeEventListener("message", onMessage); };
  }, [song, frame]);

  /** where the song is now, in ms: the last report, carried on by the clock while it plays */
  const position = useCallback(() => {
    const w = where.current;
    const p = w.pos + (w.playing ? performance.now() - w.at : 0);
    return w.duration ? Math.min(p, w.duration) : p;
  }, []);

  const toggle = useCallback(() => send({ command: "toggle" }), [send]);
  const seek = useCallback((ms: number) => {
    where.current = { ...where.current, pos: ms, at: performance.now() };
    send({ command: "seek", timestamp: Math.round(ms / 1000) });
  }, [send]);

  return { deck, position, toggle, seek };
}
