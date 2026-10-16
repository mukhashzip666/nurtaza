(() => {
  if (globalThis.__codeflowBridge) return;
  globalThis.__codeflowBridge = true;
  let runId = null;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "CF_BIND") return;
    runId = message.runId;
    respond({ ok: true });
  });
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== "codeflow:state:v1"
    )
      return;
    const state = event.data.state;
    if (!runId || state?.runId !== runId) return;
    chrome.runtime.sendMessage({ type: "CF_PROGRESS", state }).catch(() => {});
  });
})();
