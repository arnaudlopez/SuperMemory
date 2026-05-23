# Source Refresh Connector Boundary

This case proves the first connector-backed boundary without adding real external connectors.

It models a local `fixture_connector` run that turns connector results into source refresh candidates:

- connector id, auth status, workspace, and scope must match the source registry;
- source references must stay inside the connector scope;
- changed connector results must carry snapshot lineage into the refresh candidate and plan;
- unavailable connector results become last-known/unverified, never fresh;
- `do_not_use` sources are blocked before refresh or active promotion.

The case is intentionally local and deterministic. It does not fetch external sources, load secrets, run background jobs, or write to live Hindsight.
