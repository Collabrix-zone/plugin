import { kv } from "@vercel/kv";

const FREE_TIER_LIMIT = 10;

export async function validateLicense(licenseKey, figmaUserId) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (licenseKey) {
    return validateProLicense(licenseKey, now);
  }

  return validateFreeTier(figmaUserId, currentMonth);
}

async function validateProLicense(licenseKey, now) {
  const kvKey = `license:${licenseKey}`;
  const license = await kv.get(kvKey);

  if (!license) {
    return { valid: false, error: "INVALID_LICENSE", status: 401 };
  }

  if (license.status !== "active") {
    const errorMap = {
      "suspended": "LICENSE_INACTIVE",
      "expired": "LICENSE_EXPIRED",
    };
    return {
      valid: false,
      error: errorMap[license.status] || "LICENSE_INACTIVE",
      status: 401,
    };
  }

  if (new Date(license.expiresAt) < now) {
    await kv.set(kvKey, { ...license, status: "expired" });
    return { valid: false, error: "LICENSE_EXPIRED", status: 401 };
  }

  if (license.generationsUsed >= license.generationsLimit) {
    return { valid: false, error: "QUOTA_EXCEEDED", status: 429 };
  }

  const updated = { ...license, generationsUsed: license.generationsUsed + 1 };
  await kv.set(kvKey, updated);

  return {
    valid: true,
    plan: "pro",
    generationsUsed: updated.generationsUsed,
    generationsLimit: license.generationsLimit,
    expiresAt: license.expiresAt,
  };
}

async function validateFreeTier(figmaUserId, currentMonth) {
  const kvKey = `free:${figmaUserId}:${currentMonth}`;
  let usage = await kv.get(kvKey);

  if (!usage) {
    usage = { generationsUsed: 0, month: currentMonth };
  }

  if (usage.generationsUsed >= FREE_TIER_LIMIT) {
    return { valid: false, error: "FREE_QUOTA_EXCEEDED", status: 429 };
  }

  const updated = { ...usage, generationsUsed: usage.generationsUsed + 1 };
  await kv.set(kvKey, updated);

  return {
    valid: true,
    plan: "free",
    generationsUsed: updated.generationsUsed,
    generationsLimit: FREE_TIER_LIMIT,
  };
}
