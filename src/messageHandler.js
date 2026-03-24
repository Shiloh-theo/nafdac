const { sendTextMessage, markAsRead } = require("../utils/metaSender");
const { verifyNafdacNumber } = require("../utils/nafdacScraper");
const { extractNafdacFromImage } = require("../utils/ocrExtractor");

// Regex to find NAFDAC numbers in text
const NAFDAC_REGEX = /\b([A-Za-z0-9]{2}[-\/]?\d{4,6})\b/gi;

// Simple in-memory rate limiter (use Redis for production)
const userCooldowns = new Map();
const COOLDOWN_MS = 8000;

function isRateLimited(phone) {
  const last = userCooldowns.get(phone);
  if (last && Date.now() - last < COOLDOWN_MS) return true;
  userCooldowns.set(phone, Date.now());
  return false;
}

function extractNumbersFromText(text) {
  const matches = [];
  let match;
  const regex = new RegExp(NAFDAC_REGEX.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

/**
 * GET /webhook — Meta webhook verification (one-time during setup)
 */
function handleVerification(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed");
  res.sendStatus(403);
}

/**
 * POST /webhook — Handle incoming WhatsApp messages from Meta
 */
async function handleIncomingMessage(req, res) {
  // Always respond 200 immediately to Meta (required)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Validate it's a WhatsApp message event
    if (
      body.object !== "whatsapp_business_account" ||
      !body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      return;
    }

    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const from = message.from; // sender's phone number
    const messageId = message.id;
    const messageType = message.type;

    console.log(`📱 Message from +${from} | Type: ${messageType}`);

    // Mark message as read
    await markAsRead(messageId);

    // Rate limit check
    if (isRateLimited(from)) {
      await sendTextMessage(from, "⏳ Please wait a moment before sending another request.");
      return;
    }

    // ── TEXT MESSAGE ──────────────────────────────────────────
    if (messageType === "text") {
      const text = message.text?.body || "";
      const lower = text.toLowerCase().trim();

      // Greeting / help
      if (["hi", "hello", "hey", "start", "help", "helo", "hy"].includes(lower) || lower === "") {
        await sendTextMessage(from, welcomeMessage());
        return;
      }

      // Look for NAFDAC number in text
      const found = extractNumbersFromText(text);
      if (found.length > 0) {
        await sendTextMessage(from, `🔄 Checking *${found[0]}* in the NAFDAC database...`);
        const result = await verifyNafdacNumber(found[0]);
        await sendTextMessage(from, result.message);
      } else {
        await sendTextMessage(from, noNumberMessage());
      }
      return;
    }

    // ── IMAGE MESSAGE ─────────────────────────────────────────
    if (messageType === "image") {
      const imageId = message.image?.id;
      if (!imageId) {
        await sendTextMessage(from, "📷 Couldn't read your image. Please try again.");
        return;
      }

      await sendTextMessage(from, "🔍 *Analyzing your image...*\n\nReading the NAFDAC number from the photo. Please wait...");

      try {
        // Step 1: Get image URL from Meta
        const metaImageUrl = await getMetaImageUrl(imageId);

        // Step 2: Extract NAFDAC number using Claude Vision
        const extracted = await extractNafdacFromImage(metaImageUrl, null, process.env.META_ACCESS_TOKEN);

        if (!extracted) {
          await sendTextMessage(from, noNumberInImageMessage());
          return;
        }

        await sendTextMessage(from, `📷 *Number detected:* \`${extracted}\`\n\n🔄 Checking NAFDAC database...`);
        const result = await verifyNafdacNumber(extracted);
        await sendTextMessage(from, result.message);

      } catch (imgErr) {
        console.error("Image processing error:", imgErr.message);
        await sendTextMessage(from, "❌ Couldn't process your image. Please send a clearer photo or type the NAFDAC number directly.");
      }
      return;
    }

    // ── UNSUPPORTED MESSAGE TYPE ──────────────────────────────
    await sendTextMessage(
      from,
      `ℹ️ I can only process:\n• *Text* — type a NAFDAC number (e.g. A7-0141)\n• *Images* — send a photo of the product label\n\nType *help* to see how to use this bot.`
    );

  } catch (err) {
    console.error("Handler error:", err.message);
  }
}

/**
 * Fetch the actual image URL from Meta's Graph API
 */
async function getMetaImageUrl(imageId) {
  const response = await axios.get(
    `https://graph.facebook.com/v19.0/${imageId}`,
    {
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      timeout: 10000,
    }
  );
  return response.data.url;
}

// ── Message templates ──────────────────────────────────────────

function welcomeMessage() {
  return `👋 *Welcome to the NAFDAC Verification Bot!*

I help you verify if a product is registered with NAFDAC in Nigeria.

*How to use:*
1️⃣ *Send a NAFDAC number* — e.g., type: \`A7-0141\` or \`01-5713\`
2️⃣ *Send a photo* of the product label and I'll read the number for you

*What I check:*
✅ Product name & manufacturer
✅ Registration status
✅ Approval date & category

Type a number or send a photo to get started! 🔍

_Data sourced from the official NAFDAC register_`;
}

function noNumberMessage() {
  return `🤔 I couldn't find a NAFDAC number in your message.

*NAFDAC numbers look like:*
• \`A7-0141\`
• \`01-5713\`
• \`B1-2345\`

Please type the number exactly as it appears on the product, or send a *photo* of the product label.

Type *help* for more info.`;
}

function noNumberInImageMessage() {
  return `📷 *No NAFDAC Number Found in Image*

I couldn't detect a NAFDAC number in your photo.

*Tips for a better scan:*
• Take a clear close-up of the label
• Ensure good lighting — no shadows
• Make sure the NAFDAC number area is visible
• Avoid blurry or angled shots

Or type the NAFDAC number directly if you can read it.`;
}

// Need axios for getMetaImageUrl
const axios = require("axios");

module.exports = { handleIncomingMessage, handleVerification };
