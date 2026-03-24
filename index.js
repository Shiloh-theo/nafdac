require("dotenv").config();
const express = require("express");
const { handleIncomingMessage, handleVerification } = require("./src/messageHandler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ NAFDAC Bot (Meta API) is running", version: "2.0.0" });
});

// Meta webhook verification (one-time setup)
app.get("/webhook", handleVerification);

// Incoming WhatsApp messages from Meta
app.post("/webhook", handleIncomingMessage);

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   NAFDAC Bot v2.0 - Meta API - RUNNING   ║
  ║   Port: ${PORT}                              ║
  ║   Webhook: GET+POST /webhook             ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
