package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"io/ioutil"
	"net/http"
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

// --- CHARGEMENT ---
func chargerDonnees() {
	fmt.Println("⏳ SYSTEME: Chargement des données...")
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
	fmt.Println("✅ SYSTEME: Prêt sur http://localhost:8080")
}

// --- UTILITAIRE DE RENDU (Pour éviter la page blanche) ---
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

// --- ROUTES ---

func routeAccueil(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Requête: Accueil")
	render(w, "base.html", PageDonnees{Titre: "Groupie Tracker V17", Artistes: CacheArtistes})
}

func routeApiIndex(w http.ResponseWriter, r *http.Request) {
	render(w, "liste_artistes.html", PageDonnees{Artistes: CacheArtistes})
}

func routeApiDetail(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)
	
	if MapArtisteID[id].Id == 0 {
		http.Error(w, "Artiste Introuvable", 404)
		return
	}
	render(w, "details_artiste.html", PageDonnees{Artiste: MapArtisteID[id], Relations: CacheRelations[id]})
}

func routeApiBiblio(w http.ResponseWriter, r *http.Request) {
	render(w, "bibliotheque.html", nil)
}

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

func main() {
	chargerDonnees()
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
	
	http.HandleFunc("/", routeAccueil)
	http.HandleFunc("/api/index", routeApiIndex)
	http.HandleFunc("/api/detail", routeApiDetail)
	http.HandleFunc("/api/biblio", routeApiBiblio)
	http.HandleFunc("/api/recherche", routeApiRecherche)

	http.ListenAndServe(":8080", nil)
}