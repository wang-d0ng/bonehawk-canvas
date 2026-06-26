const statusEl = document.getElementById("status");

document.getElementById("sync").addEventListener("click", async () => {
  statusEl.textContent = "Syncing from the active Canvas tab...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !tab.url.includes(".instructure.com")) {
    statusEl.textContent = "Open your Canvas tab first, then try again.";
    return;
  }

  try {
    const result = await sendSyncMessage(tab.id);
    if (!result?.success) throw new Error(result?.error || "Sync failed");
    statusEl.textContent = `Synced ${result.courses} courses and ${result.assignments} assignments.`;
  } catch (error) {
    statusEl.textContent = `Sync failed: ${error.message}`;
  }
});

async function sendSyncMessage(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "CANVAS_WORKBENCH_SYNC" });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: "CANVAS_WORKBENCH_SYNC" });
  }
}
