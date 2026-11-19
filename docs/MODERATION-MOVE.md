# Moving moderation onto bluesky-mod

The moderation bot used to be this site's own code: Vercel functions, the `mod` schema in Supabase, and the `mod-consumer` service on the droplet. It is now [bluesky-mod](https://github.com/dame-is/bluesky-mod), run on the droplet in Docker, keeping its data in the same Supabase database under its own schema, `bluesky_mod`. The admin's moderation pages and the graph lists call its API.

This page is the move, in the order to do it. It takes about an hour, most of it the rehearsal. The old bot keeps running until the cutover, and can be started again after it.

## What you need

- SSH to the droplet, and its public IP.
- The DNS for dame.is (Namecheap).
- The Supabase database password, and the **Session pooler** connection string from Supabase > Connect. The service role key the site uses is a different thing and is not needed.
- Supabase's CA certificate: Supabase > Database Settings > SSL Configuration > Download certificate (`prod-ca-2021.crt`).
- The values in the droplet's `/root/dame.is/services/mod-consumer/.env`.

Secrets go in `.env` files on the droplet and in Vercel's environment, never in this repo.

## 1. A name for the bot's panel

At Namecheap, add an A record for `mod` (so `mod.dame.is`) pointing at the droplet's IP. The admin calls the bot there.

## 2. bluesky-mod on the droplet

```bash
ssh root@<droplet-ip>
docker --version || curl -fsSL https://get.docker.com | sh
ss -ltnp | grep -E ':(80|443)\b'      # anything already on the web ports?
git clone https://github.com/dame-is/bluesky-mod.git /root/bluesky-mod
cd /root/bluesky-mod
```

Put the CA certificate in `config/` (mounted read-only into the container at `/app/config`), and publish the panel's port to this machine only:

```bash
scp prod-ca-2021.crt root@<droplet-ip>:/root/bluesky-mod/config/
cat > compose.override.yaml <<'EOF'
services:
  bot:
    ports: ["127.0.0.1:8787:8787"]
EOF
```

Then `.env`, from `.env.example`, with these filled in (`chmod 600 .env`):

| Setting | Value |
| --- | --- |
| `MOD_OWNER_DID` | your DID, as in the consumer's `.env` |
| `MOD_IDENTIFIER`, `MOD_APP_PASSWORD` | the bot account's, as in the consumer's `.env` |
| `MOD_LIST_URI` | the bot's list, as in the consumer's `.env` |
| `MOD_ALLOWED_DIDS`, `MOD_WRITER_DIDS`, `MOD_DM_MODE` | as in the consumer's `.env`, if set |
| `AI_GATEWAY_API_KEY` | as in the consumer's `.env` |
| `MOD_AGENT_MODEL` | `deepseek/deepseek-v4.1-flash` |
| `MOD_ESCALATION_MODEL` | `zai/glm-5.3-flash`, the second reader for hostile labels you measured on 2026-10-01 |
| `MOD_UNPROTECTED_LISTS` | the Bluesky list URIs of both managed graph lists (see below) |
| `DATABASE_URL` | the Session pooler string, ending `?sslmode=verify-full&sslrootcert=/app/config/prod-ca-2021.crt` |
| `DATABASE_SCHEMA` | `bluesky_mod` |
| `PANEL_PORT`, `PANEL_HOST` | `8787`, `0.0.0.0` |
| `PANEL_URL` | `https://mod.dame.is` |
| `PANEL_CORS_ORIGINS` | `https://dame.is` |
| `MOD_KEEP_UNAPPROVED_DAYS` | `0`, so the daily cleanup keeps every old scan |

**`MOD_UNPROTECTED_LISTS` matters.** The bot protects everyone on a curation list you made, and the managed graph lists are curation lists. "Who engages with me" fills with whoever replied most, pile-ons included, so without this setting the people piling on would become impossible to block. Neither managed list has `protects: true` (checked 2026-11-19). Their list URIs are in their `is.dame.graph.list` records:

```bash
curl -s 'https://pds.atpota.to/xrpc/com.atproto.repo.listRecords?repo=<your-did>&collection=is.dame.graph.list' \
  | grep -o '"listUri":"[^"]*"'
```

Settings from the old consumer that bluesky-mod does not read, and can be left behind: `MOD_JUDGE_MODEL`, `MOD_CHECK_MODEL` (see step 4), `MOD_INTENT_*`, `MOD_ESCALATION_FALLBACK`, `MOD_OPERATOR_MODEL`, `PUBLIC_REPLIES`. The old voice settings record (`is.dame.mod.config/self`) does not exist on your PDS (checked 2026-11-19), so there is no `config/bot.json` to write.

Build it, but do not start it yet:

```bash
docker compose build
```

## 3. HTTPS

With nothing else on ports 80 and 443, Caddy gets and renews the certificate by itself:

```bash
apt-get install -y caddy    # on Ubuntu older than 24.04, see caddyserver.com/docs/install
cat > /etc/caddy/Caddyfile <<'EOF'
mod.dame.is {
  reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy
```

If something already serves those ports, add the same `reverse_proxy` to it instead.

## 4. Rehearse, with the old bot still running

Import into a throwaway schema and look at the result. Nothing here touches the old bot or the list.

```bash
cd /root/bluesky-mod
mkdir -p /root/migrate
# from the pull request's branch until it is merged, then from main
curl -fsSL -o /root/migrate/migrate.sql \
  https://raw.githubusercontent.com/dame-is/dame.is/claude/vigilant-knuth-8irchk/scripts/migrate-mod-to-bluesky-mod.sql

# bluesky-mod makes its own tables in the rehearsal schema
docker compose run --rm -e DATABASE_SCHEMA=bluesky_mod_rehearsal bot \
  node --input-type=module -e "const d = await import('./src/bot/db.js'); await d.openDb(); await d.closeDb(); console.log('tables made')"

# the import, reading the password without putting it in your shell history
read -rs PGPASSWORD && export PGPASSWORD
docker run --rm -e PGPASSWORD -v /root/migrate:/s:ro -v /root/bluesky-mod/config:/c:ro postgres:16 \
  psql "postgresql://<user>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=/c/prod-ca-2021.crt" \
  -v ON_ERROR_STOP=1 -v target=bluesky_mod_rehearsal -v list_uri='<MOD_LIST_URI>' -f /s/migrate.sql
```

The import ends by printing what it copied beside what was there. Every pair should match, and "carried over" should be about 8,543 (the accounts moved from your old personal list in September). Then let the bot read it, in a dry run that reads no DMs and writes nothing:

```bash
docker compose run --rm -e DATABASE_SCHEMA=bluesky_mod_rehearsal -e DRY_RUN=true bot
```

Watch for `Snapshot finalised` and no errors, then Ctrl-C. A dry run keeps the panel off, so the admin is checked at the cutover.

While you are here, measure the write check on the cheap model before trusting agent mode with it. It costs a few cents:

```bash
docker compose run --rm bot npm run eval:intent
docker compose run --rm -e MOD_CHECK_MODEL=openai/gpt-6-luna bot npm run eval:intent
```

If DeepSeek Flash refuses fewer overreaches than GPT-6 Luna, set `MOD_CHECK_MODEL=openai/gpt-6-luna` in `.env`. (Both were on the gateway on 2026-11-19.)

Then drop the rehearsal: in the Supabase SQL editor, `drop schema bluesky_mod_rehearsal cascade;`.

## 5. Cut over

About fifteen minutes. DMs sent meanwhile are answered once the new bot starts.

1. In Vercel, set `VITE_MOD_API_URL=https://mod.dame.is` and `VITE_MOD_BOT_DID=<the bot's DID>` for Production. They are read at build time.
2. Stop the old bot for good:

   ```bash
   systemctl disable --now mod-consumer
   ```

3. Make the real tables and import into them, as in step 4 with the default schema:

   ```bash
   cd /root/bluesky-mod
   docker compose run --rm bot node --input-type=module -e "const d = await import('./src/bot/db.js'); await d.openDb(); await d.closeDb(); console.log('tables made')"
   docker run --rm -e PGPASSWORD -v /root/migrate:/s:ro -v /root/bluesky-mod/config:/c:ro postgres:16 \
     psql "postgresql://<user>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=/c/prod-ca-2021.crt" \
     -v ON_ERROR_STOP=1 -v target=bluesky_mod -v list_uri='<MOD_LIST_URI>' -f /s/migrate.sql
   ```

4. Start the new one, and watch it:

   ```bash
   docker compose up -d && docker compose logs -f
   ```

   Look for `Chat access confirmed`, `The panel is listening`, then the snapshot steps. It answers DMs while the snapshot builds.

5. Merge the dame.is pull request that moves the admin and the graph lists, so the site deploys with them.

## 6. Check it

- DM the bot `help`, then `history @<someone you blocked recently>`: the history should go back past today.
- Open `/admin?view=moderation`: the queue, the list, an account, activity, a scan and its radar, the shield, settings.
- Block a test account from the admin and undo it.
- In the Analytics Graph tab, run a sync. A proximity list says why if it could not read the snapshot.
- After a day, `docker compose logs --since 24h | grep -i error` should be quiet.

## If it goes wrong

Stop the new bot and start the old one. The `mod` schema is untouched until step 7, so the old bot carries on where it stopped; anything the new bot added in the meantime is on the list but not in the old log.

```bash
cd /root/bluesky-mod && docker compose down
systemctl enable --now mod-consumer
```

Then revert the site's pull request, so the admin and the graph lists read the old backend again.

## 7. A week later

Once it has run cleanly for a week:

1. Keep a copy of the old schema somewhere outside any repo:

   ```bash
   docker run --rm -e PGPASSWORD -v /root/migrate:/out -v /root/bluesky-mod/config:/c:ro postgres:16 \
     pg_dump "postgresql://<user>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=/c/prod-ca-2021.crt" \
     --schema=mod -Fc -f /out/mod-schema.dump
   ```

2. Remove the old code from this repo: `api/mod-*.js`, the moderation modules in `api/_lib/`, `src/lib/moderation/`, `services/mod-consumer/`, and the `SUPABASE_*` and `MOD_*` variables in Vercel that nothing reads any more.
3. Drop the old schema in Supabase, which cannot be undone: `drop schema mod cascade;`. It frees about 220 MB.
4. On the droplet, `rm /etc/systemd/system/mod-consumer.service && systemctl daemon-reload`.
