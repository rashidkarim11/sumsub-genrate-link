import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
// allow frontend calls

// --- Load from env ---
const APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL = process.env.SUMSUB_BASE_URL;
const LEVEL_NAME = process.env.LEVEL_NAME;

// --- Helper: Sign Sumsub requests ---
function signRequest(method, url, body = "") {
  const ts = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac("sha256", SECRET_KEY || "")
    .update(ts + method + url + body)
    .digest("hex");

  return {
    "X-App-Token": APP_TOKEN,
    "X-App-Access-Sig": signature,
    "X-App-Access-Ts": ts,
    "Content-Type": "application/json",
  };
}

// --- API: Generate External WebSDK Link ---
app.post("/generate-link", async (req, res) => {
  try {
    const { email, phone, userId } = req.body;

    if (!userId || !email) {
      return res
        .status(400)
        .json({ error: "Missing userId or email in request body" });
    }

    const linkUrl = `/resources/sdkIntegrations/levels/-/websdkLink`;
    const body = JSON.stringify({
      levelName: LEVEL_NAME,
      userId,
      applicantIdentifiers: { email, phone },
      ttlInSecs: 1800,
      redirectUrl: "https://your-site.com/after-kyc",
    });

    const response = await fetch(BASE_URL + linkUrl, {
      method: "POST",
      headers: signRequest("POST", linkUrl, body),
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Sumsub Error ${response.status}] ${errorText}`);
      return res
        .status(response.status)
        .json({ error: "WebSDK link generation failed", details: errorText });
    }

    const data = await response.json();
    res.json({
      verificationUrl: data.url,
      userId,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- API: Webhook handler (optional) ---
app.post("/sumsub-webhook", (req, res) => {
  console.log("📩 Webhook event received:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// --- Root route ---
app.get("/", (req, res) => {
  res.send("✅ Sumsub External WebSDK API is running");
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
