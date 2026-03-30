const axios = require("axios");

/**
 * DIRECT NAFDAC SCRAPER
 * 
 * This directly queries the official NAFDAC Greenbook internal JSON API.
 * No third-party API keys required!
 */

const NAFDAC_URL = "https://greenbook.nafdac.gov.ng/";

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

  try {
    // We construct the exact DataTables URL parameters the official website uses
    const params = new URLSearchParams();
    params.append("draw", "1");
    params.append("start", "0");
    params.append("length", "10"); // We only need the top result
    params.append("search[value]", nafdacNumber); // Global search for the number
    params.append("columns[5][data]", "NAFDAC"); 
    params.append("columns[5][search][value]", nafdacNumber); // Specific column search

    // We must send these specific headers so the server thinks we are a normal web browser
    const response = await axios.get(NAFDAC_URL, {
      params: params,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest", // <--- CRITICAL: Tells NAFDAC to return JSON, not HTML
        "Referer": "https://greenbook.nafdac.gov.ng/"
      },
      timeout: 20000, // 20 seconds timeout (Gov websites can be slow)
    });

    const data = response.data;

    // DataTables returns an array of matches in the "data" property
    if (data && data.data && data.data.length > 0) {
      // Get the first product match
      const product = data.data[0];
      
      return {
        valid: true,
        status: "FOUND",
        nafdacNumber,
        product: product,
        message: formatSuccessMessage(nafdacNumber, product),
      };
    }

    // If the array is empty, the product isn't registered
    return { valid: false, status: "NOT_FOUND", nafdacNumber, message: formatNotFoundMessage(nafdacNumber) };

  } catch (error) {
    console.error("Direct NAFDAC connection error:", error.message);
    return fallbackMessage(nafdacNumber);
  }
}

function formatSuccessMessage(nafdacNumber, product) {
  // Extracting from NAFDAC's exact JSON structure
  const name = product.product_name || "N/A";
  const manufacturer = product.applicant?.name || "N/A";
  const category = product.product_category?.name || "N/A";
  const approvalDate = product.approval_date || "N/A";
  const status = product.status || "Active";
  const form = product.form?.name || "";
  const strength = product.strength || "";
  const activeIngredient = product.ingredient?.ingredient_name || "";

  let msg = `✅ *NAFDAC Verification Successful*\n\n📋 *Reg. No:* ${nafdacNumber}\n🏷️ *Product:* ${name}`;
  
  if (activeIngredient) msg += `\n🧪 *Ingredient:* ${activeIngredient}`;
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
    message: `⚠️ *Database Unavailable*\n\nThe official NAFDAC servers are currently slow or offline.\n\n🔍 Verify manually later: *https://greenbook.nafdac.gov.ng*\n\nReg. No: *${nafdacNumber}*\n\nPlease try again in a few minutes.`,
  };
}

module.exports = { verifyNafdacNumber, normalizeNafdacNumber, isValidFormat };