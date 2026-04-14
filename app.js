// ═══════════════════════════════════════════════════════════
// SMART CGPA CALCULATOR — Main Application Logic
// ECE R2023 · SRM Valliammai Engineering College
// ═══════════════════════════════════════════════════════════

import { ECE_R2023, GRADES, GRADE_POINTS } from "./dataset.js";
import { calcGPA, calcCGPA, detectBacklogs, projectedCGPA } from "./calculator.js";
import { extractGradesFromImage } from "./ocr.js";

// ── State ─────────────────────────────────────────────────
let mode = "manual";
let selectedSemesters = new Set();
let gradeMap = {};

// ── DOM References ────────────────────────────────────────
const subjectCardsContainer = document.getElementById("subject-cards");
const manualSection = document.getElementById("manual-section");
const uploadSection = document.getElementById("upload-section");
const cgpaDisplay = document.getElementById("cgpa-number");
const cgpaRing = document.getElementById("cgpa-ring");
const semBreakdown = document.getElementById("sem-breakdown");
const backlogSection = document.getElementById("backlog-section");
const statsGrid = document.getElementById("stats-grid");
const gradeDistribution = document.getElementById("grade-distribution");

// ── Mode Toggle ───────────────────────────────────────────
document.querySelectorAll(".toggle-option").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    manualSection.style.display = mode === "manual" ? "block" : "none";
    uploadSection.style.display = mode === "upload" ? "block" : "none";
  });
});

// ── Semester Pill Selector ────────────────────────────────
document.querySelectorAll(".sem-pill").forEach(pill => {
  pill.addEventListener("click", () => {
    const sem = pill.dataset.sem;
    if (selectedSemesters.has(sem)) {
      selectedSemesters.delete(sem);
      pill.classList.remove("active");
    } else {
      selectedSemesters.add(sem);
      pill.classList.add("active");
    }
    renderSubjectCards();
    updateResults();
  });
});

// ── Render Subject Cards (Manual Mode) ────────────────────
function renderSubjectCards() {
  subjectCardsContainer.innerHTML = "";

  if (selectedSemesters.size === 0) {
    subjectCardsContainer.innerHTML = `
      <div class="empty-state animate">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">Select semesters above to begin entering your grades</div>
        <div class="empty-state-hint">You can select multiple semesters for CGPA calculation</div>
      </div>
    `;
    return;
  }

  [...selectedSemesters].sort().forEach((sem, i) => {
    const allSubjects = ECE_R2023[sem];
    const subjects = allSubjects.filter(s => s.type !== "MC" && s.credits > 0);
    const totalCredits = subjects.reduce((s, x) => s + x.credits, 0);

    // Calculate per-semester GPA for the header badge
    const semSubjects = subjects.map(s => ({ ...s, grade: gradeMap[s.code] || null }));
    const semGPA = calcGPA(semSubjects);

    const card = document.createElement("div");
    card.className = `card animate delay-${(i % 5) + 1}`;
    card.innerHTML = `
      <div class="card-header">
        <div>
          <span class="card-title">Semester ${sem}</span>
          <span class="card-meta" style="margin-left:12px">${subjects.length} subjects · ${totalCredits} credits</span>
        </div>
        <span class="card-gpa" id="sem-gpa-${sem}">${semGPA > 0 ? semGPA.toFixed(2) : '—'}</span>
      </div>
      <div class="fill-all-row">
        <span class="fill-all-label">Fill all:</span>
        <select class="grade-select fill-all-select" data-sem="${sem}" style="width:110px">
          <option value="">— Select —</option>
          ${GRADES.map(g => `<option value="${g}">${g}</option>`).join("")}
        </select>
      </div>
      <div class="subject-table">
        ${subjects.map(s => {
          const grade = gradeMap[s.code] || "";
          const points = grade ? (s.credits * GRADE_POINTS[grade]) : null;
          const isBacklog = grade === "U";
          const gradeClass = getGradeClass(grade);
          return `
            <div class="subject-row ${isBacklog ? 'backlog' : ''}" id="row-${s.code}">
              <span class="subject-code">${s.code}</span>
              <span class="subject-name" title="${s.name}">${s.name}</span>
              <span class="subject-credits">${s.credits}cr</span>
              <select class="grade-select ${gradeClass}" data-code="${s.code}" data-sem="${sem}">
                <option value="">— Grade —</option>
                ${GRADES.map(g => `<option value="${g}" ${grade === g ? "selected" : ""}>${g}</option>`).join("")}
              </select>
              <span class="subject-points ${points !== null ? 'has-value' : ''}">${points !== null ? points : '—'}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
    subjectCardsContainer.appendChild(card);
  });

  // Bind grade change events
  document.querySelectorAll(".grade-select:not(.fill-all-select)").forEach(sel => {
    sel.addEventListener("change", () => {
      const code = sel.dataset.code;
      gradeMap[code] = sel.value || undefined;

      // Update the grade-select color class
      sel.className = `grade-select ${getGradeClass(sel.value)}`;

      // Update points display
      const row = document.getElementById(`row-${code}`);
      if (row) {
        const subject = findSubject(code);
        const pointsEl = row.querySelector(".subject-points");
        if (sel.value && subject) {
          const pts = subject.credits * GRADE_POINTS[sel.value];
          pointsEl.textContent = pts;
          pointsEl.classList.add("has-value");
        } else {
          pointsEl.textContent = "—";
          pointsEl.classList.remove("has-value");
        }
        // Toggle backlog class
        row.classList.toggle("backlog", sel.value === "U");
      }

      updateResults();
    });
  });

  // Bind fill-all selects
  document.querySelectorAll(".fill-all-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const sem = sel.dataset.sem;
      const grade = sel.value;
      if (!grade) return;

      const subjects = ECE_R2023[sem].filter(s => s.type !== "MC" && s.credits > 0);
      subjects.forEach(s => {
        gradeMap[s.code] = grade;
      });

      // Re-render to update all dropdowns
      renderSubjectCards();
      updateResults();
      showToast(`All Sem ${sem} subjects set to ${grade}`, "success");
    });
  });
}

// ── Find Subject by Code ──────────────────────────────────
function findSubject(code) {
  for (const sem of Object.values(ECE_R2023)) {
    const found = sem.find(s => s.code === code);
    if (found) return found;
  }
  return null;
}

// ── Get Grade CSS Class ───────────────────────────────────
function getGradeClass(grade) {
  if (!grade) return "";
  const map = { "O": "grade-O", "A+": "grade-Ap", "A": "grade-A", "B+": "grade-Bp", "B": "grade-B", "C": "grade-C", "U": "grade-U" };
  return map[grade] || "";
}

// ── Update Results Panel ──────────────────────────────────
function updateResults() {
  const semesterMap = {};
  let totalCredits = 0;
  let completedCredits = 0;
  let totalSubjects = 0;
  let gradedSubjects = 0;

  [...selectedSemesters].forEach(sem => {
    semesterMap[sem] = ECE_R2023[sem]
      .filter(s => s.type !== "MC" && s.credits > 0)
      .map(s => {
        const grade = gradeMap[s.code] || null;
        totalSubjects++;
        totalCredits += s.credits;
        if (grade) {
          gradedSubjects++;
          if (grade !== "U") completedCredits += s.credits;
        }
        return { ...s, grade };
      });
  });

  // Per-semester GPA
  const semGPAs = {};
  Object.entries(semesterMap).forEach(([sem, subjects]) => {
    semGPAs[sem] = calcGPA(subjects);
    // Update card header badge
    const badge = document.getElementById(`sem-gpa-${sem}`);
    if (badge) badge.textContent = semGPAs[sem] > 0 ? semGPAs[sem].toFixed(2) : "—";
  });

  // Overall CGPA
  const cgpa = calcCGPA(semesterMap);
  const backlogs = detectBacklogs(semesterMap);
  const projected = backlogs.length > 0 ? projectedCGPA(semesterMap) : null;

  // Animate CGPA counter
  animateCounter(cgpaDisplay, cgpa);

  // Draw ring
  drawCGPARing(cgpa);

  // Update stats
  updateStats(totalSubjects, gradedSubjects, totalCredits, completedCredits);

  // Render semester breakdown bars
  renderSemBreakdown(semGPAs);

  // Render grade distribution
  renderGradeDistribution();

  // Render backlog alerts
  renderBacklogs(backlogs, projected);
}

// ── Update Stats Grid ─────────────────────────────────────
function updateStats(totalSubjects, gradedSubjects, totalCredits, completedCredits) {
  statsGrid.innerHTML = `
    <div class="stat-item animate-fade">
      <div class="stat-value">${selectedSemesters.size}</div>
      <div class="stat-label">Semesters</div>
    </div>
    <div class="stat-item animate-fade">
      <div class="stat-value">${gradedSubjects}/${totalSubjects}</div>
      <div class="stat-label">Graded</div>
    </div>
    <div class="stat-item animate-fade">
      <div class="stat-value">${totalCredits}</div>
      <div class="stat-label">Total Credits</div>
    </div>
    <div class="stat-item animate-fade">
      <div class="stat-value">${completedCredits}</div>
      <div class="stat-label">Earned Credits</div>
    </div>
  `;
}

// ── Render Semester Breakdown ─────────────────────────────
function renderSemBreakdown(semGPAs) {
  const entries = Object.entries(semGPAs).filter(([, gpa]) => gpa > 0);

  if (entries.length === 0) {
    semBreakdown.innerHTML = "";
    return;
  }

  semBreakdown.innerHTML = `
    <div class="sem-breakdown-title">Semester GPAs</div>
    ${entries.map(([sem, gpa]) => `
      <div class="sem-bar-item">
        <span class="sem-bar-label">Sem ${sem}</span>
        <div class="sem-bar-track">
          <div class="sem-bar-fill" style="width:${(gpa / 10) * 100}%"></div>
        </div>
        <span class="sem-bar-value">${gpa.toFixed(2)}</span>
      </div>
    `).join("")}
  `;
}

// ── Render Grade Distribution ─────────────────────────────
function renderGradeDistribution() {
  const counts = {};
  GRADES.forEach(g => counts[g] = 0);

  Object.values(gradeMap).forEach(g => {
    if (g && counts[g] !== undefined) counts[g]++;
  });

  const max = Math.max(1, ...Object.values(counts));
  const gradeClassMap = { "O": "O", "A+": "Ap", "A": "A", "B+": "Bp", "B": "B", "C": "C", "U": "U" };

  const hasAnyGrade = Object.values(counts).some(c => c > 0);
  if (!hasAnyGrade) {
    gradeDistribution.innerHTML = "";
    return;
  }

  gradeDistribution.innerHTML = `
    <div class="sem-breakdown-title" style="margin-top:20px">Grade Distribution</div>
    <div class="grade-distribution">
      ${GRADES.map(g => {
        const count = counts[g];
        const height = count > 0 ? Math.max(8, (count / max) * 48) : 4;
        return `<div class="grade-dist-bar grade-bar-${gradeClassMap[g]}" style="height:${height}px" data-label="${g}(${count})" title="${g}: ${count}"></div>`;
      }).join("")}
    </div>
  `;
}

// ── Render Backlog Warnings ───────────────────────────────
function renderBacklogs(backlogs, projected) {
  if (backlogs.length === 0) {
    backlogSection.innerHTML = "";
    return;
  }

  backlogSection.innerHTML = `
    <div class="backlog-card animate-fade">
      <div class="backlog-header">
        <div class="backlog-icon">⚠️</div>
        <div>
          <div class="backlog-title">Backlogs Detected</div>
          <div class="backlog-count">${backlogs.length} subject${backlogs.length > 1 ? 's' : ''} with U grade</div>
        </div>
      </div>
      <div class="backlog-list">
        ${backlogs.map(b => `
          <div class="backlog-item">
            <span class="code">${b.code}</span>
            <span class="name">${b.name}</span>
            <span class="grade-pill grade-pill-U">U</span>
          </div>
        `).join("")}
      </div>
      ${projected ? `
        <div class="backlog-projected">
          <span class="label">After clearing all backlogs (min C grade):</span>
          <span class="value">${projected.toFixed(2)}</span>
        </div>
      ` : ""}
    </div>
  `;
}

// ── CGPA Ring (SVG) ───────────────────────────────────────
function drawCGPARing(cgpa) {
  const pct = Math.min(cgpa / 10, 1);
  const r = 72;
  const cx = 90;
  const cy = 90;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  // Color based on CGPA
  let color = "#f5a623";
  if (cgpa >= 9) color = "#f5a623";
  else if (cgpa >= 8) color = "#22c55e";
  else if (cgpa >= 7) color = "#4ade80";
  else if (cgpa >= 6) color = "#60a5fa";
  else if (cgpa >= 5) color = "#fbbf24";
  else if (cgpa > 0) color = "#ef4444";

  cgpaRing.innerHTML = `
    <svg width="180" height="180" viewBox="0 0 180 180">
      <!-- Track -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="10" opacity="0.5"/>
      <!-- Tick marks -->
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => {
        const angle = (-90 + (v / 10) * 360) * (Math.PI / 180);
        const x1 = cx + (r - 6) * Math.cos(angle);
        const y1 = cy + (r - 6) * Math.sin(angle);
        const x2 = cx + (r + 6) * Math.cos(angle);
        const y2 = cy + (r + 6) * Math.sin(angle);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--border-light)" stroke-width="1.5" opacity="0.4"/>`;
      }).join("")}
      <!-- Fill arc -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
        stroke-linecap="round"
        transform="rotate(-90 ${cx} ${cy})"
        style="transition: stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1), stroke 0.6s ease; filter: drop-shadow(0 0 8px ${color}40)"/>
      <!-- Glow circle at end -->
      ${pct > 0.01 ? (() => {
        const endAngle = (-90 + pct * 360) * (Math.PI / 180);
        const ex = cx + r * Math.cos(endAngle);
        const ey = cy + r * Math.sin(endAngle);
        return `<circle cx="${ex}" cy="${ey}" r="5" fill="${color}" opacity="0.8" style="transition: all 1s ease">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite"/>
        </circle>`;
      })() : ""}
    </svg>
  `;
}

// ── Animated Counter ──────────────────────────────────────
function animateCounter(el, target) {
  const start = parseFloat(el.textContent) || 0;
  const duration = 1000;
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    el.textContent = (start + (target - start) * ease).toFixed(2);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Toast Notification ────────────────────────────────────
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"}</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ═══════════════════════════════════════════════════════════
// OCR Upload Mode
// ═══════════════════════════════════════════════════════════

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("result-upload");
const imagePreview = document.getElementById("image-preview");
const extractBtn = document.getElementById("extract-btn");
const ocrStatus = document.getElementById("ocr-status");
const ocrResultTable = document.getElementById("ocr-result-table");

// Click to browse
dropzone?.addEventListener("click", (e) => {
  if (e.target !== fileInput) fileInput.click();
});

// Drag states
dropzone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleFilePreview(e.dataTransfer.files[0]);
  }
});

// File input change
fileInput?.addEventListener("change", () => {
  if (fileInput.files[0]) handleFilePreview(fileInput.files[0]);
});

function handleFilePreview(file) {
  if (!file.type.startsWith("image/")) {
    showToast("Please upload an image file", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  imagePreview.innerHTML = `<img src="${url}" alt="Result preview"/>`;

  // Show file size
  const sizeKB = (file.size / 1024).toFixed(0);
  const sizeLabel = file.size > 1024 * 1024
    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
    : `${sizeKB} KB`;
  ocrStatus.textContent = `Image loaded (${sizeLabel}). Click 'Extract Grades' to scan.`;
  ocrStatus.style.color = "";

  // Reset stepper
  setStep(0);
}

// ── 3-Step Progress Stepper ───────────────────────────────
function setStep(step) {
  // step: 0=idle, 1=compress, 2=scan, 3=parse, 4=done
  [1, 2, 3].forEach(n => {
    const el = document.getElementById(`ocr-step-${n}`);
    if (!el) return;
    el.classList.remove("active", "done");
    if (n < step) el.classList.add("done");
    else if (n === step) el.classList.add("active");
  });
}

// Extract button
extractBtn?.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    showToast("Please upload an image first", "error");
    return;
  }

  extractBtn.disabled = true;
  extractBtn.innerHTML = '<span class="spinner"></span> Scanning...';
  ocrResultTable.innerHTML = "";
  ocrStatus.style.color = "";

  const onProgress = (step, msg) => {
    setStep(step);
    ocrStatus.textContent = msg;
  };

  try {
    const extracted = await extractGradesFromImage(file, onProgress);
    setStep(4);

    if (extracted.length === 0) {
      ocrStatus.textContent = "⚠ No grades could be extracted. Try a clearer image or use Manual Entry.";
      ocrStatus.style.color = "var(--danger)";
      showToast("No grades found in image", "error");
    } else if (extracted.length < 5) {
      renderOCRTable(extracted);
      ocrStatus.textContent = `⚠ Found only ${extracted.length} subject(s) — review carefully and fill missing grades manually.`;
      ocrStatus.style.color = "var(--warning, #fbbf24)";
      showToast(`Extracted ${extracted.length} grades (partial)`, "info");
    } else {
      renderOCRTable(extracted);
      ocrStatus.textContent = `✓ Found ${extracted.length} subjects. Review grades below, then click Calculate CGPA.`;
      ocrStatus.style.color = "var(--success, #22c55e)";
      showToast(`Extracted ${extracted.length} grades`, "success");
    }
  } catch (e) {
    console.error("OCR Error:", e);
    setStep(0);
    ocrStatus.textContent = "OCR failed. Try a clearer image or manually enter grades.";
    ocrStatus.style.color = "var(--danger)";
    showToast("OCR extraction failed", "error");
  } finally {
    extractBtn.disabled = false;
    extractBtn.innerHTML = '◈ Extract Grades';
  }
});

// Render OCR extracted table
function renderOCRTable(entries) {
  const allSubjects = Object.values(ECE_R2023).flat();

  // Auto-detect semesters from extracted codes and select them
  entries.forEach(e => {
    for (const [sem, subjects] of Object.entries(ECE_R2023)) {
      if (subjects.find(s => s.code === e.code)) {
        selectedSemesters.add(sem);
        document.querySelector(`.sem-pill[data-sem="${sem}"]`)?.classList.add("active");
        break;
      }
    }
    gradeMap[e.code] = e.grade;
  });

  ocrResultTable.innerHTML = `
    <table class="ocr-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Subject</th>
          <th>Grade</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(e => {
          const match = allSubjects.find(s => s.code === e.code);
          return `
            <tr>
              <td class="mono">${e.code}</td>
              <td style="color:${match ? 'var(--text-secondary)' : 'var(--danger)'}">${match ? match.name : "⚠ Unknown code"}</td>
              <td>
                <select class="grade-select ocr-grade-select ${getGradeClass(e.grade)}" data-code="${e.code}">
                  ${GRADES.map(g => `<option value="${g}" ${e.grade === g ? "selected" : ""}>${g}</option>`).join("")}
                </select>
              </td>
              <td class="${match ? 'status-ok' : 'status-unknown'}">${match ? "✓ Matched" : "✗ Unknown"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
    <div style="margin-top:20px; display:flex; gap:12px;">
      <button class="btn-primary" id="ocr-calc-btn">◈ Calculate CGPA</button>
      <button class="btn-secondary" id="ocr-manual-btn">Switch to Manual</button>
    </div>
  `;

  // Bind OCR grade selects
  document.querySelectorAll(".ocr-grade-select").forEach(sel => {
    sel.addEventListener("change", () => {
      gradeMap[sel.dataset.code] = sel.value;
      sel.className = `grade-select ocr-grade-select ${getGradeClass(sel.value)}`;
    });
  });

  // Calculate button
  document.getElementById("ocr-calc-btn")?.addEventListener("click", () => {
    updateResults();
    showToast("CGPA calculated!", "success");
    // Scroll to results on mobile
    if (window.innerWidth < 1100) {
      document.querySelector(".results-panel")?.scrollIntoView({ behavior: "smooth" });
    }
  });

  // Switch to manual
  document.getElementById("ocr-manual-btn")?.addEventListener("click", () => {
    mode = "manual";
    document.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
    document.querySelector('[data-mode="manual"]')?.classList.add("active");
    manualSection.style.display = "block";
    uploadSection.style.display = "none";
    renderSubjectCards();
    updateResults();
  });
}

// ── Initialize ────────────────────────────────────────────
drawCGPARing(0);
updateStats(0, 0, 0, 0);
