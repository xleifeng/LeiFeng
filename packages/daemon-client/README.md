# @tlei/daemon-client

Local applications use this package to reach a running Thunder daemon core without importing its services, repositories or native driver.

```js
const { DaemonClient, controlSocketPath } = require('@tlei/daemon-client');

const runtimeDir = process.env.THUNDERD_RUNTIME_DIR;
const client = new DaemonClient({
  socketPath: controlSocketPath({ runtimeDir }),
});

const health = await client.health();
const tasks = await client.invoke('thunder.ui.v2.tasks.query', [{}], {
  authorization: `Bearer ${process.env.THUNDERD_RPC_SECRET || ''}`,
  bearerToken: process.env.THUNDERD_RPC_SECRET || '',
  isLoopback: true,
});
```

The transport is JSON-RPC 2.0 with `Content-Length` framing over a mode-0600 Unix domain socket. The package reuses one connection, correlates concurrent requests by id and reconnects after a daemon restart. Streaming resources use explicit leases; call `releaseLease()` when the consumer closes.

The `daemon.v1.*` protocol is private to local applications and versioned separately from public WebUI methods. Do not connect the control socket to a network listener or expose file-capability results in a public response.
