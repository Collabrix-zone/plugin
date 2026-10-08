import { kv } from "@vercel/kv";

const FREE_TIER_LIMIT = 10;
const IS_LOCAL = process.env.LOCAL_DEV === "true";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-figma-user-id, x-collabrix-license");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use GET" });
  }

  if (IS_LOCAL) {
    return res.status(200).json({
      valid: true,
      plan: "free",
      generationsUsed: 0,
      generationsLimit: 999,
      percentUsed: 0,
      daysLeft: 30,
      message: "Local Dev · Unlimited generations",
    });
  }

  try {
    const licenseKey = req.headers["x-collabrix-license"];
    const figmaUserId = req.headers["x-figma-user-id"] || "anonymous";

    if (licenseKey) {
      return await checkProLicense(licenseKey, res);
    }

    return await checkFreeTier(figmaUserId, res);
  } catch (err) {
    console.error("License check error:", err);
    return res.status(500).json({ valid: false, error: "INTERNAL_ERROR", message: "Something went wrong." });
  }
}

async function checkProLicense(licenseKey, res) {
  const license = await kv.get(`license:${licenseKey}`);

  if (!license) {
    return res.status(200).json({
      valid: false,
      error: "INVALID_LICENSE",
      message: "This license key isn't valid. Check it and try again.",
    });
  }

  const now = new Date();
  const expiresAt = new Date(license.expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
  const percentUsed = Math.round((license.generationsUsed / license.generationsLimit) * 1000) / 10;

  if (license.status !== "active") {
    return res.status(200).json({
      valid: false,
      plan: "pro",
      error: license.status === "expired" ? "LICENSE_EXPIRED" : "LICENSE_INACTIVE",
      generationsUsed: license.generationsUsed,
      generationsLimit: license.generationsLimit,
      percentUsed,
      expiresAt: license.expiresAt,
      daysLeft,
      message: license.status === "expired"
        ? "Your license has expired. Please renew."
        : "Your subscription is inactive. Please reactivate.",
    });
  }

  return res.status(200).json({
    valid: true,
    plan: "pro",
    generationsUsed: license.generationsUsed,
    generationsLimit: license.generationsLimit,
    percentUsed,
    expiresAt: license.expiresAt,
    daysLeft,
    message: `Pro Plan · ${license.generationsUsed} of ${license.generationsLimit} generations used`,
  });
}

async function checkFreeTier(figmaUserId, res) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const kvKey = `free:${figmaUserId}:${currentMonth}`;
  const usage = await kv.get(kvKey);

  const generationsUsed = usage?.generationsUsed || 0;
  const percentUsed = Math.round((generationsUsed / FREE_TIER_LIMIT) * 1000) / 10;

  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysLeft = Math.ceil((endOfMonth - now) / (1000 * 60 * 60 * 24));

  return res.status(200).json({
    valid: generationsUsed < FREE_TIER_LIMIT,
    plan: "free",
    generationsUsed,
    generationsLimit: FREE_TIER_LIMIT,
    percentUsed,
    daysLeft,
    message: `Free Plan · ${generationsUsed} of ${FREE_TIER_LIMIT} generations used`,
  });
}
