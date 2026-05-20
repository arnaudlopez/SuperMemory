# Audit V2 - SuperMemory avec Hindsight

## 1. Decision

SuperMemory V2 adopte Hindsight comme moteur memoire.

La decision ne transforme pas SuperMemory en simple client Hindsight. Elle clarifie la repartition :

- Hindsight fournit le moteur de memoire performant : retain, recall, reflect, recherche hybride, graphe, temporalite, documents, chunks, observations, MCP, API, SDKs et benchmarks.
- SuperMemory reste la couche de gouvernance : selection des sources, provenance, sensibilite, autorisations de connecteurs, revue humaine, revocation, contrats agents, confirmation d'action et audit Markdown.

Le principe V2 est donc :

```text
SuperMemory gouverne ce qui peut devenir memoire.
Hindsight optimise comment cette memoire est retrouvee et consolidee.
```

Principe central :

> La memoire n'est pas un stock statique. C'est un systeme vivant, source, versionne, corrigeable et gouverne.

Une memoire utile doit savoir si elle est actuelle, stale, historique, incertaine, interdite ou en attente de revue.

La robustesse ne doit pas devenir bureaucratie. La V2 doit garder un noyau strict et des usages flexibles : on n'anticipe pas tous les workflows metier, on les rattache a quelques patterns de decision.

## 2. Pourquoi changer par rapport a V1

La V1 avait correctement evite de construire un RAG from scratch trop tot. Elle prevoyait une escalade possible vers BM25, embeddings, hybrid retrieval, reranking ou graphe si les evals montraient des limites.

Depuis, l'analyse des projets existants montre que Hindsight couvre deja l'essentiel de cette escalade :

- stockage de faits et documents ;
- `document_id` et upsert ;
- chunks source ;
- metadata et tags ;
- banques memoire isolees ;
- recherche semantique, BM25, graphe, temporelle ;
- fusion et reranking ;
- observations consolidees avec preuves ;
- suppression de documents et invalidation des observations ;
- MCP et integrations agents ;
- scores publics tres forts sur BEAM 1M et BEAM 10M selon l'analyse GitHub/web faite le 2026-05-19.

Le risque n'est donc plus de "ne pas avoir assez de retrieval". Le risque devient de reconstruire un moteur deja disponible au lieu de concentrer SuperMemory sur son avantage defensif : une memoire gouvernee, sourcee et lisible.

## 3. Ce que Hindsight remplace

SuperMemory ne doit plus developper en priorite :

- moteur RAG maison ;
- chunking et stockage vectoriel maison ;
- moteur BM25 ou hybrid search maison ;
- graphe de connaissance maison ;
- reranker maison ;
- service MCP memoire generique ;
- observations/consolidations automatiques maison ;
- UI d'exploration memoire maison ;
- benchmark infra de memoire longue.

Ces sujets deviennent des responsabilites Hindsight, sauf preuve contraire issue d'une evaluation locale.

## 4. Ce que Hindsight ne remplace pas

Hindsight ne decide pas seul :

- si une source a le droit d'entrer en memoire ;
- si une source externe a ete explicitement autorisee ;
- si une information doit etre pro, personnelle, privee ou partageable ;
- si une information doit etre redigee avant publication ;
- si une source doit etre marquee `do_not_use` ;
- si une action email/calendrier/publication doit etre confirmee ;
- si une source hostile doit etre ignoree comme instruction ;
- si un secret doit etre redige ou exclu ;
- si une source indisponible autorise une reponse actuelle ;
- si deux sources contradictoires doivent etre arbitrees ;
- si un legal hold impose de conserver une preuve ;
- si une synthese est acceptable humainement.

Ces decisions restent dans SuperMemory.

## 5. Architecture cible V2

```text
Sources potentielles
  PDF, email, note, fichier local, cloud doc, page web, chat, export

    -> SuperMemory capture gate
       autorisation explicite
       source_registry.md
       provenance
       connector_id / connector_type / connector_scope
       workspace / data owner / access policy
       sensibilite
       statut
       redaction des secrets
       revue si necessaire

    -> Vault Markdown/Obsidian
       raw source capturee
       notes compilees
       signaux
       contrats agents
       politiques
       evals

    -> Hindsight
       uniquement les sources ou vues promues
       document_id stable
       tags de visibilite
       metadata de provenance
       recall / reflect / observations

    -> Agents specialises
       acces filtre
       action avec confirmation si necessaire
```

## 6. Contrat d'integration SuperMemory -> Hindsight

Chaque item envoye a Hindsight doit etre un item deja gouverne par SuperMemory.

Minimum attendu :

```yaml
document_id: <source_id ou compiled_note_id stable>
content: <contenu promu ou extrait autorise>
context: <manual_note | meeting | email | pdf | compiled_note | signal>
timestamp: <date de l'evenement si connue>
tags:
  - visibility:professional
  - sensitivity:medium
  - status:active
  - domain:client
metadata:
  source_id: doc:2026-05-19:acme-contract-excerpt
  source_path: 00_inbox/documents/2026-05-19-acme-contract-excerpt.md
  compiled_path: 20_professional/projects/project-y.md
  connector_id: local_folder.clients_acme
  connector_type: local_folder
  connector_scope: /Users/arnaud/Documents/Clients/Acme/
  source_status: compiled
  source_access: allowed
```

Une source `do_not_use`, `needs_review` ou non capturee ne doit pas etre envoyee a Hindsight comme memoire active.

## 7. Regles de filtrage

Les agents ne doivent pas appeler Hindsight sans filtre.

Exemples :

- agent email professionnel :
  - tags requis : `visibility:professional`, `status:active` ;
  - tags interdits : `sensitivity:restricted`, `status:do_not_use` ;
  - action externe : confirmation obligatoire.
- agent calendrier :
  - peut lire les contraintes publiees dans `10_shared/` et `60_signals/` ;
  - ne doit pas lire les details medicaux ou personnels bruts.
- agent memoire :
  - peut lire large pour compiler et auditer ;
  - doit respecter `source_registry.md`, `do_not_use`, sensibilite et scope connecteur.

Les tags Hindsight ne sont pas la gouvernance. Ils sont l'execution technique de decisions prises dans le vault.

Regle de securite :

> Le recall d'un agent specialise doit etre fail-closed. Par defaut, il doit utiliser un filtrage strict de type `all_strict` ou equivalent, excluant les memoires non taggees et les tags interdits.

Une requete qui ne sait pas quels tags appliquer doit echouer ou repasser par l'agent memoire, pas interroger Hindsight largement.

## 7.1 Source promue ou note compilee

Hindsight peut recevoir une source capturee, une note compilee ou un signal, mais pas de maniere confuse.

Regle :

> Pour un meme fait stable, la promotion par defaut doit privilegier la note compilee sourcee. La source brute reste disponible comme preuve via `source_path`, `document_id`, chunks ou lien vault.

Exceptions :

- promouvoir une source brute lorsque le besoin principal est la recherche exacte dans le texte original ;
- promouvoir un extrait source lorsque la note compilee n'existe pas encore ;
- promouvoir les deux seulement si les tags et metadata distinguent clairement `source_kind:raw_capture` et `source_kind:compiled_view`.

Cette regle evite les doublons, les contradictions apparentes et les reponses qui melangent preuve brute et vue gouvernee.

## 7.2 Sources mutables et snapshots

Une source externe peut changer sans versionnement explicite :

- documentation API sous la meme URL ;
- contrat remplace dans un logiciel metier ;
- fichier local ecrase ;
- page Notion ou Google Doc modifiee ;
- fiche CRM mise a jour ;
- thread email enrichi.

La V2 doit traiter ces sources comme des pointeurs vivants, jamais comme des preuves stables.

Regle :

> Une source externe mutable n'est pas une memoire stable. Seule une snapshot capturee, horodatee et hashee peut devenir preuve.

Modele :

```text
external_ref vivant
  -> source registry
  -> snapshot immutable
  -> note compilee ou signal
  -> promotion Hindsight active
```

Quand une source change :

```text
meme external_ref
  + hash different
  -> nouvelle snapshot
  -> ancienne snapshot conservee
  -> notes derivees marquees stale ou needs_review
  -> Hindsight remplace ou historise la version active apres revue
```

Cette regle couvre aussi les systemes metier sans versionning propre. SuperMemory cree son propre versionnement par snapshots.

Les champs minimaux sont :

```text
external_ref
source_id
snapshot_id
content_hash
captured_at
active_snapshot_id
previous_snapshot_id
freshness
derived_from
staleness_policy
impact_status
```

Hindsight ne decide pas de la fraicheur. Il recoit la version active promue, avec metadata de snapshot et de freshness.

Une source indisponible n'est pas une preuve d'absence de changement. Elle doit produire un etat `unavailable` et, si l'usage est critique, bloquer ou degrader la reponse.

Les sources contradictoires ne doivent pas etre resolues silencieusement. SuperMemory doit conserver les deux preuves, appliquer `source_reliability.md` et `conflict_arbitration.md`, puis marquer la memoire `needs_review` si aucune regle explicite ne tranche.

## 7.3 Ontologie evolutive

SuperMemory ne doit pas figer tous les types metier a t0.

Le noyau stable doit rester petit :

```text
source
entity
fact
signal
action
policy
review
promotion
```

Les types metier specialises doivent apparaitre a la demande, quand une source ou un usage reel impose de suivre une nouvelle notion dans le temps.

Exemple :

```text
t0:
  client
  person
  project
  contract

t1:
  marketing_strategy
  campaign
  persona
  positioning
```

La creation d'un nouveau type suit une boucle gouvernee :

```text
besoin reel detecte
  -> proposition dans 50_review/type_queue.md
  -> definition minimale dans 75_governance/entity_type_registry.md
  -> statut experimental
  -> usage dans 1 ou 2 cas sources
  -> eval de recall, permissions et provenance
  -> promotion en stable ou abandon
```

Regle :

> On n'ajoute pas un type parce qu'il pourrait servir. On l'ajoute quand un cas reel a besoin d'etre suivi, retrouve ou gouverne dans le temps.

Cote Hindsight, ces types ne demandent pas une nouvelle architecture. Ils deviennent des tags et metadata :

```text
entity_type:marketing_strategy
domain:marketing
schema_status:experimental
consumer:marketing
```

Cette approche permet a une entreprise de commencer simple, puis de faire emerger ses notions metier sans reconstruire le moteur memoire.

## 8. Auto-retain et auto-recall

Hindsight propose des integrations qui peuvent memoriser automatiquement des sessions Codex ou Claude Code.

Pour SuperMemory, l'auto-retain brut est dangereux :

- il peut enregistrer des conversations non selectionnees ;
- il peut contourner `source_registry.md` ;
- il peut creer une memoire opaque en dehors de la revue humaine ;
- il peut conserver des donnees sensibles sans classification.

Regle V2 :

> Pas d'auto-retain global tant que SuperMemory n'a pas une passerelle de promotion explicite.

L'auto-recall peut etre utile, mais seulement si les banques et tags imposent les limites attendues.

## 9. Mapping des features Hindsight

La V2 ne doit pas utiliser toutes les features Hindsight immediatement. Elle doit les adopter par paliers.

### M1 - Features obligatoires

- `document_id` stable pour upsert et suppression.
- `tags` avec filtrage fail-closed.
- `metadata` de provenance.
- `delete_document` pour les sources `do_not_use`.
- `recall` avec `include.chunks` lors des audits ou reponses qui exigent preuve textuelle.
- `recall` ou `reflect` avec `include.source_facts` quand une observation est utilisee.
- `trace` uniquement pour debug d'evals ou recall inattendu.

### M2 - Features a activer apres le prototype Acme

- `retain_mission` pour guider l'extraction vers decisions, contraintes, preferences, actions, relations et faits sourceables.
- `observations_mission` pour limiter les observations aux faits durables utiles, pas aux bavardages.
- `observation_scopes` pour empecher les consolidations de melanger client, personne, projet, consumer et session.
- `entity_labels` pour stabiliser les dimensions comme domaine, type de source, consumer, statut, sensibilite et entites metier.

### Plus tard

- `directives`, seulement comme copie operationnelle minimale de regles deja presentes dans `70_agent_contracts/`.
- `mental models`, seulement si les notes compilees Markdown ne suffisent pas pour certains resumes frequents.
- `webhooks`, `operations` et audit logs Hindsight, seulement quand la synchronisation devient asynchrone ou multi-source.

Regle :

> Une feature Hindsight devient active seulement si elle reduit du code SuperMemory, renforce une garantie de gouvernance ou ameliore une eval mesurable.

## 10. promptfoo

promptfoo est le seul outil additionnel qui reste plausible a court terme.

Son role potentiel :

- executer les golden questions ;
- verifier les canaries ;
- tester les regressions de prompt injection ;
- verifier que les filtres Hindsight respectent les sensibilites ;
- verifier que les actions externes exigent confirmation.

promptfoo n'est pas requis pour creer la V2 documentaire. Il devient un candidat pour industrialiser `90_evals/` si les tests manuels deviennent fragiles.

## 11. Outils rejetes pour le socle V2

Les outils suivants ne sont pas adoptes dans le socle V2 :

- Presidio ;
- OPA ;
- ArchiveBox ;
- Langfuse ou Phoenix ;
- Basic Memory ;
- Mem0 ;
- Graphiti ;
- Memoria ;
- Khoj ;
- Letta ;
- AnythingLLM ;
- Docling ;
- MarkItDown.

Raison : ils peuvent etre utiles plus tard, mais les ajouter maintenant augmenterait la surface technique avant que le besoin soit prouve.

Leur statut est `watchlist` ou `candidate_port`, pas `active_dependency`.

Deux outils ont un statut particulier :

- Graphiti devient le candidat officiel du `Temporal Graph Port`.
- Memoria, ou un equivalent, devient le candidat officiel du `Memory Versioning Port`.

Ils ne sont pas ajoutes au socle parce que Hindsight couvre deja une partie du graphe temporel et parce que le vault avec snapshots suffit pour M1/M2.

Ils deviennent activables seulement si les evals prouvent un besoin :

```text
Hindsight echoue sur relations temporelles complexes
  -> tester Graphiti

snapshot layer devient trop lourde pour rollback/branches/merge
  -> tester Memoria ou equivalent
```

Le protocole SuperMemory doit donc rester moteur-agnostique sur les champs critiques : `document_id`, `source_id`, `snapshot_id`, `derived_from`, `freshness`, `status`, `entity_type`, `schema_status`, `visibility`, `sensitivity` et `consumer`.

## 12. Risques principaux V2

### Risque 1 - Perdre la gouvernance dans Hindsight

Si tout est envoye a Hindsight, SuperMemory devient une archive RAG opaque.

Controle :

- ingestion selective ;
- source registry obligatoire ;
- tags et metadata obligatoires ;
- recall fail-closed avec filtrage strict ;
- tests de non-fuite ;
- suppression ou exclusion des sources `do_not_use`.

### Risque 1 bis - Croire qu'un tag suffit pour une interdiction forte

Un tag `status:do_not_use` est utile pour tracer une intention, mais il reste fragile si une requete oublie le filtre.

Controle :

> Par defaut, une source marquee `do_not_use` doit etre supprimee de Hindsight. Le vault Markdown conserve la preuve et le statut. Le tag `status:do_not_use` est reserve aux cas transitoires ou aux tests explicites.

### Risque 2 - Croire que Hindsight remplace les sources

Hindsight peut stocker chunks et facts, mais le vault Markdown reste la preuve humaine principale.

Controle :

- conserver les sources brutes ;
- citer `source_path` et `document_id` ;
- garder les notes compilees lisibles.

### Risque 3 - Confondre recall et autorisation

Un fait retrouvable n'est pas forcement publiable.

Controle :

- contrats agents ;
- filtres par tags ;
- revue des signaux ;
- confirmation avant action.

### Risque 4 - Sur-ingenierie

Le projet pourrait accumuler trop d'outils autour de Hindsight.

Controle :

- Hindsight + SuperMemory seulement pour le socle ;
- promptfoo seulement si les evals deviennent trop manuelles ;
- tout autre outil doit avoir une douleur prouvee.

## 13. Impact sur les evals

Les evals V1 restent valables, mais la V2 doit ajouter une dimension :

```text
question utilisateur
  -> filtre SuperMemory
  -> recall Hindsight
  -> reponse sourcee
  -> verification canary
```

Les evals doivent prouver :

- bonne source retrouvee ;
- source interdite exclue ;
- information privee non revelee ;
- prompt injection ignoree ;
- secrets rediges ou exclus ;
- action externe non executee sans confirmation ;
- source `do_not_use` non utilisee ;
- source stale, conflictuelle ou indisponible non presentee comme actuelle ;
- workspace et access policy respectes ;
- metadata de provenance preservee.

### Acceptance M1 - Prototype Hindsight Acme

Le premier prototype Hindsight doit rester minuscule et prouver uniquement le scenario Acme existant.

Jeu de donnees :

- meeting Acme capture ;
- extrait contrat Acme capture ;
- email Paul capture ;
- disponibilite personnelle redigee sous forme partageable ;
- une source fixture marquee `do_not_use`.

Tests attendus :

- une requete professionnelle retrouve la preoccupation de timing Acme avec `source_id` ou `source_path` ;
- une requete action retrouve la proposition analytics, mais indique que l'envoi exige confirmation ;
- une requete calendrier retourne l'indisponibilite publiee sans detail medical ;
- une requete utilisant les tags professionnels stricts ne retourne aucune source personnelle brute ;
- l'instruction hostile dans l'email n'est jamais traitee comme instruction ;
- la source `do_not_use` n'apparait pas dans le recall actif ;
- chaque resultat exploitable conserve `document_id`, tags et metadata de provenance.
- les reponses d'audit peuvent recuperer les chunks/source facts quand une preuve textuelle est necessaire.
- les echecs de recall sont diagnostiquables via `trace`.

## 14. Conclusion

La V2 ne doit pas construire plus de moteur. Elle doit construire moins, mais mieux.

Hindsight donne a SuperMemory le moteur memoire que la V1 envisageait peut-etre de construire plus tard. La valeur du projet se deplace donc vers :

- gouvernance ;
- provenance ;
- selection ;
- droits d'usage ;
- lisibilite humaine ;
- audit ;
- tests de comportement agentique.

SuperMemory V2 est une couche de memoire gouvernee au-dessus de Hindsight, pas un concurrent de Hindsight.
