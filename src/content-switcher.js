(() => {
  if (globalThis.__tabSwitcherOverlayLoaded) return;
  globalThis.__tabSwitcherOverlayLoaded = true;
  let host, dialog, frame, token, previouslyFocused, pending;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "tab-switcher:show-overlay") {
      show(message.token).then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.token !== token) return false;
    if (message.type === "overlay-ready") {
      pending?.resolve();
      pending = null;
      frame?.focus();
      sendResponse({ ok: true });
    } else if (message.type === "hide-overlay") {
      sendResponse({ ok: true });
      hide();
    }
    return false;
  });

  async function show(nextToken) {
    hide();
    token = nextToken;
    previouslyFocused = document.activeElement;
    host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Tab Switcher");
    const style = document.createElement("style");
    style.textContent = [
      "dialog { padding: 0; border: 0; border-radius: 10px; width: min(720px, calc(100vw - 24px));",
      "height: min(600px, calc(100dvh - 24px)); max-width: none; max-height: none;",
      "box-shadow: 0 20px 60px #0006; overflow: hidden; }",
      "dialog::backdrop { background: #0006; }",
      "iframe { display: block; width: 100%; height: 100%; border: 0; }"
    ].join("\n");
    frame = document.createElement("iframe");
    frame.title = "Tab Switcher";
    frame.allow = "clipboard-write";
    frame.src = chrome.runtime.getURL("src/switcher.html?overlay=1#" + token);
    dialog.append(frame);
    root.append(style, dialog);
    document.documentElement.append(host);
    dialog.addEventListener("cancel", hide);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) hide();
    });
    const ready = new Promise((resolve, reject) => { pending = { resolve, reject }; });
    const timer = setTimeout(() => pending?.reject(new Error("Overlay could not load on this page")), 5000);
    try {
      dialog.showModal();
      await ready;
    } catch (error) {
      hide();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function hide() {
    pending?.reject(new Error("Overlay closed"));
    pending = null;
    dialog?.close();
    host?.remove();
    host = dialog = frame = null;
    if (token) chrome.runtime.sendMessage({ type: "overlay-closed", token }).catch(() => {});
    token = null;
    previouslyFocused?.focus?.({ preventScroll: true });
    previouslyFocused = null;
  }

  addEventListener("pagehide", hide);
})();
