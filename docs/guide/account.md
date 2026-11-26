# Ramu account and settings backup

The Ramu account is optional and free. Everything works without it. Signing in adds settings backups that only your own devices can open, and **Your hosts**, so a phone or computer signed in to the same account connects to your hosts without a code. Akalstack runs the account at `account.akalstack.com`. It lets a device into a host only when you allowed that on the host itself, with the access you chose there.

## Signing in

**Settings → Account → Sign in** on the desktop (signed out, the page lists what the account adds) or the phone, **Sign in** beside **Ramu account** in the **Your phone** step of a new host's setup, or `ramu account login` on a host over SSH, shows a short code and opens the sign-in page in the system browser. Sign in with GitHub, Google or a passkey (add one from the page once signed in), check that the code matches the one Ramu shows, and choose **Approve**. While it waits, the desktop shows the code with **Open the sign-in page** and **Cancel**, and the page updates on its own once you approve. No password is stored, and the identity provider's access token is not kept after sign-in. Signed in during setup, the same step offers **Let my signed-in devices connect**, which lists the host with full access for your devices ([Your hosts](#your-hosts)).

Once signed in, the foot of the desktop sidebar's rail shows the account's GitHub or Google picture (or its initials) with a small gear. Clicking it opens Settings, whose top row names the account. Signed out, the same place is the Settings gear, and the top row of Settings reads **Sign in to Ramu**, opening **Settings → Account**. **Settings → Account** shows the picture, name, email and the provider the account was made with, with **Sign out**, and under it **This host on your account**: whether the host is listed and how your devices connect, with **Change in Remote access**. The host fetches the picture, so the device never loads it from GitHub or Google. **Sign out** ends this device's session. **Delete account…**, under **Advanced** at the foot of the page, removes every backup, listed host and sign-in in the account at once.

## Backing up settings

**Back up settings** in **Settings → Account** has two switches, either or both:

- **To your Ramu account:** one slot per host, its name sealed like the backup, keeping the last 30 versions of at most 256 KB each. A host uploads a few seconds after a setting changes, at most once a minute.
- **To a private gist on your GitHub:** the same sealed file in a private gist of the GitHub account this host is signed in to, with no Ramu account needed. The gist's history keeps versions.

A backup is the same portable export as **Export settings** ([Moving settings](identities.md#moving-settings)): appearance, models and abilities, agent defaults, Git and commit style, notifications, rules, identities, and plugins, skills and MCP servers as their setup. Paths, credentials, account tokens and workspace state are never included, so restoring a new machine lists its tools to review there and asks only for their keys.

The first time a destination is turned on, the host makes a random 256-bit backup key, kept in its credential store, and seals each backup with XChaCha20-Poly1305 under it before it leaves the host. It also shows a **recovery code** once, with **Copy** and **Save to a file**. Keep it in a password manager. A copy of the backup key sealed under the code is kept beside the backups, so the code alone opens them on a new machine. Without any device and without the code, the backups cannot be opened. **New recovery code**, under **Advanced**, makes another and retires the old one.

While a backup is on, a row shows when the last one ran or why it failed, with **Back up now**. **Delete backups in the account**, under **Advanced**, removes this host's slot.

## Restoring

A new host's first-run setup offers **Restore your settings?**: **From a backup** opens **Settings → Account**, and **From another host** opens **Copy settings from…** in **Settings → Account**.

**Restore…** beside **Restore settings** opens one dialog. A new host needs the backup key first, in one of two ways:

- **Approve on another device:** the new host asks, and on a host or phone that has the key, **Settings → Account** shows the request at the top of the page (on the phone, under **New devices asking for your backup key**). **Answer** shows a six-digit number on both screens. When they match, **Approve** sends the key sealed to the new device. The account only relays sealed messages it cannot open, and a request lapses after ten minutes.
- **The recovery code,** typed into **Recovery code**, for a backup in the account or on your GitHub.

Once the host has the key, the dialog lists each host's backups by name and time. Choosing one opens the same review list as **Import settings**, and nothing changes until **Restore**. Earlier versions are listed under each backup.

## On the phone

The phone signs in the same way, answers a new host's request for the key, and backs up its own preferences in its own slot (on **Back up**, then a few seconds after any of them changes, at most once a minute): appearance, text size, language, themes and layout choices. Paired hosts, device tokens and drafts are never included. **Restore your phone's settings?** on a new phone restores the newest phone backup once the phone has the key.

## Your hosts

Whether your devices may connect to a host is set on that host, with the other ways in: **Settings → Devices & access → Devices on your Ramu account**. Signed out, the row offers **Sign in…**. Signed in, it is two switches:

- **Connect devices on my Ramu account** on, **Ask me first** off: a device signed in to the same account pairs with full access and no prompt. The host says so each time, with the device's name and the account, as a notice with **Remove** (and a system notification when Ramu is not in front). **Connect them view-only** under **Advanced** pairs them view-only instead.
- **Ask me first** on: the host shows each request with the same six-digit number as the device, and you choose the access, as for a nearby request.
- **Connect devices on my Ramu account** off: the host is not listed, and your devices pair with a code like any other.

Connecting devices lists the host under **Your hosts**: the account learns its name and id, what it does when your devices ask, and when it was last seen, never its address. While listed, the host waits at the account for pairing requests, so one reaches it within a second or two.

On a phone or computer signed in to the same account, a host that lets the account in is added on its own: after you sign in, when the phone app comes to the front, and every few minutes on the desktop. On the desktop, a listed host this computer does not use yet shows under **On your Ramu account** in **Settings → Devices & access → Hosts you use**, with **Connect**, or **Add this host** for one that asks first. On the phone, **Your hosts** in **Settings → Account** lists every listed host, with **Connect** or **Pair**, and **Added** for one the phone has. Each host is added on its own only once, so a host you forget on a device stays forgotten until you add it again.

Either way it is the same exchange as a nearby request, carried by the account: the host's answer carries its addresses sealed to the device, which then connects directly and checks the host's identity on each address. A device removed in **Devices & access** (or with `ramu devices revoke`, or expired) has to be approved at the host next time, whatever the choice; the phone says so and shows the number to match. The host must be reachable by other devices (**This network** or **Anywhere** under **Reachable from**) for the account to connect them; until it is, the device is told what to turn on and nothing is paired. When a host can't be added on its own, the phone says why. A host answers only requests from devices on the account it is signed in to. At most five requests wait per host, and one device sends at most one a minute.
