import crypto from "crypto";
import { kv } from "@vercel/kv";

export const config = {
  api: {
    bodyParser: false,
  },
};

function generateLicenseKey(razorpaySubId) {
  const hash = crypto
    .createHmac("sha256", process.env.LICENSE_SIGNING_SECRET)
    .update(razorpaySubId)
    .digest("hex")
    .toUpperCase()
    .slice(0, 12);
  return `CLX-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString());
    const eventType = event.event;
    const payload = event.payload;

    switch (eventType) {
      case "subscription.activated":
        await handleSubscriptionActivated(payload);
        break;
      case "subscription.charged":
        await handleSubscriptionCharged(payload);
        break;
      case "subscription.cancelled":
        await handleSubscriptionStatusChange(payload, "suspended");
        break;
      case "subscription.completed":
        await handleSubscriptionStatusChange(payload, "expired");
        break;
      case "payment.failed":
        await handlePaymentFailed(payload);
        break;
      default:
        console.log("Unhandled webhook event:", eventType);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

async function handleSubscriptionActivated(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const subId = subscription.id;
  const email = subscription.customer_email || subscription.notes?.email || "";
  const licenseKey = generateLicenseKey(subId);
  const now = new Date().toISOString();

  const currentEnd = subscription.current_end
    ? new Date(subscription.current_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const licenseData = {
    email,
    razorpaySubId: subId,
    plan: "pro",
    status: "active",
    generationsUsed: 0,
    generationsLimit: 200,
    currentPeriodStart: now,
    expiresAt: currentEnd,
    createdAt: now,
  };

  await kv.set(`license:${licenseKey}`, licenseData);
  await kv.set(`sublookup:${subId}`, { licenseKey });

  console.log({ event: "subscription.activated", email, licenseKey, subId });
}

async function handleSubscriptionCharged(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const subId = subscription.id;
  const lookup = await kv.get(`sublookup:${subId}`);
  if (!lookup?.licenseKey) return;

  const license = await kv.get(`license:${lookup.licenseKey}`);
  if (!license) return;

  const currentEnd = subscription.current_end
    ? new Date(subscription.current_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await kv.set(`license:${lookup.licenseKey}`, {
    ...license,
    generationsUsed: 0,
    status: "active",
    currentPeriodStart: new Date().toISOString(),
    expiresAt: currentEnd,
  });
}

async function handleSubscriptionStatusChange(payload, newStatus) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const subId = subscription.id;
  const lookup = await kv.get(`sublookup:${subId}`);
  if (!lookup?.licenseKey) return;

  const license = await kv.get(`license:${lookup.licenseKey}`);
  if (!license) return;

  await kv.set(`license:${lookup.licenseKey}`, { ...license, status: newStatus });
}

async function handlePaymentFailed(payload) {
  const payment = payload.payment?.entity;
  if (!payment) return;

  const subId = payment.subscription_id;
  if (!subId) return;

  const lookup = await kv.get(`sublookup:${subId}`);
  if (!lookup?.licenseKey) return;

  const license = await kv.get(`license:${lookup.licenseKey}`);
  if (!license) return;

  await kv.set(`license:${lookup.licenseKey}`, { ...license, status: "suspended" });
}
