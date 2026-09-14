# Grok Remote: private desk hardening

## Product priority correction

**Zaraa iOS and its existing gateway remain the MVP target.** Selecting Grok Remote as the next standalone MVP duplicated the intended product direction; that was a prioritization mistake in this pass.

Zaraa already has a [native iOS app](/Users/zaraa/Documents/zara/packages/ios/Zaraa/Zaraa/ContentView.swift), [gateway authentication and mobile-scoped routes](/Users/zaraa/Documents/zara/packages/ios/Zaraa/Zaraa/Services/ZaraaNetworkConfig.swift), [chat and approval UI](/Users/zaraa/Documents/zara/packages/ios/Zaraa/Zaraa/Views/Tabs/ChatView.swift), and [SSE reconnect handling](/Users/zaraa/Documents/zara/packages/ios/Zaraa/Zaraa/Services/SSEClient.swift). Its [existing launch plan](/Users/zaraa/Documents/zara/docs/plans/zaraa-ship-ready-ide-mobile-launch-2026-07-18.md) specifies one Zaraa runtime with desktop and mobile clients. Grok Remote is a separate web console using Grok CLI/ACP; its implementation overlaps that remote-control use case but is not already integrated into Zaraa.

Keep this hardening patch as supporting work. Future work in this lane should verify the existing Zaraa phone-to-gateway flow: connect/authenticate, resume a conversation, stream a response, approve or deny an action, recover after backgrounding or connection loss. Transfer only fixes for demonstrated gaps; do not copy a second auth/session backend into Zaraa. This review confirms existing implementation and product intent, not a new successful iOS device run. No fixes from this patch have been ported to Zaraa yet.

## Hardening completed

The existing Grok Remote / Grok Deck now has authenticated access, explicit one-time tool approvals and tested conversation recovery. This work reuses `/Users/zaraa/Code/grok-remote`; no replacement app or duplicate clone was created.

## What is ready

- Access-key login, HttpOnly/SameSite browser sessions, lock/logout, and bearer-token access for CLI clients. Browser sessions expire after 12 hours and are invalidated by server restart. Logout closes their open event streams and sockets.
- A loopback-only server. HTTP routes, SSE streams, terminal WebSockets and voice WebSockets share authentication and Host/Origin checks. `/api/health` remains a minimal public liveness probe.
- A visible Requests queue with the agent name, tool title and full bounded input. Approve once or reject; persistent approvals are excluded. Expired, malformed, oversized, duplicate-option and disconnected requests cancel. History records requested and resolved permissions.
- Browser reconnect shows outstanding requests. Server restart restores conversation metadata/history and lets the owner reconnect to the prior ACP session. Startup does not launch starred agents automatically.
- History and SSE replay now deduplicate events, fixing duplicate assistant messages after reload.
- Frontend build, compiled server build and typecheck pass. The compiled server finds the frontend assets correctly. The existing launcher import fix is preserved, and installer builds the server too.

This is a single-owner console with host-level capabilities, including a shell. The key grants that owner's authority. It is not a multi-user service or an agent sandbox. Approval UI handles ACP permission requests; CLI allow rules and explicit shell commands retain their own semantics.

## Try the isolated demo

The running local demo is [http://127.0.0.1:8777/](http://127.0.0.1:8777/). Its state lives under `.mvp/demo-home`, separate from real Grok Remote sessions. The status label says **fixture demo**. Replies come from a deterministic ACP fixture; no model or provider calls are made by this demo's conversation path.

Read its key locally:

```sh
cat .mvp/demo-home/.grok-remote/access-key
```

Sign in, click **+ new**, type `permission please`, then reject or approve the request. Approval writes `proof.txt` in that fixture conversation's isolated working directory. Reload to check history and use **Lock desk** to end browser access. Native launch, terminal and voice surfaces are inherited functionality; they are outside this fixture walkthrough.

To start the demo again from this repository:

```sh
npm ci
npm run build
npm run build:server
npm run demo:mvp
```

## Run your own desk

Use Node 22 and the existing Grok CLI installation/authentication. Node 22 was checked on Linux; the Mac checks also use the installed Node runtime. No new runtime dependency was added.

```sh
npm ci
npm run typecheck
npm run build
npm run build:server
node build/server.js
```

Open `http://127.0.0.1:7910/`. The first startup creates a random 256-bit key at `~/.grok-remote/access-key`, mode `0600`; the key is not logged. Read it on the server and enter it in the login form. Existing conversations remain under `~/.grok-remote`. Keep that directory private and backed up with the server stopped. A restart invalidates browser sessions while preserving the access key and conversation records.

For private remote access, put HTTPS in front of the loopback listener. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) can proxy a local service within a tailnet:

```sh
GROK_REMOTE_ORIGIN=https://your-device.your-tailnet.ts.net node build/server.js
# In another terminal, after reviewing your existing Serve configuration:
tailscale serve --bg http://127.0.0.1:7910
```

Use the actual HTTPS origin, exactly, without a trailing slash. The proxy must preserve that Host header. Secure cookies are used on this configured origin; forwarding arbitrary Origin/Host headers does not bypass authentication. Tailnet ACLs should limit access to the intended owner. These commands are setup instructions, not a claim that this machine's Tailscale configuration was changed or tested. Public internet exposure is outside this MVP.

Legacy `HOST=0.0.0.0` configuration now fails with an explicit error. PM2 defaults and local/tailnet launch modes use loopback. Follow this guide when migrating old installer instructions. Existing live-host craft scripts assume unauthenticated endpoints; use the isolated acceptance checks below for this release.

## Verification

```sh
npm test
npm run typecheck
npm run build:server
npm run build
npm run test:mvp
npm run test:integration
```

The unit suite contains 386 passing checks, including the added expiry and replay regressions. All 9 existing integration checks also pass with an isolated home and authenticated requests. The compiled-server acceptance check exercises rejected HTTP/WS access, forged Host/Origin, protected API routes, secure-cookie configuration, wrong-key login, one-time approval, explicit denial, replay refusal, pending-request reconnect, disconnect cancellation, logout stream closure, restart authentication and durable session/history recovery. It uses a temporary home and a deterministic ACP fixture, never the operator's real session data.

Recorded checks: [macOS results](.mvp/mac-verification.json) and [Linux runtime results](.mvp/linux-verification.json). Both report success and identify their log hashes; Linux also records the exact locally built image. These are local test observations, not signed attestations or remote CI results.

Browser verification covered login, creating a fixture conversation, reject/approve once, reload without duplicate replies, lock/re-login and the request panel at 390 × 844. The existing large frontend bundle still produces Vite's chunk-size warning.

Linux acceptance can be reproduced in a non-root container with networking disabled during the runtime test:

```sh
docker build -f test/verification.Dockerfile -t grok-private-desk-check:local .
docker run --rm --network none --read-only --user node \
  --tmpfs /tmp:rw,exec,nosuid,mode=1777,size=256m --memory=1g --cpus=1 \
  -e npm_config_cache=/tmp/npm-cache grok-private-desk-check:local
```

The image build installs locked dependencies and runs typecheck, both builds and unit tests. Image building needs network access; runtime acceptance does not. The Docker context excludes local keys, session data, environment files, Git data and host dependencies. This image is a verification environment, not a production hosting recommendation.

## Provenance and remaining pilot gates

Work branch: `codex/grok-remote-mvp-20260913`, based on `Skyscrapersax/grok-remote` commit `85ed9f167615f38ab484a2ee6c81802dcca42bc3`. Existing local `main` remains at `4a0134bf869d7f4bcd2e01dc6537c5efb2db65e4`; its `bin/gr` import fix was carried forward. `origin` still points to Daniel Farina's upstream repository. The upstream MIT license, author attribution, Desk UI and sibling satellite projects are preserved. Nothing was pushed or published.

The full flow is proven against a deterministic ACP fixture on macOS and Linux. Actual Grok model execution, a physical phone over Tailscale, voice-provider behavior and independent-user adoption remain pilot checks. No real Grok/Quick Chat child was submitted, no metered model call was used, and no live service was restarted. The original audit score is historical; no new numerical score is inferred from fixture tests alone.
