// Studio (LOCAL PRO ONLY): git status + commit/push from the working tree.
// Hard-disabled on the hosted site — publishes there go through the GitHub
// API in studio-content.mjs instead.

import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s)).digest();

function authorized(req) {
    const pass = process.env.STUDIO_PASSWORD || '';
    const key = req.headers.get('x-studio-key') || '';
    return Boolean(pass) && timingSafeEqual(sha(key), sha(pass));
}

export default async (req) => {
    if (process.env.NETLIFY_DEV !== 'true') {
        return Response.json({ error: 'local-only', message: 'Git operations are only available in local Studio.' }, { status: 403 });
    }
    if (!authorized(req)) {
        return Response.json({ error: 'auth', message: 'Wrong passphrase.' }, { status: 401 });
    }
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

    try {
        if (req.method === 'GET') {
            const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
            const status = git('status', '--short', '--', 'portfolio.html', 'images/uploads').trim();
            const diffstat = git('diff', '--stat', '--', 'portfolio.html').trim();
            return Response.json({ branch, status, diffstat, dirty: Boolean(status) });
        }
        if (req.method === 'POST') {
            const { message = '', push = false, editor = 'Nick' } = await req.json().catch(() => ({}));
            const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
            git('add', '--', 'portfolio.html');
            // Include any uploaded images so the page never references untracked files.
            try { git('add', '--', 'images/uploads'); } catch { /* folder may not exist */ }
            const msg = `Studio (local): layout update by ${editor}${message.trim() ? `\n\n${message.trim().slice(0, 500)}` : ''}`;
            git('commit', '-m', msg);
            const commit = git('rev-parse', '--short', 'HEAD').trim();
            let pushed = false;
            if (push) {
                git('push', 'origin', branch);
                pushed = true;
            }
            return Response.json({ commit, branch, pushed });
        }
        return Response.json({ error: 'method', message: 'GET or POST only.' }, { status: 405 });
    } catch (e) {
        const out = (e.stdout || '') + (e.stderr || '') || e.message;
        return Response.json({ error: 'git', message: String(out).slice(0, 500) }, { status: 502 });
    }
};
