// Public display name, kept in sync with displayName() in public/js/organizations.js.
const LEGAL_PREFIX = /^(міжнародн\S*\s+|всеукраїнськ\S*\s+)?(благодійн\S*\s+(організаці\S*|фонд\S*)|громадськ\S*\s+(організаці\S*|спілк\S*|об.єднанн\S*)|бо|бф|го|мбф)\s+/i;

function stripLegal(s) {
    let out = s.replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 4 && LEGAL_PREFIX.test(`${out} `); i++) out = `${out} `.replace(LEGAL_PREFIX, '').trim();
    return out;
}

/** "Благодійна організація «Благодійний фонд «Скаути Миколаєва»»" → "Скаути Миколаєва" */
export function displayName(org) {
    if (org.short_name) return org.short_name.replace(/^[«"]+|[»"]+$/g, '').trim();
    const name = String(org.name || '');
    // The innermost quoted part is the organization's own name (works with unbalanced quotes too).
    const open = name.lastIndexOf('«');
    let core = stripLegal(open >= 0 ? name.slice(open + 1).split('»')[0] : name);
    if (!core) core = stripLegal(name) || name;
    return core.charAt(0).toUpperCase() + core.slice(1);
}
