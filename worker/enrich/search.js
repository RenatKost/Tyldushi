// Web search: self-hosted SearXNG first, Tavily free tier as a fallback.

const SEARXNG_URL = (process.env.SEARXNG_URL || '').replace(/\/$/, '');
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export const usage = { searxng: 0, tavily: 0, failures: 0 };

async function searxng(q) {
    const params = new URLSearchParams({ q, format: 'json', language: 'uk-UA', safesearch: '0' });
    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
    const data = await res.json();
    usage.searxng++;
    return (data.results || []).map(r => ({ url: r.url, title: r.title || '', content: r.content || '' }));
}

async function tavily(q) {
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_API_KEY}` },
        body: JSON.stringify({ query: q, max_results: 8, search_depth: 'basic' }),
        signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    usage.tavily++;
    return (data.results || []).map(r => ({ url: r.url, title: r.title || '', content: r.content || '' }));
}

export const searchConfigured = Boolean(SEARXNG_URL || TAVILY_API_KEY);

/** Returns search results; tries SearXNG, falls back to Tavily when it fails or finds nothing. */
export async function search(q) {
    if (SEARXNG_URL) {
        try {
            const results = await searxng(q);
            if (results.length) return results;
        } catch (err) {
            usage.failures++;
            console.warn(`[search] searxng: ${err.message}`);
        }
    }
    if (TAVILY_API_KEY) {
        try {
            return await tavily(q);
        } catch (err) {
            usage.failures++;
            console.warn(`[search] tavily: ${err.message}`);
        }
    }
    return [];
}
