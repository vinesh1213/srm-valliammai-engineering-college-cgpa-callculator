// GPA/CGPA Calculation Engine with backlog deduplication
import { GRADE_POINTS } from "./dataset.js";

/**
 * Step 1: Deduplicate — if the same subject code appears in multiple semesters,
 * keep the LATEST entry (last-write wins, simulating arrear clearance).
 */
export function deduplicateSubjects(allEntries) {
  const map = new Map();
  for (const entry of allEntries) {
    map.set(entry.code, entry);
  }
  return Array.from(map.values());
}

/**
 * Step 2: Calculate GPA for a list of subjects (one semester or deduplicated set).
 * Excludes MC subjects and subjects with 0 or missing credits/grades.
 */
export function calcGPA(subjects) {
  const eligible = subjects.filter(s =>
    s.type !== "MC" &&
    s.credits > 0 &&
    s.grade !== null &&
    s.grade !== undefined &&
    s.grade !== ""
  );
  if (eligible.length === 0) return 0;
  const totalWeighted = eligible.reduce((sum, s) => sum + (s.credits * GRADE_POINTS[s.grade]), 0);
  const totalCredits = eligible.reduce((sum, s) => sum + s.credits, 0);
  return parseFloat((totalWeighted / totalCredits).toFixed(2));
}

/**
 * Step 3: Calculate CGPA across multiple semesters.
 * Flattens all semester data, deduplicates, then calculates.
 */
export function calcCGPA(semesterMap) {
  const allEntries = Object.values(semesterMap).flat();
  const deduped = deduplicateSubjects(allEntries);
  return calcGPA(deduped);
}

/**
 * Step 4: Detect backlogs — subjects graded "U".
 */
export function detectBacklogs(semesterMap) {
  const allEntries = Object.values(semesterMap).flat();
  const deduped = deduplicateSubjects(allEntries);
  return deduped.filter(s => s.grade === "U" && s.type !== "MC" && s.credits > 0);
}

/**
 * Step 5: Projected CGPA if all backlogs are cleared with minimum pass grade "C" (5 points).
 */
export function projectedCGPA(semesterMap) {
  const allEntries = Object.values(semesterMap).flat();
  const deduped = deduplicateSubjects(allEntries);
  const simulated = deduped.map(s => s.grade === "U" ? { ...s, grade: "C" } : s);
  return calcGPA(simulated);
}
