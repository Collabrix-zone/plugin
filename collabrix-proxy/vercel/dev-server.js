import http from "http";
import { parse } from "url";

const PORT = 3000;

// Load .env.local
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = readFileSync(resolve(__dirname, ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  process.env[key] = val;
}

// Import handlers
const generateMod = await import("./api/generate.js");
const licenseCheckMod = await import("./api/license-check.js");

const generateHandler = generateMod.default;
const licenseCheckHandler = licenseCheckMod.default;

const server = http.createServer(async (req, res) => {
  const { pathname } = parse(req.url, true);

  // Simple body parser for POST
  let body = "";
  if (req.method === "POST") {
    for await (const chunk of req) body += chunk;
    try {
      req.body = JSON.parse(body);
    } catch {
      req.body = {};
    }
  }

  // Minimal res.status().json() shim
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };
  const origEnd = res.end.bind(res);
  res.end = (data) => origEnd(data);

  if (pathname === "/api/generate") {
    await generateHandler(req, res);
  } else if (pathname === "/api/license-check") {
    await licenseCheckHandler(req, res);
  } else {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log(`  POST /api/generate`);
  console.log(`  GET  /api/license-check`);
  console.log(`  Provider: ${process.env.OPENAI_API_KEY ? "OpenAI" : process.env.ANTHROPIC_API_KEY ? "Anthropic" : "NONE"}`);
});
