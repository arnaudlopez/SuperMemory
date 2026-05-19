# Evaluation comparative - rappel, vitesse et robustesse du systeme memoire

## 1. Question

Evaluer la robustesse de rappel et la vitesse probable du systeme conceptuel de memoire agentique face a des systemes de retrieval/RAG benchmarkes.

Objectifs :

- Comprendre les benchmarks utiles.
- Identifier les architectures qui obtiennent un fort rappel.
- Estimer la capacite de notre systeme.
- Extraire les lecons a adopter sans ajouter de complexite prematuree.

## 2. Benchmarks pertinents

### BEIR

BEIR evalue la generalisation zero-shot de systemes de recherche sur des datasets heterogenes.

Le papier BEIR indique que BM25 reste une baseline robuste, tandis que les architectures de reranking et late interaction obtiennent souvent les meilleurs resultats zero-shot, au prix d'un cout computationnel plus eleve.

Utilite pour nous :

- Evaluer la recherche hors domaine.
- Ne pas sous-estimer BM25.
- Ne pas croire qu'un dense retriever seul suffit.

Source : https://arxiv.org/abs/2104.08663

### MTEB / MMTEB

MTEB evalue les embeddings sur plusieurs types de taches : retrieval, clustering, classification, reranking, STS, etc.

Le papier MTEB montre qu'aucune methode d'embedding ne domine toutes les taches.
MMTEB etend cette logique a plus de langues, plus de taches, et des contextes comme long-document retrieval et code retrieval.

Utilite pour nous :

- Ne pas choisir un modele uniquement sur un score global.
- Evaluer notre propre corpus.
- Separer retrieval, reranking, classification et clustering.

Sources :

- https://arxiv.org/abs/2210.07316
- https://huggingface.co/mteb
- https://arxiv.org/abs/2502.13595

### MIRACL

MIRACL evalue la recherche multilingue sur 18 langues, avec plus de 700k jugements de pertinence.

Utilite pour nous :

- Important si le vault melange francais, anglais, notes techniques, emails et sources diverses.
- Rappelle que le multilingue est une vraie dimension de performance.

Source : https://arxiv.org/abs/2210.09984

### KILT

KILT evalue des taches intensives en connaissance avec provenance.

Utilite pour nous :

- La provenance est aussi importante que la reponse.
- Une bonne memoire doit pouvoir dire d'ou vient l'information.

Source : https://arxiv.org/abs/2009.02252

### RAGChecker et frameworks RAG

RAGChecker propose une evaluation fine des modules de retrieval et de generation.
Les surveys RAG insistent sur le fait que l'evaluation est difficile parce que retrieval, generation, fidelite, pertinence et connaissances dynamiques interagissent.

Utilite pour nous :

- Evaluer retrieval et reponse separement.
- Diagnostiquer la cause des echecs.
- Ne pas confondre "le bon document a ete retrouve" et "la bonne reponse a ete produite".

Sources :

- https://proceedings.neurips.cc/paper_files/paper/2024/hash/27245589131d17368cccdfa990cbf16e-Abstract-Datasets_and_Benchmarks_Track.html
- https://arxiv.org/abs/2405.07437

## 3. Ce que les top systemes font mieux que notre V1

Les meilleurs systemes de retrieval ne comptent pas sur une seule methode.

Ils combinent souvent :

```text
chunking propre
  + contexte ajoute aux chunks
  + BM25
  + embeddings
  + fusion hybride
  + reranking
  + evaluation continue
```

Anthropic rapporte que Contextual Retrieval reduit les echecs de retrieval de 49 %, et de 67 % avec reranking.
Leur cookbook montre une progression Pass@10 d'environ 87 % en baseline a 95 % avec reranking sur un dataset de codebases.

Sources :

- https://www.anthropic.com/engineering/contextual-retrieval
- https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide

## 4. Estimation de notre systeme conceptuel

Notre systeme n'est pas un moteur de retrieval pur.

C'est une architecture de memoire :

- Sources brutes.
- Notes compilees.
- Index Markdown.
- Signaux.
- Contrats d'agents.
- Revues.
- Monitoring.
- Gouvernance.

Il faut donc evaluer deux choses separement :

1. La capacite a retrouver une information.
2. La capacite a utiliser correctement cette information.

### 4.1 Cas ou notre systeme devrait etre fort

Si l'information est deja compilee, sourcee, indexee et reliee :

Estimation :

- Recall@5 : 85-95 %.
- Precision : 80-95 %.
- Vitesse : elevee.
- Auditabilite : tres elevee.

Exemples :

- Actions ouvertes pour un client.
- Preferences confirmees.
- Decisions de projet.
- Contraintes publiees dans `10_shared/availability.md`.

Raison :

- L'agent n'a pas besoin de retrouver une aiguille dans le brut.
- Il suit la carte, les index, les pages compilees et les signaux.

### 4.2 Cas ou notre systeme sera moyen

Si l'information existe seulement dans les sources brutes, mais avec vocabulaire explicite :

Estimation V1 Markdown + recherche texte :

- Recall@10 : 55-80 %.
- Precision : 50-80 %.
- Vitesse : moyenne.
- Auditabilite : bonne si la source est retrouvee.

Exemples :

- Une ancienne note mentionne Acme.
- Une transcription contient le mot "delai".
- Un meeting parle explicitement d'un projet.

Raison :

- `rg` ou BM25 peuvent aider.
- Mais sans compilation, le rappel depend des mots exacts.

### 4.3 Cas ou notre systeme sera faible sans upgrade

Si l'information est implicite, semantique, dispersee ou formulee differemment :

Estimation V1 sans RAG :

- Recall@10 : 25-60 %.
- Precision : variable.
- Vitesse : lente si l'agent doit explorer.
- Auditabilite : correcte seulement si l'agent retrouve les sources.

Exemples :

- "Quels clients semblent perdre confiance ?"
- "Quels patterns d'energie apparaissent depuis deux mois ?"
- "Quelles decisions anciennes contredisent ce que je fais maintenant ?"
- "Ce projet est-il lie a l'opportunite dont on parlait sans la nommer ?"

Raison :

- Ces requetes exigent recherche semantique, temporalite, entity resolution ou graphe.

### 4.4 Cas ou notre systeme peut battre un RAG standard

Notre systeme peut etre meilleur qu'un RAG standard pour :

- Provenance.
- Confidentialite.
- Separation personnel/professionnel.
- Gestion des actions.
- Publication de signaux minimaux.
- Contrats d'agents.
- Revues de clarification.
- Correction humaine.
- Interpretation temporelle si elle est bien structuree.

Un RAG standard peut retrouver un passage.
Notre systeme peut dire si ce passage est :

- confirme ;
- obsolete ;
- sensible ;
- publiable ;
- utilisable par tel agent ;
- contredit par une source plus recente.

## 5. Matrice comparative

| Capacite | Notre V1 Markdown gouvernee | RAG dense simple | Hybrid + rerank | Knowledge graph |
|---|---:|---:|---:|---:|
| Faits compiles | Fort | Moyen | Fort | Fort |
| Sources brutes explicites | Moyen | Moyen | Fort | Moyen |
| Requetes semantiques | Faible a moyen | Fort | Tres fort | Moyen |
| Relations entites | Moyen | Faible | Moyen | Tres fort |
| Pronoms / implicite | Faible | Moyen | Moyen | Fort si modelise |
| Temporalite | Moyen si champs propres | Faible | Faible a moyen | Fort |
| Confidentialite | Fort | Risque eleve sans ACL | Moyen avec ACL | Fort avec ACL |
| Auditabilite | Tres fort | Moyen | Moyen | Fort |
| Vitesse | Forte sur compile, faible sur brut | Forte | Moyenne | Moyenne |
| Maintenance | Moyenne | Moyenne | Elevee | Elevee |

## 6. Learning des top systemes a appliquer chez nous

### Learning 1 - Toujours contextualiser les fragments

Avant d'indexer ou compiler une source, ajouter un contexte court :

```text
Cette note vient du meeting Acme du 2026-05-19, lie au projet Y, avec Paul Martin.
```

Application chez nous :

- Ajouter un champ `retrieval_context` aux notes compilees et signaux.
- Pour les sources longues, creer des chunks contextualises si un RAG est ajoute.

### Learning 2 - Garder BM25 meme avec embeddings

BEIR montre que BM25 reste robuste.
Anthropic montre que Contextual BM25 combine aux embeddings ameliore les resultats.

Application :

- Niveau 2 d'upgrade : BM25 local avant RAG lourd.
- Ne jamais remplacer la recherche texte par embeddings seuls.

### Learning 3 - Utiliser hybrid retrieval

Les requetes factuelles exactes aiment BM25.
Les requetes floues aiment embeddings.
Les meilleures architectures utilisent les deux.

Application :

```text
rg/BM25 candidates
  + embedding candidates
  -> fusion
  -> rerank
```

### Learning 4 - Ajouter reranking seulement quand necessaire

Le reranking est tres efficace mais ajoute cout et latence.

Application :

- Pas en V1.
- Activer si precision ou ranking deviennent faibles.
- Utiliser reranking sur top 50-150 candidats, pas sur tout le vault.

### Learning 5 - Evaluer Pass@k / Recall@k avant la qualite de reponse

Si le bon document n'est pas retrouve, la generation ne peut pas etre fiable.

Application :

- `90_evals/golden_questions.md` doit mesurer d'abord retrieval.
- Puis seulement answer quality et faithfulness.

### Learning 6 - Separer retrieval, reasoning et action

RAGChecker et les surveys RAG montrent qu'il faut diagnostiquer les modules.

Application :

- Evaluer separement :
  - source retrouvee ;
  - interpretation correcte ;
  - signal publie correctement ;
  - action proposee correctement.

### Learning 7 - La gouvernance est notre avantage defensif

Les benchmarks de retrieval mesurent peu :

- sensibilite ;
- oubli ;
- permissions ;
- statut temporel ;
- conflit entre agents ;
- provenance forte.

Application :

- Ne pas copier les top RAG comme architecture complete.
- Copier leurs techniques de retrieval.
- Garder notre couche gouvernee comme source de valeur.

## 7. Recommandation d'evolution

### Maintenant

Ne pas ajouter de RAG complet.

Ajouter plutot :

- Questions de benchmark internes.
- Canaries.
- Contextes courts sur les notes.
- Ontologie minimale.
- Fiabilite des sources.
- Champs temporels.

### Prochain upgrade

Ajouter BM25 local si :

- Les recherches `rg` deviennent insuffisantes.
- Le vault depasse quelques milliers de notes.
- Le recall sur questions explicites descend sous 85-90 %.

### Upgrade suivant

Ajouter embeddings + RAG leger si :

- Les questions semantiques echouent.
- Les formulations varient beaucoup.
- Les sources longues augmentent.
- Le recall semantique descend sous 80-85 %.

### Upgrade avance

Ajouter hybrid + rerank si :

- Le RAG trouve trop de bruit.
- La precision descend sous 80 %.
- Les top resultats ne sont pas assez bien ordonnes.

### Upgrade structurel

Ajouter knowledge graph / entity resolution si :

- Les relations deviennent plus importantes que les documents.
- Les alias et pronoms causent des erreurs frequentes.
- Les questions "qui/quoi est lie a quoi" deviennent centrales.

## 8. Verdict

Notre systeme conceptuel ne battra pas les top systems de retrieval sur un benchmark pur type MTEB/BEIR.

Il n'est pas fait pour cela.

Il peut en revanche battre un RAG standard sur une memoire personnelle/professionnelle reelle, parce qu'il gere mieux :

- provenance ;
- confiance ;
- sensibilite ;
- publication ;
- action ;
- temporalite ;
- revue humaine ;
- correction ;
- multi-agent.

Estimation finale :

```text
V1 sur memoire compilee : tres bon rappel, forte precision, tres bonne auditabilite.
V1 sur brut explicite : rappel moyen, acceptable avec recherche texte.
V1 sur brut implicite/semantique : insuffisant.
V2 BM25/contextualisation : bon niveau pour usage quotidien.
V3 hybrid embeddings + rerank : comparable a des RAG solides.
V4 graphe/entity resolution : necessaire pour memoire multi-agent mature.
```

La lecon principale des top modeles :

> Le haut rappel vient rarement d'un seul modele. Il vient d'une pipeline evaluee, contextualisee, hybride et rerankee.

Notre lecon specifique :

> La memoire personnelle ne doit pas seulement retrouver. Elle doit savoir si elle a le droit d'utiliser ce qu'elle retrouve.
