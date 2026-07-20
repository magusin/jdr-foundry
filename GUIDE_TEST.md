# 🎮 Guide de test complet — Système RPG Foundry VTT

---

## 0. AVANT DE COMMENCER

### Foundry — Configuration initiale
1. Lance Foundry VTT → ouvre ton monde
2. **Paramètres** → **Gérer les modules** → vérifie que le système "rpg" est actif
3. **git pull** dans ton terminal → redémarre le serveur Node Foundry
4. Recharge le navigateur (F5)

### Vérifier que les macros sont installées
Les macros se réinstallent automatiquement au démarrage. Tu dois voir dans la barre de macros en bas :
- Menu Combat
- 🎮 Tableau de bord MJ
- Météo (MJ)
- Terrain (MJ)

Si elles manquent : **Compendiums** → **Macros système** → **Importer tout**

---

## 1. CRÉER UNE SCÈNE

1. Barre gauche → icône **Scènes** (drapeau)
2. **Créer une scène** → nom "Donjon Test"
3. Dans Configuration :
   - **Grille** → Distance : **1** → Unité : **m**
   - **Largeur/Hauteur** : 30×30 cases minimum
4. Clic droit sur la scène → **Activer** (les joueurs voient cette scène)
5. Double-clic pour entrer dans la scène

### Terrain de test optionnel
- Calque **Régions** (hexagone violet à gauche)
- Dessine un rectangle sur une partie de la carte
- Double-clic → Comportements → + Ajouter → **rpg.terrainDifficile**
- Configure le slider à 0.5 (vitesse ÷2)

---

## 2. CRÉER UN SORT (MJ)

1. Barre gauche → **Items** → **Créer un objet** → Type : **spell** → "Boule de feu"
2. Fiche sort — remplir :

**Onglet principal :**
- Livraison : **Magique**
- Élément / Type : **🔥 Feu**
- Coût Mana : **3**
- Coût Fatigue : **1**
- Portée min : **0** | Portée max : **15**
- Difficulté (TN+) : **0**
- Cibles min/max : **1 / 1**
- Description : "Une boule de feu explose sur la cible."

**Onglet Effets → Ajouter un effet :**
- Label : "Brûlure"
- Élément (tag) : Feu
- Type : Dégâts directs
- Durée : 2 tours
- TN Retrait : 12
- Dés dégâts : 2d6
- Plat : 3
- Stat bonus : Intelligence | Par : 10 | Pas : 1

3. Sauvegarde (Fermer)

**Crée un 2e sort : "Soin"**
- Élément : **⚪ Neutre**
- Coût Mana : 2
- Portée max : 6
- Effet → Label : "Soins", Tag : Neutre, Dés : 1d8, Plat : 2
- Durée : 0 (instantané)

---

## 3. CRÉER UN ÉQUIPEMENT (MJ)

**Épée longue :**
1. Items → Créer → Type : **weapon** → "Épée longue"
2. Fiche arme :
   - Dégâts dés : **1d8**
   - Dégâts plat : **2**
   - Stat bonus : **Force** | Par : **8** | Pas : **1**
   - Portée : **1** m
   - Emplacement : **Main droite**
   - Poids : 3
3. Onglet **Recette associée** → laisser vide pour l'instant

**Armure de mailles (torse) :**
1. Items → Créer → Type : **armor** → "Armure de mailles"
2. Fiche armure :
   - Emplacement : **Torse**
   - Bonus → Score Armure : **18**
   - Bonus → Armure fixe : **0.8**
   - Poids : 8

---

## 4. CRÉER UN PERSONNAGE JOUEUR

1. **Acteurs** → **Créer un acteur** → Type : **character** → "Aldric"
2. Ouvre la fiche → onglet **Caractéristiques**

**Stats de base (MJ édite) :**
- Force base : **30**
- Dextérité base : **28**
- Intelligence base : **15**
- Acuité base : **15**
- Endurance base : **28**

→ Le Total s'affiche automatiquement (Base + Niveau 1 = Base + 1)
→ PV max doit afficher **35** (30 base + floor(29/5)=5)
→ Mana max : **5** (5 base + floor(16/20)=0)

**Ajouter l'épée et l'armure :**
3. Onglet **Inventaire** → glisse-déposes l'épée et l'armure depuis la barre Items
4. Onglet **Équipement** → clique ⬆ Équiper sur l'épée (Main droite) et l'armure (Torse)
→ Les stats Total doivent augmenter si l'arme/armure donne des bonus

**Ajouter le sort :**
5. Onglet **Sorts** → glisse-déposes "Boule de feu" et "Soin"

**Assigner un joueur :**
6. Clic droit sur Aldric dans la liste Acteurs → **Configurer les permissions**
7. Sélectionne un utilisateur → **Propriétaire**

---

## 5. CRÉER UN MONSTRE

1. Acteurs → Créer → Type : **monster** → "Gobelin Éclaireur"
2. Fiche monstre — onglet **Informations** :

**Stats de base :**
- Force : 15 | Dextérité : 22 | Intelligence : 8
- Acuité : 10 | Endurance : 10
- PV base : 20 *(la fiche calcule automatiquement)*
- Vitesse : 6m
- Mode déplacement : 🦶 Terrestre

**Illustration** : clique sur le portrait → sélectionne une image
**Token** : clique sur Token → sélectionne une image différente (ou la même)

3. Onglet **Attaques** :
- Ajoute l'item "Couteau" depuis le compendium Items ou crée une arme :
  - Dés : 1d4, Plat : 0, Stat : Dextérité, Par : 10

4. Onglet **Butin** :
- Clique **+ Item**
- Colle l'UUID d'un item loot (ex: depuis Compendium Items → clic droit → Copy UUID)
- % : 80 | Qté/drop : 1 | Essais : 2
*(= 2 jets à 80%, peut donner 0, 1 ou 2 items)*

5. **Génération aléatoire (optionnel)** :
- Onglet **Génération (MJ)** → Niveaux : "1"
- Clic "Initialiser" → remplis les plages de stats pour niveau 1
- Bouton "Régénérer les stats" → les stats se randomisent dans les plages

---

## 6. PLACER LES TOKENS SUR LA CARTE

1. Barre gauche → **Acteurs**
2. Glisse-déposes "Aldric" sur la carte → un token apparaît
3. Glisse-déposes "Gobelin Éclaireur" sur la carte (à 5-6 cases d'Aldric)

**Vérifier le token :**
- Clic sur le token Aldric → barre PV visible
- Clic droit → Configure Token → vérifie que l'image Token est correcte (différente du portrait)

---

## 7. TEST DE COMBAT

### Démarrer le combat
1. Sélectionne les deux tokens (Ctrl+clic ou rectangle de sélection)
2. Barre de combat en haut à droite → **Créer un Encounter** (épées croisées)
3. Bouton **Lancer l'initiative** (dé dans le tracker de combat)
4. Clic **Commencer le combat** → le tracker affiche l'ordre des tours

### Tour du joueur (Aldric)

**Connexion joueur :** ouvre un 2e navigateur en navigation privée → connecte-toi avec le compte joueur

**En tant que joueur :**
1. Contrôle le token Aldric (clic)
2. Lance la macro **Menu Combat** (barre du bas)
3. Menu s'ouvre → onglet **Armes** → tu vois l'épée longue
4. Clique **⚔️ Déclarer Attaque** sur l'épée

**En tant que MJ :**
5. Un message apparaît dans le chat avec le TN calculé
6. Le joueur voit un bouton **🎲 Lancer le d20**
7. Le joueur clique → le dé se lance → résultat visible

**Si touché :**
8. MJ voit les boutons : ❌ Échec | ✅ Touché | 🌟 Critique
9. MJ clique **✅ Touché**
10. Joueur voit le bouton **🎲 Lancer les dégâts**
11. Joueur lance → MJ voit les dégâts calculés (avec réduction armure gobelin)
12. MJ clique **✅ Appliquer les dégâts** → PV du gobelin diminuent

### Test du déplacement
1. Dans Menu Combat → **🏃 Déclarer Déplacement (6m)**
2. Clique **Valider** → bouge le token jusqu'à 6 cases
3. Un message MJ apparaît avec distance et boutons Valider/Annuler
4. MJ clique **✅ Valider**

**Test terrain difficile :**
- Déplace le token dans la région que tu as créée
- Le message indique le coût réel (ex: "3m = 6m en terrain difficile")

### Test d'un sort

**En tant que joueur :**
1. Menu Combat → onglet **Sorts** → survole "Boule de feu"
   → Un cercle violet apparaît sur la carte (portée 15m)
2. Cible d'abord le gobelin (clic droit sur son token → Cibler)
3. Clique **🔥 Déclarer Sort**

**Vérification :**
- Message public : "Aldric déclare Boule de feu — TN X, Mana -3"
- Message whisper MJ : validation avec boutons Réussite/Échec

**MJ valide :**
4. MJ clique **✅ Réussite**
5. Joueur voit **🎲 Lancer les dégâts**
6. Joueur lance → 2d6 + 3 + bonus Intelligence
7. MJ voit le résultat → boutons Appliquer/Annuler
8. MJ applique → PV gobelin diminuent + état "Brûlure" appliqué sur le gobelin

---

## 8. FIN DE COMBAT

1. Tue le gobelin : met ses PV à 0 manuellement (barre PV ou fiche)
2. Tracker de combat → bouton **Terminer le combat** (drapeau)
3. Un message de fin apparaît :
   - XP distribué aux PJ
   - Bouton **🎲 Looter** si le gobelin a du butin configuré
4. Clic **Looter** → résultat aléatoire affiché dans le chat (80% ×2 essais)

**Vérifier XP :**
5. Ouvre la fiche d'Aldric → onglet Caractéristiques → barre XP augmentée
6. Si ≥ 100 XP → popup de montée de niveau automatique

---

## 9. TESTS MÉTÉO & TERRAIN

### En tant que MJ
1. Clique sur le **bandeau météo** en haut de l'écran
2. Coche **Orageux ⛈️** + **Gel ❄️**
3. Applique → message chat + effets visuels (pluie sur la carte)

**Vérifier sur la fiche sort "Boule de feu" :**
4. Ouvre la fiche → sous "Coût Mana" → badge rouge : "Gel : +2 mana → 5 mana"

5. Clique sur le **bandeau terrain**
6. Sélectionne **🌋 Zone volcanique**
7. Applique → "Feu -2 mana, Terre -1 mana"

**Vérifier la combinaison sur Boule de feu :**
- Météo Gel : Feu +2 mana
- Terrain Volcanique : Feu -2 mana
- Net = 0 → coût reste 3 mana (s'annulent)

---

## 10. TESTS RECETTE & FORGE

### Créer une recette
1. Items → Créer → Type : **recipe** → "Recette : Épée longue"
2. Fiche recette :
   - Difficulté : **10**
   - Ingrédients → + Ajouter → "Métal commun" ×3, "Poignée" ×1
   - Résultat UUID : clic droit sur "Épée longue" dans ta liste Items → **Copy UUID** → coller
3. Clic **📄 Voir** → doit ouvrir la fiche de l'épée longue
4. Clic **📚 Apprendre cette recette** → sélectionne Aldric → la recette est dans son inventaire

### Tester la forge (joueur)
1. Aldric doit avoir "Métal commun ×3" et "Poignée ×1" dans son inventaire
   *(crée ces items via Items → Créer → Type : loot)*
2. Lance la macro **Forge**
3. Sélectionne la recette → vois la chance de réussite (ex: 45% si Forge niveau 0)
4. Déclare → message MJ avec le résultat du jet
5. MJ valide → si réussite, l'épée longue apparaît dans l'inventaire d'Aldric
6. Les ingrédients sont consommés automatiquement

---

## 11. TESTS MJ AVANCÉS

### Jet de compétence secret
1. Macro **Jet de Compétence**
2. Sélectionne Aldric, compétence "Discrétion", difficulté 15
3. Coche **🔒 Test secret**
4. Applique → le joueur voit "Jet secret — fais de ton mieux" sans voir le TN
5. Joueur lance → MJ voit si ça passe (TN = 15 - niveau Discrétion)

### Blessure permanente
1. Ouvre la fiche d'Aldric → onglet **Blessures**
2. Clic **+ Ajouter**
3. Label : "Fracture du radius gauche"
4. Gravité : 🔴 Grave
5. Notes : "Résultat de la chute. Guérison minimum 2 semaines de repos."
6. L'onglet devient rouge dans la nav

### Tableau de bord MJ
1. Lance **🎮 Tableau de bord MJ**
2. Tu vois tous les PJ avec PV/Mana/Fatigue en temps réel
3. Donne 25 XP à Aldric directement depuis le tableau
4. Clic sur une macro dans la colonne droite

---

## 12. TESTS JOUEUR (navigation privée)

En tant que joueur, vérifier :

**Ce que tu VOIS :**
- Ta fiche complète avec toutes les stats (y compris les 0)
- Ton illustration (pas le Token des autres)
- Tes blessures en lecture seule
- Les Notes RP du MJ si renseignées
- Les deux HUDs météo et terrain

**Ce que tu NE VOIS PAS :**
- Le bouton Token des autres personnages
- Les sections MJ (Génération, config secrète)
- Le TN en mode test secret

**Ce que tu PEUX FAIRE :**
- Changer ton illustration (clic sur l'image)
- Équiper/déséquiper tes items
- Utiliser Menu Combat (attaque, sort, déplacement)
- Lancer la Forge si tu as une recette

---

## 13. POINTS À VÉRIFIER / BUGS CONNUS

### ✅ Doit fonctionner
- [ ] Stats Total = Base + Niveau + Équipements
- [ ] PV diminuent sur le token quand dégâts appliqués
- [ ] Initiative lancée pour tous les combattants
- [ ] Slots d'action (attaque/sort/déplacement par tour)
- [ ] Message de fin de combat avec XP
- [ ] Cercle de portée du sort (8 secondes sur la carte)
- [ ] Badge météo sur la fiche sort
- [ ] Dialog d'état : scroll fonctionnel, même UI joueur/monstre

### 🟡 Comportements attendus
- La macro Forge demande validation MJ avant de consommer les ingrédients
- Le déplacement en terrain difficile coûte 2m pour 1m parcouru
- Si Fatigue = max → badge "Fatigué" + -10% stats
- Si Charge ≥ 90% → badge "Surchargé" + -1 vitesse
- Sort d'éclair lors d'un orage → -2 mana (badge vert sur la fiche)

### ❗ Si ça ne marche pas
- Recharge la page (F5) et réessaie
- Vérifie la console (F12) pour les erreurs JS
- Redémarre le serveur Foundry Node si les macros ne s'auto-installent pas

