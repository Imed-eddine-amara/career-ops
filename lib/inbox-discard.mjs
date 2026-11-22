/**
 * lib/inbox-discard.mjs — Moves an inbox job into the Discarded panel (data/applications.md)
 * and marks it as seen so future searches never re-import it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot, resolveTrackerPathForWrite } from '../path-resolver.mjs';
import { openTrackerTransaction } from '../tracker-utils.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { appendToScanHistory } from '../scan.mjs';
import { postingUrl } from '../web/src/lib/posting-url.mjs';

/**
 * Determine a concise vendor label from an HTTP job posting URL.
 * @param {string} url
 * @returns {string}
 */
export function vendorFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('bamboohr.com')) return 'bamboohr';
    if (host.includes('dayforcehcm.com')) return 'dayforce';
    if (host.includes('icims.com')) return 'icims';
    return host.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

/**
 * Remove matching URL from pipeline.md content (Pending section).
 * @param {string} text
 * @param {string} targetUrl
 * @returns {{ ok: boolean, text: string, removed: boolean }}
 */
export function removeUrlFromPipeline(text, targetUrl) {
  const norm = postingUrl(targetUrl);
  if (!norm) return { ok: false, text, removed: false };

  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let removed = false;

  for (const line of lines) {
    if (line.includes(targetUrl) || (norm && line.includes(norm))) {
      removed = true;
      continue;
    }
    out.push(line);
  }

  return { ok: true, text: out.join(nl), removed };
}

/**
 * Discard an inbox job:
 * 1. Inserts or updates a row with Status 'Discarded' in data/applications.md.
 * 2. Logs transition in data/status-log.tsv.
 * 3. Removes URL from data/pipeline.md under lock.
 * 4. Appends to data/scan-history.tsv so future scans mark it as seen.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.company]
 * @param {string} [params.role]
 * @param {string} [params.reason]
 * @param {string} [params.root]
 * @returns {Promise<{ ok: boolean, n?: number, status: string, error?: string }>}
 */
export async function discardInboxJob({
  url,
  company = '',
  role = '',
  reason = 'Discarded from inbox',
  root = null,
} = {}) {
  const validUrl = postingUrl(url);
  if (!validUrl) {
    return { ok: false, error: 'invalid-url', status: 'error' };
  }

  const dataRoot = root || getCareerOpsRoot();
  const trackerPath = resolveTrackerPathForWrite(dataRoot);
  const pipelinePath = path.join(dataRoot, 'data', 'pipeline.md');
  const scanHistoryPath = path.join(dataRoot, 'data', 'scan-history.tsv');
  const statusLogPath = path.join(dataRoot, 'data', 'status-log.tsv');
  const today = new Date().toISOString().slice(0, 10);

  let appNum = 0;

  // 1. Update or append row in data/applications.md under tracker lock
  const tx = await openTrackerTransaction(trackerPath);
  try {
    const text = tx.read();
    const lines = text.split(/\r?\n/);
    const nl = text.includes('\r\n') ? '\r\n' : '\n';

    let existingRowIdx = -1;
    let maxId = 0;
    let lastTableIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        lastTableIdx = i;
      }
      const matchNum = trimmed.match(/^\|\s*(\d+)\s*\|/);
      if (matchNum) {
        const id = parseInt(matchNum[1], 10);
        if (id > maxId) maxId = id;

        // Check if this row already has the target URL
        if (line.includes(validUrl) || (url && line.includes(url))) {
          existingRowIdx = i;
          appNum = id;
        }
      }
    }

    if (existingRowIdx !== -1) {
      // Row already exists: update its status to Discarded
      const parts = lines[existingRowIdx].split('|');
      // Rebuild with Status = Discarded
      // Canonical 10 cols: | # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
      if (parts.length >= 7) {
        parts[6] = ' Discarded ';
      }
      if (parts.length >= 10 && reason) {
        const currentNotes = parts[9].trim();
        if (!currentNotes.includes(reason)) {
          parts[9] = currentNotes ? ` ${currentNotes}; ${reason} ` : ` ${reason} `;
        }
      }
      lines[existingRowIdx] = parts.join('|');
    } else {
      // Row does not exist: create next row
      appNum = maxId + 1;
      const vendor = vendorFromUrl(validUrl);
      const cleanCompany = (company || 'Company').trim();
      const cleanRole = (role || 'Position').trim();
      const newRow = `| ${appNum} | ${today} | ${cleanCompany} | ${cleanRole} | — | Discarded | ❌ | — | ${reason} | [${vendor}](${validUrl}) |`;

      if (lastTableIdx !== -1) {
        lines.splice(lastTableIdx + 1, 0, newRow);
      } else {
        lines.push(newRow);
      }
    }

    tx.replace(lines.join(nl));
  } finally {
    tx.close();
  }

  // 2. Append to status-log.tsv
  try {
    if (appNum > 0 && fs.existsSync(path.dirname(statusLogPath))) {
      const logEntry = `${appNum}\t${today}\tInbox\tDiscarded\tweb\t${reason}\n`;
      fs.appendFileSync(statusLogPath, logEntry, 'utf8');
    }
  } catch {
    // non-fatal status log failure
  }

  // 3. Remove URL from data/pipeline.md under lock
  if (fs.existsSync(pipelinePath)) {
    try {
      await withPipelineLock(pipelinePath, async () => {
        const pText = fs.readFileSync(pipelinePath, 'utf8');
        const pruned = removeUrlFromPipeline(pText, validUrl);
        if (pruned.removed) {
          fs.writeFileSync(`${pipelinePath}.bak`, pText, 'utf8');
          fs.writeFileSync(pipelinePath, pruned.text, 'utf8');
        }
      });
    } catch {
      // non-fatal pipeline prune
    }
  }

  // 4. Record into scan-history.tsv so future scans consider it seen
  try {
    if (fs.existsSync(scanHistoryPath)) {
      await appendToScanHistory(
        [{ url: validUrl, title: role || '', company: company || '' }],
        today,
        'skipped_discarded',
        { historyPath: scanHistoryPath, alreadyLocked: false },
      );
    }
  } catch {
    // non-fatal scan-history write
  }

  return { ok: true, n: appNum, status: 'Discarded' };
}
