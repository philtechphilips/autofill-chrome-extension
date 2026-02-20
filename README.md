# Autofill.Ai – Browser Extension

Chrome extension that detects form fields on any page and fills them with AI-generated or profile-based values. Supports preview-before-fill, “fill only empty” fields, and reusable profiles (personas).

## Features

- **AI fill** – Sends field labels and page context to your backend; values are generated and shown in a preview.
- **Preview before filling** – Review and edit suggested values before applying them to the form.
- **Fill only empty** – Option to generate values only for empty fields; already-filled fields are left as-is.
- **Profiles (personas)** – Save name, email, phone, company, role, etc. Use “Profile only” or “Profile + AI for rest.”
- **Save AI as profile** – From the preview step, save the current AI response as a new profile.
- **Richer context** – Sends page URL, page title, and form purpose so the AI can return more relevant values.
- **Privacy notice** – First-use notice that form labels and context are sent to an AI service; no data stored by the extension beyond local profile storage.

## Requirements

- **Chrome** (or a Chromium-based browser that supports Manifest V3 extensions).
- **Backend** – The [autofill-be](../autofill-be) server must be running and reachable (default: `http://localhost:9000`).

## Installation

1. **Load the extension (unpacked)**
   - Open Chrome → **Extensions** → **Manage Extensions** → **Load unpacked**.
   - Select the `autofill-extention` folder (the one containing `manifest.json`).

2. **Start the backend**
   - From the project root, go into the backend and run it (see [autofill-be README](../autofill-be/README.md)):
     ```bash
     cd autofill-be && npm run dev
     ```
   - Ensure it listens on the port the extension uses (default **9000**).

3. **Pin the extension** (optional) – Click the puzzle icon and pin “Autofill.Ai”.

## Configuration

- **Backend URL** – In `popup.js`, `BACKEND_URL` is set to `http://localhost:9000`. Change it if your backend runs elsewhere (host/port).
- **Privacy policy link** – Set `PRIVACY_POLICY_URL` in `popup.js` to your policy URL (e.g. backend `/privacy` or your site). Leave `""` to hide the link.

## Usage

1. Open a page that contains a form.
2. Click the Autofill.Ai extension icon.
3. Choose **Fill mode**: “Fill all” or “Fill only empty.”
4. Optionally choose a **Profile** and mode: “Profile only” or “Profile + AI for rest.”
5. Click **Execute Autofill**.
6. In the **Preview**, review (and edit) values, then:
   - **Fill form** – Apply values to the page.
   - **Save as profile** – Save the current values as a new profile (prompt for name).
   - **Cancel** – Close preview without filling.

**Manage profiles** – Click “Manage profiles” to add, edit, or delete profiles. Data is stored locally in the browser (`chrome.storage.local`).

## Project structure

```
autofill-extention/
├── manifest.json   # Extension manifest (MV3)
├── popup.html     # Popup UI
├── popup.js       # Popup logic (profiles, preview, API calls)
├── content.js     # Injected script: extractFields(), fillForm()
└── README.md
```

## Permissions

- **activeTab** – Access the current tab when the user invokes the extension.
- **scripting** – Run `content.js` in the tab to extract fields and fill the form.
- **storage** – Store profiles and privacy-notice dismissal locally.
- **host_permissions: &lt;all_urls&gt;** – Inject the content script and call the backend from any page (backend URL is configurable in code).

## Privacy

- Form **labels**, **page URL**, **page title**, and **form context** are sent to your backend (and from there to the AI provider). Field **values** you type are only sent when “Fill only empty” is used (as `currentValue` for empty vs non-empty).
- **Profiles** are stored only in your browser (`chrome.storage.local`); they are not sent to any server except as part of a fill (to your backend, when using “Profile + AI for rest” or when the backend uses profile data).
- The first-use notice explains that data is sent to an AI service and that “no data is stored by us” (the extension does not store form data on a server).

## License

ISC (or as specified in the project).
