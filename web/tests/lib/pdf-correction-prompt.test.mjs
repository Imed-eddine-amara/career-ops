import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdfCorrectionPrompt } from "../../src/lib/pdf-correction-prompt.mjs";

test("buildPdfCorrectionPrompt generates targeted instructions for fact-check & verb drift errors", () => {
  const error = `Fact check failed for cv-web-005.html: metric-like claims absent from sources: 5 years; non-metric facts absent from sources: tool=github actions ci, tool=shell. drift=developed (source says: Interfaced)`;
  const prompt = buildPdfCorrectionPrompt({ error, attempt: 1, maxAttempts: 3 });

  assert.match(prompt, /Attempt 1 of 3/);
  assert.match(prompt, /Fact check failed for cv-web-005.html/);
  assert.match(prompt, /FACT-CHECK & VERB DRIFT FIXES/);
  assert.match(prompt, /VERB DRIFT: Revert any modified action verbs/);
  assert.match(prompt, /UNVERIFIED METRICS: Remove any duration/);
  assert.match(prompt, /TOOL & SKILL INVENTIONS: Remove or correct any tool/);
  assert.match(prompt, /Output the complete, corrected CV envelope/);
});

test("buildPdfCorrectionPrompt includes voice check rules when clichés are flagged", () => {
  const error = `Voice check failed for cv-web-005.html: "proven track record". That wording is not in the source CV. Keep the candidate's own words.`;
  const prompt = buildPdfCorrectionPrompt({ error, attempt: 2, maxAttempts: 3 });

  assert.match(prompt, /Attempt 2 of 3/);
  assert.match(prompt, /VOICE & ANTI-CLICHÉ FIXES/);
  assert.match(prompt, /proven track record/);
});

test("buildPdfCorrectionPrompt includes page budget trimming rules for page overflow", () => {
  const error = `The rendered CV is 3 pages; allowed maximum is 2. Trim bullet points or spacing to fit within 2 pages.`;
  const prompt = buildPdfCorrectionPrompt({ error, attempt: 1, maxAttempts: 3 });

  assert.match(prompt, /PAGE BUDGET OVERFLOW FIXES/);
  assert.match(prompt, /Trim bullet points/);
  assert.match(prompt, /strict 2-page limit/);
});

test("buildPdfCorrectionPrompt includes title mismatch guidance", () => {
  const error = `Title mismatch for Fréquence Santec (Jun 2026 - Aug 2026): cv.md says "Embedded Systems and IoT Intern – ColdGuard", tailored CV says "Embedded Systems and IoT Intern -- ColdGuard".`;
  const prompt = buildPdfCorrectionPrompt({ error, attempt: 1, maxAttempts: 3 });

  assert.match(prompt, /TITLE & METADATA FIXES/);
  assert.match(prompt, /character-for-character/);
});

test("buildPdfCorrectionPrompt handles multiple simultaneous issues cleanly", () => {
  const error = `❌ PDF generation failed: Fact check failed: drift=executed (source says: Implemented). Voice check failed: "proven track record". CV is 3 pages; the allowed maximum is 2 pages.`;
  const prompt = buildPdfCorrectionPrompt({ error, attempt: 2, maxAttempts: 5 });

  assert.match(prompt, /Attempt 2 of 5/);
  assert.match(prompt, /FACT-CHECK & VERB DRIFT FIXES/);
  assert.match(prompt, /VOICE & ANTI-CLICHÉ FIXES/);
  assert.match(prompt, /PAGE BUDGET OVERFLOW FIXES/);
});

test("buildPdfCorrectionPrompt includes high-attempt priority on attempt 4 and 5", () => {
  const error = `Fact check failed: drift=built (source says: Developed).`;
  const prompt4 = buildPdfCorrectionPrompt({ error, attempt: 4, maxAttempts: 5 });
  assert.match(prompt4, /Attempt 4 of 5/);
  assert.match(prompt4, /HIGH-ATTEMPT PRIORITY/);
  assert.match(prompt4, /Do NOT creatively rephrase/);

  const prompt5 = buildPdfCorrectionPrompt({ error, attempt: 5, maxAttempts: 5 });
  assert.match(prompt5, /Attempt 5 of 5/);
  assert.match(prompt5, /HIGH-ATTEMPT PRIORITY/);
});
