// ═══════════════════════════════════════════════════════════
// SMART CGPA CALCULATOR — Backend Server
// ECE R2023 · SRM Valliammai Engineering College
// ═══════════════════════════════════════════════════════════

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import crypto from "crypto";

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Security Headers ──────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles needed by the frontend
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"]
    }
  }
}));

// ── CORS ──────────────────────────────────────────────────
const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// ── Body Parser (max 10MB) ────────────────────────────────
app.use(express.json({ limit: "10mb" }));

// ── Rate Limiter — OCR endpoint ───────────────────────────
// Max 15 OCR requests per IP per 15 minutes to protect the
// Google Vision API free-tier quota (1000 req/month).
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many OCR requests. Please wait a few minutes before trying again.",
    retryAfter: "15 minutes"
  }
});

// ── In-Memory OCR Cache ───────────────────────────────────
// Caches Vision API responses by image hash for 1 hour.
// Prevents duplicate API calls for the same image.
const ocrCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(base64) {
  // Hash just the first 8KB of base64 for speed (images differ at start)
  const sample = base64.substring(0, 8192);
  return crypto.createHash("sha256").update(sample).digest("hex");
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of ocrCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      ocrCache.delete(key);
    }
  }
}

// Prune expired cache entries every 30 minutes
setInterval(pruneCache, 30 * 60 * 1000);

// ── Serve Frontend ────────────────────────────────────────
app.use(express.static(__dirname));

// ── OCR Proxy Endpoint ────────────────────────────────────
app.post("/api/ocr", ocrLimiter, async (req, res) => {
  try {
    const { base64 } = req.body;

    // Validate input
    if (!base64 || typeof base64 !== "string") {
      return res.status(400).json({ error: "Missing or invalid image data" });
    }

    // Validate image size (base64 is ~1.37x raw size; 10MB image → ~13.7MB base64)
    const estimatedBytes = (base64.length * 3) / 4;
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "Image too large. Please upload an image under 10MB." });
    }

    // Check API key
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey || apiKey.includes("your_") || apiKey.length < 20) {
      return res.status(500).json({ error: "Google Vision API key not configured on server." });
    }

    // Check cache first
    const cacheKey = getCacheKey(base64);
    if (ocrCache.has(cacheKey)) {
      const cached = ocrCache.get(cacheKey);
      console.log(`✦ Cache hit for image hash ${cacheKey.substring(0, 8)}...`);
      return res.json({ ...cached.data, _cached: true });
    }

    console.log(`✦ Calling Google Vision API (cache miss, ~${Math.round(estimatedBytes / 1024)}KB image)`);

    // Call Google Vision API
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            imageContext: { languageHints: ["en"] }
          }]
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vision API error:", response.status, errText);
      return res.status(502).json({ error: "Google Vision API returned an error", status: response.status });
    }

    const data = await response.json();

    // Store in cache
    ocrCache.set(cacheKey, { data, timestamp: Date.now() });

    res.json(data);
  } catch (err) {
    console.error("OCR endpoint error:", err.message);
    res.status(500).json({ error: "OCR processing failed", detail: err.message });
  }
});

// ── Health Check ──────────────────────────────────────────
app.get("/api/health", (req, res) => {
  const apiConfigured = !!(process.env.GOOGLE_VISION_API_KEY &&
    !process.env.GOOGLE_VISION_API_KEY.includes("your_") &&
    process.env.GOOGLE_VISION_API_KEY.length >= 20);

  res.json({
    status: "ok",
    apiConfigured,
    cacheSize: ocrCache.size,
    uptime: Math.round(process.uptime()) + "s"
  });
});

// ── Start Server ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ Smart CGPA Calculator running on http://localhost:${PORT}`);
  console.log(`  Google Vision API: ${process.env.GOOGLE_VISION_API_KEY ? "✓ Configured" : "✗ NOT configured"}`);
  console.log(`  Rate limit: 15 OCR requests / 15 minutes per IP`);
  console.log(`  Cache TTL: 1 hour`);
});
