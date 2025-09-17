// server.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import crypto from "crypto";
import multer from "multer";
import fetch from "node-fetch";
import { Resend } from "resend";

dotenv.config();
const app = express();
const upload = multer(); // handles multipart/form-data

// --- Middleware for JSON + urlencoded
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- ENV Vars
const APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL = process.env.SUMSUB_BASE_URL || "https://api.sumsub.com";
const LEVEL_NAME = process.env.LEVEL_NAME || "id-and-liveness";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = "onboarding@resend.dev";

const resend = new Resend(RESEND_API_KEY);

// --- Sumsub sign helper
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

// --- Debug route for testing
app.post("/jotform-debug", upload.none(), (req, res) => {
  console.log("🐞 Debug payload:", req.body);
  res.json({
    message: "✅ Debug webhook received",
    body: req.body,
    headers: req.headers,
  });
});

// --- Jotform webhook handler
app.post("/jotform-webhook", upload.none(), async (req, res) => {
  try {
    console.log("📩 Raw submission body:", req.body);

    // Jotform sometimes nests data inside rawRequest
    let payload = {};
    if (req.body.rawRequest) {
      try {
        payload = JSON.parse(req.body.rawRequest);
      } catch (e) {
        console.error("❌ Failed to parse rawRequest:", e);
      }
    } else {
      payload = req.body;
    }

    // Extract values
    const userId = payload.q3_Email || req.body.q3_Email;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId or email" });
    }

    // --- Call Sumsub API to generate WebSDK link
    const linkUrl = `/resources/sdkIntegrations/levels/-/websdkLink`;
    const body = JSON.stringify({
      levelName: LEVEL_NAME,
      userId,
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
      console.error("❌ Sumsub error:", errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    const verificationUrl = data.url;
    console.log("✅ Sumsub link created:", verificationUrl);

    // --- Send email with Resend
    try {
      const emailResp = await resend.emails.send({
        from: RESEND_FROM,
        to: userId,
        subject: "Complete Your KYC Verification",
        html: `
          <p>Hello <strong>${userId}</strong>,</p>
          <p>Please complete your KYC verification by clicking the link below:</p>
          <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        `,
      });
      console.log("📧 Resend response:", emailResp);
    } catch (err) {
      console.error("❌ Resend error:", err);
    }

    // Respond to Jotform
    res.json({
      status: "ok",
      userId,

      verificationUrl,
      debugPayload: payload,
    });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Sumsub webhook (review updates)
app.post("/sumsub-webhook", express.json(), (req, res) => {
  console.log("📩 Sumsub webhook received:", req.body);
  // Here you’d update your DB / Wix members / Jotform submission
  res.json({ status: "ok" });
});

// Root
app.get("/", (req, res) => {
  res.send("🚀 Jotform Webhook + Sumsub + Resend running");
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
