const BACKEND_URL = "http://localhost:9000";
const FRONTEND_URL = "https://autofill.live";
const AUTH_STORAGE_KEY = "autofill_auth";
const STORAGE_KEY = "autofill_profiles";
const FILL_HISTORY_KEY = "autofill_fill_history";
const CREDITS_CACHE_KEY = "autofill_credits_cache";

// Get auth state from storage
async function getAuthState() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return stored[AUTH_STORAGE_KEY] || { accessToken: null, user: null, encryptionKey: null };
}

// Make authenticated API request
async function authenticatedFetch(endpoint, options = {}) {
  const authState = await getAuthState();
  
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
  
  // If unauthorized, try to refresh token
  if (response.status === 401 && authState.accessToken) {
    const refreshed = await refreshToken();
    if (refreshed) {
      const newAuthState = await getAuthState();
      headers["Authorization"] = `Bearer ${newAuthState.accessToken}`;
      return fetch(`${BACKEND_URL}/api/v1${endpoint}`, {
        ...options,
        headers,
        credentials: "include"
      });
    }
  }
  
  return response;
}

// Refresh access token
async function refreshToken() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    
    if (response.ok) {
      const data = await response.json();
      // Get existing auth state to preserve encryption key
      const existingAuth = await getAuthState();
      const authState = {
        accessToken: data.data.accessToken,
        user: data.data.user,
        encryptionKey: existingAuth.encryptionKey || null
      };
      await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: authState });
      return true;
    }
  } catch (err) {
    console.error("[Background] Token refresh failed:", err);
  }
  
  // Clear auth state on refresh failure
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: { accessToken: null, user: null, encryptionKey: null } });
  return false;
}

// Update cached credits
async function updateCachedCredits(credits) {
  await chrome.storage.local.set({
    [CREDITS_CACHE_KEY]: {
      credits,
      timestamp: Date.now()
    }
  });
}

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
  }
}

// ==================== KEYBOARD SHORTCUTS ====================

chrome.commands.onCommand.addListener(async (command) => {
  
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
      return;
    }

    // Check if user is logged in
    const authState = await getAuthState();
    if (!authState.accessToken) {
      await showNotification(tab.id, "Please sign in to use Autofill.AI. Click the extension icon.", "warning");
      return;
    }

    // Check cached credits
    const cachedCredits = await chrome.storage.local.get(CREDITS_CACHE_KEY);
    const credits = cachedCredits[CREDITS_CACHE_KEY]?.credits || 0;
    if (credits <= 0) {
      await showNotification(tab.id, "Insufficient credits. Visit autofill.live to purchase more.", "warning");
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

    // If profile only mode and we have a profile, use profile values directly (no credits needed)
    if (profile && profileMode === "only") {
      const values = profileValuesForFields(fields, profile);
      if (Object.keys(values).length === 0) {
        await showNotification(tab.id, "No profile fields match this form.", "warning");
        return;
      }
      await fillFormDirectly(tab.id, values, fields);
      return;
    }

    // Call AI to generate values (authenticated)
    const response = await authenticatedFetch("/form/analyze", {
      method: "POST",
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
      if (response.status === 402) {
        await updateCachedCredits(0);
        await showNotification(tab.id, "Insufficient credits. Visit autofill.live to purchase more.", "warning");
        return;
      }
      if (response.status === 401) {
        await showNotification(tab.id, "Session expired. Please sign in again via the extension.", "warning");
        return;
      }
      await showNotification(tab.id, "Server error. Please try again.", "error");
      return;
    }

    const responseData = await response.json();
    let values = responseData.data || responseData;

    // Update cached credits if returned
    if (responseData.creditsRemaining !== undefined) {
      await updateCachedCredits(responseData.creditsRemaining);
    }

    // Merge with profile if needed
    if (profile && profileMode === "plus_ai") {
      values = mergeProfileWithAiValues(fields, values, profile);
    }

    await fillFormDirectly(tab.id, values, fields);

  } catch (err) {
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
  if (request.type === "ENHANCE_TEXT") {
    handleEnhanceText(request.data, sender.tab)
      .then(result => {
        sendResponse(result);
      })
      .catch(err => {
        sendResponse({ error: err.message || "Enhancement failed" });
      });
    return true; // Keep channel open for async response
  }
  
  if (request.type === "GENERATE_TEXT") {
    handleGenerateText(request.data, sender.tab)
      .then(result => {
        sendResponse(result);
      })
      .catch(err => {
        sendResponse({ error: err.message || "Generation failed" });
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
  // Check if user is logged in
  const authState = await getAuthState();
  if (!authState.accessToken) {
    throw new Error("Please sign in to use AI text enhancement. Click the extension icon.");
  }

  // Check cached credits
  const cachedCredits = await chrome.storage.local.get(CREDITS_CACHE_KEY);
  const credits = cachedCredits[CREDITS_CACHE_KEY]?.credits || 0;
  if (credits <= 0) {
    throw new Error("Insufficient credits. Visit autofill.live to purchase more.");
  }
  
  try {
    const response = await authenticatedFetch("/form/enhance", {
      method: "POST",
      body: JSON.stringify({
        text,
        fieldLabel,
        context,
        enhanceType: enhanceType || "professional"
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 402) {
        await updateCachedCredits(0);
        throw new Error("Insufficient credits. Visit autofill.live to purchase more.");
      }
      if (response.status === 401) {
        throw new Error("Session expired. Please sign in again via the extension.");
      }
      throw new Error(data.error || `API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Update cached credits if returned
    if (data.creditsRemaining !== undefined) {
      await updateCachedCredits(data.creditsRemaining);
    }
    
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
    // Track failed enhance
    trackEvent({
      type: "text_enhance",
      success: false
    });
    
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to server. Please check your internet connection.");
    }
    throw err;
  }
}

async function handleGenerateText({ fieldLabel, context }, tab) {
  // Check if user is logged in
  const authState = await getAuthState();
  if (!authState.accessToken) {
    throw new Error("Please sign in to use AI text generation. Click the extension icon.");
  }

  // Check cached credits
  const cachedCredits = await chrome.storage.local.get(CREDITS_CACHE_KEY);
  const credits = cachedCredits[CREDITS_CACHE_KEY]?.credits || 0;
  if (credits <= 0) {
    throw new Error("Insufficient credits. Visit autofill.live to purchase more.");
  }
  
  try {
    const response = await authenticatedFetch("/form/generate", {
      method: "POST",
      body: JSON.stringify({
        fieldLabel,
        context
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 402) {
        await updateCachedCredits(0);
        throw new Error("Insufficient credits. Visit autofill.live to purchase more.");
      }
      if (response.status === 401) {
        throw new Error("Session expired. Please sign in again via the extension.");
      }
      throw new Error(data.error || `API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Update cached credits if returned
    if (data.creditsRemaining !== undefined) {
      await updateCachedCredits(data.creditsRemaining);
    }
    
    // Track text generate event
    let domain = null;
    try {
      if (tab?.url) domain = new URL(tab.url).hostname;
    } catch {}
    
    trackEvent({
      type: "text_generate",
      domain,
      pageTitle: tab?.title || null,
      success: true,
      metadata: { fieldLabel }
    });
    
    return {
      generated: data.data?.generated || data.generated
    };
  } catch (err) {
    // Track failed generate
    trackEvent({
      type: "text_generate",
      success: false
    });
    
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to server. Please check your internet connection.");
    }
    throw err;
  }
}
