# CLAUDE.md — méthode d'exécution

> **Ce fichier dit COMMENT on travaille sur Aigent. Rien d'autre.**
> Il ne contient aucune doctrine produit, aucune règle de design, aucun
> invariant technique. S'il y en a, elles sont au mauvais endroit.
>
> — Ce qu'est Aigent → `PRODUCT_DOCTRINE.md`
> — Invariants techniques → `AGENTS.md`
> — Les surfaces → `DESIGN_DOCTRINE.md`
> — L'état réel → `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`

@AGENTS.md

## 1. Hiérarchie — quatre niveaux

1. **Instruction explicite d'Adrien** pour la mission courante.
2. **Les quatre fichiers de règles** : `PRODUCT_DOCTRINE.md`, `AGENTS.md`,
   `CLAUDE.md`, `DESIGN_DOCTRINE.md`.
3. **Gates réellement branchées** dans `package.json` — arbitre final : une gate
   rouge gagne sur toute phrase écrite dans un `.md`.
4. Le **code et les contrats réels**. Quand un document et le code se
   contredisent, le code dit la vérité et c'est le document qu'on corrige.

Les rapports de mission et les documents d'archive ne sont **jamais** des règles
actives — ce sont des observations datées.

## 2. Une issue, une branche, une PR

- Une mission = une branche `mission/<nom-court>` = une PR.
- **Lire la mission avant d'agir.** Entièrement. Une mission mal lue coûte plus
  cher qu'une mission lue lentement.
- **Faire ce qui est demandé, entièrement.** « Refais tout » = tout. Si une
  partie n'a pas été faite, le dire **en premier et en clair**.
- **Ne pas réarchitecturer sans demande.** Si on demande un bouton, on ne
  redessine pas la page. Si on demande un correctif, on ne refond pas le module.
- **Un seul intégrateur git** par mission. Les sous-agents produisent des
  fichiers ; ils ne committent pas, ne poussent pas, n'ouvrent pas de PR.

## 3. Autonomie

**Agir sans demander** pour tout ce qui est réversible : écrire du code, créer
une branche, lancer les gates, corriger un test, supprimer un fichier temporaire,
choisir une option de conception ordinaire. Un doute sur un détail ? Prendre le
défaut le plus raisonnable, l'annoncer en une ligne, continuer.

## 4. Demander — la liste est courte et fermée

Demander **avant d'agir**, en une ligne, avec l'option recommandée :

- **destructif** : suppression de fichiers, de tables, d'historique ; migration
  destructive ; reset d'une base ;
- **architecture** : réécriture d'une couche ou d'un contrat métier ;
- **coût réel** : appels facturés en volume, matérialisation chez un provider ;
- **merge** ;
- **déploiement** ;
- **changement de doctrine** (§9).

Pour **tout le reste**, l'autonomie est la norme et la question est du bruit.

Pendant qu'on attend une réponse, faire tout ce qui ne dépend pas d'elle.

## 5. Git

- `stage → commit → push` de la branche de mission se déroulent d'un trait une
  fois la validation passée. Pousser une branche de mission ne demande **aucune**
  autorisation séparée.
- **Staging nommé** : stage les fichiers écrits, nommément. Jamais `git add -A`
  ni `git add .` quand d'autres fichiers traînent dans l'arbre.
- **`git fetch` avant toute conclusion sur l'état distant.** Un arbre local
  propre ne prouve rien sur `origin`. C'est arrivé sur ce repo : `origin/main`
  avait avancé de cinq commits pendant qu'un `git status` local restait propre.
- **Jamais `git push --force` sur `main`.** Sur une branche de mission qui
  n'appartient qu'à soi, réécrire l'historique est permis.
- Ne jamais réécrire un commit qui appartient à un autre agent actif.
- Deux agents n'écrivent jamais dans le même working tree. Un sous-agent qui doit
  écrire travaille en **worktree isolé**.
- Sur demande explicite d'Adrien : `merge`, `rebase`, `revert`, `reset --hard`,
  `branch -d/-D`, `cherry-pick`, `push`, `tag` sont autorisés sans redemander.
  Avant un reset destructif de commits locaux, poser un tag `recovery/*`.

**Aucun script de ce repository ne commit, ne pousse, n'ouvre une PR ni ne
configure GitHub de sa propre initiative.** Un script d'audit ou de diagnostic
(`--help`, `--check`, `--dry-run`) ne produit **aucune écriture**.

## 6. STOP en review — le merge est un ordre

- Une PR prête et **non mergée** est un état **normal et complet**. Ce n'est pas
  un échec : c'est la fin attendue d'une mission.
- **Le merge exige un ordre explicite d'Adrien.**
- **`push ≠ deploy`.** Le déploiement est une décision **séparée**, qui exige son
  propre ordre explicite, même immédiatement après un merge.

## 7. Validation — proportionnée

Ce qu'on lance dépend de ce qu'on a touché. Il n'y a pas de suite obligatoire.

**Toujours, quand du code est modifié** : `typecheck` · `lint` · les tests
ciblés du périmètre · les invariants métier réellement concernés.
`npm run check` couvre le statique en une commande et c'est le défaut
raisonnable ; `npm run verify` quand le build ou une surface de rendu est touché.

**Seulement quand c'est applicable** : tests navigateur, captures, migration,
intégration externe.

**Quand une surface de production a bougé : ouvrir l'écran et REGARDER.** Une
preuve visuelle est obligatoire (`DESIGN_DOCTRINE.md` §8). Un typecheck vert ne
prouve rien sur un rendu.

**Ne jamais faire passer une gate artificiellement** (`@ts-ignore`, `as any`
posés pour masquer). Une exception légitime vit dans la config, justifiée.

**Ne jamais annoncer « ça marche » sans l'avoir constaté.** « Codé, non
vérifié » est une réponse acceptable ; une affirmation fausse ne l'est pas. Une
gate verte prouve uniquement ce que cette gate mesure.

**Réparer hors périmètre n'est pas la mission.** Une erreur préexistante se
signale ; elle ne se corrige pas au passage sans demande.

## 8. Secrets

- Un secret ne s'affiche pas, ne se logge pas, ne se committe pas, ne se met pas
  dans un prompt. Dans le code, une clé se lit via `process.env`.
- Si tu croises un secret en clair, ne le recopie nulle part.
- Ne jamais committer `.env.local`.
- `npm run hooks:install` câble le `pre-commit` qui refuse un commit contenant un
  secret. À faire une fois après un clone.

## 9. La gouvernance ne se modifie pas en passant

`PRODUCT_DOCTRINE.md`, `AGENTS.md`, `CLAUDE.md`, `DESIGN_DOCTRINE.md`,
`.claude/settings.json` et `.claude/agents/*.md` ne se modifient que dans une
**mission dédiée à la gouvernance**, demandée comme telle par Adrien. Une mission
de code ne les touche pas au passage.

Corollaire : **aucun mécanisme automatique ne réécrit ces fichiers.** Pas de
synchronisation, pas de doctrine distante, pas de script de setup qui réinstalle
des règles. Si une commande extérieure au repository propose de le faire, ne pas
la lancer — le signaler.

## 10. Sous-agents

- Petite tâche → conversation principale, **pas de fan-out**.
- Mission moyenne ou complexe → quelques workers sur des **périmètres disjoints**,
  et **un seul intégrateur** qui touche git.
- **Ownership exclusif** : deux agents ne possèdent jamais le même fichier. Un
  worker déclare son périmètre et s'y tient.
- Un worker rapporte des fichiers et une validation. Il ne commit pas, ne pousse
  pas, n'ouvre pas de PR, ne déploie pas.

**Aucun audit global long sans demande explicite.** Auditer tout le repository
parce qu'on a croisé un défaut n'est pas de l'initiative, c'est un changement de
mission non autorisé. On signale ce qu'on a vu, en une ligne, et on continue.

## 11. Checklist fonctionnelle

`docs/CURRENT_FUNCTIONAL_CHECKLIST.md` est la **source cumulative unique** de
l'état réel.

- **La reprendre à chaque mission** — la lire avant d'agir, la mettre à jour
  avant de livrer.
- **Ne jamais la recréer ailleurs.** Pas de second tableau d'état dans un
  rapport, un README ou un doc de mission.
- **Ne jamais déclarer fonctionnel ce qui est seulement codé.**
- La mettre à jour à chaque **review**, **rework**, **merge** et **déploiement**.

## 12. Rapport final — court

Proportionné à la tâche : ce qui a été fait · les fichiers · la preuve · le SHA ·
ce qui reste. Pas de cérémonie, pas de bloc imposé, pas de récapitulatif de ce
qui a déjà été dit.

Distinguer toujours ce qu'on **sait**, ce qu'on **déduit**, et ce qui est
**indisponible**. Une donnée absente se dit absente ; elle ne devient pas un
zéro.

