// Map images, kept on this device in IndexedDB (they're too big for the save). The images are shown as data:
// URLs because the site's Content-Security-Policy doesn't allow blob: images. A map's name and labels are in the
// planner save (store.js); if the image is missing on another device the labels are kept and the map can be
// re-imported, or moved across with Export / Import map pack.

const DB = "pokemon-dnd-maps";
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("This browser can't store map images.")); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("images")) req.result.createObjectStore("images", { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const readAsDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });

// Natural size of an image file, and a check that it really is one.
export function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("That file isn't an image the browser can show."));
    img.src = dataUrl;
  });
}

export async function putImage(id, dataUrl) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put({ id, dataUrl });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}

export async function getImage(id) {
  const db = await open();
  const row = await wrap(db.transaction("images").objectStore("images").get(id));
  return row?.dataUrl || null;
}

export async function deleteImage(id) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
