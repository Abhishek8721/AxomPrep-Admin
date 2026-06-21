const SEARCH_HEADERS = {
  'User-Agent': 'AxomPrep-Admin/1.0 (MCQ fact verification)',
  Accept: 'text/html,application/json',
};

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: SEARCH_HEADERS });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function searchWikipedia(query) {
  const results = [];
  const searchUrl =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      format: 'json',
      origin: '*',
      srlimit: '4',
    });

  const searchData = await fetchJson(searchUrl);
  const hits = searchData?.query?.search || [];

  await Promise.all(
    hits.slice(0, 3).map(async (hit) => {
      const extractUrl =
        'https://en.wikipedia.org/w/api.php?' +
        new URLSearchParams({
          action: 'query',
          prop: 'extracts',
          explaintext: '1',
          exintro: '1',
          titles: hit.title,
          format: 'json',
          origin: '*',
        });

      const pageData = await fetchJson(extractUrl);
      const pages = pageData?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (!page?.extract) return;

      results.push({
        source: 'Wikipedia',
        title: page.title || hit.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title || hit.title).replace(/ /g, '_'))}`,
        snippet: page.extract.slice(0, 900),
      });
    })
  );

  return results;
}

async function searchDuckDuckGo(query) {
  const results = [];
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      ...SEARCH_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
    body: new URLSearchParams({ q: query, b: '', kl: '', df: '' }),
  }).catch(() => null);

  if (!res?.ok) return results;

  const html = await res.text();
  const blocks = html.match(/class="result__body"[\s\S]*?(?=class="result__body"|$)/gi) || [];

  for (const block of blocks.slice(0, 5)) {
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/i);

    if (!titleMatch) continue;

    results.push({
      source: 'Web',
      title: stripHtml(titleMatch[1]),
      url: hrefMatch?.[1] || '',
      snippet: stripHtml(snippetMatch?.[1] || block).slice(0, 400),
    });
  }

  return results;
}

function dedupeResults(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.snippet.slice(0, 80)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return item.snippet.length > 30;
  });
}

function formatResultsForPrompt(results) {
  if (!results.length) return 'No web results found. Use careful reasoning from established knowledge.';

  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.source}: ${r.title}\nURL: ${r.url}\n${r.snippet}`
    )
    .join('\n\n');
}

/**
 * Search the web for evidence to verify an MCQ answer.
 */
async function searchForAnswer(rawText, options) {
  const { buildSearchQueries } = require('./questionParse');
  const queries = buildSearchQueries(rawText, options);

  const allResults = [];

  for (const query of queries) {
    const [wiki, web] = await Promise.all([
      searchWikipedia(query),
      searchDuckDuckGo(query),
    ]);
    allResults.push(...wiki, ...web);
  }

  const results = dedupeResults(allResults).slice(0, 10);

  return {
    queries,
    results,
    promptText: formatResultsForPrompt(results),
  };
}

module.exports = {
  searchForAnswer,
  formatResultsForPrompt,
};
