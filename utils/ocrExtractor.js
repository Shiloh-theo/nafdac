const axios = require("axios");

/**
 * Uses Claude Vision API to extract NAFDAC registration numbers from images.
 * Handles product photos, packaging shots, and label close-ups.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Downloads an image from a URL and converts it to base64
 * Used for WhatsApp media URLs
 */
async function imageUrlToBase64(imageUrl, authToken = null) {
  const headers = { "User-Agent": "NAFDACBot/1.0" };
  if (authToken) {
    headers["Authorization"] = `Basic ${authToken}`;
  }

  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    headers,
    timeout: 20000,
  });

  const base64 = Buffer.from(response.data).toString("base64");
  const contentType = response.headers["content-type"] || "image/jpeg";

  return { base64, contentType };
}

/**
 * Extracts NAFDAC number(s) from an image using Claude Vision
 * @param {string} imageUrl - URL of the image to analyze
 * @param {string} twilioAuth - Base64 encoded Twilio auth (accountSid:authToken)
 * @returns {string|null} - Extracted NAFDAC number or null
 */
async function extractNafdacFromImage(imageUrl, twilioAuth = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set in environment");
  }

  // Download image and convert to base64
  const { base64, contentType } = await imageUrlToBase64(imageUrl, twilioAuth);

  // Ensure content type is a valid image type
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const mediaType = validTypes.includes(contentType) ? contentType : "image/jpeg";

  const response = await axios.post(
    ANTHROPIC_API_URL,
    {
      model: "claude-opus-4-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
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
- Examples: A7-0141, B1-2345, C3-4567, SON/NAFDAC numbers
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

  // Extract numbers from response
  const matches = result.match(/NAFDAC:([A-Z0-9]{2}-\d{4,6})/gi);
  if (!matches || matches.length === 0) return null;

  // Return the first found number (strip the "NAFDAC:" prefix)
  return matches[0].replace(/NAFDAC:/i, "");
}

module.exports = { extractNafdacFromImage };
