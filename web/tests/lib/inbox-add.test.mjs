import test from "node:test";
import assert from "node:assert/strict";
import { parseAddUrls, formatPipelineLine, insertOffersIntoPipeline } from "../../src/lib/inbox-add.mjs";

const SAMPLE_PIPELINE = `# Pipeline — Pending URLs

## Pending

- [ ] https://boards.greenhouse.io/figureai/jobs/123 | Figure AI | Firmware Engineer | San Jose, CA

## Processed

- [x] https://jobs.lever.co/ajax/456 | Ajax | Embedded Engineer | Remote
`;

test("parseAddUrls splits multiline text and strips duplicates & invalid lines", () => {
  const multiline = `
    https://boards.greenhouse.io/figureai/jobs/123
    https://jobs.ashbyhq.com/revel/59555d75
    some random text
    https://jobs.ashbyhq.com/revel/59555d75
    https://jobs.lever.co/company/abc
  `;
  const result = parseAddUrls(multiline);
  assert.equal(result.urls.length, 3);
  assert.equal(result.urls[0], "https://boards.greenhouse.io/figureai/jobs/123");
  assert.equal(result.urls[1], "https://jobs.ashbyhq.com/revel/59555d75");
  assert.equal(result.urls[2], "https://jobs.lever.co/company/abc");
  assert.equal(result.invalid.length, 1);
  assert.equal(result.invalid[0], "some random text");
});

test("formatPipelineLine formats markdown checklist row", () => {
  const line = formatPipelineLine({
    url: "https://jobs.ashbyhq.com/revel/59555d75",
    company: "Revel",
    role: "Embedded Software Engineer",
    location: "San Francisco, CA",
  });
  assert.equal(
    line,
    "- [ ] https://jobs.ashbyhq.com/revel/59555d75 | Revel | Embedded Software Engineer | San Francisco, CA"
  );
});

test("insertOffersIntoPipeline inserts new offers under Pending and skips existing", () => {
  const toAdd = [
    { url: "https://boards.greenhouse.io/figureai/jobs/123", company: "Figure AI", role: "Dup" },
    { url: "https://jobs.ashbyhq.com/revel/59555d75", company: "Revel", role: "Embedded Software Engineer" },
  ];
  const result = insertOffersIntoPipeline(SAMPLE_PIPELINE, toAdd);
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.match(result.text, /https:\/\/jobs\.ashbyhq\.com\/revel\/59555d75/);
  assert.match(result.text, /## Pending\n\n- \[ \] https:\/\/jobs\.ashbyhq\.com\/revel\/59555d75/);
});
