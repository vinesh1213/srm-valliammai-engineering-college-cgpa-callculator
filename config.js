/**
 * Backend Configuration
 * ECE R2023 · SRM Valliammai Engineering College
 *
 * Provides environment-aware API endpoint URLs so the same
 * frontend code works on both localhost and Render production.
 */

// Detect if running on Render or localhost
const getBackendUrl = () => {
  const isDev =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isDev) {
    // Local development — Express server runs on port 3000
    return "http://localhost:3000";
  } else {
    // Production (Render) — frontend and backend share the same origin
    return window.location.origin;
  }
};

export const API_BASE_URL = getBackendUrl();
export const API_OCR_ENDPOINT = `${API_BASE_URL}/api/ocr`;
export const API_HEALTH_ENDPOINT = `${API_BASE_URL}/api/health`;

console.log(`✓ Backend configured: ${API_BASE_URL}`);
