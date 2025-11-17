# Groupie-Tracker

Site statique qui recense des artistes via l'API publique Groupie Tracker.

## API

- Base: https://groupietrackers.herokuapp.com/api
  - artists: https://groupietrackers.herokuapp.com/api/artists
  - locations: https://groupietrackers.herokuapp.com/api/locations
  - dates: https://groupietrackers.herokuapp.com/api/dates
  - relation: https://groupietrackers.herokuapp.com/api/relation

Le site consomme `artists` puis, pour chaque artiste, suit les liens `locations`, `concertDates` et `relations`.

## Lancer en local

Les fichiers HTML/CSS/JS sont à la racine. Servez le dossier via un serveur statique:

```powershell
# Node (nécessite Node.js)
npx serve .

# Python 3
python -m http.server 5500
```

Ouvrez ensuite lURL affichée (ex: http://localhost:5500/).
