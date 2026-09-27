<p align="center">
  <img src="extension/icons/icon.svg" alt="Scribd Downloader logo" width="120">
</p>

<h1 align="center">Scribd Downloader</h1>

<p align="center">
  <b>A browser extension that saves Scribd documents as clean PDFs, right from the toolbar.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/Edge-supported-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white" alt="Edge">
  <img src="https://img.shields.io/badge/Brave-supported-FB542B?style=for-the-badge&logo=brave&logoColor=white" alt="Brave">
  <img src="https://img.shields.io/badge/Manifest-V3-555?style=for-the-badge" alt="Manifest V3">
</p>

---

## Features

- **Works from the toolbar**: open a Scribd document and click the extension icon; the URL is filled in for you
- **Flexible input**: accepts links on any Scribd subdomain (`www.`, `it.`, `de.`, ...), both `/document/` and legacy `/doc/` URLs, or just the numeric document ID
- **Download queue**: add as many documents as you like; they are exported one after another
- **Live progress**: progress bar, status, and a full export log inside the popup. Close and reopen it at any time and the export keeps running
- **Stays out of the way**: the document renders in a minimized window that closes automatically
- **Clean PDFs**: no toolbars, cookie banners, or overlays
- **Faithful output**: one PDF page per Scribd page, at the page's real size, with selectable text
- **Bounded memory**: pages are loaded and released in small batches, so long documents don't exhaust memory
- **Nothing else to install**: no Python, Selenium, or ChromeDriver
- **No Scribd account required**

---

## Installation

The extension is not on the Chrome Web Store, so it is installed as an unpacked extension:

1. Download `scribd-downloader-extension-vX.Y.Z.zip` from the [latest release](https://github.com/Shargus/scribd-downloader-extension/releases/latest)
2. Extract the zip into a folder you'll keep (the browser loads the extension from it, so don't delete it afterwards)
3. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the extracted folder (the one containing `manifest.json`)

Requires Chrome 118 or later, or a browser based on it. Firefox and Safari are not supported.

To update, download the new release, extract it over the same folder, and click the reload icon on the extension's card.

---

## Usage

1. Open a Scribd document and click the extension icon. The document's URL is filled in automatically. You can also paste any Scribd URL or type a document ID
2. Optionally tick **Ask where to save**. Otherwise the PDF goes straight to your downloads folder, named after the document
3. Click **Download PDF**
4. Follow the progress in the popup. To download more documents, keep adding them; each one joins the queue and starts when the previous one finishes. Click ✕ to remove a document from the queue, or **Cancel** to stop the current export

While an export is running, the browser shows a *"Scribd Downloader started debugging this browser"* bar. This is expected, see [How it works](#how-it-works). Clicking **Cancel** on that bar also stops the export.

---

## How it works

1. **Hidden rendering**: the Scribd embed page is opened in a minimized window, and the extension attaches to it through the Chrome DevTools Protocol (`chrome.debugger`)
2. **Cleanup**: toolbars, cookie banners, and overlays are removed, while Scribd's layout classes are kept so equations and SVG content render correctly
3. **Batched loading**: pages are loaded eight at a time through Scribd's own page manager, and the extension waits until their images and fonts are ready
4. **Per-page printing**: each page is isolated and printed with `Page.printToPDF` at its exact size
5. **Merging**: the single-page PDFs are combined with [pdf-lib](https://pdf-lib.js.org/) and handed to the browser's download manager
6. **Memory release**: each finished batch is removed from the page before the next one loads

Chrome doesn't draw anything in a minimized window. Scribd waits for the browser to draw a frame before it loads its fonts, so without help the text would never appear. The extension supplies a replacement for that signal while the window is hidden, so the text renders.

### Permissions

| Permission | Why it is needed |
| ---------- | ---------------- |
| `debugger` | Print pages to PDF and run the export steps inside the Scribd page |
| `downloads` | Save the finished PDF |
| `activeTab` | Read the current tab's URL to prefill the popup |
| `storage` | Remember the "Ask where to save" choice, the queue, and the export progress |
| `offscreen` | Hand the finished PDF to the download manager (background scripts can't do this directly) |

The extension sends no data anywhere. It only talks to Scribd to load the document you asked for.

---

## Troubleshooting

**"Timed out waiting for the Scribd document to load"**: the document ID doesn't exist, the document isn't publicly viewable, or the network is too slow. Check that the document opens normally in the browser.

**"Warning: page N has text blocks whose fonts did not load"**: the page was saved after waiting 30 seconds for its fonts, and some of its text may be missing. Retrying on a faster connection usually helps.

**"Export interrupted"**: the browser stopped the extension's background process in the middle of an export, for example because the browser was closed. Start the download again; the rest of the queue continues on its own.

**Blank pages**: some documents are protected or only partly available without a subscription; those pages can't be exported.

---

## Credits

This extension is largely based on [**scribd-downloader**](https://github.com/themrsami/scribd-downloader) by [Usama Nazir (@themrsami)](https://github.com/themrsami), a Python and Selenium tool that exports Scribd documents to PDF. The export method comes from that project: page cleanup, batched page loading, per-page printing through the DevTools Protocol, and one PDF sheet per page. Thanks also to its contributors, including [@HBaz92](https://github.com/HBaz92) for the per-page export fix.

If you find this useful, consider starring and supporting the original project.

---

## License

MIT, as in the original project.

---

## Disclaimer

This tool is for educational purposes only. Please respect copyright laws and Scribd's Terms of Service. Only download documents you have the right to access.
