// UMD build: with no module loader present it defines globalThis.PDFLib.
import "./vendor/pdf-lib.min.js";
import { deleteResult, putResult } from "./result-store.js";
import { embedUrl, toPdfFilename } from "./scribd-url.js";
import {
  hideCookieDialogs,
  installBackgroundAnimationFrames,
  isolatePage,
  loadPageBatch,
  prepareDocumentForPrint,
  probeDocument,
  releasePageBatch,
} from "./page-scripts.js";

const EXPORT_BATCH_SIZE = 8;
const PAGE_LOAD_TIMEOUT_MS = 120_000;
const DOCUMENT_READY_TIMEOUT_MS = 60_000;

/**
 * Export progress shown by the popup. Kept in chrome.storage.session so the
 * popup can be closed and reopened at any time during an export.
 */
let state = null;

/** The export currently running in this service worker, if any. */
let job = null;

function publish() {
  chrome.storage.session.set({ job: state });
}

function log(message) {
  state.log.push(message);
  publish();
}

function setStatus(message, kind = "") {
  state.status = message;
  state.kind = kind;
  publish();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkAborted() {
  if (job.abortReason) throw new Error(job.abortReason);
}

async function send(method, commandParams = {}) {
  checkAborted();
  try {
    return await chrome.debugger.sendCommand({ tabId: job.tabId }, method, commandParams);
  } catch (error) {
    checkAborted();
    throw error;
  }
}

/** Run one of the page-scripts.js functions inside the Scribd tab. */
async function runInPage(fn, ...args) {
  const response = await send("Runtime.evaluate", {
    expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    throw new Error(details.exception?.description || details.text);
  }
  return response.result.value;
}

async function waitForDocument() {
  const deadline = Date.now() + DOCUMENT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const probe = await runInPage(probeDocument);
      if (probe.readyState === "complete" && probe.pageCount > 0) {
        return probe;
      }
    } catch (error) {
      // The tab may still be navigating; retry until the deadline.
      checkAborted();
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for the Scribd document to load.");
}

async function printPage(widthPx, heightPx) {
  const result = await send("Page.printToPDF", {
    landscape: false,
    displayHeaderFooter: false,
    printBackground: true,
    scale: 1,
    paperWidth: widthPx / 96,
    paperHeight: heightPx / 96,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    preferCSSPageSize: true,
    pageRanges: "1",
    transferMode: "ReturnAsBase64",
  });
  const response = await fetch(`data:application/pdf;base64,${result.data}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Open the Scribd page in a minimized window so it stays out of the way. */
async function openScribdTab() {
  try {
    const window = await chrome.windows.create({
      url: "about:blank",
      state: "minimized",
      focused: false,
    });
    job.windowId = window.id;
    job.tabId = window.tabs[0].id;
  } catch (error) {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    job.tabId = tab.id;
  }
}

async function closeScribdTab() {
  const { tabId, windowId } = job;
  if (tabId === null) return;
  job.tabId = null;
  job.windowId = null;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (error) {}
  try {
    if (windowId !== null) {
      await chrome.windows.remove(windowId);
    } else {
      await chrome.tabs.remove(tabId);
    }
  } catch (error) {}
}

async function exportDocument(docId) {
  const { PDFDocument } = globalThis.PDFLib;

  log(`Opening ${embedUrl(docId)}`);
  await openScribdTab();

  await chrome.debugger.attach({ tabId: job.tabId }, "1.3");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${installBackgroundAnimationFrames.toString()})();`,
  });
  await send("Page.navigate", { url: embedUrl(docId) });

  setStatus("Waiting for the document to load…");
  const probe = await waitForDocument();
  if (!probe.hasManager) {
    throw new Error("Scribd direct page loader is unavailable.");
  }

  // Keep Chrome from freezing the hidden tab during a long export.
  try {
    await send("Page.setWebLifecycleState", { state: "active" });
  } catch (error) {}

  await sleep(1000);
  await runInPage(hideCookieDialogs);
  log("Cookie dialogs hidden.");
  await runInPage(prepareDocumentForPrint);
  log("Toolbars removed and print CSS injected.");

  const pageCount = probe.pageCount;
  state.total = pageCount;
  log(`Exporting ${pageCount} pages in batches of ${EXPORT_BATCH_SIZE}...`);

  await send("Emulation.setEmulatedMedia", { media: "print" });

  const output = await PDFDocument.create();
  let batchPageNumbers = [];

  for (let index = 0; index < pageCount; index++) {
    if (index % EXPORT_BATCH_SIZE === 0) {
      const batchEnd = Math.min(pageCount, index + EXPORT_BATCH_SIZE);
      batchPageNumbers = [];
      for (let pageNum = index + 1; pageNum <= batchEnd; pageNum++) {
        batchPageNumbers.push(pageNum);
      }
      setStatus(`Loading pages ${index + 1}-${batchEnd} of ${pageCount}…`);
      const result = await runInPage(loadPageBatch, batchPageNumbers, PAGE_LOAD_TIMEOUT_MS);
      if (!result.supported) {
        throw new Error("Scribd direct page loader is unavailable.");
      }
      if (result.failed.length) {
        const details = result.failed
          .map((item) => `${item.pageNum} (${item.reason})`)
          .join(", ");
        throw new Error(`Failed to load Scribd page(s): ${details}`);
      }
    }

    const pageInfo = await runInPage(isolatePage, index);
    if (!pageInfo) {
      log(`  Skipping page ${index + 1}: element missing`);
      continue;
    }
    if (pageInfo.width <= 0 || pageInfo.height <= 0) {
      log(`  Skipping page ${index + 1}: invalid geometry ${pageInfo.width}x${pageInfo.height}`);
      continue;
    }
    if (pageInfo.hiddenTextBlocks > 0) {
      log(`  Warning: page ${index + 1} has ${pageInfo.hiddenTextBlocks} text blocks whose fonts did not load`);
    }

    setStatus(`Printing page ${index + 1} of ${pageCount}…`);
    const pdfBytes = await printPage(pageInfo.width, pageInfo.height);
    const pagePdf = await PDFDocument.load(pdfBytes);
    if (pagePdf.getPageCount() !== 1) {
      throw new Error(
        `Document page ${index + 1} produced ${pagePdf.getPageCount()} PDF sheets; expected exactly 1.`
      );
    }
    const [copiedPage] = await output.copyPages(pagePdf, [0]);
    output.addPage(copiedPage);
    state.progress = index + 1;
    log(`  Page ${index + 1}/${pageCount} ${pageInfo.width}x${pageInfo.height}px OK`);

    const isBatchEnd = (index + 1) % EXPORT_BATCH_SIZE === 0 || index + 1 === pageCount;
    if (isBatchEnd) {
      await runInPage(releasePageBatch, batchPageNumbers);
      try {
        await send("HeapProfiler.collectGarbage");
      } catch (error) {}
    }
  }

  if (output.getPageCount() === 0) {
    throw new Error("No valid document pages were exported.");
  }

  setStatus(`Merging ${output.getPageCount()} pages…`);
  const merged = await output.save();
  await closeScribdTab();
  return merged;
}

/**
 * Service workers cannot create blob: URLs, so the PDF is handed through
 * IndexedDB to an offscreen document that creates one for chrome.downloads.
 */
async function downloadPdf(bytes, filename, saveAs) {
  await putResult(new Blob([bytes], { type: "application/pdf" }));
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Create a blob URL for the exported PDF download.",
  });

  try {
    const { url } = await chrome.runtime.sendMessage({ target: "offscreen", type: "create-url" });
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      saveAs,
      conflictAction: "uniquify",
    });

    // The blob URL must stay valid until Chrome finishes writing the file.
    await new Promise((resolve, reject) => {
      function onChanged(delta) {
        if (delta.id !== downloadId || !delta.state) return;
        if (delta.state.current === "complete") {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve();
        } else if (delta.state.current === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error(`Download interrupted: ${delta.error?.current || "unknown error"}`));
        }
      }
      chrome.downloads.onChanged.addListener(onChanged);
    });

    const [item] = await chrome.downloads.search({ id: downloadId });
    return item?.filename || filename;
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {}
    await deleteResult();
  }
}

async function runExport({ id, filename, saveAs }) {
  job = { docId: id, tabId: null, windowId: null, abortReason: null };
  state = {
    running: true,
    filename,
    status: "Starting…",
    kind: "",
    progress: 0,
    total: 0,
    log: [],
  };
  publish();

  // Extension API calls keep the service worker alive during long waits.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);

  try {
    const merged = await exportDocument(id);
    setStatus("Saving…");
    const savedPath = await downloadPdf(merged, filename, saveAs);
    log(`PDF saved to: ${savedPath}`);
    setStatus("Done! PDF saved.", "done");
  } catch (error) {
    const message = job.abortReason || `Export failed: ${error.message}`;
    log(message);
    setStatus(message, "error");
  } finally {
    clearInterval(keepAlive);
    await closeScribdTab();
    state.running = false;
    publish();
    job = null;
  }
}

/**
 * Documents waiting to be exported, in order. Mirrored to
 * chrome.storage.session so the popup can list them and so the queue
 * survives Chrome stopping the service worker.
 */
let queue = [];
let processing = false;

function publishQueue() {
  chrome.storage.session.set({ queue });
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      publishQueue();
      await runExport(next);
    }
  } finally {
    processing = false;
  }
}

function enqueue({ id, title, saveAs }) {
  const isDuplicate =
    queue.some((item) => item.id === id) || job?.docId === id;
  if (isDuplicate) {
    return { error: "This document is already downloading or queued." };
  }

  queue.push({
    key: crypto.randomUUID(),
    id,
    filename: toPdfFilename(title || id),
    saveAs,
  });
  publishQueue();
  const queued = processing;
  processQueue();
  return { ok: true, queued };
}

// If Chrome stopped the service worker mid-export, don't leave the popup
// showing a job that will never finish, and pick up the remaining queue.
const restored = chrome.storage.session.get(["job", "queue"]).then((saved) => {
  if (saved.job?.running) {
    saved.job.running = false;
    saved.job.status = "Export interrupted.";
    saved.job.kind = "error";
    chrome.storage.session.set({ job: saved.job });
  }
  queue = saved.queue || [];
  if (queue.length) processQueue();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "start") {
    restored.then(() => sendResponse(enqueue(message)));
    return true;
  }
  if (message.type === "remove") {
    restored.then(() => {
      queue = queue.filter((item) => item.key !== message.key);
      publishQueue();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "cancel") {
    if (job && !job.abortReason) {
      job.abortReason = "Export cancelled.";
      closeScribdTab();
    }
    sendResponse({ ok: true });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (job && source.tabId === job.tabId && !job.abortReason) {
    job.abortReason =
      reason === "target_closed"
        ? "The Scribd tab was closed."
        : "Export cancelled (debugger detached).";
  }
});
