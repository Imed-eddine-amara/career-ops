// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import fs from 'node:fs';
import path from 'node:path';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// PFE Books Provider — reads Tunisian & international graduation internship topics
// from the local PFE books dataset (pfe_books_2026_2027.json and all_pfe_books.json).
// Zero-token, zero network latency, 100% offline.

const DEFAULT_PFE_DIR = '/home/el3omda/Documents/1internship/pfe_books';
const PFE_DIR = process.env.PFE_BOOKS_DIR || (fs.existsSync(DEFAULT_PFE_DIR) ? DEFAULT_PFE_DIR : path.join(process.cwd(), 'data', 'pfe_books'));
const RECENT_FILE = path.join(PFE_DIR, 'pfe_books_2026_2027.json');
const ALL_FILE = path.join(PFE_DIR, 'all_pfe_books.json');

/** @type {Map<string, any> | null} */
let _cachedCatalog = null;

function normalizeName(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-_]+/g, ' ');
}

function normalizeSlug(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Loads the PFE catalog into memory once per process.
 * Indexes by both company name and URL slug.
 */
export function getPfeCatalog() {
  if (_cachedCatalog) return _cachedCatalog;

  const catalog = new Map();

  function ingestFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return;

      for (const item of items) {
        const name = (item.company || item.enterprise || '').trim();
        if (!name) continue;

        const nameKey = normalizeName(name);
        const slugKey = normalizeSlug(name);
        let urlSlug = '';
        if (item.url) {
          try {
            const p = new URL(item.url).pathname.split('/').filter(Boolean).pop();
            if (p) urlSlug = normalizeSlug(p);
          } catch {}
        }

        const entry = {
          ...item,
          company: name,
        };

        if (!catalog.has(nameKey)) catalog.set(nameKey, entry);
        if (!catalog.has(slugKey)) catalog.set(slugKey, entry);
        if (urlSlug && !catalog.has(urlSlug)) catalog.set(urlSlug, entry);
      }
    } catch (err) {
      console.error(`⚠️  pfe_books: error loading ${filePath}:`, err.message);
    }
  }

  // Ingest recent first (takes precedence), then older books as fallback
  ingestFile(RECENT_FILE);
  ingestFile(ALL_FILE);

  _cachedCatalog = catalog;
  return catalog;
}

/**
 * Formats a topic into a normalized Job object.
 * @param {any} book
 * @param {any} topic
 * @param {string} fallbackCompany
 * @returns {Job}
 */
export function formatTopicJob(book, topic, fallbackCompany) {
  const company = book.company || fallbackCompany;
  const ref = topic.ref ? String(topic.ref).trim() : '';
  const topicTitle = String(topic.title || '').trim();
  const title = ref ? `${ref} – ${topicTitle}` : topicTitle;

  const bookUrl = String(book.url || '').trim();
  const encRef = safeEncodeURIComponent(ref);
  const encCompany = safeEncodeURIComponent(company) || 'company';
  const encTopic = safeEncodeURIComponent(ref || topicTitle) || 'topic';
  const refHash = encRef ? `#${encRef}` : '';
  const url = bookUrl ? `${bookUrl}${refHash}` : `https://pfebooks.com/${encCompany}/${encTopic}`;

  const locations = Array.isArray(book.locations) && book.locations.length > 0
    ? book.locations
    : ['Tunisia / Remote'];

  let postedAt = Date.now();
  if (book.published_date) {
    const d = new Date(book.published_date);
    if (!Number.isNaN(d.getTime())) postedAt = d.getTime();
  }

  const tags = Array.isArray(topic.tags) ? topic.tags.join(', ') : '';
  const emails = Array.isArray(book.contact_emails) ? book.contact_emails.join(', ') : '';
  const descParts = [
    book.title ? `[PFE Book] ${book.title}` : '',
    book.company_description ? `[Company] ${book.company_description}` : '',
    tags ? `[Technologies/Tags] ${tags}` : '',
    book.how_to_apply ? `[How to Apply] ${book.how_to_apply}` : '',
    emails ? `[Contact Emails] ${emails}` : '',
  ].filter(Boolean);

  return {
    title,
    url,
    company,
    location: locations.join(', '),
    locations,
    postedAt,
    description: descParts.join('\n'),
    ...(book.local_pdf_path ? { note: `Local PDF: ${path.basename(book.local_pdf_path)}` } : {}),
  };
}

/**
 * Loads all PFE Books as an ATS dataset for scan-ats-full.mjs.
 * Returns an array of { company, name, website, jobs } objects.
 */
export async function loadPfeBooksDataset() {
  const catalog = getPfeCatalog();
  const seenCompanies = new Set();
  const companies = [];

  for (const book of catalog.values()) {
    if (seenCompanies.has(book.company)) continue;
    seenCompanies.add(book.company);

    const topics = Array.isArray(book.topics) ? book.topics : [];
    const jobs = topics.map(t => formatTopicJob(book, t, book.company));

    companies.push({
      company: book.company,
      name: book.company,
      website: book.url || `https://pfebooks.com/catalogue/2026/${normalizeSlug(book.company)}/`,
      jobs,
    });
  }

  return { list: companies, status: 'ok' };
}

/** @type {Provider} */
export const pfeBooksProvider = {
  id: 'pfe_books',

  detect(entry) {
    if (entry.provider === 'pfe_books') {
      return { url: entry.careers_url || 'https://pfebooks.com/' };
    }
    const url = entry.careers_url || '';
    if (url.includes('pfebooks.com')) {
      return { url };
    }
    return null;
  },

  async fetch(entry, ctx) {
    const catalog = getPfeCatalog();
    const nameKey = normalizeName(entry.name);
    const slugKey = normalizeSlug(entry.name);

    let urlSlug = '';
    if (entry.careers_url) {
      try {
        const p = new URL(entry.careers_url).pathname.split('/').filter(Boolean).pop();
        if (p) urlSlug = normalizeSlug(p);
      } catch {}
    }

    const book = catalog.get(nameKey) || catalog.get(slugKey) || (urlSlug ? catalog.get(urlSlug) : null);
    if (!book) {
      return [];
    }

    const topics = Array.isArray(book.topics) ? book.topics : [];
    return topics.map(t => formatTopicJob(book, t, entry.name));
  },
};

export default pfeBooksProvider;
