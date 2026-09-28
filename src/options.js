import { COMMAND_LABELS, DEFAULT_SETTINGS, SETTING_LIMITS } from "./core/defaults.js";

const formControls = [...document.querySelectorAll("[name]")];
const shortcutSummary = document.querySelector("#shortcutSummary");
const openShortcutSettings = document.querySelector("#openShortcutSettings");
const resetSettings = document.querySelector("#resetSettings");
const saveStatus = document.querySelector("#saveStatus");
const privateTabsAccessMessage = document.querySelector("#privateTabsAccessMessage");
const privateControls = [...document.querySelectorAll("[data-private-control]")];
const helpButtons = [...document.querySelectorAll(".help-button")];

let settings = null;
let privateTabsAccess = false;
let statusTimer = null;

init();

async function init() {
  try {
    const response = await send({ type: "get-settings" });
    settings = response.settings;
    privateTabsAccess = Boolean(response.privateTabsAccess);
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
    control.id ||= `setting-${control.name}`;
    const label = control.closest("label");
    if (label) label.htmlFor = control.id;
    control.addEventListener("change", saveSettings);
  }
  for (const button of helpButtons) {
    const description = document.createElement("span");
    description.id = `help-${helpButtons.indexOf(button)}`;
    description.className = "help-text";
    description.textContent = button.dataset.help;
    description.hidden = true;
    button.after(description);
    button.setAttribute("aria-describedby", description.id);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", description.id);
    const field = button.closest("label, fieldset");
    for (const control of field.querySelectorAll("[name]")) control.setAttribute("aria-describedby", description.id);
    button.removeAttribute("title");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      description.hidden = !description.hidden;
      button.setAttribute("aria-expanded", String(!description.hidden));
    });
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
  renderPrivateAccess();
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

  await commitSettings({ [control.name]: value }, "Saved");
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
  await commitSettings(DEFAULT_SETTINGS, "Defaults restored");
}

async function commitSettings(patch, successMessage) {
  setControlsDisabled(true);
  try {
    const response = await send({ type: "update-settings", settings: patch });
    settings = response.settings;
    privateTabsAccess = Boolean(response.privateTabsAccess);
    setStatus(successMessage);
  } catch (error) {
    setStatus(error?.message || "Could not save settings.", true);
  } finally {
    renderSettings();
    setControlsDisabled(false);
  }
}

function setControlsDisabled(disabled) {
  for (const control of formControls) control.disabled = disabled;
  resetSettings.disabled = disabled;
  if (!disabled) renderPrivateAccess();
}

function validationMessage(control) {
  if (control.name === "maxResults") {
    return `Maximum results must be between ${SETTING_LIMITS.maxResults.min} and ${SETTING_LIMITS.maxResults.max}.`;
  }
  if (control.name === "privateRevealDurationMinutes") {
    return `Private reveal duration must be between ${SETTING_LIMITS.privateRevealDurationMinutes.min} and ${SETTING_LIMITS.privateRevealDurationMinutes.max} minutes.`;
  }
  return control.validationMessage || "Setting is invalid.";
}

function renderPrivateAccess() {
  if (!settings) return;
  privateTabsAccessMessage.textContent = privateTabsAccess
    ? settings.privateTabsEnabled ? "Private tab support is enabled. Search queries are not saved." : "Chrome has granted incognito access. Enable private tabs below."
    : "Enable incognito access for this extension in Chrome to use private tab visibility.";

  for (const control of privateControls) {
    const isRoot = control.dataset.privateControl === "root";
    let disabled = !privateTabsAccess || (!isRoot && !settings.privateTabsEnabled);
    if (control.name === "privateRevealDurationMinutes") {
      disabled = disabled || settings.privateRevealMode !== "timed";
    }
    if (control.matches("fieldset")) {
      control.disabled = disabled;
      for (const nested of control.querySelectorAll("[name]")) nested.disabled = disabled;
    } else {
      control.disabled = disabled;
    }
  }
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}
