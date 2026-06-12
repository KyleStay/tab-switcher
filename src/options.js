import { COMMAND_LABELS } from "./core/defaults.js";

const formControls = [...document.querySelectorAll("[name]")];
const shortcutSummary = document.querySelector("#shortcutSummary");
const openShortcutSettings = document.querySelector("#openShortcutSettings");

let settings = null;

init();

async function init() {
  const response = await send({ type: "get-settings" });
  settings = response.settings;
  renderSettings();
  renderCommands(response.commands);
  bindEvents();
}

function bindEvents() {
  for (const control of formControls) {
    control.addEventListener("change", saveSettings);
  }
  openShortcutSettings.addEventListener("click", () => send({ type: "open-shortcut-settings" }));
}

function renderSettings() {
  for (const control of formControls) {
    const value = settings[control.name];
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
  }
}

function renderCommands(commands) {
  const missing = commands.filter((command) => !command.shortcut);
  const active = commands
    .filter((command) => command.shortcut)
    .map((command) => `${COMMAND_LABELS[command.name] || command.name}: ${command.shortcut}`);

  if (missing.length) {
    shortcutSummary.textContent = `Some shortcuts are unassigned. Active: ${active.join(", ") || "none"}.`;
  } else {
    shortcutSummary.textContent = active.join(", ");
  }
}

async function saveSettings(event) {
  const control = event.currentTarget;
  const value = control.type === "checkbox"
    ? control.checked
    : control.type === "number"
      ? Number(control.value)
      : control.value;

  settings = { ...settings, [control.name]: value };
  await send({ type: "update-settings", settings });
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}

