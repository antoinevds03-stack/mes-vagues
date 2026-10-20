# Feuille de route

Les étapes dans l'ordre où elles apportent le plus.

## 1. Accumuler des archives (en cours, automatique)

L'action GitHub enregistre une fois par jour les prévisions des quatre modèles sur 72 h dans `data/archive/`. Il faut environ un mois d'archives avant de pouvoir mesurer des biais.

## 2. Calibrer avec les bouées

- Identifier les bouées de houle les plus proches des secteurs : Iroise, Finistère sud, Morbihan. Le réseau CANDHIS du Cerema publie des mesures de houle sur les côtes françaises.
- Vérifier comment récupérer leurs mesures (téléchargement, accès en temps réel, conditions d'utilisation).
- Comparer les mesures aux prévisions archivées à 0–24 h, par modèle et par secteur.
- En déduire une correction simple par secteur et par modèle, par exemple « ECMWF surestime de 10 % en Iroise par houle d'ouest », et l'appliquer dans l'appli.

Limite : une bouée mesure la houle au large, pas ce qui arrive sur le banc de sable. Le carnet de sessions mesure ce dernier kilomètre.

## 3. Recaler la note avec le carnet

Après une dizaine de sessions notées :

- Comparer le ressenti à la note prévue, spot par spot.
- Repérer les conditions des meilleures sessions : taille, période, vent, marée, forme des vagues.
- Ajuster les courbes de la note bodyboard en conséquence.

Pour l'instant, le carnet de la version GitHub reste dans le téléphone. **Copier mon carnet** permet de l'exporter.

## 4. Ajouter un modèle côtier haute résolution

L'Ifremer publie des prévisions WAVEWATCH III à 200 m sous licence ouverte (projet MARC). C'est le seul moyen de distinguer des spots voisins qui partagent aujourd'hui la même maille, comme Port Blanc et Penthièvre, ou La Palue et Goulien. Ce serait aussi un modèle de physique différente des trois modèles de la famille WAM.

- Vérifier qu'une grille couvre Quiberon et Crozon. Celle trouvée pour l'instant, « Armor », couvre la côte nord.
- Si oui : script d'extraction des points des spots (fichiers NetCDF) dans l'action GitHub, ajout dans `data/latest.json`.
- Pondération proposée : 60–70 % sur 0–48 h. DWD sort alors de la comparaison.

## 5. Carnet partagé et communauté

- Stocker les sessions dans une petite base de données en ligne, pour retrouver le carnet sur plusieurs appareils et partager les ressentis par spot.
- Afficher sur chaque spot le ressenti moyen des riders et les conditions où il marche le mieux.

## 6. Alertes (fait)

Alertes ntfy par spot, calculées toutes les 3 heures par `scripts/alerts.mjs` avec la même note que l'appli. Pistes :

- un canal « tendance » qui prévient quand une tempête se termine ou qu'une grosse houle arrive ;
- un seuil par spot (par exemple 6/10 pour un spot rare, 8/10 pour un spot qui marche souvent) ;
- brancher aussi le bot Telegram existant, si ntfy ne suffit pas.

## 7. Spots à ajouter

À vérifier avec des sources fiables et à mesurer sur le trait de côte avant de les ajouter : Fort Bloqué, Gouérou, Pors Carn et Tronoën, Barre d'Étel, Donnant (Belle-Île).
