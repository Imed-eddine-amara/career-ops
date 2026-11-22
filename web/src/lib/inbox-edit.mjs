/**
 * web/src/lib/inbox-edit.mjs — Modify or delete individual rows in data/pipeline.md.
 * Pure/browser-safe transformations.
 */

import { postingUrl } from "./posting-url.mjs";
import { sectionKind } from "./core/pipeline-sections.mjs";

const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX!])\](.*)$/;

/**
 * Replace oldUrl with newUrl on matching rows in pipeline.md text.
 * Preserves company, role, location, and tags.
 *
 * @param {string} text
 * @param {string} oldUrl
 * @param {string} newUrl
 * @returns {{ ok: true, text: string, changed: number } | { ok: false, error: string }}
 */
export function applyInboxUrlEdit(text, oldUrl, newUrl) {
  const oldParsed = postingUrl(oldUrl);
  if (!oldParsed) return { ok: false, error: "invalid-old-url" };
  const newParsed = postingUrl(newUrl);
  if (!newParsed) return { ok: false, error: "invalid-new-url" };

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailing = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hasTrailing && lines[lines.length - 1] === "") lines.pop();

  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CHECKBOX_LINE);
    if (!match) continue;

    const rest = match[3];
    const parts = rest.split("|");
    const lineUrl = postingUrl(parts[0]?.trim());

    if (lineUrl === oldParsed) {
      parts[0] = ` ${newParsed} `;
      lines[i] = `${match[1]}[${match[2]}]${parts.join("|")}`;
      changed++;
    }
  }

  if (changed === 0) return { ok: false, error: "unmatched" };
  return { ok: true, text: lines.join(newline) + (hasTrailing ? newline : ""), changed };
}

/**
 * Remove matching row from pipeline.md text completely.
 *
 * @param {string} text
 * @param {string} url
 * @returns {{ ok: true, text: string, removedRow: string, changed: number } | { ok: false, error: string }}
 */
export function applyInboxDelete(text, url) {
  const parsed = postingUrl(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailing = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hasTrailing && lines[lines.length - 1] === "") lines.pop();

  const newLines = [];
  let removedRow = "";
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CHECKBOX_LINE);
    if (!match) {
      newLines.push(lines[i]);
      continue;
    }

    const rest = match[3];
    const lineUrl = postingUrl(rest.split("|")[0]?.trim());

    if (lineUrl === parsed) {
      removedRow = lines[i];
      changed++;
      continue; // drop line
    }

    newLines.push(lines[i]);
  }

  if (changed === 0) return { ok: false, error: "unmatched" };
  return {
    ok: true,
    text: newLines.join(newline) + (hasTrailing ? newline : ""),
    removedRow,
    changed,
  };
}
