function extractFields() {
  const fields = [];
  
  // Detect if this is a Google Form
  const isGoogleForm = window.location.hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/');
  
  // Include standard fields, custom dropdowns, framework-specific markers, and dynamic form elements
  const standardSelector = "input, textarea, select, [contenteditable='true'], .select-input, .sfe-select, [role='combobox'], .MuiSelect-nativeInput";
  
  // Dynamic form selectors (Google Forms, Typeform, JotForm, etc.)
  const dynamicSelector = "[role='textbox'], [role='listbox'], [data-value], [jsname][data-params], .freebirdFormviewerComponentsQuestionTextRoot input, .freebirdFormviewerComponentsQuestionTextRoot textarea";
  
  const candidates = document.querySelectorAll(`${standardSelector}, ${dynamicSelector}`);
  const processedElements = new Set();

  // For Google Forms, extract questions differently
  if (isGoogleForm) {
    const googleFormFields = extractGoogleFormFields();
    if (googleFormFields.length > 0) {
      return {
        fields: googleFormFields,
        context: document.querySelector('[role="heading"][aria-level="1"]')?.innerText || document.title,
        pageUrl: window.location.href,
        pageTitle: document.title,
        isGoogleForm: true
      };
    }
  }

  candidates.forEach(el => {
    // Avoid duplicates
    if (processedElements.has(el)) return;
    processedElements.add(el);
    
    const style = window.getComputedStyle(el);
    const isHidden = style.display === "none" || style.visibility === "hidden" || style.opacity === "0";

    // We process hidden elements if they are standard input/select/textarea OR have specific framework classes like Mui native inputs
    const isStandardTag = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const isMuiNative = el.classList.contains("MuiSelect-nativeInput");
    const isDynamicInput = el.getAttribute("role") === "textbox" || el.getAttribute("role") === "listbox";

    if (isHidden && !isStandardTag && !isMuiNative && !isDynamicInput) return;

    // Skip generic buttons (but NOT file inputs - we want to show them in preview)
    if (["submit", "button", "reset"].includes(el.type)) return;

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
    
    // 4. Dynamic form label detection (role="heading" nearby, data-params, etc.)
    if (!label) {
      // Look for role="heading" in parent containers
      const container = el.closest('[data-params], [jscontroller], .freebirdFormviewerComponentsQuestionBaseRoot, .question-container, [role="listitem"]');
      if (container) {
        const heading = container.querySelector('[role="heading"], .freebirdFormviewerComponentsQuestionBaseHeader, .question-title, [data-question-title]');
        if (heading) label = heading.innerText;
      }
    }

    // 5. Search for nearby text (More aggressive)
    if (!label) {
      const parent = el.closest(".form-group, .field-wrapper, .col-md-6, .col-md-12, div");
      if (parent) {
        const textNodes = Array.from(parent.querySelectorAll("div, span, label, p, [role='heading']"))
          .filter(e => e !== el && !e.contains(el) && e.innerText.trim().length > 0 && e.innerText.trim().length < 200);

        if (textNodes.length > 0) {
          label = textNodes[0].innerText.replace("*", "").trim();
        }
      }
    }

    // Capture options for select/listbox
    let options = null;
    if (el.tagName === "SELECT") {
      options = Array.from(el.options).map(opt => ({ text: opt.text, value: opt.value }));
    } else if (el.getAttribute("role") === "listbox") {
      const optionEls = el.querySelectorAll('[role="option"], [data-value]');
      if (optionEls.length > 0) {
        options = Array.from(optionEls).map(opt => ({
          text: opt.innerText || opt.getAttribute("data-value"),
          value: opt.getAttribute("data-value") || opt.innerText
        }));
      }
    }

    // Capture the best key for the AI to use
    const finalKey = name || id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : null);

    // Current value (for "Fill only empty" – backend skips suggesting when present)
    let currentValue = "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      currentValue = (el.value || "").trim();
    } else if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      currentValue = (el.innerText || el.textContent || "").trim();
    } else if (el.getAttribute("data-value")) {
      currentValue = el.getAttribute("data-value");
    }

    if (finalKey) {
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || el.getAttribute("role") || "text",
        name: name || null,
        id: id || null,
        key: finalKey,
        label: label || "Unknown Field",
        options: options,
        currentValue: currentValue,
        isDynamic: isDynamicInput || el.isContentEditable
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
    formTitle = document.querySelector("h1, [role='heading'][aria-level='1']")?.innerText || document.title;
  }

  return {
    fields,
    context: formTitle,
    pageUrl: window.location.href,
    pageTitle: document.title
  };
}

// Special extraction for Google Forms
function extractGoogleFormFields() {
  const fields = [];
  
  // Google Forms question containers
  const questionContainers = document.querySelectorAll('[role="listitem"], .freebirdFormviewerComponentsQuestionBaseRoot, [jscontroller][data-params]');
  
  questionContainers.forEach((container, index) => {
    // Get the question title/label
    let label = null;
    const headingEl = container.querySelector('[role="heading"], .freebirdFormviewerComponentsQuestionBaseHeader, [dir="auto"]');
    if (headingEl) {
      label = headingEl.innerText?.trim();
    }
    
    if (!label || label.length === 0) return;
    
    // Skip if it's the form title (usually first heading)
    if (index === 0 && container.querySelector('[aria-level="1"]')) return;
    
    // Determine field type and find the input element
    let fieldType = "text";
    let inputEl = null;
    let options = null;
    let currentValue = "";
    
    // Text input (short answer)
    const textInput = container.querySelector('input[type="text"], input:not([type]), [role="textbox"] input');
    if (textInput) {
      fieldType = "text";
      inputEl = textInput;
      currentValue = textInput.value || "";
    }
    
    // Textarea (long answer / paragraph)
    const textareaInput = container.querySelector('textarea, [role="textbox"][contenteditable="true"]');
    if (!inputEl && textareaInput) {
      fieldType = "textarea";
      inputEl = textareaInput;
      currentValue = textareaInput.value || textareaInput.innerText || "";
    }
    
    // Radio buttons (multiple choice)
    const radioGroup = container.querySelector('[role="radiogroup"], .freebirdFormviewerComponentsQuestionRadioRoot');
    if (!inputEl && radioGroup) {
      fieldType = "radio";
      inputEl = radioGroup;
      const radioOptions = radioGroup.querySelectorAll('[role="radio"], [data-value]');
      options = Array.from(radioOptions).map(opt => {
        const text = opt.innerText?.trim() || opt.getAttribute("data-value") || opt.getAttribute("aria-label");
        return { text, value: text };
      }).filter(opt => opt.text);
      
      const checkedRadio = radioGroup.querySelector('[aria-checked="true"], [data-value][aria-checked="true"]');
      if (checkedRadio) {
        currentValue = checkedRadio.innerText?.trim() || checkedRadio.getAttribute("data-value");
      }
    }
    
    // Checkboxes (multiple select)
    const checkboxGroup = container.querySelector('[role="group"], .freebirdFormviewerComponentsQuestionCheckboxRoot');
    if (!inputEl && checkboxGroup && checkboxGroup.querySelector('[role="checkbox"]')) {
      fieldType = "checkbox";
      inputEl = checkboxGroup;
      const checkboxOptions = checkboxGroup.querySelectorAll('[role="checkbox"]');
      options = Array.from(checkboxOptions).map(opt => {
        const text = opt.innerText?.trim() || opt.getAttribute("aria-label");
        return { text, value: text };
      }).filter(opt => opt.text);
      
      const checkedBoxes = checkboxGroup.querySelectorAll('[role="checkbox"][aria-checked="true"]');
      currentValue = Array.from(checkedBoxes).map(cb => cb.innerText?.trim()).join(", ");
    }
    
    // Dropdown
    const dropdown = container.querySelector('[role="listbox"], .freebirdFormviewerComponentsQuestionSelectRoot select');
    if (!inputEl && dropdown) {
      fieldType = "select";
      inputEl = dropdown;
      if (dropdown.tagName === "SELECT") {
        options = Array.from(dropdown.options).map(opt => ({ text: opt.text, value: opt.value }));
        currentValue = dropdown.value;
      } else {
        const listboxOptions = dropdown.querySelectorAll('[role="option"], [data-value]');
        options = Array.from(listboxOptions).map(opt => ({
          text: opt.innerText?.trim() || opt.getAttribute("data-value"),
          value: opt.getAttribute("data-value") || opt.innerText?.trim()
        })).filter(opt => opt.text);
        
        const selectedOption = dropdown.querySelector('[aria-selected="true"]');
        if (selectedOption) {
          currentValue = selectedOption.innerText?.trim();
        }
      }
    }
    
    // Date input
    const dateInput = container.querySelector('input[type="date"], [data-date]');
    if (!inputEl && dateInput) {
      fieldType = "date";
      inputEl = dateInput;
      currentValue = dateInput.value || "";
    }
    
    // Time input
    const timeInput = container.querySelector('input[type="time"]');
    if (!inputEl && timeInput) {
      fieldType = "time";
      inputEl = timeInput;
      currentValue = timeInput.value || "";
    }
    
    // If we found a valid field, add it
    if (label) {
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      fields.push({
        tag: inputEl?.tagName?.toLowerCase() || "div",
        type: fieldType,
        name: null,
        id: inputEl?.id || null,
        key: key,
        label: label,
        options: options,
        currentValue: currentValue.trim(),
        isDynamic: true,
        isGoogleForm: true,
        containerIndex: index
      });
    }
  });
  
  return fields;
}

function fillForm(values, fieldsMeta = []) {
  // Check if this is a Google Form
  const isGoogleForm = window.location.hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/');
  
  if (isGoogleForm) {
    fillGoogleForm(values, fieldsMeta);
    return;
  }
  
  for (const [key, value] of Object.entries(values)) {
    // 1. Try to find the element by ID, Name, or Key match with some fuzzy logic
    let el = document.getElementById(key) ||
      document.getElementsByName(key)[0] ||
      document.querySelector(`[data-test-id*="${key}" i]`) ||
      document.querySelector(`[data-testid*="${key}" i]`);

    // 2. Fuzzy search for custom framework elements or labels
    if (!el) {
      el = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox'], [role='textbox'], [contenteditable='true']"))
        .find(input => {
          const l = input.getAttribute("aria-label") || "";
          const p = input.placeholder || "";
          const lblId = input.getAttribute("aria-labelledby");
          const lblTxt = (lblId ? document.getElementById(lblId)?.innerText : "") || "";

          return input.id?.toLowerCase() === key.toLowerCase() ||
            input.name?.toLowerCase() === key.toLowerCase() ||
            l.toLowerCase().includes(key.toLowerCase()) ||
            p.toLowerCase().includes(key.toLowerCase()) ||
            lblTxt.toLowerCase().includes(key.toLowerCase().replace(/_/g, " "));
        });
    }
    
    // 3. Try to find by label text match
    if (!el) {
      const keyNormalized = key.toLowerCase().replace(/_/g, ' ');
      const allContainers = document.querySelectorAll('.form-group, .field-wrapper, [role="listitem"], [jscontroller]');
      for (const container of allContainers) {
        const labelEl = container.querySelector('label, [role="heading"], .question-title');
        if (labelEl && labelEl.innerText.toLowerCase().includes(keyNormalized)) {
          el = container.querySelector('input, textarea, select, [role="textbox"], [contenteditable="true"]');
          if (el) break;
        }
      }
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
    // Handle contenteditable / role="textbox" (dynamic inputs)
    else if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      el.focus();
      el.innerText = value;
      // Also try setting textContent for some frameworks
      el.textContent = value;
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

    // Trigger full event chain to notify frameworks (React, Vue, Angular, etc.)
    triggerInputEvents(el);
  }
}

// Helper to trigger all necessary events for framework compatibility
function triggerInputEvents(el) {
  const eventOptions = { bubbles: true, cancelable: true };
  
  // Focus first
  el.dispatchEvent(new FocusEvent("focus", eventOptions));
  el.dispatchEvent(new FocusEvent("focusin", eventOptions));
  
  // Input events
  el.dispatchEvent(new Event("input", eventOptions));
  el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
  el.dispatchEvent(new Event("change", eventOptions));
  
  // Keyboard events (helps with some frameworks)
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a" }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "a" }));
  
  // Blur
  el.dispatchEvent(new FocusEvent("blur", eventOptions));
  el.dispatchEvent(new FocusEvent("focusout", eventOptions));

  // For Material UI - notify the floating label to shrink correctly
  if (el.classList.contains('MuiInputBase-input') || el.classList.contains('MuiSelect-nativeInput')) {
    const parent = el.closest('.MuiInputBase-root') || el.parentElement;
    parent?.dispatchEvent(new Event('click', eventOptions));
  }
}

// Special fill function for Google Forms
function fillGoogleForm(values, fieldsMeta = []) {
  // Get all question containers
  const questionContainers = document.querySelectorAll('[role="listitem"], .freebirdFormviewerComponentsQuestionBaseRoot, [jscontroller][data-params]');
  
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    
    const keyNormalized = key.toLowerCase().replace(/_/g, ' ');
    
    // Find the matching question container by label
    let targetContainer = null;
    for (const container of questionContainers) {
      const headingEl = container.querySelector('[role="heading"], .freebirdFormviewerComponentsQuestionBaseHeader, [dir="auto"]');
      if (headingEl) {
        const labelText = headingEl.innerText?.toLowerCase() || "";
        if (labelText.includes(keyNormalized) || keyNormalized.includes(labelText.split(' ').slice(0, 3).join(' '))) {
          targetContainer = container;
          break;
        }
      }
    }
    
    // Also try matching by field metadata index
    if (!targetContainer && fieldsMeta.length > 0) {
      const fieldInfo = fieldsMeta.find(f => f.key === key);
      if (fieldInfo && fieldInfo.containerIndex !== undefined) {
        targetContainer = questionContainers[fieldInfo.containerIndex];
      }
    }
    
    if (!targetContainer) {
      console.warn(`Google Form: Could not find question for key: ${key}`);
      continue;
    }
    
    // Determine the input type and fill accordingly
    
    // Text input (short answer)
    const textInput = targetContainer.querySelector('input[type="text"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
    if (textInput) {
      textInput.focus();
      textInput.value = value;
      triggerInputEvents(textInput);
      continue;
    }
    
    // Textarea (long answer / paragraph)
    const textareaInput = targetContainer.querySelector('textarea');
    if (textareaInput) {
      textareaInput.focus();
      textareaInput.value = value;
      triggerInputEvents(textareaInput);
      continue;
    }
    
    // Contenteditable textbox
    const contentEditable = targetContainer.querySelector('[contenteditable="true"], [role="textbox"]');
    if (contentEditable) {
      contentEditable.focus();
      contentEditable.innerText = value;
      triggerInputEvents(contentEditable);
      continue;
    }
    
    // Radio buttons (multiple choice) - click the matching option
    const radioGroup = targetContainer.querySelector('[role="radiogroup"]');
    if (radioGroup) {
      const radioOptions = radioGroup.querySelectorAll('[role="radio"], [data-value]');
      for (const option of radioOptions) {
        const optionText = option.innerText?.toLowerCase().trim() || option.getAttribute("data-value")?.toLowerCase() || "";
        if (optionText === value.toLowerCase().trim() || optionText.includes(value.toLowerCase().trim()) || value.toLowerCase().trim().includes(optionText)) {
          option.click();
          break;
        }
      }
      continue;
    }
    
    // Checkboxes (multiple select) - can have multiple values
    const checkboxGroup = targetContainer.querySelector('[role="group"]');
    if (checkboxGroup && checkboxGroup.querySelector('[role="checkbox"]')) {
      const valuesToCheck = value.split(',').map(v => v.trim().toLowerCase());
      const checkboxOptions = checkboxGroup.querySelectorAll('[role="checkbox"]');
      for (const option of checkboxOptions) {
        const optionText = option.innerText?.toLowerCase().trim() || option.getAttribute("aria-label")?.toLowerCase() || "";
        if (valuesToCheck.some(v => optionText.includes(v) || v.includes(optionText))) {
          if (option.getAttribute("aria-checked") !== "true") {
            option.click();
          }
        }
      }
      continue;
    }
    
    // Dropdown - click to open, then select option
    const dropdown = targetContainer.querySelector('[role="listbox"]');
    if (dropdown) {
      // Click to open dropdown
      dropdown.click();
      
      // Wait a bit for dropdown to open, then select
      setTimeout(() => {
        const options = document.querySelectorAll('[role="option"], [data-value]');
        for (const option of options) {
          const optionText = option.innerText?.toLowerCase().trim() || option.getAttribute("data-value")?.toLowerCase() || "";
          if (optionText === value.toLowerCase().trim() || optionText.includes(value.toLowerCase().trim())) {
            option.click();
            break;
          }
        }
      }, 100);
      continue;
    }
    
    // Standard select dropdown
    const selectEl = targetContainer.querySelector('select');
    if (selectEl) {
      const option = Array.from(selectEl.options).find(opt =>
        opt.text.toLowerCase().trim() === value.toLowerCase().trim() ||
        opt.text.toLowerCase().includes(value.toLowerCase())
      );
      if (option) {
        selectEl.value = option.value;
        triggerInputEvents(selectEl);
      }
      continue;
    }
    
    // Date input
    const dateInput = targetContainer.querySelector('input[type="date"]');
    if (dateInput) {
      let dateVal = value;
      if (value && value.includes("T")) dateVal = value.split("T")[0];
      dateInput.value = dateVal;
      triggerInputEvents(dateInput);
      continue;
    }
  }
}

function fillFileInputs(files) {
  for (const [key, fileData] of Object.entries(files)) {
    // Find the file input by key (id, name, or data attribute)
    let el = document.getElementById(key) ||
      document.getElementsByName(key)[0] ||
      document.querySelector(`input[type="file"][data-test-id*="${key}" i]`) ||
      document.querySelector(`input[type="file"][data-testid*="${key}" i]`);
    
    // Fuzzy search for file inputs
    if (!el) {
      el = Array.from(document.querySelectorAll('input[type="file"]'))
        .find(input => {
          const l = input.getAttribute("aria-label") || "";
          const lblId = input.getAttribute("aria-labelledby");
          const lblTxt = (lblId ? document.getElementById(lblId)?.innerText : "") || "";
          const inputId = input.id || "";
          const inputName = input.name || "";
          
          return inputId.toLowerCase() === key.toLowerCase() ||
            inputName.toLowerCase() === key.toLowerCase() ||
            l.toLowerCase().includes(key.toLowerCase()) ||
            lblTxt.toLowerCase().includes(key.toLowerCase().replace(/_/g, " "));
        });
    }
    
    if (!el || el.type !== "file") {
      console.warn(`File input not found for key: ${key}`);
      continue;
    }
    
    try {
      // Convert base64 back to File
      const base64Response = fileData.base64;
      const byteString = atob(base64Response.split(',')[1]);
      const mimeType = fileData.type || base64Response.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeType });
      const file = new File([blob], fileData.name, { type: mimeType });
      
      // Use DataTransfer to set the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.files = dataTransfer.files;
      
      // Trigger events
      const eventOptions = { bubbles: true, cancelable: true };
      el.dispatchEvent(new Event("input", eventOptions));
      el.dispatchEvent(new Event("change", eventOptions));
      
      console.log(`File set for ${key}: ${fileData.name}`);
    } catch (err) {
      console.error(`Failed to set file for ${key}:`, err);
    }
  }
}

function undoFill(previousValues, filledKeys) {
  // For each key that was filled, restore to previous value (or clear if it was empty)
  for (const key of filledKeys) {
    // Find the element
    let el = document.getElementById(key) ||
      document.getElementsByName(key)[0] ||
      document.querySelector(`[data-test-id*="${key}" i]`) ||
      document.querySelector(`[data-testid*="${key}" i]`);

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

    // Skip file inputs - can't programmatically clear them
    if (el.tagName === "INPUT" && el.type === "file") {
      continue;
    }

    // Get the previous value (empty string if it wasn't set)
    const previousValue = previousValues[key] !== undefined ? previousValues[key] : "";

    // Handle standard SELECT
    if (el.tagName === "SELECT") {
      el.value = previousValue;
      if (previousValue === "") {
        el.selectedIndex = 0;
      }
    }
    // Handle standard INPUT/TEXTAREA
    else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.type === "checkbox") {
        el.checked = !!previousValue;
      } else if (el.type === "radio") {
        if (previousValue) {
          const radio = document.querySelector(`input[name="${el.name}"][value="${previousValue}"]`);
          if (radio) radio.checked = true;
        } else {
          // Uncheck all radios in this group
          document.querySelectorAll(`input[name="${el.name}"]`).forEach(r => r.checked = false);
        }
      } else {
        // Use native setter to properly trigger React/Vue state updates
        const prototype = el.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, previousValue);
        } else {
          el.value = previousValue;
        }
      }
    }

    // Trigger full event chain
    const eventOptions = { bubbles: true, cancelable: true };
    el.dispatchEvent(new Event("input", eventOptions));
    el.dispatchEvent(new Event("change", eventOptions));
    el.dispatchEvent(new FocusEvent("focus", eventOptions));
    el.dispatchEvent(new FocusEvent("blur", eventOptions));

    // For Material UI
    if (el.classList.contains('MuiInputBase-input') || el.classList.contains('MuiSelect-nativeInput')) {
      const parent = el.closest('.MuiInputBase-root') || el.parentElement;
      parent.dispatchEvent(new Event('click', eventOptions));
    }
  }
}

function extractEnhanceableFields() {
  const fields = [];
  const textElements = document.querySelectorAll("textarea, input[type='text'], [contenteditable='true']");
  
  textElements.forEach(el => {
    const style = window.getComputedStyle(el);
    const isHidden = style.display === "none" || style.visibility === "hidden";
    if (isHidden) return;
    
    let value = "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      value = (el.value || "").trim();
    } else if (el.isContentEditable) {
      value = (el.innerText || el.textContent || "").trim();
    }
    
    // Only include fields with substantial text (at least 20 chars, likely a sentence)
    if (value.length < 20) return;
    
    const id = el.id || el.getAttribute("id");
    const name = el.name || el.getAttribute("name");
    
    let label = null;
    if (id) {
      label = document.querySelector(`label[for="${id}"]`)?.innerText;
    }
    if (!label) {
      label = el.closest("label")?.innerText ||
        el.getAttribute("aria-label") ||
        el.placeholder ||
        el.getAttribute("placeholder");
    }
    if (!label) {
      const parent = el.closest(".form-group, .field-wrapper, div");
      if (parent) {
        const textNodes = Array.from(parent.querySelectorAll("label, span, div"))
          .filter(e => e !== el && !e.contains(el) && e.innerText.trim().length > 0 && e.innerText.trim().length < 50);
        if (textNodes.length > 0) {
          label = textNodes[0].innerText.replace("*", "").trim();
        }
      }
    }
    
    const key = name || id || (label ? label.toLowerCase().replace(/\s+/g, '_') : `field_${fields.length}`);
    
    fields.push({
      key,
      label: label || "Text field",
      value,
      tag: el.tagName.toLowerCase(),
      type: el.type || "text"
    });
  });
  
  return fields;
}

function setFieldValue(key, value) {
  let el = document.getElementById(key) ||
    document.getElementsByName(key)[0] ||
    document.querySelector(`[data-test-id*="${key}" i]`) ||
    document.querySelector(`[data-testid*="${key}" i]`);

  if (!el) {
    el = Array.from(document.querySelectorAll("textarea, input[type='text'], [contenteditable='true']"))
      .find(input => {
        const l = input.getAttribute("aria-label") || "";
        const p = input.placeholder || "";
        const lblId = input.getAttribute("aria-labelledby");
        const lblTxt = (lblId ? document.getElementById(lblId)?.innerText : "") || "";

        return input.id?.toLowerCase() === key.toLowerCase() ||
          input.name?.toLowerCase() === key.toLowerCase() ||
          l.toLowerCase().includes(key.toLowerCase()) ||
          p.toLowerCase().includes(key.toLowerCase()) ||
          lblTxt.toLowerCase().includes(key.toLowerCase().replace(/_/g, " "));
      });
  }

  if (!el) {
    console.warn(`Field not found for key: ${key}`);
    return false;
  }

  // Set the value
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const prototype = el.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  } else if (el.isContentEditable) {
    el.innerText = value;
  }

  // Trigger events
  const eventOptions = { bubbles: true, cancelable: true };
  el.dispatchEvent(new Event("input", eventOptions));
  el.dispatchEvent(new Event("change", eventOptions));
  el.dispatchEvent(new FocusEvent("focus", eventOptions));
  el.dispatchEvent(new FocusEvent("blur", eventOptions));

  return true;
}

// ==================== AI Enhance Floating Button ====================

const AUTOFILL_ENHANCE_STYLES = `
  .autofill-enhance-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: white;
    color: #d4a012;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    transition: all 0.15s ease;
    opacity: 0;
    transform: scale(0.9);
    pointer-events: none;
  }
  
  .autofill-enhance-btn.visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
  }
  
  .autofill-enhance-btn:hover {
    background: #fffbeb;
    border-color: #d4a012;
    color: #b8860b;
    box-shadow: 0 2px 6px rgba(212, 160, 18, 0.25);
  }
  
  .autofill-enhance-btn:active {
    transform: scale(0.95);
  }
  
  .autofill-enhance-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .autofill-enhance-btn svg {
    width: 16px;
    height: 16px;
  }
  
  .autofill-enhance-wrapper {
    position: relative;
    display: inline-block;
  }
  
  @keyframes autofill-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .autofill-enhance-btn .spinner {
    animation: autofill-spin 1s linear infinite;
  }
  
  /* Preview Modal */
  .autofill-enhance-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
  }
  
  .autofill-enhance-modal.visible {
    opacity: 1;
    visibility: visible;
  }
  
  .autofill-enhance-modal-content {
    background: white;
    border-radius: 12px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    transform: scale(0.95);
    transition: transform 0.2s ease;
  }
  
  .autofill-enhance-modal.visible .autofill-enhance-modal-content {
    transform: scale(1);
  }
  
  .autofill-enhance-modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #eaeaea;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .autofill-enhance-modal-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #000;
  }
  
  .autofill-enhance-modal-header svg {
    color: #8b5cf6;
  }
  
  .autofill-enhance-modal-body {
    padding: 20px;
    max-height: 50vh;
    overflow-y: auto;
  }
  
  .autofill-enhance-section {
    margin-bottom: 16px;
  }
  
  .autofill-enhance-section:last-child {
    margin-bottom: 0;
  }
  
  .autofill-enhance-section-label {
    font-size: 11px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  
  .autofill-enhance-section-text {
    background: #fafafa;
    border: 1px solid #eaeaea;
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    line-height: 1.5;
    color: #333;
    white-space: pre-wrap;
    word-break: break-word;
  }
  
  .autofill-enhance-section-text.improved {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
  
  .autofill-enhance-modal-footer {
    padding: 16px 20px;
    border-top: 1px solid #eaeaea;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  
  .autofill-enhance-modal-btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid #eaeaea;
    background: white;
    color: #333;
  }
  
  .autofill-enhance-modal-btn:hover {
    background: #fafafa;
  }
  
  .autofill-enhance-modal-btn.primary {
    background: #000;
    color: white;
    border-color: #000;
  }
  
  .autofill-enhance-modal-btn.primary:hover {
    background: #333;
  }
`;

let enhanceStylesInjected = false;
let currentEnhanceTarget = null;
let enhanceModal = null;
let enhanceButton = null;
let pendingEnhanceTarget = null; // Store target for modal replacement

function injectEnhanceStyles() {
  if (enhanceStylesInjected) return;
  const style = document.createElement('style');
  style.id = 'autofill-enhance-styles';
  style.textContent = AUTOFILL_ENHANCE_STYLES;
  document.head.appendChild(style);
  enhanceStylesInjected = true;
}

function createEnhanceButton() {
  if (enhanceButton) return enhanceButton;
  
  const btn = document.createElement('button');
  btn.className = 'autofill-enhance-btn';
  btn.title = 'Improve with AI';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
    </svg>
  `;
  btn.addEventListener('click', handleEnhanceClick);
  document.body.appendChild(btn);
  enhanceButton = btn;
  return btn;
}

function createEnhanceModal() {
  if (enhanceModal) return enhanceModal;
  
  const modal = document.createElement('div');
  modal.className = 'autofill-enhance-modal';
  modal.innerHTML = `
    <div class="autofill-enhance-modal-content">
      <div class="autofill-enhance-modal-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
        </svg>
        <h3>AI Text Enhancement</h3>
      </div>
      <div class="autofill-enhance-modal-body">
        <div class="autofill-enhance-section">
          <div class="autofill-enhance-section-label">Original</div>
          <div class="autofill-enhance-section-text" id="autofill-original-text"></div>
        </div>
        <div class="autofill-enhance-section">
          <div class="autofill-enhance-section-label">Improved</div>
          <div class="autofill-enhance-section-text improved" id="autofill-improved-text"></div>
        </div>
      </div>
      <div class="autofill-enhance-modal-footer">
        <button type="button" class="autofill-enhance-modal-btn" id="autofill-enhance-cancel">Cancel</button>
        <button type="button" class="autofill-enhance-modal-btn primary" id="autofill-enhance-replace">Replace</button>
      </div>
    </div>
  `;
  
  // Backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      console.log('[Autofill.AI] Modal backdrop clicked');
      hideEnhanceModal(true);
    }
  });
  
  // Cancel button
  const cancelBtn = modal.querySelector('#autofill-enhance-cancel');
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Autofill.AI] Cancel clicked');
    hideEnhanceModal(true);
  });
  
  // Replace button
  const replaceBtn = modal.querySelector('#autofill-enhance-replace');
  replaceBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Autofill.AI] Replace clicked');
    console.log('[Autofill.AI] pendingEnhanceTarget:', pendingEnhanceTarget);
    console.log('[Autofill.AI] pendingEnhancedText:', pendingEnhancedText?.substring(0, 50));
    applyEnhancedText();
  });
  
  document.body.appendChild(modal);
  enhanceModal = modal;
  return modal;
}

function showEnhanceButton(textarea) {
  injectEnhanceStyles();
  const btn = createEnhanceButton();
  
  const rect = textarea.getBoundingClientRect();
  
  // Position the button at top-right of textarea
  btn.style.position = 'fixed';
  btn.style.top = `${rect.top + 8}px`;
  btn.style.right = `${window.innerWidth - rect.right + 8}px`;
  btn.style.left = 'auto';
  
  currentEnhanceTarget = textarea;
  
  // Show button - it will indicate if text is too short when clicked
  const value = textarea.value || textarea.innerText || '';
  if (value.trim().length >= 15) {
    btn.classList.add('visible');
    btn.title = 'Improve this text with AI';
  } else {
    // Still show but with different state for discoverability
    btn.classList.add('visible');
    btn.title = 'Type more text to enable AI improvement';
    btn.style.opacity = '0.5';
  }
}

function hideEnhanceButton() {
  if (enhanceButton) {
    enhanceButton.classList.remove('visible');
    enhanceButton.style.opacity = '';
  }
  currentEnhanceTarget = null;
}

function showEnhanceModal(original, improved) {
  injectEnhanceStyles();
  const modal = createEnhanceModal();
  
  // pendingEnhanceTarget should already be set by handleEnhanceClick
  console.log('[Autofill.AI] showEnhanceModal - pendingEnhanceTarget:', pendingEnhanceTarget?.tagName);
  
  modal.querySelector('#autofill-original-text').textContent = original;
  modal.querySelector('#autofill-improved-text').textContent = improved;
  
  modal.classList.add('visible');
}

function hideEnhanceModal(clearPending = false) {
  if (enhanceModal) {
    enhanceModal.classList.remove('visible');
  }
  if (clearPending) {
    pendingEnhancedText = '';
    pendingEnhanceTarget = null;
  }
}

let pendingEnhancedText = '';

async function handleEnhanceClick(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!currentEnhanceTarget) return;
  
  // IMPORTANT: Store the target immediately before any async operations
  const targetElement = currentEnhanceTarget;
  const text = targetElement.value || targetElement.innerText || '';
  
  // Check minimum text length
  if (text.trim().length < 15) {
    alert('Please write at least a sentence (15+ characters) before improving with AI.');
    targetElement.focus();
    return;
  }
  
  const btn = enhanceButton;
  const originalHtml = btn.innerHTML;
  
  try {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/>
      </svg>
    `;
    
    // Get field label for context
    let fieldLabel = '';
    const id = targetElement.id;
    if (id) {
      fieldLabel = document.querySelector(`label[for="${id}"]`)?.innerText || '';
    }
    if (!fieldLabel) {
      fieldLabel = targetElement.getAttribute('aria-label') || 
                   targetElement.placeholder || 
                   'Text field';
    }
    
    // Send message to background script to call API (background can bypass CORS)
    let response;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        response = await chrome.runtime.sendMessage({
          type: 'ENHANCE_TEXT',
          data: {
            text,
            fieldLabel,
            context: document.title,
            enhanceType: 'professional'
          }
        });
      } else {
        throw new Error('Extension context invalid. Please refresh the page.');
      }
    } catch (msgErr) {
      // Extension context might be invalidated
      if (msgErr.message?.includes('Extension context invalidated') || 
          msgErr.message?.includes('context invalid')) {
        throw new Error('Extension was updated. Please refresh the page and try again.');
      }
      throw msgErr;
    }
    
    if (!response) {
      throw new Error('No response from extension. Please refresh the page.');
    }
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    const enhanced = response.enhanced;
    if (!enhanced) {
      throw new Error('No enhanced text returned');
    }
    
    // Store both the text and target for the modal
    pendingEnhancedText = enhanced;
    pendingEnhanceTarget = targetElement; // Set it here directly!
    
    showEnhanceModal(text, enhanced);
    
  } catch (err) {
    console.error('Enhance error:', err);
    alert('Failed to enhance text: ' + (err.message || 'Unknown error'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function applyEnhancedText() {
  console.log('[Autofill.AI] applyEnhancedText called');
  
  if (!pendingEnhanceTarget) {
    console.error('[Autofill.AI] No target element to apply text to');
    alert('Error: Lost reference to text field. Please try again.');
    hideEnhanceModal(true);
    return;
  }
  
  if (!pendingEnhancedText) {
    console.error('[Autofill.AI] No enhanced text to apply');
    alert('Error: No enhanced text available. Please try again.');
    hideEnhanceModal(true);
    return;
  }
  
  const el = pendingEnhanceTarget;
  const textToApply = pendingEnhancedText;
  
  console.log('[Autofill.AI] Applying to element:', el.tagName, el.id || el.name || '(no id)');
  console.log('[Autofill.AI] Text length:', textToApply.length);
  
  try {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Use native setter for React/Vue compatibility
      const prototype = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, textToApply);
        console.log('[Autofill.AI] Used native setter');
      } else {
        el.value = textToApply;
        console.log('[Autofill.AI] Used direct assignment');
      }
    } else if (el.isContentEditable) {
      el.innerText = textToApply;
      console.log('[Autofill.AI] Set contentEditable innerText');
    }
    
    // Trigger events to notify frameworks
    const eventOptions = { bubbles: true, cancelable: true };
    el.dispatchEvent(new Event('input', eventOptions));
    el.dispatchEvent(new Event('change', eventOptions));
    el.dispatchEvent(new FocusEvent('focus', eventOptions));
    el.dispatchEvent(new FocusEvent('blur', eventOptions));
    
    console.log('[Autofill.AI] Events dispatched, new value:', el.value?.substring(0, 50) || el.innerText?.substring(0, 50));
    
    // Hide modal and clear state
    hideEnhanceModal(false);
    pendingEnhancedText = '';
    pendingEnhanceTarget = null;
    
    console.log('[Autofill.AI] Text applied successfully');
  } catch (err) {
    console.error('[Autofill.AI] Error applying text:', err);
    alert('Error applying text: ' + err.message);
  }
}

// Listen for focus/blur on textareas
function initEnhanceListeners() {
  // Use capture phase to catch focus before it bubbles
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    // Check if it's a textarea or contenteditable
    const isTextarea = el.tagName === 'TEXTAREA';
    const isContentEditable = el.isContentEditable && el.tagName !== 'BODY';
    const isLargeInput = el.tagName === 'INPUT' && el.type === 'text' && el.offsetHeight > 40;
    
    if (isTextarea || isContentEditable || isLargeInput) {
      showEnhanceButton(el);
    }
  }, true);
  
  document.addEventListener('focusout', (e) => {
    const relatedTarget = e.relatedTarget;
    
    // Don't hide if clicking the enhance button
    if (relatedTarget === enhanceButton) {
      return;
    }
    
    // Delay hide to allow clicking the button
    setTimeout(() => {
      // Check if we're still focused on the same element or the button
      if (document.activeElement !== currentEnhanceTarget && 
          document.activeElement !== enhanceButton &&
          !enhanceModal?.classList.contains('visible')) {
        hideEnhanceButton();
      }
    }, 300);
  }, true);
  
  // Update button opacity based on text length
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el === currentEnhanceTarget && enhanceButton) {
      const value = el.value || el.innerText || '';
      if (value.trim().length >= 15) {
        enhanceButton.style.opacity = '';
        enhanceButton.title = 'Improve this text with AI';
      } else {
        enhanceButton.style.opacity = '0.5';
        enhanceButton.title = 'Type more text to enable AI improvement';
      }
    }
  }, true);
  
  // Handle scroll - reposition button
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (currentEnhanceTarget && enhanceButton?.classList.contains('visible')) {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const rect = currentEnhanceTarget.getBoundingClientRect();
        enhanceButton.style.top = `${rect.top + 8}px`;
        enhanceButton.style.right = `${window.innerWidth - rect.right + 8}px`;
      }, 10);
    }
  }, true);
  
  // Also listen for resize
  window.addEventListener('resize', () => {
    if (currentEnhanceTarget && enhanceButton?.classList.contains('visible')) {
      const rect = currentEnhanceTarget.getBoundingClientRect();
      enhanceButton.style.top = `${rect.top + 8}px`;
      enhanceButton.style.right = `${window.innerWidth - rect.right + 8}px`;
    }
  });
}

// Initialize enhance listeners when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Autofill.AI] Content script loaded, initializing enhance listeners');
    initEnhanceListeners();
  });
} else {
  console.log('[Autofill.AI] Content script loaded (DOM ready), initializing enhance listeners');
  initEnhanceListeners();
}

// Make them available globally in the content script context
window.extractFields = extractFields;
window.fillForm = fillForm;
window.fillFileInputs = fillFileInputs;
window.undoFill = undoFill;
window.extractEnhanceableFields = extractEnhanceableFields;
window.setFieldValue = setFieldValue;
