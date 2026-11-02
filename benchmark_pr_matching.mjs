import { performance } from 'node:perf_hooks';

function generateFakeData(numPrs, numReceipts) {
  const prs = [];
  for (let i = 0; i < numPrs; i++) {
    prs.push({
      title: `Some random PR title fixing issue #${i} and more text to make it longer`,
      url: `https://github.com/test/repo/pull/${i}`,
      number: i,
      state: 'OPEN'
    });
  }

  const receipts = [];
  for (let i = 0; i < numReceipts; i++) {
    receipts.push({
      issue_url: `https://github.com/test/repo/issues/${i}`,
      action_id: `act-1234-${i}-some-action`,
      intent: `intent_${i}_stuff`,
      pr_url: null
    });
  }

  return { prs, receipts };
}

const { prs, receipts } = generateFakeData(2000, 2000);

// Original approach
const startOriginal = performance.now();
for (const r of receipts) {
  if (!r.pr_url) {
    const matchedPr = prs.find(p => {
      if (r.issue_url) {
        const issueNum = r.issue_url.split('/').pop();
        if (issueNum && (p.title.includes(`#${issueNum}`) || p.title.includes(`fixes #${issueNum}`) || p.title.includes(`closes #${issueNum}`))) {
          return true;
        }
      }
      if (r.action_id) {
        const slug = r.action_id.replace(/^act-\d*-?/, '').replace(/[-_]/g, ' ').toLowerCase();
        if (slug.length > 5 && p.title.toLowerCase().includes(slug)) return true;
      }
      if (r.intent) {
        const intentSlug = r.intent.replace(/_/g, ' ').toLowerCase();
        if (intentSlug.length > 5 && p.title.toLowerCase().includes(intentSlug)) return true;
      }
      return false;
    });
    if (matchedPr) {
      r.pr_url = matchedPr.url;
    }
  }
}
const endOriginal = performance.now();

// Reset receipts
const { receipts: receiptsNew } = generateFakeData(2000, 2000);

// Optimized approach - map based
const startOptimized = performance.now();

// PRECOMPUTATION:
// Build an index for fast lookups
const issuePrMap = new Map(); // issueNum -> PR
const slugPrMap = new Map();  // generic word map

const prsLen = prs.length;
const prTitlesLower = new Array(prsLen);
for (let i = 0; i < prsLen; i++) {
  const p = prs[i];
  const title = p.title;
  prTitlesLower[i] = title.toLowerCase();

  // Extract potential issue numbers from PR title
  const issueMatch = title.match(/(?:#|fixes #|closes #)(\d+)/g);
  if (issueMatch) {
    for (const m of issueMatch) {
      const num = m.replace(/[^0-9]/g, '');
      if (num && !issuePrMap.has(num)) {
        issuePrMap.set(num, p);
      }
    }
  }
}

for (const r of receiptsNew) {
  if (!r.pr_url) {
    let matchedPr = undefined;

    // 1. O(1) Issue Match
    if (r.issue_url) {
      const issueNum = r.issue_url.split('/').pop();
      if (issueNum) {
        matchedPr = issuePrMap.get(issueNum);
      }
    }

    // 2. Fallback to linear search with pre-computed receipt props and PR lower titles
    if (!matchedPr && (r.action_id || r.intent)) {
      let slug = null;
      let intentSlug = null;

      if (r.action_id) {
        slug = r.action_id.replace(/^act-\d*-?/, '').replace(/[-_]/g, ' ').toLowerCase();
        if (slug.length <= 5) slug = null;
      }
      if (r.intent) {
        intentSlug = r.intent.replace(/_/g, ' ').toLowerCase();
        if (intentSlug.length <= 5) intentSlug = null;
      }

      if (slug || intentSlug) {
        for (let i = 0; i < prsLen; i++) {
          const titleLower = prTitlesLower[i];
          if (slug && titleLower.includes(slug)) {
            matchedPr = prs[i];
            break;
          }
          if (intentSlug && titleLower.includes(intentSlug)) {
            matchedPr = prs[i];
            break;
          }
        }
      }
    }

    if (matchedPr) {
      r.pr_url = matchedPr.url;
    }
  }
}
const endOptimized = performance.now();

console.log(`Original: ${endOriginal - startOriginal} ms`);
console.log(`Optimized (Map): ${endOptimized - startOptimized} ms`);
