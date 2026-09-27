/**
 * Tiny IndexedDB store used to hand the finished PDF from the service worker
 * to the offscreen document.
 */

const DB_NAME = "scribd-downloader";
const STORE = "results";
const KEY = "pdf";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const putResult = (blob) => withStore("readwrite", (store) => store.put(blob, KEY));
export const getResult = () => withStore("readonly", (store) => store.get(KEY));
export const deleteResult = () => withStore("readwrite", (store) => store.delete(KEY));
