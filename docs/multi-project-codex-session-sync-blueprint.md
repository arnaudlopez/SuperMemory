# SuperMemory Memory Fabric v2.3 — Multi-Project Codex & Session Sync

Date : 2026-08-09

Statut : blueprint approuvé pour implémentation

Cible : Mac mini M4 Pro comme poste de travail, Z2 comme serveur personnel de production

Déploiement : activation intégrale, `canary=false`, `progressive=false`

## 1. Résumé exécutif

Cette tranche transforme l'intégration Codex actuelle, encore liée à un seul couple
`workspace_id/project_id` au démarrage de `supermemoryd`, en un véritable cerveau personnel
multi-projet.

Le résultat cible est le suivant :

- une seule stack SuperMemory sur Z2 ;
- un seul tunnel et un seul client SuperMemory sur le Mac ;
- une installation personnelle du plugin Codex ;
- une mémoire isolée par projet ;
- une petite couche de mémoire personnelle globale, héritée explicitement par chaque projet ;
- une capture automatique des nouvelles sessions Codex ;
- un import explicite, prévisualisé et idempotent des sessions Codex locales existantes ;
- aucune synchronisation du code source, qui reste la responsabilité de Git ;
- aucun accès MCP permettant au modèle de changer arbitrairement de projet.

La règle centrale est :

```text
recall d'une session = mémoire personnelle autorisée + mémoire du projet courant
                      + mémoire de travail de la session courante

recall d'une session != mémoire de tous les autres projets
```

Le système existant est largement réutilisé. Le stockage, le registre de projets, Hindsight,
Neo4j/GraphD, les working sets, la continuité thématique, l'autorité et la compilation sont
déjà paramétrés par workspace dans leurs couches profondes. Le principal travail porte sur
la supervision dynamique des scopes, l'enrôlement des checkouts, le client Codex universel
et l'import d'historique.

## 2. État de départ vérifié

L'audit du dépôt et de l'installation locale au 2026-08-09 établit les faits suivants.

### 2.1 Capacités déjà présentes

- Le registre sait créer un `workspace_id`, un `project_id` et un `checkout_id` stables.
- Plusieurs checkouts peuvent être liés au même projet logique.
- Les marqueurs projet sont stockés sous `.git/supermemory` pour un dépôt Git.
- Les enveloppes d'événements acceptent déjà `adapter=history_import` et
  `capture_level=backfill`.
- Le compilateur, les stores, l'ontologie et les workers connaissent déjà le
  `workspace_id`.
- `processCanonicalKnowledgeWorkspaces` sait traiter plusieurs workers.
- Hindsight utilise déjà une banque déterministe par workspace.
- GraphD produit et vérifie déjà un bearer dérivé du workspace, puis revalide les réponses
  localement.
- Le MCP est lié à un projet et rejette les arguments de scope fournis par le modèle.
- Le produit possède déjà des tests de stockage multi-workspace.
- Les hooks du plugin couvrent `SessionStart`, `UserPromptSubmit`, `PostToolUse`,
  `PreCompact`, `PostCompact`, `Stop` et `SessionEnd`.
- Le runtime v5 impose déjà un déploiement complet sans canari ni activation progressive.

### 2.2 Limites actuelles

- `scripts/supermemoryd.mjs` reçoit un seul `--workspace-id` et un seul `--project-id`.
- `createCodexMemoryRouter` est construit pour ce scope unique.
- `configure-z2-client.mjs` produit une configuration liée à un projet précis.
- Un bearer daemon global donne aujourd'hui trop de pouvoir s'il est réutilisé pour tous les
  projets.
- Le plugin local existe dans le dépôt, mais son marketplace n'est pas enregistré dans
  l'installation Codex courante.
- Le pont du plugin dépend de chemins absolus internes au checkout SuperMemory.
- Les autres projets locaux ne sont ni enrôlés ni configurés.
- Il n'existe pas de commande opérateur pour importer les anciennes sessions Codex.
- L'interface Web ne propose ni liste ni sélecteur de projet.

### 2.3 Contraintes Codex officielles

Les décisions d'intégration s'alignent sur la documentation officielle :

- Codex accepte une configuration MCP utilisateur ou une configuration projet sous
  `.codex/config.toml` pour un projet approuvé ;
- les capacités d'un plugin deviennent disponibles dans une nouvelle session après
  installation ;
- les hooks projet nécessitent une approbation, et une modification de leur contenu peut
  demander une nouvelle approbation ;
- `codex resume` reste le mécanisme Codex pour rouvrir une conversation locale ;
- SuperMemory synchronise la mémoire d'une session, pas le moteur de reprise interactif de
  Codex.

Références officielles : [plugins Codex](https://learn.chatgpt.com/docs/plugins),
[MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[configuration Codex](https://learn.chatgpt.com/docs/config-file/config-reference),
[hooks Codex](https://learn.chatgpt.com/docs/hooks) et
[Codex CLI](https://learn.chatgpt.com/docs/codex/cli).

## 3. Objectifs

### 3.1 Objectifs produit

1. Enrôler chaque projet utilisé sur le Mac sans manipulation manuelle de secrets ou de
   fichiers JSON.
2. Démarrer une nouvelle session Codex et recevoir automatiquement le contexte approprié.
3. Ne jamais mélanger les souvenirs de deux projets non liés.
4. Partager dans tous les projets les préférences personnelles réellement globales.
5. Visualiser sur le Mac les projets, sessions, topics, mémoires et états de synchronisation
   hébergés sur Z2.
6. Importer les sessions Codex locales existantes avec plan, aperçu, filtres et reprise.
7. Conserver Git comme source de vérité et mécanisme de synchronisation du code.

### 3.2 Objectifs techniques

1. Remplacer le binding singleton du daemon par un superviseur multi-projet borné.
2. Résoudre le scope côté serveur depuis une identité de checkout, jamais depuis les seuls
   identifiants déclarés par le client.
3. Garder chaque serveur MCP strictement lié au projet depuis lequel Codex l'a lancé.
4. Réutiliser une seule instance Hindsight, une seule instance Neo4j et un seul GraphD.
5. Préserver les contrats temporels, l'autorité, les citations et le `working_set_id`.
6. Rendre capture et import idempotents malgré plusieurs adaptateurs.
7. Supporter les évolutions de format Codex par des lecteurs versionnés et fail-closed.

## 4. Non-objectifs

- Synchroniser ou versionner le code source.
- Copier les dépôts entre Mac et Z2.
- Scraper ChatGPT, les conversations Web ou des données de compte sans API officielle.
- Rendre une session importée reprenable dans Codex sur une autre machine.
- Exposer au modèle une recherche globale dans tous les projets.
- Exposer un outil MCP `list_projects`, `switch_project` ou un paramètre de workspace.
- Créer un conteneur, un daemon ou une base Neo4j par projet.
- Introduire plusieurs fournisseurs ou un routeur de LLM.
- Changer le fournisseur d'intelligence retenu par la configuration de production actuelle.
- Stocker les raisonnements cachés, secrets bruts ou sorties intégrales non nécessaires.
- Contourner automatiquement la revue de confiance des hooks Codex.
- Ajouter un canari ou un déploiement progressif.

## 5. Décisions structurantes

### D1 — Une stack, plusieurs contextes

Z2 exécute une seule stack. `supermemoryd` charge les contextes de projet à la demande et les
évince après inactivité. La croissance du nombre de projets ne crée pas de nouveaux services.

### D2 — Deux couches de mémoire seulement

Chaque recall combine :

1. un workspace personnel global, réservé aux préférences et faits explicitement globaux ;
2. le workspace du projet courant.

La couche personnelle n'est pas le workspace d'un projet existant. C'est un scope dédié,
créé une fois pour le propriétaire. Les souvenirs d'un projet ne sont jamais promus dans ce
scope par simple fréquence. Une promotion globale exige une classification à forte confiance
ou une validation propriétaire.

### D3 — Un workspace par projet logique

Le `workspace_id` reste la frontière d'isolation. Le `project_id` représente le projet
logique. Plusieurs worktrees ou clones volontairement liés partagent ce couple, mais gardent
des `checkout_id` distincts.

### D4 — Le serveur détermine le scope réel

Le client possède un secret opaque propre au checkout. Z2 ne stocke que son empreinte et la
liaison canonique vers `workspace_id/project_id/checkout_id/device_id`. Les identifiants reçus
dans une requête ne sont que des assertions à comparer au binding serveur.

### D5 — Le MCP reste non routable par le modèle

Le launcher MCP résout le checkout depuis son répertoire courant avant de démarrer le serveur.
Le serveur MCP obtenu est lié à un projet et à un credential. Les schémas d'outils continuent
d'interdire les paramètres de scope explicites.

### D6 — Une banque Hindsight par workspace

Une instance Hindsight héberge une banque personnelle et une banque par projet. La banque est
créée paresseusement et de façon idempotente à partir du template existant.

### D7 — Une seule base graphe partitionnée

Neo4j reste unique. Chaque nœud et chaque relation canonique porte un workspace. GraphD
exécute séparément les requêtes du projet et de la couche personnelle, puis le daemon fusionne
et revalide les résultats. Aucun Cypher brut n'est exposé.

### D8 — Capture future automatique, import historique explicite

Les hooks capturent les nouvelles sessions. L'historique existant est découvert en lecture
seule, prévisualisé puis importé après confirmation. SuperMemory ne modifie jamais le stockage
de sessions de Codex.

### D9 — Installation personnelle stable

Le plugin est installé une fois dans Codex, mais ses launchers résident dans un répertoire
client stable tel que `~/.supermemory/client`, indépendant du checkout du dépôt SuperMemory.
L'enrôlement ajoute seulement le binding local du projet.

### D10 — Déploiement direct avec rollback, sans canari

La release remplace directement le runtime de production après backup et validation. Le
rollback est une restauration de configuration et d'image, pas une coexistence progressive.

## 6. Modèle d'identité et d'isolation

```text
Owner
├── owner_workspace_id
│   └── préférences globales explicitement autorisées
└── Projects
    ├── project_id A -> workspace_id A
    │   ├── checkout_id A1 -> Mac/device credential A1
    │   └── checkout_id A2 -> worktree credential A2
    └── project_id B -> workspace_id B
        └── checkout_id B1 -> Mac/device credential B1
```

### 6.1 Sémantique des identifiants

| Identifiant | Rôle | Stabilité |
|---|---|---|
| `owner_id` | propriétaire de l'instance personnelle | vie de l'instance |
| `owner_workspace_id` | préférences transversales autorisées | vie de l'instance |
| `workspace_id` | frontière de données d'un projet | vie du projet |
| `project_id` | identité logique du projet | vie du projet |
| `checkout_id` | clone ou worktree précis | vie du checkout |
| `device_id` | installation cliente du Mac | rotation explicite |
| `session_id` | session native Codex | fourni ou dérivé de la source |
| `working_set_id` | contrat de mémoire de travail | session/topic courant |

### 6.2 Héritage de la mémoire personnelle

Le daemon exécute deux recalls indépendants et gouvernés :

```text
ownerRecall(owner_workspace_id)
projectRecall(workspace_id, project_id, working_set_id)
                    │
                    └── fusion bornée, reranking, déduplication, citations
```

La couche personnelle est en lecture seule depuis une session projet. Une session peut
proposer une préférence globale, mais sa promotion passe par la politique d'admission et est
auditée comme `scope_transition=project_to_owner`.

Les catégories autorisées globalement sont limitées aux préférences personnelles, conventions
de travail transversales, identité d'appareils et choix d'infrastructure durables. Les faits de
code, décisions métier, secrets, chemins sensibles et états d'un projet restent locaux.

## 7. Architecture runtime cible

```text
Mac mini M4 Pro                              Z2
┌──────────────────────────┐                 ┌──────────────────────────────┐
│ Codex CLI / Desktop      │                 │ SuperMemory Web / API        │
│ plugin personnel         │                 │                              │
│ hooks + MCP launchers    │── tunnel SSH ──▶│ Auth & Scope Resolver        │
│ project marker resolver  │                 │           │                  │
│ encrypted offline spool  │                 │ WorkspaceRuntimeSupervisor   │
└──────────────────────────┘                 │   ├── owner context          │
                                             │   ├── project context A      │
                                             │   └── project context B      │
                                             │          │                   │
                                             │ Vault / Hindsight / GraphD   │
                                             │ Neo4j / compiler Codex       │
                                             └──────────────────────────────┘
```

### 7.1 `WorkspaceRuntimeSupervisor`

Nouveau composant responsable de :

- charger le registre canonique des projets ;
- résoudre un credential de checkout en scope canonique ;
- créer paresseusement un `WorkspaceRuntimeContext` ;
- mutualiser les stores réellement globaux et isoler les adaptateurs liés au workspace ;
- limiter le nombre de contextes actifs ;
- sérialiser la création d'un même contexte ;
- superviser les canonical workers ;
- évincer les contextes inactifs sans perdre les tâches persistées ;
- réhydrater les workers après redémarrage.

### 7.2 `WorkspaceRuntimeContext`

Un contexte contient les bindings nécessaires pour un projet :

- `workspaceStore` ;
- `workingSetStore` et migrations temporelles idempotentes ;
- `topicStore`, `topicResolver` et `topicView` ;
- `memoryRecall` et `memoryRouter` ;
- `authorityPolicy` et `exceptionStore` ;
- `ontologyRegistry` et `knowledgeGraphAdapter` ;
- client Hindsight et gateway d'autorité liés au workspace ;
- canonical worker ;
- compteurs d'activité, état de santé et horodatage d'utilisation.

Le contexte propriétaire utilise la même abstraction mais n'accepte ni working set de projet
ni capture de fichiers projet.

### 7.3 Capacité et éviction

Valeurs initiales recommandées :

- 16 contextes projet actifs ;
- 1 contexte propriétaire toujours chaud ;
- éviction après 30 minutes d'inactivité ;
- 4 démarrages de contexte simultanés ;
- 4 canonical workers simultanés ;
- files persistantes par workspace ;
- aucune perte d'une tâche acquittée lors d'une éviction.

## 8. Enrôlement des projets

### 8.1 Parcours opérateur

```text
supermemory project enroll --project-root /chemin/du/projet
    -> découverte locale
    -> plan sans mutation
    -> création/rattachement côté Z2
    -> confirmation de l'opérateur
    -> écriture atomique des marqueurs et du credential
    -> diagnostic Codex
```

La commande par défaut produit un plan. `--apply --plan-hash <hash>` applique exactement ce
plan. Aucun projet existant n'est automatiquement lié en fonction de son nom ou de son remote
Git.

### 8.2 Création ou liaison

Trois opérations sont distinctes :

- `create` : nouveau projet logique et nouveau workspace ;
- `link` : nouveau checkout d'un projet existant, avec `project_id` explicitement choisi ;
- `rebind` : remplacement contrôlé du binding d'un checkout copié ou restauré.

Deux dépôts portant le même nom ne sont jamais fusionnés automatiquement. Les worktrees d'un
même dépôt peuvent être proposés comme lien, mais l'application reste explicite.

### 8.3 Credential de checkout

Le secret client est aléatoire sur 256 bits, propre à un checkout et stocké dans un fichier
mode `0600` hors Git. Le serveur stocke :

- son hash avec sel ;
- le `device_id` ;
- le binding canonique ;
- les capacités autorisées ;
- la date de création, de dernière utilisation et de révocation ;
- la version de configuration cliente attendue.

Une fuite révoque un checkout, pas toute l'instance. La rotation n'altère pas les identifiants
du projet.

### 8.4 Fichiers locaux

Pour un dépôt Git :

- marqueur public sous `.git/supermemory/project.json` ;
- marqueur checkout sous `.git/supermemory/checkout.json` ;
- credential sous `~/.supermemory/credentials/<checkout_id>.token` ;
- runtime client sous `~/.supermemory/client` ;
- configuration projet sous `.codex/supermemory`, sans secret.

Pour un projet non-Git, le marqueur réside sous `.supermemory/` et doit être exclu des outils
de publication lorsque le projet possède un mécanisme équivalent à Git.

## 9. Synchronisation des nouvelles sessions Codex

### 9.1 Résolution au démarrage

À `SessionStart`, le launcher :

1. canonicalise le `cwd` sans suivre un marqueur symbolique non fiable ;
2. remonte jusqu'à la racine Git ou au marqueur non-Git ;
3. charge le binding public ;
4. charge le credential correspondant hors dépôt ;
5. demande à Z2 de valider le binding ;
6. crée ou reprend le `working_set_id` lié à la session Codex ;
7. injecte une carte citée et bornée.

Un répertoire non enrôlé ne reçoit aucun contexte et le hook répond rapidement avec un statut
neutre. Il ne crée jamais implicitement de projet.

### 9.2 Capture

Les événements visibles continuent de passer par les hooks existants. Chaque enveloppe reçoit
un identifiant déterministe dérivé de :

```text
adapter + device_id + checkout_id + session_id + event_type + native_event_id/hash
```

La capture locale applique la redaction avant transport. En cas d'indisponibilité de Z2, elle
écrit dans la file chiffrée existante, partitionnée par checkout, puis reprend dans l'ordre par
session.

### 9.3 Worktrees et reprise

- Deux worktrees liés au même projet partagent la mémoire durable du projet.
- Leur `checkout_id` et leurs sessions restent distincts.
- Un `codex resume` retrouve le même `working_set_id` si l'identité de session est disponible.
- Si Codex ne fournit pas d'identité stable, le client crée une liaison locale auditée et ne
  fusionne jamais deux sessions sur un simple titre.

## 10. Import des sessions Codex existantes

### 10.1 Principes

L'import est un pipeline séparé des hooks temps réel :

```text
discover -> parse -> normalize -> redact -> plan -> confirm -> upload -> dedupe -> compile
```

Il est toujours :

- local et en lecture seule sur le stockage Codex ;
- explicite ;
- filtrable par projet, chemin et période ;
- reprenable par checkpoint ;
- idempotent ;
- compatible avec `adapter=history_import` et `capture_level=backfill` ;
- de confiance inférieure à un événement riche capturé en direct.

### 10.2 Lecteurs versionnés

Le module `codex-history-discovery` détecte les emplacements réellement présents. Chaque format
est traité par un lecteur déclaré avec :

- signature de format ;
- versions acceptées ;
- champs requis ;
- stratégie d'identité ;
- limites de taille ;
- niveau de fidélité ;
- motifs secrets à exclure.

Un format inconnu est listé comme `unsupported_schema` et n'est pas importé. Le système ne
tente pas de deviner silencieusement une nouvelle structure.

### 10.3 Plan d'import

Le plan affiche au minimum :

- nombre de sessions découvertes, supportées et ignorées ;
- mapping proposé vers les projets enrôlés ;
- sessions sans projet ou ambiguës ;
- période couverte ;
- volumes d'événements et d'octets après redaction ;
- doublons déjà présents ;
- fichiers exclus ;
- hash exact du plan.

Les sessions sans mapping fiable restent non importées. L'opérateur peut les affecter à un
projet dans un nouveau plan, jamais en modifiant le plan calculé.

### 10.4 Admission des souvenirs historiques

Les événements importés alimentent les épisodes et la compilation, mais ne deviennent pas
automatiquement des vérités actuelles. La politique :

- conserve la temporalité d'origine ;
- marque `source_capture_level=backfill` ;
- demande des sources ou signaux actuels pour promouvoir un état courant sensible ;
- déduplique une capture hook/App Server équivalente ;
- garde la provenance jusqu'au fichier source local sous forme de hash et d'identifiant
  opaque, sans exposer le chemin complet aux réponses MCP.

## 11. Contrats de données

### 11.1 `ProjectEnrollmentPlan v1`

```json
{
  "schema": "supermemory.project-enrollment-plan.v1",
  "plan_id": "plan_...",
  "plan_hash": "sha256:...",
  "operation": "create",
  "device_id": "device_...",
  "project": {
    "display_name": "Example",
    "root_fingerprint": "sha256:...",
    "git_common_dir_fingerprint": "sha256:..."
  },
  "proposed_binding": {
    "workspace_id": "ws_...",
    "project_id": "prj_...",
    "checkout_id": "co_..."
  },
  "writes": [],
  "expires_at": "2026-08-09T12:00:00.000Z"
}
```

Le plan ne contient ni secret ni chemin brut côté serveur.

### 11.2 `ProjectEnrollmentReceipt v1`

Le reçu contient le hash du plan, les identifiants créés, le hash de la configuration installée,
la version du client/plugin, l'identité du device et le résultat du diagnostic. Il est signé
par l'instance Z2 pour l'audit.

### 11.3 `CheckoutCredentialRecord v1`

Le record serveur contient le hash du secret, le binding, les capacités, les timestamps et
l'état `active|rotating|revoked`. Le secret brut n'est jamais journalisé ni stocké dans le vault.

### 11.4 `RuntimeContextStatus v1`

```json
{
  "schema": "supermemory.runtime-context-status.v1",
  "workspace_id": "ws_...",
  "project_id": "prj_...",
  "state": "warm",
  "active_sessions": 2,
  "pending_jobs": 0,
  "hindsight_bank": "ready",
  "graph": "ready",
  "last_used_at": "2026-08-09T12:00:00.000Z"
}
```

### 11.5 `SessionImportPlan v1`

Le contrat contient les compteurs, filtres, mappings, warnings, limites, hashes de sources et
un `plan_hash`. Aucun transcript n'est inclus dans le reçu d'opération.

### 11.6 `SessionImportCheckpoint v1`

Le checkpoint est chiffré et enregistre la source, la session, le dernier événement importé,
les hashes de déduplication et le statut. Il permet de reprendre après interruption sans
rejouer une session complète.

### 11.7 `CodexHostCapability v1`

Le diagnostic enregistre :

- version de Codex ;
- surfaces détectées : CLI, Desktop, IDE ;
- support des plugins, hooks et MCP ;
- marketplace et version de plugin installée ;
- hash de hooks approuvé ou à revoir ;
- nouvelle session requise ;
- compatibilité du lecteur d'historique.

## 12. API daemon et surface MCP

### 12.1 Routes propriétaire

Routes servies derrière l'authentification propriétaire et proxifiées par l'application Web :

- `GET /v1/projects` ;
- `GET /v1/projects/:project_id/status` ;
- `POST /v1/projects/enrollment/plan` ;
- `POST /v1/projects/enrollment/apply` ;
- `POST /v1/projects/:project_id/checkouts/:checkout_id/rotate` ;
- `POST /v1/projects/:project_id/checkouts/:checkout_id/revoke` ;
- `POST /v1/history/import/plan` ;
- `POST /v1/history/import/apply` ;
- `GET /v1/history/import/:import_id` ;
- `POST /v1/history/import/:import_id/cancel`.

Les routes de plan n'écrivent rien. Les routes d'application exigent le `plan_hash`, une date
d'expiration valide et une preuve anti-rejeu.

### 12.2 Routes client liées au checkout

Les routes de capture, contexte, recall et statut reçoivent le credential de checkout. Un
middleware produit un `ResolvedRequestScope` immuable. Toute divergence avec les assertions
du corps donne une erreur non descriptive `not_authorized`.

### 12.3 MCP

Les outils actuels sont conservés avec leurs contrats `working_set_id`. Ils reçoivent en
dépendance un client déjà lié au scope. Les changements interdits sont :

- ajouter `workspace_id`, `project_id` ou `checkout_id` aux input schemas ;
- permettre la découverte des autres projets ;
- retourner des chemins ou métadonnées d'un autre workspace ;
- effectuer un recall global direct.

Le merge avec la mémoire personnelle est interne au daemon. Chaque citation indique
`scope=owner|project|working` sans exposer d'autre projet.

## 13. Hindsight, Neo4j et intelligence

### 13.1 Hindsight 0.9.0+

Le système garde :

- une banque par workspace via `hindsightBankId(workspaceId)` ;
- le template de banque existant ;
- retain asynchrone ;
- recall temporel, graph et reranking ;
- revalidation locale de l'autorité et de la fraîcheur ;
- reçus d'opérations idempotents.

Le superviseur garantit une initialisation paresseuse `ensureBank` par workspace. Deux requêtes
concurrentes ne doivent jamais créer deux initialisations divergentes.

### 13.2 Neo4j/GraphD

Une seule base contient les graphes partitionnés. Les contraintes de sécurité restent :

- bearer dérivé du workspace ;
- propriété workspace obligatoire sur les nœuds et relations ;
- requêtes générées par des adaptateurs bornés ;
- réponse revalidée localement ;
- aucune traversée inter-workspace ;
- requêtes owner et projet séparées avant fusion applicative.

### 13.3 Besoin d'intelligence

Cette tranche ne demande pas un second LLM. Les tâches de découverte, auth, scope, déduplication
et import sont déterministes. Le modèle à raisonnement élevé reste utile pour :

- compiler des épisodes en souvenirs ;
- arbitrer les contradictions ;
- classifier prudemment une préférence comme globale ou projet ;
- synthétiser les topics ;
- vérifier la fraîcheur et l'autorité sémantique.

Le runtime conserve un fournisseur et un modèle configurés à la fois, sans fallback vers un
autre provider.

## 14. Intégration Codex et compatibilité

### 14.1 CLI et Desktop

Le chemin principal est le plugin personnel : hooks plus MCP. L'installeur :

1. détecte les commandes réellement supportées par la version de Codex ;
2. enregistre le marketplace local ;
3. installe ou met à jour `supermemory@supermemory-local` ;
4. écrit le runtime dans `PLUGIN_DATA` ;
5. vérifie le hash du plugin et des launchers ;
6. indique clairement qu'une nouvelle session est nécessaire ;
7. laisse à l'utilisateur l'approbation de confiance requise.

Il ne dépend pas d'anciennes commandes supposées telles que `plugin/list`. La détection de
capacité commande le comportement.

### 14.2 Extension IDE

Si la surface utilisée ne charge pas les plugins, l'enrôlement peut générer un MCP projet dans
`.codex/config.toml`, après approbation du projet. Cette voie apporte le recall MCP, mais pas la
capture complète par hooks. Le diagnostic doit afficher cette dégradation, jamais la masquer.

### 14.3 Matrice minimale

| Surface | MCP | Hooks | Capture future | Import historique |
|---|---:|---:|---:|---:|
| Codex CLI avec plugin | oui | oui | complet | oui, via CLI SuperMemory |
| Codex Desktop avec plugin | oui | oui si supporté | complet si hooks actifs | oui |
| Extension IDE sans plugin | projet | non | partiel | oui, externe à l'IDE |

## 15. Runtime config v6

Le schéma cible est `supermemory.codex-runtime.v6`. Exemple normatif abrégé :

```json
{
  "schema": "supermemory.codex-runtime.v6",
  "deployment": {
    "strategy": "full",
    "canary": false,
    "progressive": false,
    "activation": "enabled"
  },
  "scope": {
    "mode": "owner_plus_current_project",
    "registry": "canonical_dynamic",
    "cross_project_mcp": false,
    "owner_promotion": "governed"
  },
  "runtime_supervisor": {
    "max_active_project_contexts": 16,
    "idle_ttl_ms": 1800000,
    "context_start_concurrency": 4,
    "worker_concurrency": 4
  },
  "enrollment": {
    "credential_mode": "opaque_per_checkout",
    "plan_ttl_ms": 600000,
    "require_plan_hash": true
  },
  "history_import": {
    "enabled": true,
    "default_capture_level": "backfill",
    "max_event_bytes": 524288,
    "max_parallel_sessions": 4,
    "unknown_schema": "reject"
  },
  "codex_integration": {
    "plugin_id": "supermemory@supermemory-local",
    "require_new_session_after_change": true,
    "auto_trust_hooks": false
  }
}
```

Les sections v5 non montrées sont conservées. Les variables
`SUPERMEMORY_WORKSPACE_ID/SUPERMEMORY_PROJECT_ID` disparaissent du démarrage normal du daemon.
Elles ne sont acceptées que par une commande de migration explicite, jamais comme mode durable.

## 16. Interface Web sur le Mac

La Web UI reste servie par Z2 et affichée sur le Mac via le tunnel. Elle ajoute :

- un sélecteur de projet persistant dans l'URL et la session Web ;
- une page Projets avec état d'enrôlement, checkouts et dernière synchronisation ;
- une page Sessions avec statut live/importé, working set et topic ;
- un assistant d'import historique avec aperçu et progression ;
- le statut du plugin, des hooks, du tunnel et du client ;
- la rotation/révocation d'un checkout ;
- une vue personnelle distincte des vues projet.

Le navigateur ne reçoit ni token daemon global, ni credential de checkout. Le backend Web
résout le projet sélectionné côté serveur. Une URL contenant un `project_id` non autorisé ne
suffit jamais à changer le scope.

La page d'ensemble peut agréger des métriques non sensibles de plusieurs projets. Une recherche
de contenu cross-project reste hors scope de cette tranche.

## 17. Carte d'impact du code

### 17.1 Nouveaux modules proposés

- `scripts/lib/workspace-runtime-supervisor.mjs`
- `scripts/lib/workspace-runtime-context.mjs`
- `scripts/lib/checkout-credential-store.mjs`
- `scripts/lib/request-scope-resolver.mjs`
- `scripts/lib/project-enrollment.mjs`
- `scripts/lib/codex-client-launcher.mjs`
- `scripts/lib/codex-capability-probe.mjs`
- `scripts/lib/codex-history-discovery.mjs`
- `scripts/lib/codex-history-readers.mjs`
- `scripts/lib/codex-history-import.mjs`
- `scripts/supermemory-history.mjs`

### 17.2 Modules à modifier

- `scripts/supermemoryd.mjs` : supprimer la construction singleton et démarrer le superviseur.
- `scripts/lib/supermemory-daemon.mjs` : middleware de scope et routes multi-projet.
- `scripts/lib/codex-memory-router.mjs` : fusion owner + projet derrière un scope résolu.
- `scripts/lib/project-registry.mjs` : owner scope, enrollment, credentials et révocation.
- `scripts/supermemory-project.mjs` : commandes `enroll`, `link`, `rotate`, `revoke`.
- `scripts/configure-z2-client.mjs` : installation globale et bindings par checkout.
- `scripts/lib/codex-installer.mjs` : marketplace/plugin actuels et launchers stables.
- `plugins/supermemory/scripts/hook.mjs` : résolution dynamique depuis `cwd`.
- `plugins/supermemory/scripts/mcp.mjs` : résolution dynamique et binding fail-closed.
- `scripts/lib/codex-hook-adapter.mjs` : credential, device et déduplication multi-adapter.
- `scripts/lib/codex-event-equivalence.mjs` : équivalence hook/App Server/history.
- `scripts/lib/codex-runtime-config.mjs` : v6 et migration v5.
- `scripts/supermemory-app.mjs` et `web/app.js` : routes et sélecteur de projet.
- `deploy/portainer/supermemory-ai-stack.yml`, `deploy/portainer/supermemory-ai.env.example`
  et `docs/production-runbook.md` : démarrage dynamique sans scope singleton.

### 17.3 Modules réutilisés, sans duplication

- working set, working recall et offload 100K ;
- topic store/resolver/view et checkpoints ;
- temporal normalizer et retrieval plan ;
- authority policy et exception store ;
- ontology registry et knowledge graph adapter ;
- Hindsight client, gateway, learned plane et receipts ;
- chiffrement du vault et de la file offline ;
- canonical pipeline et canonical knowledge worker.

## 18. Migration et déploiement production

### 18.1 Préservation des données

La migration ne réécrit pas le vault immuable. Elle :

1. sauvegarde vault, registre, runtime et secrets ;
2. crée le scope propriétaire ;
3. importe le couple workspace/projet actuel comme première entrée active ;
4. émet un credential pour le checkout SuperMemory existant ;
5. transforme le runtime v5 en v6 ;
6. installe le client stable et le plugin ;
7. redémarre la stack dynamique ;
8. exécute les tests d'isolation et de recall ;
9. enrôle ensuite les autres projets explicitement.

### 18.2 Déploiement direct

Il n'y a ni canari ni activation progressive. L'application en production exige néanmoins :

- backup vérifié et restauration testée ;
- image/tag de rollback connus ;
- plan exact et hashé ;
- validation de configuration avant arrêt ;
- fenêtre courte d'indisponibilité ;
- smoke E2E après redémarrage ;
- rollback automatique si le daemon, Hindsight, GraphD ou le projet initial ne passent pas le
  smoke dans le délai prévu.

### 18.3 Rollback

Le rollback restaure le runtime v5, l'image précédente et le binding singleton sauvegardé. Les
nouveaux événements v6 restent dans des fichiers append-only compatibles ou sont ignorés par
v5 ; aucune suppression n'est effectuée. Les credentials créés pendant la tentative sont
révoqués avant retour au service.

## 19. Sécurité et confidentialité

Exigences obligatoires :

- aucun secret dans Git, `.codex/config.toml`, les marqueurs publics ou les reçus ;
- fichiers credential et clés en `0600`, répertoires secrets en `0700` ;
- refus des symlinks et des permissions élargies ;
- credential distinct par checkout ;
- vérification serveur du scope à chaque requête ;
- erreurs de scope non énumérables ;
- redaction avant transport et avant import ;
- quota de taille, fréquence et parallélisme par checkout ;
- anti-rejeu sur enrollment et import apply ;
- journal d'audit sans transcripts ni tokens ;
- révocation immédiate d'un checkout ;
- aucune confiance implicite accordée à un marqueur copié ;
- aucune auto-approbation des hooks Codex ;
- réponses owner/projet revalidées séparément avant fusion ;
- citations filtrées une seconde fois après fusion.

## 20. Résilience et concurrence

- Une capture acquittée est persistée avant réponse.
- La file offline garde l'ordre causal dans une session, sans bloquer les autres projets.
- La déduplication est globale sur l'identité d'événement mais vérifie aussi le scope.
- Le démarrage concurrent d'un contexte est single-flight.
- L'initialisation Hindsight est single-flight par banque.
- L'éviction attend ou repersiste les tâches en cours.
- Un workspace défaillant ne met pas les autres contextes en panne.
- Le contexte propriétaire dégradé n'autorise jamais un élargissement vers d'autres projets.
- Sans owner recall, le projet continue en mode projet seul avec statut explicite.
- Sans projet résolu, le MCP et les hooks échouent fermés pour le recall/capture.
- Un import annulé s'arrête à un checkpoint cohérent et peut être repris ou abandonné.

## 21. Observabilité et SLO

### 21.1 Métriques

- `runtime_context_active_total`
- `runtime_context_cold_start_seconds`
- `runtime_context_eviction_total`
- `scope_resolution_total{result}`
- `scope_mismatch_total`
- `checkout_auth_total{result}`
- `project_capture_latency_seconds`
- `project_recall_latency_seconds{layer}`
- `history_sessions_total{status}`
- `history_events_imported_total`
- `history_dedupe_total{adapter_pair}`
- `plugin_status{surface,state}`
- `hindsight_bank_state{workspace}` avec identifiants hashés dans les exports
- `canonical_worker_backlog{workspace}` avec labels bornés ou hashés

### 21.2 Cibles initiales

- fuite cross-project : exactement zéro ;
- résolution d'un scope chaud p95 < 50 ms ;
- démarrage d'un contexte froid p95 < 2 s ;
- recall chaud du projet p95 < 250 ms hors LLM ;
- ACK capture p95 < 250 ms lorsque Z2 est joignable ;
- `SessionStart` complet p95 < 750 ms avec contexte chaud ;
- plan d'enrôlement < 2 s ;
- application d'enrôlement < 5 s hors approbation humaine Codex ;
- import >= 1 000 événements/minute hors compilation LLM ;
- reprise après redémarrage sans duplication ;
- aucune croissance non bornée du nombre de contextes actifs.

## 22. Plan d'implémentation

### Lot 0 — Contrats rouges et fixtures

- Écrire les schemas v6, enrollment, credential record, runtime status et import.
- Ajouter les fixtures de deux projets, deux worktrees et plusieurs formats d'historique.
- Ajouter le vérificateur `verify-memory-fabric-v23` avant l'implémentation.

### Lot 1 — Identité propriétaire et enrôlement

- Étendre le registre canonique.
- Ajouter le credential store hashé.
- Implémenter plan/apply/receipt/rotate/revoke.
- Préserver les marqueurs existants et les migrations de checkout.

### Lot 2 — Superviseur multi-projet

- Extraire la construction actuelle de `supermemoryd` dans un context factory.
- Implémenter le cache borné, single-flight, éviction et health.
- Brancher les workers multi-workspace et la récupération après restart.

### Lot 3 — Recall owner + projet

- Créer le workspace propriétaire.
- Ajouter la politique de promotion `project_to_owner`.
- Exécuter les recalls séparément et fusionner sous budget.
- Vérifier citations, fraîcheur, autorité et absence de traversée inter-projet.

### Lot 4 — Client Mac universel et plugin Codex

- Installer des launchers stables sous `~/.supermemory/client`.
- Détecter la version et les capacités Codex actuelles.
- Enregistrer le marketplace et installer le plugin.
- Résoudre le projet depuis `cwd` pour hooks et MCP.
- Produire un diagnostic clair de confiance et de nouvelle session requise.

### Lot 5 — Capture multi-projet E2E

- Lier session, checkout et working set.
- Partitionner la file offline.
- Couvrir worktrees, resume, compaction et session end.
- Vérifier la déduplication App Server/hooks.

### Lot 6 — Import historique

- Implémenter discovery et lecteurs versionnés.
- Construire le plan avec redaction et mappings.
- Ajouter apply, checkpoint, cancel, resume et déduplication.
- Garder le backfill sous politique d'autorité.

### Lot 7 — Interface projet et sessions

- Ajouter routes Web proxy et sélecteur de projet.
- Ajouter pages projets, sessions, import et diagnostics.
- Vérifier qu'aucun token n'atteint le navigateur.

### Lot 8 — Migration, production et release

- Migrer v5 vers v6 sans réécriture du vault.
- Mettre à jour Compose/Portainer, doctor et runbooks.
- Exécuter la matrice complète, le smoke réel Codex et le test de restauration.
- Déployer directement sur Z2, puis enrôler les projets approuvés.

## 23. Critères d'acceptation

### AC-01 — Isolation de deux projets

Deux projets de même nom mais de racines différentes sont enrôlés séparément. Une session du
projet A ne peut ni rappeler, ni citer, ni déduire l'existence d'une mémoire du projet B.

### AC-02 — Mémoire personnelle contrôlée

Une préférence explicitement globale est rappelée dans A et B. Une décision de code de A ne
l'est jamais dans B. Chaque résultat global porte une citation `scope=owner`.

### AC-03 — Worktrees

Deux worktrees liés partagent la mémoire durable du projet, tout en conservant des checkouts,
sessions et working sets distincts.

### AC-04 — Auth checkout

Un credential copié, révoqué, associé au mauvais device ou présenté avec un mauvais binding
échoue en `not_authorized` sans révéler quel champ diverge.

### AC-05 — MCP borné

Aucun outil MCP ne possède de paramètre de scope ou de changement de projet. Un appel sans
`working_set_id` là où il est requis reste rejeté.

### AC-06 — Capture future

Après installation du plugin, approbation des hooks et ouverture d'une nouvelle session Codex,
le flux `SessionStart -> prompt -> tool -> compact/stop -> SessionEnd` apparaît dans le projet
correct et produit un recall cité.

### AC-07 — Plugin réel

`codex plugin list` montre `supermemory@supermemory-local` à la version attendue. Le diagnostic
distingue installé, hooks à approuver, nouvelle session requise et actif.

### AC-08 — Import idempotent

Le même plan historique appliqué deux fois ne crée aucun épisode ni souvenir supplémentaire.
Une interruption reprend au checkpoint exact.

### AC-09 — Déduplication croisée

Un événement présent à la fois dans l'historique Codex et dans la capture hook/App Server ne
produit qu'un épisode canonique, avec plusieurs provenances.

### AC-10 — Format inconnu

Un format de session Codex inconnu est signalé, ignoré et ne provoque aucune mutation du
stockage source ou du vault.

### AC-11 — Offline multi-projet

Des captures A et B mises en file hors ligne sont chiffrées, drainées sans mélange et gardent
l'ordre causal de chaque session.

### AC-12 — Hindsight et graphe

Chaque workspace utilise sa banque Hindsight déterministe. GraphD rejette les bearers d'un autre
workspace et aucun chemin Neo4j ne traverse les scopes.

### AC-13 — Charge bornée

Avec 10 projets et 50 sessions simulées, le nombre de contextes, workers et compilations reste
dans les limites v6 et aucun projet n'affame durablement les autres.

### AC-14 — Redémarrage Z2

Après redémarrage de la stack, le registre, les credentials, les checkpoints, les workers et
les mappings de working sets sont récupérés sans duplication.

### AC-15 — Interface Web

Le changement de projet actualise toutes les vues. Modifier l'URL ou un payload ne permet pas
d'accéder au contenu d'un autre projet. Les credentials ne sont jamais exposés au navigateur.

### AC-16 — Production directe

Le runtime final expose `canary=false`, `progressive=false`, `activation=enabled`. Le smoke du
projet initial et le test d'isolation passent après déploiement ; sinon le rollback restaure v5.

## 24. Stratégie de test

### 24.1 Nouveaux tests unitaires

- `workspace-runtime-supervisor.test.mjs`
- `checkout-credential-store.test.mjs`
- `request-scope-resolver.test.mjs`
- `project-enrollment.test.mjs`
- `codex-client-launcher.test.mjs`
- `codex-capability-probe.test.mjs`
- `codex-history-discovery.test.mjs`
- `codex-history-readers.test.mjs`
- `codex-history-import.test.mjs`
- `owner-project-recall.test.mjs`

### 24.2 Tests d'intégration

- daemon multi-projet concurrent ;
- Hindsight multi-bank ;
- GraphD workspace isolation ;
- capture hooks multi-checkout ;
- file offline multi-projet ;
- import puis capture live équivalente ;
- plugin marketplace/install/upgrade dans un `CODEX_HOME` isolé ;
- Web selector et auth proxy ;
- migration v5 vers v6 puis rollback.

### 24.3 E2E réels obligatoires

1. Installer le plugin dans Codex réellement utilisé sur le Mac.
2. Approuver les hooks par le parcours normal Codex.
3. Ouvrir une nouvelle session dans deux projets enrôlés.
4. Vérifier capture et recall sans fuite.
5. Importer un petit lot de sessions historiques prévisualisé.
6. Relancer le même import et prouver l'idempotence.
7. Redémarrer Z2 et reprendre une session.
8. Vérifier visuellement l'interface avec Playwright.

### 24.4 Régressions obligatoires

- `npm test`
- `npm run verify`
- `npm run verify:release`
- `npm run verify:production`
- `npm run verify:memory-fabric-v2`
- `npm run verify:memory-fabric-v22`
- `npm run verify:hindsight-native`
- `npm run verify:secrets`
- nouveau `npm run verify:memory-fabric-v23`

## 25. Definition of Done

La tranche est terminée uniquement lorsque :

- le daemon n'est plus lié à un projet unique au démarrage ;
- le projet SuperMemory existant est migré sans perte ;
- au moins deux autres projets réels sont enrôlables par plan/apply ;
- la mémoire personnelle et l'isolation projet sont démontrées ;
- le plugin est réellement installé et visible dans Codex ;
- les hooks ont été approuvés par l'utilisateur et testés dans une nouvelle session ;
- les nouvelles sessions sont capturées automatiquement ;
- l'import historique est prévisualisé, idempotent, reprenable et fail-closed ;
- l'interface permet de visualiser les mémoires par projet depuis le Mac ;
- toutes les suites listées sont vertes ;
- le backup et le rollback sont testés ;
- la stack Z2 est déployée en activation intégrale ;
- les runbooks correspondent exactement aux commandes livrées ;
- aucun secret, transcript brut ou donnée live sensible n'est commité.

## 26. Risques résiduels

### Évolution des formats Codex

Les formats locaux de session peuvent changer. La réponse est un registre de lecteurs
versionnés, des fixtures anonymisées et un refus explicite des versions inconnues.

### Confiance des hooks

Codex peut redemander une approbation après modification du plugin. Ce comportement est voulu.
Le produit doit l'expliquer et le diagnostiquer, pas le contourner.

### Sur-promotion vers la mémoire personnelle

C'est le risque sémantique principal. La promotion globale doit être plus stricte que
l'admission projet, réversible, citée et visible dans l'audit.

### Cardinalité de l'observabilité

Les métriques par workspace peuvent exploser. Les dashboards utilisent des identifiants hashés
ou des agrégats, et limitent les labels aux contextes actifs.

### Latence de contexte froid

La première session d'un projet inactif peut être plus lente. Le budget de démarrage et le
préchargement du projet sélectionné dans l'UI limitent cet effet sans garder tous les contextes
en mémoire.

## 27. Décision finale

La prochaine tranche doit être implémentée comme **Memory Fabric v2.3 — Multi-Project Codex &
Session Sync**.

Elle ne remplace pas Hindsight et ne duplique pas la stack. Elle termine la couche produit qui
manque aujourd'hui : identité multi-projet, isolation utilisable, héritage personnel contrôlé,
client Codex réellement installable et import gouverné de l'historique.

L'ordre recommandé est strict : contrats et isolation, superviseur, owner recall, client/plugin,
capture future, import historique, UI, puis migration directe en production. L'import ne doit
pas être construit avant que le binding serveur et les tests de non-fuite soient verts.
