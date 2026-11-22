import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { vendorFromUrl, removeUrlFromPipeline, discardInboxJob } from '../lib/inbox-discard.mjs';

test('vendorFromUrl extracts known and fallback vendors', () => {
  assert.equal(vendorFromUrl('https://boards.greenhouse.io/verkada/jobs/123'), 'greenhouse');
  assert.equal(vendorFromUrl('https://jobs.ashbyhq.com/company/abc'), 'ashby');
  assert.equal(vendorFromUrl('https://jobs.lever.co/company/xyz'), 'lever');
  assert.equal(vendorFromUrl('https://careers.example.com/job/456'), 'careers.example.com');
});

test('removeUrlFromPipeline prunes matching row', () => {
  const sample = `# Pipeline\n\n## Pending\n\n- [ ] https://example.com/job/1 | Co1 | Dev\n- [ ] https://example.com/job/2 | Co2 | Eng\n\n## Processed\n`;
  const res = removeUrlFromPipeline(sample, 'https://example.com/job/1');
  assert.equal(res.removed, true);
  assert.ok(!res.text.includes('https://example.com/job/1'));
  assert.ok(res.text.includes('https://example.com/job/2'));
});

test('discardInboxJob writes row into applications.md with Discarded status', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-discard-test-'));
  const dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const trackerFile = path.join(dataDir, 'applications.md');
  const pipelineFile = path.join(dataDir, 'pipeline.md');
  const scanHistoryFile = path.join(dataDir, 'scan-history.tsv');

  fs.writeFileSync(trackerFile, `# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|-------|-----|\n| 1 | 2026-11-16 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | — | notes | [ashby](https://example.com/old) |\n`, 'utf8');
  fs.writeFileSync(pipelineFile, `# Pipeline\n\n## Pending\n\n- [ ] https://example.com/newjob | Beta | Firmware\n\n## Processed\n`, 'utf8');
  fs.writeFileSync(scanHistoryFile, `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n`, 'utf8');

  const outcome = await discardInboxJob({
    url: 'https://example.com/newjob',
    company: 'Beta',
    role: 'Firmware',
    reason: 'Test discard',
    root: tmpDir,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.n, 2);
  assert.equal(outcome.status, 'Discarded');

  const trackerContent = fs.readFileSync(trackerFile, 'utf8');
  assert.ok(trackerContent.includes('| 2 |'));
  assert.ok(trackerContent.includes('Beta'));
  assert.ok(trackerContent.includes('Firmware'));
  assert.ok(trackerContent.includes('Discarded'));
  assert.ok(trackerContent.includes('Test discard'));

  const pipelineContent = fs.readFileSync(pipelineFile, 'utf8');
  assert.ok(!pipelineContent.includes('https://example.com/newjob'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
