function extractFields() {
  const fields = [];
  const processedElements = new WeakSet();
  const processedKeys = new Set();
  
  // Detect if this is a Google Form
  const isGoogleForm = window.location.hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/');

  // For Google Forms, use special extraction
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
  
  // SMART CRAWLING: Find ALL interactive elements that could be form fields
  const interactiveElements = findAllInteractiveElements();
  
  interactiveElements.forEach((el, index) => {
    if (processedElements.has(el)) return;
    processedElements.add(el);
    
    const field = smartExtractField(el, index);
    if (field && field.label && !processedKeys.has(field.key)) {
      processedKeys.add(field.key);
      fields.push(field);
    }
  });
  

  // Extract Form Context
  let formTitle = document.querySelector("h1, [role='heading'][aria-level='1'], .page-title, .form-title")?.innerText || "";
  if (!formTitle) {
    const form = document.querySelector("form");
    if (form) {
      formTitle = form.getAttribute("aria-label") || form.name || form.id || "";
    }
  }
  if (!formTitle) formTitle = document.title;

  return {
    fields,
    context: formTitle,
    pageUrl: window.location.href,
    pageTitle: document.title
  };
}

// Find ALL interactive elements using multiple strategies
function findAllInteractiveElements() {
  const elements = new Set();
  
  // Strategy 1: Standard form elements
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (!isHiddenOrDisabled(el) && !isButtonType(el)) {
      elements.add(el);
    }
  });
  
  // Strategy 2: ARIA roles that indicate input
  document.querySelectorAll('[role="textbox"], [role="combobox"], [role="listbox"], [role="spinbutton"], [role="searchbox"], [role="slider"]').forEach(el => {
    if (!isHiddenOrDisabled(el)) elements.add(el);
  });
  
  // Strategy 3: Contenteditable elements
  document.querySelectorAll('[contenteditable="true"]').forEach(el => {
    if (!isHiddenOrDisabled(el)) elements.add(el);
  });
  
  // Strategy 4: Custom components - find by common patterns
  // Look for elements that CONTAIN inputs or have input-like behavior
  document.querySelectorAll('[class*="dropdown"], [class*="select"], [class*="picker"], [class*="input"], [class*="field"], [class*="autocomplete"], [class*="combobox"]').forEach(el => {
    // Only add if it's a custom component (not a wrapper around standard input)
    const hasStandardInput = el.querySelector('input:not([type="hidden"]), select, textarea');
    if (!hasStandardInput && !isHiddenOrDisabled(el) && isInteractiveComponent(el)) {
      elements.add(el);
    }
  });
  
  // Strategy 5: Elements with form-related attributes
  // Note: Can't use [(ngModel)] in selector as parentheses are invalid CSS
  const formAttrSelectors = [
    '[formcontrolname]',
    '[ng-model]',
    '[v-model]',
    '[data-bind]',
    '[ng-reflect-model]',
    '[ng-reflect-name]'
  ];
  formAttrSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (!isHiddenOrDisabled(el)) elements.add(el);
      });
    } catch (e) {
      // Ignore invalid selectors
    }
  });
  
  // Strategy 6: Find custom tag components (Angular, Vue, Web Components)
  // These often have hyphenated names like p-dropdown, mat-select, etc.
  const allElements = document.querySelectorAll('*');
  allElements.forEach(el => {
    const tagName = el.tagName.toLowerCase();
    // Custom elements have hyphens in their names
    if (tagName.includes('-') && !tagName.startsWith('x-') && isFormComponent(el)) {
      if (!isHiddenOrDisabled(el)) elements.add(el);
    }
  });
  
  // Strategy 7: Find clickable elements that look like form controls
  document.querySelectorAll('[tabindex="0"], [tabindex]:not([tabindex="-1"])').forEach(el => {
    if (!isHiddenOrDisabled(el) && isFormLikeElement(el) && !elements.has(el)) {
      elements.add(el);
    }
  });
  
  return Array.from(elements);
}

// Check if element is hidden or disabled
function isHiddenOrDisabled(el) {
  if (el.disabled || el.getAttribute('disabled') !== null) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  if (parseFloat(style.opacity) === 0) return true;
  
  // Check if element has no dimensions (truly hidden)
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true;
  
  return false;
}

// Check if element is a button type
function isButtonType(el) {
  const type = el.type?.toLowerCase();
  return ['submit', 'button', 'reset', 'image'].includes(type);
}

// Check if element behaves like an interactive component
function isInteractiveComponent(el) {
  // Has click handler or looks interactive
  const hasClickHandler = el.onclick || el.getAttribute('onclick') || el.getAttribute('ng-click') || el.getAttribute('(click)') || el.getAttribute('@click');
  const hasAriaRole = el.getAttribute('role');
  const isClickable = el.style.cursor === 'pointer' || window.getComputedStyle(el).cursor === 'pointer';
  const hasTabIndex = el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1';
  
  return hasClickHandler || hasAriaRole || isClickable || hasTabIndex;
}

// Check if custom element is a form component
function isFormComponent(el) {
  const tagName = el.tagName.toLowerCase();
  const formKeywords = ['input', 'select', 'dropdown', 'picker', 'calendar', 'date', 'time', 'checkbox', 'radio', 'switch', 'toggle', 'autocomplete', 'combobox', 'textarea', 'editor', 'field', 'chips', 'multiselect'];
  
  return formKeywords.some(keyword => tagName.includes(keyword));
}

// Check if element looks like a form field
function isFormLikeElement(el) {
  const tagName = el.tagName.toLowerCase();
  
  // Skip obvious non-form elements
  if (['button', 'a', 'nav', 'header', 'footer', 'aside', 'article', 'section', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'img', 'svg', 'icon'].includes(tagName)) {
    // But check if div/span has form-related classes
    if (tagName === 'div' || tagName === 'span') {
      const className = el.className?.toLowerCase() || '';
      const hasFormClass = ['input', 'select', 'dropdown', 'field', 'control', 'picker'].some(k => className.includes(k));
      if (!hasFormClass) return false;
    } else {
      return false;
    }
  }
  
  // Check for form-related attributes
  const hasFormAttr = el.getAttribute('formcontrolname') || el.getAttribute('ng-model') || el.getAttribute('name') || el.getAttribute('id');
  
  // Check for ARIA attributes indicating form control
  const hasAriaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
  const hasRole = ['textbox', 'combobox', 'listbox', 'spinbutton', 'checkbox', 'radio', 'switch', 'slider'].includes(el.getAttribute('role'));
  
  return hasFormAttr || hasAriaLabel || hasRole;
}

// Smart extraction - analyzes element and its context to extract field info
function smartExtractField(el, index) {
  const tagName = el.tagName.toLowerCase();
  
  // Determine field type
  const fieldType = detectFieldType(el);
  if (!fieldType) return null;
  
  // Find label using multiple strategies
  const label = findLabelForElement(el);
  if (!label) return null;
  
  // Generate key
  const key = generateFieldKey(el, label);
  
  // Get current value
  const currentValue = getElementValue(el);
  
  // Get options for select-like elements
  const options = getElementOptions(el);
  
  return {
    tag: tagName,
    type: fieldType,
    name: el.name || el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || null,
    id: el.id || null,
    key: key,
    label: label,
    options: options,
    currentValue: currentValue,
    isDynamic: !['input', 'textarea', 'select'].includes(tagName),
    elementIndex: index
  };
}

// Detect field type from element
function detectFieldType(el) {
  const tagName = el.tagName.toLowerCase();
  
  // Standard elements
  if (tagName === 'input') {
    const type = el.type?.toLowerCase() || 'text';
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return null;
    return type;
  }
  if (tagName === 'textarea') return 'textarea';
  if (tagName === 'select') return 'select';
  
  // ARIA roles
  const role = el.getAttribute('role');
  if (role) {
    const roleMap = {
      'textbox': 'text',
      'searchbox': 'search',
      'combobox': 'select',
      'listbox': 'select',
      'spinbutton': 'number',
      'slider': 'range',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'switch': 'checkbox'
    };
    if (roleMap[role]) return roleMap[role];
  }
  
  // Contenteditable
  if (el.getAttribute('contenteditable') === 'true') return 'textarea';
  
  // Custom components - detect by tag name or class
  const className = (el.className?.toLowerCase?.() || el.className || '').toString();
  const combined = tagName + ' ' + className;
  
  if (combined.includes('dropdown') || combined.includes('select') || combined.includes('combobox') || combined.includes('listbox')) return 'select';
  if (combined.includes('calendar') || combined.includes('datepicker') || combined.includes('date-picker')) return 'date';
  if (combined.includes('timepicker') || combined.includes('time-picker')) return 'time';
  if (combined.includes('checkbox') || combined.includes('check-box')) return 'checkbox';
  if (combined.includes('radio')) return 'radio';
  if (combined.includes('switch') || combined.includes('toggle')) return 'checkbox';
  if (combined.includes('autocomplete') || combined.includes('auto-complete') || combined.includes('typeahead')) return 'autocomplete';
  if (combined.includes('textarea') || combined.includes('editor') || combined.includes('richtext')) return 'textarea';
  if (combined.includes('input') || combined.includes('text')) return 'text';
  if (combined.includes('multiselect') || combined.includes('multi-select') || combined.includes('chips')) return 'multiselect';
  if (combined.includes('number') || combined.includes('numeric') || combined.includes('spinner')) return 'number';
  if (combined.includes('password')) return 'password';
  if (combined.includes('email')) return 'email';
  if (combined.includes('phone') || combined.includes('tel')) return 'tel';
  if (combined.includes('url')) return 'url';
  if (combined.includes('color')) return 'color';
  if (combined.includes('file') || combined.includes('upload')) return 'file';
  
  // Check for input inside
  const innerInput = el.querySelector('input:not([type="hidden"])');
  if (innerInput) return innerInput.type || 'text';
  
  // Default for custom components that look interactive
  if (el.getAttribute('tabindex') !== null || el.getAttribute('role')) return 'text';
  
  return null;
}

// Find label for element using multiple strategies
function findLabelForElement(el) {
  let label = null;
  
  // Strategy 1: Explicit label[for] attribute
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${el.id}"]`);
    if (forLabel) label = cleanLabel(forLabel.innerText);
  }
  
  // Strategy 2: Wrapping label
  if (!label) {
    const wrapLabel = el.closest('label');
    if (wrapLabel) {
      // Get label text excluding the input's own text
      const clone = wrapLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(e => e.remove());
      label = cleanLabel(clone.innerText);
    }
  }
  
  // Strategy 3: ARIA attributes
  if (!label) {
    label = el.getAttribute('aria-label');
  }
  if (!label && el.getAttribute('aria-labelledby')) {
    const labelEl = document.getElementById(el.getAttribute('aria-labelledby'));
    if (labelEl) label = cleanLabel(labelEl.innerText);
  }
  
  // Strategy 4: Walk up DOM to find nearest label-like element
  if (!label) {
    label = findNearestLabel(el);
  }
  
  // Strategy 5: Placeholder as last resort
  if (!label) {
    label = el.placeholder || el.getAttribute('placeholder');
  }
  
  // Strategy 6: Title attribute
  if (!label) {
    label = el.title || el.getAttribute('title');
  }
  
  // Strategy 7: Name/ID as very last resort (humanize it)
  if (!label) {
    const name = el.name || el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || el.id;
    if (name) {
      label = humanizeFieldName(name);
    }
  }
  
  return label;
}

// Find nearest label by walking up DOM
function findNearestLabel(el) {
  // Walk up to find a container that has a label
  let current = el.parentElement;
  let depth = 0;
  const maxDepth = 6; // Don't go too far up
  
  while (current && depth < maxDepth) {
    // Look for label element
    const labelEl = current.querySelector(':scope > label, :scope > .label, :scope > [class*="label"]:not([class*="label-"]):not([class*="-label"])');
    if (labelEl && !labelEl.contains(el)) {
      const text = cleanLabel(labelEl.innerText);
      if (text && text.length > 0 && text.length < 100) return text;
    }
    
    // Look for heading that might be a label
    const heading = current.querySelector(':scope > [role="heading"], :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
    if (heading && !heading.contains(el)) {
      const text = cleanLabel(heading.innerText);
      if (text && text.length > 0 && text.length < 100) return text;
    }
    
    // Look for text that appears before the element
    const children = Array.from(current.children);
    const elIndex = children.findIndex(child => child === el || child.contains(el));
    
    if (elIndex > 0) {
      // Check previous siblings for label-like text
      for (let i = elIndex - 1; i >= 0 && i >= elIndex - 3; i--) {
        const sibling = children[i];
        if (sibling.tagName === 'LABEL' || sibling.classList?.contains('label') || sibling.tagName.match(/^H[1-6]$/)) {
          const text = cleanLabel(sibling.innerText);
          if (text && text.length > 0 && text.length < 100) return text;
        }
        // Check for text content in spans/divs that look like labels
        if (['SPAN', 'DIV', 'P'].includes(sibling.tagName)) {
          const text = cleanLabel(sibling.innerText);
          if (text && text.length > 1 && text.length < 80 && !text.includes('\n')) {
            // Make sure it's not a value or placeholder-like text
            if (!sibling.querySelector('input, select, textarea, button')) {
              return text;
            }
          }
        }
      }
    }
    
    current = current.parentElement;
    depth++;
  }
  
  return null;
}

// Clean label text
function cleanLabel(text) {
  if (!text) return null;
  return text
    .replace(/\*/g, '')           // Remove required asterisks
    .replace(/[:：]/g, '')        // Remove colons
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
}

// Humanize field name (convert camelCase, snake_case, etc. to readable text)
function humanizeFieldName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase
    .replace(/[_-]/g, ' ')                 // snake_case, kebab-case
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase()); // Capitalize first letter
}

// Generate unique key for field
function generateFieldKey(el, label) {
  // Priority: formcontrolname > name > id > label-based
  const formControlName = el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name');
  if (formControlName) return formControlName;
  
  if (el.name) return el.name;
  if (el.id) return el.id;
  
  // Generate from label
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Get current value of element
function getElementValue(el) {
  const tagName = el.tagName.toLowerCase();
  
  // Standard inputs
  if (tagName === 'input') {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked ? 'true' : '';
    }
    return el.value || '';
  }
  if (tagName === 'textarea') return el.value || '';
  if (tagName === 'select') return el.value || '';
  
  // Contenteditable
  if (el.getAttribute('contenteditable') === 'true') {
    return el.innerText?.trim() || '';
  }
  
  // Custom components - try various methods
  // Check for selected value display
  const valueDisplay = el.querySelector('.selected-value, .value, [class*="value"]:not([class*="values"]), [class*="label"]:not(.placeholder):not([class*="placeholder"])');
  if (valueDisplay) {
    const text = valueDisplay.innerText?.trim();
    // Make sure it's not a placeholder
    if (text && !el.querySelector('.placeholder')?.contains(valueDisplay)) {
      return text;
    }
  }
  
  // Check for inner input
  const innerInput = el.querySelector('input:not([type="hidden"])');
  if (innerInput) return innerInput.value || '';
  
  // Check for data attributes
  const dataValue = el.getAttribute('data-value') || el.getAttribute('ng-reflect-model');
  if (dataValue) return dataValue;
  
  return '';
}

// Get options for select-like elements
function getElementOptions(el) {
  const tagName = el.tagName.toLowerCase();
  
  // Standard select
  if (tagName === 'select') {
    return Array.from(el.options).map(opt => ({
      text: opt.text,
      value: opt.value
    }));
  }
  
  // Look for option elements or list items
  const optionSelectors = [
    '[role="option"]',
    '[role="listitem"]',
    'li[data-value]',
    '.option',
    '[class*="option"]',
    '[class*="item"]:not([class*="items"])'
  ];
  
  const options = el.querySelectorAll(optionSelectors.join(', '));
  if (options.length > 0) {
    return Array.from(options).map(opt => ({
      text: opt.innerText?.trim() || opt.getAttribute('aria-label') || '',
      value: opt.getAttribute('data-value') || opt.getAttribute('value') || opt.innerText?.trim() || ''
    })).filter(opt => opt.text);
  }
  
  return null;
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
        // Try multiple ways to get the radio label text
        let text = opt.getAttribute("aria-label");
        
        // If no aria-label, look for text in nested elements
        if (!text) {
          const parent = opt.closest('[data-value], [jscontroller]') || opt.parentElement;
          if (parent) {
            const labelSpan = parent.querySelector('span[dir="auto"], span:not([role])');
            if (labelSpan) text = labelSpan.innerText?.trim();
          }
        }
        
        // Fallback to innerText
        if (!text) {
          text = opt.innerText?.trim();
        }
        
        // Last resort - data-value
        if (!text) {
          text = opt.getAttribute("data-value");
        }
        
        return { text: text || "", value: text || "" };
      }).filter(opt => opt.text && opt.text.length > 0);
      
      const checkedRadio = radioGroup.querySelector('[aria-checked="true"], [data-value][aria-checked="true"]');
      if (checkedRadio) {
        let checkedText = checkedRadio.getAttribute("aria-label");
        if (!checkedText) {
          const parent = checkedRadio.closest('[data-value], [jscontroller]') || checkedRadio.parentElement;
          if (parent) {
            const labelSpan = parent.querySelector('span[dir="auto"], span:not([role])');
            if (labelSpan) checkedText = labelSpan.innerText?.trim();
          }
        }
        if (!checkedText) checkedText = checkedRadio.innerText?.trim();
        currentValue = checkedText || "";
      }
    }
    
    // Checkboxes (multiple select)
    // Google Forms checkboxes can be in [role="group"] or as individual [role="checkbox"] elements
    const checkboxGroup = container.querySelector('[role="group"], .freebirdFormviewerComponentsQuestionCheckboxRoot');
    const standaloneCheckboxes = container.querySelectorAll('[role="checkbox"]');
    
    if (!inputEl && (checkboxGroup || standaloneCheckboxes.length > 0)) {
      const checkboxOptions = checkboxGroup 
        ? checkboxGroup.querySelectorAll('[role="checkbox"]')
        : standaloneCheckboxes;
      
      if (checkboxOptions.length > 0) {
        fieldType = "checkbox";
        inputEl = checkboxGroup || container;
        
        options = Array.from(checkboxOptions).map(opt => {
          // Try multiple ways to get the checkbox label text
          let text = opt.getAttribute("aria-label");
          
          // If no aria-label, look for text in the checkbox element or its parent
          if (!text) {
            // Look for a sibling or child span/div with the label text
            const parent = opt.closest('[data-value], [jscontroller]') || opt.parentElement;
            if (parent) {
              const labelSpan = parent.querySelector('span[dir="auto"], span:not([role])');
              if (labelSpan) text = labelSpan.innerText?.trim();
            }
          }
          
          // Fallback to innerText but filter out just whitespace
          if (!text) {
            text = opt.innerText?.trim();
          }
          
          // Last resort - data-value attribute
          if (!text) {
            text = opt.getAttribute("data-value");
          }
          
          return { text: text || "", value: text || "" };
        }).filter(opt => opt.text && opt.text.length > 0);
        
        // Get currently checked values
        const checkedBoxes = (checkboxGroup || container).querySelectorAll('[role="checkbox"][aria-checked="true"]');
        currentValue = Array.from(checkedBoxes).map(cb => {
          let text = cb.getAttribute("aria-label");
          if (!text) {
            const parent = cb.closest('[data-value], [jscontroller]') || cb.parentElement;
            if (parent) {
              const labelSpan = parent.querySelector('span[dir="auto"], span:not([role])');
              if (labelSpan) text = labelSpan.innerText?.trim();
            }
          }
          if (!text) text = cb.innerText?.trim();
          return text;
        }).filter(Boolean).join(", ");
      }
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
    
    // File upload - Google Forms file upload detection
    // Google Forms uses a button/div for file uploads, not standard input[type="file"]
    const fileUpload = container.querySelector(
      '[data-file-upload], ' +
      '[aria-label*="file" i], ' +
      '[aria-label*="upload" i], ' +
      '.freebirdFormviewerComponentsQuestionFileUpload, ' +
      '[jscontroller][jsaction*="upload"], ' +
      'button[aria-label*="Add file" i], ' +
      '[role="button"][aria-label*="file" i]'
    );
    
    // Also check if the question text mentions file/upload/document/resume/cv
    const isFileQuestion = label && /\b(file|upload|document|resume|cv|attachment|pdf|image|photo|picture)\b/i.test(label);
    
    if (!inputEl && (fileUpload || isFileQuestion)) {
      fieldType = "file";
      inputEl = fileUpload || container;
      currentValue = "(Manual upload required)";
      
      // Check if a file has been uploaded (look for file name display)
      const uploadedFile = container.querySelector('[class*="filename"], [class*="file-name"], [data-file-name]');
      if (uploadedFile && uploadedFile.innerText?.trim()) {
        currentValue = uploadedFile.innerText?.trim();
      }
      
    }
    
    // Linear scale (1-5, 1-10 ratings)
    const linearScale = container.querySelector('[role="radiogroup"][aria-label*="scale" i], .freebirdFormviewerComponentsQuestionScaleRoot');
    if (!inputEl && linearScale) {
      fieldType = "scale";
      inputEl = linearScale;
      const scaleOptions = linearScale.querySelectorAll('[role="radio"]');
      options = Array.from(scaleOptions).map(opt => {
        const value = opt.getAttribute('data-value') || opt.getAttribute('aria-label') || opt.innerText?.trim();
        return { text: value, value: value };
      }).filter(opt => opt.text);
      
      const selectedScale = linearScale.querySelector('[role="radio"][aria-checked="true"]');
      if (selectedScale) {
        currentValue = selectedScale.getAttribute('data-value') || selectedScale.innerText?.trim() || "";
      }
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
  
  // SMART FILLING: For each value, find the best matching element
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    
    
    // Find the element using smart matching
    const element = smartFindElement(key, fieldsMeta);
    
    if (!element) {
      continue;
    }
    
    
    // Fill the element using smart filling
    smartFillElement(element, value);
  }
}

// Smart element finder - uses multiple strategies
function smartFindElement(key, fieldsMeta = []) {
  const keyLower = key.toLowerCase();
  const keyNormalized = key.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Strategy 1: Direct ID/Name match
  let el = document.getElementById(key) || document.getElementsByName(key)[0];
  if (el && isValidFormElement(el)) return el;
  
  // Strategy 2: Form control name (Angular/React)
  el = document.querySelector(`[formcontrolname="${key}"], [ng-reflect-name="${key}"], [name="${key}"], [data-name="${key}"]`);
  if (el && isValidFormElement(el)) return el;
  
  // Strategy 3: Case-insensitive ID/Name
  el = document.querySelector(`[id="${key}" i], [name="${key}" i]`);
  if (el && isValidFormElement(el)) return el;
  
  // Strategy 4: Find by label association
  el = findElementByLabel(keyNormalized);
  if (el) return el;
  
  // Strategy 5: Find by aria-label
  el = document.querySelector(`[aria-label*="${keyNormalized}" i]`);
  if (el && isValidFormElement(el)) return el;
  
  // Strategy 6: Find by placeholder
  el = document.querySelector(`[placeholder*="${keyNormalized}" i]`);
  if (el && isValidFormElement(el)) return el;
  
  // Strategy 7: Fuzzy match using field metadata
  if (fieldsMeta && fieldsMeta.length > 0) {
    const matchingMeta = fieldsMeta.find(f => f.key === key || f.label?.toLowerCase().includes(keyNormalized));
    if (matchingMeta && matchingMeta.elementIndex !== undefined) {
      const allElements = findAllInteractiveElements();
      if (allElements[matchingMeta.elementIndex]) {
        return allElements[matchingMeta.elementIndex];
      }
    }
  }
  
  // Strategy 8: Walk DOM looking for matching label text
  el = findElementByLabelText(keyNormalized);
  if (el) return el;
  
  return null;
}

// Check if element is a valid form element
function isValidFormElement(el) {
  if (!el) return false;
  const tagName = el.tagName.toLowerCase();
  
  // Standard form elements
  if (['input', 'textarea', 'select'].includes(tagName)) {
    const type = el.type?.toLowerCase();
    return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
  }
  
  // Custom components
  if (tagName.includes('-')) return true; // Web components
  
  // ARIA roles
  const role = el.getAttribute('role');
  if (['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton'].includes(role)) return true;
  
  // Contenteditable
  if (el.getAttribute('contenteditable') === 'true') return true;
  
  return false;
}

// Find element by label association
function findElementByLabel(labelText) {
  // Find all labels
  const labels = document.querySelectorAll('label');
  
  for (const label of labels) {
    const text = cleanLabel(label.innerText);
    if (!text) continue;
    
    // Check for fuzzy match
    if (fuzzyMatch(text, labelText)) {
      // Label has 'for' attribute
      if (label.htmlFor) {
        const el = document.getElementById(label.htmlFor);
        if (el && isValidFormElement(el)) return el;
      }
      
      // Label wraps the input
      const wrappedInput = label.querySelector('input, textarea, select');
      if (wrappedInput && isValidFormElement(wrappedInput)) return wrappedInput;
      
      // Find input in same container
      const container = label.closest('div, .form-group, .form__group, .field, [class*="field"]');
      if (container) {
        const input = container.querySelector('input:not([type="hidden"]):not([type="submit"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');
        if (input && isValidFormElement(input)) return input;
        
        // Also check for custom components
        const customEl = container.querySelector('[class*="dropdown"], [class*="select"], [class*="picker"], [class*="input"]');
        if (customEl && isInteractiveComponent(customEl)) return customEl;
      }
    }
  }
  
  return null;
}

// Find element by walking DOM and matching label text
function findElementByLabelText(labelText) {
  // Get all potential containers
  const containers = document.querySelectorAll('div, section, fieldset, [class*="field"], [class*="group"], [class*="form"]');
  
  for (const container of containers) {
    // Skip very large containers (likely page wrappers)
    if (container.querySelectorAll('input, textarea, select').length > 10) continue;
    
    // Look for label-like text
    const textElements = container.querySelectorAll('label, span, p, div, h1, h2, h3, h4, h5, h6');
    
    for (const textEl of textElements) {
      // Skip if contains form elements
      if (textEl.querySelector('input, textarea, select')) continue;
      
      const text = cleanLabel(textEl.innerText);
      if (!text || text.length > 100) continue;
      
      if (fuzzyMatch(text, labelText)) {
        // Find nearest input
        const input = container.querySelector('input:not([type="hidden"]):not([type="submit"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');
        if (input && isValidFormElement(input)) return input;
        
        // Check for custom components
        const allChildren = container.querySelectorAll('*');
        for (const child of allChildren) {
          if (child.tagName.toLowerCase().includes('-') && isFormComponent(child)) {
            return child;
          }
        }
      }
    }
  }
  
  return null;
}

// Fuzzy match two strings
function fuzzyMatch(str1, str2) {
  if (!str1 || !str2) return false;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return true;
  
  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return true;
  
  // Word-based match
  const words1 = s1.split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.split(/\s+/).filter(w => w.length > 2);
  
  // Check if significant words match
  const matchCount = words1.filter(w1 => words2.some(w2 => w1.includes(w2) || w2.includes(w1))).length;
  const threshold = Math.min(words1.length, words2.length) * 0.5;
  
  return matchCount >= threshold && matchCount > 0;
}

// Smart fill element - handles any type of form element
function smartFillElement(el, value) {
  const tagName = el.tagName.toLowerCase();
  
  // Skip file inputs
  if (tagName === 'input' && el.type === 'file') {
    return;
  }
  
  // Standard INPUT
  if (tagName === 'input') {
    fillStandardInput(el, value);
    return;
  }
  
  // TEXTAREA
  if (tagName === 'textarea') {
    setInputValue(el, value);
    return;
  }
  
  // Standard SELECT
  if (tagName === 'select') {
    fillStandardSelect(el, value);
    return;
  }
  
  // Contenteditable
  if (el.getAttribute('contenteditable') === 'true') {
    el.focus();
    el.innerText = value;
    triggerInputEvents(el);
    return;
  }
  
  // Custom components - detect type and fill accordingly
  const componentType = detectComponentType(el);
  
  switch (componentType) {
    case 'dropdown':
    case 'select':
    case 'combobox':
      fillCustomDropdown(el, value);
      break;
    case 'checkbox':
      fillCustomCheckbox(el, value);
      break;
    case 'radio':
      fillCustomRadio(el, value);
      break;
    case 'date':
    case 'calendar':
      fillCustomDatePicker(el, value);
      break;
    case 'autocomplete':
      fillCustomAutocomplete(el, value);
      break;
    default:
      // Try to find inner input
      const innerInput = el.querySelector('input:not([type="hidden"]), textarea');
      if (innerInput) {
        setInputValue(innerInput, value);
      } else {
        // Last resort - try clicking and typing
        fillBySimulation(el, value);
      }
  }
}

// Fill standard input element
function fillStandardInput(el, value) {
  const type = el.type?.toLowerCase() || 'text';
  
  switch (type) {
    case 'checkbox':
      const shouldCheck = value === true || value === 'true' || value === 'yes' || value === '1' || value === 'on';
      if (el.checked !== shouldCheck) {
        el.click();
      }
      triggerInputEvents(el);
      break;
      
    case 'radio':
      // Find the radio with matching value in the same group
      const radioGroup = document.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
      for (const radio of radioGroup) {
        if (radio.value.toLowerCase() === String(value).toLowerCase()) {
          radio.click();
          triggerInputEvents(radio);
          break;
        }
      }
      break;
      
    case 'date':
      let dateVal = value;
      if (value && value.includes('T')) dateVal = value.split('T')[0];
      setInputValue(el, dateVal);
      break;
      
    case 'number':
      setInputValue(el, String(value).replace(/[^\d.-]/g, ''));
      break;
      
    default:
      setInputValue(el, value);
  }
}

// Fill standard select element
function fillStandardSelect(el, value) {
  const valueLower = String(value).toLowerCase().trim();
  
  // Try exact value match
  el.value = value;
  
  // If that didn't work, try matching option text
  if (el.value !== String(value)) {
    const option = Array.from(el.options).find(opt => 
      opt.value.toLowerCase().trim() === valueLower ||
      opt.text.toLowerCase().trim() === valueLower ||
      opt.text.toLowerCase().includes(valueLower) ||
      valueLower.includes(opt.text.toLowerCase())
    );
    if (option) el.value = option.value;
  }
  
  triggerInputEvents(el);
}

// Detect custom component type
function detectComponentType(el) {
  const tagName = el.tagName.toLowerCase();
  const className = (el.className?.toLowerCase?.() || '').toString();
  const role = el.getAttribute('role');
  
  // Check ARIA role first
  if (role === 'combobox' || role === 'listbox') return 'dropdown';
  if (role === 'checkbox' || role === 'switch') return 'checkbox';
  if (role === 'radio' || role === 'radiogroup') return 'radio';
  
  // Check tag name and class
  const combined = tagName + ' ' + className;
  
  if (combined.includes('dropdown') || combined.includes('select') || combined.includes('combobox') || combined.includes('listbox')) return 'dropdown';
  if (combined.includes('calendar') || combined.includes('datepicker') || combined.includes('date-picker')) return 'date';
  if (combined.includes('checkbox') || combined.includes('check-box')) return 'checkbox';
  if (combined.includes('radio')) return 'radio';
  if (combined.includes('autocomplete') || combined.includes('typeahead')) return 'autocomplete';
  
  return 'unknown';
}

// Fill custom dropdown/select component
function fillCustomDropdown(el, value) {
  // Step 1: Click to open the dropdown
  clickElement(el);
  
  // Step 2: Wait for options to appear and select
  setTimeout(() => {
    const valueLower = String(value).toLowerCase().trim();
    
    // Find options panel (could be anywhere in DOM)
    const optionSelectors = [
      '[role="option"]',
      '[role="listbox"] > *',
      '.p-dropdown-item',
      '.p-dropdown-items li',
      '.ng-option',
      '.mat-option',
      '[class*="option"]',
      '[class*="item"]:not([class*="items"])',
      'li[data-value]',
      'li:not([class*="header"]):not([class*="footer"])'
    ];
    
    let optionFound = false;
    
    for (const selector of optionSelectors) {
      const options = document.querySelectorAll(selector);
      
      for (const option of options) {
        // Skip hidden options
        if (isHiddenOrDisabled(option)) continue;
        
        const optionText = (option.innerText || option.getAttribute('aria-label') || option.getAttribute('data-value') || '').toLowerCase().trim();
        
        if (optionText === valueLower || optionText.includes(valueLower) || valueLower.includes(optionText)) {
          clickElement(option);
          optionFound = true;
          break;
        }
      }
      
      if (optionFound) break;
    }
    
    if (!optionFound) {
      // Try typing the value
      const input = el.querySelector('input') || document.activeElement;
      if (input && (input.tagName === 'INPUT' || input.getAttribute('contenteditable'))) {
        setInputValue(input, value);
      }
    }
  }, 200);
}

// Fill custom checkbox
function fillCustomCheckbox(el, value) {
  const shouldCheck = value === true || value === 'true' || value === 'yes' || value === '1' || value === 'on';
  const isChecked = el.getAttribute('aria-checked') === 'true' || 
                    el.classList.contains('checked') || 
                    el.classList.contains('p-checkbox-checked') ||
                    el.querySelector('.checked, [class*="checked"]') !== null;
  
  if (shouldCheck !== isChecked) {
    clickElement(el);
  }
}

// Fill custom radio
function fillCustomRadio(el, value) {
  const valueLower = String(value).toLowerCase().trim();
  
  // Find all radio options in the group
  const container = el.closest('[role="radiogroup"], .radio-group, [class*="radio"]') || el.parentElement;
  const radios = container.querySelectorAll('[role="radio"], [class*="radio"]');
  
  for (const radio of radios) {
    const radioText = (radio.innerText || radio.getAttribute('aria-label') || radio.getAttribute('value') || '').toLowerCase().trim();
    
    if (radioText === valueLower || radioText.includes(valueLower)) {
      clickElement(radio);
      break;
    }
  }
}

// Fill custom date picker
function fillCustomDatePicker(el, value) {
  // Try to find inner input
  const input = el.querySelector('input');
  if (input) {
    let dateVal = value;
    if (value && value.includes('T')) dateVal = value.split('T')[0];
    setInputValue(input, dateVal);
  } else {
    // Click and type
    clickElement(el);
    setTimeout(() => {
      const activeInput = document.activeElement;
      if (activeInput && activeInput.tagName === 'INPUT') {
        setInputValue(activeInput, value);
      }
    }, 100);
  }
}

// Fill autocomplete
function fillCustomAutocomplete(el, value) {
  const input = el.querySelector('input') || el;
  if (input) {
    setInputValue(input, value);
    // Trigger search
    setTimeout(() => {
      const firstOption = document.querySelector('[role="option"], .autocomplete-option, [class*="suggestion"]');
      if (firstOption) {
        clickElement(firstOption);
      }
    }, 300);
  }
}

// Fill by simulation (last resort)
function fillBySimulation(el, value) {
  // Focus and click
  el.focus();
  clickElement(el);
  
  // Wait a bit then try to type
  setTimeout(() => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable'))) {
      setInputValue(activeEl, value);
    }
  }, 100);
}

// Click element with proper event simulation
function clickElement(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y
  };
  
  el.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
  el.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  el.dispatchEvent(new MouseEvent('click', eventOptions));
}

// Helper to get text from Google Form radio/checkbox options
function getGoogleFormOptionText(option) {
  // Try aria-label first
  let text = option.getAttribute("aria-label");
  
  // Look for text in nested span elements
  if (!text) {
    const parent = option.closest('[data-value], [jscontroller]') || option.parentElement;
    if (parent) {
      const labelSpan = parent.querySelector('span[dir="auto"], span:not([role]):not([aria-hidden])');
      if (labelSpan) text = labelSpan.innerText?.trim();
    }
  }
  
  // Try innerText but be careful of nested elements
  if (!text) {
    // Clone and remove hidden elements to get clean text
    const clone = option.cloneNode(true);
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
    text = clone.innerText?.trim();
  }
  
  // Fallback to data-value
  if (!text) {
    text = option.getAttribute("data-value");
  }
  
  return text || "";
}

// Helper to trigger all necessary events for framework compatibility
function triggerInputEvents(el) {
  const eventOptions = { bubbles: true, cancelable: true };
  
  // Focus first
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", eventOptions));
  el.dispatchEvent(new FocusEvent("focusin", eventOptions));
  
  // Input events - these are critical for Angular/React
  el.dispatchEvent(new Event("input", eventOptions));
  el.dispatchEvent(new InputEvent("input", { 
    bubbles: true, 
    cancelable: true, 
    inputType: "insertText",
    data: el.value 
  }));
  el.dispatchEvent(new Event("change", eventOptions));
  
  // Keyboard events (helps with some frameworks)
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a" }));
  el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "a" }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "a" }));
  
  // Blur to trigger validation
  el.dispatchEvent(new FocusEvent("blur", eventOptions));
  el.dispatchEvent(new FocusEvent("focusout", eventOptions));

  // For Material UI
  if (el.classList.contains('MuiInputBase-input') || el.classList.contains('MuiSelect-nativeInput')) {
    const parent = el.closest('.MuiInputBase-root') || el.parentElement;
    parent?.dispatchEvent(new Event('click', eventOptions));
  }
  
  // For Angular - trigger ngModel and reactive forms update
  el.dispatchEvent(new Event('ngModelChange', eventOptions));
  
  // Try to trigger Angular's change detection via zone
  try {
    const ngZone = window.ng?.probe?.(el)?.injector?.get?.(window.ng?.coreTokens?.NgZone);
    if (ngZone) ngZone.run(() => {});
  } catch (e) {}
}

// Set value on input with framework compatibility
function setInputValue(input, value) {
  if (!input) return;
  
  const tagName = input.tagName?.toUpperCase();
  
  try {
    // Get the appropriate prototype based on element type
    let descriptor = null;
    
    if (tagName === 'INPUT') {
      descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    } else if (tagName === 'TEXTAREA') {
      descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    } else if (tagName === 'SELECT') {
      descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    }
    
    // Use native setter to bypass framework getters/setters
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      // Direct assignment fallback
      input.value = value;
    }
  } catch (e) {
    // If native setter fails, use direct assignment
    try {
      input.value = value;
    } catch (e2) {
    }
  }
  
  // Also set via attribute for some frameworks (but not for select)
  if (tagName !== 'SELECT') {
    try {
      input.setAttribute('value', value);
    } catch (e) {}
  }
  
  // Trigger events
  triggerInputEvents(input);
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
        const optionText = getGoogleFormOptionText(option).toLowerCase();
        const valueNorm = value.toLowerCase().trim();
        if (optionText === valueNorm || optionText.includes(valueNorm) || valueNorm.includes(optionText)) {
          option.click();
          break;
        }
      }
      continue;
    }
    
    // Checkboxes (multiple select) - can have multiple values
    // Look for checkboxes in [role="group"] or standalone
    const checkboxGroup = targetContainer.querySelector('[role="group"]');
    const checkboxOptions = checkboxGroup 
      ? checkboxGroup.querySelectorAll('[role="checkbox"]')
      : targetContainer.querySelectorAll('[role="checkbox"]');
    
    if (checkboxOptions.length > 0) {
      const valuesToCheck = value.split(',').map(v => v.trim().toLowerCase());
      for (const option of checkboxOptions) {
        const optionText = getGoogleFormOptionText(option).toLowerCase();
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
    
    // Linear scale (1-5, 1-10 ratings)
    const linearScale = targetContainer.querySelector('[role="radiogroup"]');
    if (linearScale) {
      const scaleOptions = linearScale.querySelectorAll('[role="radio"]');
      const valueNum = String(value).trim();
      for (const option of scaleOptions) {
        const optionValue = option.getAttribute('data-value') || option.getAttribute('aria-label') || option.innerText?.trim();
        if (optionValue === valueNum) {
          option.click();
          break;
        }
      }
      continue;
    }
    
    // File upload - Google Forms file uploads cannot be filled programmatically
    // They require user interaction due to browser security
    const fileUpload = targetContainer.querySelector(
      '[data-file-upload], ' +
      '[aria-label*="file" i], ' +
      '[aria-label*="upload" i], ' +
      'button[aria-label*="Add file" i]'
    );
    if (fileUpload) {
      // We can't programmatically fill file uploads in Google Forms
      // The user must manually click and select the file
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
    } catch (err) {
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
  /* AutoFill AI on-page UI. Everything is reset first so host-page CSS can't leak in. */
  .autofill-enhance-btn,
  .autofill-enhance-btn :where(*:not(svg, svg *)),
  .autofill-enhance-modal,
  .autofill-enhance-modal :where(*:not(svg, svg *)),
  .autofill-enhance-toast,
  .autofill-enhance-toast :where(*:not(svg, svg *)) {
    all: unset;
    box-sizing: border-box;
  }

  .autofill-enhance-btn,
  .autofill-enhance-modal,
  .autofill-enhance-toast {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    color: #0f1b3d;
    line-height: 1.4;
  }

  .autofill-enhance-modal svg, .autofill-enhance-btn svg, .autofill-enhance-toast svg { display: block; }

  /* ── Floating button ── */
  .autofill-enhance-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2147483000;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px 0 9px;
    background: #0f1b3d;
    color: #ffffff;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.005em;
    cursor: pointer;
    box-shadow: 0 6px 18px -6px rgba(15, 27, 61, 0.45);
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.2s;
  }
  .autofill-enhance-btn.visible { opacity: 1; transform: none; pointer-events: auto; }
  .autofill-enhance-btn:hover { background: #1c2c5c; }
  .autofill-enhance-btn:active { transform: scale(0.97); }
  .autofill-enhance-btn:focus-visible { outline: 2px solid #c9d3f8; outline-offset: 2px; }
  .autofill-enhance-btn:disabled { cursor: progress; opacity: 1; }
  .autofill-enhance-btn svg { width: 14px; height: 14px; color: #c9d3f8; }
  .autofill-enhance-label { display: inline; color: #ffffff; }

  @keyframes autofill-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .autofill-enhance-btn .spinner { animation: autofill-spin 0.9s linear infinite; }

  /* ── Modal ── */
  .autofill-enhance-modal {
    position: fixed;
    inset: 0;
    z-index: 2147483001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(15, 27, 61, 0.38);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease;
  }
  .autofill-enhance-modal.visible { opacity: 1; visibility: visible; }

  .autofill-enhance-modal-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 540px;
    max-height: 84vh;
    overflow: hidden;
    background: #fbfaf7;
    border-radius: 18px;
    box-shadow: 0 40px 80px -30px rgba(15, 27, 61, 0.45);
    transform: translateY(12px) scale(0.98);
    transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .autofill-enhance-modal.visible .autofill-enhance-modal-content { transform: none; }

  .autofill-enhance-modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 22px 6px;
  }
  .autofill-enhance-modal-header h3 {
    display: block;
    font-family: "Newsreader", "Iowan Old Style", Georgia, serif;
    font-size: 26px;
    font-weight: 300;
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: #0f1b3d;
  }
  .autofill-enhance-modal-sub { display: block; padding: 0 22px 16px; font-size: 13px; color: #3b4668; }

  .autofill-enhance-modal-body {
    display: block;
    padding: 0 22px;
    overflow-y: auto;
  }
  .autofill-enhance-section { display: block; margin-bottom: 12px; }
  .autofill-enhance-section-label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: #3b4668;
  }
  .autofill-enhance-section-text {
    display: block;
    max-height: 30vh;
    overflow-y: auto;
    padding: 12px 14px;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: inset 0 0 0 1px #e8e5de;
    font-size: 13.5px;
    line-height: 1.55;
    color: #3b4668;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .autofill-enhance-section-text.improved {
    background: #eceffc;
    box-shadow: none;
    color: #0f1b3d;
  }

  .autofill-enhance-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 22px 20px;
  }
  .autofill-enhance-modal-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 16px;
    border-radius: 10px;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    background: #ffffff;
    color: #0f1b3d;
    box-shadow: inset 0 0 0 1px #e8e5de;
    transition: background-color 0.2s, box-shadow 0.2s;
  }
  .autofill-enhance-modal-btn:hover { box-shadow: inset 0 0 0 1px #d3cfc5; }
  .autofill-enhance-modal-btn:focus-visible { outline: 2px solid #0f1b3d; outline-offset: 2px; }
  .autofill-enhance-modal-btn.primary { background: #0f1b3d; color: #ffffff; box-shadow: none; }
  .autofill-enhance-modal-btn.primary:hover { background: #1c2c5c; }

  /* ── Toast (replaces alert()) ── */
  .autofill-enhance-toast {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483002;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 360px;
    padding: 12px 14px;
    border-radius: 12px;
    background: #0f1b3d;
    color: #ffffff;
    font-size: 13px;
    box-shadow: 0 20px 40px -16px rgba(15, 27, 61, 0.5);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .autofill-enhance-toast.visible { opacity: 1; transform: none; }
  .autofill-enhance-toast span { display: block; color: #ffffff; line-height: 1.45; }

  /* Hold our look even when a site styles buttons/svgs with !important */
  .autofill-enhance-btn {
    background: #0f1b3d !important; color: #ffffff !important; border: 0 !important;
    height: 28px !important; padding: 0 11px 0 9px !important; margin: 0 !important;
    font-size: 12px !important; border-radius: 8px !important;
    box-shadow: 0 6px 18px -6px rgba(15, 27, 61, 0.45) !important;
  }
  .autofill-enhance-btn:hover { background: #1c2c5c !important; }
  .autofill-enhance-btn svg { width: 14px !important; height: 14px !important; flex-shrink: 0; }
  .autofill-enhance-modal-header svg { width: 30px !important; height: 30px !important; flex-shrink: 0; }
  .autofill-enhance-modal-btn {
    background: #ffffff !important; color: #0f1b3d !important; border: 0 !important;
    height: 40px !important; padding: 0 16px !important; margin: 0 !important;
    font-size: 13.5px !important; border-radius: 10px !important;
    box-shadow: inset 0 0 0 1px #e8e5de !important;
  }
  .autofill-enhance-modal-btn:hover { box-shadow: inset 0 0 0 1px #d3cfc5 !important; }
  .autofill-enhance-modal-btn.primary { background: #0f1b3d !important; color: #ffffff !important; box-shadow: none !important; }
  .autofill-enhance-modal-btn.primary:hover { background: #1c2c5c !important; }

  @media (prefers-reduced-motion: reduce) {
    .autofill-enhance-btn, .autofill-enhance-modal, .autofill-enhance-modal-content, .autofill-enhance-toast { transition: none; }
    .autofill-enhance-btn .spinner { animation: none; }
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
  btn.type = 'button';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/></svg><span class="autofill-enhance-label">Improve</span>`;
  btn.addEventListener('click', handleEnhanceClick);
  document.body.appendChild(btn);
  enhanceButton = btn;
  return btn;
}

function createEnhanceModal() {
  if (enhanceModal) return enhanceModal;
  
  const modal = document.createElement('div');
  modal.className = 'autofill-enhance-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Improve with AI');
  modal.innerHTML = `
    <div class="autofill-enhance-modal-content">
      <div class="autofill-enhance-modal-header">
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="#0f1b3d"/>
          <rect x="7.5" y="8.5" width="17" height="3.2" rx="1.6" fill="#fff"/>
          <rect x="7.5" y="14.4" width="12.5" height="3.2" rx="1.6" fill="#fff"/>
          <rect x="7.5" y="20.3" width="6.5" height="3.2" rx="1.6" fill="#c9d3f8"/>
          <rect x="16" y="19.1" width="1.8" height="5.6" rx="0.9" fill="#c9d3f8"/>
        </svg>
        <h3>Improve with AI</h3>
      </div>
      <div class="autofill-enhance-modal-sub">Review the suggestion, then replace your text or keep the original.</div>
      <div class="autofill-enhance-modal-body">
        <div class="autofill-enhance-section">
          <div class="autofill-enhance-section-label">Your text</div>
          <div class="autofill-enhance-section-text" id="autofill-original-text"></div>
        </div>
        <div class="autofill-enhance-section">
          <div class="autofill-enhance-section-label">Suggested</div>
          <div class="autofill-enhance-section-text improved" id="autofill-improved-text"></div>
        </div>
      </div>
      <div class="autofill-enhance-modal-footer">
        <button type="button" class="autofill-enhance-modal-btn" id="autofill-enhance-cancel">Keep original</button>
        <button type="button" class="autofill-enhance-modal-btn primary" id="autofill-enhance-replace">Replace text</button>
      </div>
    </div>
  `;

  // Escape closes the dialog
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      hideEnhanceModal(true);
    }
  });
  
  // Backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideEnhanceModal(true);
    }
  });
  
  // Cancel button
  const cancelBtn = modal.querySelector('#autofill-enhance-cancel');
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideEnhanceModal(true);
  });
  
  // Replace button
  const replaceBtn = modal.querySelector('#autofill-enhance-replace');
  replaceBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
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
  
  // Show button - works for both empty fields (generate) and filled fields (enhance)
  const value = textarea.value || textarea.innerText || '';
  btn.classList.add('visible');
  btn.style.opacity = '';
  const label = btn.querySelector('.autofill-enhance-label');
  if (value.trim().length >= 15) {
    btn.title = 'Improve this text with AI';
    if (label) label.textContent = 'Improve';
  } else {
    btn.title = 'Generate text with AI';
    if (label) label.textContent = 'Write';
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
  
  modal.querySelector('#autofill-original-text').textContent = original;
  modal.querySelector('#autofill-improved-text').textContent = improved;
  const isDraft = original === '(empty field)';
  modal.querySelector('h3').textContent = isDraft ? 'Write with AI' : 'Improve with AI';
  modal.querySelector('#autofill-enhance-replace').textContent = isDraft ? 'Use this text' : 'Replace text';
  
  modal.classList.add('visible');
  setTimeout(() => modal.querySelector('#autofill-enhance-replace')?.focus(), 50);
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
let enhanceToastTimer = null;

function showEnhanceToast(message) {
  injectEnhanceStyles();
  let toast = document.querySelector('.autofill-enhance-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'autofill-enhance-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<span></span>';
    document.body.appendChild(toast);
  }
  toast.querySelector('span').textContent = message;
  requestAnimationFrame(() => toast.classList.add('visible'));
  clearTimeout(enhanceToastTimer);
  enhanceToastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
}

async function handleEnhanceClick(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!currentEnhanceTarget) return;
  
  // IMPORTANT: Store the target immediately before any async operations
  const targetElement = currentEnhanceTarget;
  const text = targetElement.value || targetElement.innerText || '';
  const isEmptyField = text.trim().length < 15;
  
  const btn = enhanceButton;
  const originalHtml = btn.innerHTML;
  
  try {
    btn.disabled = true;
    btn.innerHTML = `<svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg><span class="autofill-enhance-label">${isEmptyField ? 'Writing…' : 'Improving…'}</span>`;
    
    // Get field label for context
    let fieldLabel = '';
    const id = targetElement.id;
    if (id) {
      fieldLabel = document.querySelector(`label[for="${id}"]`)?.innerText || '';
    }
    if (!fieldLabel) {
      fieldLabel = targetElement.getAttribute('aria-label') || 
                   targetElement.placeholder || 
                   targetElement.name ||
                   'Text field';
    }
    
    // Send message to background script to call API (background can bypass CORS)
    let response;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        response = await chrome.runtime.sendMessage({
          type: isEmptyField ? 'GENERATE_TEXT' : 'ENHANCE_TEXT',
          data: {
            text: isEmptyField ? '' : text,
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
    
    const enhanced = response.enhanced || response.generated;
    if (!enhanced) {
      throw new Error('No text returned');
    }
    
    // Store both the text and target for the modal
    pendingEnhancedText = enhanced;
    pendingEnhanceTarget = targetElement; // Set it here directly!
    
    showEnhanceModal(isEmptyField ? '(empty field)' : text, enhanced);
    
  } catch (err) {
    showEnhanceToast((isEmptyField ? "Couldn't write text: " : "Couldn't improve text: ") + (err.message || 'Unknown error'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function applyEnhancedText() {
  
  if (!pendingEnhanceTarget) {
    showEnhanceToast('Lost track of the text field. Please try again.');
    hideEnhanceModal(true);
    return;
  }
  
  if (!pendingEnhancedText) {
    showEnhanceToast('No suggested text available. Please try again.');
    hideEnhanceModal(true);
    return;
  }
  
  const el = pendingEnhanceTarget;
  const textToApply = pendingEnhancedText;
  
  try {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Use native setter for React/Vue compatibility
      const prototype = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, textToApply);
      } else {
        el.value = textToApply;
      }
    } else if (el.isContentEditable) {
      el.innerText = textToApply;
    }
    
    // Trigger events to notify frameworks
    const eventOptions = { bubbles: true, cancelable: true };
    el.dispatchEvent(new Event('input', eventOptions));
    el.dispatchEvent(new Event('change', eventOptions));
    el.dispatchEvent(new FocusEvent('focus', eventOptions));
    el.dispatchEvent(new FocusEvent('blur', eventOptions));
    
    
    // Hide modal and clear state
    hideEnhanceModal(false);
    pendingEnhancedText = '';
    pendingEnhanceTarget = null;
    
  } catch (err) {
    showEnhanceToast("Couldn't apply the text: " + err.message);
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
  
  // Update button tooltip based on text length
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el === currentEnhanceTarget && enhanceButton) {
      const value = el.value || el.innerText || '';
      if (value.trim().length >= 15) {
        enhanceButton.title = 'Improve this text with AI';
      } else {
        enhanceButton.title = 'Generate text with AI';
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
    initEnhanceListeners();
  });
} else {
  initEnhanceListeners();
}

// Make them available globally in the content script context
window.extractFields = extractFields;
window.fillForm = fillForm;
window.fillFileInputs = fillFileInputs;
window.undoFill = undoFill;
window.extractEnhanceableFields = extractEnhanceableFields;
window.setFieldValue = setFieldValue;
