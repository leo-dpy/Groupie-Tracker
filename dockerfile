# --- ÉTAPE 1 : Compilation (L'Atelier) ---
FROM golang:1.25-alpine AS builder

# On installe les outils de build de base
RUN apk add --no-cache git

WORKDIR /app

# Gestion des dépendances
COPY go.mod ./
# go.sum garantit des builds reproductibles en figeant les versions des dépendances
COPY go.sum ./
RUN go mod download

# On copie le code source
COPY . .

# On compile le binaire (statique pour plus de stabilité)
RUN CGO_ENABLED=0 GOOS=linux go build -o groupie-tracker .

# --- ÉTAPE 2 : Exécution (Le Magasin) ---
FROM alpine:3.23

# Certificats CA obligatoires pour appeler l'API externe en HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /app

# On récupère le binaire et les dossiers nécessaires
COPY --from=builder /app/groupie-tracker .
COPY --from=builder /app/static ./static
COPY --from=builder /app/templates ./templates

# Le port exposé par défaut est le 80.
# L'application écoutera sur le port défini par la variable d'environnement PORT, ou 80 si non définie.
EXPOSE 80

# Lancement de l'application
# N'oubliez pas de passer votre clé API YouTube au démarrage !
# Exemple : docker run -p 8080:80 -e YOUTUBE_API_KEY="votre_clé_ici" -e PORT="80" votre-image-docker
CMD ["./groupie-tracker"]