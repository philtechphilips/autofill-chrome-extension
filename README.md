# Autofill.Ai – Browser Extension

Chrome extension that detects form fields on any page and fills them with AI-generated or profile-based values. Supports preview-before-fill, "fill only empty" fields, and reusable profiles (personas).

## Features

- **AI fill** – Sends field labels and page context to the backend; values are generated and shown in a preview.
- **Preview before filling** – Review and edit suggested values before applying them to the form.
- **Fill only empty** – Option to generate values only for empty fields; already-filled fields are left as-is.
- **Profiles (personas)** – Save name, email, phone, company, role, etc. Use "Profile only" or "Profile + AI for rest."
- **Save AI as profile** – From the preview step, save the current AI response as a new profile.
- **Richer context** – Sends page URL, page title, and form purpose so the AI can return more relevant values.
- **Credit-based billing** – AI operations consume credits from your account. Purchase credits at autofill.live.
- **Authentication required** – Sign in to use AI features and sync profiles across devices.

## Requirements

- **Chrome** (or a Chromium-based browser that supports Manifest V3 extensions).
- **Account** – Sign up at [autofill.live](https://autofill.live) to get credits and use the extension.

## Installation

1. **Load the extension (unpacked)**
   - Open Chrome → **Extensions** → **Manage Extensions** → **Load unpacked**.
   - Select the `autofill-extention` folder (the one containing `manifest.json`).

2. **Sign in**
   - Click the extension icon and sign in with your autofill.live account.
   - New users get free credits on signup!

3. **Pin the extension** (optional) – Click the puzzle icon and pin "Autofill.Ai".

## Configuration

- **Backend URL** – The extension connects to `https://api.autofill.live` by default. For local development, change `BACKEND_URL` in `popup.js` and `background.js`.
- **Privacy policy link** – Set `PRIVACY_POLICY_URL` in `popup.js` to your policy URL. Default is `https://autofill.live/privacy`.

## Usage

1. Open a page that contains a form.
2. Click the Autofill.Ai extension icon.
3. **Sign in** if you haven't already (required for AI features).
4. Check your **credits balance** at the top of the popup.
5. Choose **Fill mode**: "Fill all" or "Fill only empty."
6. Optionally choose a **Profile** and mode: "Profile only" (no credits needed) or "Profile + AI for rest."
7. Click **Execute Autofill**.
8. In the **Preview**, review (and edit) values, then:
   - **Fill form** – Apply values to the page.
   - **Save as profile** – Save the current values as a new profile (prompt for name).
   - **Cancel** – Close preview without filling.

**Manage profiles** – Click "Manage profiles" to add, edit, or delete profiles. Data is stored locally and can be synced to the cloud.

**Buy credits** – Click "Buy more" in the credits display or visit [autofill.live/dashboard/billing](https://autofill.live/dashboard/billing).

## Project structure

```
autofill-extention/
├── manifest.json   # Extension manifest (MV3)
├── popup.html      # Popup UI
├── popup.js        # Popup logic (profiles, preview, API calls, auth)
├── background.js   # Service worker (keyboard shortcuts, API calls)
├── content.js      # Injected script: extractFields(), fillForm()
├── crypto.js       # Encryption utilities for profile sync
└── README.md
```

## Permissions

- **activeTab** – Access the current tab when the user invokes the extension.
- **scripting** – Run `content.js` in the tab to extract fields and fill the form.
- **storage** – Store profiles, auth state, and credits cache locally.
- **host_permissions: <all_urls>** – Inject the content script and call the backend from any page.

## Privacy

- Form **labels**, **page URL**, **page title**, and **form context** are sent to the backend (and from there to the AI provider). Field **values** you type are only sent when "Fill only empty" is used (as `currentValue` for empty vs non-empty).
- **Profiles** are stored in your browser (`chrome.storage.local`) and can optionally be synced to the cloud (encrypted).
- **Authentication** is required to use AI features. Your account is managed at autofill.live.
- **Credits** are consumed for AI operations (form analysis, CV parsing, text enhancement).

## License

ISC (or as specified in the project).
