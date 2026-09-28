export function getPopupNavigationAction(event) {
  const key = event.key.toLowerCase();

  if (event.altKey) return null;

  if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (key === "arrowdown") return { type: "move", delta: 1 };
    if (key === "arrowup") return { type: "move", delta: -1 };
    if (key === "pagedown") return { type: "move", delta: 8 };
    if (key === "pageup") return { type: "move", delta: -8 };
    if (key === "home") return { type: "select", position: "first" };
    if (key === "end") return { type: "select", position: "last" };
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
    if (key === "n" || key === "j") return { type: "move", delta: 1 };
    if (key === "p" || key === "k") return { type: "move", delta: -1 };
  }

  return null;
}

export function shouldActivateSelectionOnSpace(event, query) {
  return (event.key === " " || event.key === "Spacebar")
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey
    && !String(query || "").trim();
}
