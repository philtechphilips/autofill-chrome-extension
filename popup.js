const BACKEND_URL = "http://localhost:9000";
const fillBtn = document.getElementById("fill");
const backendOffEl = document.getElementById("backend-off");
const actionZone = document.getElementById("action-zone");
const previewSection = document.getElementById("preview-section");
const previewList = document.getElementById("preview-list");
const cancelPreviewBtn = document.getElementById("cancel-preview");
const confirmFillBtn = document.getElementById("confirm-fill");

let pendingFields = null;
let pendingValues = null;
let currentTabId = null;

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
confirmFillBtn.addEventListener("click", confirmFill);

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

    const { fields, context } = result;
    if (!fields || fields.length === 0) {
      status.innerText = "No form fields found!";
      fillBtn.disabled = false;
      fillBtn.innerText = "Execute Autofill";
      return;
    }

    const fillOnlyEmpty = document.querySelector('input[name="fillMode"]:checked').value === "empty";

    status.innerText = "Generating AI responses...";
    let response;
    try {
      response = await fetch(`${BACKEND_URL}/analyze-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, context, fillOnlyEmpty })
      });
    } catch (err) {
      throw new Error("Cannot reach server");
    }

    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }

    const values = await response.json();
    showPreview(fields, values, tab.id);
  } catch (error) {
    console.error("Autofill error:", error);
    status.innerText = "Error: " + error.message;
    fillBtn.disabled = false;
    fillBtn.innerText = "Execute Autofill";
  }
};
