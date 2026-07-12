// Studio: image manifest.
// GET → { folders: { 'el-monte': ['images/projects/el-monte/web/x.jpg', ...], ... } }
// Lists committed web-ready images straight from the GitHub tree so the tray
// is always current with the repo (no generated manifest to go stale).

import { createHash, timingSafeEqual } from 'node:crypto';

const REPO = 'mogli77/nick-mason-website';
const IMAGE_RE = /^images\/(projects\/[^/]+\/web|selects\/web|uploads\/web)\/[^/]+\.(jpe?g|png|webp)$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let cacheAt = 0;

const sha = (s) => createHash('sha256').update(String(s)).digest();

function authorized(req) {
    const pass = process.env.STUDIO_PASSWORD || '';
    const key = req.headers.get('x-studio-key') || '';
    return Boolean(pass) && timingSafeEqual(sha(key), sha(pass));
}

function folderLabel(path) {
    const m = path.match(/^images\/projects\/([^/]+)\/web\//);
    if (m) return m[1];
    if (path.startsWith('images/selects/web/')) return 'selects';
    if (path.startsWith('images/uploads/web/')) return 'uploads';
    return 'other';
}

export default async (req) => {
    if (req.method !== 'GET') {
        return Response.json({ error: 'method', message: 'GET only' }, { status: 405 });
    }
    if (!authorized(req)) {
        return Response.json({ error: 'auth', message: 'Wrong passphrase.' }, { status: 401 });
    }

    if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
        return Response.json(cache);
    }

    const branch = process.env.STUDIO_TARGET_BRANCH || 'main';
    const token = process.env.GITHUB_TOKEN || '';

    // Local-dev fallback: no token needed when running under `netlify dev` —
    // walk the working tree instead.
    if (!token && process.env.NETLIFY_DEV === 'true') {
        const { readdirSync } = await import('node:fs');
        const folders = {};
        const roots = ['images/projects/el-monte/web', 'images/projects/la-marina/web',
            'images/projects/pomar-lane/web', 'images/selects/web', 'images/uploads/web'];
        for (const root of roots) {
            try {
                for (const name of readdirSync(root)) {
                    const path = `${root}/${name}`;
                    if (!IMAGE_RE.test(path)) continue;
                    const label = folderLabel(path);
                    (folders[label] ||= []).push(path);
                }
            } catch { /* folder missing locally — skip */ }
        }
        for (const k of Object.keys(folders)) folders[k].sort();
        return Response.json({ folders, generatedAt: new Date().toISOString(), source: 'local' });
    }

    if (!token) {
        return Response.json({ error: 'config', message: 'GITHUB_TOKEN is not configured on this site.' }, { status: 502 });
    }

    const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'nm-studio',
        },
    });
    if (!res.ok) {
        return Response.json({ error: 'github', message: `GitHub tree fetch failed (${res.status}).` }, { status: 502 });
    }
    const tree = await res.json();
    if (tree.truncated) {
        return Response.json({ error: 'github', message: 'GitHub tree truncated — repo too large for recursive listing.' }, { status: 502 });
    }

    const folders = {};
    for (const entry of tree.tree || []) {
        if (entry.type !== 'blob' || !IMAGE_RE.test(entry.path)) continue;
        const label = folderLabel(entry.path);
        (folders[label] ||= []).push(entry.path);
    }
    for (const k of Object.keys(folders)) folders[k].sort();

    cache = { folders, generatedAt: new Date().toISOString(), source: branch };
    cacheAt = Date.now();
    return Response.json(cache);
};
