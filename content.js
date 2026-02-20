function extractFields() {
  const fields = [];
  // Include standard fields, custom dropdowns, and framework-specific markers like MuiSelect
  const candidates = document.querySelectorAll("input, textarea, select, [contenteditable='true'], .select-input, .sfe-select, [role='combobox'], .MuiSelect-nativeInput");

  candidates.forEach(el => {
    const style = window.getComputedStyle(el);
    const isHidden = style.display === "none" || style.visibility === "hidden" || style.opacity === "0";

    // We process hidden elements if they are standard input/select/textarea OR have specific framework classes like Mui native inputs
    const isStandardTag = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const isMuiNative = el.classList.contains("MuiSelect-nativeInput");

    if (isHidden && !isStandardTag && !isMuiNative) return;

    // Skip generic buttons and file inputs (file inputs cannot be filled programmatically)
    if (["submit", "button", "reset", "file"].includes(el.type)) return;

    const id = el.id || el.getAttribute("id");
    const name = el.name || el.getAttribute("name");

    let label = null;

    // 1. Standard label for
    if (id) {
      label = document.querySelector(`label[for="${id}"]`)?.innerText;
    }

    // 2. Wrap label or aria-label/placeholder
    if (!label) {
      label = el.closest("label")?.innerText ||
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") ? document.getElementById(el.getAttribute("aria-labelledby"))?.innerText : null) ||
        el.placeholder ||
        el.getAttribute("placeholder");
    }

    // 3. MUI Specific Check: Look for nearby label elements inside MuiFormControl-root
    if (!label) {
      const muiRoot = el.closest(".MuiFormControl-root");
      if (muiRoot) {
        const muiLabel = muiRoot.querySelector(".MuiInputLabel-root");
        if (muiLabel) label = muiLabel.innerText;
      }
    }

    // 4. Search for nearby text (More aggressive)
    if (!label) {
      const parent = el.closest(".form-group, .field-wrapper, .col-md-6, .col-md-12, div");
      if (parent) {
        const textNodes = Array.from(parent.querySelectorAll("div, span, label, p"))
          .filter(e => e !== el && !e.contains(el) && e.innerText.trim().length > 0);

        if (textNodes.length > 0) {
          label = textNodes[0].innerText.replace("*", "").trim();
        }
      }
    }

    // Capture options
    let options = null;
    if (el.tagName === "SELECT") {
      options = Array.from(el.options).map(opt => ({ text: opt.text, value: opt.value }));
    }

    // Capture the best key for the AI to use
    const finalKey = name || id || (label ? label.toLowerCase().replace(/\s+/g, '_') : null);

    // Current value (for "Fill only empty" – backend skips suggesting when present)
    let currentValue = "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      currentValue = (el.value || "").trim();
    } else if (el.isContentEditable) {
      currentValue = (el.innerText || el.textContent || "").trim();
    }

    if (finalKey) {
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || "text",
        name: name || null,
        id: id || null,
        key: finalKey,
        label: label || "Unknown Field",
        options: options,
        currentValue: currentValue
      });
    }
  });

  // Extract Form Context
  let formTitle = "";
  // 1. Try to find the nearest heading
  const firstField = candidates[0];
  if (firstField) {
    const form = firstField.closest("form");
    if (form) {
      // Look for a legend, heading or aria-label on the form
      const legend = form.querySelector("legend");
      if (legend) formTitle = legend.innerText;

      if (!formTitle) {
        formTitle = form.getAttribute("aria-label") || form.name || form.id;
      }

      if (!formTitle) {
        // Look for preceding H1-H3
        let prev = form.previousElementSibling;
        while (prev && !formTitle) {
          if (["H1", "H2", "H3"].includes(prev.tagName)) {
            formTitle = prev.innerText;
          }
          prev = prev.previousElementSibling;
        }
      }
    }
  }

  // 2. Fallback to page title or first H1
  if (!formTitle) {
    formTitle = document.querySelector("h1")?.innerText || document.title;
  }

  return {
    fields,
    context: formTitle
  };
}

function fillForm(values) {
  for (const [key, value] of Object.entries(values)) {
    // 1. Try to find the element by ID, Name, or Key match with some fuzzy logic
    let el = document.getElementById(key) ||
      document.getElementsByName(key)[0] ||
      document.querySelector(`[data-test-id*="${key}" i]`) ||
      document.querySelector(`[data-testid*="${key}" i]`);

    // 2. Fuzzy search for custom framework elements or labels
    if (!el) {
      el = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox']"))
        .find(input => {
          const l = input.getAttribute("aria-label") || "";
          const p = input.placeholder || "";
          const lblId = input.getAttribute("aria-labelledby");
          const lblTxt = (lblId ? document.getElementById(lblId)?.innerText : "") || "";

          return input.id.toLowerCase() === key.toLowerCase() ||
            input.name?.toLowerCase() === key.toLowerCase() ||
            l.toLowerCase().includes(key.toLowerCase()) ||
            p.toLowerCase().includes(key.toLowerCase()) ||
            lblTxt.toLowerCase().includes(key.toLowerCase().replace(/_/g, " "));
        });
    }

    if (!el) continue;

    // Skip file inputs immediately - browser security prevents programmatic file selection
    if (el.tagName === "INPUT" && el.type === "file") {
      console.warn(`Skipping file input: ${key}. Browser security prevents programmatic file selection.`);
      continue;
    }

    // Handle standard SELECT
    if (el.tagName === "SELECT") {
      el.value = value;
      if (el.value !== String(value)) {
        const option = Array.from(el.options).find(opt =>
          opt.text.toLowerCase().trim() === String(value).toLowerCase().trim() ||
          opt.text.toLowerCase().includes(String(value).toLowerCase())
        );
        if (option) el.value = option.value;
      }
    }
    // Handle standard INPUT/TEXTAREA
    else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.type === "file") {
        console.warn(`Skipping file input: ${key}. Browser security prevents programmatic file selection.`);
        continue;
      }

      if (el.type === "checkbox") {
        el.checked = !!value;
      } else if (el.type === "radio") {
        const radio = document.querySelector(`input[name="${el.name}"][value="${value}"]`) ||
          document.querySelector(`input[name="${el.name}"]`);
        if (radio) radio.checked = true;
      } else if (el.type === "date") {
        let dateVal = value;
        if (value && value.includes("T")) dateVal = value.split("T")[0];
        el.value = dateVal;
      } else {
        const prototype = el.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
      }
    }

    // Trigger full event chain to notify frameworks (React, Vue, etc.)
    const eventOptions = { bubbles: true, cancelable: true };
    el.dispatchEvent(new Event("input", eventOptions));
    el.dispatchEvent(new Event("change", eventOptions));
    el.dispatchEvent(new FocusEvent("focus", eventOptions));
    el.dispatchEvent(new FocusEvent("blur", eventOptions));

    // For Material UI - notify the floating label to shrink correctly
    if (el.classList.contains('MuiInputBase-input') || el.classList.contains('MuiSelect-nativeInput')) {
      const parent = el.closest('.MuiInputBase-root') || el.parentElement;
      parent.dispatchEvent(new Event('click', eventOptions));
    }
  }
}

// Make them available globally in the content script context
window.extractFields = extractFields;
window.fillForm = fillForm;
