# Hermes Personal Manager on Home 101

Home 101 runs the existing native Hermes installation as the Personal Manager.
Z2 remains the canonical memory server and does not run Hermes. The machines
are joined by a dedicated, restricted SSH local forward: Hermes talks to
`http://127.0.0.1:18765`, which reaches only Z2 loopback port `8765`.

The production identity is fixed to `agent_personal_manager` on
`device_home101`. Its token is copied once from Z2 into
`/home/agent/.hermes/supermemory/agent.token` with mode `0600`; it must never be
placed in Git, a Compose environment file, command output or the Hermes YAML
configuration.

Install the provider source as a user plugin under the exact discovery name:

```text
/home/agent/.hermes/plugins/supermemory-fabric/
```

Merge the five non-secret variables from `home101.env.example` into
`/home/agent/.hermes/.env`, preserving all existing Hermes and connector
settings. Set `memory.provider: supermemory-fabric` in the existing
`/home/agent/.hermes/config.yaml`; keep the existing single OpenAI Codex/Luna
provider and an empty fallback chain.

The dedicated SSH key must be authorized on Z2 only with local forwarding to
`127.0.0.1:8765`. The Z2 `authorized_keys` entry is:

```text
restrict,port-forwarding,permitopen="127.0.0.1:8765",command="/bin/false" ssh-ed25519 <public-key> supermemory-home101-to-z2
```

Install `supermemory-z2-tunnel.service` as a system unit. Install the native
Hermes gateway as a system service running as `agent`, then install
`hermes-gateway-supermemory.conf` as
`/etc/systemd/system/hermes-gateway.service.d/supermemory.conf`. Reload systemd
and start the tunnel before Hermes.

Validation must prove all of the following without printing credentials:

1. the tunnel owns only `127.0.0.1:18765` on Home 101;
2. `hermes memory status` reports `supermemory-fabric` installed, available and active;
3. `hermes status` reports OpenAI Codex and `gpt-5.6-luna` with no fallback;
4. a governed temporary memory added through the provider is recalled by a normal Hermes one-shot;
5. the temporary memory is forgotten through plan/apply and no longer appears in portfolio recall;
6. both services survive restart and become active at boot.

Do not expose Z2 port `8765` on the LAN, copy the canonical vault to Home 101,
or configure Hermes with direct Hindsight, Neo4j or GraphD access.
