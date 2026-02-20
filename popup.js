const BACKEND_URL = "http://localhost:9000";
const STORAGE_KEY = "autofill_profiles";
const PRIVACY_NOTICE_KEY = "autofill_privacy_notice_dismissed";
const PRIVACY_POLICY_URL = ""; // e.g. BACKEND_URL + "/privacy" or your policy URL
const PROFILE_KEYS = ["first_name", "last_name", "email", "phone", "company", "role"];

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
const profileForm = document.getElementById("profile-form");
const privacyNoticeEl = document.getElementById("privacy-notice");
const privacyGotItBtn = document.getElementById("privacy-got-it");
const privacyPolicyLink = document.getElementById("privacy-policy-link");

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

async function loadProfiles() {
  const out = await chrome.storage.local.get(STORAGE_KEY);
  profiles = Array.isArray(out[STORAGE_KEY]) ? out[STORAGE_KEY] : [];
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
  const normProfile = {};
  PROFILE_KEYS.forEach((k) => {
    if (profile[k] != null && profile[k] !== "") normProfile[normalizeKey(k)] = profile[k];
  });
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
  const keys = values ? Object.keys(values) : [];
  PROFILE_KEYS.forEach((pk) => {
    const nk = normalizeKey(pk);
    const formKey = keys.find((k) => normalizeKey(k) === nk);
    if (formKey && values[formKey] != null && String(values[formKey]).trim() !== "") {
      profile[pk] = String(values[formKey]).trim();
    }
  });
  return profile;
}

function savePreviewAsProfile() {
  if (!pendingValues) return;
  const data = buildProfileFromValues(pendingValues);
  if (Object.keys(data).length === 0) {
    const status = document.getElementById("status");
    status.innerText = "No profile fields in this response (need e.g. first name, email).";
    return;
  }
  const defaultName = "From AI – " + new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const name = window.prompt("Profile name", defaultName);
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
  status.innerText = "Saved as profile \"" + profile.name + "\".";
  setTimeout(() => {
    if (pendingValues) status.innerText = "Review and edit below, then click Fill form.";
  }, 2000);
}

async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
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

function renderPreviewList() {
  if (!pendingValues) return;
  previewList.innerHTML = "";
  const keys = pendingFields && pendingFields.length
    ? pendingFields.map((f) => f.key)
    : Object.keys(pendingValues);
  for (const key of keys) {
    const value = pendingValues[key];
    if (value === undefined) continue;
    const label = getLabelForKey(key);
    const row = document.createElement("div");
    row.className = "preview-row";
    row.dataset.key = key;
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
  currentTabId = null;
  actionZone.classList.remove("hide-main");
  previewSection.classList.remove("visible");
  const status = document.getElementById("status");
  status.innerText = "";
  fillBtn.disabled = false;
  fillBtn.innerText = "Execute Autofill";
}

async function confirmFill() {
  if (!pendingValues || currentTabId == null) return;
  const status = document.getElementById("status");
  try {
    confirmFillBtn.disabled = true;
    status.innerText = "Filling form...";
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
    status.innerText = "Done!";
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
saveAsProfileBtn.addEventListener("click", savePreviewAsProfile);
confirmFillBtn.addEventListener("click", confirmFill);

profileSelect.addEventListener("change", () => {
  profileSection.classList.toggle("hide-profile-mode", !profileSelect.value);
});

manageProfilesBtn.addEventListener("click", () => {
  manageProfilesPanel.classList.toggle("visible", !manageProfilesPanel.classList.contains("visible"));
  if (manageProfilesPanel.classList.contains("visible")) renderProfileList();
});

profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("profile-id").value;
  const name = document.getElementById("profile-name").value.trim();
  if (!name) return;
  const data = { name };
  PROFILE_KEYS.forEach((k) => {
    const v = document.getElementById(`profile-${k}`).value.trim();
    if (v) data[k] = v;
  });
  if (id) {
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx !== -1) profiles[idx] = { ...profiles[idx], ...data };
  } else {
    data.id = "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    profiles.push(data);
  }
  saveProfiles();
  renderProfileSelect();
  renderProfileList();
  profileForm.reset();
  document.getElementById("profile-id").value = "";
});

document.getElementById("profile-cancel").addEventListener("click", () => {
  profileForm.reset();
  document.getElementById("profile-id").value = "";
  manageProfilesPanel.classList.remove("visible");
});

function renderProfileList() {
  profileListEl.innerHTML = "";
  profiles.forEach((p) => {
    const row = document.createElement("div");
    row.className = "profile-list-item";
    row.innerHTML = `<span>${escapeHtml(p.name)}</span><span><button type="button" class="secondary edit-profile-btn" data-id="${escapeAttr(p.id)}">Edit</button><button type="button" class="secondary delete-profile-btn" data-id="${escapeAttr(p.id)}">Delete</button></span>`;
    profileListEl.appendChild(row);
    row.querySelector(".edit-profile-btn").addEventListener("click", () => {
      document.getElementById("profile-id").value = p.id;
      document.getElementById("profile-name").value = p.name || "";
      PROFILE_KEYS.forEach((k) => {
        document.getElementById(`profile-${k}`).value = p[k] || "";
      });
    });
    row.querySelector(".delete-profile-btn").addEventListener("click", () => {
      profiles = profiles.filter((x) => x.id !== p.id);
      saveProfiles();
      renderProfileSelect();
      renderProfileList();
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
      response = await fetch(`${BACKEND_URL}/analyze-form`, {
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

    let values = await response.json();
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
