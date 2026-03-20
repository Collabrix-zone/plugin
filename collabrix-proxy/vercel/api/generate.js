import { validateLicense } from "./lib/license-validator.js";

const MAX_TOKENS = 4096;

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

function buildSystemPrompt(language, options) {
  const lines = [
    `You are an expert frontend developer. Convert the provided Figma design data into clean, production-ready ${language} code. Follow these rules:`,
    "- Use the exact colours, typography, spacing, and layout from the design data",
    "- Output ONLY the code, no explanations or markdown fences",
  ];

  if (options.responsive) lines.push("- Make the layout fully responsive");
  if (options.comments) lines.push("- Add concise comments explaining key sections");
  if (options.designTokens) lines.push("- Extract colours and spacing into CSS variables or design tokens");
  if (options.animations) lines.push("- Include CSS transitions for hover states and interactions");
  if (options.accessibility) lines.push("- Add ARIA labels, roles, and semantic HTML");
  if (options.prototypeFlows) lines.push("- Include onClick handlers based on prototype interactions in the data");

  if (LANGUAGE_INSTRUCTIONS[language]) {
    lines.push(`- ${LANGUAGE_INSTRUCTIONS[language]}`);
  }

  return lines.join("\n");
}

export default async function handler(req, res) {
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

    const { nodeData, language, options, licenseKey, figmaUserId } = req.body;

    if (!nodeData) {
      return res.status(400).json({ error: "NO_SELECTION", message: "No design data provided." });
    }

    const validation = await validateLicense(licenseKey || null, figmaUserId || "anonymous");

    if (!validation.valid) {
      return res.status(validation.status).json({
        error: validation.error,
        message: getErrorMessage(validation.error),
      });
    }

    const systemPrompt = buildSystemPrompt(language || "react", options || {});
    const userMessage = `Convert this Figma design to ${language || "react"} code:\n${JSON.stringify(nodeData, null, 2)}`;

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
    const code = config.extractCode(result);

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
