// The one page a person sees: confirm the code a Ramu app or `ramu link login` shows, signing in with Google or GitHub
// first if needed. English and Indonesian, chosen from the browser's languages.

const STRINGS = {
  en: {
    title: 'Connect a Ramu device',
    intro: 'Check that this code matches the one shown in Ramu, then approve it.',
    code: 'Code',
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    signedIn: 'Signed in as',
    approve: 'Approve',
    deny: 'Deny',
    approved: 'Approved. You can return to Ramu; it continues on its own.',
    denied: 'Denied. Nothing was connected.',
    invalid: 'This code is wrong or expired. Start again in Ramu.',
    enter: 'Enter the code shown in Ramu',
    next: 'Continue',
    noProviders: 'This Ramu Link service has no sign-in providers configured.',
    privacy:
      'Ramu Link stores your name, email and the names of the computers you link. Conversations, files and settings never pass through it readably.',
    signOut: 'Use another account',
  },
  id: {
    title: 'Hubungkan perangkat Ramu',
    intro: 'Pastikan kode ini sama dengan yang tampil di Ramu, lalu setujui.',
    code: 'Kode',
    google: 'Lanjutkan dengan Google',
    github: 'Lanjutkan dengan GitHub',
    signedIn: 'Masuk sebagai',
    approve: 'Setujui',
    deny: 'Tolak',
    approved: 'Disetujui. Kembali ke Ramu; prosesnya berlanjut sendiri.',
    denied: 'Ditolak. Tidak ada yang terhubung.',
    invalid: 'Kode ini salah atau kedaluwarsa. Mulai lagi di Ramu.',
    enter: 'Masukkan kode yang tampil di Ramu',
    next: 'Lanjut',
    noProviders: 'Layanan Ramu Link ini belum memiliki penyedia masuk.',
    privacy:
      'Ramu Link menyimpan nama, email, dan nama komputer yang Anda tautkan. Percakapan, berkas, dan pengaturan tidak pernah melewatinya dalam bentuk terbaca.',
    signOut: 'Gunakan akun lain',
  },
} as const
type Strings = Record<keyof (typeof STRINGS)['en'], string>

export function language(header: string | null): keyof typeof STRINGS {
  for (const part of (header ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? ''
    if (tag === 'id' || tag.startsWith('id-')) return 'id'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return 'en'
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Everything dynamic is filled in by the script from the API, never interpolated into markup. */
export function devicePage(lang: keyof typeof STRINGS, providers: string[], nonce: string): string {
  const t: Strings = STRINGS[lang]
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(t.title)}</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--fg:#18181b;--muted:#71717a;--bg:#fafafa;--card:#fff;--line:#e4e4e7;--accent:#6d28d9}
@media (prefers-color-scheme:dark){:root{--fg:#fafafa;--muted:#a1a1aa;--bg:#09090b;--card:#18181b;--line:#27272a;--accent:#8b5cf6}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(420px,92vw);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:19px;margin:0 0 6px}p{margin:0 0 16px;color:var(--muted)}
.code{font:600 26px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-align:center;padding:14px;border:1px dashed var(--line);border-radius:10px;margin:0 0 18px}
button,input{width:100%;font:inherit;border-radius:9px;padding:10px 12px;margin:0 0 10px}
input{border:1px solid var(--line);background:transparent;color:var(--fg);text-transform:uppercase;letter-spacing:.08em}
button{border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.small{font-size:13px}.row{display:flex;gap:10px}.row button{flex:1}[hidden]{display:none!important}
</style>
</head>
<body>
<main>
<h1>${escape(t.title)}</h1>
<section id="enter" hidden>
<p>${escape(t.enter)}</p>
<form id="enter-form"><label class="small" for="code-input">${escape(t.code)}</label><input id="code-input" autocomplete="one-time-code" maxlength="12" required><button class="primary" type="submit">${escape(t.next)}</button></form>
</section>
<section id="confirm" hidden>
<p>${escape(t.intro)}</p>
<div class="code" id="code" aria-label="${escape(t.code)}"></div>
<div id="signin" hidden>
${providers.includes('google') ? `<button data-provider="google">${escape(t.google)}</button>` : ''}
${providers.includes('github') ? `<button data-provider="github">${escape(t.github)}</button>` : ''}
${providers.length ? '' : `<p>${escape(t.noProviders)}</p>`}
</div>
<div id="decide" hidden>
<p class="small">${escape(t.signedIn)} <strong id="who"></strong> · <a href="#" id="switch">${escape(t.signOut)}</a></p>
<div class="row"><button id="deny">${escape(t.deny)}</button><button class="primary" id="approve">${escape(t.approve)}</button></div>
</div>
</section>
<p id="status" role="status" aria-live="polite"></p>
<p class="small">${escape(t.privacy)}</p>
</main>
<script nonce="${nonce}">
const T=${JSON.stringify({ approved: t.approved, denied: t.denied, invalid: t.invalid })};
const $=(id)=>document.getElementById(id);
const api=(path,init)=>fetch('/api/auth'+path,{credentials:'include',headers:{'content-type':'application/json'},...init});
const params=new URLSearchParams(location.search);
const code=(params.get('user_code')||'').toUpperCase();
const status=(text)=>{$('status').textContent=text};
async function load(){
  if(!code){$('enter').hidden=false;return}
  $('confirm').hidden=false;$('code').textContent=code;
  const session=await api('/get-session').then(r=>r.ok?r.json():null).catch(()=>null);
  if(!session||!session.user){$('signin').hidden=false;return}
  const check=await api('/device?user_code='+encodeURIComponent(code));
  if(!check.ok){status(T.invalid);return}
  $('who').textContent=session.user.email||session.user.name;$('decide').hidden=false;
}
$('enter-form').addEventListener('submit',(e)=>{e.preventDefault();location.search='?user_code='+encodeURIComponent($('code-input').value.trim().toUpperCase())});
for(const b of document.querySelectorAll('[data-provider]'))b.addEventListener('click',async()=>{
  const r=await api('/sign-in/social',{method:'POST',body:JSON.stringify({provider:b.dataset.provider,callbackURL:location.pathname+location.search})});
  const body=await r.json().catch(()=>({}));if(body.url)location.href=body.url;
});
async function decide(action){
  $('decide').hidden=true;
  const r=await api('/device/'+action,{method:'POST',body:JSON.stringify({userCode:code})});
  status(r.ok?(action==='approve'?T.approved:T.denied):T.invalid);
}
$('approve').addEventListener('click',()=>decide('approve'));
$('deny').addEventListener('click',()=>decide('deny'));
$('switch').addEventListener('click',async(e)=>{e.preventDefault();await api('/sign-out',{method:'POST',body:'{}'});location.reload()});
load();
</script>
</body>
</html>`
}
