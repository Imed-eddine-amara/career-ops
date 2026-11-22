import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { vendorFromUrl, removeUrlFromPipeline, discardInboxJob } from "../../../lib/inbox-discard.mjs";

test("vendorFromUrl correctly detects ATS vendors from job URLs", () => {
  assert.equal(vendorFromUrl("https://job-boards.greenhouse.io/verkada/jobs/5211595007"), "greenhouse");
  assert.equal(vendorFromUrl("https://jobs.ashbyhq.com/openai/12345"), "ashby");
  assert.equal(vendorFromUrl("https://jobs.lever.co/field-ai/67890"), "lever");
  assert.equal(vendorFromUrl("https://custom-site.org/openings/1"), "custom-site.org");
});

test("discardInboxJob creates a new row with Discarded status in applications.md", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-discard-test-"));
  const dataDir = path.join(tmpDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const trackerFile = path.join(dataDir, "applications.md");
  const pipelineFile = path.join(dataDir, "pipeline.md");

  fs.writeFileSync(
    trackerFile,
    `# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|-------|-----|\n| 1 | 2026-11-16 | OldCo | Engineer | 4.0/5 | Evaluated | ❌ | — | notes | [ashby](https://example.com/job1) |\n`,
    "utf8"
  );

  fs.writeFileSync(
    pipelineFile,
    `# Pipeline\n\n## Pending\n\n- [ ] https://boards.greenhouse.io/verkada/jobs/7521096003 | Verkada | Embedded Software Engineering Intern 2027\n\n## Processed\n`,
    "utf8"
  );

  const res = await discardInboxJob({
    url: "https://boards.greenhouse.io/verkada/jobs/7521096003",
    company: "Verkada",
    role: "Embedded Software Engineering Intern 2027",
    reason: "Expired: ATS API 404",
    root: tmpDir,
  });

  assert.equal(res.ok, true);
  assert.equal(res.n, 2);
  assert.equal(res.status, "Discarded");

  const trackerText = fs.readFileSync(trackerFile, "utf8");
  assert.ok(trackerText.includes("| 2 |"));
  assert.ok(trackerText.includes("Verkada"));
  assert.ok(trackerText.includes("Discarded"));
  assert.ok(trackerText.includes("Expired: ATS API 404"));
  assert.ok(trackerText.includes("[greenhouse](https://boards.greenhouse.io/verkada/jobs/7521096003)"));

  const pipelineText = fs.readFileSync(pipelineFile, "utf8");
  assert.ok(!pipelineText.includes("https://boards.greenhouse.io/verkada/jobs/7521096003"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
