import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBoardUrl,
  titleTokens,
  titleMatchScore,
  parsePipelineRow,
} from '../lib/pipeline-healer.mjs';

test('isBoardUrl detects Greenhouse board roots and rejects direct postings', () => {
  const root1 = isBoardUrl('https://boards.greenhouse.io/figureai');
  assert.equal(root1?.isBoard, true);
  assert.equal(root1?.vendor, 'greenhouse');
  assert.equal(root1?.slug, 'figureai');

  const root2 = isBoardUrl('https://job-boards.greenhouse.io/andurilindustries/');
  assert.equal(root2?.isBoard, true);
  assert.equal(root2?.slug, 'andurilindustries');

  // Direct posting has /jobs/{id} -> should NOT be a board root
  const direct = isBoardUrl('https://boards.greenhouse.io/figureai/jobs/4601309006');
  assert.equal(direct, null);

  const directWithQuery = isBoardUrl('https://boards.greenhouse.io/andurilindustries?gh_jid=5265158007');
  assert.equal(directWithQuery, null);
});

test('isBoardUrl detects Ashby board roots and rejects direct postings', () => {
  const root = isBoardUrl('https://jobs.ashbyhq.com/revel');
  assert.equal(root?.isBoard, true);
  assert.equal(root?.vendor, 'ashby');
  assert.equal(root?.slug, 'revel');

  // Direct posting has /{slug}/{uuid}
  const direct = isBoardUrl('https://jobs.ashbyhq.com/revel/59555d75-bef1-4bbf-826e-aeb01e25eb29');
  assert.equal(direct, null);
});

test('isBoardUrl detects Lever board roots and rejects direct postings', () => {
  const root = isBoardUrl('https://jobs.lever.co/field-ai');
  assert.equal(root?.isBoard, true);
  assert.equal(root?.vendor, 'lever');
  assert.equal(root?.slug, 'field-ai');

  const direct = isBoardUrl('https://jobs.lever.co/field-ai/4d6e794b-1fcb-472f-babb-9b482eb02edf');
  assert.equal(direct, null);
});

test('titleTokens strips years and seasonal terms', () => {
  const tokens = titleTokens('Firmware Engineering Intern [Winter 2027]');
  assert.equal(tokens.has('firmware'), true);
  assert.equal(tokens.has('engineering'), true);
  assert.equal(tokens.has('intern'), true);
  assert.equal(tokens.has('2027'), false);
  assert.equal(tokens.has('winter'), false);
});

test('titleMatchScore scores matching technical titles highly', () => {
  const score1 = titleMatchScore('Firmware Engineering Intern', 'Firmware Engineering Intern [Winter 2027]');
  assert.ok(score1 >= 0.8, `Expected score >= 0.8, got ${score1}`);

  const score2 = titleMatchScore('Firmware Engineer Intern', '2027 Firmware Engineer Intern');
  assert.ok(score2 >= 0.8, `Expected score >= 0.8, got ${score2}`);

  const mismatch = titleMatchScore('Firmware Engineer Intern', 'Recruiter / Human Resources');
  assert.ok(mismatch < 0.2, `Expected mismatch < 0.2, got ${mismatch}`);
});

test('parsePipelineRow parses pipe-delimited pipeline markdown row', () => {
  const parsed = parsePipelineRow('- [ ] https://boards.greenhouse.io/figureai | Figure AI | Firmware Engineering Intern | San Jose, CA | posted: 2026-10-14');
  assert.equal(parsed?.checked, false);
  assert.equal(parsed?.url, 'https://boards.greenhouse.io/figureai');
  assert.equal(parsed?.company, 'Figure AI');
  assert.equal(parsed?.role, 'Firmware Engineering Intern');
  assert.equal(parsed?.location, 'San Jose, CA');
  assert.match(parsed?.tags || '', /posted: 2026-10-14/);
});
