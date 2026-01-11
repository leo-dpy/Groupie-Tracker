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

// Affiche la page d'accueil principale
func routeAccueil(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Requête: Accueil")
	render(w, "base.html", PageDonnees{Titre: "Groupie Tracker", Artistes: CacheArtistes})
}

// Renvoie la liste des artistes
func routeApiIndex(w http.ResponseWriter, r *http.Request) {
	render(w, "liste_artistes.html", PageDonnees{Artistes: CacheArtistes})
}

// Renvoie les détails d'un artiste
func routeApiDetail(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)

	if MapArtisteID[id].Id == 0 {
		http.Error(w, "Artiste Introuvable", 404)
		return
	}
	render(w, "details_artiste.html", PageDonnees{Artiste: MapArtisteID[id], Relations: CacheRelations[id]})
}

// Renvoie la bibliothèque utilisateur
func routeApiBiblio(w http.ResponseWriter, r *http.Request) {
	render(w, "bibliotheque.html", nil)
}

// Renvoie l'onglet YouTube Music
func routeApiYouTube(w http.ResponseWriter, r *http.Request) {
	render(w, "youtube_music.html", nil)
}

// Gère la recherche d'artistes
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

// [SECURITE] Proxy YouTube propre (Authentification via IP Serveur)
func routeApiProxyYouTube(w http.ResponseWriter, r *http.Request) {
	// 1. Récupération de la clé (Variable Coolify)
	apiKey := os.Getenv("Clé_API_youtube_data")

	if apiKey == "" {
		fmt.Println("ATTENTION: Variable 'Clé_API_youtube_data' vide.")
		http.Error(w, "Erreur configuration serveur", 500)
		return
	}

	// 2. Paramètres
	q := r.URL.Query().Get("q")
	limit := r.URL.Query().Get("maxResults")
	if limit == "" {
		limit = "6"
	}

	// 3. Construction URL Google
	safeQuery := url.QueryEscape(q)
	googleUrl := fmt.Sprintf(
		"https://www.googleapis.com/youtube/v3/search?part=snippet&q=%s&type=video&order=viewCount&maxResults=%s&key=%s",
		safeQuery,
		limit,
		apiKey,
	)

	// 4. Appel Simple (L'IP du serveur validera l'accès)
	resp, err := http.Get(googleUrl)
	if err != nil {
		http.Error(w, "Erreur YouTube", 500)
		return
	}
	defer resp.Body.Close()

	// 5. Réponse
	w.Header().Set("Content-Type", "application/json")
	body, _ := ioutil.ReadAll(resp.Body)
	w.Write(body)
}

func main() {
	chargerDonnees()

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))

	http.HandleFunc("/", routeAccueil)
	http.HandleFunc("/api/index", routeApiIndex)
	http.HandleFunc("/api/detail", routeApiDetail)
	http.HandleFunc("/api/biblio", routeApiBiblio)
	http.HandleFunc("/api/youtube", routeApiYouTube)
	http.HandleFunc("/api/recherche", routeApiRecherche)

	// Route Proxy
	http.HandleFunc("/api/yt-proxy", routeApiProxyYouTube)

	// Démarrage
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
		fmt.Println("Mode Local : http://localhost:8081")
	} else {
		fmt.Println("Mode Serveur : Port " + port)
	}

	http.ListenAndServe(":"+port, nil)
}
