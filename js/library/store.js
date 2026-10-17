// The Library's storage: the user's own books live in this browser's IndexedDB and never
// leave the device (no upload, no server copy -- they're the user's own copyrighted files).
//
//   books  : id -> { id, title, author, format, size, added, lastRead, progress, tags, cover, meta }
//   blobs  : id -> ArrayBuffer of the original file
//   notes  : id -> { bookmarks: [...], highlights: [...] }

const DB_NAME = "pokemon-dnd-library";
const DB_VERSION = 1;

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("This browser doesn't support local storage for books.")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ["books", "blobs", "notes"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === "books" ? "id" : "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(...[].concat(stores).map((s) => t.objectStore(s)));
  }));
}
const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const newId = () => `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function listBooks() {
  const db = await open();
  return wrap(db.transaction("books").objectStore("books").getAll());
}

export async function getBook(id) {
  const db = await open();
  return wrap(db.transaction("books").objectStore("books").get(id));
}

export async function getBookData(id) {
  const db = await open();
  const row = await wrap(db.transaction("blobs").objectStore("blobs").get(id));
  return row?.data || null;
}

export async function addBook(meta, buffer) {
  const book = { id: newId(), title: "Untitled", author: "", format: "", size: buffer.byteLength, added: Date.now(), lastRead: 0, progress: 0, tags: [], cover: "", ...meta };
  await tx(["books", "blobs"], "readwrite", (books, blobs) => { books.put(book); blobs.put({ id: book.id, data: buffer }); });
  return book;
}

export async function updateBook(id, patch) {
  const db = await open();
  const cur = await wrap(db.transaction("books").objectStore("books").get(id));
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await tx("books", "readwrite", (books) => { books.put(next); });
  return next;
}

export async function deleteBook(id) {
  await tx(["books", "blobs", "notes"], "readwrite", (books, blobs, notes) => { books.delete(id); blobs.delete(id); notes.delete(id); });
}

export async function getNotes(id) {
  const db = await open();
  const row = await wrap(db.transaction("notes").objectStore("notes").get(id));
  return row || { id, bookmarks: [], highlights: [] };
}

export async function saveNotes(notes) {
  await tx("notes", "readwrite", (store) => { store.put(notes); });
}

export async function usage() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est ? { used: est.usage || 0, quota: est.quota || 0 } : null;
  } catch { return null; }
}

// Ask the browser not to evict the library when space is tight (best effort).
export function persist() { try { return navigator.storage?.persist?.(); } catch { return null; } }
