# Ramu account and settings backup

The Ramu account is optional and free. Everything works without it. Signing in adds settings backups that only your own devices can open, and **Your hosts**, so a phone or computer signed in to the same account connects to your hosts without a code. Akalstack runs the account at `account.akalstack.com`. It lets a device into a host only when you allowed that on the host itself, with the access you chose there.

## Signing in

**Settings → Account → Sign in** on the desktop or the phone, **Sign in** beside **Ramu account** in the **Other devices** step of a new host's setup, or `ramu account login` on a host over SSH, shows a short code and opens the sign-in page in the system browser. Sign in with GitHub, Google or a passkey (add one from the page once signed in), check that the code matches the one Ramu shows, and choose **Approve**. No password is stored, and the identity provider's access token is not kept after sign-in. Signed in during setup, the same step offers **Let my signed-in devices connect**, which lists the host with full access for your devices ([Your hosts](#your-hosts)).

Once signed in, the foot of the desktop sidebar's rail shows the account's GitHub or Google picture (or its initials) with a small gear. Clicking it opens Settings, whose top row names the account. Signed out, the same place is the Settings gear, and the top row of Settings reads **Sign in to Ramu**, opening **Settings → Account**. **Settings → Account** shows the picture, name, email and the provider the account was made with. The host fetches the picture, so the device never loads it from GitHub or Google. **Sign out** ends this device's session. **Delete account** removes every backup, listed host and sign-in in the account at once.

## Backing up settings

**Back up settings** in **Settings → Account** has two destinations, either or both:

- **To my Ramu account:** one slot per host, its name sealed like the backup, keeping the last 30 versions of at most 256 KB each. A host uploads a few seconds after a setting changes, at most once a minute.
- **To a private gist on my GitHub:** the same sealed file in a private gist of the GitHub account this host is signed in to, with no Ramu account needed. The gist's history keeps versions.

A backup is the same portable export as **Export settings** ([Moving settings](identities.md#moving-settings)): appearance, models and abilities, agent defaults, Git and commit style, notifications, rules, identities, and plugins, skills and MCP servers as their setup. Paths, credentials, account tokens and workspace state are never included, so restoring a new machine lists its tools to review there and asks only for their keys.

The first time a destination is turned on, the host makes a random 256-bit backup key, kept in its credential store, and seals each backup with XChaCha20-Poly1305 under it before it leaves the host. It also shows a **recovery code** once, with **Copy** and **Save to a file**. Keep it in a password manager. A copy of the backup key sealed under the code is kept beside the backups, so the code alone opens them on a new machine. Without any device and without the code, the backups cannot be opened. **New recovery code** makes another and retires the old one.

**Back up now** backs up straight away. The page shows when the last backup ran or why it failed. **Delete backups in the account** removes this host's slot.

## Restoring

A new host's first-run setup offers **Restore your settings?**: **From a backup** opens **Settings → Account**, and **From another host** opens **Copy settings from…** in **Settings → Account**.

A new host needs the backup key first, in one of two ways:

- **Approve on another device:** the new host asks, and on a host or phone that has the key, **Settings → Account** lists the request under **New devices asking for your backup key**. **Answer** shows a six-digit number on both screens. When they match, **Approve** sends the key sealed to the new device. The account only relays sealed messages it cannot open, and a request lapses after ten minutes.
- **The recovery code,** typed into **Recovery code**, for a backup in the account or on your GitHub.

Then **Find backups** lists each host's backups by name and time. Choosing one opens the same review list as **Import settings**, and nothing changes until **Restore**. Earlier versions are listed under each backup.

## On the phone

The phone signs in the same way, answers a new host's request for the key, and backs up its own preferences in its own slot (on **Back up**, then a few seconds after any of them changes, at most once a minute): appearance, text size, language, themes and layout choices. Paired hosts, device tokens and drafts are never included. **Restore your phone's settings?** on a new phone restores the newest phone backup once the phone has the key.

## Your hosts

**List this host in my account** puts the host under **Your hosts**: the account learns its name and id, what it does when your devices ask, and when it was last seen, never its address. While listed, the host waits at the account for pairing requests, so one reaches it within a second or two.

**When a device signed in to ‹your email› asks** is chosen on the host only:

- **Connect it with full access** (the default once listed) or **Connect it with view-only access:** a device signed in to the same account pairs with no prompt. The host says so each time, with the device's name and the account, as a notice with **Remove** (and a system notification when Ramu is not in front).
- **Ask me here first:** the host shows each request with the same six-digit number as the device, and you choose the access, as for a nearby request.

On a phone or computer signed in to the same account, a host that lets the account in is added on its own: after you sign in, when the phone app comes to the front, and every few minutes on the desktop. **Your hosts** in **Settings → Account** also lists every listed host, with **Connect** for those, and **Add this host** (desktop) or **Pair** (phone) for one that asks first. Each host is added on its own only once, so a host you forget on a device stays forgotten until you add it again.

Either way it is the same exchange as a nearby request, carried by the account: the host's answer carries its addresses sealed to the device, which then connects directly and checks the host's identity on each address. A device removed in **Remote access** (or with `ramu devices revoke`, or expired) has to be approved at the host next time, whatever the choice. A host answers only requests from devices on the account it is signed in to. At most five requests wait per host, and one device sends at most one a minute.
