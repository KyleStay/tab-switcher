import { COMMAND_LABELS, DEFAULT_SETTINGS, SETTING_LIMITS } from "./core/defaults.js";

const formControls = [...document.querySelectorAll("[name]")];
const shortcutSummary = document.querySelector("#shortcutSummary");
const openShortcutSettings = document.querySelector("#openShortcutSettings");
const resetSettings = document.querySelector("#resetSettings");
const saveStatus = document.querySelector("#saveStatus");
const privateTabsAccessMessage = document.querySelector("#privateTabsAccessMessage");
const privateControls = [...document.querySelectorAll("[data-private-control]")];
const helpButtons = [...document.querySelectorAll(".help-button")];
const popupSites = document.querySelector("#popupSites");

let settings = null;
let privateTabsAccess = false;
let statusTimer = null;
let saveQueue = Promise.resolve();
let resetting = false;

init();

async function init() {
  try {
    const response = await send({ type: "get-settings" });
    settings = response.settings;
    privateTabsAccess = Boolean(response.privateTabsAccess);
    renderSettings();
    renderCommands(response.commands);
    for (const control of formControls) control.disabled = false;
    renderDependentSettings();
    openShortcutSettings.disabled = resetSettings.disabled = false;
    bindEvents();
  } catch (error) {
    shortcutSummary.querySelector("dt").textContent = "Shortcuts unavailable";
    setStatus("Settings could not be loaded.", true);
  }
}

function bindEvents() {
  for (const control of formControls) {
    control.addEventListener("change", saveSettings);
  }
  for (const button of helpButtons) {
    const description = document.createElement("span");
    description.id = `help-${helpButtons.indexOf(button)}`;
    description.className = "help-text";
    description.textContent = button.dataset.help;
    description.hidden = true;
    button.after(description);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", description.id);
    const field = button.closest(".setting-row, fieldset");
    for (const control of field.querySelectorAll("[name]")) control.setAttribute("aria-describedby", description.id);
    button.addEventListener("click", (event) => {
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
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    try {
      const response = await send({ type: "get-settings" });
      renderCommands(response.commands);
      privateTabsAccess = Boolean(response.privateTabsAccess);
      renderDependentSettings();
    } catch (error) {
      setStatus(error?.message || "Could not refresh settings.", true);
    }
  });
  resetSettings.addEventListener("click", resetToDefaults);
}

function renderSettings() {
  for (const control of formControls) renderControl(control);
}

function renderControl(control) {
  const value = settings[control.name];
  if (control.type === "checkbox") control.checked = Boolean(value);
  else if (Array.isArray(value)) control.value = value.join("\n");
  else control.value = value;
}

function renderCommands(commands) {
  const assigned = new Map(commands.map(({ name, shortcut }) => [name, shortcut]));
  shortcutSummary.replaceChildren(...Object.entries(COMMAND_LABELS).map(([name, label]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const details = document.createElement("dd");
    const shortcut = assigned.get(name);
    term.textContent = label;
    if (shortcut) {
      const key = document.createElement("kbd");
      key.textContent = shortcut;
      details.append(key);
    } else {
      details.textContent = "Unassigned";
    }
    row.append(term, details);
    return row;
  }));
}

async function saveSettings(event) {
  const control = event.currentTarget;
  if (!control.checkValidity()) {
    control.reportValidity();
    setStatus(validationMessage(control), true);
    return;
  }

  const value = controlValue(control);
  await commitSettings({ [control.name]: value }, "Saved", () => {
    if (controlValue(control) === value) renderControl(control);
  });
}

function controlValue(control) {
  return control.type === "checkbox"
    ? control.checked
    : control.type === "number"
      ? Number(control.value)
      : control.value;

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
  if (!window.confirm("Reset all Tab Switcher settings to their defaults?")) return;
  resetting = true;
  for (const control of formControls) control.disabled = true;
  resetSettings.disabled = true;
  await commitSettings(DEFAULT_SETTINGS, "Defaults restored", renderSettings);
  resetting = false;
  for (const control of formControls) control.disabled = false;
  renderDependentSettings();
  resetSettings.disabled = false;
  resetSettings.focus();
}

function commitSettings(patch, successMessage, render) {
  saveQueue = saveQueue.then(async () => {
    try {
      const response = await send({ type: "update-settings", settings: patch });
      settings = response.settings;
      privateTabsAccess = Boolean(response.privateTabsAccess);
      setStatus(successMessage);
    } catch (error) {
      setStatus(error?.message || "Could not save settings.", true);
    }
    render();
    renderDependentSettings();
  });
  return saveQueue;
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

function renderDependentSettings() {
  if (!settings || resetting) return;
  popupSites.hidden = document.querySelector("#setting-launchMode").value !== "hybrid";
  privateTabsAccessMessage.textContent = privateTabsAccess
    ? settings.privateTabsEnabled ? "Search history is off while private tab support is enabled." : "Enable private tab support to include incognito tabs."
    : "Turn on Allow in Incognito in Chrome’s extension details to use these settings.";

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
