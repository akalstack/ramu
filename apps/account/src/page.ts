// The page a sign-in code opens in the system browser: sign in with GitHub, Google or a passkey, check the code matches
// the one Ramu shows, then Approve. It is the only page the service serves; everything else is the API.

import { MARK, MARK_VIEW_BOX } from '@ramu/shared/brandMark'

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

// Each sign-in method's own mark beside its name, drawn inline so the page loads nothing else. GitHub's mark is black
// or white by design, so it follows the text color; Google's "G" keeps its four colors on both surfaces.
const ICONS = {
  ramu: `<svg class="mark" viewBox="${MARK_VIEW_BOX}" aria-hidden="true"><rect x="${MARK.origin}" y="${MARK.origin}" width="${MARK.size}" height="${MARK.size}" rx="128" fill="#232327"/><g transform="translate(512 512) scale(0.72) translate(-512 -512)"><path d="${MARK.stem}" fill="none" stroke="#f5f5f7" stroke-width="120" stroke-linecap="round"/><circle cx="${MARK.dot.cx}" cy="${MARK.dot.cy}" r="${MARK.dot.r}" fill="${MARK.dotColor}"/></g></svg>`,
  github: `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
  google: `<svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
  passkey: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
}

export function devicePage(userCode: string): string {
  const code = escape(
    userCode
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 16),
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Ramu</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light dark; --bg: #f5f5f7; --card: #fff; --text: #18181b; --muted: #6b6b76; --line: #e4e4e7; --hover: #f4f4f5; --code: #fafafa; --accent: #6d4ae8; --accent-hover: #5f3dd9; --ring: rgba(125, 108, 255, 0.45); }
  @media (prefers-color-scheme: dark) { :root { --bg: #111113; --card: #1a1a1d; --text: #f4f4f5; --muted: #a1a1aa; --line: #2e2e33; --hover: #242428; --code: #151517; --accent: #6d4ae8; --accent-hover: #7b5bf0; --ring: rgba(125, 108, 255, 0.6); } }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; -webkit-font-smoothing: antialiased; }
  main { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px 22px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06); }
  header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 20px; }
  .mark { width: 48px; height: 48px; margin-bottom: 12px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .by { color: var(--muted); font-size: 13px; margin: 2px 0 0; }
  .lead { text-align: center; margin: 0; color: var(--muted); font-size: 14px; }
  .code { font: 600 26px/1.2 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.12em; text-align: center; padding: 14px 12px; background: var(--code); border: 1px dashed var(--line); border-radius: 12px; margin: 10px 0 20px; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  button { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; font: inherit; font-weight: 500; padding: 10px 44px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
  button:hover { background: var(--hover); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button:disabled { opacity: 0.6; cursor: default; }
  button .icon { position: absolute; left: 14px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.quiet { border-color: transparent; background: transparent; color: var(--muted); font-weight: 400; }
  button.quiet:hover { background: var(--hover); color: var(--text); }
  .or { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; margin: 4px 0; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .who { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 4px; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--hover); border: 1px solid var(--line); color: var(--muted); font-weight: 600; font-size: 15px; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .who-text { min-width: 0; }
  .who-text p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who-label { color: var(--muted); font-size: 12px; }
  .who-name { font-weight: 600; }
  .who-email { color: var(--muted); font-size: 13px; }
  p { margin: 8px 0; }
  .muted { color: var(--muted); font-size: 13px; }
  .error { color: #d14343; font-size: 13px; }
  #status:empty { display: none; }
  #status { text-align: center; margin-top: 14px; }
  footer { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; text-align: center; }
  footer p { margin: 0; }
  a { color: inherit; text-underline-offset: 2px; }
</style>
</head>
<body>
<main>
  <header>
    ${ICONS.ramu}
    <h1>Sign in to Ramu</h1>
    <p class="by">by Akalstack · account.akalstack.com</p>
  </header>
  <p class="lead">Check that this code matches the one Ramu shows:</p>
  <div class="code" id="code">${code || '—'}</div>
  <div id="signed-out" class="stack" hidden>
    <button data-provider="github">${ICONS.github}<span>Continue with GitHub</span></button>
    <button data-provider="google">${ICONS.google}<span>Continue with Google</span></button>
    <div class="or" aria-hidden="true">or</div>
    <button id="passkey">${ICONS.passkey}<span>Sign in with a passkey</span></button>
  </div>
  <div id="signed-in" class="stack" hidden>
    <div class="who">
      <span class="avatar" id="avatar" aria-hidden="true"></span>
      <div class="who-text">
        <p class="who-label">Signed in as</p>
        <p class="who-name" id="who-name"></p>
        <p class="who-email" id="who-email"></p>
      </div>
    </div>
    <button class="primary" id="approve">Approve</button>
    <button id="deny">Deny</button>
    <button class="quiet" id="add-passkey">${ICONS.passkey}<span>Add a passkey for next time</span></button>
  </div>
  <p id="status" class="muted" role="status"></p>
  <footer>
    <p>Signing in never gives access to a host: each host still approves every device itself. <a href="https://akalstack.com/privacy">Privacy</a></p>
  </footer>
</main>
<script>
const code = ${JSON.stringify(code)};
const status = document.getElementById('status');
const say = (text, error) => { status.textContent = text; status.className = error ? 'error' : 'muted'; };
const api = async (path, body) => {
  const response = await fetch('/api/auth' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && (data.message || data.error_description || data.error)) || 'Something went wrong.');
  return data;
};
const b64u = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const fromB64u = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
// The person's picture from GitHub or Google beside their name, or their initials when there is none or it fails to load.
function showWho(user) {
  const name = user.name || user.email || '';
  document.getElementById('who-name').textContent = name;
  document.getElementById('who-email').textContent = user.email && user.email !== name ? user.email : '';
  const avatar = document.getElementById('avatar');
  const initials = () => { avatar.textContent = (user.name || (user.email || '').split('@')[0]).split(/[\\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?'; };
  avatar.textContent = '';
  if (typeof user.image === 'string' && user.image.startsWith('https://')) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { img.remove(); initials(); };
    img.src = user.image;
    avatar.append(img);
  } else initials();
}
async function show() {
  const session = await api('/get-session').catch(() => null);
  document.getElementById('signed-in').hidden = !session;
  document.getElementById('signed-out').hidden = !!session;
  if (!session) return;
  showWho(session.user);
  // Looking the code up while signed in claims it for this account; approving or denying needs that first.
  if (!code) return;
  try {
    const request = await api('/device?user_code=' + encodeURIComponent(code));
    if (request.status !== 'pending') {
      document.getElementById('signed-in').hidden = true;
      say(request.status === 'approved' ? 'Already approved. You can close this tab.' : 'This sign-in was denied.');
    }
  } catch (error) { say(error.message, true); }
}
for (const button of document.querySelectorAll('[data-provider]'))
  button.onclick = async () => {
    try {
      const { url } = await api('/sign-in/social', { provider: button.dataset.provider, callbackURL: location.href });
      location.href = url;
    } catch (error) { say(error.message, true); }
  };
document.getElementById('passkey').onclick = async () => {
  try {
    const options = await api('/passkey/generate-authenticate-options');
    const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: fromB64u(options.challenge), allowCredentials: (options.allowCredentials || []).map((entry) => ({ ...entry, id: fromB64u(entry.id) })) } });
    const r = credential.response;
    await api('/passkey/verify-authentication', { response: { id: credential.id, rawId: b64u(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined } } });
    await show();
  } catch (error) { say(error.message, true); }
};
document.getElementById('add-passkey').onclick = async () => {
  try {
    const options = await api('/passkey/generate-register-options');
    const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: fromB64u(options.challenge), user: { ...options.user, id: fromB64u(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map((entry) => ({ ...entry, id: fromB64u(entry.id) })) } });
    const r = credential.response;
    await api('/passkey/verify-registration', { response: { id: credential.id, rawId: b64u(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] } } });
    say('Passkey added. Next time, sign in with it.');
  } catch (error) { say(error.message, true); }
};
document.getElementById('approve').onclick = async () => {
  try { await api('/device/approve', { userCode: code }); say('Approved. You can close this tab and return to Ramu.'); }
  catch (error) { say(error.message, true); }
};
document.getElementById('deny').onclick = async () => {
  try { await api('/device/deny', { userCode: code }); say('Denied. Nothing was signed in.'); }
  catch (error) { say(error.message, true); }
};
void show();
</script>
</body>
</html>`
}
