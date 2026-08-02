# AIGENT-GOVERNANCE-015 — preuve Composer/Lab

- Surface capturée : `http://127.0.0.1:3987/lab`
- Rôle : zone d'exploration (Composer/Lab/Prototype), hors autorité visuelle de production
- Captures : `desktop-1440x900.png`, `laptop-1280x800.png`, `mobile-375x812.png`
- Console : `console-errors.json` (0 erreur)
- Réseau : `network-errors.json` (0 échec)

## Ce que la preuve montre

- La page affiche explicitement un état **EXPLORATION** (badges de statut des patterns).
- La palette et les patterns de démo sont exploratoires ; ils ne déclarent aucun faux statut métier de production.
- Le texte d'écran rappelle que la surface n'impose aucune règle produit.

## Condition de promotion vers production

Toute promotion d'un pattern Lab vers une surface produit exige :

1. revue humaine explicite ;
2. normalisation sur l'autorité sémantique de production en vigueur ;
3. responsive validé ;
4. accessibilité validée (focus/disabled/contraste/lecture) ;
5. vérité des données (aucune donnée inventée) ;
6. tests/gates adaptés au périmètre intégré.
