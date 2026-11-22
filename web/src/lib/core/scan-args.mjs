/**
 * Flags for one scan-ats-full.mjs child, after the script path.
 *
 * @param {{ ats: string[], json: boolean, sinceDays: number, limitPerAts: number, offset?: number, companies?: string[] }} options
 * @returns {string[]}
 */
export function scannerArgs({ ats, json, sinceDays, limitPerAts, offset, companies }) {
  const args = [
    "--dry-run",
    "--since",
    String(Math.max(1, sinceDays || 7)),
    "--ats",
    ats.join(","),
  ];
  if (limitPerAts === 0 || limitPerAts === Infinity) {
    // Uncapped scan: omit --limit so scan-ats-full.mjs searches all companies
  } else if (typeof limitPerAts === "number" && limitPerAts > 0) {
    args.push("--limit", String(limitPerAts));
  } else {
    args.push("--limit", "150");
  }
  if (typeof offset === "number" && offset > 0) {
    args.push("--offset", String(offset));
  } else {
    args.push("--shuffle");
  }
  if (Array.isArray(companies) && companies.length > 0) {
    args.push("--companies", companies.join(","));
  }
  if (json) args.push("--json");
  return args;
}
