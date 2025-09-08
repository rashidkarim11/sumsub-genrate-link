import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Load from env ---
const APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const BASE_URL = "https://api.sumsub.com";
const LEVEL_NAME = process.env.LEVEL_NAME || "id-only";

// --- Gmail transport setup (Nodemailer) ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // your Gmail
    pass: process.env.EMAIL_PASS, // 16-char Google App Password
  },
});

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

// --- API: Generate External WebSDK Link + Send Email ---
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
      applicantIdentifiers: {
        email,
        phone,
      },
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
      console.error("Error from Sumsub:", errorText);
      return res
        .status(response.status)
        .json({ error: "WebSDK link generation failed", details: errorText });
    }

    const data = await response.json();
    const verificationUrl = data.url;

    // --- Send email to user ---
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Complete Your KYC Verification",
      text: `Hello, please complete your KYC verification by clicking this link: ${verificationUrl}`,
      html: `<p>Hello,</p><p>Please complete your KYC verification by clicking the link below:</p><a href="${verificationUrl}">${verificationUrl}</a>`,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      message: "Verification link generated and sent via email",
      verificationUrl,
      userId,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Root route ---
app.get("/", (req, res) => {
  res.send("✅ Sumsub External WebSDK API is running with email support");
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
