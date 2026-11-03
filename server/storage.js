import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const bucket = process.env.BUCKET_NAME;

export const storageEnabled = Boolean(
    bucket && process.env.BUCKET_ENDPOINT && process.env.BUCKET_ACCESS_KEY_ID && process.env.BUCKET_SECRET_ACCESS_KEY,
);

const s3 = storageEnabled
    ? new S3Client({
        endpoint: process.env.BUCKET_ENDPOINT,
        region: process.env.BUCKET_REGION || 'auto',
        forcePathStyle: process.env.BUCKET_FORCE_PATH_STYLE === 'true',
        credentials: {
            accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
            secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
        },
    })
    : null;

export const ALLOWED_IMAGE_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
};

export async function uploadImage(buffer, mimeType, folder = 'uploads') {
    if (!s3) throw Object.assign(new Error('Сховище файлів не налаштоване'), { status: 503 });
    const ext = ALLOWED_IMAGE_TYPES[mimeType];
    if (!ext) throw Object.assign(new Error('Дозволені лише зображення JPG, PNG, WEBP, GIF, SVG'), { status: 400 });
    const key = `${folder}/${new Date().getFullYear()}/${crypto.randomBytes(10).toString('hex')}.${ext}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType }));
    return `/media/${key}`;
}

// Buckets on Railway are private, so files are proxied through the app.
export async function mediaHandler(req, res) {
    if (!s3) return res.status(404).end();
    const key = req.params[0];
    if (!key || key.includes('..')) return res.status(400).end();
    try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
        if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (obj.ContentType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        obj.Body.pipe(res);
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return res.status(404).end();
        console.error('[media]', err);
        res.status(500).end();
    }
}
