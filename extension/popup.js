import { parseScribdInput } from "./scribd-url.js";

const input = document.getElementById("input");
const saveAs = document.getElementById("save-as");
const button = document.getElementById("download");
const message = document.getElementById("message");
const jobSection = document.getElementById("job");
const filenameLine = document.getElementById("filename");
const progressBar = document.getElementById("progress");
const statusLine = document.getElementById("status");
const cancelButton = document.getElementById("cancel");
const logBox = document.getElementById("log");
const queueSection = document.getElementById("queue");
const queueList = document.getElementById("queue-list");

function showMessage(text, kind) {
  message.textContent = text;
  message.className = kind;
}

/** Show the export state published by the service worker. */
function renderJob(job) {
  if (!job) {
    jobSection.hidden = true;
    return;
  }

  jobSection.hidden = false;
  filenameLine.textContent = job.filename;
  progressBar.max = job.total || 1;
  progressBar.value = job.progress;
  statusLine.textContent = job.status;
  statusLine.className = job.kind;
  cancelButton.hidden = !job.running;

  // Follow the log unless the user has scrolled up to read it.
  const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 20;
  logBox.textContent = job.log.join("\n");
  if (atBottom) logBox.scrollTop = logBox.scrollHeight;
}

function renderQueue(queue = []) {
  queueSection.hidden = queue.length === 0;
  queueList.replaceChildren(
    ...queue.map((item) => {
      const entry = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.filename;
      const remove = document.createElement("button");
      remove.textContent = "✕";
      remove.title = "Remove from queue";
      remove.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "remove", key: item.key });
      });
      entry.append(name, remove);
      return entry;
    })
  );
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.job) renderJob(changes.job.newValue);
  if (changes.queue) renderQueue(changes.queue.newValue);
});

const saved = await chrome.storage.session.get(["job", "queue"]);
renderJob(saved.job);
renderQueue(saved.queue);

// Prefill with the current tab when it is a Scribd document.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab?.url && parseScribdInput(tab.url)) {
  input.value = tab.url;
}

const { saveAsPreference = false } = await chrome.storage.local.get("saveAsPreference");
saveAs.checked = saveAsPreference;
saveAs.addEventListener("change", () => {
  chrome.storage.local.set({ saveAsPreference: saveAs.checked });
});

async function start() {
  const parsed = parseScribdInput(input.value);
  if (!parsed) {
    showMessage("Enter a Scribd document URL or a numeric document ID.", "error");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "start",
    id: parsed.id,
    title: parsed.title,
    saveAs: saveAs.checked,
  });
  if (response?.error) {
    showMessage(response.error, "error");
    return;
  }

  showMessage(response?.queued ? "Added to the queue." : "", "info");
  input.value = "";
  input.focus();
}

button.addEventListener("click", start);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") start();
});
cancelButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "cancel" });
});
