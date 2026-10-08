import { validateLicense } from "./lib/license-validator.js";

const MAX_TOKENS = 8192;
const IS_LOCAL = process.env.LOCAL_DEV === "true";

const PROVIDERS = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-6",
    getHeaders: (key) => ({
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    buildBody: (model, maxTokens, systemPrompt, userMessage) => ({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    extractCode: (result) => result.content?.[0]?.text || "",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
    getHeaders: (key) => ({
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    buildBody: (model, maxTokens, systemPrompt, userMessage) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    extractCode: (result) => result.choices?.[0]?.message?.content || "",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    model: "gemini-2.0-flash",
    getHeaders: (key) => ({
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    }),
    buildBody: (model, maxTokens, systemPrompt, userMessage) => ({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extractCode: (result) => result.candidates?.[0]?.content?.parts?.[0]?.text || "",
  },
};

function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: "anthropic", key: process.env.ANTHROPIC_API_KEY };
  if (process.env.OPENAI_API_KEY) return { name: "openai", key: process.env.OPENAI_API_KEY };
  if (process.env.GEMINI_API_KEY) return { name: "gemini", key: process.env.GEMINI_API_KEY };
  return null;
}

const LANGUAGE_INSTRUCTIONS = {
  react: "Use functional components with hooks. Use styled-components or inline styles.",
  html: "Use a single HTML file with a `<style>` block. Use CSS Grid and Flexbox.",
  angular: "Use Angular component syntax with PrimeNG UI components where appropriate.",
  flutter: "Use Flutter widgets. Output a complete StatelessWidget.",
  swiftui: "Use SwiftUI views. Output a complete View struct.",
};

function buildSystemPrompt(language, options, skeletonHTML) {
  const lines = [
    `You are an expert frontend developer and pixel-perfect UI engineer. You will receive:`,
    `1. Raw Figma design data (JSON) with exact node positions, colours, fonts, and layout properties`,
    `2. A structural HTML skeleton generated from that data`,
    ``,
    `Your job: produce a SINGLE, complete, production-ready HTML file that looks exactly like the Figma design.`,
    ``,
    `CRITICAL RULES:`,
    `- Output ONLY raw code. No markdown fences, no explanations, no preamble — just the HTML.`,
    `- The skeleton shows the correct element hierarchy and nesting. Use it as your structural reference.`,
    `- For the overall page layout, use CSS Grid on the body/container to create the proper grid structure (e.g. sidebar + content areas). Do NOT use position:absolute for major layout sections.`,
    `- Convert Figma auto-layout (layoutMode: VERTICAL/HORIZONTAL) to CSS flexbox.`,
    `- For colours: r, g, b values are floats 0-1. Convert: multiply by 255, then to hex. Example: r:0.165, g:0.267, b:0.831 → #2A44D4.`,
    `- Use the EXACT dimensions, padding, gap, border-radius, font-size, font-weight, and colours from the data.`,
    `- For VECTOR/icon nodes: use appropriate unicode symbols, emoji, or simple inline SVGs. Never leave empty divs.`,
    `- Include Google Fonts imports for any custom fonts found in the data.`,
    `- Extract colours into CSS custom properties in :root.`,
    `- Make all interactive elements (buttons, links, nav items) have cursor:pointer and hover states with smooth transitions.`,
    `- The output must be a complete, self-contained HTML file that renders correctly when opened in a browser.`,
  ];

  if (options.responsive) lines.push("- Add responsive media queries for mobile (max-width: 768px) and tablet (max-width: 1024px).");
  if (options.comments) lines.push("- Add brief comments for major sections.");
  if (options.interactive) lines.push("- Add hover effects, focus states, and click handlers on interactive elements. Make nav items highlight on hover. Add keyboard navigation support.");

  if (LANGUAGE_INSTRUCTIONS[language]) {
    lines.push(`- ${LANGUAGE_INSTRUCTIONS[language]}`);
  }

  return lines.join("\n");
}

function buildUserMessage(language, nodeData, skeletonHTML) {
  let msg = `Convert this Figma design to ${language} code.\n\n`;
  msg += `## Figma Design Data:\n${JSON.stringify(nodeData, null, 2)}\n\n`;
  if (skeletonHTML) {
    msg += `## Structural HTML Skeleton (use as reference for hierarchy):\n${skeletonHTML}\n`;
  }
  return msg;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-figma-user-id, x-collabrix-license");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  try {
    const provider = detectProvider();
    if (!provider) {
      console.error("No AI API key configured");
      return res.status(500).json({
        error: "GENERATION_FAILED",
        message: "Code generation is not configured. Contact support@collabrix.zone",
      });
    }

    const { nodeData, language, options, licenseKey, figmaUserId, skeletonHTML } = req.body;

    if (!nodeData) {
      return res.status(400).json({ error: "NO_SELECTION", message: "No design data provided." });
    }

    let validation;
    if (IS_LOCAL) {
      validation = { valid: true, plan: "free", generationsUsed: 1, generationsLimit: 999 };
    } else {
      validation = await validateLicense(licenseKey || null, figmaUserId || "anonymous");
    }

    if (!validation.valid) {
      return res.status(validation.status).json({
        error: validation.error,
        message: getErrorMessage(validation.error),
      });
    }

    const lang = language || "html";
    const systemPrompt = buildSystemPrompt(lang, options || {}, skeletonHTML);
    const userMessage = buildUserMessage(lang, nodeData, skeletonHTML);

    const config = PROVIDERS[provider.name];
    const response = await fetch(config.url, {
      method: "POST",
      headers: config.getHeaders(provider.key),
      body: JSON.stringify(config.buildBody(config.model, MAX_TOKENS, systemPrompt, userMessage)),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`${provider.name} API error:`, response.status, errBody);
      return res.status(502).json({
        error: "GENERATION_FAILED",
        message: "Code generation failed. Try again or contact support@collabrix.zone",
      });
    }

    const result = await response.json();
    let code = config.extractCode(result);

    // Strip markdown fences if the model wrapped the output
    code = code.replace(/^```[\w]*\n?/, "").replace(/\n?```\s*$/, "").trim();

    return res.status(200).json({
      code,
      language: language || "react",
      usage: {
        used: validation.generationsUsed,
        limit: validation.generationsLimit,
      },
    });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({
      error: "GENERATION_FAILED",
      message: "Code generation failed. Try again or contact support@collabrix.zone",
    });
  }
}

function getErrorMessage(errorCode) {
  const messages = {
    FREE_QUOTA_EXCEEDED: "You've used all 10 free generations this month. Upgrade to Pro for 200/month.",
    QUOTA_EXCEEDED: "You've used all 200 Pro generations this month. Resets on the 1st.",
    INVALID_LICENSE: "This license key isn't valid. Check it and try again.",
    LICENSE_INACTIVE: "Your subscription is inactive. Please reactivate.",
    LICENSE_EXPIRED: "Your license has expired. Please renew.",
  };
  return messages[errorCode] || "An unexpected error occurred.";
}
