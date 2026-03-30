const axios = require("axios");

/**
 * Sends WhatsApp messages using Meta's Cloud API.
 *
 * FIX APPLIED: META_API_URL is now a function (getMetaApiUrl) instead of a constant.
 *
 * WHY THIS MATTERS:
 * When Node.js loads a file, it runs the top-level code immediately.
 * If META_API_URL was a const, it would be built the moment this file was
 * imported — before dotenv had fully loaded your .env file in some environments.
 * That means process.env.PHONE_NUMBER_ID could be undefined, making the URL:
 *   "https://graph.facebook.com/v19.0/undefined/messages"
 * Every send call would silently fail.
 *
 * By making it a function, the URL is only built at the moment it's CALLED —
 * by which point dotenv has definitely run and your env vars are available.
 */
const getMetaApiUrl = () =>
  `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;

// Headers are also a function for the same reason — META_ACCESS_TOKEN
// needs to be read at call time, not at import time.
const getHeaders = () => ({
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json",
});

/**
 * Sends a plain text message to a WhatsApp user.
 * @param {string} to - Recipient's phone number (e.g. "2348012345678")
 * @param {string} text - The message body
 */
async function sendTextMessage(to, text) {
  try {
    await axios.post(
      getMetaApiUrl(), // <-- called as a function now, not used as a variable
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      },
      { headers: getHeaders(), timeout: 15000 }
    );
  } catch (err) {
    // Log the full error detail from Meta so you can debug it
    const errData = err.response?.data || err.message;
    console.error("❌ Meta send error:", JSON.stringify(errData));
  }
}

/**
 * Marks a message as read (shows the double blue tick to the sender).
 * This is a "nice to have" — failure here is non-critical, so we
 * catch errors silently rather than letting them bubble up.
 * @param {string} messageId - The ID of the message to mark as read
 */
async function markAsRead(messageId) {
  try {
    await axios.post(
      getMetaApiUrl(),
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      { headers: getHeaders(), timeout: 8000 }
    );
  } catch (_) {
    // Intentionally silent — blue ticks failing shouldn't affect the user
  }
}

module.exports = { sendTextMessage, markAsRead };