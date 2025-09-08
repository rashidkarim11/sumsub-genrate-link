import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import fetch from "node-fetch";
import crypto from "crypto";

dotenv.config();
const app = express();

// Parse Jotform's webhook format
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- Gmail transporter ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Gmail
    pass: process.env.EMAIL_PASS, // App password
  },
});

// --- Sumsub Setup ---
const APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL = "https://api.sumsub.com";
const LEVEL_NAME = process.env.LEVEL_NAME || "id-verification";

// Sign Sumsub request
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

// --- Webhook: receives data from Jotform ---
app.post("/jotform-webhook", async (req, res) => {
  try {
    console.log("📩 Raw Jotform submission:", req.body);

    // Extract correct fields
    const userId = req.body.q6_typeA;
    const email = req.body.q7_email;
    const phone = req.body.q8_typeA8;

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

    // --- Send email with verification link ---
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Complete Your KYC Verification",
      html: `<p>Hello <b>${userId}</b>,</p>
             <p>Please complete your KYC verification by clicking this link:</p>
             <a href="${verificationUrl}">${verificationUrl}</a>`,
    };

    await transporter.sendMail(mailOptions);

    console.log("✅ Email sent to", email);

    res.json({
      status: "ok",
      userId,
      email,
      phone,
      verificationUrl,
    });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("🚀 Jotform Webhook + Sumsub + Email is running");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
