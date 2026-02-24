  const BACKEND_URL = "http://localhost:9000";
const FRONTEND_URL = "https://autofill.live";
const STORAGE_KEY = "autofill_profiles";
const PRIVACY_NOTICE_KEY = "autofill_privacy_notice_dismissed";
const AUTH_STORAGE_KEY = "autofill_auth";
const FILL_HISTORY_KEY = "autofill_fill_history";
const CREDITS_CACHE_KEY = "autofill_credits_cache";
const PRIVACY_POLICY_URL = "https://autofill.live/privacy";

// Credits state
let userCredits = 0;

// File inputs selected by user in preview (not saved to profile, just for current fill)
let pendingFiles = {};

// Analytics tracking - sends usage events to backend (non-blocking)
async function trackEvent(eventData) {
  if (!authState.accessToken) return;

  try {
    await fetch(`${BACKEND_URL}/api/v1/analytics/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authState.accessToken}`
      },
      body: JSON.stringify(eventData)
    });
  } catch (err) {
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Undo state - stores the previous form values before fill
let lastFillSession = null;

// Auth state
let authState = {
  accessToken: null,
  user: null
};

// UI Elements for credits
const creditsDisplay = document.getElementById("credits-display");
const creditsAmount = document.getElementById("credits-amount");
const buyCreditsLink = document.getElementById("buy-credits-link");
const loginRequiredNotice = document.getElementById("login-required-notice");
const loginRequiredBtn = document.getElementById("login-required-btn");
const emailVerificationNotice = document.getElementById("email-verification-notice");
const resendVerificationBtn = document.getElementById("resend-verification-btn");
const insufficientCreditsNotice = document.getElementById("insufficient-credits-notice");
const buyCreditsBtn = document.getElementById("buy-credits-btn");
const dashboardLink = document.getElementById("dashboard-link");

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
      // Check if this is a Google Form (file uploads can't be automated there)
      const field = pendingFields ? pendingFields.find(f => f.key === key) : null;
      const isGoogleFormFile = field ? field.isGoogleForm === true : false;

      if (isGoogleFormFile) {
        // Google Forms file uploads require manual interaction
        row.innerHTML = `
          <span class="preview-key" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
          <span class="preview-val" style="flex: 1; font-size: 10px; color: #888; font-style: italic;">
            Manual upload required (Google Forms security)
          </span>
        `;
      } else {
        // Standard HTML file input - can be filled
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
      }
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
  await updateUndoButton();
}

async function loadFillHistory() {
  const out = await chrome.storage.local.get(FILL_HISTORY_KEY);
  lastFillSession = out[FILL_HISTORY_KEY] || null;
  await updateUndoButton();
}

async function updateUndoButton() {
  const undoBtn = document.getElementById("undo-fill-btn");
  if (!undoBtn) return;

  if (lastFillSession && lastFillSession.tabId) {
    try {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab && currentTab.id === lastFillSession.tabId) {
        undoBtn.classList.add("visible");
        const timeAgo = getTimeAgo(lastFillSession.timestamp);
        undoBtn.title = `Undo fill from ${timeAgo}`;
        return;
      }
    } catch (e) {
      // Tab query failed, hide button
    }
  }
  undoBtn.classList.remove("visible");
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
    await updateUndoButton();

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
        func: (formValues, fieldsMeta) => {
          if (typeof window.fillForm !== "function") {
            throw new Error("Content script not loaded. Please refresh the page.");
          }
          window.fillForm(formValues, fieldsMeta);
        },
        args: [pendingValues, pendingFields || []]
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
    const tabInfo = await chrome.tabs.get(currentTabId);
    await saveFillHistory({
      tabId: currentTabId,
      previousValues,
      filledValues: pendingValues,
      timestamp: Date.now(),
      pageUrl: tabInfo.url
    });

    // Track form fill event
    const profile = getSelectedProfile();
    const profileModeVal = profile ? getProfileMode() : null;
    let fillMode = "ai_only";
    if (profile && profileModeVal === "only") fillMode = "profile_only";
    else if (profile && profileModeVal === "plus_ai") fillMode = "merged";

    trackEvent({
      type: "form_fill",
      domain: extractDomain(tabInfo.url),
      pageTitle: tabInfo.title,
      fieldCount: pendingValues ? Object.keys(pendingValues).length : 0,
      success: true,
      profileId: profile?.id || null,
      fillMode
    });

    status.innerText = "Done! You can undo this fill.";
    setTimeout(() => {
      status.innerText = "";
    }, 3000);
  } catch (err) {
    status.innerText = "Error: " + (err.message || "Fill failed");

    // Track failed fill
    trackEvent({
      type: "form_fill",
      success: false
    });
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

  // Check if user is logged in
  if (!authState.accessToken) {
    status.innerText = "Please sign in to use Autofill.AI";
    loginModal.style.display = "block";
    loginForm.style.display = "block";
    registerForm.style.display = "none";
    return;
  }

  // Check if user has credits
  if (userCredits <= 0) {
    status.innerText = "You need credits to use AI autofill";
    insufficientCreditsNotice.style.display = "block";
    return;
  }

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

    // Profile-only mode doesn't require AI (no credits needed)
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
    } else if (profile) {
      status.innerText = profile.isCV ? "Generating AI with your CV data..." : "Generating AI responses...";
    } else {
      status.innerText = "Generating AI responses...";
    }

    // Only send profile data if user explicitly selected one
    const profileDataForAI = profile || null;

    let response;
    try {
      // Use authenticated API request
      response = await apiRequest("/form/analyze", {
        method: "POST",
        body: JSON.stringify({
          fields,
          context,
          pageUrl,
          pageTitle,
          fillOnlyEmpty,
          profileData: profileDataForAI
        })
      });
    } catch (err) {
      throw new Error("Cannot reach server");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 402) {
        // Insufficient credits
        userCredits = 0;
        updateCreditsUI();
        throw new Error("Insufficient credits. Please purchase more.");
      }
      throw new Error(errorData.error || `Server error: ${response.statusText}`);
    }

    const responseData = await response.json();
    let values = responseData.data || responseData;
    
    // Update credits if returned in response
    if (responseData.creditsRemaining !== undefined) {
      userCredits = responseData.creditsRemaining;
      updateCreditsUI();
    }
    
    if (profile && profileModeVal === "plus_ai") {
      values = mergeProfileWithAiValues(fields, values, profile);
    }
    showPreview(fields, values, tab.id);
  } catch (error) {
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
    
    // Re-initialize encryption if we have the key stored
    if (authState.encryptionKey) {
      try {
        await window.CryptoUtils.initializeEncryption(authState.encryptionKey);
      } catch (err) {
        console.error("Failed to initialize encryption:", err);
      }
    }
    
    // Refresh user data from server to get latest verification status
    if (authState.accessToken) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
          headers: { "Authorization": `Bearer ${authState.accessToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.data?.user) {
            authState.user = data.data.user;
            await saveAuthState();
          }
        }
      } catch (err) {
        // Silently fail - use cached data
      }
    }
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
    
    // Hide login notice
    loginRequiredNotice.style.display = "none";
    
    // Check if email is verified
    if (!authState.user.isEmailVerified) {
      // Email not verified - show verification notice and disable features
      emailVerificationNotice.style.display = "block";
      creditsDisplay.style.display = "none";
      insufficientCreditsNotice.style.display = "none";
      
      fillBtn.disabled = true;
      actionZone.style.opacity = "0.6";
      actionZone.style.pointerEvents = "none";
      syncProfilesBtn.style.display = "none";
      return;
    }
    
    // Email is verified - show credits display
    emailVerificationNotice.style.display = "none";
    creditsDisplay.style.display = "block";
    
    // Enable main action buttons
    fillBtn.disabled = false;
    actionZone.style.opacity = "1";
    actionZone.style.pointerEvents = "auto";

    // Only show sync button if encryption is initialized
    if (window.CryptoUtils.isEncryptionInitialized()) {
      syncProfilesBtn.style.display = "inline";
      syncStatusEl.textContent = "";
    } else {
      syncProfilesBtn.style.display = "none";
      syncStatusEl.textContent = "Log in again to sync";
    }
    
    // Fetch credits
    fetchCredits();
  } else {
    loggedOutView.style.display = "block";
    loggedInView.style.display = "none";
    syncProfilesBtn.style.display = "none";
    
    // Hide credits display and show login notice
    creditsDisplay.style.display = "none";
    loginRequiredNotice.style.display = "block";
    emailVerificationNotice.style.display = "none";
    insufficientCreditsNotice.style.display = "none";
    
    // Disable main action buttons
    fillBtn.disabled = true;
    actionZone.style.opacity = "0.6";
    actionZone.style.pointerEvents = "none";
  }
}

async function fetchCredits() {
  if (!authState.accessToken) return;
  
  try {
    const response = await apiRequest("/payment/credits");
    if (response.ok) {
      const data = await response.json();
      userCredits = data.data?.credits || 0;
      updateCreditsUI();
      
      // Cache credits
      await chrome.storage.local.set({ 
        [CREDITS_CACHE_KEY]: { 
          credits: userCredits, 
          timestamp: Date.now() 
        } 
      });
    }
  } catch (err) {
    // Try to load from cache
    const cached = await chrome.storage.local.get(CREDITS_CACHE_KEY);
    if (cached[CREDITS_CACHE_KEY]) {
      userCredits = cached[CREDITS_CACHE_KEY].credits;
      updateCreditsUI();
    }
  }
}

function updateCreditsUI() {
  creditsAmount.textContent = userCredits.toLocaleString();
  
  if (userCredits <= 0) {
    insufficientCreditsNotice.style.display = "block";
    fillBtn.disabled = true;
  } else {
    insufficientCreditsNotice.style.display = "none";
    fillBtn.disabled = false;
  }
}

function openBillingPage() {
  chrome.tabs.create({ url: `${FRONTEND_URL}/dashboard/billing` });
}

function openDashboard() {
  chrome.tabs.create({ url: `${FRONTEND_URL}/dashboard` });
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
      // Preserve existing encryption key (refresh doesn't return a new one)
      await saveAuthState();
      return true;
    }
  } catch (err) {
  }

  authState = { accessToken: null, user: null, encryptionKey: null };
  await saveAuthState();
  updateAuthUI();

  const status = document.getElementById("status");
  if (status) status.innerText = "Session expired. Please log in.";

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
  authState.encryptionKey = data.data.encryptionKey || null;
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
  authState.encryptionKey = data.data.encryptionKey || null;
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
  }

  // Clear encryption state
  window.CryptoUtils.clearEncryption();

  authState = { accessToken: null, user: null, encryptionKey: null };
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

// Credits and billing event listeners
buyCreditsLink.addEventListener("click", (e) => {
  e.preventDefault();
  openBillingPage();
});

buyCreditsBtn.addEventListener("click", () => {
  openBillingPage();
});

loginRequiredBtn.addEventListener("click", () => {
  loginModal.style.display = "block";
  loginForm.style.display = "block";
  registerForm.style.display = "none";
});

resendVerificationBtn.addEventListener("click", async () => {
  if (!authState.user?.email) return;
  
  resendVerificationBtn.disabled = true;
  resendVerificationBtn.textContent = "Sending...";
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authState.user.email })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      resendVerificationBtn.textContent = "Email Sent!";
      setTimeout(() => {
        resendVerificationBtn.textContent = "Resend Verification Email";
        resendVerificationBtn.disabled = false;
      }, 3000);
    } else {
      resendVerificationBtn.textContent = data.error || "Failed to send";
      setTimeout(() => {
        resendVerificationBtn.textContent = "Resend Verification Email";
        resendVerificationBtn.disabled = false;
      }, 3000);
    }
  } catch (err) {
    resendVerificationBtn.textContent = "Failed to send";
    setTimeout(() => {
      resendVerificationBtn.textContent = "Resend Verification Email";
      resendVerificationBtn.disabled = false;
    }, 3000);
  }
});

dashboardLink.addEventListener("click", (e) => {
  e.preventDefault();
  openDashboard();
});

syncProfilesBtn.addEventListener("click", async () => {
  try {
    await syncProfilesToCloud();
  } catch (err) {
  }
});

loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) {
    loginModal.style.display = "none";
  }
});

// ==================== CV Upload & Parsing ====================

const cvUploadArea = document.getElementById("cv-upload-area");
const cvFileInput = document.getElementById("cv-file-input");
const cvStatus = document.getElementById("cv-status");
const cvSection = document.getElementById("cv-section");
const cvToggleBtn = document.getElementById("cv-toggle-btn");
const cvToggleText = document.getElementById("cv-toggle-text");
const cvToggleArrow = document.getElementById("cv-toggle-arrow");

let cvSectionVisible = false;

function getCVProfiles() {
  return profiles.filter(p => p.isCV);
}

function getCVProfile() {
  return profiles.find(p => p.isCV);
}

function toggleCVSection() {
  cvSectionVisible = !cvSectionVisible;
  cvSection.style.display = cvSectionVisible ? "block" : "none";
  cvToggleArrow.style.transform = cvSectionVisible ? "rotate(180deg)" : "";
}

function updateCVUI() {
  const cvProfiles = getCVProfiles();
  const cvParsedInfo = document.getElementById("cv-parsed-info");
  const cvParsedName = document.getElementById("cv-parsed-name");
  const cvParsedDetails = document.getElementById("cv-parsed-details");

  if (cvProfiles.length > 0) {
    // Update toggle button text to show CV count
    if (cvProfiles.length === 1) {
      cvToggleText.textContent = `CV: ${cvProfiles[0].name.replace("CV - ", "")}`;
    } else {
      cvToggleText.textContent = `${cvProfiles.length} CVs uploaded`;
    }
    cvToggleText.style.color = "var(--fg)";
    cvToggleText.style.fontWeight = "500";

    // Always show upload area so user can add more
    cvUploadArea.style.display = "block";
    cvParsedInfo.style.display = "block";

    // Show list of CV profiles
    const cvNames = cvProfiles.map(p => p.name.replace("CV - ", "")).join(", ");
    cvParsedName.textContent = cvProfiles.length === 1 ? cvProfiles[0].name.replace("CV - ", "") : `${cvProfiles.length} CVs`;

    const latestCV = cvProfiles[0];
    const details = [];
    if (latestCV.email) details.push(latestCV.email);
    if (latestCV.job_title) details.push(latestCV.job_title);
    details.push("Select from profiles dropdown");
    cvParsedDetails.textContent = details.join(" • ");
  } else {
    // Reset toggle button text
    cvToggleText.textContent = "Upload CV / Resume";
    cvToggleText.style.color = "";
    cvToggleText.style.fontWeight = "";

    cvUploadArea.style.display = "block";
    cvParsedInfo.style.display = "none";
  }
}

// CV Results Modal
const cvResultsModal = document.getElementById("cv-results-modal");
const cvResultsContent = document.getElementById("cv-results-content");

function showCVResultsModal(parsed, profileName) {
  let html = '';

  // Personal Info
  if (parsed.personal) {
    const p = parsed.personal;
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        Personal Info
      </div>`;
    if (p.first_name || p.last_name || p.full_name) html += `<div class="cv-item"><strong>Name:</strong> ${p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim()}</div>`;
    if (p.email) html += `<div class="cv-item"><strong>Email:</strong> ${p.email}</div>`;
    if (p.phone) html += `<div class="cv-item"><strong>Phone:</strong> ${p.phone}</div>`;
    if (p.address || p.city || p.country) html += `<div class="cv-item"><strong>Location:</strong> ${p.address || [p.city, p.state, p.country].filter(Boolean).join(', ')}</div>`;
    if (p.nationality) html += `<div class="cv-item"><strong>Nationality:</strong> ${p.nationality}</div>`;
    if (p.date_of_birth) html += `<div class="cv-item"><strong>DOB:</strong> ${p.date_of_birth}</div>`;
    if (p.linkedin) html += `<div class="cv-item"><strong>LinkedIn:</strong> ${p.linkedin}</div>`;
    if (p.github) html += `<div class="cv-item"><strong>GitHub:</strong> ${p.github}</div>`;
    if (p.portfolio || p.website) html += `<div class="cv-item"><strong>Website:</strong> ${p.portfolio || p.website}</div>`;
    if (p.headline) html += `<div class="cv-item"><strong>Headline:</strong> ${p.headline}</div>`;
    if (p.summary) html += `<div class="cv-item"><strong>Summary:</strong> ${p.summary.substring(0, 200)}${p.summary.length > 200 ? '...' : ''}</div>`;
    if (p.availability) html += `<div class="cv-item"><strong>Availability:</strong> ${p.availability}</div>`;
    if (p.desired_salary) html += `<div class="cv-item"><strong>Desired Salary:</strong> ${p.desired_salary}</div>`;
    html += `</div>`;
  }

  // Work Experience
  if (parsed.work_experience?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
        Work Experience (${parsed.work_experience.length})
      </div>`;
    parsed.work_experience.forEach(job => {
      html += `<div class="cv-job">
        <div class="cv-job-title">${job.title || 'Unknown Title'}${job.employment_type ? ` (${job.employment_type})` : ''}</div>
        <div class="cv-job-company">${job.company || 'Unknown Company'}${job.department ? ` - ${job.department}` : ''}</div>
        <div class="cv-job-dates">${job.start_date || ''} - ${job.end_date || 'Present'}${job.location ? ` | ${job.location}` : ''}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Education
  if (parsed.education?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3 3 9 3 12 0v-5"/>
        </svg>
        Education (${parsed.education.length})
      </div>`;
    parsed.education.forEach(edu => {
      html += `<div class="cv-edu">
        <div class="cv-edu-degree">${edu.degree || ''} ${edu.field ? 'in ' + edu.field : ''}${edu.honors ? ` - ${edu.honors}` : ''}</div>
        <div class="cv-edu-school">${edu.institution || 'Unknown Institution'}</div>
        <div class="cv-edu-dates">${edu.start_date || ''} - ${edu.end_date || ''}${edu.gpa ? ` | GPA: ${edu.gpa}` : ''}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Skills
  if (parsed.skills) {
    const allSkills = [
      ...(parsed.skills.technical || []),
      ...(parsed.skills.programming_languages || parsed.skills.programming || []),
      ...(parsed.skills.frameworks || []),
      ...(parsed.skills.tools || []),
      ...(parsed.skills.databases || []),
      ...(parsed.skills.cloud || []),
      ...(parsed.skills.other || [])
    ];
    if (allSkills.length > 0) {
      html += `<div class="cv-section">
        <div class="cv-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Technical Skills (${allSkills.length})
        </div>
        <div class="cv-skills-list">
          ${allSkills.slice(0, 20).map(s => `<span class="cv-skill-tag">${s}</span>`).join('')}
          ${allSkills.length > 20 ? `<span class="cv-skill-tag">+${allSkills.length - 20} more</span>` : ''}
        </div>
      </div>`;
    }
    if (parsed.skills.soft_skills?.length > 0) {
      html += `<div class="cv-section">
        <div class="cv-section-title">Soft Skills (${parsed.skills.soft_skills.length})</div>
        <div class="cv-skills-list">
          ${parsed.skills.soft_skills.map(s => `<span class="cv-skill-tag">${s}</span>`).join('')}
        </div>
      </div>`;
    }
  }

  // Languages
  if (parsed.languages?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        Languages (${parsed.languages.length})
      </div>
      <div class="cv-skills-list">
        ${parsed.languages.map(l => `<span class="cv-skill-tag">${l.language} (${l.proficiency || 'N/A'})</span>`).join('')}
      </div>
    </div>`;
  }

  // Certifications
  if (parsed.certifications?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="8" r="7"/>
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
        </svg>
        Certifications (${parsed.certifications.length})
      </div>`;
    parsed.certifications.forEach(cert => {
      html += `<div class="cv-item"><strong>${cert.name}</strong>${cert.issuer ? ' - ' + cert.issuer : ''}${cert.date ? ' (' + cert.date + ')' : ''}</div>`;
    });
    html += `</div>`;
  }

  // Projects
  if (parsed.projects?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Projects (${parsed.projects.length})
      </div>`;
    parsed.projects.forEach(proj => {
      html += `<div class="cv-item"><strong>${proj.name}</strong>${proj.role ? ` (${proj.role})` : ''}${proj.description ? ': ' + proj.description.substring(0, 80) + (proj.description.length > 80 ? '...' : '') : ''}</div>`;
    });
    html += `</div>`;
  }

  // References
  if (parsed.references?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        References (${parsed.references.length})
      </div>`;
    parsed.references.forEach(ref => {
      if (ref.available_on_request) {
        html += `<div class="cv-item">Available on request</div>`;
      } else {
        html += `<div class="cv-item"><strong>${ref.name || 'N/A'}</strong>${ref.title ? ` - ${ref.title}` : ''}${ref.company ? ` at ${ref.company}` : ''}${ref.relationship ? ` (${ref.relationship})` : ''}</div>`;
        if (ref.email || ref.phone) html += `<div class="cv-item" style="padding-left: 12px; font-size: 9px;">${ref.email || ''}${ref.email && ref.phone ? ' | ' : ''}${ref.phone || ''}</div>`;
      }
    });
    html += `</div>`;
  }

  // Awards
  if (parsed.awards?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="8" r="7"/>
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
        </svg>
        Awards (${parsed.awards.length})
      </div>`;
    parsed.awards.forEach(award => {
      html += `<div class="cv-item"><strong>${award.name}</strong>${award.issuer ? ' from ' + award.issuer : ''}${award.date ? ' (' + award.date + ')' : ''}</div>`;
    });
    html += `</div>`;
  }

  // Publications
  if (parsed.publications?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        Publications (${parsed.publications.length})
      </div>`;
    parsed.publications.forEach(pub => {
      html += `<div class="cv-item"><strong>${pub.title}</strong>${pub.publisher ? ' in ' + pub.publisher : ''}${pub.date ? ' (' + pub.date + ')' : ''}</div>`;
    });
    html += `</div>`;
  }

  // Volunteer Experience (handle both old and new field names)
  const volunteerData = parsed.volunteer_experience || parsed.volunteer;
  if (volunteerData?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        Volunteer Experience (${volunteerData.length})
      </div>`;
    volunteerData.forEach(vol => {
      html += `<div class="cv-item"><strong>${vol.role || 'Volunteer'}</strong>${vol.organization ? ' at ' + vol.organization : ''}${vol.cause ? ` (${vol.cause})` : ''}</div>`;
    });
    html += `</div>`;
  }

  // Professional Memberships (handle both old and new field names)
  const membershipsData = parsed.professional_memberships || parsed.memberships;
  if (membershipsData?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">Professional Memberships (${membershipsData.length})</div>`;
    membershipsData.forEach(mem => {
      html += `<div class="cv-item"><strong>${mem.organization}</strong>${mem.role ? ' - ' + mem.role : ''}</div>`;
    });
    html += `</div>`;
  }

  // Courses
  if (parsed.courses?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">Courses (${parsed.courses.length})</div>`;
    parsed.courses.forEach(course => {
      html += `<div class="cv-item"><strong>${course.name}</strong>${course.provider ? ' by ' + course.provider : ''}${course.date ? ' (' + course.date + ')' : ''}</div>`;
    });
    html += `</div>`;
  }

  // Interests
  if (parsed.interests?.length > 0) {
    html += `<div class="cv-section">
      <div class="cv-section-title">Interests & Hobbies</div>
      <div class="cv-skills-list">
        ${parsed.interests.map(i => `<span class="cv-skill-tag">${i}</span>`).join('')}
      </div>
    </div>`;
  }

  // Additional Info
  if (parsed.additional_info) {
    const ai = parsed.additional_info;
    const hasInfo = ai.driving_license || ai.visa_status || ai.security_clearance || ai.military_service || ai.military || ai.other;
    if (hasInfo) {
      html += `<div class="cv-section">
        <div class="cv-section-title">Additional Information</div>`;
      if (ai.driving_license) html += `<div class="cv-item"><strong>Driving License:</strong> ${ai.driving_license}</div>`;
      if (ai.visa_status) html += `<div class="cv-item"><strong>Visa Status:</strong> ${ai.visa_status}</div>`;
      if (ai.security_clearance) html += `<div class="cv-item"><strong>Security Clearance:</strong> ${ai.security_clearance}</div>`;
      if (ai.military_service || ai.military) html += `<div class="cv-item"><strong>Military Service:</strong> ${ai.military_service || ai.military}</div>`;
      if (ai.other) html += `<div class="cv-item">${ai.other}</div>`;
      html += `</div>`;
    }
  }

  // Additional Sections (AI-detected non-standard sections)
  if (parsed.additional_sections?.length > 0) {
    parsed.additional_sections.forEach(section => {
      html += `<div class="cv-section">
        <div class="cv-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          ${section.section_title || 'Other'}
        </div>`;
      if (Array.isArray(section.content)) {
        section.content.forEach(item => {
          if (typeof item === 'string') {
            html += `<div class="cv-item">${item}</div>`;
          } else if (typeof item === 'object') {
            html += `<div class="cv-item">${JSON.stringify(item)}</div>`;
          }
        });
      } else if (typeof section.content === 'string') {
        html += `<div class="cv-item">${section.content}</div>`;
      } else if (section.content) {
        html += `<div class="cv-item">${JSON.stringify(section.content)}</div>`;
      }
      html += `</div>`;
    });
  }

  // Show success message
  html = `<div style="background: #d1fae5; color: #065f46; padding: 8px; border-radius: 4px; margin-bottom: 12px; font-size: 10px;">
    Saved as profile: <strong>${profileName}</strong>
  </div>` + html;

  cvResultsContent.innerHTML = html;
  cvResultsModal.style.display = "block";
}

function hideCVResultsModal() {
  cvResultsModal.style.display = "none";
}

document.getElementById("cv-results-close").addEventListener("click", hideCVResultsModal);
document.getElementById("cv-results-done").addEventListener("click", hideCVResultsModal);
cvResultsModal.addEventListener("click", (e) => {
  if (e.target === cvResultsModal) hideCVResultsModal();
});

cvToggleBtn.addEventListener("click", toggleCVSection);

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function handleCVUpload(file) {
  if (!file) return;

  // Check if user is logged in
  if (!authState.accessToken) {
    cvStatus.textContent = "Please sign in first";
    loginModal.style.display = "block";
    loginForm.style.display = "block";
    registerForm.style.display = "none";
    return;
  }

  // Check if user has credits
  if (userCredits <= 0) {
    cvStatus.textContent = "Insufficient credits";
    insufficientCreditsNotice.style.display = "block";
    return;
  }

  cvStatus.textContent = "Parsing...";
  cvUploadArea.style.opacity = "0.5";
  cvUploadArea.style.pointerEvents = "none";

  try {
    let requestBody = {};

    if (file.type === "application/pdf") {
      // Send PDF as base64 to backend for proper parsing
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      requestBody = { 
        pdfBase64: base64,
        fileName: file.name
      };
    } else if (file.name.endsWith(".docx")) {
      // Send DOCX as base64 to backend for proper parsing
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      requestBody = { 
        docxBase64: base64,
        fileName: file.name
      };
    } else {
      // Plain text files
      const cvText = await file.text();
      if (!cvText || cvText.length < 50) {
        throw new Error("Could not extract enough text from file. Please try a different format.");
      }
      // Limit CV text size to avoid API limits (max ~30KB of text)
      const MAX_CV_LENGTH = 30000;
      requestBody = { 
        cvText: cvText.length > MAX_CV_LENGTH ? cvText.substring(0, MAX_CV_LENGTH) : cvText 
      };
    }

    // Send to backend for AI parsing (authenticated)
    const response = await apiRequest("/form/parse-cv", {
      method: "POST",
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 402) {
        userCredits = 0;
        updateCreditsUI();
        throw new Error("Insufficient credits. Please purchase more.");
      }
      throw new Error(data.error || data.message || `Server error: ${response.status}`);
    }

    const data = await response.json();
    const parsed = data.data || data;
    
    // Update credits if returned in response
    if (data.creditsRemaining !== undefined) {
      userCredits = data.creditsRemaining;
      updateCreditsUI();
    }

    // Create profile directly from parsed CV
    const profileData = flattenCVToProfile(parsed);
    const firstName = parsed.personal?.first_name || "";
    const lastName = parsed.personal?.last_name || "";
    let profileName = firstName || lastName ? `CV - ${firstName} ${lastName}`.trim() : "CV Profile";

    // Check if a CV with same name exists, add number suffix if so
    const existingNames = profiles.filter(p => p.isCV).map(p => p.name);
    if (existingNames.includes(profileName)) {
      let counter = 2;
      while (existingNames.includes(`${profileName} (${counter})`)) {
        counter++;
      }
      profileName = `${profileName} (${counter})`;
    }

    const profile = {
      id: "cv_" + Date.now(),
      name: profileName,
      isCV: true,
      ...profileData
    };

    // Add new CV profile (allow multiple)
    profiles.unshift(profile);
    await saveProfiles();
    renderProfileSelect();
    updateCVUI();

    // Auto-select the CV profile
    profileSelect.value = profile.id;
    profileSection.classList.remove("hide-profile-mode");

    // Show parsed results modal
    showCVResultsModal(parsed, profileName);

    // Track CV parse event
    trackEvent({
      type: "cv_parse",
      success: true
    });

    cvStatus.textContent = "CV saved as profile!";
    setTimeout(() => { cvStatus.textContent = ""; }, 2000);

  } catch (err) {
    cvStatus.textContent = "Error: " + err.message;

    // Track failed CV parse
    trackEvent({
      type: "cv_parse",
      success: false
    });

    setTimeout(() => { cvStatus.textContent = ""; }, 3000);
  } finally {
    cvUploadArea.style.opacity = "";
    cvUploadArea.style.pointerEvents = "";
  }
}

function flattenCVToProfile(cv) {
  const profile = {};

  // ===== PERSONAL INFO =====
  if (cv.personal) {
    const p = cv.personal;
    if (p.first_name) profile.first_name = p.first_name;
    if (p.last_name) profile.last_name = p.last_name;
    if (p.full_name) profile.full_name = p.full_name;
    else if (p.first_name && p.last_name) profile.full_name = `${p.first_name} ${p.last_name}`;
    if (profile.full_name) profile.name = profile.full_name;

    if (p.email) profile.email = p.email;
    if (p.phone) profile.phone = p.phone;
    if (p.phone_secondary || p.phone_alt) profile.phone_secondary = p.phone_secondary || p.phone_alt;

    // Address fields
    if (p.address) profile.address = p.address;
    if (p.city) profile.city = p.city;
    if (p.state) profile.state = p.state;
    if (p.country) profile.country = p.country;
    if (p.postal_code) profile.postal_code = p.postal_code;
    if (p.city || p.state || p.country) {
      profile.location = [p.city, p.state, p.country].filter(Boolean).join(", ");
    }

    // Personal details
    if (p.date_of_birth) profile.date_of_birth = p.date_of_birth;
    if (p.nationality) profile.nationality = p.nationality;
    if (p.gender) profile.gender = p.gender;
    if (p.marital_status) profile.marital_status = p.marital_status;

    // Social/web links
    if (p.linkedin) { profile.linkedin = p.linkedin; profile.linkedin_url = p.linkedin; }
    if (p.github) { profile.github = p.github; profile.github_url = p.github; }
    if (p.twitter) profile.twitter = p.twitter;
    if (p.portfolio) { profile.portfolio = p.portfolio; profile.website = p.portfolio; }
    if (p.website) profile.website = p.website;
    if (p.blog) profile.blog = p.blog;
    if (p.skype) profile.skype = p.skype;

    // Professional info
    if (p.summary) {
      profile.summary = p.summary;
      profile.bio = p.summary;
      profile.about = p.summary;
      profile.professional_summary = p.summary;
      profile.objective = p.summary;
    }
    if (p.headline) profile.headline = p.headline;
    if (p.availability) profile.availability = p.availability;
    if (p.desired_salary || p.salary_expectation) profile.desired_salary = p.desired_salary || p.salary_expectation;
    if (p.willing_to_relocate) profile.willing_to_relocate = p.willing_to_relocate;
  }

  // ===== FULL WORK EXPERIENCE (ALL JOBS) =====
  if (cv.work_experience?.length > 0) {
    profile.work_history = cv.work_experience;

    const current = cv.work_experience[0];
    profile.current_company = current.company;
    profile.current_title = current.title;
    profile.job_title = current.title;
    profile.title = current.title;
    profile.position = current.title;
    profile.company = current.company;
    profile.employer = current.company;
    if (current.department) profile.department = current.department;
    if (current.employment_type) profile.employment_type = current.employment_type;

    const workExpText = cv.work_experience.map(job => {
      const lines = [`${job.title} at ${job.company}`];
      if (job.department) lines[0] += ` (${job.department})`;
      if (job.start_date || job.end_date) {
        lines.push(`${job.start_date || ''} - ${job.end_date || 'Present'}`);
      }
      if (job.location) lines.push(`Location: ${job.location}`);
      if (job.description) lines.push(job.description);
      if (job.responsibilities?.length) lines.push(`Responsibilities: ${job.responsibilities.join('; ')}`);
      if (job.achievements?.length) lines.push(`Achievements: ${job.achievements.join('; ')}`);
      const techs = job.technologies_used || job.technologies;
      if (techs?.length) lines.push(`Technologies: ${techs.join(', ')}`);
      return lines.join('\n');
    }).join('\n\n');

    profile.work_experience = workExpText;
    profile.experience = workExpText;
    profile.employment_history = workExpText;

    let totalYears = 0;
    cv.work_experience.forEach(job => {
      const start = job.start_date ? parseInt(job.start_date.split('-')[0]) : null;
      const end = job.end_date === 'Present' || job.is_current ? new Date().getFullYear() :
        job.end_date ? parseInt(job.end_date.split('-')[0]) : null;
      if (start && end) totalYears += (end - start);
    });
    if (totalYears > 0) {
      profile.years_experience = `${totalYears}+ years`;
      profile.experience_years = totalYears;
    }
  }

  // ===== FULL EDUCATION (ALL ENTRIES) =====
  if (cv.education?.length > 0) {
    profile.education_history = cv.education;

    const edu = cv.education[0];
    profile.university = edu.institution;
    profile.school = edu.institution;
    profile.college = edu.institution;
    profile.institution = edu.institution;
    profile.degree = edu.degree;
    profile.degree_type = edu.degree_type;
    profile.field_of_study = edu.field;
    profile.major = edu.field;
    if (edu.minor) profile.minor = edu.minor;
    if (edu.gpa) profile.gpa = edu.gpa;
    if (edu.grade) profile.grade = edu.grade;
    if (edu.honors) profile.honors = edu.honors;
    if (edu.thesis) profile.thesis = edu.thesis;
    if (edu.start_date) profile.education_start = edu.start_date;
    if (edu.end_date) {
      profile.education_end = edu.end_date;
      profile.graduation_year = edu.end_date.split('-')[0];
    }

    const eduText = cv.education.map(e => {
      const parts = [];
      if (e.degree) parts.push(e.degree);
      if (e.field) parts.push(`in ${e.field}`);
      if (e.institution) parts.push(`from ${e.institution}`);
      if (e.end_date) parts.push(`(${e.end_date})`);
      if (e.gpa) parts.push(`GPA: ${e.gpa}`);
      if (e.honors) parts.push(`- ${e.honors}`);
      return parts.join(' ');
    }).join('\n');

    profile.education = eduText;
    profile.academic_background = eduText;
  }

  // ===== ALL SKILLS =====
  if (cv.skills) {
    profile.skills_data = cv.skills;

    if (cv.skills.technical?.length > 0) profile.technical_skills = cv.skills.technical.join(", ");
    // Handle both old (programming_languages) and new (programming) field names
    const progLangs = cv.skills.programming_languages || cv.skills.programming;
    if (progLangs?.length > 0) profile.programming_languages = progLangs.join(", ");
    if (cv.skills.frameworks?.length > 0) profile.frameworks = cv.skills.frameworks.join(", ");
    if (cv.skills.databases?.length > 0) profile.databases = cv.skills.databases.join(", ");
    if (cv.skills.cloud?.length > 0) profile.cloud_skills = cv.skills.cloud.join(", ");
    if (cv.skills.tools?.length > 0) profile.tools = cv.skills.tools.join(", ");
    if (cv.skills.methodologies?.length > 0) profile.methodologies = cv.skills.methodologies.join(", ");
    if (cv.skills.soft_skills?.length > 0) profile.soft_skills = cv.skills.soft_skills.join(", ");
    if (cv.skills.industry_knowledge?.length > 0) profile.industry_knowledge = cv.skills.industry_knowledge.join(", ");
    if (cv.skills.other?.length > 0) profile.other_skills = cv.skills.other.join(", ");

    const allSkills = [
      ...(cv.skills.technical || []),
      ...(cv.skills.programming_languages || cv.skills.programming || []),
      ...(cv.skills.frameworks || []),
      ...(cv.skills.tools || []),
      ...(cv.skills.databases || []),
      ...(cv.skills.cloud || []),
      ...(cv.skills.other || [])
    ];
    if (allSkills.length > 0) profile.skills = allSkills.join(", ");
  }

  // ===== ALL LANGUAGES =====
  if (cv.languages?.length > 0) {
    profile.languages_data = cv.languages;
    profile.languages = cv.languages.map(l => `${l.language} (${l.proficiency})`).join(", ");
    profile.spoken_languages = cv.languages.map(l => l.language).join(", ");
  }

  // ===== ALL CERTIFICATIONS =====
  if (cv.certifications?.length > 0) {
    profile.certifications_data = cv.certifications;
    profile.certifications = cv.certifications.map(c => {
      const parts = [c.name];
      if (c.issuer) parts.push(`by ${c.issuer}`);
      if (c.date) parts.push(`(${c.date})`);
      return parts.join(' ');
    }).join("; ");
    profile.certification_names = cv.certifications.map(c => c.name).join(", ");
  }

  // ===== ALL PROJECTS =====
  if (cv.projects?.length > 0) {
    profile.projects_data = cv.projects;
    profile.projects = cv.projects.map(p => {
      const parts = [p.name];
      if (p.role) parts.push(`(${p.role})`);
      if (p.description) parts.push(`: ${p.description}`);
      if (p.technologies?.length) parts.push(`[${p.technologies.join(', ')}]`);
      return parts.join(' ');
    }).join('\n');
    profile.project_names = cv.projects.map(p => p.name).join(", ");
  }

  // ===== REFERENCES / REFEREES =====
  if (cv.references?.length > 0) {
    profile.references_data = cv.references;
    profile.references = cv.references.map(r => {
      if (r.available_on_request) return "Available on request";
      const parts = [r.name];
      if (r.title) parts.push(`(${r.title})`);
      if (r.company) parts.push(`at ${r.company}`);
      if (r.relationship) parts.push(`- ${r.relationship}`);
      if (r.email) parts.push(`Email: ${r.email}`);
      if (r.phone) parts.push(`Phone: ${r.phone}`);
      return parts.join(' ');
    }).join('\n');
    profile.referees = profile.references;
  }

  // ===== AWARDS =====
  if (cv.awards?.length > 0) {
    profile.awards_data = cv.awards;
    profile.awards = cv.awards.map(a => {
      const parts = [a.name];
      if (a.issuer) parts.push(`from ${a.issuer}`);
      if (a.date) parts.push(`(${a.date})`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== PUBLICATIONS =====
  if (cv.publications?.length > 0) {
    profile.publications_data = cv.publications;
    profile.publications = cv.publications.map(p => {
      const parts = [p.title];
      if (p.publisher) parts.push(`in ${p.publisher}`);
      if (p.date) parts.push(`(${p.date})`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== PATENTS =====
  if (cv.patents?.length > 0) {
    profile.patents_data = cv.patents;
    profile.patents = cv.patents.map(p => {
      const parts = [p.title];
      if (p.patent_number) parts.push(`#${p.patent_number}`);
      if (p.status) parts.push(`(${p.status})`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== VOLUNTEER EXPERIENCE =====
  // Handle both old (volunteer_experience) and new (volunteer) field names
  const volunteerData = cv.volunteer_experience || cv.volunteer;
  if (volunteerData?.length > 0) {
    profile.volunteer_data = volunteerData;
    profile.volunteer_experience = volunteerData.map(v => {
      const parts = [v.role];
      if (v.organization) parts.push(`at ${v.organization}`);
      if (v.cause) parts.push(`(${v.cause})`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== PROFESSIONAL MEMBERSHIPS =====
  // Handle both old (professional_memberships) and new (memberships) field names
  const membershipsData = cv.professional_memberships || cv.memberships;
  if (membershipsData?.length > 0) {
    profile.memberships_data = membershipsData;
    profile.professional_memberships = membershipsData.map(m => {
      const parts = [m.organization];
      if (m.role) parts.push(`- ${m.role}`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== COURSES =====
  if (cv.courses?.length > 0) {
    profile.courses_data = cv.courses;
    profile.courses = cv.courses.map(c => {
      const parts = [c.name];
      if (c.provider) parts.push(`by ${c.provider}`);
      if (c.date) parts.push(`(${c.date})`);
      return parts.join(' ');
    }).join("; ");
  }

  // ===== INTERESTS =====
  if (cv.interests?.length > 0) {
    profile.interests = cv.interests.join(", ");
    profile.hobbies = profile.interests;
  }

  // ===== ADDITIONAL INFO =====
  if (cv.additional_info) {
    const ai = cv.additional_info;
    if (ai.driving_license) profile.driving_license = ai.driving_license;
    if (ai.visa_status) profile.visa_status = ai.visa_status;
    if (ai.security_clearance) profile.security_clearance = ai.security_clearance;
    if (ai.military_service || ai.military) profile.military_service = ai.military_service || ai.military;
    if (ai.other) profile.additional_info = ai.other;
  }

  // ===== ADDITIONAL SECTIONS (AI-detected non-standard sections) =====
  if (cv.additional_sections?.length > 0) {
    profile.additional_sections = cv.additional_sections;
    // Also create flattened keys for each custom section
    cv.additional_sections.forEach((section, idx) => {
      const key = section.section_title
        ? section.section_title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        : `custom_section_${idx}`;
      if (Array.isArray(section.content)) {
        profile[key] = section.content.join('; ');
      } else if (typeof section.content === 'string') {
        profile[key] = section.content;
      } else if (section.content) {
        profile[key] = JSON.stringify(section.content);
      }
    });
  }

  // ===== STORE RAW CV DATA FOR AI =====
  profile._rawCV = cv;

  return profile;
}

// CV upload event listeners
cvUploadArea.addEventListener("click", () => cvFileInput.click());
cvUploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  cvUploadArea.style.borderColor = "var(--fg)";
  cvUploadArea.style.background = "var(--accents-1)";
});
cvUploadArea.addEventListener("dragleave", () => {
  cvUploadArea.style.borderColor = "";
  cvUploadArea.style.background = "";
});
cvUploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  cvUploadArea.style.borderColor = "";
  cvUploadArea.style.background = "";
  const file = e.dataTransfer.files[0];
  if (file) handleCVUpload(file);
});
cvFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleCVUpload(file);
  cvFileInput.value = "";
});

document.getElementById("cv-clear-btn").addEventListener("click", async () => {
  const cvProfiles = getCVProfiles();
  if (cvProfiles.length === 0) return;

  if (cvProfiles.length === 1) {
    // Just one CV, clear it
    profiles = profiles.filter(p => !p.isCV);
  } else {
    // Multiple CVs, ask which to clear
    const choice = confirm(`You have ${cvProfiles.length} CVs. Click OK to clear ALL, or Cancel to manage them in the profiles dropdown.`);
    if (choice) {
      profiles = profiles.filter(p => !p.isCV);
    } else {
      return;
    }
  }
  await saveProfiles();
  renderProfileSelect();
  updateCVUI();
});

// Initialize auth and fill history on load
loadAuthState();
loadFillHistory();

// Update CV UI after profiles load
setTimeout(updateCVUI, 100);

// ==================== KEYBOARD SHORTCUTS ====================

// Save selected profile preference for shortcut use
profileSelect.addEventListener("change", async () => {
  profileSection.classList.toggle("hide-profile-mode", !profileSelect.value);
  await chrome.storage.local.set({ selectedProfileId: profileSelect.value || null });
});

// Save profile mode preference
document.querySelectorAll('input[name="profileMode"]').forEach(radio => {
  radio.addEventListener("change", async () => {
    await chrome.storage.local.set({ profileMode: getProfileMode() });
  });
});

// Popup keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const isInInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  
  // Enter key - Confirm fill when in preview mode
  if (e.key === "Enter" && !isInInput) {
    if (previewSection.classList.contains("visible")) {
      e.preventDefault();
      confirmFill();
    } else if (!fillBtn.disabled) {
      e.preventDefault();
      fillBtn.click();
    }
  }
  
  // Escape key - Cancel preview or close modals
  if (e.key === "Escape") {
    e.preventDefault();
    
    // Close CV results modal if open
    if (cvResultsModal.style.display === "block") {
      cvResultsModal.style.display = "none";
      return;
    }
    
    // Close login modal if open
    if (loginModal.style.display === "block") {
      loginModal.style.display = "none";
      return;
    }
    
    // Close manage profiles panel if open
    if (manageProfilesPanel.classList.contains("visible")) {
      manageProfilesPanel.classList.remove("visible");
      return;
    }
    
    // Cancel preview if in preview mode
    if (previewSection.classList.contains("visible")) {
      cancelPreview();
      return;
    }
  }
  
  // Cmd/Ctrl + U - Undo fill
  if ((e.metaKey || e.ctrlKey) && e.key === "u") {
    e.preventDefault();
    if (lastFillSession) {
      undoLastFill();
    }
  }
  
  // Number keys 1-9 - Quick profile selection (when not in input)
  if (!isInInput && e.key >= "1" && e.key <= "9" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const profileIndex = parseInt(e.key) - 1;
    if (profiles[profileIndex]) {
      profileSelect.value = profiles[profileIndex].id;
      profileSection.classList.remove("hide-profile-mode");
      chrome.storage.local.set({ selectedProfileId: profiles[profileIndex].id });
      
      // Show brief feedback
      const status = document.getElementById("status");
      status.innerText = `Profile: ${profiles[profileIndex].name}`;
      setTimeout(() => { if (!pendingValues) status.innerText = ""; }, 1500);
    }
  }
  
  // 0 key - Select "None (AI only)"
  if (!isInInput && e.key === "0" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    profileSelect.value = "";
    profileSection.classList.add("hide-profile-mode");
    chrome.storage.local.set({ selectedProfileId: null });
    
    const status = document.getElementById("status");
    status.innerText = "Profile: None (AI only)";
    setTimeout(() => { if (!pendingValues) status.innerText = ""; }, 1500);
  }
});

// Load saved preferences on startup
(async () => {
  const stored = await chrome.storage.local.get(["selectedProfileId", "profileMode"]);
  if (stored.selectedProfileId && profiles.find(p => p.id === stored.selectedProfileId)) {
    profileSelect.value = stored.selectedProfileId;
    profileSection.classList.remove("hide-profile-mode");
  }
  if (stored.profileMode) {
    const radio = document.querySelector(`input[name="profileMode"][value="${stored.profileMode}"]`);
    if (radio) radio.checked = true;
  }
})();

// Shortcuts help toggle
const shortcutsToggle = document.getElementById("shortcuts-toggle");
const shortcutsList = document.getElementById("shortcuts-list");
const shortcutsArrow = document.getElementById("shortcuts-arrow");

shortcutsToggle.addEventListener("click", () => {
  const isVisible = shortcutsList.style.display !== "none";
  shortcutsList.style.display = isVisible ? "none" : "block";
  shortcutsArrow.style.transform = isVisible ? "" : "rotate(180deg)";
});
