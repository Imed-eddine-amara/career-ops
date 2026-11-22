import test from "node:test";
import assert from "node:assert/strict";
import { applyInboxUrlEdit, applyInboxDelete } from "../../src/lib/inbox-edit.mjs";

const SAMPLE_PIPELINE = `# Pipeline — Pending URLs

## Pending

- [ ] https://boards.greenhouse.io/figureai | Figure AI | Firmware Engineering Intern | San Jose, CA
- [ ] https://jobs.ashbyhq.com/revel | Revel | Embedded Software Engineer Intern | San Francisco, CA

## Processed

- [x] https://jobs.lever.co/ajax/123 | Ajax | Embedded Engineer | Remote
`;

test("applyInboxUrlEdit replaces oldUrl with newUrl preserving metadata", () => {
  const result = applyInboxUrlEdit(
    SAMPLE_PIPELINE,
    "https://boards.greenhouse.io/figureai",
    "https://job-boards.greenhouse.io/figureai/jobs/4601309006"
  );
  assert.equal(result.ok, true);
  assert.equal(result.changed, 1);
  assert.match(result.text, /https:\/\/job-boards\.greenhouse\.io\/figureai\/jobs\/4601309006/);
  assert.match(result.text, /Figure AI \| Firmware Engineering Intern/);
  assert.doesNotMatch(result.text, /https:\/\/boards\.greenhouse\.io\/figureai \|/);
});

test("applyInboxUrlEdit returns error on invalid or unmatched URL", () => {
  const invalid = applyInboxUrlEdit(SAMPLE_PIPELINE, "not-a-url", "https://valid.com/job");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "invalid-old-url");

  const unmatched = applyInboxUrlEdit(SAMPLE_PIPELINE, "https://nonexistent.com/job", "https://valid.com/job");
  assert.equal(unmatched.ok, false);
  assert.equal(unmatched.error, "unmatched");
});

test("applyInboxDelete removes matching row", () => {
  const result = applyInboxDelete(SAMPLE_PIPELINE, "https://jobs.ashbyhq.com/revel");
  assert.equal(result.ok, true);
  assert.equal(result.changed, 1);
  assert.match(result.removedRow, /https:\/\/jobs\.ashbyhq\.com\/revel/);
  assert.doesNotMatch(result.text, /https:\/\/jobs\.ashbyhq\.com\/revel/);
  assert.match(result.text, /Figure AI/);
});

test("applyInboxDelete returns error on unmatched URL", () => {
  const unmatched = applyInboxDelete(SAMPLE_PIPELINE, "https://unknown.com/job");
  assert.equal(unmatched.ok, false);
  assert.equal(unmatched.error, "unmatched");
});
