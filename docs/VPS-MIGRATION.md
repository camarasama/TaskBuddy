# VPS Migration Runbook

Moving every site and service off the current OVH VPS (`54.37.18.27`) onto a new server at a
different provider. Written 2026-09-10 from live recon of the running box, ahead of a renewal
problem with the OVH contract.

This is credential-free by design. Secrets live in `/opt/taskbuddy/backup.env`,
`/opt/taskbuddy/app/backend/.env`, `/etc/evolutionprimeit/contact.env` and `/etc/cron.d/`, and are
carried by the backup bundle, never by this file.

Companion documents:

- `docs/DEPLOYMENT.md` is the normal day-to-day TaskBuddy deploy runbook and stays authoritative
  for ordinary releases. This file replaces none of it.
- `scripts/vps-full-backup.sh` is the whole-server backup this plan depends on.
- The Evolution Prime IT website has its own handoff file in its own repo. Its deploy method is
  rsync, not git, and it is not covered in detail here.

---

## 0. The box is not a single application

The server hosts **three separate products** across **six hostnames**. A migration that only thinks
about TaskBuddy will silently take the other two down.

| Hostname | Serves | Backed by |
|---|---|---|
| `api.gettaskbuddy.com` | TaskBuddy API + Socket.io | systemd `taskbuddy-backend`, `127.0.0.1:3100` |
| `app.gettaskbuddy.com` | TaskBuddy web app (Next.js) | systemd `taskbuddy-frontend`, `127.0.0.1:3200` |
| `gettaskbuddy.com`, `www.` | Static marketing site only | `/var/www/taskbuddy-marketing`, no proxy |
| `evolutionprimeit.com`, `www.` | Company site, plus `/api/` contact form | `/var/www/evolutionprimeit` + systemd `ep-contact` on `127.0.0.1:3001` |
| `gnfs.evolutionprimeit.com` | GNFS app | pm2 (`pm2-gnfs`), vhost proxies `127.0.0.1:3000` |

Shared services underneath: nginx, Postgres 18.6 (databases `taskbuddy` and `gnfs`), certbot
(timer-renewed), fail2ban, ufw, and two backup jobs (`taskbuddy-backup.timer` to Cloudflare R2,
`/etc/cron.d/gnfs-backup` to local disk).

Box as measured: Ubuntu 26.04 LTS, kernel 7.0, 2 vCPU, 3.7 GB RAM, 38 GB disk with 15 GB used.

### Known problems to resolve, not replicate

Fix these on the new box rather than faithfully copying them across.

1. **GNFS is down as of 2026-09-10.** `gnfs.evolutionprimeit.com` returns 502. Both pm2 processes
   (`gnfs`, `gnfs-cron`) sit in `stopped` after 11 and 10 restarts respectively, and the vhost
   proxies to port 3000 where nothing is listening. Diagnose before migrating, otherwise you will
   not be able to tell a migration failure from the pre-existing one.
2. **A database password is stored in the clear** in `/etc/cron.d/gnfs-backup`, visible to any
   process that can read the file. Rotate that password during the cutover and move it into a
   root-owned env file loaded with `EnvironmentFile=`, the way `taskbuddy-backup` already does.
3. **The TaskBuddy backend runs on the wrong Node.** `taskbuddy-backend.service` has
   `ExecStart=/usr/bin/node`, which is v20.20.2, while the repo targets and the backup scripts use
   the side-by-side v22.23.1 in `/opt/nodejs/22/bin`. Replicate as-is for the cutover, then move
   the unit to Node 22 as a separate, revertible change once the new box is stable. Do not combine
   the two.
4. **The `app.` and `api.` nginx vhosts exist only on the server.** Only the marketing vhost is in
   the repo, at `deploy/nginx/gettaskbuddy.com.conf`. The backup bundle's `nginx -T` output is the
   only complete record. Commit the recovered vhosts to the repo after the move.

---

## 1. Timeline and the one hard constraint

The safe cutover needs the **old box alive while the new one is being verified**. Everything below
assumes an overlap window. If the OVH contract lapses first, the box is suspended and then its disk
is deleted, and there is no recovery path from that.

So, in strict priority order:

1. **Take the backup today** (Phase 2). This is the only irreversible risk in the whole exercise.
2. Get the backup verified off-box and confirm you can read it.
3. Only then decide on a provider and start the rebuild.

If OVH can be renewed at all, even for one extra month, do that first. A paid month of overlap is
far cheaper than a rushed cutover, and it converts a deadline into a schedule.

---

## 2. Phase 1: back up everything, today

Run on the VPS, as root. The passphrase protects TLS private keys and every application secret, so
store it somewhere that is not the laptop holding the bundle.

```bash
sudo ENCRYPT_PASSPHRASE='<long passphrase, stored in your password manager>' \
  bash /opt/taskbuddy/app/scripts/vps-full-backup.sh
```

It writes `/var/tmp/vps-migration-<stamp>.tar.gpg` containing:

- `00-globals.sql`, the Postgres roles including their password hashes, so existing
  `DATABASE_URL`s keep working unchanged on the new box
- `10-db-<name>.dump`, one custom-format dump per database
- `20-*`, the system inventory: installed packages, enabled units, timers, ufw rules, listening
  ports, every user's crontab, the pm2 process dump, and `nginx -T` fully resolved
- `30-files.tar.gz`, covering `/etc/nginx`, `/etc/letsencrypt`, `/etc/postgresql`, `/etc/fail2ban`,
  `/etc/cron.d`, `/etc/gai.conf`, `/etc/systemd/system`, `/etc/evolutionprimeit`, `/var/www`,
  `/opt/ep-contact`, `/opt/taskbuddy/uploads`, `/opt/taskbuddy/backup.env`, `/home/gnfs`, and the
  app `.env` files

The TaskBuddy app tree itself is deliberately excluded: it is a git clone and gets rebuilt from
GitHub on the new box. Its untracked `.env` files are included, because those are the part GitHub
does not have.

Then, from your laptop:

```bash
mkdir -p ~/vps-migration
scp gnfs-vps:/var/tmp/vps-migration-*.tar.gpg ~/vps-migration/
sha256sum ~/vps-migration/vps-migration-*.tar.gpg   # compare with the .sha256 on the VPS
gpg -d ~/vps-migration/vps-migration-<stamp>.tar.gpg | tar -tf - | head -40
```

**A bundle you have not decrypted and listed is not a backup.** Do that last step now, not on
cutover night.

Keep a second copy somewhere off the laptop: the R2 backups bucket already exists and already holds
TaskBuddy dumps, so it is the obvious home for this one too.

---

## 3. Phase 2: pick and provision the new server

Match or exceed the current box: **2 vCPU, 4 GB RAM, 40 GB SSD minimum**. Current usage is 15 GB
and roughly 900 MB of RAM at rest, so 4 GB is genuinely adequate, but 8 GB removes the swap
pressure that a Next.js build on 2 vCPU can create.

Choose **Ubuntu 26.04 LTS** to match, so that the apt package set, the Postgres 18 packaging and the
systemd unit syntax all line up with what the bundle contains. A different distribution turns a
restore into a port.

Provider notes: Hetzner is the usual cost win at these specs, Scaleway and DigitalOcean are the
obvious alternatives, and a fresh OVH instance is perfectly fine if the renewal problem is purely
billing on the existing contract. The runbook does not depend on the choice.

At provisioning time:

- Create the same non-root admin user (`gnfs`) and install the same SSH public keys, so the
  `gnfs-vps` alias in `~/.ssh/config` keeps working with only the `HostName` changed.
- Disable password SSH authentication.
- Note the new IPv4 address. **Check whether IPv6 has a working default route**: the OVH box has
  IPv6 addresses but no route, which broke certbot until `/etc/gai.conf` was given
  `precedence ::ffff:0:0/96 100` to prefer IPv4. Only apply that workaround if the new box has the
  same defect. Applying it blindly on a healthy IPv6 host is a silent downgrade.

---

## 4. Phase 3: base install

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y nginx postgresql-18 certbot python3-certbot-nginx \
                        fail2ban ufw gnupg git build-essential
```

**Postgres must be major version 18.** A dump taken from 18.6 will not restore into 17. The bundle
records the exact source version in `10-db-server-version.txt`; check it before installing.

Node, both versions, matching the current layout:

```bash
# system Node 20, which taskbuddy-backend and the GNFS app currently run on
# (install via your preferred method; the source box has v20.20.2 at /usr/bin/node)

# side-by-side Node 22 for builds and the backup scripts
sudo mkdir -p /opt/nodejs
# unpack node-v22.23.1-linux-x64 to /opt/nodejs/22 exactly as on the source box
/opt/nodejs/22/bin/node -v   # expect v22.23.1
```

Create the service accounts before restoring anything that they own:

```bash
sudo useradd -r -m -d /opt/taskbuddy -s /usr/sbin/nologin taskbuddy
# gnfs already exists from provisioning; www-data comes with nginx
```

Firewall, matching the current posture:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Do **not** add a blanket source restriction. Three products share this box, and a rule aimed at one
of them takes the other two offline.

---

## 5. Phase 4: restore data

Unpack the bundle into a staging directory, never straight onto `/`:

```bash
mkdir -p ~/restore && cd ~/restore
gpg -d ~/vps-migration-<stamp>.tar.gpg | tar -xf -
cd vps-migration-<stamp>
sha256sum -c SHA256SUMS
```

Databases, globals first:

```bash
sudo -u postgres psql -f 00-globals.sql            # roles and their password hashes
sudo -u postgres createdb taskbuddy
sudo -u postgres createdb gnfs
sudo -u postgres pg_restore -d taskbuddy -j2 10-db-taskbuddy.dump
sudo -u postgres pg_restore -d gnfs      -j2 10-db-gnfs.dump
```

`pg_restore` will print errors about roles or extensions that already exist. Those are expected and
harmless. Errors about **missing** roles are not, and mean `00-globals.sql` did not run first.

Verify before moving on. Row counts, not a successful exit code:

```bash
sudo -u postgres psql taskbuddy -c \
  "SELECT 'users' t, count(*) FROM users UNION ALL SELECT 'tasks', count(*) FROM tasks"
```

Compare against the same query on the old box. Then confirm the schema is at the expected
migration, from the app directory once it is in place:

```bash
cd /opt/taskbuddy/app/backend && \
  sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npx prisma migrate status
```

Files:

```bash
sudo tar -xzf 30-files.tar.gz -C /   # absolute paths were stripped at archive time
sudo chown -R taskbuddy:taskbuddy /opt/taskbuddy/uploads
sudo chown -R www-data:www-data /var/www
```

`/opt/taskbuddy/uploads` holds child evidence photos. Getting its ownership wrong means uploads
appear to work and then 403 on read, which looks like an application bug.

---

## 6. Phase 5: restore services

The TaskBuddy app tree is rebuilt, not copied:

```bash
sudo -u taskbuddy git clone <repo> /opt/taskbuddy/app
cd /opt/taskbuddy/app
# the restored backend/.env is already in place from the tarball
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm ci
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm run db:generate
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm run build
```

Check out the **exact commit the old box was serving** rather than `main`, so that the migration
changes one variable at a time. Get it from the old box with
`git -C /opt/taskbuddy/app -c safe.directory=/opt/taskbuddy/app log -1`. Deploying pending work and
changing servers in the same step makes any failure impossible to attribute.

Then enable the services, all of which came across in the tarball under `/etc/systemd/system`:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taskbuddy-backend taskbuddy-frontend ep-contact
sudo systemctl enable --now taskbuddy-backup.timer
```

GNFS runs under pm2, restored from `20-pm2-dump.json`:

```bash
sudo npm i -g pm2
sudo -u gnfs cp 20-pm2-dump.json /home/gnfs/.pm2/dump.pm2
sudo -u gnfs pm2 resurrect
sudo systemctl enable pm2-gnfs
```

Resolve issue 1 from section 0 here: the vhost expects port 3000, so confirm the resurrected GNFS
process actually listens there with `ss -ltnp | grep 3000`.

TLS comes across with `/etc/letsencrypt`, which means **nginx serves valid certificates before DNS
has moved**. That is the whole trick that makes the cutover verifiable in advance. Certbot renewal
is the one thing that cannot work until DNS points here, since the HTTP-01 challenge is answered at
whatever address the record resolves to.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Phase 6: verify before touching DNS

Point your own laptop at the new box by hostname, without changing anything for anyone else. Add to
`/etc/hosts` locally:

```
<new-ip>  gettaskbuddy.com www.gettaskbuddy.com app.gettaskbuddy.com api.gettaskbuddy.com
<new-ip>  evolutionprimeit.com www.evolutionprimeit.com gnfs.evolutionprimeit.com
```

Then work through the full list. Every line must pass before DNS moves:

```bash
curl -s https://api.gettaskbuddy.com/health                                  # {"status":"ok","db":"up"}
curl -o /dev/null -w '%{http_code}\n' https://app.gettaskbuddy.com/parent/dashboard   # 200, not 404
curl -o /dev/null -w '%{http_code}\n' https://gettaskbuddy.com/                       # 200
curl -o /dev/null -w '%{http_code}\n' https://gettaskbuddy.com/.well-known/assetlinks.json  # 200
curl -o /dev/null -w '%{http_code}\n' https://evolutionprimeit.com/                   # 200
curl -o /dev/null -w '%{http_code}\n' https://gnfs.evolutionprimeit.com/              # 200, see issue 1
```

The dashboard check is the canary for the Next.js build/runtime version split: a mismatched `next`
between build and runtime 500s every dynamic route while the static marketing site looks perfect.
Check `app.`, never the apex, because the apex has no such page and 404s by design.

Also confirm, by hand:

- Log in as a parent, open a task detail page, approve something. That exercises Prisma, the
  session cookie and the uploads path in one pass.
- Watch the browser network tab for the socket.io connection **upgrading to a WebSocket** rather
  than falling back to long polling. The `Upgrade`/`Connection` proxy headers and the
  `websocket_upgrade` map in `/etc/nginx/conf.d/` must both have survived the restore.
- Submit the Evolution Prime IT contact form, which proves `ep-contact` and its
  `/etc/evolutionprimeit/contact.env` came across.

---

## 8. Phase 7: DNS cutover

`gettaskbuddy.com` is on Cloudflare and is **DNS-only** (grey cloud) on every record, so these are
plain A-record edits with no proxy in the path and no cached edge state to flush.

**A day ahead:** drop the TTL on all six records to 60 seconds. Cloudflare's "Auto" is 300s, which
turns a rollback into a five minute outage instead of a one minute one.

**On the night:**

1. Stop writes on the old box so the two servers cannot diverge:
   `sudo systemctl stop taskbuddy-backend taskbuddy-frontend`
2. Take a final differential dump of `taskbuddy` and `gnfs` from the old box and restore it over
   the new one. Between the Phase 3 restore and now, real users will have created real rows.
3. Update the A records to the new IP: `gettaskbuddy.com`, `www`, `app`, `api`, plus
   `evolutionprimeit.com`, `www`, `gnfs`. **The Evolution Prime IT zone may be at a different
   registrar**, so confirm where it is hosted before cutover night rather than during it.
4. Watch propagation: `dig +short app.gettaskbuddy.com @1.1.1.1`
5. Re-run the entire Phase 6 checklist, this time with the `/etc/hosts` entries removed.
6. Issue fresh certificates now that HTTP-01 can reach the new box:
   `sudo certbot renew --nginx --force-renewal` and confirm `certbot.timer` is enabled.

The Android app needs no rebuild: it resolves `api.gettaskbuddy.com` like any other client. But
`assetlinks.json` must be served correctly from the apex on day one or Android App Links stop
verifying, so keep it in the checklist above.

---

## 9. Phase 8: after the move

- Leave the old box running, with its app services stopped, for **at least a week**. It is the
  rollback.
- Confirm the R2 backup timer fires successfully on the new box before that week is out:
  `systemctl list-timers taskbuddy-backup.timer`, then check the bucket for a fresh object.
- Run `scripts/backup-restore-test.sh` on the new box. An untested backup is not a backup, and this
  is the moment the whole exercise proves that point.
- Rotate the GNFS database password out of `/etc/cron.d/gnfs-backup` (issue 2).
- Commit the recovered `app.` and `api.` nginx vhosts into `deploy/nginx/` (issue 4), so the next
  migration does not depend on a bundle.
- Move `taskbuddy-backend.service` to Node 22 as its own change (issue 3).
- Update the SSH `HostName` for the `gnfs-vps` alias, and update any monitoring that pins the old
  IP.
- Only then cancel OVH, and only after confirming the bundle is still readable.

## 10. Rollback

Until the old box is cancelled, rollback is a DNS edit back to `54.37.18.27` plus
`sudo systemctl start taskbuddy-backend taskbuddy-frontend` there. At a 60 second TTL that is a
one minute outage.

The window where rollback gets expensive is after users have written data to the new box: at that
point rolling back loses those writes. So the decision point is the Phase 6 checklist on real DNS,
and it should be made within minutes of the cutover, not the next morning.
