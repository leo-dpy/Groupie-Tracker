package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
)

// --- STRUCTURES ---
type Artiste struct {
	Id           int      `json:"id"`
	Image        string   `json:"image"`
	Nom          string   `json:"name"`
	Membres      []string `json:"members"`
	DateCreation int      `json:"creationDate"`
	PremierAlbum string   `json:"firstAlbum"`
	RelationsUrl string   `json:"relations"`
}

type IndexRelations struct {
	Index []struct {
		Id             int                 `json:"id"`
		DatesLocations map[string][]string `json:"datesLocations"`
	} `json:"index"`
}

type PageDonnees struct {
	Titre     string
	Artiste   Artiste
	Relations map[string][]string
	Artistes  []Artiste
}

var (
	CacheArtistes  []Artiste
	CacheRelations map[int]map[string][]string
	MapArtisteID   map[int]Artiste
)

// Récupère les données des artistes et des relations depuis l'API externe de manière asynchrone
func chargerDonnees() {
	fmt.Println("SYSTEME: Chargement des données...")
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		resp, err := http.Get("https://groupietrackers.herokuapp.com/api/artists")
		if err == nil {
			defer resp.Body.Close()
			body, _ := ioutil.ReadAll(resp.Body)
			json.Unmarshal(body, &CacheArtistes)
			MapArtisteID = make(map[int]Artiste)
			for _, a := range CacheArtistes {
				MapArtisteID[a.Id] = a
			}
			fmt.Printf(" > %d Artistes chargés.\n", len(CacheArtistes))
		} else {
			fmt.Println("ERREUR FATALE API ARTISTES")
		}
	}()

	go func() {
		defer wg.Done()
		resp, err := http.Get("https://groupietrackers.herokuapp.com/api/relation")
		if err == nil {
			defer resp.Body.Close()
			body, _ := ioutil.ReadAll(resp.Body)
			var index IndexRelations
			json.Unmarshal(body, &index)
			CacheRelations = make(map[int]map[string][]string)
			for _, item := range index.Index {
				CacheRelations[item.Id] = item.DatesLocations
			}
			fmt.Println(" > Relations chargées.")
		}
	}()
	wg.Wait()
}

// Charge les templates HTML et injecte les données pour générer la réponse HTTP
func render(w http.ResponseWriter, tmpl string, data interface{}) {
	// On parse tous les fichiers à chaque fois pour éviter les erreurs de cache template
	tpls, err := template.ParseGlob("templates/*.html")
	if err != nil {
		fmt.Println("ERREUR TEMPLATE:", err)
		http.Error(w, "Erreur Serveur (Template manquant ou syntaxe): "+err.Error(), 500)
		return
	}

	err = tpls.ExecuteTemplate(w, tmpl, data)
	if err != nil {
		fmt.Println("ERREUR EXECUTION:", err)
		http.Error(w, "Erreur Rendu: "+err.Error(), 500)
	}
}

// Affiche la page d'accueil principale avec la structure de base
func routeAccueil(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Requête: Accueil")
	render(w, "base.html", PageDonnees{Titre: "Groupie Tracker", Artistes: CacheArtistes})
}

// Renvoie le fragment HTML de la liste des artistes
func routeApiIndex(w http.ResponseWriter, r *http.Request) {
	render(w, "liste_artistes.html", PageDonnees{Artistes: CacheArtistes})
}

// Renvoie le fragment HTML des détails d'un artiste spécifique
func routeApiDetail(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)

	if MapArtisteID[id].Id == 0 {
		http.Error(w, "Artiste Introuvable", 404)
		return
	}
	render(w, "details_artiste.html", PageDonnees{Artiste: MapArtisteID[id], Relations: CacheRelations[id]})
}

// Renvoie le fragment HTML de la bibliothèque utilisateur
func routeApiBiblio(w http.ResponseWriter, r *http.Request) {
	render(w, "bibliotheque.html", nil)
}

// Renvoie le fragment HTML de l'onglet YouTube Music
func routeApiYouTube(w http.ResponseWriter, r *http.Request) {
	render(w, "youtube_music.html", nil)
}

// Gère la recherche d'artistes par nom ou date de création
func routeApiRecherche(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(r.URL.Query().Get("q"))
	var res []Artiste
	for _, a := range CacheArtistes {
		if strings.Contains(strings.ToLower(a.Nom), q) || strings.Contains(strconv.Itoa(a.DateCreation), q) {
			res = append(res, a)
		}
	}
	render(w, "liste_artistes.html", PageDonnees{Artistes: res})
}

// [SECURITE] Proxy pour cacher la clé API YouTube
func routeApiProxyYouTube(w http.ResponseWriter, r *http.Request) {
	// 1. Récupérer la clé sécurisée depuis la variable d'environnement spécifiée
	apiKey := os.Getenv("Clé_API_youtube_data")

	if apiKey == "" {
		fmt.Println("ATTENTION: La variable d'environnement 'Clé_API_youtube_data' est vide ou introuvable.")
		http.Error(w, "Erreur configuration serveur : Clé API manquante", 500)
		return
	}

	// 2. Récupérer les paramètres envoyés par le JS
	q := r.URL.Query().Get("q")
	limit := r.URL.Query().Get("maxResults")
	if limit == "" {
		limit = "6"
	} // Par défaut 6 résultats

	// 3. Construire l'URL vers Google proprement
	safeQuery := url.QueryEscape(q)
	googleUrl := fmt.Sprintf(
		"https://www.googleapis.com/youtube/v3/search?part=snippet&q=%s&type=video&order=viewCount&maxResults=%s&key=%s",
		safeQuery,
		limit,
		apiKey,
	)

	// 4. Appel serveur à serveur (Go -> Google)
	resp, err := http.Get(googleUrl)
	if err != nil {
		http.Error(w, "Erreur de communication avec YouTube", 500)
		return
	}
	defer resp.Body.Close()

	// 5. Renvoyer le résultat JSON exact au JavaScript
	w.Header().Set("Content-Type", "application/json")
	body, _ := ioutil.ReadAll(resp.Body)
	w.Write(body)
}

// Point d'entrée de l'application : initialise les données, configure les routes et lance le serveur
func main() {
	chargerDonnees()

	// Gestion fichiers statiques
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))

	// Routes
	http.HandleFunc("/", routeAccueil)
	http.HandleFunc("/api/index", routeApiIndex)
	http.HandleFunc("/api/detail", routeApiDetail)
	http.HandleFunc("/api/biblio", routeApiBiblio)
	http.HandleFunc("/api/youtube", routeApiYouTube)
	http.HandleFunc("/api/recherche", routeApiRecherche)

	// [NOUVEAU] Route sécurisée pour YouTube
	http.HandleFunc("/api/yt-proxy", routeApiProxyYouTube)

	// 1. GESTION INTELLIGENTE DU PORT
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081" // On force le 8081 pour le portfolio
		fmt.Println("Mode Local : Démarrage Groupie Tracker sur http://localhost:8081")
	} else {
		fmt.Println("Mode Serveur : Démarrage sur le port :" + port)
	}

	// 2. LANCEMENT DU SERVEUR
	http.ListenAndServe(":"+port, nil)
}
