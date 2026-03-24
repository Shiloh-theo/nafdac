const axios = require("axios");

/**
 * Verifies a NAFDAC registration number using the 9ja Checkr API
 * which sources data directly from the official NAFDAC public register.
 *
 * API docs: https://www.9jacheckr.xyz/docs
 * Get your free API key at: https://www.9jacheckr.xyz/dashboard/keys
 * Free tier: 300 calls/month
 */

const API_BASE = "https://api.9jacheckr.xyz/api/verify";

function normalizeNafdacNumber(input) {
  const cleaned = input.trim().toUpperCase().replace(/[\s/\\]/g, "-");
  if (!cleaned.includes("-") && cleaned.length >= 4) {
    return cleaned.slice(0, 2) + "-" + cleaned.slice(2);
  }
  return cleaned;
}

function isValidFormat(nafdacNumber) {
  const pattern = /^[A-Z0-9]{2}-\d{4,6}$/;
  return pattern.test(nafdacNumber);
}

async function verifyNafdacNumber(rawNumber) {
  const nafdacNumber = normalizeNafdacNumber(rawNumber);

  if (!isValidFormat(nafdacNumber)) {
    return {
      valid: false,
      status: "INVALID_FORMAT",
      nafdacNumber,
      message: `❌ *Invalid Format*\n\n"${rawNumber}" doesn't look like a valid NAFDAC number.\n\nValid format: *XX-XXXX* (e.g., A7-0141, 01-5713)\n\nPlease check the number on the product label and try again.`,
    };
  }

  const apiKey = process.env.NAFDAC_API_KEY;
  if (!apiKey) {
    console.error("NAFDAC_API_KEY not set in .env");
    return fallbackMessage(nafdacNumber);
  }

  try {
    const response = await axios.get(`${API_BASE}/${nafdacNumber}`, {
      headers: { "x-api-key": apiKey, "User-Agent": "NAFDACBot/2.0" },
      timeout: 15000,
    });

    const data = response.data;

    if (data.ok && data.product) {
      return {
        valid: true,
        status: "FOUND",
        nafdacNumber,
        product: data.product,
        message: formatSuccessMessage(nafdacNumber, data.product),
      };
    }

    return { valid: false, status: "NOT_FOUND", nafdacNumber, message: formatNotFoundMessage(nafdacNumber) };

  } catch (error) {
    if (error.response && error.response.status === 404) {
      return { valid: false, status: "NOT_FOUND", nafdacNumber, message: formatNotFoundMessage(nafdacNumber) };
    }
    if (error.response && error.response.status === 429) {
      return { valid: null, status: "RATE_LIMITED", nafdacNumber, message: `⏳ *Too Many Requests*\n\nPlease try again in a few minutes.\n\n🔗 Manual check: *https://greenbook.nafdac.gov.ng*` };
    }
    console.error("NAFDAC API error:", error.message);
    return fallbackMessage(nafdacNumber);
  }
}

function formatSuccessMessage(nafdacNumber, product) {
  const name = product.name || product.productName || product.product_name || "N/A";
  const manufacturer = product.manufacturer || product.applicant || product.company || "N/A";
  const category = product.category || product.productCategory || "N/A";
  const approvalDate = product.approvalDate || product.approval_date || product.date || "N/A";
  const status = product.status || "Active";
  const form = product.form || "";
  const strength = product.strength || product.strengths || "";

  let msg = `✅ *NAFDAC Verification Successful*\n\n📋 *Reg. No:* ${nafdacNumber}\n🏷️ *Product:* ${name}`;
  if (form) msg += `\n💊 *Form:* ${form}`;
  if (strength) msg += `\n⚗️ *Strength:* ${strength}`;
  msg += `\n🏭 *Manufacturer:* ${manufacturer}\n📦 *Category:* ${category}\n📅 *Approval Date:* ${approvalDate}\n✔️ *Status:* ${status}\n\n_This product is registered with NAFDAC and approved for sale in Nigeria._\n\n🔗 greenbook.nafdac.gov.ng`;
  return msg;
}

function formatNotFoundMessage(nafdacNumber) {
  return `⚠️ *Product Not Found*\n\nRegistration No: *${nafdacNumber}*\n\nThis number was *not found* in the NAFDAC register.\n\n🚨 This could mean the product is counterfeit, unregistered, or the number was misread.\n\n🔍 Cross-check: *greenbook.nafdac.gov.ng*\n📞 Report suspicious products: *01-2787701*`;
}

function fallbackMessage(nafdacNumber) {
  return {
    valid: null, status: "ERROR", nafdacNumber,
    message: `⚠️ *Verification Unavailable*\n\nCould not reach the service right now.\n\n🔍 Verify manually: *https://greenbook.nafdac.gov.ng*\n\nReg. No: *${nafdacNumber}*\n\nTry again in a few minutes.`,
  };
}

module.exports = { verifyNafdacNumber, normalizeNafdacNumber, isValidFormat };
