// Studio API client: thin wrappers over the two Netlify functions.
// Every call carries the shared passphrase; a 401 anywhere bounces to login.

const AUTH_KEY = 'nickMason.studio.auth';

export function getAuth() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_KEY)) || null;
    } catch {
        return null;
    }
}

export function setAuth(auth) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
    localStorage.removeItem(AUTH_KEY);
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
    onUnauthorized = fn;
}

async function call(path, options = {}) {
    const auth = getAuth();
    const res = await fetch(path, {
        ...options,
        headers: {
            ...(options.headers || {}),
            'X-Studio-Key': (auth && auth.key) || '',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    let json = null;
    try {
        json = await res.json();
    } catch {
        json = { error: 'network', message: `Unexpected response (${res.status}).` };
    }
    if (res.status === 401) {
        onUnauthorized();
    }
    return { ok: res.ok, status: res.status, data: json };
}

export function fetchContent() {
    return call('/.netlify/functions/studio-content');
}

export function fetchImages() {
    return call('/.netlify/functions/studio-images');
}

export function publish({ editor, gallery, baseGalleryHash, dryRun = false, force = false }) {
    return call('/.netlify/functions/studio-content', {
        method: 'POST',
        body: JSON.stringify({ editor, gallery, baseGalleryHash, dryRun, force }),
    });
}

// Try a key before storing it (probe with the content GET).
export async function verifyKey(key) {
    const res = await fetch('/.netlify/functions/studio-content', {
        headers: { 'X-Studio-Key': key },
    });
    return res.status !== 401;
}
