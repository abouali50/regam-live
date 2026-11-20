# Reproduire les 24 explications visuelles

Ces clips sont des séquences de calcul commentées à l’écrit, sans piste audio.
Chaque image et la description du lecteur le signalent explicitement.
Les sept clips sur les formes indéterminées ont déjà une narration séparée.

## Dépendances de création

Python 3.10 ou plus récent, Pillow avec RAQM, NumPy, matplotlib 3.10 et FFmpeg
avec ffprobe. Les polices DejaVu et Noto, ainsi que leurs notices de licence,
sont fournies dans `tools/fonts/`. Le site hébergé ne requiert aucune de ces
dépendances.

Depuis la racine du projet :

```bash
python3 scripts/render_visual_explainers.py
```

Le script lit les quatre fichiers de cours dans `content/`, prend leur champ
`videoLesson`, vérifie le rendu des formules, crée 138 étapes puis produit
24 fichiers MP4 H.264 silencieux de 1600 × 900 pixels et leurs affiches JPEG.
Les frames et la planche contact intermédiaires sont écrites dans `video_build/`.
Le catalogue `content/video_catalog_extra.json` est recréé, puis
`scripts/build_content.py` met à jour le catalogue public du site.

Pour inspecter seulement les images avant l’encodage :

```bash
python3 scripts/render_visual_explainers.py --frames-only
```

Le temps de lecture est déterminé à partir de la longueur du texte écrit,
avec 6,5 à 12,5 secondes par étape. Le lecteur natif permet de mettre en pause,
de revenir en arrière et de régler la vitesse. Aucune synchronisation vocale
n’est revendiquée pour ces clips silencieux.

Le calcul est écrit en TeX et rasterisé par matplotlib. Les quelques syntaxes
normalisées (`\frac`, `\mathbb`, `\boxed`, `\iff`) changent seulement la mise
en forme pour ce moteur. Aucun calcul n’est confié à un générateur d’images.
