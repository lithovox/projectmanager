# Deployment

Pushes to `master` build the app in GitHub Actions and upload `dist/` to the Hetzner server
(the same one as geoscanner), where Caddy serves it at `https://projectmanager.lithovox.nl`.
Pushes to other branches and pull requests only check that the app builds (`build.yml`).

```
/etc/caddy/apps/projectmanager.caddy  site block for projectmanager.lithovox.nl
/var/www/apps/projectmanager/
  releases/<timestamp>-<sha>/         last 5 builds
  current -> releases/...             what Caddy serves (switched atomically)
```

The server itself (Caddy, the `deploy` user, `/var/www/apps`) was already set up for
geoscanner; see geoscanner's `deploy/README.md` and `server-setup.sh` for that one-time setup.

## One-time setup for this app

1. **DNS:** add an A record `projectmanager.lithovox.nl` pointing to the server's IP
   (not needed if there is a wildcard record `*.lithovox.nl`).
2. **Caddy site:** copy the site block to the server and reload Caddy
   (Caddy fetches the HTTPS certificate once DNS resolves):
   ```
   scp deploy/projectmanager.caddy root@<server-ip>:/etc/caddy/apps/
   ssh root@<server-ip> systemctl reload caddy
   ```
3. **GitHub secrets:** the workflow needs `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and
   `DEPLOY_KNOWN_HOSTS` (same values as geoscanner). If they are organization secrets on
   `lithovox` that this repo can access, nothing to do; otherwise add them under
   Settings → Secrets and variables → Actions.
4. Push to `master` (or run the Deploy workflow manually from the Actions tab).

## Rollback

```
ssh deploy@<server-ip>
cd /var/www/apps/projectmanager
ls releases
ln -sfn /var/www/apps/projectmanager/releases/<older-release> current
```
