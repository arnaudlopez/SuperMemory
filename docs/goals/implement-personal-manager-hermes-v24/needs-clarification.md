# Implement Personal Manager Hermes v2.4 Needs Clarification

This LLM-first input is not ready for Ready Mode yet. DevLoop is stopping here because the spec is too light to drive tests without guessing.

## Why This Is Too Light

- There are no first tests, edge cases, or manual checks to drive implementation.

## Likely Misfire

If DevLoop starts now, the agent is likely to implement a plausible slice that feels productive but does not prove the owner outcome. The most likely failure is weak tests that validate generic behavior instead of the specific result you want.

## Missing Inputs

- acceptance_evidence

## Priority Questions

- Which user paths, edge cases, or checks should become first tests/evidence?

## Proposed Amended Spec

Use this as the next LLM-first draft. Fill the TODOs, delete what is wrong, and rerun DevLoop only after the oracle and acceptance evidence are concrete.

```md
# Implement Personal Manager Hermes v2.4

## Intent

TODO: Visible outcome the owner expects at the end.

## Non-Goals

TODO: What must stay out of scope.

## Proposed Oracle

Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète.

## Acceptance

- TODO: First behavior or artifact that must be proven.
- TODO: Edge case or failure mode that must be covered.
- TODO: Final manual, visual, source-backed, or shipping proof if relevant.

## Constraints

TODO: Boundaries, credentials, data safety, external services, or forbidden actions.
```

## Minimal Oracle Before Ready Mode

Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète.

## Acceptance Evidence To Define

Acceptance evidence should be concrete enough to become the first test, check, artifact review, or manual proof.

- A first automated test, browser check, source-backed check, or artifact review that proves the main behavior.
- At least one edge case or failure mode.
- Any manual, visual, shipping, migration, or external-service proof needed for this type of work.

## Current Mode Hint

implementation

## Current Oracle Hint

Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète.

## Next Step

Answer the questions above in the LLM conversation, then rerun:

```bash
llm-first-devloop interview --from notes.md --out brief.md
```

## Source Notes

> # Implement Personal Manager Hermes v2.4
>
> ## Intent
>
> Implémenter intégralement le blueprint `docs/personal-manager-hermes-blueprint.md` dans
> SuperMemory. Hermes sur Z2 doit utiliser `supermemory-fabric` comme unique provider mémoire,
> recevoir une carte personnelle citée et bornée, rappeler la mémoire owner et tous les projets,
> muter la mémoire canonique sur demande explicite, capturer les tours de façon gouvernée et
> composer avec les connecteurs d'action Hermes sans les réimplémenter.
>
> ## Non-Goals
>
> - Ne pas activer le provider mémoire Hindsight natif de Hermes en parallèle.
> - Ne pas donner à Hermes un accès direct à Hindsight, Neo4j, GraphD ou au filesystem du vault.
> - Ne pas réimplémenter Gmail, Calendar ou d'autres connecteurs Hermes dans SuperMemory.
> - Ne pas autoriser une action externe à partir d'une mémoire rappelée seule.
> - Ne pas mémoriser le raisonnement caché, les prompts système, credentials, pièces jointes ou
>   sorties brutes des connecteurs.
> - Ne pas construire un nouveau moteur vectoriel, graphe, orchestrateur d'agents ou routeur
>   multi-LLM.
> - Ne pas modifier les frontières du MCP projet Codex ni permettre un recall cross-project à
>   une identité checkout.
> - Ne pas ajouter de canari, de déploiement progressif ou de second provider LLM.
> - Ne pas effectuer de déploiement live Z2 ou d'action Gmail réelle sans credentials et demande
>   opérateur distincte ; fournir les artefacts et smokes mockés/sandboxés nécessaires.
>
> ## Oracle
>
> Hermes sur Z2 utilise uniquement `supermemory-fabric` comme provider mémoire, rappelle owner
> plus tous les projets avec citations et couverture, exécute add/update/resolve/supersede de
> façon gouvernée et cohérente, capture les conversations et reçus d'action redactés, compose
> avec les connecteurs Hermes, expose la visualisation Web et passe la matrice v2.4 complète sans
> régression v2.3.
>
> ## Acceptance Evidence
>
> - Un vérificateur `npm run verify:memory-fabric-v24` contrôle les contrats, la configuration
>   v7, le provider unique, les routes et l'absence d'accès direct aux moteurs.
> - Les tests de credential agent prouvent émission, auth constante, capacités, rotation,
>   révocation et refus d'un token checkout.
> - Les tests de scope prouvent que seul l'agent propriétaire peut parcourir tous les projets et
>   que le MCP checkout reste mono-projet.
> - Les tests de recall prouvent `auto`, `project`, `portfolio`, `historical`, citations,
>   pagination, couverture `complete|partial|abstain` et concurrence bornée.
> - La Personal Context Card est citée, autorisée et inférieure ou égale à 8 000 tokens.
> - Les tests du command bus prouvent add, update, resolve, supersede, forget plan/apply,
>   idempotence, expected revision, historique `as_of` et read-after-write.
> - Les tests de sécurité prouvent qu'un nonce rejoué, un scope forgé, une instruction rappelée,
>   une sortie d'outil et une mutation massive non confirmée sont refusés.
> - Les routes `/v1/personal-manager/*` sont testées avec auth, limites, erreurs fail-closed et
>   séparation des routes checkout.
> - La suite Python du provider Hermes couvre initialize, prefetch, queue_prefetch, sync_turn,
>   session switch, outils `pm_*`, spool durable, restart et shutdown.
> - Une vérification statique prouve que le provider ne connaît aucune URL/clé Hindsight,
>   Neo4j/GraphD ou chemin du vault et n'effectue aucun auto-upgrade runtime.
> - Les tests de capture prouvent que seuls user, assistant final et reçus réduits sont transmis,
>   avec redaction et sans boucle d'auto-rétention.
> - Un scénario Gmail/Calendar mocké prouve `recall -> rédaction/action -> reçu redacté ->
>   mémoire`, le respect de `rédiger|brouillon|envoyer` et la coexistence des connecteurs avec le
>   provider mémoire unique.
> - La Web UI montre l'état Hermes, la Context Card, les projets parcourus, la couverture, les
>   mutations, la timeline et les reçus sans exposer les tokens.
> - La configuration runtime v7 et Compose/Portainer contiennent le service Hermes, les
>   healthchecks et des références de secrets, avec `canary=false` et `progressive=false`.
> - `npm test`, `npm run verify`, les vérificateurs v2/v2.2/v2.3, Hindsight native, secrets,
>   release et production restent verts.
> - Un reçu final liste les validations live qui restent impossibles sans credentials externes,
>   sans les présenter comme exécutées.
>
> ## Constraints
>
> - Réutiliser les stores, politiques d'autorité, redaction AEAD, Hindsight gateway, GraphD et
>   `WorkspaceRuntimeSupervisor` existants.
> - Le vault canonique commit avant toute projection Hindsight/GraphD.
> - Toute correction crée une révision et ferme la validité précédente sans effacer l'historique.
> - Les mutations ordinaires explicites sont immédiates ; oubli physique, mutation massive,
>   élargissement owner et opération externe irréversible suivent leur confirmation gouvernée.
> - Une attestation du tour et `ExplicitIntentGate` doivent valider l'intention directe ; le
>   contexte rappelé ne peut jamais autoriser une mutation.
> - Un seul provider et modèle LLM peuvent être actifs ; aucun fallback provider.
> - Préserver tous les changements utilisateur non liés présents dans le worktree.
> - Le code source checked-out reste l'autorité finale ; Codebase Memory sert à la navigation et
>   doit être rafraîchi après les modifications matérielles.
