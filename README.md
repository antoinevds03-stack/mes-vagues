# Mes Vagues

Prévisions de vagues épurées pour les spots de bodyboard et de surf du Morbihan et du Finistère.

- Tableau inspiré de surf-forecast, avec la légende et les heures toujours visibles.
- Note sur 10 en mode **bodyboard** (par défaut) ou **surf**, calculée pour chaque spot : taille, période, vent par rapport à l'orientation de la plage, angle de houle, marée préférée.
- Comparaison de quatre modèles (Météo-France MFWAM, ECMWF, GFS, DWD) avec un indice de confiance.
- Carnet de sessions pour noter son ressenti et le comparer à la prévision.
- Données en direct d'[Open-Meteo](https://open-meteo.com) à chaque ouverture.

---

## Mise en ligne (une seule fois, environ 10 minutes)

### 1. Créer le dépôt

1. Sur [github.com](https://github.com), clique sur **+** en haut à droite, puis **New repository**.
2. Nom : `mes-vagues`.
3. Visibilité : **Public**. C'est obligatoire pour héberger la page gratuitement avec GitHub Pages sur un compte gratuit.
4. Ne coche rien d'autre, puis **Create repository**.

### 2. Envoyer les fichiers

**Option A, depuis le navigateur (le plus simple)**

1. Décompresse `mes-vagues.zip` sur ton ordinateur.
2. Dans le dépôt vide, clique sur **uploading an existing file**.
3. Glisse **tout le contenu** du dossier `mes-vagues` dans la fenêtre, puis **Commit changes**.
4. Le dossier `.github` est caché par défaut. Sous Linux Mint, affiche-le avec **Ctrl + H** dans le gestionnaire de fichiers avant de glisser. S'il n'est pas parti, crée le fichier à la main : **Add file → Create new file**, nom `.github/workflows/archive.yml`, colle le contenu du fichier du zip, puis **Commit changes**.

**Option B, depuis le terminal**

```bash
cd mes-vagues
git init -b main
git add .
git commit -m "Première version"
gh auth login          # une seule fois, pour te connecter à GitHub
gh repo create mes-vagues --public --source . --push
```

### 3. Activer la page

1. Dans le dépôt : **Settings → Pages**.
2. **Build and deployment → Source : Deploy from a branch**.
3. Branche **main**, dossier **/ (root)**, puis **Save**.
4. Après une ou deux minutes, l'appli est en ligne à l'adresse `https://<ton-pseudo>.github.io/mes-vagues/`.

### 4. Lancer l'archivage une première fois

1. Onglet **Actions**. Si GitHub le demande, active les workflows.
2. Clique sur **Archiver les prévisions**, puis **Run workflow**.
3. Ensuite, il tourne tout seul chaque matin vers 6 h.

Si l'étape « Enregistrer dans le dépôt » échoue avec une erreur de permission : **Settings → Actions → General → Workflow permissions → Read and write permissions → Save**, puis relance.

### 5. Installer l'appli sur ton téléphone

- **iPhone** : ouvre l'adresse dans Safari, touche **Partager**, puis **Sur l'écran d'accueil**.
- **Android** : ouvre l'adresse dans Chrome, touche **⋮**, puis **Ajouter à l'écran d'accueil**.

---

## Comment c'est organisé

| Fichier | Rôle |
| --- | --- |
| `index.html` | L'appli. Elle interroge Open-Meteo à chaque ouverture. Si Open-Meteo ne répond pas, elle affiche `data/latest.json`. |
| `spots.json` | La fiche de chaque spot. C'est le seul fichier à modifier pour ajouter ou corriger un spot. |
| `scripts/archive_forecast.py` | Récupère les prévisions des quatre modèles et écrit `data/latest.json` et l'archive du jour. Aucune installation nécessaire. |
| `.github/workflows/archive.yml` | Lance le script chaque matin et enregistre le résultat dans le dépôt. |
| `data/archive/AAAA/AAAA-MM-JJ.json` | Prévisions horaires brutes des quatre modèles sur 72 h, gardées pour la calibration. |
| `manifest.webmanifest`, `icons/` | Pour installer l'appli sur l'écran d'accueil. |
| `docs/ROADMAP.md` | Les prochaines étapes du projet. |

### Le carnet de sessions

Sur cette version, le carnet est enregistré **dans le téléphone** (stockage du navigateur). Il ne passe pas d'un appareil à l'autre. Le bouton **Copier mon carnet** l'exporte en texte, pour le sauvegarder ou l'analyser.

### Les champs de `spots.json`

| Champ | Signification |
| --- | --- |
| `id`, `name`, `town`, `zone` | Identifiant, nom affiché, commune, secteur. |
| `fav` | `true` pour afficher le spot dans « Mes spots ». |
| `lat`, `lon` | Point sur le rivage. La prévision est prise 4 km au large, dans l'axe de la plage. |
| `face` | Direction vers laquelle la plage regarde le large, en degrés, mesurée sur le trait de côte OpenStreetMap. Sert à calculer offshore, side-off, onshore… |
| `ideal` | Direction de houle idéale selon les guides de surf. |
| `tide` | Marée préférée : `{"ok": ["low", "mid", "high"], "rising": true}`. `low` = basse, `mid` = mi-marée, `high` = haute, `rising` = de préférence à la montante. `null` si on ne sait pas. |
| `bbTide` | Marée préférée en mode bodyboard, quand elle diffère de `tide`. |
| `tideNote`, `wave`, `bottom`, `notes` | Textes affichés dans le détail du spot. |
| `src` | Sources des informations : `[["Nom", "https://…"]]`. |

---

## Comment la note et la confiance sont calculées

- **Hauteur et période** : médiane des modèles. DWD compte pour moitié, car sa physique est proche de celle de Météo-France et d'ECMWF. La médiane résiste mieux qu'une moyenne quand un modèle s'écarte.
- **Confiance** : verte si au moins 3 modèles sur 4 sont à ±25 % de la médiane, orange si 2 sur 4, rouge sinon. Elle baisse d'un cran si les directions des modèles d'accord s'écartent de plus de 30°, ou si leurs périodes s'écartent de plus de 3 s. Au-delà de 4 jours, elle ne dépasse pas orange. Au-delà de 6 jours, la case est en pointillé : c'est une tendance.
- **Note bodyboard** : idéale entre 0,6 et 1,8 m, avec une période de 10 à 12 s, un vent offshore ou faible, et la marée préférée du spot.
- **Note surf** : idéale entre 1,5 et 2,5 m, et les périodes longues sont mieux notées.

---

## Données et licences

- Prévisions : [Open-Meteo](https://open-meteo.com), licence CC BY 4.0, gratuit pour un usage non commercial.
- Trait de côte : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Fiches spots : Surf-Forecast, Mondo Surf, plages.tv, The Surf Atlas. Liens dans `spots.json` et dans l'appli.
- Marée : modélisée par Open-Meteo. Les horaires de pleine et basse mer sont fiables, l'amplitude est indicative.
