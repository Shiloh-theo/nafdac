const axios = require("axios");

/**
 * Sends a WhatsApp message using Meta's Cloud API.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */

const META_API_URL = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json",
});

/**
 * Send a plain text message
 */
async function sendTextMessage(to, text) {
  try {
    await axios.post(
      META_API_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      },
      { headers: headers(), timeout: 15000 }
    );
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error("❌ Meta send error:", JSON.stringify(errData));
  }
}

/**
 * Mark a message as read (shows double blue tick)
 */
async function markAsRead(messageId) {
  try {
    await axios.post(
      META_API_URL.replace("/messages", ""),
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      { headers: headers(), timeout: 8000 }
    );
  } catch (_) {
    // Non-critical — ignore silently
  }
}

module.exports = { sendTextMessage, markAsRead };
