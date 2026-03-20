# Collabrix — Claude Code Master Build Brief
## Figma → Code Plugin · Full Build + Razorpay Billing
**Version:** 2.0 · **Date:** 2026-03-20 · **Owner:** Divyansh, Collabrix Zone Pvt. Ltd.

> Paste this entire file into Claude Code at the start of your session. Read it fully before writing a single line of code.

---

## 0. What You Are Building

The **Collabrix Figma → Code plugin** is a published Figma Community plugin. It reads a selected Figma frame or component, serialises the full design tree, sends it to a Claude AI proxy, and returns clean production-ready code in the user's chosen language.

**Supported output targets:** React/JSX · HTML+CSS · Angular+PrimeNG · Flutter · SwiftUI

**Generation options users can toggle:** Responsive layout · Code comments · Design tokens · CSS animations · Accessibility attributes · Prototype flow logic

**Business model (as of this build):**
- **Free tier:** 10 generations/month, tracked by Figma user ID, no sign-up required
- **Pro tier:** 200 generations/month, Razorpay subscription (₹499/month), access via license key
- Users **never** enter an Anthropic API key — all AI calls go through the Collabrix proxy

---

## 1. Authoritative File & Folder Structure

Create this exact structure. Do not deviate.

```
collabrix-figma-plugin/
│
├── figma-to-code-plugin/          ← Submit this folder to Figma Community
│   ├── manifest.json              ← Plugin config (name, permissions, network allowlist)
│   ├── code.js                    ← Figma sandbox: node serialiser + proxy router
│   ├── ui.html                    ← Plugin UI: settings, language picker, code output
│   └── README.md                  ← Setup and usage guide
│
├── collabrix-proxy/               ← Vercel backend (deploy this)
│   └── vercel/
│       └── api/
│           ├── generate.js        ← Main code generation endpoint
│           ├── license-check.js   ← Read-only license + quota status
│           ├── razorpay-webhook.js ← Razorpay event handler
│           └── lib/
│               └── license-validator.js  ← Shared quota/license logic
│
├── collabrix-publish/             ← Figma Community submission assets (do not modify)
│   ├── icon_512.png
│   ├── icon_128.png
│   ├── cover_1920x960.png
│   ├── listing-copy.md
│   ├── publisher-profile.md
│   └── terms-and-privacy.md
│
└── outputs/                       ← All generated/output files go here only
    ├── backups/                   ← Originals before any edit
    └── checkout.html              ← Razorpay upgrade page
```

---

## 2. Code & Brand Conventions (strictly enforced)

| Rule | Value |
|---|---|
| Language | JavaScript (ES modules where possible) |
| Indentation | 2 spaces |
| Quotes | Double quotes in JS strings |
| Constants | UPPER_SNAKE_CASE |
| Functions | camelCase |
| Filenames | kebab-case |
| Secrets | Never hardcode — always `process.env.VAR_NAME` |
| Brand name | "Collabrix Zone" (full) or "Collabrix" (short) — never "CollabrixZone" |
| Plugin name | "Figma → Code — by Collabrix" (use → not -> or >) |
| Primary colour | `#7B61FF` (purple) |
| Accent colour | `#00D4AA` (teal) |
| Output files | `outputs/` only — never overwrite source files |
| Before editing | Always back up to `outputs/backups/filename.bak` first |
| Filename dates | `YYYY-MM-DD` format |
| Delete files | Never without explicit confirmation |

---

## 3. Environment Variables

Add all of these to Vercel project settings AND a local `.env` (never commit `.env`):

```
ANTHROPIC_API_KEY=sk-ant-...
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
LICENSE_SIGNING_SECRET=...        # generate: openssl rand -hex 32
KV_REST_API_URL=...               # from Vercel KV store "collabrix-quota"
KV_REST_API_TOKEN=...             # from Vercel KV store "collabrix-quota"
```

---

## 4. Build Spec — File by File

---

### 4.1 `figma-to-code-plugin/manifest.json`

```json
{
  "name": "Figma → Code — by Collabrix",
  "id": "collabrix-figma-to-code",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": [
      "https://api.collabrix.zone",
      "https://collabrix.zone"
    ],
    "reasoning": "Sends design data to Collabrix proxy which calls Claude AI to generate code."
  }
}
```

---

### 4.2 `figma-to-code-plugin/code.js`

This runs inside the Figma plugin sandbox. It has access to the Figma API but not the DOM.

**Responsibilities:**
1. Serialise the selected Figma node tree into a structured JSON payload
2. Read settings from `figma.clientStorage` (language, options, license key)
3. Send the payload to the proxy
4. Receive the generated code and pass it to the UI
5. Handle all message passing between sandbox and UI

**Constants at the top:**
```js
const PROXY_URL = "https://api.collabrix.zone/generate"; // update after deploy
const LICENSE_CHECK_URL = "https://api.collabrix.zone/license-check";
const UPGRADE_URL = "https://collabrix.zone/upgrade";
const FREE_TIER_LIMIT = 10;
const PRO_TIER_LIMIT = 200;
```

**Node serialiser — `serializeNode(node)`:**
Extract these properties from every node recursively:
- `id`, `name`, `type`
- `x`, `y`, `width`, `height`
- `fills` (type, color RGBA, opacity, imageRef if image)
- `strokes`, `strokeWeight`, `strokeAlign`
- `effects` (shadows, blurs)
- `cornerRadius` (all 4 corners)
- `opacity`
- `blendMode`
- Typography (if TEXT node): `fontName`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textAlignHorizontal`, `textAlignVertical`, `characters`
- Auto-layout: `layoutMode`, `itemSpacing`, `paddingLeft/Right/Top/Bottom`, `primaryAxisAlignItems`, `counterAxisAlignItems`
- Children: recurse into `node.children` if present
- Prototype interactions: `reactions` array if present

**Message handlers (listen on `figma.ui.onmessage`):**

| Message type | Action |
|---|---|
| `generate` | Serialise selection → call proxy → send `code-result` back to UI |
| `get-settings` | Read `figma.clientStorage` → send `settings` to UI |
| `save-settings` | Write settings to `figma.clientStorage` |
| `save-license` | Save `licenseKey` to `figma.clientStorage` |
| `open-url` | Call `figma.openExternal(msg.url)` |
| `resize` | Call `figma.ui.resize(msg.width, msg.height)` |

**Generate flow:**
```js
// 1. Check selection
const selection = figma.currentPage.selection;
if (selection.length === 0) {
  figma.ui.postMessage({ type: "error", message: "Please select a frame or component first." });
  return;
}

// 2. Serialise
const nodeData = serializeNode(selection[0]);

// 3. Read stored settings
const licenseKey = await figma.clientStorage.getAsync("licenseKey");
const language = await figma.clientStorage.getAsync("language") || "react";
const options = await figma.clientStorage.getAsync("options") || {};

// 4. Post to proxy
const response = await fetch(PROXY_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-figma-user-id": figma.currentUser?.id || "anonymous",
  },
  body: JSON.stringify({
    nodeData,
    language,
    options,
    licenseKey: licenseKey || null,
    figmaUserId: figma.currentUser?.id || "anonymous",
  }),
});

// 5. Handle response
const data = await response.json();
if (!response.ok) {
  figma.ui.postMessage({ type: "error", error: data.error, message: data.message });
  return;
}
figma.ui.postMessage({ type: "code-result", code: data.code, language });
```

---

### 4.3 `figma-to-code-plugin/ui.html`

Single-file plugin UI. Uses inline CSS and vanilla JS only — no external libraries.

**Layout — three panels in a tab bar:**

```
┌──────────────────────────────────────────┐
│  🔷 Figma → Code  — by Collabrix         │
│  [Generate]  [Settings]                  │
├──────────────────────────────────────────┤
│                                          │
│   [GENERATE PANEL or SETTINGS PANEL]     │
│                                          │
└──────────────────────────────────────────┘
```

**Generate Panel (default view):**
```
┌──────────────────────────────────────────┐
│  Output language:                        │
│  [React ▼]  [HTML+CSS] [Angular]         │
│             [Flutter]  [SwiftUI]         │
│                                          │
│  Options:                                │
│  ☑ Responsive   ☑ Comments              │
│  ☑ Design tokens  ☐ Animations          │
│  ☐ Accessibility  ☐ Prototype flows     │
│                                          │
│  [  ✦  Generate Code  ]  ← primary btn  │
│                                          │
│  ─────── Output ───────                  │
│  [                           ] [Copy]   │
│  [   generated code here     ]          │
│  [                           ]          │
└──────────────────────────────────────────┘
```

**Settings Panel:**
```
┌──────────────────────────────────────────┐
│  License Key                             │
│  [CLX-XXXX-XXXX-XXXX      ] [Activate]  │
│  ✅ Pro Plan active                      │
│                                          │
│  This month's usage                      │
│  ████████░░░░░░░░  47 / 200             │
│  Resets in 14 days                       │
│                                          │
│  [Upgrade to Pro →]                      │
└──────────────────────────────────────────┘
```

**Free tier (no license key):**
```
│  Free Plan · 3 / 10 generations used    │
│  ██░░░░░░░░░░░░░░░░░░                   │
│  [Upgrade for 200/month →]              │
```

**Behaviour:**
- On load: `parent.postMessage({ pluginMessage: { type: "get-settings" } }, "*")` then call `/api/license-check` to populate usage bar
- Language selector: clicking one highlights it, saves via `save-settings` message
- Options: checkboxes, persist via `save-settings`
- Generate button: posts `generate` message to sandbox, shows spinner, then displays result
- Copy button: `navigator.clipboard.writeText(code)`, briefly shows "Copied!"
- Activate button: calls `GET /api/license-check` with the typed key as `x-collabrix-license` header; on success saves key via `save-license` message
- Upgrade button: posts `{ type: "open-url", url: "https://collabrix.zone/upgrade" }` message
- Error display: inline red text under the generate button, never a JS `alert()`
- Progress bar: `#7B61FF` fill, `#F0EEFF` background, `border-radius: 4px`, `height: 6px`
- Font: Inter, system-ui fallback
- Plugin window size: 340px wide × 480px tall (send resize on load)
- Dark mode aware: use CSS `prefers-color-scheme` — dark bg `#1E1E2E`, light bg `#FFFFFF`

**Error messages to handle from proxy:**

| Error code | Display to user |
|---|---|
| `FREE_QUOTA_EXCEEDED` | "You've used all 10 free generations this month. [Upgrade →]" |
| `QUOTA_EXCEEDED` | "You've used all 200 Pro generations this month. Resets on the 1st." |
| `INVALID_LICENSE` | "This license key isn't valid. Check it and try again." |
| `LICENSE_INACTIVE` | "Your subscription is inactive. [Reactivate →]" |
| `LICENSE_EXPIRED` | "Your license has expired. [Renew →]" |
| `NO_SELECTION` | "Select a frame or component in Figma first." |
| `GENERATION_FAILED` | "Code generation failed. Try again or contact support@collabrix.zone" |

---

### 4.4 `collabrix-proxy/vercel/api/lib/license-validator.js`

Shared module. Export one function: `validateLicense(licenseKey, figmaUserId)`.

**KV key schema — Pro licenses:**
```
license:{licenseKey}  →  {
  email, razorpaySubId, plan: "pro", status: "active"|"suspended"|"expired",
  generationsUsed, generationsLimit: 200,
  currentPeriodStart, expiresAt, createdAt
}
```

**KV key schema — Free tier:**
```
free:{figmaUserId}:{YYYY-MM}  →  { generationsUsed, month }
```

**KV key schema — Reverse lookup:**
```
sublookup:{razorpaySubId}  →  { licenseKey }
```

**Logic:**
```
if licenseKey provided:
  fetch license:{licenseKey} from KV
  if not found             → { valid: false, error: "INVALID_LICENSE", status: 401 }
  if status !== "active"   → { valid: false, error: "LICENSE_INACTIVE", status: 401 }
  if expiresAt < now       → { valid: false, error: "LICENSE_EXPIRED", status: 401 }
  if used >= limit         → { valid: false, error: "QUOTA_EXCEEDED", status: 429 }
  else                     → increment generationsUsed, return { valid: true, plan: "pro", ... }

else (free tier, use figmaUserId):
  key = "free:{figmaUserId}:{YYYY-MM}"
  fetch from KV (default to { generationsUsed: 0 })
  if used >= FREE_TIER_LIMIT (10) → { valid: false, error: "FREE_QUOTA_EXCEEDED", status: 429 }
  else                            → increment, return { valid: true, plan: "free", ... }
```

Use Vercel KV's atomic `INCR` for the counter. Store the full object separately and update `generationsUsed` field.

---

### 4.5 `collabrix-proxy/vercel/api/generate.js`

Main generation endpoint. `POST /api/generate`.

**Flow:**
1. Parse request body: `{ nodeData, language, options, licenseKey, figmaUserId }`
2. Call `validateLicense(licenseKey, figmaUserId)` → if not valid, return error immediately
3. Build Claude prompt (see prompt spec below)
4. Call Anthropic API:
   - Model: `claude-sonnet-4-6` for free tier, `claude-sonnet-4-6` for pro (same for now, upgrade later)
   - Endpoint: `https://api.anthropic.com/v1/messages`
   - Auth: `Authorization: Bearer ${process.env.ANTHROPIC_API_KEY}`
   - Max tokens: 4096
5. Return `{ code: string, language, usage: { used, limit } }`

**Claude prompt spec:**

System prompt:
```
You are an expert frontend developer. Convert the provided Figma design data into clean,
production-ready ${language} code. Follow these rules:
- Use the exact colours, typography, spacing, and layout from the design data
- Output ONLY the code, no explanations or markdown fences
- ${options.responsive ? "Make the layout fully responsive" : ""}
- ${options.comments ? "Add concise comments explaining key sections" : ""}
- ${options.designTokens ? "Extract colours and spacing into CSS variables or design tokens" : ""}
- ${options.animations ? "Include CSS transitions for hover states and interactions" : ""}
- ${options.accessibility ? "Add ARIA labels, roles, and semantic HTML" : ""}
- ${options.prototypeFlows ? "Include onClick handlers based on prototype interactions in the data" : ""}
```

User message:
```
Convert this Figma design to ${language} code:
${JSON.stringify(nodeData, null, 2)}
```

**Language-specific instructions to append to system prompt:**

| Language | Extra instruction |
|---|---|
| react | "Use functional components with hooks. Use styled-components or inline styles." |
| html | "Use a single HTML file with a `<style>` block. Use CSS Grid and Flexbox." |
| angular | "Use Angular component syntax with PrimeNG UI components where appropriate." |
| flutter | "Use Flutter widgets. Output a complete StatelessWidget." |
| swiftui | "Use SwiftUI views. Output a complete View struct." |

---

### 4.6 `collabrix-proxy/vercel/api/license-check.js`

`GET /api/license-check` — read-only, used by plugin UI on startup.

**Headers accepted:**
- `x-collabrix-license` (optional)
- `x-figma-user-id`

**Response 200:**
```json
{
  "valid": true,
  "plan": "pro",
  "generationsUsed": 47,
  "generationsLimit": 200,
  "percentUsed": 23.5,
  "expiresAt": "2026-04-20",
  "daysLeft": 31,
  "message": "Pro Plan · 47 of 200 generations used"
}
```

Do not increment quota. Return `200` even if license is invalid (just set `valid: false`).

---

### 4.7 `collabrix-proxy/vercel/api/razorpay-webhook.js`

`POST /api/razorpay-webhook`

**Step 1 — Verify signature before any KV write:**
```js
import crypto from "crypto";
const rawBody = await getRawBody(req); // read as Buffer
const signature = req.headers["x-razorpay-signature"];
const expected = crypto
  .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
  return res.status(400).json({ error: "Invalid signature" });
}
```

**Step 2 — Handle events:**

| Event | Action |
|---|---|
| `subscription.activated` | Generate license key → write `license:{key}` to KV → write `sublookup:{subId}` → `console.log({ email, licenseKey })` |
| `subscription.charged` | Look up key via `sublookup:{subId}` → reset `generationsUsed: 0`, update `expiresAt` |
| `subscription.cancelled` | Look up key → set `status: "suspended"` |
| `subscription.completed` | Look up key → set `status: "expired"` |
| `payment.failed` | Look up key → set `status: "suspended"` |

**License key generation:**
```js
function generateLicenseKey(razorpaySubId) {
  const hash = crypto
    .createHmac("sha256", process.env.LICENSE_SIGNING_SECRET)
    .update(razorpaySubId)
    .digest("hex")
    .toUpperCase()
    .slice(0, 12);
  return `CLX-${hash.slice(0,4)}-${hash.slice(4,8)}-${hash.slice(8,12)}`;
}
```

---

### 4.8 `outputs/checkout.html`

Standalone upgrade page. Hosted at `collabrix.zone/upgrade`.

**Design:** Dark `#0D0D1A` background, `#7B61FF` primary, `#00D4AA` accent. Font: Inter via Google Fonts.

**Content:**
- Header: "Collabrix Zone" wordmark
- Plan card:
  - Title: "Pro Plan"
  - Price: "₹499 / month"
  - Subtext: "Billed monthly · Cancel anytime · GST invoice provided"
  - Feature list: 200 generations/month · All 5 code targets (React, HTML, Angular, Flutter, SwiftUI) · Claude Sonnet AI · Responsive + accessible code · Design tokens export · Priority email support
  - CTA button: "Subscribe Now — ₹499/month" (colour `#7B61FF`, white text)
- Footer: "Collabrix Zone Pvt. Ltd. · support@collabrix.zone"

**Razorpay integration:**
```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
const options = {
  key: "YOUR_RAZORPAY_KEY_ID",       // TODO: replace before going live
  amount: 49900,
  currency: "INR",
  name: "Collabrix Zone",
  description: "Figma → Code — Pro Plan",
  subscription_id: "YOUR_SUBSCRIPTION_ID",  // TODO: replace before going live
  prefill: { email: "" },
  theme: { color: "#7B61FF" },
  handler: function(response) {
    document.getElementById("success-msg").style.display = "block";
  }
};
</script>
```

On payment success: show "Your license key will be emailed within a few minutes."

Mark all `YOUR_...` values with `<!-- TODO: replace before going live -->`.

---

### 4.9 `figma-to-code-plugin/README.md`

```markdown
# Figma → Code — by Collabrix

Convert any Figma frame or component to production-ready code in seconds.

## Supported Languages
- React / JSX
- HTML + CSS
- Angular + PrimeNG
- Flutter
- SwiftUI

## Free vs Pro
| | Free | Pro |
|---|---|---|
| Generations/month | 10 | 200 |
| API key required | No | No |
| Price | Free | ₹499/month |

Upgrade at: https://collabrix.zone/upgrade

## Support
support@collabrix.zone
```

---

## 5. Build Order (follow this sequence)

1. Create the full folder structure
2. Build `manifest.json`
3. Build `license-validator.js`
4. Build `generate.js`
5. Build `license-check.js`
6. Build `razorpay-webhook.js`
7. Build `code.js`
8. Build `ui.html`
9. Build `checkout.html` → save to `outputs/`
10. Build `README.md`

---

## 6. Full Testing Checklist

Complete every check before declaring the build done:

**Plugin (Figma sandbox + UI)**
- [ ] Plugin opens at 340×480px, no console errors
- [ ] Language selector saves preference and persists on reopen
- [ ] Options checkboxes save and persist
- [ ] Generate button shows spinner while waiting
- [ ] Generated code appears in output area with Copy button
- [ ] Copy button copies to clipboard and shows "Copied!" for 2 seconds
- [ ] No selection → shows "Select a frame or component first" error inline
- [ ] License key field pre-fills from clientStorage on reopen
- [ ] Activate button calls `/api/license-check` and shows ✅ or ❌ inline
- [ ] Upgrade button opens `collabrix.zone/upgrade` in browser
- [ ] Usage bar reflects numbers returned by `/api/license-check`
- [ ] Dark mode renders correctly

**Proxy — Core**
- [ ] `POST /api/generate` with valid Pro license → returns code, increments counter
- [ ] `POST /api/generate` with no license key → uses free tier, increments free counter
- [ ] Free tier at 10/10 → returns 429 `FREE_QUOTA_EXCEEDED`
- [ ] Pro tier at 200/200 → returns 429 `QUOTA_EXCEEDED`
- [ ] Suspended license → returns 401 `LICENSE_INACTIVE`
- [ ] Expired license → returns 401 `LICENSE_EXPIRED`
- [ ] Invalid license key → returns 401 `INVALID_LICENSE`

**Proxy — Razorpay Webhook**
- [ ] Wrong signature → returns 400, no KV write
- [ ] `subscription.activated` → KV entry created, license key logged to console
- [ ] `subscription.charged` → `generationsUsed` reset to 0
- [ ] `subscription.cancelled` → `status` set to `"suspended"`
- [ ] `subscription.completed` → `status` set to `"expired"`

**Manifest**
- [ ] `manifest.json` name matches exactly: "Figma → Code — by Collabrix"
- [ ] `networkAccess.allowedDomains` includes `https://api.collabrix.zone`
- [ ] `main` → `code.js` exists
- [ ] `ui` → `ui.html` exists
- [ ] `editorType` includes `"figma"`

**No API key leaks**
- [ ] No `anthropicApiKey` field anywhere in UI, `code.js`, or request payloads
- [ ] No `sk-ant-` placeholder text anywhere
- [ ] No BYOK (Bring Your Own Key) UI or logic anywhere

---

## 7. Hard Rules — Never Break These

- Never log or expose `ANTHROPIC_API_KEY`, `RAZORPAY_KEY_SECRET`, or `LICENSE_SIGNING_SECRET`
- Webhook signature verification runs before any KV read or write
- Never deploy to production without Divyansh's explicit confirmation
- Never modify `collabrix-publish/terms-and-privacy.md` or `listing-copy.md` unless explicitly asked
- Never make a git commit without showing the diff and getting confirmation first
- Never delete any file without explicit confirmation
- All output files go in `outputs/` — never overwrite source files in place

---

## 8. Key URLs & Contacts

| Resource | URL / Value |
|---|---|
| Anthropic API | `https://api.anthropic.com/v1/messages` |
| Vercel dashboard | `https://vercel.com/dashboard` |
| Anthropic console | `https://console.anthropic.com` |
| Razorpay dashboard | `https://dashboard.razorpay.com` |
| Figma Community | `https://www.figma.com/community` |
| Plugin upgrade page | `https://collabrix.zone/upgrade` |
| Support email | `support@collabrix.zone` |
| Owner | Divyansh Sharma, Collabrix Zone |
| All deployments | Require Divyansh's approval before proceeding |

---

*Collabrix Zone Pvt. Ltd. · Figma → Code · v1.0.0 · March 2026*
