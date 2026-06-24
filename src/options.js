import { COMMAND_LABELS, DEFAULT_SETTINGS, SETTING_LIMITS } from "./core/defaults.js";

const formControls = [...document.querySelectorAll("[name]")];
const shortcutSummary = document.querySelector("#shortcutSummary");
const openShortcutSettings = document.querySelector("#openShortcutSettings");
const resetSettings = document.querySelector("#resetSettings");
const saveStatus = document.querySelector("#saveStatus");

let settings = null;
let statusTimer = null;
let saveQueue = Promise.resolve();

init();

async function init() {
  try {
    const response = await send({ type: "get-settings" });
    settings = response.settings;
    renderSettings();
    renderCommands(response.commands);
    setControlsDisabled(false);
    bindEvents();
  } catch (error) {
    shortcutSummary.textContent = error?.message || "Could not load extension settings.";
    setStatus("Settings could not be loaded.", true);
  }
}

function bindEvents() {
  for (const control of formControls) {
    control.addEventListener("change", saveSettings);
  }
  openShortcutSettings.addEventListener("click", async () => {
    try {
      await send({ type: "open-shortcut-settings" });
    } catch (error) {
      setStatus(error?.message || "Could not open shortcut settings.", true);
    }
  });
  resetSettings.addEventListener("click", resetToDefaults);
}

function renderSettings() {
  for (const control of formControls) {
    const value = settings[control.name];
    if (control.type === "checkbox") control.checked = Boolean(value);
    else if (control.tagName === "TEXTAREA" && Array.isArray(value)) control.value = value.join("\n");
    else control.value = value;
  }
}

function renderCommands(commands) {
  const missing = commands.filter((command) => !command.shortcut);
  const active = commands
    .filter((command) => command.shortcut)
    .map((command) => `${COMMAND_LABELS[command.name] || command.name}: ${command.shortcut}`);

  if (missing.length) {
    const missingLabels = missing.map((command) => COMMAND_LABELS[command.name] || command.name);
    shortcutSummary.textContent = `Unassigned: ${missingLabels.join(", ")}. Active: ${active.join(", ") || "none"}.`;
  } else {
    shortcutSummary.textContent = active.join(", ");
  }
}

async function saveSettings(event) {
  const control = event.currentTarget;
  if (!control.checkValidity()) {
    control.reportValidity();
    setStatus(validationMessage(control), true);
    return;
  }

  const value = control.type === "checkbox"
    ? control.checked
    : control.type === "number"
      ? Number(control.value)
      : control.value;

  const previous = settings;
  settings = { ...settings, [control.name]: value };
  renderSettings();

  saveQueue = saveQueue.then(async () => {
    try {
      const response = await send({ type: "update-settings", settings: { [control.name]: value } });
      settings = response.settings;
      renderSettings();
      setStatus("Saved");
    } catch (error) {
      settings = previous;
      renderSettings();
      setStatus(error?.message || "Could not save setting.", true);
    }
  });

  await saveQueue;
}

function setStatus(message, isError = false) {
  window.clearTimeout(statusTimer);
  saveStatus.textContent = message;
  saveStatus.dataset.error = String(isError);
  if (!isError) {
    statusTimer = window.setTimeout(() => {
      saveStatus.textContent = "";
    }, 1800);
  }
}

async function resetToDefaults() {
  const previous = settings;
  settings = { ...DEFAULT_SETTINGS };
  renderSettings();

  saveQueue = saveQueue.then(async () => {
    try {
      const response = await send({ type: "update-settings", settings: DEFAULT_SETTINGS });
      settings = response.settings;
      renderSettings();
      setStatus("Defaults restored");
    } catch (error) {
      settings = previous;
      renderSettings();
      setStatus(error?.message || "Could not reset settings.", true);
    }
  });

  await saveQueue;
}

function setControlsDisabled(disabled) {
  for (const control of formControls) control.disabled = disabled;
  resetSettings.disabled = disabled;
}

function validationMessage(control) {
  if (control.name === "maxResults") {
    return `Maximum results must be between ${SETTING_LIMITS.maxResults.min} and ${SETTING_LIMITS.maxResults.max}.`;
  }
  if (control.name === "automationExpireMinutes") {
    return `Automation expiration must be between ${SETTING_LIMITS.automationExpireMinutes.min} and ${SETTING_LIMITS.automationExpireMinutes.max} minutes.`;
  }
  return control.validationMessage || "Setting is invalid.";
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}
