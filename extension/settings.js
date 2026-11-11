const enabled = document.querySelector("#enabled");
const onlineLookup = document.querySelector("#onlineLookup");
const backendUrl = document.querySelector("#backendUrl");
const status = document.querySelector("#status");

chrome.runtime.sendMessage({ type: "settings:get" }, (settings) => {
  enabled.checked = settings.enabled;
  onlineLookup.checked = settings.onlineLookup;
  backendUrl.value = settings.backendUrl;
});

document.querySelector("#save").addEventListener("click", () => {
  chrome.runtime.sendMessage({
    type: "settings:set",
    settings: { enabled: enabled.checked, onlineLookup: onlineLookup.checked, backendUrl: backendUrl.value.trim() }
  }, (result) => {
    status.textContent = result?.ok ? "Settings saved." : "Could not save these settings.";
  });
});

document.querySelector("#clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "cache:clear" }, (result) => {
    status.textContent = result?.ok ? `Cleared ${result.removed} learned definitions.` : "Could not clear definitions.";
  });
});
