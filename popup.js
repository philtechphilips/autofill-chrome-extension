const BACKEND_URL = "http://localhost:9000";
const STORAGE_KEY = "autofill_profiles";
const PRIVACY_NOTICE_KEY = "autofill_privacy_notice_dismissed";
const AUTH_STORAGE_KEY = "autofill_auth";
const FILL_HISTORY_KEY = "autofill_fill_history";
const PRIVACY_POLICY_URL = ""; // e.g. BACKEND_URL + "/privacy" or your policy URL

// File inputs selected by user in preview (not saved to profile, just for current fill)
let pendingFiles = {};

// Undo state - stores the previous form values before fill
let lastFillSession = null;

// Auth state
let authState = {
  accessToken: null,
  user: null
};

const fillBtn = document.getElementById("fill");
const backendOffEl = document.getElementById("backend-off");
const actionZone = document.getElementById("action-zone");
const previewSection = document.getElementById("preview-section");
const previewList = document.getElementById("preview-list");
const cancelPreviewBtn = document.getElementById("cancel-preview");
const saveAsProfileBtn = document.getElementById("save-as-profile-btn");
const confirmFillBtn = document.getElementById("confirm-fill");
const profileSection = document.getElementById("profile-section");
const profileSelect = document.getElementById("profile-select");
const profileMode = document.getElementById("profile-mode");
const manageProfilesBtn = document.getElementById("manage-profiles-btn");
const manageProfilesPanel = document.getElementById("manage-profiles-panel");
const profileListEl = document.getElementById("profile-list");
const privacyNoticeEl = document.getElementById("privacy-notice");
const privacyGotItBtn = document.getElementById("privacy-got-it");
const privacyPolicyLink = document.getElementById("privacy-policy-link");
const syncProfilesBtn = document.getElementById("sync-profiles-btn");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginModal = document.getElementById("login-modal");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loggedOutView = document.getElementById("logged-out-view");
const loggedInView = document.getElementById("logged-in-view");
const userEmailEl = document.getElementById("user-email");
const syncStatusEl = document.getElementById("sync-status");

let pendingFields = null;
let pendingValues = null;
let currentTabId = null;
let profiles = [];

function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[-\\s]+/g, "_")
    .replace(/^_|_$/g, "");
}

function sanitizeProfileName(name) {
  if (!name) return name;
  // Fix encoding issues with em-dash and other special characters
  return name
    .replace(/â€"/g, "-")  // Fix garbled em-dash
    .replace(/â€™/g, "'")  // Fix garbled apostrophe
    .replace(/â€œ/g, '"')  // Fix garbled left quote
    .replace(/â€/g, '"')   // Fix garbled right quote
    .replace(/–/g, "-")    // Replace em-dash with hyphen
    .replace(/—/g, "-");   // Replace en-dash with hyphen
}

async function loadProfiles() {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  profiles = Array.isArray(out[STORAGE_KEY]) ? out[STORAGE_KEY] : [];
  // Sanitize profile names to fix encoding issues
  let needsSave = false;
  profiles.forEach(p => {
    const sanitized = sanitizeProfileName(p.name);
    if (sanitized !== p.name) {
      p.name = sanitized;
      needsSave = true;
    }
  });
  if (needsSave) {
    await saveProfiles();
  }
  return profiles;
}

function saveProfiles() {
  return chrome.storage.local.set({ [STORAGE_KEY]: profiles });
}

function renderProfileSelect() {
  const selected = profileSelect.value;
  profileSelect.innerHTML = '<option value="">None (AI only)</option>';
  profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selected) opt.selected = true;
    profileSelect.appendChild(opt);
  });
  profileSection.classList.toggle("hide-profile-mode", !profileSelect.value);
}

function getSelectedProfile() {
  const id = profileSelect.value;
  return id ? profiles.find((p) => p.id === id) : null;
}

function getProfileMode() {
  return document.querySelector('input[name="profileMode"]:checked').value;
}

function profileValuesForFields(fields, profile) {
  const out = {};
  // Build normalized lookup from all profile data (except id and name)
  const normProfile = {};
  Object.keys(profile).forEach((k) => {
    if (k === "id" || k === "name") return;
    if (profile[k] != null && profile[k] !== "") {
      normProfile[normalizeKey(k)] = profile[k];
    }
  });
  // Match fields to profile data
  fields.forEach((f) => {
    const n = normalizeKey(f.key);
    if (normProfile[n] !== undefined) out[f.key] = normProfile[n];
  });
  return out;
}

function mergeProfileWithAiValues(fields, aiValues, profile) {
  const profileValues = profileValuesForFields(fields, profile);
  const merged = { ...aiValues };
  Object.keys(profileValues).forEach((k) => {
    merged[k] = profileValues[k];
  });
  return merged;
}

function buildProfileFromValues(values) {
  const profile = {};
  if (!values) return profile;
  // Save ALL form values to profile (not just fixed keys)
  Object.keys(values).forEach((key) => {
    const val = values[key];
    if (val != null && String(val).trim() !== "") {
      // Use normalized key for storage
      const normKey = normalizeKey(key);
      profile[normKey] = String(val).trim();
    }
  });
  return profile;
}

function savePreviewAsProfile() {
  if (!pendingValues) return;
  const data = buildProfileFromValues(pendingValues);
  if (Object.keys(data).length === 0) {
    const status = document.getElementById("status");
    status.innerText = "No data to save. Fill some fields first.";
    return;
  }
  const defaultName = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const name = window.prompt("Profile name (e.g. 'Job Application', 'Contact Form')", defaultName);
  if (name == null || name.trim() === "") return;
  const profile = {
    id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9),
    name: name.trim(),
    ...data
  };
  profiles.push(profile);
  saveProfiles();
  renderProfileSelect();
  const status = document.getElementById("status");
  status.innerText = `Saved "${profile.name}" with ${Object.keys(data).length} fields.`;
  setTimeout(() => {
    if (pendingValues) status.innerText = "Review and edit below, then click Fill form.";
  }, 2000);
}

async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/health`);
    if (res.ok) {
      backendOffEl.style.display = "none";
      fillBtn.disabled = false;
    } else {
      backendOffEl.textContent = "Cannot reach server.";
      backendOffEl.style.display = "block";
      fillBtn.disabled = true;
    }
  } catch {
    backendOffEl.textContent = "Cannot reach server.";
    backendOffEl.style.display = "block";
    fillBtn.disabled = true;
  }
}

function getLabelForKey(key) {
  if (!pendingFields) return key;
  const f = pendingFields.find((x) => x.key === key);
  return (f && f.label) || key;
}

function getFieldType(key) {
  if (!pendingFields) return "text";
  const f = pendingFields.find((x) => x.key === key);
  return (f && f.type) || "text";
}

function renderPreviewList() {
  if (!pendingValues && !pendingFields) return;
  previewList.innerHTML = "";
  pendingFiles = {};
  
  // Get all keys from both fields and values
  const fieldKeys = pendingFields ? pendingFields.map((f) => f.key) : [];
  const valueKeys = pendingValues ? Object.keys(pendingValues) : [];
  const allKeys = [...new Set([...fieldKeys, ...valueKeys])];
  
  for (const key of allKeys) {
    const value = pendingValues ? pendingValues[key] : undefined;
    const fieldType = getFieldType(key);
    const label = getLabelForKey(key);
    const row = document.createElement("div");
    row.className = "preview-row";
    row.dataset.key = key;
    
    // Handle file inputs specially
    if (fieldType === "file") {
      row.innerHTML = `
        <span class="preview-key" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
        <input type="file" class="file-input" style="flex: 1; font-size: 10px;">
      `;
      const fileInput = row.querySelector(".file-input");
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          pendingFiles[key] = e.target.files[0];
        }
      });
      previewList.appendChild(row);
      continue;
    }
    
    // Skip undefined values for non-file fields
    if (value === undefined) continue;
    
    const displayVal = value == null ? "" : String(value);
    row.innerHTML = `
      <span class="preview-key" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
      <span class="preview-val" title="${escapeAttr(displayVal)}">${escapeHtml(displayVal)}</span>
      <button type="button" class="edit-btn secondary">Edit</button>
    `;
    const valSpan = row.querySelector(".preview-val");
    const editBtn = row.querySelector(".edit-btn");

    editBtn.addEventListener("click", function onEditClick() {
      if (row.classList.contains("editing")) {
        const input = row.querySelector(".edit-input");
        if (input) {
          pendingValues[key] = input.value;
          row.classList.remove("editing");
          const newVal = document.createElement("span");
          newVal.className = "preview-val";
          newVal.title = input.value;
          newVal.textContent = input.value || "";
          input.replaceWith(newVal);
        }
        editBtn.textContent = "Edit";
        editBtn.onclick = onEditClick;
        return;
      }
      row.classList.add("editing");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "edit-input";
      input.value = displayVal;
      input.placeholder = "Value";
      valSpan.replaceWith(input);
      editBtn.textContent = "Save";
      input.focus();

      const save = () => {
        if (!row.classList.contains("editing")) return;
        pendingValues[key] = input.value;
        row.classList.remove("editing");
        const newVal = document.createElement("span");
        newVal.className = "preview-val";
        newVal.title = input.value;
        newVal.textContent = input.value || "";
        input.replaceWith(newVal);
        editBtn.textContent = "Edit";
        editBtn.onclick = onEditClick;
      };

      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      });
    });
    previewList.appendChild(row);
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function showPreview(fields, values, tabId) {
  pendingFields = fields;
  pendingValues = { ...values };
  currentTabId = tabId;
  const status = document.getElementById("status");
  status.innerText = "Review and edit below, then click Fill form.";
  renderPreviewList();
  actionZone.classList.add("hide-main");
  previewSection.classList.add("visible");
}

function cancelPreview() {
  pendingFields = null;
  pendingValues = null;
  pendingFiles = {};
  currentTabId = null;
  actionZone.classList.remove("hide-main");
  previewSection.classList.remove("visible");
  const status = document.getElementById("status");
  status.innerText = "";
  fillBtn.disabled = false;
  fillBtn.innerText = "Execute Autofill";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function captureFormState(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.extractFields !== "function") {
          return null;
        }
        const { fields } = window.extractFields();
        const state = {};
        fields.forEach(f => {
          if (f.currentValue !== undefined && f.currentValue !== "") {
            state[f.key] = f.currentValue;
          }
        });
        return state;
      }
    });
    return results[0]?.result || {};
  } catch {
    return {};
  }
}

async function saveFillHistory(session) {
  lastFillSession = session;
  await chrome.storage.local.set({ [FILL_HISTORY_KEY]: session });
  updateUndoButton();
}

async function loadFillHistory() {
  const out = await chrome.storage.local.get(FILL_HISTORY_KEY);
  lastFillSession = out[FILL_HISTORY_KEY] || null;
  updateUndoButton();
}

function updateUndoButton() {
  const undoBtn = document.getElementById("undo-fill-btn");
  if (!undoBtn) return;
  
  if (lastFillSession && lastFillSession.tabId) {
    undoBtn.style.display = "block";
    const timeAgo = getTimeAgo(lastFillSession.timestamp);
    undoBtn.title = `Undo fill from ${timeAgo}`;
  } else {
    undoBtn.style.display = "none";
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return "over a day ago";
}

async function undoLastFill() {
  if (!lastFillSession) {
    const status = document.getElementById("status");
    status.innerText = "No fill to undo";
    setTimeout(() => { status.innerText = ""; }, 2000);
    return;
  }
  
  const status = document.getElementById("status");
  const undoBtn = document.getElementById("undo-fill-btn");
  
  try {
    undoBtn.disabled = true;
    status.innerText = "Restoring previous values...";
    
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || tab.id !== lastFillSession.tabId) {
      status.innerText = "Please go back to the original tab to undo";
      setTimeout(() => { status.innerText = ""; }, 3000);
      return;
    }
    
    // Restore the previous values (including clearing fields that were empty)
    await chrome.scripting.executeScript({
      target: { tabId: lastFillSession.tabId },
      func: (previousValues, filledKeys) => {
        if (typeof window.undoFill !== "function") {
          throw new Error("Content script not loaded. Please refresh the page.");
        }
        window.undoFill(previousValues, filledKeys);
      },
      args: [lastFillSession.previousValues, Object.keys(lastFillSession.filledValues || {})]
    });
    
    status.innerText = "Restored previous values!";
    
    // Clear the undo history after successful restore
    lastFillSession = null;
    await chrome.storage.local.remove(FILL_HISTORY_KEY);
    updateUndoButton();
    
    setTimeout(() => { status.innerText = ""; }, 2000);
  } catch (err) {
    status.innerText = "Undo failed: " + (err.message || "Unknown error");
  } finally {
    undoBtn.disabled = false;
  }
}

async function confirmFill() {
  if ((!pendingValues || Object.keys(pendingValues).length === 0) && Object.keys(pendingFiles).length === 0) {
    return;
  }
  if (currentTabId == null) return;
  
  const status = document.getElementById("status");
  try {
    confirmFillBtn.disabled = true;
    status.innerText = "Capturing current state...";
    
    // Capture the current form state before filling (for undo)
    const previousValues = await captureFormState(currentTabId);
    
    status.innerText = "Filling form...";
    
    // Fill text values
    if (pendingValues && Object.keys(pendingValues).length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: (formValues) => {
          if (typeof window.fillForm !== "function") {
            throw new Error("Content script not loaded. Please refresh the page.");
          }
          window.fillForm(formValues);
        },
        args: [pendingValues]
      });
    }
    
    // Handle file inputs - convert files to transferable format and fill them
    const fileKeys = Object.keys(pendingFiles);
    if (fileKeys.length > 0) {
      status.innerText = "Setting files...";
      
      // Convert files to base64 for transfer
      const fileData = {};
      for (const key of fileKeys) {
        const file = pendingFiles[key];
        const base64 = await fileToBase64(file);
        fileData[key] = {
          name: file.name,
          type: file.type,
          base64: base64
        };
      }
      
      // Execute script to fill file inputs
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: (files) => {
          if (typeof window.fillFileInputs !== "function") {
            throw new Error("Content script not loaded. Please refresh the page.");
          }
          window.fillFileInputs(files);
        },
        args: [fileData]
      });
    }
    
    // Save fill history for undo
    await saveFillHistory({
      tabId: currentTabId,
      previousValues,
      filledValues: pendingValues,
      timestamp: Date.now(),
      pageUrl: (await chrome.tabs.get(currentTabId)).url
    });
    
    status.innerText = "Done! You can undo this fill.";
    setTimeout(() => {
      status.innerText = "";
    }, 3000);
  } catch (err) {
    status.innerText = "Error: " + (err.message || "Fill failed");
  } finally {
    confirmFillBtn.disabled = false;
    cancelPreview();
  }
}

cancelPreviewBtn.addEventListener("click", cancelPreview);
document.getElementById("undo-fill-btn").addEventListener("click", undoLastFill);
saveAsProfileBtn.addEventListener("click", savePreviewAsProfile);
confirmFillBtn.addEventListener("click", confirmFill);

profileSelect.addEventListener("change", () => {
  profileSection.classList.toggle("hide-profile-mode", !profileSelect.value);
});

manageProfilesBtn.addEventListener("click", () => {
  manageProfilesPanel.classList.toggle("visible", !manageProfilesPanel.classList.contains("visible"));
  if (manageProfilesPanel.classList.contains("visible")) renderProfileList();
});

document.getElementById("profile-cancel").addEventListener("click", () => {
  manageProfilesPanel.classList.remove("visible");
});

function renderProfileList() {
  profileListEl.innerHTML = "";
  profiles.forEach((p) => {
    // Count fields in profile (excluding id and name)
    const fieldCount = Object.keys(p).filter(k => k !== "id" && k !== "name").length;
    const row = document.createElement("div");
    row.className = "profile-list-item";
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(p.name)}</strong>
        <small style="color: var(--accents-3); display: block;">${fieldCount} field(s)</small>
      </span>
      <span>
        <button type="button" class="secondary view-profile-btn" data-id="${escapeAttr(p.id)}">View</button>
        <button type="button" class="secondary delete-profile-btn" data-id="${escapeAttr(p.id)}">Delete</button>
      </span>
    `;
    profileListEl.appendChild(row);
    
    row.querySelector(".view-profile-btn").addEventListener("click", () => {
      // Show profile fields in an alert (simple approach)
      const fields = Object.keys(p)
        .filter(k => k !== "id" && k !== "name")
        .map(k => `${k}: ${p[k]}`)
        .join("\n");
      alert(`Profile: ${p.name}\n\n${fields || "No fields"}`);
    });
    
    row.querySelector(".delete-profile-btn").addEventListener("click", () => {
      if (confirm(`Delete profile "${p.name}"?`)) {
        profiles = profiles.filter((x) => x.id !== p.id);
        saveProfiles();
        renderProfileSelect();
        renderProfileList();
      }
    });
  });
}

async function initPrivacyNotice() {
  const out = await chrome.storage.local.get(PRIVACY_NOTICE_KEY);
  if (out[PRIVACY_NOTICE_KEY]) {
    privacyNoticeEl.style.display = "none";
    return;
  }
  privacyNoticeEl.style.display = "block";
  if (PRIVACY_POLICY_URL) {
    privacyPolicyLink.href = PRIVACY_POLICY_URL;
    privacyPolicyLink.parentElement.style.display = "";
  } else {
    privacyPolicyLink.parentElement.style.display = "none";
  }
}

privacyGotItBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [PRIVACY_NOTICE_KEY]: true });
  privacyNoticeEl.style.display = "none";
});

(async () => {
  await loadProfiles();
  renderProfileSelect();
  await initPrivacyNotice();
})();

checkHealth();

fillBtn.onclick = async () => {
  const status = document.getElementById("status");

  try {
    fillBtn.disabled = true;
    fillBtn.innerText = "Analyzing...";
    status.innerText = "Scanning form fields...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.extractFields !== "function") {
          throw new Error("Content script not loaded. Please refresh the page.");
        }
        return window.extractFields();
      }
    });

    if (!results || !results[0]) {
      throw new Error("Failed to communicate with the page. Try refreshing.");
    }

    const result = results[0].result;
    if (!result) {
      throw new Error("Could not extract form data. Please refresh the page and try again.");
    }

    const { fields, context, pageUrl, pageTitle } = result;
    if (!fields || fields.length === 0) {
      status.innerText = "No form fields found!";
      fillBtn.disabled = false;
      fillBtn.innerText = "Execute Autofill";
      return;
    }

    const fillOnlyEmpty = document.querySelector('input[name="fillMode"]:checked').value === "empty";
    const profile = getSelectedProfile();
    const profileModeVal = getProfileMode();

    if (profile && profileModeVal === "only") {
      const values = profileValuesForFields(fields, profile);
      if (Object.keys(values).length === 0) {
        status.innerText = "No form fields match this profile. Try \"Profile + AI for rest\" or add more profile fields.";
        fillBtn.disabled = false;
        fillBtn.innerText = "Execute Autofill";
        return;
      }
      showPreview(fields, values, tab.id);
      return;
    }

    if (profile && profileModeVal === "plus_ai") {
      status.innerText = "Generating AI (profile will fill matching fields)...";
    } else {
      status.innerText = "Generating AI responses...";
    }

    let response;
    try {
      response = await fetch(`${BACKEND_URL}/api/v1/form/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, context, pageUrl, pageTitle, fillOnlyEmpty })
      });
    } catch (err) {
      throw new Error("Cannot reach server");
    }

    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }

    const responseData = await response.json();
    let values = responseData.data || responseData;
    if (profile && profileModeVal === "plus_ai") {
      values = mergeProfileWithAiValues(fields, values, profile);
    }
    showPreview(fields, values, tab.id);
  } catch (error) {
    console.error("Autofill error:", error);
    status.innerText = "Error: " + error.message;
    fillBtn.disabled = false;
    fillBtn.innerText = "Execute Autofill";
  }
};

// ==================== AUTH & SYNC ====================

async function loadAuthState() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  if (stored[AUTH_STORAGE_KEY]) {
    authState = stored[AUTH_STORAGE_KEY];
  }
  updateAuthUI();
}

async function saveAuthState() {
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: authState });
}

function updateAuthUI() {
  if (authState.accessToken && authState.user) {
    loggedOutView.style.display = "none";
    loggedInView.style.display = "block";
    userEmailEl.textContent = authState.user.email;
    
    // Only show sync button if encryption is initialized
    if (window.CryptoUtils.isEncryptionInitialized()) {
      syncProfilesBtn.style.display = "inline";
      syncStatusEl.textContent = "";
    } else {
      syncProfilesBtn.style.display = "none";
      syncStatusEl.textContent = "Log in again to sync";
    }
  } else {
    loggedOutView.style.display = "block";
    loggedInView.style.display = "none";
    syncProfilesBtn.style.display = "none";
  }
}

async function apiRequest(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  
  if (authState.accessToken) {
    headers["Authorization"] = `Bearer ${authState.accessToken}`;
  }
  
  const response = await fetch(`${BACKEND_URL}/api/v1${endpoint}`, {
    ...options,
    headers,
    credentials: "include"
  });
  
  if (response.status === 401 && authState.accessToken) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${authState.accessToken}`;
      return fetch(`${BACKEND_URL}/api/v1${endpoint}`, {
        ...options,
        headers,
        credentials: "include"
      });
    }
  }
  
  return response;
}

async function refreshToken() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    
    if (response.ok) {
      const data = await response.json();
      authState.accessToken = data.data.accessToken;
      authState.user = data.data.user;
      await saveAuthState();
      return true;
    }
  } catch (err) {
    console.error("Token refresh failed:", err);
  }
  
  authState = { accessToken: null, user: null };
  await saveAuthState();
  updateAuthUI();
  return false;
}

async function login(email, password) {
  const response = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Login failed");
  }
  
  authState.accessToken = data.data.accessToken;
  authState.user = data.data.user;
  await saveAuthState();
  
  // Initialize encryption with server-provided key
  if (data.data.encryptionKey) {
    await window.CryptoUtils.initializeEncryption(data.data.encryptionKey);
  }
  
  updateAuthUI();
  
  // Pull profiles from cloud (now we can decrypt them)
  await pullProfilesFromCloud();
  
  return data;
}

async function register(email, password, name) {
  const response = await fetch(`${BACKEND_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, name })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Registration failed");
  }
  
  authState.accessToken = data.data.accessToken;
  authState.user = data.data.user;
  await saveAuthState();
  
  // Initialize encryption with server-provided key
  if (data.data.encryptionKey) {
    await window.CryptoUtils.initializeEncryption(data.data.encryptionKey);
  }
  
  updateAuthUI();
  
  return data;
}

async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout error:", err);
  }
  
  // Clear encryption state
  window.CryptoUtils.clearEncryption();
  
  authState = { accessToken: null, user: null };
  await saveAuthState();
  updateAuthUI();
}

async function syncProfilesToCloud() {
  if (!authState.accessToken) {
    throw new Error("Not logged in");
  }
  
  if (!window.CryptoUtils.isEncryptionInitialized()) {
    throw new Error("Please log in again to sync profiles");
  }
  
  syncStatusEl.textContent = "Syncing...";
  
  try {
    const encryptedProfiles = [];
    
    for (const profile of profiles) {
      // Copy all profile data except id (name is kept separate)
      const profileData = {};
      Object.keys(profile).forEach(k => {
        if (k !== "id" && k !== "name" && profile[k]) {
          profileData[k] = profile[k];
        }
      });
      
      const { encryptedData, iv } = await window.CryptoUtils.encryptData(profileData);
      encryptedProfiles.push({
        name: profile.name,
        encryptedData,
        iv
      });
    }
    
    const response = await apiRequest("/profiles/sync", {
      method: "POST",
      body: JSON.stringify({ profiles: encryptedProfiles })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Sync failed");
    }
    
    syncStatusEl.textContent = `Synced ${profiles.length} profile(s)`;
    setTimeout(() => { syncStatusEl.textContent = ""; }, 3000);
  } catch (err) {
    syncStatusEl.textContent = "Sync failed: " + err.message;
    throw err;
  }
}

async function pullProfilesFromCloud() {
  if (!authState.accessToken) return;
  
  if (!window.CryptoUtils.isEncryptionInitialized()) {
    syncStatusEl.textContent = "Log in again to load profiles";
    return;
  }
  
  syncStatusEl.textContent = "Loading profiles...";
  
  try {
    const response = await apiRequest("/profiles");
    
    if (!response.ok) {
      throw new Error("Failed to fetch profiles");
    }
    
    const data = await response.json();
    const cloudProfiles = data.data.profiles;
    
    if (cloudProfiles.length === 0) {
      syncStatusEl.textContent = "No cloud profiles";
      setTimeout(() => { syncStatusEl.textContent = ""; }, 2000);
      return;
    }
    
    const decryptedProfiles = [];
    
    for (const cp of cloudProfiles) {
      try {
        const profileData = await window.CryptoUtils.decryptData(cp.encryptedData, cp.iv);
        decryptedProfiles.push({
          id: cp.id,
          name: cp.name,
          ...profileData
        });
      } catch (err) {
        console.error("Failed to decrypt profile:", cp.name, err);
      }
    }
    
    if (decryptedProfiles.length > 0) {
      profiles = decryptedProfiles;
      await saveProfiles();
      renderProfileSelect();
      renderProfileList();
    }
    
    syncStatusEl.textContent = `Loaded ${decryptedProfiles.length} profile(s)`;
    setTimeout(() => { syncStatusEl.textContent = ""; }, 2000);
  } catch (err) {
    console.error("Pull profiles error:", err);
    syncStatusEl.textContent = "";
  }
}

// Auth UI event listeners
loginBtn.addEventListener("click", () => {
  loginModal.style.display = "block";
  loginForm.style.display = "block";
  registerForm.style.display = "none";
});

document.getElementById("login-cancel").addEventListener("click", () => {
  loginModal.style.display = "none";
  loginForm.reset();
});

document.getElementById("register-cancel").addEventListener("click", () => {
  loginModal.style.display = "none";
  registerForm.reset();
});

document.getElementById("show-register").addEventListener("click", (e) => {
  e.preventDefault();
  loginForm.style.display = "none";
  registerForm.style.display = "block";
});

document.getElementById("show-login").addEventListener("click", (e) => {
  e.preventDefault();
  registerForm.style.display = "none";
  loginForm.style.display = "block";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  
  try {
    errorEl.style.display = "none";
    await login(email, password);
    loginModal.style.display = "none";
    loginForm.reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  const errorEl = document.getElementById("register-error");
  
  try {
    errorEl.style.display = "none";
    await register(email, password, name);
    loginModal.style.display = "none";
    registerForm.reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

syncProfilesBtn.addEventListener("click", async () => {
  try {
    await syncProfilesToCloud();
  } catch (err) {
    console.error("Sync error:", err);
  }
});

loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) {
    loginModal.style.display = "none";
  }
});

// Initialize auth and fill history on load
loadAuthState();
loadFillHistory();
