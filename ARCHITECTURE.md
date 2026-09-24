# Thunder Native Download Architecture

## Process topology

```text
Browser / CLI / desktop integration / remote node
                         |
                         | HTTP JSON-RPC, binary routes, static WebUI, mTLS
                         v
                 apps/web-api/src/main.js
                         |
                         | @tlei/daemon-client
                         | JSON-RPC 2.0 + Content-Length framing
                         | Unix domain socket, mode 0600
                         v
              apps/daemon/host/src/main.js
                         |
                         | engine-client JSON lines, private implementation protocol
                         v
                 apps/daemon/engine/engine.js
                         |
                         v
             Thunder native download SDK
```

`apps/daemon/host/src/stack.js` is only a local supervisor. It starts the daemon core once and independently restarts the Web API if the gateway exits. The daemon core owns downloads, account state, P2SP/VIP acceleration, repositories, scheduling and native engine recovery. Restarting the Web API therefore does not stop active downloads or reset acceleration state.

## Layer ownership

| Layer | Implementation | Owns | Must not own |
| --- | --- | --- | --- |
| Native engine adapter | `apps/daemon/engine/`, `apps/daemon/host/src/driver.js`, `apps/daemon/host/src/engine-client.js` | Native SDK calls, engine process, private engine protocol | Public HTTP or WebUI contracts |
| Daemon application core | `apps/daemon/host/src/domain/`, `services/`, `repositories/`, `rpc/` | Download state, task commands, login, P2SP/VIP, policies and durable data | HTTP listeners, static files or public mTLS listeners |
| Daemon control API | `apps/daemon/host/src/control/` | Versioned private methods, file capabilities and media leases | Browser authentication headers or public network listening |
| Client SDK | `packages/daemon-client/` | Control framing, connection reuse, request multiplexing and daemon errors | Daemon services, repositories or native driver imports |
| External Web API | `apps/web-api/src/` | `/jsonrpc`, `/api/v2/*`, WebUI assets, HTTP security context and remote mTLS | Direct imports from daemon internals |
| Web application | `apps/webui/src/` | Native-style presentation and user interaction | Filesystem or native engine access |

The architecture test `apps/daemon/test/architecture/external-web-api-boundary.test.js` enforces the most important dependency rule: the external Web API may reach the daemon only through `@tlei/daemon-client`.

## API boundaries

### Daemon Node API

The daemon-facing application API is implemented by:

- `apps/daemon/host/src/control/server.js`: private Unix socket server and framed JSON-RPC transport.
- `apps/daemon/host/src/control/dispatcher.js`: `daemon.v1.*` methods, staged-file validation, resource leases and remote permission checks.
- `packages/daemon-client/src/client.js`: reusable client for external applications.

The socket defaults to `${THUNDERD_RUNTIME_DIR}/thunderd-control.sock` and can be overridden with `THUNDERD_CONTROL_SOCKET`. It is created with mode `0600`. The protocol is intentionally private and versioned independently from the browser-facing `thunder.ui.v2.*` contract.

Large and streaming resources are not returned as public local paths. The Web API stages uploads below the daemon runtime, and the daemon validates the staging boundary before consuming them. For torrent exports, media and generated diagnostic archives the daemon returns a connection-bound capability over the private socket; the client releases its lease after streaming. A dropped control connection releases its outstanding leases automatically.

### Web API

The browser and integration API is implemented by:

- `apps/web-api/src/server.js`: HTTP listener, JSON-RPC envelopes and static WebUI delivery.
- `apps/web-api/src/routes/`: torrent upload/export, media Range, diagnostics and browser capture.
- `apps/web-api/src/remote/`: remote mTLS listener and remote-node HTTP compatibility routes.
- `apps/web-api/src/main.js`: gateway composition and daemon connection.

Existing URLs and `thunder.ui.v2.*` method names remain compatible. HTTP authentication and request metadata are forwarded to the daemon application boundary, so authorization, CSRF and private-session checks still protect the same operations.

### Native engine API

`apps/daemon/host/src/driver.js` and `apps/daemon/host/src/engine-client.js` are the only daemon-side entry to `apps/daemon/engine/engine.js`. This JSON-lines protocol is an implementation detail for native SDK isolation. It is not exported by `@tlei/daemon-client` and is not available to the Web API.

## Startup modes

All runtime assembly goes through one Cordis plugin-tree launcher (`packages/runtime`, vendored core pinned in `vendor/cordis`). The legacy entries only forward to it:

```bash
# Full local product stack with a lightweight supervisor.
bash apps/daemon/run.sh

# Daemon core only, suitable for another local application using daemon-client.
node apps/daemon/host/src/main.js            # forwards to entry.mjs --profile thunderd-core

# External Web API only; connects to an already running daemon core.
node apps/web-api/src/main.js
```

The launcher itself understands three profiles — `thunderd` (core + web-api subprocess), `thunderd-core` (bare core) and `bridge-host` (standalone webseed bridge, see `apps/bridge/README.md`) — plus `--dump-config` for a redacted, non-starting view of the composed plugin tree and `--config <json>` for user patches. `scripts/verify-application-entrypoints.mjs` fails the build if an entry bypasses the launcher.

The systemd deployment does not use the local supervisor: `thunderd.service` and `thunder-web-api.service` run the core and gateway as independently restartable services.

## Design references

The separation follows established designs without copying their wire contracts:

- Cockpit separates the browser-facing `cockpit-ws` web service from `cockpit-bridge`, which owns access to system APIs: <https://docs.cockpit-project.org/cockpit-guide/main/man/cockpit-ws.8.html> and <https://cockpit-project.org/blog/protocol-for-web-access-to-system-apis.html>.
- The Language Server Protocol places reusable application logic behind a transport-independent JSON-RPC boundary: <https://microsoft.github.io/language-server-protocol/>.
- Fastify encapsulation is used as the model for keeping HTTP routes and their dependencies inside the external gateway boundary: <https://fastify.dev/docs/v5.7.x/Reference/Encapsulation/>.
- The supervisor and separate entry points keep the components compatible with socket/service activation patterns described by systemd: <https://www.freedesktop.org/software/systemd/man/252/systemd-socket-activate.html>.

## Validation

`apps/web-api/test/process-separation.test.js` starts a persistent daemon control process, restarts the Web API process and confirms daemon-owned state survives. Unit tests cover fragmented control frames, multiplexed requests, private socket permissions, staged torrent uploads and streaming-resource lease release.
