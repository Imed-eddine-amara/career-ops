#!/usr/bin/env node
/**
 * pipeline-heal.mjs — Audit, heal, and prune broken, expired, redirected,
 * board-level, and empty pipeline URLs.
 *
 * Usage:
 *   node pipeline-heal.mjs [--dry-run] [--apply] [--json] [--verbose]
 *
 * Options:
 *   --dry-run   Preview link healing and expiration without touching files (default)
 *   --apply     Apply the fixes: rewrite healed URLs, archive dead links, update scan-history
 *   --json      Output structured JSON results
 *   --verbose   Show detailed per-URL audit steps
 *   --help, -h  Show this help message
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { healPipeline } from './lib/pipeline-healer.mjs';

const USAGE = `Usage: node pipeline-heal.mjs [--dry-run] [--apply] [--json] [--verbose]

Audits pending URLs in data/pipeline.md:
  - Resolves board directory URLs to specific job requisitions via ATS APIs
  - Detects 404s and expired postings, archiving them to Processed
  - Flags incomplete/empty postings (no JD text)

Options:
  --dry-run   Preview changes without modifying files (default)
  --apply     Apply fixes to data/pipeline.md and data/scan-history.tsv
  --json      Output structured JSON summary
  --verbose   Log each URL check in real time
  --help, -h  Show this help message and exit`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const verbose = args.includes('--verbose');

  const root = getCareerOpsRoot();
  const pipelinePath = process.env.CAREER_OPS_PIPELINE || join(root, 'data', 'pipeline.md');
  const scanHistoryPath = join(root, 'data', 'scan-history.tsv');

  if (!existsSync(pipelinePath)) {
    if (json) {
      console.log(JSON.stringify({ error: `Pipeline not found at ${pipelinePath}` }));
    } else {
      console.error(`❌ Pipeline file not found at: ${pipelinePath}`);
    }
    process.exit(1);
  }

  if (!json) {
    console.log(`\n🏥 Pipeline Healer — Scanning pending URLs in ${pipelinePath}...`);
    if (!apply) {
      console.log(`ℹ️  Running in DRY-RUN mode. Pass --apply to write fixes.\n`);
    } else {
      console.log(`⚡ Running in APPLY mode. Fixes will be saved atomically.\n`);
    }
  }

  const result = await healPipeline({
    pipelinePath,
    scanHistoryPath,
    apply,
    verbose,
    onProgress: (msg) => {
      if (verbose && !json) console.log(msg);
    },
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // Colorized terminal output
  if (result.healed.length > 0) {
    console.log(`\n🔗 HEALED LINKS (${result.healed.length}):`);
    for (const h of result.healed) {
      console.log(`  ✅ ${h.company || 'Job'}: ${h.role}`);
      console.log(`     Old (Board): ${h.oldUrl}`);
      console.log(`     New (Direct): ${h.newUrl}\n`);
    }
  }

  if (result.expired.length > 0) {
    console.log(`\n❌ EXPIRED / DEAD POSTINGS (${result.expired.length}):`);
    for (const e of result.expired) {
      console.log(`  🗑️  ${e.company || 'Job'}: ${e.role}`);
      console.log(`     URL: ${e.url}`);
      console.log(`     Reason: ${e.reason}\n`);
    }
  }

  if (result.empty.length > 0) {
    console.log(`\n⚠️  INCOMPLETE / EMPTY POSTINGS (${result.empty.length}):`);
    for (const em of result.empty) {
      console.log(`  ⚠️  ${em.company || 'Job'}: ${em.role}`);
      console.log(`     URL: ${em.url}`);
      console.log(`     Reason: ${em.reason}\n`);
    }
  }

  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`Summary: ${result.total} pending checked | ${result.healed.length} healed | ${result.expired.length} expired | ${result.empty.length} empty stubs | ${result.unchanged.length} unchanged`);
  if (!apply && (result.healed.length > 0 || result.expired.length > 0)) {
    console.log(`\n👉 Run with --apply to apply these fixes: node pipeline-heal.mjs --apply\n`);
  }
}

main().catch((err) => {
  console.error(`pipeline-heal failed:`, err);
  process.exit(1);
});
