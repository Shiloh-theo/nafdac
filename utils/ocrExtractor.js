const axios = require("axios");

/**
 * Uses Claude Vision to extract NAFDAC registration numbers from product images.
 *
 * TWO FIXES APPLIED:
 *
 * FIX 1 — Function signature: added `metaAccessToken` as the third parameter.
 *
 *   The old code:
 *     async function extractNafdacFromImage(imageUrl, twilioAuth = null)
 *   was being called from messageHandler.js like this:
 *     extractNafdacFromImage(metaImageUrl, null, process.env.META_ACCESS_TOKEN)
 *
 *   That third argument (the Meta token) was just disappearing into thin air
 *   because the function only had 2 parameters. So when imageUrlToBase64 tried
 *   to download the image from Meta's servers without an Authorization header,
 *   Meta would return a 401 Unauthorized error. Image scanning would never work.
 *
 * FIX 2 — Model name: changed from "claude-opus-4-5" (which doesn't exist)
 *   to "claude-sonnet-4-5-20251015".
 *
 *   Sonnet is the right choice for OCR tasks — it's fast, accurate, and
 *   significantly cheaper than Opus. Opus is for complex reasoning tasks.
 *   Using a non-existent model name would cause the API to return a 404 error.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Downloads an image from a URL and converts it to base64.
 * Meta requires a Bearer token to serve image files — without it you get 401.
 *
 * @param {string} imageUrl - The URL of the image to download
 * @param {string|null} twilioAuth - Legacy Twilio auth (kept for compatibility)
 * @param {string|null} metaAccessToken - Meta Bearer token (required for WhatsApp images)
 */
async function imageUrlToBase64(imageUrl, twilioAuth = null, metaAccessToken = null) {
  const headers = { "User-Agent": "NAFDACBot/2.0" };

  // FIX 1 IN ACTION: We now correctly receive and use the Meta token
  if (metaAccessToken) {
    // Meta's media URLs require "Bearer <token>" authorization
    headers["Authorization"] = `Bearer ${metaAccessToken}`;
  } else if (twilioAuth) {
    // Legacy Twilio support kept intact
    headers["Authorization"] = `Basic ${twilioAuth}`;
  }

  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer", // Download as raw bytes, not text
    headers,
    timeout: 20000,
  });

  // Convert the raw bytes to a base64 string (required by Claude's API)
  const base64 = Buffer.from(response.data).toString("base64");
  const contentType = response.headers["content-type"] || "image/jpeg";
  return { base64, contentType };
}

/**
 * Extracts a NAFDAC number from an image using Claude Vision.
 *
 * @param {string} imageUrl - URL of the image (from Meta's servers)
 * @param {string|null} twilioAuth - Legacy auth, pass null for Meta
 * @param {string|null} metaAccessToken - Your META_ACCESS_TOKEN from .env
 * @returns {string|null} - The extracted NAFDAC number, or null if not found
 */
async function extractNafdacFromImage(imageUrl, twilioAuth = null, metaAccessToken = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set in environment");
  }

  // Download the image — now correctly passing the Meta token through
  const { base64, contentType } = await imageUrlToBase64(imageUrl, twilioAuth, metaAccessToken);

  // Claude's API only accepts these image types
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const mediaType = validTypes.includes(contentType) ? contentType : "image/jpeg";

  const response = await axios.post(
    ANTHROPIC_API_URL,
    {
      // FIX 2: Correct model name. "claude-opus-4-5" doesn't exist.
      // Sonnet is faster and cheaper — perfect for OCR.
      model: "claude-sonnet-4-5-20251015",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              // We're sending the image as base64 data directly to Claude
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: `Look at this product image carefully. Find any NAFDAC registration number on it.

NAFDAC numbers in Nigeria follow this format:
- Two alphanumeric characters followed by a dash and 4-6 digits
- Examples: A7-0141, B1-2345, C3-4567
- May be labeled as: "NAFDAC REG NO", "NAFDAC No.", "Reg. No.", or similar
- Often found on product packaging, labels, or stickers

If you find a NAFDAC number, respond with ONLY the number in this exact format: NAFDAC:XX-XXXX
If you find multiple, list them all on separate lines.
If no NAFDAC number is visible, respond with: NONE
Do not include any other text.`,
            },
          ],
        },
      ],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 30000,
    }
  );

  const result = response.data.content[0]?.text?.trim();

  if (!result || result === "NONE") {
    return null;
  }

  // Parse "NAFDAC:A7-0141" → "A7-0141"
  const matches = result.match(/NAFDAC:([A-Z0-9]{2}-\d{4,6})/gi);
  if (!matches || matches.length === 0) return null;

  return matches[0].replace(/NAFDAC:/i, "");
}

module.exports = { extractNafdacFromImage };