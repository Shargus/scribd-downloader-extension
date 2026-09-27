import { getResult } from "./result-store.js";

// Turns the PDF stored by the service worker into a blob: URL it can download.
// The URL stays valid until the service worker closes this document.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen" || message.type !== "create-url") return;
  getResult().then((blob) => sendResponse({ url: URL.createObjectURL(blob) }));
  return true;
});
