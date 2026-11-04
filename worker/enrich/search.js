// Web search through Tavily (free plan: 1000 requests a month).
// Free engines (SearXNG/DuckDuckGo) block Railway's IP addresses, so they are no longer used.

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export const usage = { tavily: 0, failures: 0 };
export const searchConfigured = Boolean(TAVILY_API_KEY);

/** Thrown when the search provider is unavailable or out of quota: the run must stop, not reject orgs. */
export class SearchUnavailableError extends Error {}

export async function search(query, { maxResults = 8 } = {}) {
    if (!TAVILY_API_KEY) throw new SearchUnavailableError('TAVILY_API_KEY is not set');
    let res;
    try {
        res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_API_KEY}` },
            body: JSON.stringify({ query, max_results: maxResults, search_depth: 'basic' }),
            signal: AbortSignal.timeout(25000),
        });
    } catch (err) {
        usage.failures++;
        throw new SearchUnavailableError(`Tavily network error: ${err.message}`);
    }
    if ([401, 403, 429, 432, 433].includes(res.status) || res.status >= 500) {
        usage.failures++;
        throw new SearchUnavailableError(`Tavily HTTP ${res.status}`);
    }
    if (!res.ok) {
        usage.failures++;
        return [];
    }
    const data = await res.json();
    usage.tavily++;
    return (data.results || []).map(r => ({ url: r.url, title: r.title || '', content: r.content || '' }));
}
