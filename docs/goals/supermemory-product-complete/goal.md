# SuperMemory Product Complete

## Objective

Livrer SuperMemory comme une application web locale mono-utilisateur, utilisable sans terminal, qui transforme un dossier de documents locaux en mémoire gouvernée, recherchable et citée.

L’exécution est continue : auditer l’existant, choisir le plus grand lot vertical sûr, l’implémenter, le vérifier, puis avancer jusqu’à ce que le parcours produit complet soit réellement démontré.

## Original Request

« J’aimerais que notre outil soit fini à 100 %. »

## Intake Summary

- Input shape: `vague`, précisé par diagnostic
- Audience: utilisateur local non technique
- Authority: `approved`
- Proof type: `demo` + `test`
- Completion proof: un utilisateur réalise le parcours complet sur de vrais PDF, DOCX, Markdown et fichiers texte, puis retrouve le même état après redémarrage ; les tests de régression et les contrôles de release sont verts
- Goal oracle: démonstration enregistrée du parcours réel complet avec preuves de source et de persistance
- Likely misfire: déclarer le produit fini parce que des scripts backend et des tests unitaires passent alors qu’aucun workflow web cohérent n’existe
- Blind spots considered: extraction documentaire, compilation sémantique, validation humaine, citations, rafraîchissement, suppression, reprise sur erreur, redémarrage, confidentialité locale, packaging et expérience non technique
- Existing plan facts:
  - conserver l’architecture local-first approuvée et le vault canonique local
  - conserver Hindsight comme projection de rappel dérivée, jamais comme source de vérité
  - exiger une validation humaine avant promotion des mémoires
  - exclure de cette version le SaaS, le paiement, le multitenant et les connecteurs distants
  - utiliser un parcours sur de vrais documents comme preuve finale

## Product Workflow

Le produit final doit présenter un seul parcours compréhensible :

1. L’utilisateur ouvre SuperMemory localement.
2. Il choisit un dossier et voit clairement les formats pris en charge, les exclusions et les alertes de confidentialité.
3. SuperMemory inventorie, extrait et analyse les documents sans envoyer leur contenu vers un service non autorisé.
4. L’application produit des mémoires candidates reliées à leurs fichiers, pages ou sections d’origine.
5. L’utilisateur examine, corrige, accepte ou refuse ces candidates.
6. Les mémoires approuvées sont enregistrées dans le vault canonique puis projetées vers Hindsight.
7. L’utilisateur recherche ou pose une question et reçoit une réponse fondée, accompagnée de citations ouvrables.
8. Un fichier modifié, ajouté ou supprimé est détecté et traité sans doublons ni références obsolètes.
9. Une suppression retire la donnée du vault et de la projection de rappel conformément à la politique locale.
10. Après redémarrage, l’état, la provenance, les validations et la recherche restent cohérents.

## Goal Oracle

The oracle for this goal is:

`Une démonstration locale, reproductible et enregistrée prouve le parcours dossier → extraction → mémoires candidates → validation → Hindsight → recherche citée → actualisation/suppression → redémarrage, sur de vrais PDF, DOCX, Markdown et TXT, avec tous les contrôles automatisés applicables au vert.`

La preuve finale doit inclure :

- un démarrage depuis une installation documentée et un environnement propre ;
- un parcours effectué depuis l’interface web, sans commande métier dans le terminal ;
- au moins un document de chaque format annoncé ;
- une citation exacte et ouvrable vers la source de chaque réponse démontrée ;
- une correction ou un refus dans la file de validation ;
- une modification de document reflétée sans doublon ;
- une suppression reflétée dans le vault et Hindsight ;
- un redémarrage avec persistance vérifiée ;
- un cas d’erreur récupérable et compréhensible ;
- les commandes `npm test`, `npm run verify`, `npm run verify:release`, `npm run verify:runtime`, `npm run verify:production` et `npm run verify:secrets`, ou une justification explicite et auditée lorsqu’une commande n’est pas applicable.

Le PM doit comparer chaque reçu de tâche à cet oracle. Un plan, un audit, une architecture convaincante ou un petit test vert ne suffisent pas. La fin exige un audit final enregistrant `full_outcome_complete: true`.

## Goal Kind

`open_ended`

## Current Tranche

Compléter successivement les plus grands lots verticaux sûrs jusqu’à couvrir l’intégralité du workflow produit et de son oracle. Le premier lot actif est un audit en lecture seule de la réalité du dépôt. Il doit distinguer le runtime réellement utilisable, les contrats et preuves historiques, puis proposer le premier lot utilisateur vertical.

## Non-Negotiable Constraints

- Le produit reste local-first et mono-utilisateur.
- Le vault local est la source canonique ; Hindsight est une projection reconstruisible.
- Aucune donnée documentaire ne quitte la machine sans autorisation explicite et visible.
- Les secrets et fichiers exclus ne doivent jamais être capturés silencieusement.
- Toute mémoire promue conserve une provenance vérifiable jusqu’au fichier, à la page ou à la section.
- L’utilisateur garde le contrôle de la validation, de la correction et de la suppression.
- Le workflow principal doit être utilisable sans terminal.
- Les changements doivent préserver les preuves runtime et contrats existants, sauf décision auditée.
- SaaS, paiement, multitenant et connecteurs Gmail/Drive/web restent hors périmètre.
- Une fonctionnalité annoncée doit être démontrée ; sinon elle doit être retirée de la promesse produit.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection while a safe Worker task can advance the working product.

Do not stop after a single verified Worker package when the broader oracle remains incomplete. Advance immediately to the next highest-leverage safe vertical slice unless a risk, ambiguity, rejected verification, phase boundary, or final review requires Judge intervention.

If credentials, optional models, production access or owner decisions block one slice, record that exact blocker and continue every local, non-destructive slice that still advances the goal.

## Slice Sizing

Safe means bounded, explicit, verified and reversible; it does not mean tiny.

Prefer complete vertical capabilities visible in the product, such as « choisir un dossier et obtenir des candidates citées », over isolated helpers, schemas or wrappers. A Worker finishes the whole assigned slice. A Judge reviews at risk, phase and final boundaries rather than after every small edit.

## Canonical Board

Machine truth lives at:

`docs/goals/supermemory-product-complete/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness and completion truth.

## Run Command

```text
/goal Follow docs/goals/supermemory-product-complete/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`.
3. Re-check the original outcome, oracle, non-goals and likely misfire.
4. Work only on the active task.
5. Record a durable receipt and update the board.
6. Choose the next largest safe vertical slice and continue while the oracle remains incomplete.
7. Finish only through a Judge or PM audit mapping runtime evidence and receipts to every oracle item.
