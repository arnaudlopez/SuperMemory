# Documentation - Memoire agentique

Ce dossier contient la base de travail pour le systeme de memoire personnelle et professionnelle.

## Lecture recommandee

1. `hindsight-native-memory-plane-blueprint.md`
   - Blueprint produit/tech de la tranche Memory Fabric v2.1.
   - Retrait immediat de Graphiti et `supermemory-improved`.
   - Hindsight natif pour observations, operations, recall enrichi et Reflect.
   - Neo4j/GraphD conserve comme graphe temporel exact.
   - Procedure executable :
     [`hindsight-native-migration-runbook.md`](hindsight-native-migration-runbook.md).
   - Etat de livraison :
     [`hindsight-native-release-receipt.md`](hindsight-native-release-receipt.md).

2. `codex-supermemory-technical-design.md`
   - Conception normative de l'integration Codex Desktop, CLI et IDE.
   - Identite stable des projets, capture App Server/hooks et versioning.
   - Recall MCP gouverne, securite, migration, deploiement et acceptation.

3. `audit-memoire-agentique-v2.md`
   - Decision d'adoption de Hindsight.
   - Repartition entre moteur memoire et gouvernance SuperMemory.
   - Features Hindsight a utiliser par phase.

4. `prd-memoire-agentique-v2.md`
   - Plan produit cible avec Hindsight.
   - Contrat de promotion vers Hindsight.
   - Evals et milestones V2.

5. `golden-case-implementation-roadmap.md`
   - Decoupage des tranches d'implementation.
   - Objectifs intermediaires et oracles menant au Golden Case enterprise.
   - Ordre recommande entre contrats, Hindsight, source lifecycle, agents, acces, ports et CI.

6. `golden-case-tdd-matrix.md`
   - Tests rouges precis par tranche.
   - Fixtures, commandes ciblees et criteres de passage.
   - Backlog TDD pour driver le developpement jusqu'au Golden Case.

7. `audit-memoire-agentique.md`
   - Pourquoi cette architecture existe.
   - Decisions critiques.
   - Risques, angles morts, gouvernance et recherche academique.
   - Contexte V1 conserve pour historique.

8. `prd-memoire-agentique.md`
   - Ce que le produit doit faire.
   - Structure cible du vault.
   - Protocoles d'ingestion, navigation, revue, publication, monitoring et multi-agent.
   - Contexte V1 conserve pour historique.

9. `evaluation-comparative-retrieval-rappel.md`
   - Comparaison avec les benchmarks et architectures retrieval/RAG.
   - Estimation de rappel et vitesse.
   - Trajectoire BM25, embeddings, hybrid retrieval, reranking, graph.

## Decision actuelle

Le systeme cible est maintenant :

- SuperMemory comme vault Markdown/Obsidian gouverne ;
- Hindsight comme moteur memoire adopte ;
- Hindsight comme plan derive unique pour facts, observations, recall hybride et Reflect ;
- Neo4j/GraphD comme graphe temporel exact, type et reconstruisible ;
- Graphiti et `supermemory-improved` retires sans fallback runtime ;
- ontologie metier evolutive, creee a la demande ;
- snapshots immuables pour les sources externes ou mutables ;
- memoire vivante : fraicheur, revision, historisation, interdiction ;
- evals simples pour verifier que les deux couches respectent les permissions, la provenance et la qualite de recall.

Architecture de principe :

```text
sources brutes
  -> agent memoire
  -> snapshot immuable si source mutable
  -> notes compilees
  -> gouvernance des types metier
  -> promotion gouvernee vers Hindsight
  -> recall Hindsight filtre
  -> signaux publies
  -> agents specialises
  -> revue humaine
  -> monitoring
  -> gouvernance
```

La source de verite reste le vault Markdown. Hindsight accelere et enrichit le rappel, mais ne decide pas quelles sources sont autorisees.

Les systemes de retrieval maison ne sont plus la trajectoire par defaut. Graphiti n'est plus un port actif : Hindsight porte le plan appris et Neo4j/GraphD porte le graphe exact. Le blueprint normatif de cette bascule est [`hindsight-native-memory-plane-blueprint.md`](hindsight-native-memory-plane-blueprint.md).

## Integration Codex

L'integration Codex relie un projet local a un `project_id` et un
`workspace_id` stables. Les chemins restent de simples aliases : deplacer un
depot, ouvrir plusieurs onglets ou utiliser plusieurs worktrees ne cree pas une
nouvelle memoire logique.

```text
Codex Desktop / CLI / IDE
  | App Server (riche) ou hooks (couverture partielle explicite)
  v
enveloppes d'evenements redactees
  -> journal + spool AEAD par workspace/session
  -> archives de preuves et snapshots immuables
  -> candidats inactifs
  -> approbation ou rejet humain
  -> memoire canonique versionnee dans le vault
  -> projection Hindsight locale et reconstruisible
  -> recall MCP lie au workspace, revalide par le vault, avec citations
```

Les echanges observes ne deviennent jamais automatiquement des souvenirs
actifs. Le pipeline separe quatre niveaux :

| Niveau | Role | Autorite |
| --- | --- | --- |
| Journal chiffre | Rejouer les evenements visibles et dedupliques | Archive seulement |
| Archive de preuves | Conserver les observations et snapshots sources | Non active |
| Candidat | Proposer un fait cite a la revue | Inactif |
| Memoire approuvee | Alimenter le recall apres controles de scope | Vault canonique |

Le serveur MCP de contenu est lance dans le contexte du projet. Il expose un
recall en lecture seule et refuse tout workspace ambigu ou non lie. Le serveur
global est diagnostic uniquement. Hindsight utilise une banque opaque distincte
par workspace et n'est jamais la source de verite : une reponse projetee est
ecartee si le vault ne confirme plus que la memoire est active et autorisee.

La couverture est annoncee sans extrapolation :

- App Server controle : capture riche des objets publics exposes par Codex ;
- hooks du plugin : capture partielle et fail-soft des evenements supportes ;
- nouveau `SessionStart` : injection d'un contexte approuve, cite et borne ;
- client non instrumente, Codex web/cloud ou raisonnement cache : aucune
  promesse de capture.

Les identifiants, archives, spools, tombstones, attestations de suppression et
regles de retention sont scopes par workspace. Les contenus sensibles sont
redactes avant persistance normalisee ; les payloads conserves sont chiffres.
Une suppression retire d'abord l'autorite canonique, puis la projection, avant
la purge physique. Une panne de Hindsight ne reactive donc jamais une memoire.

La specification normative, les limites et les 80 criteres d'acceptation sont
dans [`codex-supermemory-technical-design.md`](codex-supermemory-technical-design.md).
L'exploitation, l'installation reversible et la migration v1 sont decrites
dans [`production-runbook.md`](production-runbook.md#codex-integration).

## V1 minimale

La V1 doit rester simple mais complete sur les garde-fous.

Elle doit inclure :

- Structure du vault.
- `AGENTS.md` ou `CLAUDE.md`.
- `memory_map.md`.
- Inbox brute.
- Notes compilees professionnelles/personnelles.
- Couche `10_shared/`.
- Signaux simples.
- Files de revue.
- Contrats d'agents initiaux.
- Gouvernance documentaire.
- Contrat de promotion Hindsight.
- Log de promotions Hindsight.
- Registre des types metier et file de propositions.
- Registre de snapshots et politique de fraicheur.
- Politique de memoire vivante.
- Politique d'acces et politique de reponse sous incertitude.
- Ports moteurs optionnels.
- Monitoring avec questions de reference.

Elle ne doit pas inclure par defaut :

- RAG maison complet.
- Graphe de connaissance automatise maison.
- Service memoire custom avec API.
- Automatisation externe sans confirmation.
- Auto-retain Hindsight global sans passerelle de promotion.

## Dossiers conceptuels cibles

```text
identity-vault/
  AGENTS.md
  memory_map.md
  00_inbox/
  10_shared/
  20_professional/
  30_personal/
  40_private/
  50_review/
  60_signals/
  70_agent_contracts/
  75_governance/
  80_logs/
  90_evals/
```

## Principes non negociables

- Ne jamais remplacer les sources brutes par des syntheses.
- Ne pas transformer une hypothese en fait stable.
- Ne pas donner aux agents specialises acces a toute la memoire.
- Ne pas publier de detail prive quand un signal minimal suffit.
- Ne pas envoyer une source `do_not_use`, non capturee ou hors scope vers Hindsight.
- Ne pas traiter un pointeur externe mutable comme une preuve stable.
- Ne pas repondre comme si une memoire stale etait actuelle.
- Ne pas interroger Hindsight sans filtres de domaine, sensibilite, statut et consumer.
- Ne pas ajouter RAG, graphe ou service memoire custom sans echec mesure apres Hindsight.
- Ne pas creer de type metier sans source ou workflow reel.
- Ne pas ajouter Graphiti, Memoria ou un autre moteur sans eval rouge ou douleur operationnelle prouvee.
- Garder chaque fait important source, date, contextualise et revisable.

## Questions ouvertes prioritaires

- Quel format exact pour les signaux : Markdown, JSONL ou les deux ?
- Quel format pour les IDs d'entites et de signaux ?
- Quels agents specialises creer en premier ?
- Quel niveau d'automatisation accepter pour calendrier/email ?
- Quelles zones doivent rester locales seulement ?
- Quels seuils de recall/precision declenchent un ajout au-dessus de Hindsight ?
- Quelles evals declenchent le port Graphiti ou le port Memoria ?
- Quels types metier doivent rester experimentaux avant stabilisation ?
- Quelle cadence de refresh appliquer aux sources mutables critiques ?
- Quelle cadence de revue sera realiste au quotidien ?

## Prochaine etape recommandee

Le squelette, les contrats T0-T14 et l'outillage operateur local sont implementes. La prochaine preuve a produire est operationnelle :

1. garder le gate `contract-ready` vert ;
2. lancer un smoke Hindsight reel sur une banque sacrificielle locale ;
3. valider l'evidence recente avec `verify-supermemory-runtime-readiness.mjs` ;
4. prendre ensuite une decision explicite d'approbation production.

Le plan de durcissement execute et l'audit courant sont dans `improvement-plan-and-audit-2026-07-17.md`.

## Verification

```bash
node scripts/verify-supermemory-specs.mjs
node scripts/verify-codex-supermemory-release.mjs --json
```

Le second rapport est un gate de release candidat : il doit couvrir exactement
les 80 contrats `AC-*`, mais reste volontairement `production_ready: false`
tant que la revue finale et les canaries runtime annonces n'ont pas ete
observees. Il ne faut pas transformer une preuve contractuelle CLI en preuve
Desktop ou IDE.

Contrats executables specialises recents :

```bash
node scripts/verify-review-queues-actions.mjs
node scripts/verify-agent-use-patterns.mjs
node scripts/verify-engine-port-evals.mjs
```
