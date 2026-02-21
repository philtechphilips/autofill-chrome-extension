const BACKEND_URL = "http://localhost:9000";
const AUTH_STORAGE_KEY = "autofill_auth";
const STORAGE_KEY = "autofill_profiles";
const FILL_HISTORY_KEY = "autofill_fill_history";

console.log("[Autofill.AI] Background service worker started");

// Track analytics events (non-blocking)
async function trackEvent(eventData) {
  try {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const authState = stored[AUTH_STORAGE_KEY];
    if (!authState?.accessToken) return;
    
    await fetch(`${BACKEND_URL}/api/v1/analytics/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authState.accessToken}`
      },
      body: JSON.stringify(eventData)
    });
  } catch (err) {
    console.log("[Autofill.AI] Analytics tracking failed (non-critical):", err.message);
  }
}

// ==================== KEYBOARD SHORTCUTS ====================

chrome.commands.onCommand.addListener(async (command) => {
  console.log("[Autofill.AI] Command received:", command);
  
  if (command === "execute-autofill") {
    await executeAutofillFromShortcut();
  } else if (command === "undo-fill") {
    await undoFillFromShortcut();
  }
});

async function executeAutofillFromShortcut() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log("[Autofill.AI] No active tab found");
      return;
    }

    // Show notification that autofill is starting
    await showNotification(tab.id, "Analyzing form fields...", "info");

    // Extract fields from the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.extractFields !== "function") {
          throw new Error("Content script not loaded. Please refresh the page.");
        }
        return window.extractFields();
      }
    });

    if (!results || !results[0]?.result) {
      await showNotification(tab.id, "Could not extract form data. Try refreshing.", "error");
      return;
    }

    const { fields, context, pageUrl, pageTitle } = results[0].result;
    
    if (!fields || fields.length === 0) {
      await showNotification(tab.id, "No form fields found on this page.", "warning");
      return;
    }

    await showNotification(tab.id, `Found ${fields.length} fields. Generating values...`, "info");

    // Load profiles to check if one is selected (use stored preference)
    const stored = await chrome.storage.local.get([STORAGE_KEY, "selectedProfileId", "profileMode"]);
    const profiles = stored[STORAGE_KEY] || [];
    const selectedProfileId = stored.selectedProfileId;
    const profileMode = stored.profileMode || "plus_ai";
    
    let profile = null;
    if (selectedProfileId) {
      profile = profiles.find(p => p.id === selectedProfileId);
    }

    // If profile only mode and we have a profile, use profile values directly
    if (profile && profileMode === "only") {
      const values = profileValuesForFields(fields, profile);
      if (Object.keys(values).length === 0) {
        await showNotification(tab.id, "No profile fields match this form.", "warning");
        return;
      }
      await fillFormDirectly(tab.id, values, fields);
      return;
    }

    // Call AI to generate values
    const response = await fetch(`${BACKEND_URL}/api/v1/form/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields,
        context,
        pageUrl,
        pageTitle,
        fillOnlyEmpty: false,
        profileData: profile || null
      })
    });

    if (!response.ok) {
      await showNotification(tab.id, "Server error. Is backend running?", "error");
      return;
    }

    const responseData = await response.json();
    let values = responseData.data || responseData;

    // Merge with profile if needed
    if (profile && profileMode === "plus_ai") {
      values = mergeProfileWithAiValues(fields, values, profile);
    }

    await fillFormDirectly(tab.id, values, fields);

  } catch (err) {
    console.error("[Autofill.AI] Shortcut autofill error:", err);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await showNotification(tab.id, "Error: " + (err.message || "Autofill failed"), "error");
    }
  }
}

async function fillFormDirectly(tabId, values, fields) {
  try {
    // Capture current state for undo
    const prevResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.extractFields !== "function") return {};
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
    const previousValues = prevResults[0]?.result || {};

    // Fill the form
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (formValues, fieldsMeta) => {
        if (typeof window.fillForm !== "function") {
          throw new Error("Content script not loaded");
        }
        window.fillForm(formValues, fieldsMeta);
      },
      args: [values, fields]
    });

    // Save fill history for undo
    const tabInfo = await chrome.tabs.get(tabId);
    await chrome.storage.local.set({
      [FILL_HISTORY_KEY]: {
        tabId,
        previousValues,
        filledValues: values,
        timestamp: Date.now(),
        pageUrl: tabInfo.url
      }
    });

    const fieldCount = Object.keys(values).length;
    await showNotification(tabId, `Filled ${fieldCount} fields! Press Ctrl+Shift+Z (Mac: ⌃⇧Z) to undo.`, "success");

    // Track event
    trackEvent({
      type: "form_fill",
      domain: new URL(tabInfo.url).hostname,
      fieldCount,
      success: true,
      fillMode: "shortcut"
    });

  } catch (err) {
    console.error("[Autofill.AI] Fill error:", err);
    await showNotification(tabId, "Fill failed: " + err.message, "error");
  }
}

async function undoFillFromShortcut() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const stored = await chrome.storage.local.get(FILL_HISTORY_KEY);
    const lastFillSession = stored[FILL_HISTORY_KEY];

    if (!lastFillSession) {
      await showNotification(tab.id, "No fill to undo.", "warning");
      return;
    }

    if (lastFillSession.tabId !== tab.id) {
      await showNotification(tab.id, "Go back to the original tab to undo.", "warning");
      return;
    }

    await showNotification(tab.id, "Restoring previous values...", "info");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (previousValues, filledKeys) => {
        if (typeof window.undoFill !== "function") {
          throw new Error("Content script not loaded");
        }
        window.undoFill(previousValues, filledKeys);
      },
      args: [lastFillSession.previousValues, Object.keys(lastFillSession.filledValues || {})]
    });

    // Clear undo history
    await chrome.storage.local.remove(FILL_HISTORY_KEY);

    await showNotification(tab.id, "Restored previous values!", "success");

  } catch (err) {
    console.error("[Autofill.AI] Undo error:", err);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await showNotification(tab.id, "Undo failed: " + err.message, "error");
    }
  }
}

// Helper: Show notification on page
async function showNotification(tabId, message, type = "info") {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, notifType) => {
        // Remove existing notification
        const existing = document.getElementById("autofill-shortcut-notification");
        if (existing) existing.remove();

        const colors = {
          info: { bg: "#f0f9ff", border: "#0ea5e9", text: "#0369a1" },
          success: { bg: "#f0fdf4", border: "#22c55e", text: "#15803d" },
          warning: { bg: "#fffbeb", border: "#f59e0b", text: "#b45309" },
          error: { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c" }
        };
        const color = colors[notifType] || colors.info;

        const notif = document.createElement("div");
        notif.id = "autofill-shortcut-notification";
        notif.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 999999;
          padding: 12px 16px;
          background: ${color.bg};
          border: 1px solid ${color.border};
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: ${color.text};
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 350px;
          animation: autofill-notif-slide 0.3s ease;
        `;

        const icon = notifType === "success" ? "✓" : notifType === "error" ? "✕" : notifType === "warning" ? "⚠" : "●";
        notif.innerHTML = `<span style="font-weight: 600;">${icon}</span><span>${msg}</span>`;

        // Add animation styles
        if (!document.getElementById("autofill-notif-styles")) {
          const style = document.createElement("style");
          style.id = "autofill-notif-styles";
          style.textContent = `
            @keyframes autofill-notif-slide {
              from { opacity: 0; transform: translateX(20px); }
              to { opacity: 1; transform: translateX(0); }
            }
          `;
          document.head.appendChild(style);
        }

        document.body.appendChild(notif);

        // Auto-remove after delay
        const delay = notifType === "success" ? 3000 : notifType === "error" ? 5000 : 2000;
        setTimeout(() => {
          notif.style.opacity = "0";
          notif.style.transform = "translateX(20px)";
          notif.style.transition = "all 0.3s ease";
          setTimeout(() => notif.remove(), 300);
        }, delay);
      },
      args: [message, type]
    });
  } catch (err) {
    console.log("[Autofill.AI] Could not show notification:", err.message);
  }
}

// Helper functions for profile handling
function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[-\\s]+/g, "_")
    .replace(/^_|_$/g, "");
}

function profileValuesForFields(fields, profile) {
  const out = {};
  const normProfile = {};
  Object.keys(profile).forEach((k) => {
    if (k === "id" || k === "name") return;
    if (profile[k] != null && profile[k] !== "") {
      normProfile[normalizeKey(k)] = profile[k];
    }
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

// ==================== MESSAGE HANDLERS ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Autofill.AI] Received message:", request.type);
  
  if (request.type === "ENHANCE_TEXT") {
    handleEnhanceText(request.data, sender.tab)
      .then(result => {
        console.log("[Autofill.AI] Enhancement successful");
        sendResponse(result);
      })
      .catch(err => {
        console.error("[Autofill.AI] Enhancement error:", err);
        sendResponse({ error: err.message || "Enhancement failed" });
      });
    return true; // Keep channel open for async response
  }
  
  // Handle ping to check if background is alive
  if (request.type === "PING") {
    sendResponse({ pong: true });
    return true;
  }
});

async function handleEnhanceText({ text, fieldLabel, context, enhanceType }, tab) {
  console.log("[Autofill.AI] Calling enhance API...");
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/form/enhance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        fieldLabel,
        context,
        enhanceType: enhanceType || "professional"
      })
    });

    console.log("[Autofill.AI] API response status:", response.status);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Track text enhance event
    let domain = null;
    try {
      if (tab?.url) domain = new URL(tab.url).hostname;
    } catch {}
    
    trackEvent({
      type: "text_enhance",
      domain,
      pageTitle: tab?.title || null,
      success: true,
      metadata: { enhanceType: enhanceType || "professional" }
    });
    
    return {
      original: text,
      enhanced: data.data?.enhanced || data.enhanced
    };
  } catch (err) {
    console.error("[Autofill.AI] Enhance API error:", err);
    
    // Track failed enhance
    trackEvent({
      type: "text_enhance",
      success: false
    });
    
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to backend server. Is it running on localhost:9000?");
    }
    throw err;
  }
}
