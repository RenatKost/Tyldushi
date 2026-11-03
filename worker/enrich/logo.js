// Downloads a logo candidate, checks that it really looks like a logo and stores it in our bucket.
import { imageSize } from 'image-size';
import { storageEnabled, uploadImage } from '../../server/storage.js';

const MAX_BYTES = 2_000_000;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

async function download(url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TyldushiBot/1.0; +https://tyldushi.com/organizations)' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        const length = Number(res.headers.get('content-length') || 0);
        if (length > MAX_BYTES) return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        return buffer.length > MAX_BYTES ? null : buffer;
    } catch {
        return null;
    }
}

/** Returns the MIME type if the image is a plausible logo, otherwise null. */
export function checkLogo(buffer) {
    let info;
    try {
        info = imageSize(buffer);
    } catch {
        return null;
    }
    const mime = TYPES[info.type];
    if (!mime) return null; // .ico and exotic formats are not shown on the site
    if (info.type === 'svg') return mime;
    const { width, height } = info;
    if (!width || !height) return null;
    const short = Math.min(width, height);
    const ratio = Math.max(width, height) / short;
    if (short < 64) return null; // tiny favicons look blurry
    if (ratio > 4) return null; // banners and long strips are not logos
    // Big photographic JPEGs are cover photos, not logos.
    if (info.type === 'jpg' && width > 1400 && height > 900) return null;
    return mime;
}

/** Tries candidates in order; returns a /media URL of the stored logo or null. */
export async function storeFirstLogo(candidates) {
    if (!storageEnabled) return null;
    for (const url of candidates) {
        const buffer = await download(url);
        if (!buffer) continue;
        const mime = checkLogo(buffer);
        if (!mime) continue;
        try {
            return await uploadImage(buffer, mime, 'logos');
        } catch (err) {
            console.warn(`[logo] upload failed: ${err.message}`);
            return null;
        }
    }
    return null;
}
