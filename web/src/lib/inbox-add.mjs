/**
 * web/src/lib/inbox-add.mjs — Logic for single and bulk manual addition of job URLs
 * into data/pipeline.md.
 */

import { postingUrl } from "./posting-url.mjs";
import { sectionKind } from "./core/pipeline-sections.mjs";
import { isBoardUrl } from "./core/pipeline-healer-wrapper.mjs";

const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX!])\](.*)$/;

/**
 * Parse multiline or single input into a clean, deduplicated list of HTTP(S) URLs.
 *
 * @param {string | string[]} input
 * @returns {{ urls: string[], invalid: string[] }}
 */
export function parseAddUrls(input) {
  const lines = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\r?\n/)
      : [];

  const seen = new Set();
  const urls = [];
  const invalid = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Check if line contains a URL
    const match = trimmed.match(/https?:\/\/[^\s\)\>\|]+/i);
    if (!match) {
      invalid.push(trimmed);
      continue;
    }

    const clean = postingUrl(match[0]);
    if (!clean) {
      invalid.push(trimmed);
      continue;
    }

    if (!seen.has(clean)) {
      seen.add(clean);
      urls.push(clean);
    }
  }

  return { urls, invalid };
}

/**
 * Format a validated posting row for pipeline.md.
 *
 * @param {{ url: string, company?: string, role?: string, location?: string }} job
 * @returns {string}
 */
export function formatPipelineLine({ url, company = "", role = "", location = "" }) {
  const comp = company.trim() || "Company";
  const title = role.trim() || "Position";
  const loc = location.trim();
  return `- [ ] ${url} | ${comp} | ${title}${loc ? ` | ${loc}` : ""}`;
}

/**
 * Insert new formatted lines into pipeline.md under ## Pending, skipping any URL
 * already present in either Pending or Processed.
 *
 * @param {string} pipelineText
 * @param {Array<{ url: string, company?: string, role?: string, location?: string }>} jobs
 * @returns {{ ok: true, text: string, added: number, duplicates: number } | { ok: false, error: string }}
 */
export function insertOffersIntoPipeline(pipelineText, jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { ok: true, text: pipelineText, added: 0, duplicates: 0 };
  }

  const newline = pipelineText.includes("\r\n") ? "\r\n" : "\n";
  const lines = pipelineText.split(/\r?\n/);
  const hasTrailing = /\r?\n$/.test(pipelineText);
  if (hasTrailing && lines[lines.length - 1] === "") lines.pop();

  // Find all existing URLs to prevent duplicate entries
  const existingUrls = new Set();
  for (const line of lines) {
    const m = line.match(CHECKBOX_LINE);
    if (m) {
      const u = postingUrl(m[3].split("|")[0]?.trim());
      if (u) existingUrls.add(u);
    }
  }

  const fresh = [];
  let duplicates = 0;

  for (const job of jobs) {
    const parsed = postingUrl(job.url);
    if (!parsed) continue;
    if (existingUrls.has(parsed)) {
      duplicates++;
    } else {
      existingUrls.add(parsed);
      fresh.push(formatPipelineLine({ ...job, url: parsed }));
    }
  }

  if (fresh.length === 0) {
    return { ok: true, text: pipelineText, added: 0, duplicates };
  }

  // Locate the Pending section
  let pendingIdx = -1;
  let processedIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const kind = sectionKind(lines[i].trim());
    if (kind === "pending" && pendingIdx === -1) {
      pendingIdx = i;
    } else if (kind === "processed" && processedIdx === -1) {
      processedIdx = i;
    }
  }

  if (pendingIdx !== -1) {
    // If the line right after ## Pending is blank, insert after the blank line for clean formatting
    const insertPos = (lines[pendingIdx + 1]?.trim() === "") ? pendingIdx + 2 : pendingIdx + 1;
    lines.splice(insertPos, 0, ...fresh);
  } else if (processedIdx !== -1) {
    // Insert ## Pending block right before ## Processed
    lines.splice(processedIdx, 0, "## Pending", ...fresh, "");
  } else {
    // Append at the end
    lines.push("", "## Pending", ...fresh);
  }

  const resultText = lines.join(newline) + (hasTrailing ? newline : "");
  return { ok: true, text: resultText, added: fresh.length, duplicates };
}

/**
 * Fast metadata fetcher for a single URL: attempts ATS API resolution first,
 * then falls back to hostname heuristic.
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<{ company: string, role: string, location?: string, isBoard?: boolean }>}
 */
export async function extractUrlMetadata(url, { timeoutMs = 8000 } = {}) {
  const fallback = {
    company: deriveCompanyFromUrl(url),
    role: "Position",
    location: "",
  };

  const board = isBoardUrl(url);
  if (board) {
    return {
      company: capitalize(board.slug),
      role: "Job Board Directory",
      location: "",
      isBoard: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Greenhouse: https://boards.greenhouse.io/{slug}/jobs/{id} or job-boards.greenhouse.io/{slug}/jobs/{id}
    const gh = url.match(/^https?:\/\/(?:job-)?boards\.greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/i);
    if (gh) {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const d = await res.json();
        return {
          company: d.company_name || capitalize(gh[1]),
          role: d.title || fallback.role,
          location: d.location?.name || "",
        };
      }
    }

    // 2. Lever: https://jobs.lever.co/{slug}/{uuid}
    const lev = url.match(/^https?:\/\/jobs\.(?:eu\.)?lever\.co\/([^\/]+)\/([a-f0-9-]+)/i);
    if (lev) {
      const res = await fetch(`https://api.lever.co/v0/postings/${lev[1]}/${lev[2]}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const d = await res.json();
        return {
          company: capitalize(lev[1]),
          role: d.text || fallback.role,
          location: d.categories?.location || "",
        };
      }
    }

    // 3. Ashby: https://jobs.ashbyhq.com/{slug}/{uuid}
    const ash = url.match(/^https?:\/\/jobs\.ashbyhq\.com\/([^\/]+)\/([a-f0-9-]+)/i);
    if (ash) {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${ash[1]}?includeCompensation=true`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const d = await res.json();
        const job = d.jobs?.find((j) => j.id === ash[2]);
        if (job) {
          return {
            company: capitalize(ash[1]),
            role: job.title || fallback.role,
            location: job.location || "",
          };
        }
      }
    }
  } catch {
    // fallback
  } finally {
    clearTimeout(timer);
  }

  return fallback;
}

function deriveCompanyFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length >= 2) {
      // e.g. figureai from boards.greenhouse.io or jobs.ashbyhq.com/revel
      const pathPart = u.pathname.split("/").filter(Boolean)[0];
      if (pathPart && pathPart.length >= 3 && !["jobs", "careers", "posting"].includes(pathPart.toLowerCase())) {
        return capitalize(pathPart);
      }
      return capitalize(parts[0]);
    }
    return capitalize(host);
  } catch {
    return "Company";
  }
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
