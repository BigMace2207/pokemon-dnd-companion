import { useEffect, useRef } from "react";
import { CONTACT } from "./data";

// Opens the visitor's own mail app with a message to me already started.
export const MAILTO = `mailto:${CONTACT.email}?subject=${encodeURIComponent(CONTACT.subject)}&body=${encodeURIComponent(CONTACT.body)}`;

const Mail = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" /><path d="m2.25 4.25 5.75 4.5 5.75-4.5" />
  </svg>
);
const GitHub = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
const LinkedIn = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm1.7 5.2v5.6h1.7V6.2H3.7zm.85-2.7a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM6.7 6.2v5.6h1.7V8.9c0-.8.4-1.3 1-1.3s.9.5.9 1.3v2.9H12V8.5c0-1.6-.8-2.4-2-2.4-.7 0-1.2.3-1.6.8V6.2H6.7z" />
  </svg>
);

/** The "Work with me" sheet: an email that starts itself, plus GitHub and LinkedIn. */
export default function ContactSheet({ onClose }: { onClose: () => void }) {
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  return (
    <>
      <div className="pf-scrim" onClick={onClose} aria-hidden="true" />
      <div className="pf-sheet" role="dialog" aria-label="Work with me">
        <button type="button" className="pf-close" aria-label="Close" onClick={onClose}>×</button>
        <h2 className="pf-sheet-title">Work with me</h2>
        <p className="pf-sheet-text">Need 3D assets, a game system, a Roblox experience or a web app built? Tell me what you have in mind.</p>
        <a ref={first} className="pf-visit pf-sheet-main" href={MAILTO}><Mail />Email me</a>
        <p className="pf-sheet-addr">{CONTACT.email}</p>
        <div className="pf-sheet-links">
          <a className="pf-chip-link" href={CONTACT.github} target="_blank" rel="noopener noreferrer"><GitHub />GitHub</a>
          {CONTACT.linkedin && <a className="pf-chip-link" href={CONTACT.linkedin} target="_blank" rel="noopener noreferrer"><LinkedIn />LinkedIn</a>}
        </div>
      </div>
    </>
  );
}
