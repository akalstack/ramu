// The page a sign-in code opens in the system browser: sign in with GitHub, Google or a passkey, check the code matches
// the one Ramu shows, then Approve. It is the only page the service serves; everything else is the API.

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

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
  :root { color-scheme: light dark; --bg: #f7f7f8; --card: #fff; --text: #18181b; --muted: #6b6b76; --line: #e4e4e7; --accent: #6d4ae8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #131315; --card: #1c1c1f; --text: #f4f4f5; --muted: #a1a1aa; --line: #2e2e33; --accent: #8b6cf2; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; padding: 16px; }
  main { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .by { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  .code { font: 600 26px/1.2 ui-monospace, monospace; letter-spacing: 0.08em; text-align: center; padding: 12px; border: 1px dashed var(--line); border-radius: 10px; margin: 12px 0 18px; }
  button { width: 100%; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; margin-top: 8px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  p { margin: 8px 0; }
  .muted { color: var(--muted); font-size: 13px; }
  .error { color: #d14343; }
</style>
</head>
<body>
<main>
  <h1>Ramu</h1>
  <p class="by">by Akalstack · account.akalstack.com</p>
  <p>Check that this code matches the one Ramu shows:</p>
  <div class="code" id="code">${code || '—'}</div>
  <div id="signed-out" hidden>
    <button data-provider="github">Continue with GitHub</button>
    <button data-provider="google">Continue with Google</button>
    <button id="passkey">Sign in with a passkey</button>
  </div>
  <div id="signed-in" hidden>
    <p id="who"></p>
    <button class="primary" id="approve">Approve</button>
    <button id="deny">Deny</button>
    <button id="add-passkey">Add a passkey for next time</button>
  </div>
  <p id="status" class="muted" role="status"></p>
  <p class="muted">Signing in never gives access to a host: each host still approves every device itself. <a href="https://akalstack.com/privacy">Privacy</a></p>
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
async function show() {
  const session = await api('/get-session').catch(() => null);
  document.getElementById('signed-in').hidden = !session;
  document.getElementById('signed-out').hidden = !!session;
  if (!session) return;
  document.getElementById('who').textContent = 'Signed in as ' + (session.user.email || session.user.name) + '.';
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
