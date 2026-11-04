// The pages a person sees: confirming the code a Ramu app or `ramu link login` shows (signing in with Google or GitHub
// first if needed), paying for Plus, and the privacy notice and terms. English and Indonesian, chosen from the
// browser's languages.

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
    privacyLink: 'Privacy',
    termsLink: 'Terms',
    checkoutTitle: 'Ramu Plus',
    checkoutIntro: 'The payment form opens here. Paddle handles the payment and the tax for your country.',
    checkoutDone: 'Payment received. Return to Ramu; Plus shows there within a minute.',
    checkoutClosed: 'Checkout closed without paying. You can close this page.',
    checkoutMissing: 'This checkout link is incomplete. Start again from Get Plus in Ramu.',
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
    privacyLink: 'Privasi',
    termsLink: 'Ketentuan',
    checkoutTitle: 'Ramu Plus',
    checkoutIntro: 'Formulir pembayaran terbuka di sini. Paddle mengurus pembayaran dan pajak untuk negara Anda.',
    checkoutDone: 'Pembayaran diterima. Kembali ke Ramu; Plus tampil di sana dalam satu menit.',
    checkoutClosed: 'Checkout ditutup tanpa pembayaran. Halaman ini boleh ditutup.',
    checkoutMissing: 'Tautan checkout ini tidak lengkap. Mulai lagi dari Dapatkan Plus di Ramu.',
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

const STYLE = `:root{color-scheme:light dark;--fg:#18181b;--muted:#71717a;--bg:#fafafa;--card:#fff;--line:#e4e4e7;--accent:#6d28d9}
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
footer{margin-top:18px;display:flex;gap:14px}footer a,main a{color:var(--muted)}
article p,article li{color:var(--fg)}article h2{font-size:15px;margin:18px 0 6px}article ul{padding-left:18px;margin:0 0 12px}`

const footer = (t: Strings) =>
  `<footer class="small"><a href="/privacy">${escape(t.privacyLink)}</a><a href="/terms">${escape(t.termsLink)}</a></footer>`

/** Everything dynamic is filled in by the script from the API, never interpolated into markup. */
export function devicePage(lang: keyof typeof STRINGS, providers: string[], nonce: string): string {
  const t: Strings = STRINGS[lang]
  return `${head(lang, t.title, nonce)}
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
${footer(t)}
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

const head = (lang: string, title: string, nonce: string) => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(title)}</title>
<style nonce="${nonce}">
${STYLE}
</style>
</head>`

/**
 * Paddle's default payment link points here. Paddle.js opens the checkout for the transaction in the address
 * (`_ptxn`), priced for the buyer's country; this page only reports how it ended.
 */
export function checkoutPage(lang: keyof typeof STRINGS, nonce: string, clientToken: string, sandbox: boolean): string {
  const t: Strings = STRINGS[lang]
  return `${head(lang, t.checkoutTitle, nonce)}
<body>
<main>
<h1>${escape(t.checkoutTitle)}</h1>
<p id="status" role="status" aria-live="polite">${escape(t.checkoutIntro)}</p>
${footer(t)}
</main>
<script nonce="${nonce}" src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script nonce="${nonce}">
const T=${JSON.stringify({ done: t.checkoutDone, closed: t.checkoutClosed, missing: t.checkoutMissing })};
const status=(text)=>{document.getElementById('status').textContent=text};
let paid=false;
if(!new URLSearchParams(location.search).get('_ptxn'))status(T.missing);
${sandbox ? "Paddle.Environment.set('sandbox');" : ''}
Paddle.Initialize({token:${JSON.stringify(clientToken)},eventCallback:(e)=>{
  if(e.name==='checkout.completed'){paid=true;status(T.done)}
  else if(e.name==='checkout.closed'&&!paid)status(T.closed);
}});
</script>
</body>
</html>`
}

/** Paddle.js loads its checkout from Paddle's own origins; nothing else on this page may load or connect anywhere. */
export const checkoutPolicy = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.paddle.com; style-src 'unsafe-inline' https://cdn.paddle.com; img-src https: data:; font-src https://cdn.paddle.com; connect-src https://*.paddle.com; frame-src https://buy.paddle.com https://sandbox-buy.paddle.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`

const LEGAL = {
  privacy: {
    en: {
      title: 'Ramu Link privacy notice',
      body: `<p>Ramu Link connects your Ramu devices to your computers. It is built so that it cannot read what passes through it.</p>
<h2>What it stores</h2>
<ul>
<li>Your account: name, email and the Google or GitHub account you sign in with, and your sign-in sessions with the IP address and browser they started from.</li>
<li>Each computer you link: its name, its public key, whether it is online and when it was last seen.</li>
<li>Relayed time: seconds and message counts per day, to apply the Free plan's hours and to measure what the service costs.</li>
<li>Your plan: Free or Plus, until when, and the Paddle subscription it comes from.</li>
<li>Accounts you share a computer with.</li>
<li>Webhook requests for a computer that is offline, sealed so only that computer can open them, for at most a day.</li>
</ul>
<h2>What it never sees</h2>
<p>Every connection between a device and a computer is end-to-end encrypted. Conversations, files, code, terminals, settings and device tokens pass through as sealed bytes. Ramu Link does not see payment details: Paddle is the seller and handles them under its own privacy notice.</p>
<h2>Who processes it</h2>
<p>The service runs on Cloudflare Workers. Sign-in goes through Google or GitHub, payments through Paddle.</p>
<h2>Deleting it</h2>
<p>Delete your account in Ramu (Settings → Remote access → Ramu Link). Everything above goes with it, and a subscription is cancelled first.</p>`,
    },
    id: {
      title: 'Pemberitahuan privasi Ramu Link',
      body: `<p>Ramu Link menghubungkan perangkat Ramu Anda ke komputer Anda. Layanan ini dibuat agar tidak bisa membaca apa pun yang melewatinya.</p>
<h2>Yang disimpan</h2>
<ul>
<li>Akun Anda: nama, email, dan akun Google atau GitHub yang Anda pakai untuk masuk, serta sesi masuk beserta alamat IP dan browser asalnya.</li>
<li>Setiap komputer yang Anda tautkan: namanya, kunci publiknya, apakah sedang online, dan kapan terakhir terlihat.</li>
<li>Waktu relay: detik dan jumlah pesan per hari, untuk menerapkan jam paket Free dan mengukur biaya layanan.</li>
<li>Paket Anda: Free atau Plus, sampai kapan, dan langganan Paddle asalnya.</li>
<li>Akun yang Anda bagikan akses komputernya.</li>
<li>Permintaan webhook untuk komputer yang sedang offline, tersegel sehingga hanya komputer itu yang bisa membukanya, paling lama satu hari.</li>
</ul>
<h2>Yang tidak pernah terlihat</h2>
<p>Setiap koneksi antara perangkat dan komputer terenkripsi ujung ke ujung. Percakapan, berkas, kode, terminal, pengaturan, dan token perangkat lewat sebagai byte tersegel. Ramu Link tidak melihat detail pembayaran: Paddle adalah penjualnya dan mengurusnya menurut pemberitahuan privasinya sendiri.</p>
<h2>Siapa yang memprosesnya</h2>
<p>Layanan ini berjalan di Cloudflare Workers. Masuk lewat Google atau GitHub, pembayaran lewat Paddle.</p>
<h2>Menghapusnya</h2>
<p>Hapus akun Anda di Ramu (Pengaturan → Akses jarak jauh → Ramu Link). Semua di atas ikut terhapus, dan langganan dibatalkan lebih dulu.</p>`,
    },
  },
  terms: {
    en: {
      title: 'Ramu Link terms',
      body: `<p>Ramu is free, open-source software. The app is under the MIT license, and this service under the <a href="https://github.com/akalstack/ramu/tree/main/apps/link">AGPL-3.0</a>. These terms cover only the hosted Ramu Link service.</p>
<h2>Plans</h2>
<ul>
<li><strong>Free</strong> links up to 3 computers and relays up to 60 hours a month. The count starts again on the first of each month (UTC). Direct connections never count.</li>
<li><strong>Plus</strong> links up to 20 computers with unlimited relayed hours under fair use: personal and small-team work, not reselling the relay or carrying traffic unrelated to Ramu.</li>
</ul>
<h2>Limits</h2>
<p>Reaching a limit never cuts off a connection in progress. New relayed connections are refused with a message until the month turns, a computer is unlinked or the plan changes; direct connections keep working.</p>
<h2>Payment and cancelling</h2>
<p>Paddle sells Plus as merchant of record, so its checkout terms apply to the payment. Cancel at any time; Plus continues until the end of the period paid for. If Plus ends, nothing is deleted: computers beyond the Free plan's 3 stay listed and stop taking relayed connections until you unlink some or renew.</p>
<h2>The service</h2>
<p>Ramu Link is provided as is, without warranty. It may change, and these terms with it; a change that affects a paid plan is announced before it applies. You can always run your own Ramu Link from <a href="https://github.com/akalstack/ramu/tree/main/apps/link">its source code</a>.</p>`,
    },
    id: {
      title: 'Ketentuan Ramu Link',
      body: `<p>Ramu adalah perangkat lunak gratis dan open source. Aplikasinya berlisensi MIT, dan layanan ini berlisensi <a href="https://github.com/akalstack/ramu/tree/main/apps/link">AGPL-3.0</a>. Ketentuan ini hanya untuk layanan Ramu Link yang dihosting.</p>
<h2>Paket</h2>
<ul>
<li><strong>Free</strong> menautkan hingga 3 komputer dan me-relay hingga 60 jam per bulan. Hitungan mulai lagi setiap tanggal 1 (UTC). Koneksi langsung tidak pernah dihitung.</li>
<li><strong>Plus</strong> menautkan hingga 20 komputer dengan jam relay tanpa batas dalam penggunaan wajar: pekerjaan pribadi dan tim kecil, bukan menjual ulang relay atau membawa lalu lintas yang tidak terkait Ramu.</li>
</ul>
<h2>Batas</h2>
<p>Mencapai batas tidak pernah memutus koneksi yang sedang berjalan. Koneksi relay baru ditolak dengan pesan sampai bulan berganti, satu komputer dilepas, atau paket berubah; koneksi langsung tetap berjalan.</p>
<h2>Pembayaran dan pembatalan</h2>
<p>Paddle menjual Plus sebagai merchant of record, jadi ketentuan checkout-nya berlaku untuk pembayaran. Batalkan kapan saja; Plus berlanjut sampai akhir periode yang sudah dibayar. Jika Plus berakhir, tidak ada yang dihapus: komputer di luar 3 milik paket Free tetap terdaftar dan berhenti menerima koneksi relay sampai Anda melepas beberapa atau memperpanjang.</p>
<h2>Layanan</h2>
<p>Ramu Link disediakan apa adanya, tanpa jaminan. Layanan ini bisa berubah, begitu pula ketentuannya; perubahan yang memengaruhi paket berbayar diumumkan sebelum berlaku. Anda selalu bisa menjalankan Ramu Link sendiri dari <a href="https://github.com/akalstack/ramu/tree/main/apps/link">kode sumbernya</a>.</p>`,
    },
  },
} as const

/** Fixed text: nothing from the request reaches the markup but the chosen language. */
export function legalPage(kind: keyof typeof LEGAL, lang: keyof typeof STRINGS, nonce: string): string {
  const page = LEGAL[kind][lang]
  return `${head(lang, page.title, nonce)}
<body>
<main>
<h1>${escape(page.title)}</h1>
<article>${page.body}</article>
${footer(STRINGS[lang])}
</main>
</body>
</html>`
}
