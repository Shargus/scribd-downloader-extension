/**
 * Functions evaluated inside the Scribd embed tab through the DevTools
 * protocol (Runtime.evaluate), so they run in the page's main world and can
 * reach window.docManager. They are serialized with Function.toString, so
 * each one must be self-contained: no imports or outer variables.
 */

/**
 * Installed before Scribd's own scripts run (Page.addScriptToEvaluateOnNewDocument).
 *
 * Scribd's font loader waits for requestAnimationFrame between font chunks,
 * and hidden tabs never fire animation frames, so the document text would
 * stay hidden forever. While the tab is hidden, run the callbacks through a
 * MessageChannel instead (not throttled in background tabs), capped at
 * about 60 flushes per second like a real display.
 */
export function installBackgroundAnimationFrames() {
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const channel = new MessageChannel();
  let queue = new Map();
  let nextId = -1;
  let scheduled = false;
  let windowStart = 0;
  let flushesInWindow = 0;

  function flush() {
    scheduled = false;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      flushesInWindow = 0;
    }
    flushesInWindow += 1;

    const callbacks = queue;
    queue = new Map();
    for (const callback of callbacks.values()) {
      try {
        callback(now);
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
      }
    }
  }

  channel.port1.onmessage = flush;

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (document.visibilityState === "visible") {
      return nativeRequest(callback);
    }
    const id = nextId--;
    queue.set(id, callback);
    if (!scheduled) {
      scheduled = true;
      if (flushesInWindow < 60) {
        channel.port2.postMessage(null);
      } else {
        setTimeout(flush, 16);
      }
    }
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (id < 0) {
      queue.delete(id);
    } else {
      nativeCancel(id);
    }
  };
}

export function probeDocument() {
  return {
    readyState: document.readyState,
    hasManager: Boolean(window.docManager && window.docManager.pages),
    pageCount: document.querySelectorAll(".outer_page").length,
  };
}

/** Dismiss and remove common cookie, consent, and privacy banners. */
export function hideCookieDialogs() {
  const closeButtonSelectors = [
    '[class*="cookie"] [class*="close"]',
    '[class*="cookie"] [class*="dismiss"]',
    '[class*="cookie"] button[aria-label*="close"]',
    '[class*="cookie"] button[aria-label*="Close"]',
    '[class*="consent"] [class*="close"]',
    '[class*="consent"] [class*="dismiss"]',
    '[class*="banner"] [class*="close"]',
    '[class*="banner"] [class*="dismiss"]',
    '[class*="notice"] [class*="close"]',
    '[class*="notice"] [class*="dismiss"]',
    'button[class*="close"]',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    'button[aria-label="Dismiss"]',
    "[data-dismiss]",
    '[role="button"][class*="close"]',
  ];

  closeButtonSelectors.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((button) => button.click());
    } catch (error) {}
  });

  const cookieSelectors = [
    '[class*="cookie"]',
    '[class*="Cookie"]',
    '[class*="consent"]',
    '[class*="Consent"]',
    '[class*="gdpr"]',
    '[class*="GDPR"]',
    '[id*="cookie"]',
    '[id*="Cookie"]',
    '[id*="consent"]',
    '[id*="gdpr"]',
    '[class*="privacy-notice"]',
    '[class*="Privacy"]',
    '[class*="cookie-banner"]',
    '[class*="cookie-notice"]',
    '[class*="cookie-popup"]',
    '[class*="cookie-modal"]',
    '[class*="CookieConsent"]',
    '[class*="notice-banner"]',
    ".cc-window",
    ".cc-banner",
    "#onetrust-consent-sdk",
    "#onetrust-banner-sdk",
    ".evidon-banner",
    ".truste_box_overlay",
    '[class*="osano-cm"]',
    '[id*="osano"]',
  ];

  cookieSelectors.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((element) => element.remove());
    } catch (error) {}
  });

  document.querySelectorAll("*").forEach((element) => {
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || "").toLowerCase();
      const fixedAtTop =
        (style.position === "fixed" || style.position === "sticky") && rect.top < 100;

      if (
        fixedAtTop &&
        ["cookie", "privacy", "consent", "analytics", "advertising", "personalization"].some(
          (word) => text.includes(word)
        )
      ) {
        element.remove();
      }
    } catch (error) {}
  });
}

/** Remove toolbars, make scroll containers printable, and inject print CSS. */
export function prepareDocumentForPrint() {
  document.querySelector(".toolbar_top")?.remove();
  document.querySelector(".toolbar_bottom")?.remove();

  const style = document.createElement("style");
  style.textContent = `
    [class*="cookie"], [class*="Cookie"], [class*="consent"], [class*="Consent"],
    [class*="gdpr"], [class*="privacy-notice"], [class*="notice-banner"],
    [id*="cookie"], [id*="consent"], [class*="osano-cm"], [id*="osano"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
    }

    .document_scroller {
      position: static !important;
      top: auto !important;
      right: auto !important;
      bottom: auto !important;
      left: auto !important;
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .toolbar_top, .toolbar_bottom {
        display: none !important;
      }

      mjx-container, .MathJax, .katex, math, svg {
        visibility: visible !important;
        overflow: visible !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Load one batch of pages and wait until their DOM and images are ready.
 *
 * Waiting is driven by DOM mutations and image load events rather than
 * polling timers, because the Scribd tab runs in the background where
 * Chrome heavily throttles timers.
 */
export function loadPageBatch(pageNumbers, timeoutMs) {
  const manager = window.docManager;
  if (!manager || !manager.pages) {
    return Promise.resolve({ supported: false });
  }

  const states = pageNumbers.map((pageNum) => ({
    pageNum,
    page: manager.pages[pageNum],
    displayed: false,
    error: null,
  }));

  for (const state of states) {
    if (!state.page) {
      state.error = "page object missing";
      continue;
    }
    try {
      if (!state.page.innerPageElem && !state.page.loadHasStarted) {
        state.page.load();
      }
    } catch (error) {
      state.error = String(error);
    }
  }

  function isReady(state) {
    if (state.error) return true;
    const page = state.page;
    if (!page.innerPageElem) return false;

    if (!state.displayed) {
      try {
        page.display();
        if (!page._imagesTurnedOn) page.turnOnImages();
        state.displayed = true;
      } catch (error) {
        state.error = String(error);
        return true;
      }
    }

    return Array.from(page.innerPageElem.querySelectorAll("img")).every(
      (image) => image.complete
    );
  }

  return new Promise((resolve) => {
    let settled = false;

    function finish(timedOut) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      document.removeEventListener("load", check, true);
      document.removeEventListener("error", check, true);
      clearTimeout(timer);
      resolve({
        supported: true,
        failed: states
          .filter((state) => state.error || (timedOut && !isReady(state)))
          .map((state) => ({
            pageNum: state.pageNum,
            reason: state.error || "page or image load timed out",
          })),
      });
    }

    function check() {
      if (states.every(isReady)) finish(false);
    }

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    document.addEventListener("load", check, true);
    document.addEventListener("error", check, true);
    const timer = setTimeout(() => finish(true), timeoutMs);
    check();
  });
}

/**
 * Show only the target .outer_page when printing; return its size in px.
 *
 * Also waits until Scribd's font loader has revealed the page's text: each
 * .ffN font block stays display:none until its web font is loaded.
 */
export async function isolatePage(targetIndex) {
  const pages = Array.from(document.querySelectorAll(".outer_page"));
  const target = pages[targetIndex];
  if (!target) return null;

  document.getElementById("isolated-page-print-style")?.remove();

  const rect = target.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  pages.forEach((page) => page.removeAttribute("data-export-target"));
  target.setAttribute("data-export-target", "true");

  const style = document.createElement("style");
  style.id = "isolated-page-print-style";
  style.textContent = `
    @page {
      size: ${width}px ${height}px;
      margin: 0;
    }

    @media print {
      html, body {
        width: ${width}px !important;
        height: ${height}px !important;
        min-width: ${width}px !important;
        min-height: ${height}px !important;
        max-width: ${width}px !important;
        max-height: ${height}px !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .outer_page {
        display: none !important;
      }

      .outer_page[data-export-target="true"] {
        display: block !important;
        visibility: visible !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: auto !important;
        bottom: auto !important;
        width: ${width}px !important;
        height: ${height}px !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        break-before: auto !important;
        break-after: auto !important;
        break-inside: auto !important;
        page-break-before: auto !important;
        page-break-after: auto !important;
        page-break-inside: auto !important;
        overflow: hidden !important;
      }
    }
  `;
  document.head.appendChild(style);

  const fontBlocks = Array.from(target.querySelectorAll(".text_layer div")).filter(
    (element) => /(^|\s)ff\d+(\s|$)/.test(element.className)
  );
  const countHidden = () =>
    fontBlocks.filter((element) => getComputedStyle(element).display === "none").length;

  let hiddenTextBlocks = countHidden();
  if (hiddenTextBlocks > 0) {
    // The loader reveals fonts by appending CSS rules to <style> elements.
    hiddenTextBlocks = await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (countHidden() === 0) finish();
      });
      const timer = setTimeout(finish, 30000);
      function finish() {
        observer.disconnect();
        clearTimeout(timer);
        resolve(countHidden());
      }
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
  }

  return { width, height, hiddenTextBlocks };
}

/** Release printed page DOM and image resources. */
export function releasePageBatch(pageNumbers) {
  const manager = window.docManager;
  if (!manager || !manager.pages) return;

  for (const pageNum of pageNumbers) {
    const page = manager.pages[pageNum];
    if (!page) continue;
    try {
      page.remove();
    } catch (error) {
      document.getElementById(`outer_page_${pageNum}`)?.querySelector(".newpage")?.remove();
    }
  }
}
