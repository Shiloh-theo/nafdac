# 🇳🇬 NAFDAC Bot v2.0 — Meta WhatsApp Cloud API

Your own WhatsApp number as a bot. Anyone can message it — no "join sandbox" codes needed.

---

## What Changed from v1 (Twilio)

| Feature | v1 (Twilio) | v2 (Meta) |
|---------|------------|-----------|
| WhatsApp number | Shared sandbox | YOUR OWN number |
| Anyone can message | ❌ Must join sandbox first | ✅ Yes, directly |
| Cost | ~$1/month for real number | Free |
| Verification source | Scraped nafdac.gov.ng | 9ja Checkr API (stable) |
| Nigerian number support | Limited | ✅ Full support |

---

## Setup Guide (Step by Step)

### STEP 1: Create a Meta Developer Account

1. Go to **https://developers.facebook.com**
2. Log in with your Facebook account
3. Click **"My Apps"** → **"Create App"**
4. Choose **"Business"** as app type
5. Give it a name like `NAFDAC Bot`

---

### STEP 2: Add WhatsApp to Your App

1. Inside your app dashboard, click **"Add Product"**
2. Find **WhatsApp** and click **"Set Up"**
3. You'll see the **WhatsApp API Setup** page

---

### STEP 3: Get Your Credentials

On the WhatsApp API Setup page, you'll see:

**Phone Number ID** — copy this into `.env` as `PHONE_NUMBER_ID`

**Temporary Access Token** — copy into `.env` as `META_ACCESS_TOKEN`
> ⚠️ The temporary token expires in 24 hours. For permanent use, create a System User token in Meta Business Suite (explained below).

---

### STEP 4: Add Your Nigerian Phone Number

1. On the WhatsApp page, click **"Add Phone Number"**
2. Enter your Nigerian number (e.g., +2348101234567)
3. Verify it via OTP
4. This is now your bot number — anyone can WhatsApp it!

> ℹ️ For a **test number**, Meta gives you a free one. For your real number, you need a verified Meta Business Account.

---

### STEP 5: Get Your 9ja Checkr API Key (NAFDAC Verification)

1. Go to **https://www.9jacheckr.xyz/dashboard/keys**
2. Sign up (free)
3. Create an API key
4. Copy it into `.env` as `NAFDAC_API_KEY`

Free tier: **300 verifications/month**

---

### STEP 6: Configure Your .env File

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
PHONE_NUMBER_ID=1234567890123456
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxx
WEBHOOK_VERIFY_TOKEN=any_secret_word_you_choose
NAFDAC_API_KEY=your_9jacheckr_key
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
PORT=3000
```

---

### STEP 7: Install Dependencies & Start Bot

```bash
npm install
node index.js
```

---

### STEP 8: Expose Your Bot with ngrok

In a second terminal:
```bash
ngrok http 3000
```

Copy the HTTPS URL, e.g.:
```
https://abc123.ngrok-free.app
```

---

### STEP 9: Set Up Meta Webhook

1. Go back to your Meta App → **WhatsApp → Configuration**
2. Under **Webhook**, click **Edit**
3. Set:
   - **Callback URL:** `https://abc123.ngrok-free.app/webhook`
   - **Verify Token:** whatever you put in `WEBHOOK_VERIFY_TOKEN`
4. Click **Verify and Save**
5. Subscribe to the **messages** field

Your bot is now live! ✅

---

### STEP 10: Create a Permanent Access Token (So it doesn't expire)

1. Go to **Meta Business Suite** (business.facebook.com)
2. Click **Settings → Users → System Users**
3. Create a System User → Add Assets (your WhatsApp app)
4. Generate Token → give it `whatsapp_business_messaging` permission
5. Copy the token into `.env` as `META_ACCESS_TOKEN`

This token never expires.

---

## Project Structure

```
nafdac-whatsapp-bot-meta/
├── index.js                  # Express server
├── src/
│   └── messageHandler.js     # WhatsApp message routing
├── utils/
│   ├── metaSender.js         # Meta API send/read functions
│   ├── nafdacScraper.js      # 9ja Checkr API verification
│   └── ocrExtractor.js       # Claude Vision image OCR
├── .env.example
└── package.json
```

---

## Testing

Send any of these to your WhatsApp number:

| Message | Response |
|---------|----------|
| `hi` | Welcome message |
| `A7-0141` | NAFDAC lookup |
| `Check 01-5713 for me` | Extracts & verifies |
| Photo of product label | Scans & verifies |

---

## Deploying for 24/7 Uptime (Free)

### Railway
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```
Set environment variables in Railway dashboard, use Railway URL as webhook.

### Render
1. Push to GitHub
2. New Web Service on render.com
3. Connect repo, set env vars, deploy
