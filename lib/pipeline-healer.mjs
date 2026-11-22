/**
 * lib/pipeline-healer.mjs — Automated detection, healing, and retirement for
 * broken, expired, redirected, board-level, and empty pipeline URLs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { checkLivenessViaApi } from '../liveness-api.mjs';
import { fetchJdViaKnownApi } from '../browser-extract.mjs';
import { sectionKind } from './pipeline-sections.mjs';
import { appendToScanHistory } from '../scan.mjs';
import { localToday } from './local-today.mjs';
import { discardInboxJob } from './inbox-discard.mjs';

const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX!])\](.*)$/;

/**
 * Identify if a URL is an ATS board directory / company root URL rather than a
 * specific job requisition posting.
 *
 * @param {string} rawUrl
 * @returns {{ isBoard: boolean, vendor: string, slug: string, cleanUrl: string } | null}
 */
export function isBoardUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');

  // 1. Greenhouse: boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug}
  // (Direct posting has /jobs/{id} or ?gh_jid=)
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1 && !u.searchParams.has('gh_jid')) {
      return { isBoard: true, vendor: 'greenhouse', slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 2. Ashby: jobs.ashbyhq.com/{slug}
  // (Direct posting has /{slug}/{uuid})
  if (host === 'jobs.ashbyhq.com') {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1) {
      return { isBoard: true, vendor: 'ashby', slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 3. Lever: jobs.lever.co/{slug} or jobs.eu.lever.co/{slug}
  // (Direct posting has /{slug}/{uuid})
  if (/^jobs\.(?:eu\.)?lever\.co$/.test(host)) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1) {
      return { isBoard: true, vendor: 'lever', slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 4. Workable: apply.workable.com/{slug}
  // (Direct posting has /j/{id})
  if (host === 'apply.workable.com') {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1 && parts[0] !== 'j') {
      return { isBoard: true, vendor: 'workable', slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 5. BambooHR: {slug}.bamboohr.com/careers
  // (Direct posting has /careers/{id} or /jobs/view.php?id={id})
  const bamboo = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/);
  if (bamboo && (path === '/careers' || path === '')) {
    return { isBoard: true, vendor: 'bamboohr', slug: bamboo[1], cleanUrl: trimmed };
  }

  return null;
}

/**
 * Tokenize a job title into normalized keywords, stripping generic noise like
 * internship terms or years so core engineering keywords align.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function titleTokens(text) {
  if (!text) return new Set();
  const normalized = text
    .toLowerCase()
    .replace(/\b(202[4-9]|2030)\b/g, '')
    .replace(/\b(spring|summer|fall|winter)\b/g, '')
    .replace(/[\[\]\(\)\-\—\–\/\,\:\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(/\s+/).filter(w => w.length >= 2);
  return new Set(words);
}

/**
 * Compute similarity score between candidate title and target posting title.
 *
 * @param {string} candidate
 * @param {string} target
 * @returns {number} 0.0 to 1.0
 */
export function titleMatchScore(candidate, target) {
  const cTokens = titleTokens(candidate);
  const tTokens = titleTokens(target);
  if (cTokens.size === 0 || tTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of cTokens) {
    if (tTokens.has(token)) intersection++;
  }

  const minSize = Math.min(cTokens.size, tTokens.size);
  // Containment score: what fraction of the smaller set is in the other
  const containment = intersection / minSize;
  // Jaccard score
  const union = new Set([...cTokens, ...tTokens]).size;
  const jaccard = intersection / union;

  return containment * 0.7 + jaccard * 0.3;
}

/**
 * Resolve a board-level directory URL to a specific job requisition URL
 * by querying the employer's public ATS API and matching role titles.
 *
 * @param {string} boardUrl
 * @param {string} roleTitle
 * @param {string} [company]
 * @param {object} [options]
 * @returns {Promise<{ resolvedUrl: string | null, title?: string, id?: string | number, score?: number, error?: string, status?: number }>}
 */
export async function resolveBoardPosting(boardUrl, roleTitle, company = '', { timeoutMs = 15000 } = {}) {
  const board = isBoardUrl(boardUrl);
  if (!board) return { resolvedUrl: null, error: 'not_a_board_url' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (board.vendor === 'greenhouse') {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (res.status === 404) return { resolvedUrl: null, error: 'board_not_found', status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const data = await res.json();
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0) return { resolvedUrl: null, error: 'board_empty' };

      let bestMatch = null;
      let highestScore = 0;

      for (const job of jobs) {
        const score = titleMatchScore(roleTitle, job.title);
        if (score > highestScore && score >= 0.45) {
          highestScore = score;
          bestMatch = job;
        }
      }

      if (bestMatch) {
        return {
          resolvedUrl: bestMatch.absolute_url,
          title: bestMatch.title,
          id: bestMatch.id,
          score: highestScore,
        };
      }
      return { resolvedUrl: null, error: 'no_matching_role_on_board' };
    }

    if (board.vendor === 'ashby') {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (res.status === 404) return { resolvedUrl: null, error: 'board_not_found', status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const data = await res.json();
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0) return { resolvedUrl: null, error: 'board_empty' };

      let bestMatch = null;
      let highestScore = 0;

      for (const job of jobs) {
        const score = titleMatchScore(roleTitle, job.title);
        if (score > highestScore && score >= 0.45) {
          highestScore = score;
          bestMatch = job;
        }
      }

      if (bestMatch) {
        return {
          resolvedUrl: bestMatch.jobUrl,
          title: bestMatch.title,
          id: bestMatch.id,
          score: highestScore,
        };
      }
      return { resolvedUrl: null, error: 'no_matching_role_on_board' };
    }

    if (board.vendor === 'lever') {
      const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (res.status === 404) return { resolvedUrl: null, error: 'board_not_found', status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const jobs = await res.json();
      if (!Array.isArray(jobs) || jobs.length === 0) return { resolvedUrl: null, error: 'board_empty' };

      let bestMatch = null;
      let highestScore = 0;

      for (const job of jobs) {
        const title = job.text || '';
        const score = titleMatchScore(roleTitle, title);
        if (score > highestScore && score >= 0.45) {
          highestScore = score;
          bestMatch = job;
        }
      }

      if (bestMatch) {
        return {
          resolvedUrl: bestMatch.hostedUrl,
          title: bestMatch.text,
          id: bestMatch.id,
          score: highestScore,
        };
      }
      return { resolvedUrl: null, error: 'no_matching_role_on_board' };
    }

    return { resolvedUrl: null, error: 'unsupported_board_vendor' };
  } catch (err) {
    return { resolvedUrl: null, error: err.message || 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test health and liveness of a specific posting URL.
 *
 * @param {string} url
 * @returns {Promise<{ status: 'active' | 'expired' | 'empty_stub' | 'uncertain', reason?: string, title?: string }>}
 */
export async function checkPostingHealth(url) {
  // First, check ATS API liveness
  const liveness = await checkLivenessViaApi(url).catch(() => null);
  if (liveness) {
    if (liveness.result === 'expired') {
      return { status: 'expired', reason: liveness.reason || 'ATS API confirms posting removed' };
    }
  }

  // Check JD body presence
  const jdResult = await fetchJdViaKnownApi(url).catch(() => null);
  if (jdResult && jdResult.closed) {
    return { status: 'expired', reason: jdResult.evidence || 'Posting flagged closed by ATS' };
  }
  if (jdResult && jdResult.text && jdResult.text.length >= 400) {
    return { status: 'active', title: jdResult.title, reason: 'Valid JD retrieved via API' };
  }

  // If Lever or similar returned active but 0 description body (like field-ai)
  if (liveness && liveness.result === 'active' && (!jdResult || !jdResult.text || jdResult.text.trim().length === 0)) {
    // Specifically Lever empty description check
    const leverMatch = url.match(/^https?:\/\/jobs\.(?:eu\.)?lever\.co\/([^\/]+)\/([a-f0-9-]+)/i);
    if (leverMatch) {
      try {
        const res = await fetch(`https://api.lever.co/v0/postings/${leverMatch[1]}/${leverMatch[2]}`);
        if (res.ok) {
          const json = await res.json();
          if (!json.description && !json.descriptionPlain && (!json.lists || json.lists.length === 0)) {
            return { status: 'empty_stub', title: json.text, reason: 'Employer published empty description body' };
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (liveness?.result === 'active') {
    return { status: 'active', reason: liveness.reason };
  }

  return { status: 'uncertain', reason: 'Requires browser or manual verification' };
}

/**
 * Parse one pipeline markdown row.
 * E.g. "- [ ] https://... | Company | Role | Location | posted: 2026-10-10"
 *
 * @param {string} line
 * @returns {{ checked: boolean, url: string, company: string, role: string, location: string, tags: string, raw: string } | null}
 */
export function parsePipelineRow(line) {
  const match = line.match(CHECKBOX_LINE);
  if (!match) return null;
  const checked = match[2].toLowerCase() === 'x';
  const rest = match[3].trim();
  const parts = rest.split('|').map(p => p.trim());
  const url = parts[0] || '';
  if (!/^https?:\/\//i.test(url)) return null;

  const company = parts[1] || '';
  const role = parts[2] || '';
  const location = parts[3] && !parts[3].startsWith('posted:') && !parts[3].startsWith('note:') ? parts[3] : '';
  const tags = parts.slice(location ? 4 : 3).join(' | ');

  return { checked, url, company, role, location, tags, raw: line };
}

/**
 * Scan pipeline.md, resolve board links to direct requisitions, archive dead links,
 * and flag empty stubs.
 *
 * @param {object} options
 * @param {string} options.pipelinePath
 * @param {string} [options.scanHistoryPath]
 * @param {boolean} [options.apply]
 * @param {boolean} [options.verbose]
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{
 *   total: number,
 *   checked: number,
 *   healed: Array<{ company: string, role: string, oldUrl: string, newUrl: string, title: string }>,
 *   expired: Array<{ company: string, role: string, url: string, reason: string }>,
 *   empty: Array<{ company: string, role: string, url: string, reason: string }>,
 *   unchanged: Array<{ company: string, role: string, url: string }>
 * }>}
 */
export async function healPipeline({
  pipelinePath,
  scanHistoryPath,
  apply = false,
  verbose = false,
  onProgress = () => {},
} = {}) {
  if (!existsSync(pipelinePath)) {
    throw new Error(`Pipeline file not found at: ${pipelinePath}`);
  }

  const content = readFileSync(pipelinePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';

  const healed = [];
  const expired = [];
  const empty = [];
  const unchanged = [];

  // Identify sections
  let pendingSection = false;
  const newLines = [];
  const expiredLinesToProcess = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kind = sectionKind(line.trim());
    if (kind === 'pending') {
      pendingSection = true;
      newLines.push(line);
      continue;
    }
    if (pendingSection && line.trim().startsWith('## ')) {
      pendingSection = false;
    }

    if (!pendingSection) {
      newLines.push(line);
      continue;
    }

    const row = parsePipelineRow(line);
    if (!row || row.checked) {
      newLines.push(line);
      continue;
    }

    onProgress(`Checking ${row.company || 'job'}: ${row.url}`);

    // Check if it is a board directory URL
    const board = isBoardUrl(row.url);
    if (board) {
      onProgress(`  Resolving board URL for ${row.company}...`);
      const res = await resolveBoardPosting(row.url, row.role, row.company);
      if (res.resolvedUrl) {
        healed.push({
          company: row.company,
          role: row.role,
          oldUrl: row.url,
          newUrl: res.resolvedUrl,
          title: res.title || row.role,
        });
        // Reconstruct line with healed URL
        const remainder = [
          row.company,
          res.title || row.role,
          row.location,
          row.tags,
        ].filter(Boolean).join(' | ');
        newLines.push(`- [ ] ${res.resolvedUrl} | ${remainder}`);
        continue;
      } else if (res.status === 404 || res.error === 'board_not_found' || res.error === 'no_matching_role_on_board') {
        const reason = res.error === 'board_not_found'
          ? 'board 404 / removed'
          : 'role no longer active on board';
        expired.push({ company: row.company, role: row.role, url: row.url, reason });
        expiredLinesToProcess.push(`- [x] ~~${row.url} | ${row.company} | ${row.role}~~ — [EXPIRED: ${reason}]`);
        continue;
      }
    }

    // Direct posting URL: check health
    const health = await checkPostingHealth(row.url);
    if (health.status === 'expired') {
      expired.push({ company: row.company, role: row.role, url: row.url, reason: health.reason || 'posting closed' });
      expiredLinesToProcess.push(`- [x] ~~${row.url} | ${row.company} | ${row.role}~~ — [EXPIRED: ${health.reason || 'closed'}]`);
      continue;
    }

    if (health.status === 'empty_stub') {
      empty.push({ company: row.company, role: row.role, url: row.url, reason: health.reason || 'empty description' });
      newLines.push(`- [!] ${row.url} | ${row.company} | ${row.role} | [EMPTY_JD: employer published empty description]`);
      continue;
    }

    unchanged.push({ company: row.company, role: row.role, url: row.url });
    newLines.push(line);
  }

  // Insert expired rows into Processed section if any were found
  if (expiredLinesToProcess.length > 0) {
    let processedIdx = newLines.findIndex(l => sectionKind(l.trim()) === 'processed');
    if (processedIdx !== -1) {
      newLines.splice(processedIdx + 1, 0, ...expiredLinesToProcess);
    } else {
      newLines.push('', '## Processed', ...expiredLinesToProcess);
    }
  }

  const finalOutput = newLines.join(newline);

  if (apply && (healed.length > 0 || expired.length > 0 || empty.length > 0)) {
    await withPipelineLock(pipelinePath, async () => {
      // 1. Write backup
      writeFileSync(`${pipelinePath}.bak`, content, 'utf8');
      // 2. Write updated file
      writeFileSync(pipelinePath, finalOutput, 'utf8');

      // 3. Move expired postings to Discarded panel (data/applications.md) & scan-history
      if (expired.length > 0) {
        for (const e of expired) {
          await discardInboxJob({
            url: e.url,
            company: e.company,
            role: e.role,
            reason: `Expired: ${e.reason}`,
          }).catch(() => {});
        }
      }
    });
  }

  return {
    total: healed.length + expired.length + empty.length + unchanged.length,
    checked: healed.length + expired.length + empty.length,
    healed,
    expired,
    empty,
    unchanged,
  };
}
