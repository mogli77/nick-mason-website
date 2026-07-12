// Studio (LOCAL PRO ONLY): save a new image into the working tree so it can
// be dragged onto the page. Files land in images/uploads/web/ (or a project
// web folder) exactly as provided — no re-processing, per the image pipeline
// rule (Lightroom-exported JPEGs go in untouched).

import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s)).digest();

const FOLDERS = {
    'uploads': 'images/uploads/web',
    'selects': 'images/selects/web',
    'el-monte': 'images/projects/el-monte/web',
    'la-marina': 'images/projects/la-marina/web',
    'pomar-lane': 'images/projects/pomar-lane/web',
};

function authorized(req) {
    const pass = process.env.STUDIO_PASSWORD || '';
    const key = req.headers.get('x-studio-key') || '';
    return Boolean(pass) && timingSafeEqual(sha(key), sha(pass));
}

export default async (req) => {
    if (process.env.NETLIFY_DEV !== 'true') {
        return Response.json({ error: 'local-only', message: 'Uploads are only available in local Studio (files must go through the repo).' }, { status: 403 });
    }
    if (!authorized(req)) {
        return Response.json({ error: 'auth', message: 'Wrong passphrase.' }, { status: 401 });
    }
    if (req.method !== 'POST') {
        return Response.json({ error: 'method', message: 'POST only.' }, { status: 405 });
    }
    const { name, folder = 'uploads', dataBase64 } = await req.json().catch(() => ({}));
    const dir = FOLDERS[folder];
    if (!dir) {
        return Response.json({ error: 'body', message: `Unknown folder "${folder}".` }, { status: 400 });
    }
    const safe = String(name || '').replace(/[^\w.\- ]/g, '').replace(/\s+/g, '-');
    if (!/\.(jpe?g|png|webp)$/i.test(safe)) {
        return Response.json({ error: 'body', message: 'Only .jpg, .png or .webp images.' }, { status: 400 });
    }
    if (!dataBase64 || dataBase64.length > 12_000_000) {
        return Response.json({ error: 'body', message: 'Missing or oversized file (8MB max).' }, { status: 400 });
    }
    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    let path = `${dir}/${safe}`;
    if (existsSync(path)) {
        path = `${dir}/${safe.replace(/(\.\w+)$/, `-${Date.now().toString(36)}$1`)}`;
    }
    writeFileSync(path, Buffer.from(dataBase64, 'base64'));
    return Response.json({ path });
};
