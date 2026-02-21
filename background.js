const BACKEND_URL = "http://localhost:9000";

console.log("[Autofill.AI] Background service worker started");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Autofill.AI] Received message:", request.type);
  
  if (request.type === "ENHANCE_TEXT") {
    handleEnhanceText(request.data)
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

async function handleEnhanceText({ text, fieldLabel, context, enhanceType }) {
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
    return {
      original: text,
      enhanced: data.data?.enhanced || data.enhanced
    };
  } catch (err) {
    console.error("[Autofill.AI] Enhance API error:", err);
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to backend server. Is it running on localhost:9000?");
    }
    throw err;
  }
}
