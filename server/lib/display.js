// Public display name, kept in sync with displayName() in public/js/organizations.js.
const LEGAL_PREFIX = /^(міжнародн\S*\s+|всеукраїнськ\S*\s+)?(благодійн\S*\s+(організаці\S*|фонд\S*)|громадськ\S*\s+(організаці\S*|спілк\S*|об.єднанн\S*)|бо|бф|го|мбф)\s+/i;

/** "Благодійна організація «Благодійний фонд «Скаути Миколаєва»»" → "Скаути Миколаєва" */
export function displayName(org) {
    if (org.short_name) return org.short_name.replace(/^[«"]+|[»"]+$/g, '').trim();
    const name = String(org.name || '');
    const quoted = [...name.matchAll(/«([^«»]+)»/g)].map(m => m[1].trim()).filter(Boolean);
    let core = quoted.length ? quoted[quoted.length - 1] : name.replace(/[«»"]/g, '');
    for (let i = 0; i < 3 && LEGAL_PREFIX.test(core); i++) core = core.replace(LEGAL_PREFIX, '');
    core = core.trim() || name;
    return core.charAt(0).toUpperCase() + core.slice(1);
}
