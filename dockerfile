# --- ÉTAPE 1 : Compilation (L'Atelier) ---
FROM golang:1.21-alpine AS builder

# On installe les outils de build de base
RUN apk add --no-cache git

WORKDIR /app

# Gestion des dépendances
COPY go.mod ./
# Si tu as un fichier go.sum, décommente la ligne suivante :
# COPY go.sum ./
RUN go mod download

# On copie le code source
COPY . .

# On compile le binaire (statique pour plus de stabilité)
RUN CGO_ENABLED=0 GOOS=linux go build -o groupie-tracker .

# --- ÉTAPE 2 : Exécution (Le Magasin) ---
FROM alpine:latest

# Certificats CA obligatoires pour appeler l'API externe en HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# On récupère le binaire et les dossiers nécessaires
COPY --from=builder /app/groupie-tracker .
COPY --from=builder /app/static ./static
COPY --from=builder /app/templates ./templates

# Configuration Maniaque : Port unique 80
EXPOSE 80

# Lancement de l'application
CMD ["./groupie-tracker"]