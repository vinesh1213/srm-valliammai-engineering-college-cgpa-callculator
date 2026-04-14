// ═══════════════════════════════════════════════════════════
// OCR Module — Google Vision API (primary) + Tesseract.js (fallback)
// ECE R2023 · SRM Valliammai Engineering College
// ═══════════════════════════════════════════════════════════
// Tesseract.js is loaded globally via <script> tag in index.html

import { API_OCR_ENDPOINT } from "./config.js";
// ── Client-Side Deduplication Cache ──────────────────────
// Prevents re-calling the backend if the same image is re-submitted
const _ocrCache = new Map(); // imageHash → { results, timestamp }
const _CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function _hashFile(file) {
  const buf = await file.arrayBuffer();
  // Hash first 64KB is enough — identical results match start of file
  const sample = buf.slice(0, 65536);
  const hashBuf = await crypto.subtle.digest("SHA-256", sample);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Progress Callback ─────────────────────────────────────
// Callers can pass onProgress(step, message) to get status updates
// step: 1 = "Compressing", 2 = "Scanning", 3 = "Parsing"

/**
 * PRIMARY ENTRY POINT
 * Extracts grade data from a result image file.
 * @param {File} imageFile
 * @param {Function} [onProgress] - optional (step: 1|2|3, msg: string) => void
 * @returns {Promise<Array<{code: string, grade: string}>>}
 */
export async function extractGradesFromImage(imageFile, onProgress = () => {}) {
  // ── Step 0: Dedup check ────────────────────────────────
  const hash = await _hashFile(imageFile);
  const cached = _ocrCache.get(hash);
  if (cached && (Date.now() - cached.timestamp < _CACHE_TTL)) {
    console.log("✦ OCR cache hit — returning cached result");
    onProgress(3, "Using cached result ⚡");
    return cached.results;
  }

  // ── Step 1: Compress image for Vision API ─────────────
  onProgress(1, "Compressing image...");
  let base64;
  try {
    const compressed = await compressForVision(imageFile);
    base64 = await blobToBase64(compressed);
    console.log(`✦ Compressed: ${(imageFile.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB`);
  } catch (compressErr) {
    console.warn("Compression failed, using raw file:", compressErr.message);
    base64 = await fileToBase64(imageFile);
  }

  // ── Step 2: Try Google Vision via backend proxy ────────
  onProgress(2, "Scanning with Google Vision AI...");
  try {
    const response = await fetch(API_OCR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64 })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server responded with ${response.status}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    if (data.responses?.[0]?.fullTextAnnotation) {
      const rawText = data.responses[0].fullTextAnnotation.text;
      console.log("=== Google Vision RAW TEXT ===");
      console.log(rawText);

      // ── Step 3: Parse ──────────────────────────────────
      onProgress(3, "Parsing grades...");
      const results = parseGradesFromText(rawText);

      // Cache the result
      _ocrCache.set(hash, { results, timestamp: Date.now() });

      if (data._cached) console.log("✦ Server-side cache was hit");
      return results;
    }

    throw new Error("No text detected in image");
  } catch (err) {
    console.warn("Google Vision unavailable, falling back to Tesseract.js:", err.message);
    return await extractWithTesseract(imageFile, onProgress);
  }
}

// ── COMPRESSION: Resize + JPEG compress for Vision API ───
/**
 * Resizes image to max 1200px wide and compresses to JPEG ~70%.
 * Google Vision API works well at this resolution and it's ~5-10x smaller.
 * @param {File} imageFile
 * @returns {Promise<Blob>} compressed JPEG blob
 */
async function compressForVision(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 1200;
      const MAX_HEIGHT = 2400;

      let { width, height } = img;

      // Scale down proportionally if too large
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }
      if (height > MAX_HEIGHT) {
        width = Math.round((width * MAX_HEIGHT) / height);
        height = MAX_HEIGHT;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG at 75% quality — excellent for Vision API (text is crisp enough)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Compression failed")),
        "image/jpeg",
        0.75
      );
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = URL.createObjectURL(imageFile);
  });
}

// ── FALLBACK: Tesseract.js (browser-side OCR) ────────────
/**
 * Uses Tesseract.js for offline OCR when Google Vision is unavailable.
 * Applies heavy preprocessing (upscale + binarize) for best accuracy.
 */
async function extractWithTesseract(imageFile, onProgress = () => {}) {
  if (typeof Tesseract === "undefined" || !Tesseract.createWorker) {
    throw new Error("Tesseract.js not loaded. Check your internet connection and refresh.");
  }

  console.log("Starting Tesseract.js OCR...");
  onProgress(1, "Preprocessing image for local OCR...");

  // Preprocess image for better OCR accuracy
  const processedBlob = await preprocessForTesseract(imageFile);

  onProgress(2, "Running local OCR (this may take 10–30s)...");

  // Create Tesseract worker
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const pct = Math.round(m.progress * 100);
        onProgress(2, `Local OCR: ${pct}% complete...`);
      }
    }
  });

  const { data: { text } } = await worker.recognize(processedBlob);
  await worker.terminate();

  console.log("=== Tesseract RAW OCR TEXT ===");
  console.log(text);
  console.log("==============================");

  onProgress(3, "Parsing grades...");
  return parseGradesFromText(text);
}

// ── IMAGE PREPROCESSING for Tesseract ────────────────────
/**
 * Scales up to 2400px wide and binarizes to pure black/white.
 * Tesseract needs high resolution and high contrast images.
 * Handles maroon/red text from SRM result pages.
 */
async function preprocessForTesseract(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");

      // Scale up aggressively — Tesseract works best with large, clear images
      const targetWidth = 2400;
      const scale = Math.max(1, targetWidth / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d");

      // Fill white background first
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw scaled image
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Convert to high-contrast binary (black text on white)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        // Perceived brightness (luminance)
        const luminance = r * 0.299 + g * 0.587 + b * 0.114;

        // Detect dark text (black, maroon, dark red, dark blue)
        const isDark = luminance < 170;

        // Detect saturated colored text (e.g. maroon headers)
        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
        const isColoredText = saturation > 0.4 && luminance < 200;

        // Black for text, white for background
        const val = (isDark || isColoredText) ? 0 : 255;
        pixels[i] = val;
        pixels[i + 1] = val;
        pixels[i + 2] = val;
        pixels[i + 3] = 255;
      }

      ctx.putImageData(imageData, 0, 0);

      console.log(`Image preprocessed: ${img.width}x${img.height} → ${canvas.width}x${canvas.height} (${scale.toFixed(1)}x scale)`);

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Failed to create processed image blob")),
        "image/png"
      );
    };
    img.onerror = () => reject(new Error("Failed to load image for preprocessing"));
    img.src = URL.createObjectURL(imageFile);
  });
}

// ── PARSER: Extract subject codes + grades ────────────────
/**
 * Parses raw OCR text to extract {code, grade} pairs.
 *
 * SRM Valliammai result format:
 *   S.NO.  CODE-SUBJECT NAME                       SEMESTER  GRADE  RESULT
 *   1      EC3561-DIGITAL COMMUNICATION             5        B      PASS
 *   2      EC3562-TRANSMISSION LINES AND WAVEGUIDES 5        U      RA
 */
function parseGradesFromText(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  const seen = new Set();

  // Common Tesseract misreads for grades
  const gradeNormalize = {
    "A-": "A",
    "B-": "B",
    "C+": "C",
    "RA": "U",
    "At": "A+",
    "A#": "A+",
    "A1": "A+",
    "Bt": "B+",
    "B#": "B+",
    "Af": "A+",
  };

  // Subject code pattern
  const codePattern = /\b([A-Z]{2,4}\d{3,4}[A-Z0-9]?)\b/g;

  // Header keywords to skip
  const headerRegex = /S\.?NO|SUBJECT|SEMESTER|RESULT|OFFICE|CONTROLLER|EXAMINATION|NAME\s*:|REGISTER|COURSE|VALLIAMMAI|Autonomous|SRM\s*Nagar|Kattankulathur|End.Semester|UG\s*&|PG\s*End/i;

  // ── Strategy 1: Find "CODE ... GRADE PASS/RA" pattern ──
  for (const line of lines) {
    if (headerRegex.test(line)) continue;

    const codes = [...line.matchAll(codePattern)].map(m => m[1]);
    if (codes.length === 0) continue;

    const code = codes[0];
    if (seen.has(code)) continue;

    // Pattern: semester_digit  GRADE  PASS|RA
    const m1 = line.match(/\d\s+(O|A\+|A\-|A|B\+|B\-|B|C\+|C|U)\s+(PASS|RA|FAIL)/i);
    if (m1) {
      const grade = normalizeGrade(m1[1].toUpperCase(), gradeNormalize);
      if (grade) { results.push({ code, grade }); seen.add(code); continue; }
    }

    // Pattern: GRADE right before PASS/RA at end of line
    const m2 = line.match(/(O|A\+|A\-|A|B\+|B\-|B|C\+|C|U)\s+(PASS|RA|FAIL)\s*$/i);
    if (m2) {
      const grade = normalizeGrade(m2[1].toUpperCase(), gradeNormalize);
      if (grade) { results.push({ code, grade }); seen.add(code); continue; }
    }

    // Pattern: GRADE at end of line after a digit (semester)
    const m3 = line.match(/\d\s+(O|A\+|A\-|A|B\+|B\-|B|C\+|C|U)\s*$/i);
    if (m3) {
      const grade = normalizeGrade(m3[1].toUpperCase(), gradeNormalize);
      if (grade) { results.push({ code, grade }); seen.add(code); continue; }
    }
  }

  // ── Strategy 2: Aggressive right-side token scan ──
  if (results.length < 3) {
    for (const line of lines) {
      if (headerRegex.test(line)) continue;

      const codes = [...line.matchAll(codePattern)].map(m => m[1]);
      if (codes.length === 0) continue;

      const code = codes[0];
      if (seen.has(code)) continue;

      const tokens = line.split(/\s+/);
      // Scan from right, skip PASS/RA/FAIL
      for (let i = tokens.length - 1; i >= 0; i--) {
        const raw = tokens[i].toUpperCase().replace(/[.,;:]/g, "");
        if (["PASS", "RA", "FAIL"].includes(raw)) continue;

        const grade = normalizeGrade(raw, gradeNormalize);
        if (grade) {
          results.push({ code, grade });
          seen.add(code);
          break;
        }
      }
    }
  }

  // ── Strategy 3: Pair codes and grades by position ──
  if (results.length < 3) {
    const allCodes = [];
    const allGrades = [];

    for (const line of lines) {
      if (headerRegex.test(line)) continue;

      [...line.matchAll(codePattern)].forEach(m => {
        if (!allCodes.includes(m[1])) allCodes.push(m[1]);
      });

      line.split(/\s+/).forEach(token => {
        const raw = token.toUpperCase().replace(/[.,;:]/g, "");
        if (["PASS", "RA", "FAIL"].includes(raw)) return;
        const grade = normalizeGrade(raw, gradeNormalize);
        if (grade && raw.length <= 2) allGrades.push(grade);
      });
    }

    if (allCodes.length > 0 && allCodes.length === allGrades.length && results.length < allCodes.length) {
      results.length = 0;
      seen.clear();
      for (let i = 0; i < allCodes.length; i++) {
        if (!seen.has(allCodes[i])) {
          results.push({ code: allCodes[i], grade: allGrades[i] });
          seen.add(allCodes[i]);
        }
      }
    }
  }

  console.log(`=== PARSED ${results.length} GRADES ===`);
  console.table(results);
  return results;
}

// ── Grade Normalizer ──────────────────────────────────────
/**
 * Normalize a raw grade string to a valid SRM Valliammai Engineering College grade.
 * Returns null if not a valid grade.
 */
function normalizeGrade(raw, normMap) {
  const normalized = normMap[raw] || raw;
  return ["O", "A+", "A", "B+", "B", "C", "U"].includes(normalized) ? normalized : null;
}

// ── Helpers ───────────────────────────────────────────────

/** Convert File → base64 string (strips data URI prefix) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Convert Blob → base64 string (strips data URI prefix) */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
