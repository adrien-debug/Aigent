# Obsidian — preuves visuelles non automatisables

État au **2026-08-01**. Statut de l'outil : **`INSTALLED`, non vérifié graphiquement**.

## La limitation, démontrée

Trois captures étaient exigées : le vault ouvert, les deux Canvas, la Base.
Elles n'ont **pas** été produites, et voici pourquoi — constaté, pas supposé.

### 1. Le vault de mission n'est pas enregistré auprès d'Obsidian

```
$ cat "~/Library/Application Support/obsidian/obsidian.json"
vaults enregistrés : 3
  - /Users/adrienbeyondcrypto/Documents/Obsidian Vault
  - /Users/adrienbeyondcrypto/Dev/Hearst Corporation
  - /Users/adrienbeyondcrypto/Documents/Obsidian-Notes   (ouvert)
notre vault présent ? NON
```

L'URI `obsidian://open?path=…` échoue en conséquence, avec le message exact :

> **Vault not found.** Unable to find a vault for the URL
> `obsidian://open?path=%2FUsers%2F…%2FAigent-vs002%2Fvault%2Farchitecture%2FArchitecture%20Aigent.canvas`

Une première capture a été produite puis **supprimée** : elle montrait cette
boîte d'erreur, pas un Canvas. La conserver en la nommant
`obsidian-architecture-canvas.png` aurait été un faux.

### 2. Enregistrer le vault est hors périmètre

Ajouter une entrée à `obsidian.json` modifie la configuration d'une application
appartenant à l'utilisateur, qui a déjà trois vaults dont un ouvert. Cette
mission ne touche pas aux configurations applicatives hors du repository.

### 3. La capture d'écran système n'est pas cadrable

`screencapture` est disponible, mais la capture obtenue montrait le bureau
entier — Docker Desktop, un navigateur, d'autres fenêtres. Une preuve visuelle
qui expose l'environnement de travail complet n'est pas une preuve exploitable,
et diffuse du contenu sans rapport avec la mission.

## Ce qui EST prouvé, sans capture

La structure du vault est vérifiée par une gate qui échoue réellement —
`npm run check:vault` :

```
Vault Aigent — validation structurelle
  notes      : 28
  canvases   : 2 (29 nœuds, 26 arêtes)
  bases      : 1
  liens [[]] : 74

✓ Toutes les arêtes résolvent, tous les liens résolvent, aucun secret.
```

Sonde négative jouée : une arête orpheline injectée dans
`Architecture Aigent.canvas` fait passer la gate au rouge, son retrait la
remet au vert. Elle mesure donc quelque chose.

Ce que cela couvre — et que la capture ne couvrirait pas mieux : chaque arête
pointe vers deux nœuds existants, chaque `[[lien]]` résout vers une note réelle,
chaque nœud fichier pointe vers un fichier présent, aucun secret n'a fui.

Ce que cela ne couvre pas : le rendu visuel dans Obsidian.

## Checklist manuelle — 2 minutes

1. **Enregistrer le vault**
   Obsidian → `Ouvrir un autre coffre` → `Ouvrir un dossier comme coffre` →
   sélectionner `<repo>/vault` → `Faire confiance à l'auteur et activer les greffons`.

2. **Canvas architecture**
   Ouvrir `architecture/Architecture Aigent.canvas`.
   Attendu : **15 nœuds, 14 arêtes**. Vérifier que l'interface, le proxy,
   LangGraph, la base, les métriques, Prometheus, Grafana, Langfuse et n8n sont
   reliés, et qu'aucune flèche ne pend dans le vide.

3. **Canvas parcours**
   Ouvrir `architecture/Parcours de qualification.canvas`.
   Attendu : **14 nœuds, 12 arêtes**, les 8 étapes chaînées de la création à
   l'apprentissage, plus les 4 encarts (`active` = prouvé, garde fail-closed,
   ce qu'Aigent ignore, retour de télémétrie).

4. **Base**
   Ouvrir `Agents.base`.
   Attendu : **4 vues** (Tous les agents · Avec échecs · Latence non mesurée ·
   Par projet), alimentées par les 15 notes de `agents/`.
   Contrôle de vérité : dans « Latence non mesurée », les agents concernés
   affichent **« non mesurée »**, jamais `0 ms`.

5. **Liens**
   Depuis `Accueil Aigent`, suivre un `[[lien]]` vers un registre, puis revenir
   par les backlinks. Aucun lien mort.

Si ces cinq points passent, Obsidian peut être promu de `INSTALLED` à
`VERIFIED` — mais uniquement sur constat humain, pas par déclaration.
