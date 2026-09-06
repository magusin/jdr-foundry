# Guide de progression — monstres et équipements

Ce guide répond à une seule question, à chaque niveau : **quels chiffres écrire
pour que le combat reste un combat et que les joueurs sentent qu'ils montent ?**

Tous les nombres qu'il contient sont *calculés* par le code du système
(`module/rules/item-value.js`, `module/rules/monster-archetypes.js`), pas
estimés à la louche. Si tu changes les réglages du monde, ils changent — le
guide dit lesquels et où.

---

## 0. À faire une fois : les quatre réglages du monde

Paramètres du jeu → Réglages du système. Tout le reste en dépend.

| Réglage | Ce que c'est | Valeur de départ |
|---|---|---|
| `peseeGroupeTaille` | Nombre de PJ à ta table | 3 |
| `peseeDegatsAttaque` | Dégâts moyens d'une attaque de PJ au niveau 1 | 7 |
| `peseeNiveauGroupe` | **Niveau réel de ton groupe, aujourd'hui** | 1 |
| `peseeRegenGroupe` | PV qu'un PJ récupère **par tour de combat**, équipement compris | 1 |

Le quatrième est le plus sous-estimé : un personnage régénère **1 PV par tour**
d'origine (`regeneration.pv`), et l'équipement fait monter ce chiffre. Une
créature qui n'inflige pas davantage que cette régen ne blessera **jamais**
personne, quel que soit le nombre de tours — le calibrage l'ajoute donc à la
menace visée avant de dimensionner les dés. Si ton groupe régénère 4 PV par
tour et que tu laisses le réglage à 1, tes monstres perdent trois points de
dégâts par tour chacun sans que rien ne le dise.

Le troisième est celui qu'on oublie. Mets-le à jour à chaque montée de niveau
du groupe : la pesée d'un objet, celle d'un sort et le calibrage des monstres
le lisent tous. Laissé à 1 pendant six niveaux, tout est jugé contre des
débutants et tout paraît « Épique ».

---

## 1. Le groupe de référence : la seule table à connaître

C'est l'étalon. Un PJ de niveau N gagne +1 à chaque principale (automatique),
~4 PV, ~+1 de dégâts moyens, et son équipement doit lui apporter la mitigation
indiquée. **Tout le reste du guide se déduit de cette table.**

| Niveau | PV d'un PJ | Dégâts par attaque | Mitigation visée | Score d'armure total | ...soit par pièce (7 pièces) | Dex/Acuité | Arme principale visée |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 7 | 5 % | 8 | ~2 | 5 | 1d6+0 (moy. 3.5) |
| 2 | 34 | 8 | 8 % | 14 | ~2 | 7 | 1d6+1 (moy. 4.5) |
| 3 | 38 | 9 | 11 % | 20 | ~3 | 9 | 1d6+1 (moy. 4.5) |
| 4 | 42 | 10 | 14 % | 26 | ~4 | 11 | 1d6+2 (moy. 5.5) |
| 5 | 46 | 11 | 17 % | 33 | ~5 | 13 | 1d6+2 (moy. 5.5) |
| 6 | 50 | 12 | 20 % | 40 | ~6 | 15 | 1d6+3 (moy. 6.5) |
| 7 | 54 | 13 | 23 % | 48 | ~7 | 17 | 1d6+3 (moy. 6.5) |
| 8 | 58 | 14 | 26 % | 56 | ~8 | 19 | 2d6+0 (moy. 7.0) |
| 9 | 62 | 15 | 29 % | 65 | ~10 | 21 | 2d6+1 (moy. 8.0) |
| 10 | 66 | 16 | 32 % | 75 | ~11 | 23 | 2d6+1 (moy. 8.0) |
| 11 | 70 | 17 | 35 % | 86 | ~13 | 25 | 2d6+2 (moy. 9.0) |
| 12 | 74 | 18 | 38 % | 98 | ~14 | 27 | 2d6+2 (moy. 9.0) |

Lecture pratique :

- **« Mitigation visée »** est ce que l'ÉQUIPEMENT doit produire, pas un cadeau
  automatique. Un groupe de niveau 8 sans armure à jour joue avec la mitigation
  du niveau 1 : il prend 26 % de dégâts en trop à chaque coup reçu, à tous les
  combats. C'est la première cause de « on trouve ça trop dur ».
- **« Score d'armure total »** est la somme de toutes les pièces portées, bonus
  d'Endurance compris (l'Endurance donne ⌊END/3⌋ de score et ⌊END/5⌋ de PV).
- **« Arme principale visée »** suppose une seconde main qui frappe aussi. Une
  arme à deux mains seule doit atteindre la colonne « Dégâts par attaque »
  entière.

---

## 2. Les monstres : arrête de remplir les plages à la main

### Le bouton

Fiche du monstre → onglet **🎲 Configuration aléatoire** :

1. **Niveaux possibles** : `2,4,6` (les niveaux auxquels cette créature peut
   apparaître).
2. **⚡ Calibrer (archétype)** ← le nouveau bouton.
3. Une fenêtre montre les sept archétypes **chiffrés à ton niveau**, avec leurs
   PV, leur armure, les dégâts de leur capacité, le nombre de tours que le
   groupe mettra à les abattre et l'XP qu'ils rapportent. Tu choisis sur des
   nombres, pas sur un adjectif.
4. Coche « créer aussi la capacité d'attaque recommandée » si la créature n'a
   pas encore d'attaque, et valide.

Toutes les plages de tous les niveaux déclarés sont remplies d'un coup, et le
bloc **Pesée** de la fiche affiche immédiatement le palier obtenu (Trivial /
Mineur / Sérieux / Élite / Boss). Les deux calculs sont indépendants : quand
ils tombent d'accord, ta créature est calibrée.

> ⚠️ **Un monstre n'a pas d'armes dans ce système.** Ses attaques *sont* ses
> items de type « sort ». Un monstre parfaitement calibré mais sans capacité
> est un sac de PV qui ne fait rien — c'est exactement l'effet « il manque des
> stats aux monstres » : les stats étaient là, la menace n'existait pas.
> Laisse la case cochée.

### Les sept archétypes

| Archétype | Rôle à la table | Combien en jeter |
|---|---|---|
| 🐀 **Piétaille** | figurant, tombe vite mais use le groupe | 6 |
| 🗡️ **Soldat** | l'unité de base d'une rencontre | 3 |
| 🪓 **Brute** | lente, blindée, frappe très fort | 1 (+ du menu fretin) |
| 🏹 **Rôdeur** | rapide, dur à toucher, fragile ; tire et décroche | 2 |
| ✨ **Mage** | frappe très fort à distance, s'effondre au contact | 2 (protégés par le reste) |
| 🛡️ **Élite** | mini-boss ; 9 tours et une capacité qui fait mal | 1 |
| 👑 **Boss** | combat de fin d'arc, 16 tours | 1, jamais accompagné d'un autre |

Le nombre d'exemplaires n'est pas décoratif : **le calibrage compte dessus**.
La régénération du groupe est un flux unique sur le PJ visé, pas un flux par
assaillant — elle est donc partagée entre les créatures de la rencontre. Jouer
une piétaille toute seule donne une créature inoffensive ; en jouer douze donne
un massacre.

### Ce que le bouton écrit, niveau par niveau

Les résistances élémentaires restent à **0** : elles relèvent du *thème* de la
créature (un élémentaire de feu, une ombre), pas de son calibrage. C'est à toi
de les saisir — et une valeur négative est une **vulnérabilité**, le levier le
plus intéressant du système pour récompenser un groupe qui prépare le combat.

#### Niveau 1

| Archétype | À jouer par | PV | Score arm./rés. | Armure fixe | Dex | End | Capacité(s) | Vitesse | XP | Palier (pesée) |
|---|---|---|---|---|---|---|---|---|---|---|
| 🐀 Piétaille | 6 | 11 | 13/7 | 0/0 | 5 | 3 | 1d6+1 | 8 m | 11 | Trivial |
| 🗡️ Soldat | 3 | 18 | 27/17 | 1/0 | 5 | 5 | 2d6+3 | 8 m | 25 | Mineur |
| 🪓 Brute | 1 | 24 | 51/20 | 2/0 | 4 | 8 | 5d6+5 | 6 m | 38 | Sérieux |
| 🏹 Rôdeur | 2 | 16 | 13/13 | 0/0 | 7 | 4 | 5d6+3 | 11 m | 30 | Sérieux |
| ✨ Mage | 2 | 16 | 7/52 | 0/1 | 4 | 3 | 5d6+4 | 7 m | 30 | Sérieux |
| 🛡️ Élite | 1 | 42 | 51/43 | 2/1 | 6 | 7 | 2d6+1 · 6d6+5 (recharge 2) | 9 m | 75 | Élite |
| 👑 Boss | 1 | 54 | 72/66 | 3/2 | 7 | 10 | 1d6+2 · 4d6+4 (recharge 2) | 9 m | 188 | Boss |

#### Niveau 3

| Archétype | À jouer par | PV | Score arm./rés. | Armure fixe | Dex | End | Capacité(s) | Vitesse | XP | Palier (pesée) |
|---|---|---|---|---|---|---|---|---|---|---|
| 🐀 Piétaille | 6 | 14 | 13/7 | 0/0 | 8 | 5 | 1d6+3 | 8 m | 11 | Trivial |
| 🗡️ Soldat | 3 | 21 | 25/15 | 1/0 | 9 | 9 | 3d6+1 | 8 m | 25 | Mineur |
| 🪓 Brute | 1 | 36 | 49/18 | 2/0 | 6 | 14 | 6d6+8 | 6 m | 38 | Élite |
| 🏹 Rôdeur | 2 | 20 | 12/12 | 0/0 | 13 | 6 | 6d6+6 | 11 m | 30 | Sérieux |
| ✨ Mage | 2 | 20 | 7/52 | 0/1 | 7 | 5 | 6d6+6 | 7 m | 30 | Sérieux |
| 🛡️ Élite | 1 | 63 | 49/41 | 2/1 | 11 | 13 | 2d6+2 · 7d6+8 (recharge 2) | 9 m | 75 | Élite |
| 👑 Boss | 1 | 90 | 69/63 | 3/2 | 12 | 18 | 1d6+3 · 5d6+5 (recharge 2) | 9 m | 188 | Boss |

#### Niveau 5

| Archétype | À jouer par | PV | Score arm./rés. | Armure fixe | Dex | End | Capacité(s) | Vitesse | XP | Palier (pesée) |
|---|---|---|---|---|---|---|---|---|---|---|
| 🐀 Piétaille | 6 | 17 | 12/6 | 0/0 | 12 | 8 | 2d6 | 8 m | 11 | Mineur |
| 🗡️ Soldat | 3 | 24 | 24/14 | 2/0 | 13 | 13 | 3d6+5 | 8 m | 25 | Sérieux |
| 🪓 Brute | 1 | 36 | 46/15 | 3/0 | 9 | 21 | 8d6+8 | 6 m | 38 | Élite |
| 🏹 Rôdeur | 2 | 25 | 11/11 | 0/0 | 18 | 9 | 8d6+6 | 11 m | 30 | Sérieux |
| ✨ Mage | 2 | 25 | 6/51 | 0/2 | 10 | 8 | 8d6+6 | 7 m | 30 | Sérieux |
| 🛡️ Élite | 1 | 63 | 47/39 | 3/2 | 16 | 18 | 3d6+1 · 9d6+10 (recharge 2) | 9 m | 75 | Élite |
| 👑 Boss | 1 | 90 | 67/61 | 4/3 | 17 | 26 | 2d6 · 6d6+7 (recharge 2) | 9 m | 188 | Boss |

#### Niveau 8

| Archétype | À jouer par | PV | Score arm./rés. | Armure fixe | Dex | End | Capacité(s) | Vitesse | XP | Palier (pesée) |
|---|---|---|---|---|---|---|---|---|---|---|
| 🐀 Piétaille | 6 | 20 | 11/5 | 0/0 | 17 | 11 | 2d6+3 | 8 m | 11 | Mineur |
| 🗡️ Soldat | 3 | 30 | 22/12 | 3/0 | 19 | 19 | 5d6+3 | 8 m | 25 | Sérieux |
| 🪓 Brute | 1 | 48 | 43/12 | 4/0 | 13 | 30 | 11d6+11 | 6 m | 38 | Élite |
| 🏹 Rôdeur | 2 | 29 | 10/10 | 0/0 | 27 | 13 | 11d6+10 | 11 m | 30 | Sérieux |
| ✨ Mage | 2 | 32 | 5/50 | 0/3 | 15 | 11 | 11d6+10 | 7 m | 30 | Élite |
| 🛡️ Élite | 1 | 84 | 44/36 | 4/3 | 23 | 27 | 3d6+5 · 13d6+12 (recharge 2) | 9 m | 75 | Boss |
| 👑 Boss | 1 | 126 | 63/57 | 5/4 | 25 | 38 | 2d6+2 · 8d6+10 (recharge 2) | 9 m | 188 | Boss |

#### Niveau 12

| Archétype | À jouer par | PV | Score arm./rés. | Armure fixe | Dex | End | Capacité(s) | Vitesse | XP | Palier (pesée) |
|---|---|---|---|---|---|---|---|---|---|---|
| 🐀 Piétaille | 6 | 26 | 9/3 | 0/0 | 24 | 16 | 3d6+4 | 8 m | 11 | Mineur |
| 🗡️ Soldat | 3 | 36 | 19/9 | 4/0 | 27 | 27 | 7d6+7 | 8 m | 25 | Sérieux |
| 🪓 Brute | 1 | 60 | 39/8 | 5/0 | 19 | 43 | 17d6+16 | 6 m | 38 | Élite |
| 🏹 Rôdeur | 2 | 34 | 8/8 | 0/0 | 38 | 19 | 15d6+14 | 11 m | 30 | Sérieux |
| ✨ Mage | 2 | 41 | 3/48 | 0/4 | 22 | 16 | 15d6+14 | 7 m | 30 | Élite |
| 🛡️ Élite | 1 | 105 | 41/33 | 5/4 | 32 | 38 | 5d6+6 · 19d6+19 (recharge 2) | 9 m | 75 | Boss |
| 👑 Boss | 1 | 162 | 57/51 | 6/5 | 35 | 54 | 3d6+4 · 13d6+12 (recharge 2) | 9 m | 188 | Boss |

---

## 2 bis. Ce que coûte réellement une rencontre

Ces chiffres sortent d'une **simulation** du combat avec les valeurs que le
bouton ⚡ écrit : les PJ concentrent leur feu, les monstres aussi, la régen
s'applique à chaque tour. Trois valeurs par case : **niveau 1 / 5 / 10**.

| Rencontre | Tours de combat | PV du groupe dépensés | Plus gros coup encaissé |
|---|---|---|---|
| 6 × 🐀 Piétaille | 8 / 8 / 8 | 49 % / 44 % / 46 % | 17 % / 15 % / 15 % |
| 3 × 🗡️ Soldat | 8 / 8 / 8 | 58 % / 55 % / 57 % | 33 % / 30 % / 30 % |
| 1 × 🪓 Brute | 5 / 5 / 4 | 43 % / 43 % / 32 % | 73 % / 70 % / 68 % |
| 2 × 🏹 Rôdeur | 4 / 4 / 4 | 44 % / 45 % / 45 % | 67 % / 65 % / 59 % |
| 2 × ✨ Mage | 4 / 4 / 4 | 47 % / 45 % / 46 % | 70 % / 65 % / 61 % |
| 1 × 🛡️ Élite | 9 / 9 / 9 | 60 % / 58 % / 58 % | 83 % / 78 % / 76 % |
| 1 × 👑 Boss | 18 / 16 / 16 | 96 % / 78 % / 77 % | 60 % / 54 % / 52 % |

Ce qu'il faut y lire :

- **Les combats sont longs, et c'est voulu.** Une bande de piétaille ou une
  escouade de soldats tient 8 tours ; un boss en tient 16. Le nombre de tours
  est réglé par l'objectif `tkill` de chaque archétype, pas par ses dégâts.
- **Les gros monstres tapent fort, et c'est voulu aussi.** Une brute, un
  rôdeur ou un mage enlèvent **60 à 73 % des PV d'un PJ en un seul coup**, et
  la capacité à recharge d'une élite peut en enlever 83 %. La menace n'est pas
  étalée à l'identique tous les tours : la capacité de base porte 60 % de la
  menace, la spéciale en porte 200 % et tombe un tour sur trois. Un gros coup
  qu'on voit venir se joue (on se protège, on écourte, on interpose le
  bouclier) ; la même menace lissée n'est qu'une soustraction.
- **Un boss est un vrai risque de mort**, et au **niveau 1-2 il est à la limite
  du massacre** (96 % des PV du groupe dépensés). À ces niveaux-là, préfère une
  élite ; garde le boss pour le niveau 3 et au-delà.
- La simulation est un **pire cas** : elle suppose zéro tactique, zéro soin,
  zéro terrain, et des monstres qui concentrent parfaitement leurs coups sur un
  seul PJ. À la vraie table, tes joueurs feront mieux — c'est justement là que
  le combat devient stratégique.

---

## 3. Composer une rencontre, et l'XP qui va avec

**100 XP par niveau**, partagés entre les PJ présents à la fin du combat
(`rules/combat-end.js`). L'XP écrite par le calibrage vise **quatre combats par
niveau** pour un groupe de 3 : chaque rencontre rapporte ~75 XP au total, soit
25 XP par PJ.

Une rencontre « normale » = **1 point de menace**, à composer librement :

| Créature | Vaut |
|---|---|
| Piétaille | 0,15 |
| Soldat | 0,33 |
| Rôdeur / Mage | 0,4 |
| Brute | 0,5 |
| Élite | 1 |
| Boss | 2,5 |

Exemples qui font 1 :
- 3 soldats (`0,33 × 3`) — la rencontre étalon ;
- 1 brute + 3 piétailles (`0,5 + 0,45`) — un mur et du bruit autour ;
- 1 mage + 1 rôdeur + 1 soldat (`0,4 + 0,4 + 0,33`) — les joueurs doivent
  choisir une cible ;
- 1 élite seule — un duel.

Un **boss** vaut 2,5 rencontres : c'est un combat qui consomme ~80 % des PV du
groupe. Ne l'accompagne pas d'une autre créature sérieuse, et prévois une
sortie (fuite, phase 2, renfort) plutôt qu'un TPK.

**Rythme conseillé par niveau** : 3 rencontres normales + 1 rencontre plus dure
(élite, ou double rencontre), et la montée de niveau tombe.

---

## 4. Les équipements : ce qui fait vraiment progresser

### La hiérarchie des champs, et elle est brutale

Tous les champs de la grille de bonus ne se valent pas, et l'écart est d'un
facteur 30. Ce que dit la pesée (`STAT_WEIGHTS`, `rules/item-value.js`) :

| Champ | Poids | Pourquoi |
|---|---|---|
| **Armure fixe / Résistance fixe** | **10** | Retirée de **chaque** coup reçu avant le pourcentage. Sur des coups à 7-18, +1 vaut ~10 % de tout ce que le porteur encaisse dans sa vie. |
| Toucher physique / magique | 10 | Le seuil ne tient que sur une bande de 10 valeurs : +1 = +5 points de % de touche, à chaque jet. |
| Vitesse | 4,5 | Un mètre sur une base de 8. |
| Force / Intelligence | 0,55 | Dégâts (⌊stat/`per`⌋) + pods ou mana. |
| Dextérité / Acuité | 1,4 | Un seuil de touché chacune. |
| **Score d'armure / de résistance** | **0,3** | Courbe `S/(S+160)` : le 50ᵉ point vaut le quart du premier. |

Conséquences directes pour écrire une pièce :

1. **Le score d'armure ne fera jamais monter une pièce de palier.** Une pièce
   qui apporte le score du niveau (colonne « par pièce » de la table du §1) pèse
   1 à 4 points : « Village ». C'est **normal et voulu** — elle fait pourtant
   exactement son travail, qui est de tenir la mitigation du groupe à jour. Ne
   la gonfle pas pour faire joli sur la pesée.
2. **1 point d'armure fixe ≈ 36 points de score d'armure.** C'est le levier des
   pièces marquantes, et celui qui casse une campagne s'il est distribué à la
   légère : sur les dix emplacements, +1 par pièce = 10 de réduction sur chaque
   coup, soit l'immunité aux petites armes. Compte au maximum **1 point
   d'armure fixe par tranche de 3 niveaux, sur l'ensemble du set**.
3. **Le toucher est le cadeau le plus discret et le plus fort.** +1 de toucher
   sur une arme, c'est +5 % de touche à chaque attaque, pour toujours.

### Combien vaut une pièce, à quel niveau ?

Le palier affiché par la pesée est une **échelle absolue de puissance**, pas
une échelle de niveau : une épée longue vaut « Commun » au niveau 1 comme au
niveau 10. Sers-t'en pour décider ce que la pièce est, et de la table du §1
pour décider **quand** la donner.

| Palier | Objet | Arme | À donner |
|---|---|---|---|
| Village | ≤ 5 | ≤ 20 | achat courant, butin de piétaille |
| Commun | ≤ 15 | ≤ 35 | récompense de rencontre, forge |
| Rare | ≤ 30 | ≤ 55 | fin de donjon, quête |
| Épique | ≤ 55 | ≤ 80 | fin d'arc narratif |
| Légendaire | au-delà | au-delà | une par campagne |

(Une arme à **deux mains** occupe deux emplacements : ses seuils sont relevés
de ×1,5, parce qu'elle doit valoir une arme *et* une main gauche.)

Quelques pièces types, pesées par le système :

| Pièce | Contenu | Pesée | Palier |
|---|---|---|---|
| Tunique de cuir | score d'armure 6 | 2 | Village |
| Cotte de mailles | score 20 + armure fixe 1 | 16 | Rare |
| Harnois | score 40 + fixe 2, vitesse −1 | 28 | Rare |
| Anneau de vigueur (relique) | +3 Endurance, +5 PV max | 12 | Commun |
| Amulette du duelliste (relique) | +1 toucher physique, +2 Dextérité | 13 | Commun |
| Épée courte | 1d6 | 18 | Village |
| Épée longue | 1d8+1 | 27 | Commun |
| Hache à deux mains | 2d6+2, scaling Force `per 5` | 39 | Commun |
| Arc | 1d8, +1 toucher physique | 33 | Commun |

Note le harnois : `vitesse −1` **retire** des points. Une pièce dont le total
est bas parce qu'elle a un vrai défaut est une bonne pièce, pas une pièce
ratée — c'est ce qui rend un choix d'équipement intéressant.

### Le levier à utiliser avant tous les autres : `damage.scaling.per`

Sur chaque arme : `system.damage.scaling = {stat, per, perStep}`. Le porteur
gagne ⌊stat ÷ `per`⌋ de dégâts. La base est `per 10`.

C'est **le** moyen de faire compter la Force ou l'Intelligence, et il se règle
arme par arme : une hache à deux mains à `per 5` rend le double d'une épée à
`per 10` pour le même guerrier. Ne touche pas à un diviseur global, ne gonfle
pas les stats de l'équipement — descends le `per` des armes qui doivent
récompenser la stat.

C'est aussi ce qui fait qu'une arme *grandit avec son porteur* : au niveau 1
une hache `per 5` rend +1, au niveau 8 elle rend +3. Une arme trouvée tôt peut
rester pertinente longtemps si son `per` est bas — voilà l'« avancée réelle »
sans inflation de butin.

---

## 5. Les erreurs qui reviennent

- **`peseeNiveauGroupe` laissé à 1.** Tout est jugé contre des débutants.
- **Des monstres jamais recalibrés.** Le bouton ⚡ se re-clique : ouvre les
  vieilles créatures, ajoute leur nouveau niveau dans « Niveaux possibles »,
  recalibre.
- **Un monstre sans capacité.** Il ne fait rien du tout. Regarde la ligne
  « menace » de sa pesée : à 0, il n'a pas d'attaque.
- **De l'armure fixe partout.** Trois pièces à +2 et les piétailles ne peuvent
  plus blesser personne — le combat devient une formalité, puis un mur le jour
  où le MJ compense.
- **Du score d'armure gonflé pour « faire Rare ».** La courbe absorbe tout : de
  40 à 80 de score, on passe de 20 % à 33 % de réduction. Mieux vaut +1 de
  toucher.
- **Oublier la vulnérabilité.** Une résistance élémentaire **négative** sur un
  monstre est la meilleure récompense que tu puisses donner à un groupe qui a
  enquêté avant le combat.
