// Studio: page content read + publish.
//
// GET  → { content, sha, branch, lastCommit } — portfolio.html source + blob sha.
// POST → publish: splice a new gallery region into the freshly-fetched file and
//        commit via the GitHub Contents API. Body:
//        { editor, gallery, baseGalleryHash, dryRun?, force? }
//
// Safety model: the server never trusts client file content — it re-fetches the
// file, locates the gallery region by strict full-line anchors, verifies the
// client edited the version it thinks it edited (region hash), and refuses to
// publish on any structural surprise. Worst case is a refused publish, never a
// corrupted commit.

import { createHash, timingSafeEqual } from 'node:crypto';

const REPO = 'mogli77/nick-mason-website';
const FILE_PATH = 'portfolio.html';
const OPEN_RE = /^\s*<section class="project-gallery">\s*$/;
const CLOSE_RE = /^\s{8}<\/section>\s*$/;

const shaBuf = (s) => createHash('sha256').update(String(s)).digest();
const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

function authorized(req) {
    const pass = process.env.STUDIO_PASSWORD || '';
    const key = req.headers.get('x-studio-key') || '';
    return Boolean(pass) && timingSafeEqual(shaBuf(key), shaBuf(pass));
}

function ghHeaders() {
    return {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nm-studio',
    };
}

// Split a full portfolio.html into { prefix, region, suffix } by strict anchors.
// prefix ends with the <section> line; suffix starts with the </section> line.
// Throws with a human message when the structure is not what Studio expects.
function splitFile(text) {
    const lines = text.split('\n');
    const opens = [];
    for (let i = 0; i < lines.length; i++) {
        if (OPEN_RE.test(lines[i])) opens.push(i);
    }
    if (opens.length !== 1) {
        throw new Error(`Expected exactly one <section class="project-gallery"> line, found ${opens.length}.`);
    }
    const open = opens[0];
    let close = -1;
    for (let i = open + 1; i < lines.length; i++) {
        if (/<section\b/.test(lines[i])) {
            throw new Error(`Unexpected nested <section> inside the gallery (line ${i + 1}).`);
        }
        if (CLOSE_RE.test(lines[i])) { close = i; break; }
    }
    if (close === -1) {
        throw new Error('Could not find the gallery closing </section> line.');
    }
    return {
        prefix: lines.slice(0, open + 1).join('\n'),
        region: lines.slice(open + 1, close).join('\n'),
        suffix: lines.slice(close).join('\n'),
    };
}

async function fetchFile(branch) {
    // Local-dev fallback: read the working tree under `netlify dev` (no token needed).
    if (!process.env.GITHUB_TOKEN && process.env.NETLIFY_DEV === 'true') {
        const { readFileSync } = await import('node:fs');
        return { content: readFileSync(FILE_PATH, 'utf8'), sha: 'local-dev', local: true };
    }
    const res = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${encodeURIComponent(branch)}`,
        { headers: ghHeaders() }
    );
    if (res.status === 401 || res.status === 403) throw new Error('GitHub token problem — check or regenerate GITHUB_TOKEN.');
    if (!res.ok) throw new Error(`GitHub contents fetch failed (${res.status}).`);
    const json = await res.json();
    return { content: Buffer.from(json.content, 'base64').toString('utf8'), sha: json.sha, local: false };
}

async function fetchLastCommit(branch) {
    if (!process.env.GITHUB_TOKEN) return null;
    try {
        const res = await fetch(
            `https://api.github.com/repos/${REPO}/commits?path=${FILE_PATH}&per_page=1&sha=${encodeURIComponent(branch)}`,
            { headers: ghHeaders() }
        );
        if (!res.ok) return null;
        const [c] = await res.json();
        return c ? { message: c.commit.message, date: c.commit.committer.date, sha: c.sha } : null;
    } catch {
        return null;
    }
}

async function handleGet(branch) {
    const file = await fetchFile(branch);
    const { region } = splitFile(file.content); // validates structure up front
    const lastCommit = await fetchLastCommit(branch);
    return Response.json({
        content: file.content,
        sha: file.sha,
        branch,
        galleryHash: sha256hex(region),
        lastCommit,
        local: file.local || false,
    });
}

async function commitFile(branch, newContent, blobSha, message) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            content: Buffer.from(newContent, 'utf8').toString('base64'),
            sha: blobSha,
            branch,
        }),
    });
    return res;
}

async function handlePost(req, branch) {
    let body;
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'body', message: 'Invalid JSON body.' }, { status: 400 });
    }
    const { editor, gallery, baseGalleryHash, dryRun = false, force = false } = body || {};

    // Structural validation of the incoming region.
    if (typeof gallery !== 'string' || !gallery.trim()) {
        return Response.json({ error: 'body', message: 'Empty gallery.' }, { status: 400 });
    }
    if (gallery.length > 200_000) {
        return Response.json({ error: 'body', message: 'Gallery region implausibly large.' }, { status: 400 });
    }
    if (!gallery.includes('gallery-item')) {
        return Response.json({ error: 'body', message: 'Gallery region contains no gallery items.' }, { status: 400 });
    }
    if (/<section\b|<\/section>/i.test(gallery)) {
        return Response.json({ error: 'body', message: 'Gallery region must not contain <section> tags.' }, { status: 400 });
    }
    if (!['Nick', 'Kelly'].includes(editor)) {
        return Response.json({ error: 'body', message: 'Unknown editor.' }, { status: 400 });
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        const file = await fetchFile(branch);
        if (file.local && !dryRun) {
            return Response.json({ error: 'config', message: 'Publishing requires GITHUB_TOKEN (local dev is read-only).' }, { status: 502 });
        }
        let parts;
        try {
            parts = splitFile(file.content);
        } catch (e) {
            return Response.json({ error: 'structure', message: e.message }, { status: 422 });
        }

        // Conflict check: has the gallery moved since this client loaded it?
        const currentHash = sha256hex(parts.region);
        if (currentHash !== baseGalleryHash && !force) {
            const lastCommit = await fetchLastCommit(branch);
            return Response.json({
                error: 'conflict',
                message: 'The page changed since you loaded it.',
                currentHash,
                lastCommit,
            }, { status: 409 });
        }

        const newFile = parts.prefix + '\n' + gallery + '\n' + parts.suffix;

        // Sanity: the splice must produce a structurally plausible file.
        if (!newFile.trimEnd().endsWith('</html>')) {
            return Response.json({ error: 'structure', message: 'Spliced file does not end with </html>.' }, { status: 422 });
        }
        const ratio = newFile.length / file.content.length;
        if (ratio < 0.4 || ratio > 1.6) {
            return Response.json({ error: 'structure', message: 'Spliced file size is implausible — refusing.' }, { status: 422 });
        }

        if (dryRun) {
            return Response.json({
                dryRun: true,
                spliced: newFile,
                newGalleryHash: sha256hex(gallery),
                wouldCommit: `Studio: layout update by ${editor}`,
            });
        }

        const res = await commitFile(branch, newFile, file.sha, `Studio: layout update by ${editor}`);
        if (res.status === 409 && attempt === 0) continue; // lost a race — re-fetch and retry once
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            const message = res.status === 401 || res.status === 403
                ? 'GitHub token expired or lacks access — regenerate GITHUB_TOKEN.'
                : `GitHub commit failed (${res.status}).`;
            return Response.json({ error: 'github', message, detail: detail.slice(0, 300) }, { status: 502 });
        }
        const json = await res.json();
        return Response.json({
            commitSha: json.commit && json.commit.sha,
            newBlobSha: json.content && json.content.sha,
            newGalleryHash: sha256hex(gallery),
            branch,
        });
    }
    return Response.json({ error: 'github', message: 'Commit raced twice — try again.' }, { status: 502 });
}

export default async (req) => {
    if (!authorized(req)) {
        return Response.json({ error: 'auth', message: 'Wrong passphrase.' }, { status: 401 });
    }
    const branch = process.env.STUDIO_TARGET_BRANCH || 'main';
    try {
        if (req.method === 'GET') return await handleGet(branch);
        if (req.method === 'POST') return await handlePost(req, branch);
        return Response.json({ error: 'method', message: 'GET or POST only.' }, { status: 405 });
    } catch (e) {
        return Response.json({ error: 'server', message: e.message || 'Unexpected error.' }, { status: 502 });
    }
};
