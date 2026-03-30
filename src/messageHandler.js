// FIX APPLIED: All require() statements moved to the TOP of the file.
//
// WHY THIS MATTERS:
// In Node.js, it is standard practice to put all imports at the top.
// Having "const axios = require('axios')" at the BOTTOM of the file works
// technically (because of how Node caches modules), but it's dangerous:
// - It makes the code hard to read — a developer can't tell what
//   dependencies this file has without scrolling to the bottom.
// - In strict mode or future Node versions, this could cause errors.
// - It signals to anyone reading the code that something went wrong.
// Rule of thumb: ALWAYS put your requires/imports at the very top.
const axios = require("axios");
const { sendTextMessage, markAsRead } = require("../utils/metaSender");
const { verifyNafdacNumber } = require("../utils/nafdacScraper");
const { extractNafdacFromImage } = require("../utils/ocrExtractor");

// Regex to detect NAFDAC numbers anywhere in a text message.
// \b = word boundary (so it doesn't match partial words)
// [A-Za-z0-9]{2} = exactly 2 alphanumeric characters (the prefix)
// [-\/]? = an optional dash or forward slash
// \d{4,6} = 4 to 6 digits
const NAFDAC_REGEX = /\b([A-Za-z0-9]{2}[-\/]?\d{4,6})\b/gi;

// ── Rate Limiter ─────────────────────────────────────────────────────────────
//
// CONCEPT: What is a rate limiter and why do we need it?
//
// Without a rate limiter, a single user could spam your bot with 100 requests
// per second. Each request calls the 9ja Checkr API (which has a 300/month
// free tier limit) and potentially the Anthropic API (which costs money).
// A single abusive user could drain your entire monthly quota in minutes.
//
// HOW IT WORKS:
// We store a Map (like a dictionary/object) where the KEY is the user's phone
// number and the VALUE is the timestamp (ms) of their last request.
// When a new message arrives, we check: "has this user sent a message in
// the last 8 seconds?" If yes → rate limited. If no → allow and update timestamp.
//
// NOTE: This uses in-memory storage (the Map lives in RAM). This means if
// you restart your server, all rate limit history is cleared. For production,
// you'd replace this with Redis (a fast external database). But for now this
// is perfectly fine.
const userCooldowns = new Map();
const COOLDOWN_MS = 8000; // 8 seconds between requests per user

function isRateLimited(phone) {
  const lastRequestTime = userCooldowns.get(phone);
  if (lastRequestTime && Date.now() - lastRequestTime < COOLDOWN_MS) {
    return true; // Still within the cooldown window
  }
  userCooldowns.set(phone, Date.now()); // Update to current time
  return false;
}

// ── NAFDAC Number Extractor ───────────────────────────────────────────────────
// Scans a text string and returns all NAFDAC-like numbers found in it.
// e.g. "Check A7-0141 for me" → ["A7-0141"]
function extractNumbersFromText(text) {
  const matches = [];
  let match;
  // We create a NEW regex object each call to reset the lastIndex pointer.
  // This is a subtle JavaScript gotcha with the /g flag on regex — if you
  // reuse the same regex object, it remembers where it left off between calls.
  const regex = new RegExp(NAFDAC_REGEX.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

// ── Webhook Verification (GET /webhook) ──────────────────────────────────────
//
// CONCEPT: This only runs ONCE — when you first connect your webhook on Meta's
// developer dashboard. Meta sends a GET request with three query parameters:
//   - hub.mode: always "subscribe"
//   - hub.verify_token: whatever you put in WEBHOOK_VERIFY_TOKEN in your .env
//   - hub.challenge: a random number Meta generated
//
// Your job: confirm you're the real server by echoing back hub.challenge.
// If the verify_token doesn't match, you return 403 Forbidden to reject it.
function handleVerification(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed — token mismatch");
  res.sendStatus(403);
}

// ── Message Handler (POST /webhook) ──────────────────────────────────────────
//
// CONCEPT: This fires every time ANYONE sends a message to your bot number.
// Meta sends you a POST request with a JSON body describing the message.
// The body structure is deeply nested — that's just how Meta's API is designed.
//
// CRITICAL RULE: You MUST call res.sendStatus(200) immediately.
// Meta expects a 200 response within 5 seconds. If it doesn't get one,
// it will retry sending the same message — potentially causing your bot
// to respond to the same message multiple times.
// Notice we send 200 FIRST, then process the message asynchronously.
async function handleIncomingMessage(req, res) {
  // ✅ Respond to Meta immediately — BEFORE any processing
  res.sendStatus(200);

  try {
    const body = req.body;

    // Guard clause: make sure this is actually a WhatsApp message event.
    // Meta can send other types of events (status updates, etc.) to this
    // same endpoint. The optional chaining (?.) prevents crashes if any
    // level of this nested object is missing.
    if (
      body.object !== "whatsapp_business_account" ||
      !body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      return;
    }

    // Dig into Meta's nested JSON to get the parts we care about
    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const from = message.from;        // Sender's phone number e.g. "2348012345678"
    const messageId = message.id;     // Unique ID for this message
    const messageType = message.type; // "text", "image", "audio", etc.

    console.log(`📱 Message from +${from} | Type: ${messageType}`);

    // Show the double blue tick to the sender
    await markAsRead(messageId);

    // Check rate limit before doing any expensive API calls
    if (isRateLimited(from)) {
      await sendTextMessage(from, "⏳ Please wait a moment before sending another request.");
      return;
    }

    // ── Handle TEXT messages ────────────────────────────────────────────────
    if (messageType === "text") {
      const text = message.text?.body || "";
      const lower = text.toLowerCase().trim();

      // Check if it's a greeting — respond with the welcome message
      if (["hi", "hello", "hey", "start", "help", "helo", "hy"].includes(lower) || lower === "") {
        await sendTextMessage(from, welcomeMessage());
        return;
      }

      // Try to find a NAFDAC number anywhere in the text
      const found = extractNumbersFromText(text);
      if (found.length > 0) {
        // Send a "working on it" message first so the user knows something is happening
        await sendTextMessage(from, `🔄 Checking *${found[0]}* in the NAFDAC database...`);
        const result = await verifyNafdacNumber(found[0]);
        await sendTextMessage(from, result.message);
      } else {
        await sendTextMessage(from, noNumberMessage());
      }
      return;
    }

    // ── Handle IMAGE messages ───────────────────────────────────────────────
    if (messageType === "image") {
      const imageId = message.image?.id;
      if (!imageId) {
        await sendTextMessage(from, "📷 Couldn't read your image. Please try again.");
        return;
      }

      await sendTextMessage(
        from,
        "🔍 *Analyzing your image...*\n\nReading the NAFDAC number from the photo. Please wait..."
      );

      try {
        // Step 1: Get the actual download URL from Meta using the image ID
        const metaImageUrl = await getMetaImageUrl(imageId);

        // Step 2: Send the image to Claude Vision to extract the NAFDAC number
        // Notice we pass process.env.META_ACCESS_TOKEN as the third argument —
        // this is the fix that makes image scanning actually work.
        const extracted = await extractNafdacFromImage(
          metaImageUrl,
          null,
          process.env.META_ACCESS_TOKEN
        );

        if (!extracted) {
          await sendTextMessage(from, noNumberInImageMessage());
          return;
        }

        await sendTextMessage(
          from,
          `📷 *Number detected:* \`${extracted}\`\n\n🔄 Checking NAFDAC database...`
        );

        // Step 3: Verify the extracted number against the NAFDAC database
        const result = await verifyNafdacNumber(extracted);
        await sendTextMessage(from, result.message);

      } catch (imgErr) {
        console.error("Image processing error:", imgErr.message);
        await sendTextMessage(
          from,
          "❌ Couldn't process your image. Please send a clearer photo or type the NAFDAC number directly."
        );
      }
      return;
    }

    // ── Unsupported message type (voice note, sticker, video, etc.) ─────────
    await sendTextMessage(
      from,
      `ℹ️ I can only process:\n• *Text* — type a NAFDAC number (e.g. A7-0141)\n• *Images* — send a photo of the product label\n\nType *help* to see how to use this bot.`
    );

  } catch (err) {
    // Catch-all: log the error but don't let it crash the server
    console.error("Handler error:", err.message);
  }
}

// ── Helper: Get Image URL from Meta ──────────────────────────────────────────
//
// When Meta sends you an image message, it doesn't give you the image directly.
// It gives you an "image ID". You must make a separate API call to Meta to
// get the actual download URL, then download from that URL (with auth).
async function getMetaImageUrl(imageId) {
  const response = await axios.get(
    `https://graph.facebook.com/v19.0/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
      timeout: 10000,
    }
  );
  return response.data.url;
}

// ── Message Templates ─────────────────────────────────────────────────────────
// Keeping message text in functions (not inline) makes it easy to update
// wording without hunting through logic code.

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

module.exports = { handleIncomingMessage, handleVerification };