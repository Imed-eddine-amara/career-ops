/**
 * web/src/lib/core/pipeline-healer-wrapper.mjs — pure web-safe board URL detection
 * and ATS API resolution.
 */

/**
 * Identify if a URL is an ATS board directory / company root URL rather than a
 * specific job requisition posting.
 *
 * @param {string} rawUrl
 * @returns {{ isBoard: boolean, vendor: string, slug: string, cleanUrl: string } | null}
 */
export function isBoardUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");

  // 1. Greenhouse: boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug}
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 1 && !u.searchParams.has("gh_jid")) {
      return { isBoard: true, vendor: "greenhouse", slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 2. Ashby: jobs.ashbyhq.com/{slug}
  if (host === "jobs.ashbyhq.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 1) {
      return { isBoard: true, vendor: "ashby", slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 3. Lever: jobs.lever.co/{slug} or jobs.eu.lever.co/{slug}
  if (/^jobs\.(?:eu\.)?lever\.co$/.test(host)) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 1) {
      return { isBoard: true, vendor: "lever", slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 4. Workable: apply.workable.com/{slug}
  if (host === "apply.workable.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 1 && parts[0] !== "j") {
      return { isBoard: true, vendor: "workable", slug: parts[0], cleanUrl: trimmed };
    }
  }

  // 5. BambooHR: {slug}.bamboohr.com/careers
  const bamboo = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/);
  if (bamboo && (path === "/careers" || path === "")) {
    return { isBoard: true, vendor: "bamboohr", slug: bamboo[1], cleanUrl: trimmed };
  }

  return null;
}

export function titleTokens(text) {
  if (!text) return new Set();
  const normalized = text
    .toLowerCase()
    .replace(/\b(202[4-9]|2030)\b/g, "")
    .replace(/\b(spring|summer|fall|winter)\b/g, "")
    .replace(/[\[\]\(\)\-\—\–\/\,\:\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);
  return new Set(words);
}

export function titleMatchScore(candidate, target) {
  const cTokens = titleTokens(candidate);
  const tTokens = titleTokens(target);
  if (cTokens.size === 0 || tTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of cTokens) {
    if (tTokens.has(token)) intersection++;
  }

  const minSize = Math.min(cTokens.size, tTokens.size);
  const containment = intersection / minSize;
  const union = new Set([...cTokens, ...tTokens]).size;
  const jaccard = intersection / union;

  return containment * 0.7 + jaccard * 0.3;
}

export async function resolveBoardPosting(boardUrl, roleTitle, company = "", { timeoutMs = 15000 } = {}) {
  const board = isBoardUrl(boardUrl);
  if (!board) return { resolvedUrl: null, error: "not_a_board_url" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (board.vendor === "greenhouse") {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { resolvedUrl: null, error: "board_not_found", status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const data = await res.json();
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0) return { resolvedUrl: null, error: "board_empty" };

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
      return { resolvedUrl: null, error: "no_matching_role_on_board" };
    }

    if (board.vendor === "ashby") {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { resolvedUrl: null, error: "board_not_found", status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const data = await res.json();
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0) return { resolvedUrl: null, error: "board_empty" };

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
      return { resolvedUrl: null, error: "no_matching_role_on_board" };
    }

    if (board.vendor === "lever") {
      const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { resolvedUrl: null, error: "board_not_found", status: 404 };
      if (!res.ok) return { resolvedUrl: null, error: `http_${res.status}`, status: res.status };
      const jobs = await res.json();
      if (!Array.isArray(jobs) || jobs.length === 0) return { resolvedUrl: null, error: "board_empty" };

      let bestMatch = null;
      let highestScore = 0;

      for (const job of jobs) {
        const title = job.text || "";
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
      return { resolvedUrl: null, error: "no_matching_role_on_board" };
    }

    return { resolvedUrl: null, error: "unsupported_board_vendor" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch_failed";
    return { resolvedUrl: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}
