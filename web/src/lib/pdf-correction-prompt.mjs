/**
 * pdf-correction-prompt.mjs — construct a targeted correction prompt when
 * a tailored CV fails fact checks, voice checks, title checks, or page budget.
 *
 * When an agent CLI runs in multi-turn conversation mode, this prompt is fed
 * back into the existing session so the agent can inspect its own previous
 * output, understand the exact reason it was rejected, and emit an updated,
 * fully compliant CV envelope without manual user intervention.
 */

/**
 * @typedef {Object} PdfCorrectionPromptArgs
 * @property {string} error - The validation or rendering failure error message.
 * @property {string} [input] - The job posting URL or input identifier.
 * @property {number} [attempt=1] - The current correction attempt (1-based index of correction).
 * @property {number} [maxAttempts=5] - Maximum allowed attempts.
 */

/**
 * Build a structured self-correction prompt for the agent.
 *
 * @param {PdfCorrectionPromptArgs} args
 * @returns {string}
 */
export function buildPdfCorrectionPrompt({ error, input, attempt = 1, maxAttempts = 5 }) {
  const isFactCheck = /fact check failed|drift=|metric-like claims absent|non-metric facts absent/i.test(error);
  const isVoiceCheck = /voice check failed|proven track record|clich/i.test(error);
  const isPageBudget = /page budget|allowed maximum is \d+|CV is \d+ pages?|rendered CV is \d+ pages?|overflow/i.test(error);
  const isTitleMismatch = /title mismatch/i.test(error);

  const sections = [];

  sections.push(
    `The previous tailored CV generation failed validation/rendering (Attempt ${attempt} of ${maxAttempts}).`,
    `Failure diagnostic from the verification gate:\n"""\n${error.trim()}\n"""`,
  );

  const specificRules = [];

  if (attempt >= 4) {
    specificRules.push(
      `HIGH-ATTEMPT PRIORITY (Attempt ${attempt} of ${maxAttempts}):`,
      `- Do NOT creatively rephrase. Revert directly to verbatim cv.md phrasing, tools, and verbs. Trim extra lines aggressively to fit the 2-page ceiling.`,
    );
  }

  if (isFactCheck) {
    specificRules.push(
      `FACT-CHECK & VERB DRIFT FIXES (CRITICAL):`,
      `- VERB DRIFT: Revert any modified action verbs back to their EXACT verbatim form in cv.md (e.g. if cv.md says "Interfaced", do NOT use "Developed"; if cv.md says "Implemented", do NOT use "Executed"). Do not substitute synonyms for action verbs.`,
      `- UNVERIFIED METRICS: Remove any duration, frequency, or metric-like claims (e.g. "5 years", "2 years", percentage gains) that do not appear verbatim in cv.md or config/cv-facts.json.`,
      `- TOOL & SKILL INVENTIONS: Remove or correct any tool/technology names flagged as absent from sources. Never split tools into unverified variants or add punctuation that creates new tool tokens (e.g. "shell", "github actions ci", "a/b fota rollback", "uart)", "zephyr)"). Keep tool names exactly as written in cv.md.`,
    );
  }

  if (isVoiceCheck) {
    specificRules.push(
      `VOICE & ANTI-CLICHÉ FIXES:`,
      `- Remove corporate buzzwords, filler adjectives, or banned clichés (such as "proven track record", "results-driven", "spearheaded", etc.). Keep the candidate's authentic voice and phrasing from cv.md.`,
    );
  }

  if (isPageBudget) {
    specificRules.push(
      `PAGE BUDGET OVERFLOW FIXES:`,
      `- The rendered CV exceeded the allowed page budget (strict 2-page limit).`,
      `- Trim bullet points: remove the least relevant bullets or consolidate short bullets.`,
      `- Shorten descriptions and reduce section whitespace so the final document fits comfortably within 2 pages.`,
    );
  }

  if (isTitleMismatch) {
    specificRules.push(
      `TITLE & METADATA FIXES:`,
      `- Job titles, company names, and dates must match cv.md character-for-character, including exact dashes (e.g. en-dash "–" vs double hyphen "--").`,
    );
  }

  if (specificRules.length > 0) {
    sections.push(specificRules.join("\n"));
  }

  sections.push(
    `INSTRUCTIONS FOR RETRY:`,
    `1. Inspect your previous draft and fix the specific flagged issues above.`,
    `2. Keep all other truthful, relevant tailoring intact.`,
    `3. Output the complete, corrected CV envelope (e.g. <<cv-json>>...<</cv-json>> or <<cv-html>>...<</cv-html>>). Do not output apologies or explanations; emit the corrected envelope directly.`,
  );

  return sections.join("\n\n");
}
