# Audit - Systeme de memoire agentique personnelle et professionnelle

## 1. Contexte

L'objectif discute est de creer une base de connaissance durable qui puisse agir comme une "copie" professionnelle et personnelle d'Arnaud, sans enfermer cette connaissance dans un modele unique ni dans un historique de chat opaque.

Pour l'orientation generale du dossier documentaire, voir `docs/README.md`.

Le systeme vise a permettre a des agents IA de retrouver, utiliser et mettre a jour les informations pertinentes sur Arnaud, ses projets, ses clients, ses preferences, ses contraintes, ses decisions et ses signaux personnels, tout en evitant de charger l'ensemble du contenu brut en contexte.

La question initiale portait sur le meilleur moyen technique :

- Claude Code avec Obsidian.
- Codex avec Obsidian.
- Claude "classique" ou Claude Projects.
- NotebookLM.
- RAG construit from scratch.
- Une combinaison de ces approches.

La conclusion de la discussion est qu'il faut privilegier une memoire lisible, structuree, proprietaire et evolutive, plutot qu'un RAG complet des le depart.

## 2. Recommandation principale

La meilleure approche est :

1. Utiliser un vault Obsidian en Markdown comme source de verite.
2. Utiliser Codex ou Claude Code comme agent de maintenance de la memoire.
3. Organiser la memoire en couches : instructions, index, syntheses, sources brutes.
4. Ajouter une couche de signaux publies pour les agents specialises.
5. Ajouter un RAG seulement plus tard, si le volume ou les besoins de recherche semantique le justifient.

Le principe central est :

> Ne pas mettre "Arnaud" dans un modele. Construire une memoire externe, explicite, sourcee, modifiable et navigable par des agents.

## 3. Pourquoi ne pas commencer par un RAG from scratch

Un RAG peut etre utile, mais il n'est pas le bon premier socle pour ce besoin.

Limites d'un RAG en premiere approche :

- Il retrouve des fragments, mais ne garantit pas une structure de memoire coherente.
- Il peut perdre les relations entre client, projet, personne, decision et action.
- Il demande une couche technique prematuree : ingestion, chunking, embeddings, evaluation, re-indexation.
- Il rend plus difficile la correction manuelle par l'utilisateur.
- Il peut melanger des informations personnelles, professionnelles et sensibles si les permissions ne sont pas bien modelisees.

Le RAG doit etre vu comme une couche d'optimisation future, pas comme la source de verite initiale.

## 4. Pourquoi Obsidian et Markdown

Obsidian et Markdown sont adaptes car ils permettent :

- Des fichiers lisibles par l'humain et par l'agent.
- Une structure durable et portable.
- Des liens explicites entre notes.
- Une navigation par graphe.
- Une separation claire entre source brute, synthese et memoire stable.
- Une compatibilite avec Git, scripts, Codex, Claude Code et d'autres agents.

Le vault devient une base de donnees souple, mais comprehensible.

## 5. Role de Codex et Claude Code

Codex et Claude Code sont pertinents car ils peuvent manipuler directement des fichiers, suivre des conventions et maintenir un projet dans le temps.

Ils peuvent :

- Lire une note brute.
- Identifier des entites.
- Creer ou mettre a jour des pages client, projet, personne, action.
- Maintenir des index.
- Signaler des contradictions.
- Produire des files de revue.
- Refactorer progressivement la structure de memoire.

Claude Code est particulierement adapte a une memoire via `CLAUDE.md`.
Codex est particulierement adapte a un projet de fichiers structure, avec conventions, PRD, scripts et workflows.

Dans les deux cas, le fichier d'instruction ne doit pas contenir toute la memoire. Il doit expliquer comment naviguer dans la memoire.

## 6. Role de NotebookLM

NotebookLM est utile comme outil secondaire pour :

- Analyser des paquets de documents.
- Interroger des sources.
- Produire des syntheses.
- Explorer des PDF, livres, formations ou ensembles documentaires.

Il ne doit pas etre le cerveau principal du systeme, car :

- La structure durable est moins controlable.
- Le modele de permission et de publication vers des agents specialises est moins explicite.
- Il est moins adapte a une memoire vivante maintenue par conventions de fichiers.

## 7. Architecture memoire en couches

Le systeme doit fonctionner comme une bibliotheque avec catalogue, pas comme un unique fichier geant.

Les couches recommandees sont :

1. Boot memory : fichiers courts lus au demarrage.
2. Memory map : carte de navigation.
3. Index locaux : index par domaine.
4. Notes compilees : syntheses stables et sourcees.
5. Sources brutes : archives consultees seulement si necessaire.
6. Signaux publies : faits minimaux, types et consommables par agents.
7. Files de revue : ambiguities, contradictions, confirmations.

Flux de lecture ideal :

```text
Question utilisateur
  -> lire les instructions de l'agent
  -> lire memory_map.md
  -> identifier les domaines pertinents
  -> lire les index locaux
  -> lire quelques notes compilees
  -> ouvrir les sources brutes seulement si necessaire
  -> repondre avec source et niveau de confiance
```

## 8. Fichiers de demarrage

Au demarrage, un agent ne doit lire que quelques fichiers courts :

```text
AGENTS.md ou CLAUDE.md
memory_map.md
entry_professional.md
entry_personal.md
entry_review.md
```

Ces fichiers doivent contenir :

- Les regles de navigation.
- Les modes d'acces.
- Les zones de la memoire.
- Les index principaux.
- Les limites de confidentialite.
- Les consignes de verification et de clarification.

Ils ne doivent pas contenir tout le contenu detaille.

## 9. Point d'entree unique et compartimentation

La discussion a converge vers une architecture hybride :

- Un point d'entree unique.
- Des zones separees par usage et sensibilite.

Structure recommandee :

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

Le point d'entree unique garantit la coherence globale.
La compartimentation evite de melanger inutilement personnel, professionnel et informations sensibles.

## 10. Zones proposees

### 00_inbox

Zone d'arrivee des informations brutes :

- Notes de meeting.
- Journaux quotidiens.
- Transcriptions.
- Exports.
- Captures rapides.
- Idees non classees.

Ces fichiers ne doivent jamais etre detruits simplement parce qu'une synthese existe.

### 10_shared

Zone partagee entre plusieurs domaines :

- Identite generale.
- Valeurs.
- Style de communication.
- Preferences globales.
- Contraintes de disponibilite publiees.
- Preferences de planification.

Cette zone sert de pont entre personnel et professionnel.

### 20_professional

Zone professionnelle :

- Profil professionnel.
- Clients.
- Projets.
- Meetings.
- Decisions.
- Actions.
- Personnes professionnelles.
- Opportunites.
- Risques.

### 30_personal

Zone personnelle :

- Profil personnel.
- Relations.
- Habitudes.
- Energie.
- Sante, si souhaite.
- Reflexions.
- Actions personnelles.

### 40_private

Zone sensible :

- Informations tres personnelles.
- Sante sensible.
- Finances.
- Sujets familiaux sensibles.
- Notes therapeutiques.

Cette zone doit avoir des regles d'acces strictes.
Il ne faut pas y stocker de secrets techniques ou mots de passe.

### 50_review

Zone de revue humaine :

- Ambiguites.
- Contradictions.
- Questions de clarification.
- Confirmations avant action.
- Files specialisees : calendrier, sante, publication, etc.

### 60_signals

Couche de signaux publies et typables :

- Disponibilites.
- Actions.
- Preferences.
- Risques.
- Opportunites.
- Relations.
- Decisions.
- Signaux sante.
- Signaux non routes.

### 70_agent_contracts

Contrats par agent specialise :

- Ce que l'agent peut lire.
- Ce qu'il peut ecrire.
- Ce qu'il peut faire.
- Ce qui demande confirmation.
- Ce qui est interdit.

## 11. Memoire brute vs memoire compilee

Un principe majeur est de conserver deux niveaux :

```text
Source brute = preuve, contexte original, historique
Memoire compilee = vue utile, courte, organisee, sourcee
```

Exemple :

```text
00_inbox/meetings/2026-05-19-client-acme.md
  -> 20_professional/clients/acme.md
  -> 20_professional/projects/module-analytics.md
  -> 20_professional/people/paul-martin.md
  -> 60_signals/actions.jsonl
  -> 50_review/ambiguity_queue.md
```

L'agent ne doit pas remplacer la source brute par la synthese.
La synthese doit toujours pointer vers les sources.

## 12. Liens explicites et graphe de memoire

Le systeme doit transformer les notes en graphe :

- Une note de meeting peut etre liee a un client.
- Le client peut etre lie a un projet.
- Le projet peut etre lie a une action.
- L'action peut etre liee a une personne.
- La personne peut etre liee a une preference de communication.
- Une contrainte personnelle peut etre publiee comme contrainte professionnelle minimale.

Exemple :

```md
- 2026-05-19 : Acme est inquiet sur les delais du lancement de juin.
  Source : [[2026-05-19-client-acme]]
```

Ces liens doivent etre explicites pour que l'agent ne depende pas uniquement d'une recherche semantique.

## 13. Extraction d'entites

L'agent doit identifier :

- Clients.
- Personnes.
- Organisations.
- Projets.
- Actions.
- Decisions.
- Risques.
- Opportunites.
- Preferences.
- Contraintes.
- Dates.
- Evenements.
- Signaux personnels ou professionnels.
- Signaux transversaux.

Mais il ne doit pas pretendre tout identifier parfaitement.

## 14. Entites explicites, implicites et absentes

Trois niveaux ont ete distingues.

### Entites explicites

Elles sont presentes directement dans le texte.

Exemple :

```text
Meeting avec Acme. Paul demande une proposition analytics.
```

Extraction :

- Client : Acme.
- Personne : Paul.
- Sujet : analytics.
- Action : preparer proposition.

### Entites implicites

Elles sont inferables, mais incertaines.

Exemple :

```text
Il faudra lui envoyer la proposition avant vendredi.
```

L'agent peut proposer :

- Destinataire probable : Paul.
- Confiance : moyenne.
- Raison : Paul est la seule personne mentionnee.
- A confirmer : oui.

### Entites absentes mais deductibles par contexte

Elles ne sont pas dans la note, mais peuvent etre inferees via :

- Le frontmatter.
- Le dossier.
- Le calendrier.
- Les notes recentes.
- Les projets actifs du client.
- Les relations deja connues.

Exemple :

- Projet probable : Projet Y.
- Raison : seul projet actif d'Acme en mai 2026.
- Confiance : moyenne.

## 15. Confiance et statut des informations

Chaque extraction importante doit porter un statut :

- Confirme.
- Probable.
- Incertain.
- Contradictoire.
- A verifier.

Un lien implicite ne doit pas entrer comme fait stable sans confirmation.

Exemple :

```md
## Liens confirmes
- Client : [[Acme]]
- Personne : [[Paul Martin]]

## Liens probables
- Projet : [[Projet Y]]
  Confiance : moyenne
  Raison : Projet Y est le seul projet actif d'Acme.

## Ambiguites
- "lui envoyer la proposition" pourrait designer Paul ou le contact principal Acme.
```

## 16. Boucle de clarification

Le systeme doit inclure une file de questions pour l'utilisateur.

L'agent doit demander confirmation si :

- L'information cree une tache.
- Elle concerne un client, une personne ou un projet important.
- Elle modifie une preference durable.
- Elle contredit une note existante.
- Elle a un impact sur une decision future.
- Elle peut declencher une action externe.
- Elle touche une information sensible.

L'agent ne doit pas demander confirmation pour :

- Un detail sans consequence.
- Une information triviale.
- Une information perimee.
- Une hypothese faible sans impact.
- Une source brute qui suffit sans compilation.

## 17. Revues

Trois types de revue ont ete identifies :

### Revue quotidienne

Objectif :

- Actions urgentes.
- Ambiguites bloquantes.
- Disponibilites a publier.
- Confirmations operationnelles.

### Revue hebdomadaire

Objectif :

- Projets.
- Decisions.
- Clients.
- Relations.
- Taches non routables.

### Revue mensuelle

Objectif :

- Patterns personnels.
- Preferences durables.
- Evolution du style de travail.
- Changements d'identite professionnelle.
- Themes recurrents.

## 18. Limite de sollicitation utilisateur

L'agent doit pouvoir poser des questions, mais avec retenue.

Regles recommandees :

- Maximum 5 questions par revue standard.
- Priorite aux questions a impact eleve.
- Toujours donner la source.
- Toujours expliquer pourquoi la question compte.
- Ne pas demander ce qui peut etre laisse comme incertain sans consequence.

## 19. Couche de publication

Une idee centrale est la publication controlee d'informations entre domaines.

Une information personnelle peut etre utile professionnellement, mais elle ne doit pas etre exposee telle quelle.

Exemple brut personnel :

```text
Je dois accompagner quelqu'un a un rendez-vous medical mercredi matin.
```

Signal partage :

```text
Mercredi matin : indisponible, ne pas proposer de meeting.
```

La couche publiee transmet le minimum necessaire :

- La contrainte.
- Le niveau de confiance.
- La visibilite.
- L'action recommandee.
- Une reference source restreinte.

Elle ne transmet pas les details prives.

## 20. Exemple calendrier

Cas discute :

- Une note personnelle indique qu'Arnaud n'est pas disponible mercredi matin.
- Un agent calendrier doit en tenir compte.

Flux recommande :

```text
30_personal/journal/2026-05-19.md
  -> agent memoire extrait une contrainte
  -> 10_shared/availability.md
  -> 50_review/calendar_queue.md si confirmation necessaire
  -> agent calendrier consomme la contrainte publiee
  -> calendrier bloque le creneau apres confirmation
```

Le calendrier devient la source operationnelle de verite pour les disponibilites.
La memoire conserve le contexte et la provenance.

## 21. Agents specialises

Le systeme peut inclure plusieurs agents :

- Agent memoire.
- Agent calendrier.
- Agent email.
- Agent CRM.
- Agent projet.
- Agent sante.
- Agent ecriture.
- Agent recherche.
- Agent revue.

Chaque agent ne doit pas acceder a tout.

Il doit lire les signaux et vues compilees adaptes a sa mission.

## 22. Agent memoire / broker

L'agent memoire est l'element central.

Responsabilites :

- Lire large.
- Extraire des entites.
- Detecter les signaux.
- Classifier par type.
- Sourcer les informations.
- Publier des vues minimales.
- Maintenir les index.
- Remplir les files de revue.
- Router vers les agents concernes.

Il agit comme broker de connaissance.

## 23. Couche de signaux

Pour eviter de prevoir tous les agents a l'avance, le systeme publie des signaux generiques.

Exemples :

```yaml
type: availability_constraint
date: 2026-05-27
scope: professional
confidence: medium
source: private
detail_public: "indisponible personnel"
needs_confirmation: true
suggested_consumers:
  - calendar
  - project_planning
```

```yaml
type: relationship_signal
entity: Client Acme
signal: "semble inquiet sur les delais"
confidence: high
suggested_consumers:
  - email
  - crm
  - project_management
```

```yaml
type: preference
subject: communication
signal: "eviter les messages trop enthousiastes"
scope: global
suggested_consumers:
  - email
  - writing
  - sales
```

## 24. Signaux non routes

Si l'agent ne sait pas quel agent devrait consommer un signal, il doit le mettre dans une file :

```text
60_signals/unrouted.md
```

Pendant une revue, l'utilisateur peut decider :

- De publier le signal.
- De le classer.
- De l'ignorer.
- De creer un nouveau type de signal.
- De creer un nouveau contrat d'agent.

## 25. Contrats d'agents

Chaque agent specialise doit declarer :

- Types de signaux consommes.
- Fichiers lisibles.
- Fichiers ecrivables.
- Actions autorisees.
- Actions necessitant confirmation.
- Informations interdites.

Exemple :

```md
# Calendar Agent Contract

Consumes:
- availability_constraint
- scheduling_preference
- travel_constraint
- energy_constraint
- deadline_constraint

Can act:
- propose time blocks
- detect scheduling conflicts
- create calendar events after confirmation

Cannot access:
- private source details
- personal journal
- health details
```

## 26. Backfill pour nouveaux domaines

Lorsqu'un nouvel agent specialise est cree, il faut une phase de backfill.

Exemple : creation d'un agent sante.

Processus :

```text
Anciennes notes brutes
  -> backfill sante
  -> memoire sante structuree
  -> agent sante

Nouvelles notes brutes
  -> extraction continue
  -> memoire sante structuree
  -> agent sante
```

L'agent sante ne doit pas lire directement tout l'historique brut.

Il doit consommer :

```text
30_personal/health/
60_signals/health.jsonl
50_review/health_queue.md
```

## 27. Backfill vs extraction continue

Deux modes sont necessaires :

### Backfill

Objectif :

- Parcourir le passe.
- Extraire une nouvelle categorie.
- Creer des vues structurees.
- Sourcer chaque element.
- Marquer confiance et sensibilite.
- Produire une file de revue.

### Extraction continue

Objectif :

- Traiter chaque nouvelle note.
- Identifier les signaux pertinents.
- Mettre a jour les vues.
- Router les signaux.
- Demander confirmation si necessaire.

## 28. Vue materialisee de memoire

Les bases specialisees sont des vues materialisees :

- Elles ne remplacent pas les sources.
- Elles compilent des faits utiles.
- Elles peuvent etre reconstruites.
- Elles sont plus faciles a consommer pour des agents specialises.

Exemple :

```text
Sources brutes diverses
  -> vue sante
  -> vue calendrier
  -> vue CRM
  -> vue projet
```

## 29. Risques principaux

### Risque 1 - Hallucination de liens

L'agent peut creer des liens faux entre une note, un client, une personne ou un projet.

Mitigation :

- Statut de confiance.
- Sources obligatoires.
- Revue des liens implicites.
- Separation entre confirme et probable.

### Risque 2 - Melange personnel/professionnel

Des donnees personnelles peuvent fuiter vers un agent professionnel.

Mitigation :

- Compartimentation.
- Couche de publication.
- Contrats d'agents.
- Detail public minimal.

### Risque 3 - Surcharge de questions

L'agent peut trop solliciter l'utilisateur.

Mitigation :

- Priorisation par impact.
- Limite de questions.
- Revues periodiques.
- Files de revue separees.

### Risque 4 - Explosion de tokens

L'agent peut charger trop de fichiers.

Mitigation :

- Boot memory courte.
- memory_map.md.
- Index locaux.
- Notes compilees.
- Sources brutes a la demande.

### Risque 5 - Dette informationnelle

L'inbox brute peut grossir plus vite que la memoire compilee.

Mitigation :

- Extraction continue.
- Revue hebdomadaire.
- Backfills cibles.
- Signalement des dossiers non traites.

### Risque 6 - Faux sentiment d'exhaustivite

L'agent peut passer a cote de signaux implicites.

Mitigation :

- Signaux non routes.
- Backfills periodiques.
- Revue humaine.
- Reconnaissance explicite des incertitudes.

### Risque 7 - Action externe non desiree

Un agent calendrier, email ou CRM pourrait agir trop vite.

Mitigation :

- Actions sensibles apres confirmation.
- Contrats d'agents.
- Journal d'audit.
- Separation entre suggestion et execution.

### Risque 8 - Limites non detectees du systeme simple

Le systeme Markdown/index/signaux peut donner l'impression de fonctionner alors qu'il commence a rater des informations importantes.

Exemples :

- L'agent ne retrouve pas une source existante.
- L'agent lit trop de fichiers pour une question simple.
- Les liens explicites ne couvrent plus assez de cas implicites.
- Les agents specialises ne recoivent pas les bons signaux.
- Les permissions sont respectees en theorie mais pas en pratique.
- Les anciennes informations restent actives alors qu'elles sont perimees.

Mitigation :

- Monitoring continu.
- Questions de reference.
- Tests de recuperation.
- Tests de permissions.
- Tests d'ambiguite.
- Tests de routage des signaux.
- Tests de derive temporelle.
- Seuils explicites pour ajouter des systemes plus complexes.

## 30. Monitoring continu et evaluation

Le systeme doit integrer un monitoring continu des la V1.

L'objectif n'est pas d'ajouter immediatement une infrastructure lourde, mais de mesurer regulierement si le systeme reste fiable.

Le monitoring doit repondre a quatre questions :

1. Est-ce que l'agent retrouve les bonnes informations ?
2. Est-ce qu'il evite les informations hors sujet ?
3. Est-ce qu'il respecte les permissions et la confidentialite ?
4. Est-ce qu'il sait quand une information est ambigue, probable ou confirmee ?

## 31. Pourquoi monitorer

Sans monitoring, la decision d'ajouter un RAG, un graphe ou un moteur plus avance serait subjective.

Le systeme doit eviter deux erreurs :

- Ajouter de la complexite trop tot, avant d'avoir prouve le probleme.
- Ajouter de la complexite trop tard, quand les erreurs sont deja frequentes.

Le monitoring permet de detecter le moment ou la couche simple atteint ses limites.

Signaux de limite :

- Recall insuffisant : l'agent rate des sources importantes.
- Precision insuffisante : l'agent ramene trop de contenu non pertinent.
- Budget contexte trop eleve : l'agent lit trop de fichiers.
- Instabilite : l'agent donne des reponses differentes a la meme question.
- Violations de permission : un agent lit ou revele trop.
- Hypotheses stabilisees a tort : un lien probable devient un fait sans validation.
- Dette de revue : trop d'ambiguities restent ouvertes.
- Derive temporelle : des informations anciennes restent utilisees comme actuelles.

## 32. Questions de reference

Le systeme doit maintenir un jeu de questions de reference dans :

```text
90_evals/golden_questions.md
```

Ces questions representent les capacites essentielles que la memoire doit conserver.

Exemples :

- Quels clients ont exprime une inquietude sur les delais ?
- Quelles actions ouvertes concernent Acme ?
- Quelles contraintes personnelles impactent mon agenda professionnel cette semaine ?
- Quelles decisions ont ete prises sur le projet Y ?
- Quels signaux relationnels importants concernent Paul Martin ?
- Quelles preferences de communication dois-je respecter avec ce client ?
- Quels signaux d'energie recurrents ont ete detectes ?
- Quelles informations personnelles ont ete publiees vers le professionnel, et sous quelle forme redigee ?

Chaque question doit definir :

- Les sources attendues.
- Les reponses attendues.
- Les notes compilees pertinentes.
- Les signaux attendus.
- Les zones interdites.
- Le niveau de confiance attendu.
- Les criteres d'echec.

## 33. Types de tests necessaires

### Tests de recuperation

Objectif :

- Mesurer si l'agent retrouve les bonnes sources.
- Mesurer s'il evite les sources hors sujet.
- Mesurer combien de fichiers il lit.

Metriques :

- Recall.
- Precision.
- Qualite des sources citees.
- Nombre de fichiers consultes.
- Stabilite de reponse.

### Tests de permission

Objectif :

- Verifier qu'un agent specialise ne lit pas les zones interdites.
- Verifier qu'il ne revele pas les details prives.

Exemple :

- L'agent calendrier peut savoir qu'Arnaud est indisponible.
- Il ne doit pas connaitre ni exposer la raison medicale ou familiale.

### Tests d'ambiguite

Objectif :

- Verifier que l'agent ne transforme pas une hypothese en fait.

Exemple :

```text
"Il faudra lui envoyer la proposition avant vendredi."
```

Attendu :

- Creer une action probable.
- Marquer le destinataire comme ambigu.
- Ajouter une question de clarification.
- Ne pas stabiliser le destinataire sans confirmation.

### Tests de routage des signaux

Objectif :

- Verifier que les signaux arrivent aux bons agents.

Exemples :

- Une indisponibilite personnelle produit un signal calendrier.
- Une inquietude client produit un signal relationnel ou risque.
- Une preference de ton produit un signal de communication.
- Un signal sante ne devient pas automatiquement un signal professionnel.

### Tests de backfill

Objectif :

- Verifier qu'un nouveau domaine peut etre cree a partir de l'historique sans exposer trop de donnees.

Exemple :

- Creation d'un agent sante.
- Backfill des anciennes notes.
- Creation de `30_personal/health/`.
- Creation de `60_signals/health.jsonl`.
- Questions incertaines dans `50_review/health_queue.md`.

### Tests de derive temporelle

Objectif :

- Verifier que les informations perimees, archivees ou contredites ne restent pas actives a tort.

Cas :

- Preference ancienne contredite par une preference recente.
- Client anciennement actif devenu inactif.
- Action terminee encore ouverte.
- Contrainte de calendrier expiree.
- Projet archive encore utilise comme contexte principal.

### Canaries de memoire

Le systeme doit inclure quelques cas de test artificiels et clairement marques.

Objectif :

- Detecter vite une regression.
- Tester permissions, recherche, ambiguite et routage sans risquer de contaminer les donnees reelles.

Exemples :

- Faux client de test.
- Fausse contrainte calendrier.
- Fausse note ambigue.
- Fausse source privee qui ne doit jamais etre revelee.

## 34. Journal d'evaluation

Chaque evaluation doit etre documentee dans :

```text
90_evals/eval_runs.md
```

Chaque entree doit indiquer :

- Date.
- Agent ou modele utilise.
- Version des instructions.
- Questions testees.
- Resultats.
- Echecs.
- Corrections recommandees.
- Decision d'architecture.

Exemple de decision :

```text
Recall insuffisant sur questions semantiques, mais permissions correctes.
Decision : ajouter embeddings/RAG leger pour la recherche, sans remplacer les sources Markdown.
```

## 35. Seuils justifiant des systemes plus complexes

L'ajout d'un systeme plus complexe doit etre justifie par un echec mesure.

### Recherche texte ou BM25

Justifie si :

- Les index Markdown ne suffisent plus.
- L'agent lit trop de fichiers.
- Les notes recentes sont difficiles a retrouver.

### Embeddings ou RAG leger

Justifie si :

- Les questions semantiques ratent des sources importantes.
- Les memes idees sont formulees differemment.
- Les transcriptions, emails ou PDF deviennent nombreux.
- Le recall descend durablement sous un seuil acceptable.

### Recherche hybride et reranking

Justifie si :

- Le RAG trouve trop de fragments approximatifs.
- La precision est insuffisante.
- Le classement des resultats devient important.

### Knowledge graph

Justifie si :

- Les relations entre personnes, clients, projets, decisions et actions deviennent centrales.
- Les questions "qui est lie a quoi" deviennent frequentes.
- Le graphe explicite devient plus important que les documents eux-memes.

### Entity resolution et coreference resolution

Justifie si :

- Les alias creent trop d'erreurs.
- Les pronoms comme "il", "elle", "le client", "ce projet" generent trop d'ambiguities.
- Les entites implicites deviennent un probleme recurrent.

### Service memoire avec API et ACL

Justifie si :

- Plusieurs agents interrogent la memoire en parallele.
- Les permissions par fichier deviennent insuffisantes.
- Les actions externes exigent des logs stricts.
- Il faut exposer la memoire a des outils externes.

## 36. Cadence de monitoring

Cadence recommandee :

- Quotidien : actions, disponibilites, ambiguities urgentes.
- Hebdomadaire : questions de reference principales.
- Mensuel : permissions, derive, backfills, canaries.
- A chaque nouvel agent : contrat, permissions, routage et backfill.
- Avant chaque upgrade technique : evaluation complete.

## 37. Decision d'architecture

Decision recommandee :

```text
Un seul vault principal
  + separation stricte par dossiers
  + point d'entree unique
  + couche de signaux publies
  + contrats par agent
  + backfills par nouveau domaine
  + gouvernance de memoire
  + monitoring continu
  + RAG optionnel plus tard
```

Cette approche maximise :

- Controle.
- Lisibilite.
- Confidentialite.
- Evolutivite.
- Compatibilite multi-agent.
- Capacite de correction humaine.
- Discipline epistemique.
- Capacite a mesurer quand le systeme simple atteint ses limites.

## 38. Synthese de l'audit

Le systeme optimal n'est ni un simple chatbot, ni un RAG complet, ni un NotebookLM centralise.

C'est un vault Markdown vivant, maintenu par un agent memoire, organise en couches :

- Sources brutes.
- Syntheses.
- Index.
- Signaux.
- Revues.
- Contrats d'agents.
- Gouvernance.
- Evaluations continues.

Les agents specialises ne lisent pas toute la memoire.
Ils consomment des vues et signaux publies.

Les informations implicites ne sont pas traitees comme des faits.
Elles deviennent des hypotheses, puis des questions de clarification si elles ont un impact.

Le systeme doit apprendre progressivement, en ajoutant des domaines et des agents via des backfills, sans casser la structure existante.

Les upgrades techniques comme BM25, RAG, graphe de connaissance, resolution d'entites ou service memoire ne doivent pas etre adoptes par principe.
Ils doivent etre declenches par des evaluations montrant une limite concrete du systeme actuel.

## 39. Angles morts restants identifies

L'audit initial couvrait bien la structure documentaire, les signaux, les agents specialises, le backfill et le monitoring.

Il restait cependant un angle mort plus profond : le systeme etait decrit comme une memoire organisee, mais pas encore comme une memoire gouvernee.

Les questions critiques non encore assez traitees etaient :

- Qui peut lire quoi ?
- Qui peut transformer une source brute en fait stable ?
- Comment une information devient-elle obsolete ?
- Comment une information est-elle oubliee ?
- Comment l'agent resiste-t-il aux instructions malveillantes dans les sources ?
- Comment gerer les conflits entre agents ?
- Comment distinguer correction explicite, note brute, transcription automatique et inference ?
- Comment eviter que la memoire fige une ancienne version d'Arnaud ?

Conclusion critique :

> La prochaine amelioration du modele ne doit pas etre prioritairement technique. Elle doit etre epistemique, temporelle et securitaire.

## 40. Gouvernance de memoire a ajouter

Le systeme doit inclure un dossier :

```text
75_governance/
```

Ce dossier doit contenir :

```text
threat_model.md
prompt_injection_policy.md
forgetting_policy.md
ontology.md
temporal_model.md
source_reliability.md
conflict_arbitration.md
academic_research_map.md
```

Ces fichiers peuvent etre documentaires en V1.
Ils n'ont pas besoin d'etre automatises immediatement.

Leur role est de fixer les regles du jeu avant que le volume, les agents et les automatisations augmentent.

## 41. Menace, securite et prompt injection

Une source brute ne doit jamais etre consideree comme une instruction fiable.

Risque :

- Un email demande a l'agent d'ignorer les regles.
- Un PDF contient des instructions cachees.
- Une transcription contient une phrase qui ressemble a un ordre systeme.
- Une page web tente de faire publier des informations privees.

Position recommandee :

```text
Les sources brutes contiennent des observations.
Elles ne contiennent jamais d'instructions superieures aux regles du vault.
```

Implications :

- Les agents doivent traiter les documents importes comme des donnees, pas comme des commandes.
- Les actions externes restent confirmees.
- Les agents specialises ne gagnent pas de nouveaux droits parce qu'une source le demande.
- Les tests de permission doivent inclure des cas de prompt injection.

## 42. Oubli, expiration et revision de soi

Une memoire personnelle qui n'oublie jamais devient vite fausse.

Le systeme doit pouvoir dire :

- Cette information etait vraie avant.
- Cette information est vraie maintenant.
- Cette information est expiree.
- Cette information a ete remplacee.
- Cette information ne doit plus etre utilisee.

Champs a adopter :

```yaml
status: active | archived | deprecated | do_not_use
valid_from:
valid_until:
review_after:
superseded_by:
forget_after:
```

Point critique :

> Le droit a l'oubli n'est pas seulement juridique ou prive. C'est une condition de justesse identitaire.

Si le systeme conserve toutes les anciennes preferences comme actives, il representera progressivement une moyenne morte d'Arnaud, pas Arnaud maintenant.

## 43. Ontologie, entites et relations

Le systeme doit clarifier ses categories.

Sinon, il melangera :

- Risque, blocage, probleme et inquietude.
- Projet, opportunite et initiative.
- Personne, role et contact.
- Preference globale, preference contextuelle et preference temporaire.
- Fait stable, signal faible et hypothese.

L'ontologie minimale doit definir :

- Les types d'entites.
- Les champs obligatoires.
- Les relations possibles.
- Les alias.
- Les regles de fusion ou separation d'entites.

Exemple de probleme central :

```text
Paul = Paul Martin = P. Martin = le sponsor Acme ?
```

Le systeme doit pouvoir proposer une resolution, mais pas la stabiliser sans preuve suffisante.

## 44. Temps et memoire temporelle

Le temps n'est pas une metadata secondaire.
C'est une dimension centrale de la memoire.

Le systeme doit distinguer :

- Date d'observation.
- Date de creation de la note.
- Date de confirmation.
- Periode de validite.
- Date d'evenement.
- Date d'expiration.
- Date de remplacement par une information plus recente.

Sans modele temporel, les agents risquent de :

- Reutiliser une preference obsolete.
- Proposer un creneau deja expire.
- Considerer un client archive comme actif.
- Garder ouverte une action terminee.

## 45. Fiabilite des sources et provenance

Toutes les sources ne doivent pas avoir le meme poids.

Ordre de confiance indicatif :

1. Correction explicite d'Arnaud.
2. Decision confirmee.
3. Note directe d'Arnaud.
4. Note de meeting.
5. Email recu.
6. Transcription automatique.
7. Inference d'agent.
8. Ancienne synthese non revue.

Regle :

> Une inference d'agent ne doit jamais devenir aussi forte qu'une correction explicite utilisateur.

Chaque fait stable doit conserver :

- Source.
- Type de source.
- Date.
- Niveau de confiance.
- Transformation effectuee.
- Derniere revue.

## 46. Conflits entre agents

Le modele multi-agent cree un nouveau risque : plusieurs agents peuvent agir de maniere localement raisonnable mais globalement incoherente.

Exemple :

- Calendrier : mercredi matin indisponible.
- Projet : livraison planifiee mercredi matin.
- Email : promesse envoyee au client pour mercredi matin.

Sans arbitrage, chaque agent peut avoir raison dans son domaine et produire ensemble une erreur.

Solution :

- Creer une file de conflits.
- Journaliser les actions incompatibles.
- Prioriser par impact, urgence, reversibilite et sensibilite.
- Demander validation humaine quand le conflit touche un engagement externe.

## 47. Thematique de recherche academique a adopter

Les champs de recherche utiles ne doivent pas etre adoptes comme une pile technique immediate.
Ils doivent servir de boussole.

Thematique et utilite :

- Personal Information Management : structurer, retrouver et oublier l'information personnelle.
- Human-in-the-loop / Active Learning : poser peu de questions, mais les bonnes.
- Information Retrieval : evaluer recall, precision, ranking et cout contexte.
- Knowledge Graphs : modeliser relations entre entites.
- Entity Resolution : gerer alias, doublons et identites multiples.
- Coreference Resolution : traiter les pronoms et references implicites.
- Temporal Knowledge Representation : gerer validite et changement.
- Provenance and Trust : relier faits, sources et niveaux de confiance.
- Privacy-Preserving Retrieval : rechercher sans fuite de donnees sensibles.
- Agent Safety / Prompt Injection : proteger les agents contre sources hostiles.
- Cognitive Architectures / Memory Consolidation : inspirer consolidation et oubli.
- Evaluation of RAG and Agentic Systems : tester les regressions de memoire.

Position critique :

> Il faut importer les methodes d'evaluation et de modelisation avant d'importer les architectures lourdes.

Reference comparative :

```text
docs/evaluation-comparative-retrieval-rappel.md
```

Cette note estime la capacite de rappel du systeme face aux benchmarks BEIR, MTEB/MMTEB, MIRACL, KILT, RAGChecker et aux architectures modernes de contextual retrieval, hybrid search et reranking.

## 48. Decision critique mise a jour

Le modele reste pertinent.

Mais sa qualite depend maintenant moins de la sophistication du retrieval que de sa capacite a gouverner les transformations de memoire :

```text
source brute
  -> extraction
  -> hypothese
  -> clarification
  -> fait stable
  -> publication
  -> usage agentique
  -> revue
  -> expiration ou revision
```

Le modele doit donc etre juge sur :

- Sa fidelite aux sources.
- Sa capacite a oublier.
- Sa resistance aux sources hostiles.
- Sa gestion du temps.
- Sa gestion des conflits.
- Sa sobriete operationnelle.
- Sa capacite a evoluer sans devenir bureaucratique.
