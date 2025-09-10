import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";
import multer from "multer";
import { Resend } from "resend";

dotenv.config();
const app = express();
const upload = multer();

// --- Resend Setup ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Sumsub Setup ---
const APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL = "https://api.sumsub.com";
const LEVEL_NAME = process.env.LEVEL_NAME || "id-verification";

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

// --- Debug route ---
app.post("/jotform-debug", upload.none(), (req, res) => {
  console.log("🐞 Debug: Raw Jotform payload:", req.body);
  res.json({
    message: "✅ Webhook received",
    receivedAt: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
  });
});

// --- Main webhook ---
app.post("/jotform-webhook", upload.none(), async (req, res) => {
  try {
    console.log("📩 Raw Jotform submission:", req.body);

    // Extract Jotform fields
    const userId = req.body.q3_userid || req.body.userId;
    const email = req.body.q4_typeA4 || req.body.email;
    const phone = req.body.q5_typeA5 || req.body.phone;

    if (!userId || !email) {
      return res.status(400).json({ error: "Missing userId or email" });
    }

    // --- Create Sumsub WebSDK link ---
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
      console.error("❌ Sumsub error:", errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    const verificationUrl = data.url;

    // --- Send email using Resend ---
    await resend.emails.send({
      from: "noreply@yourdomain.com", // must be verified domain in Resend
      to: email,
      subject: "Complete Your KYC Verification",
      html: `<p>Hello <b>${userId}</b>,</p>
             <p>Please complete your KYC verification by clicking this link:</p>
             <a href="${verificationUrl}">${verificationUrl}</a>`,
    });

    console.log("✅ Email sent to", email);

    res.json({ status: "ok", userId, email, phone, verificationUrl });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Root
app.get("/", (req, res) => {
  res.send("🚀 Jotform Webhook + Sumsub + Resend Email is running");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
