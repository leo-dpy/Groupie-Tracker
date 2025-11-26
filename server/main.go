package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const baseDistante = "https://groupietrackers.herokuapp.com/api"
const baseYT = "https://www.googleapis.com/youtube/v3"

// Modèles de données
type Artiste struct {
	ID           int      `json:"id"`
	Image        string   `json:"image"`
	Name         string   `json:"name"`
	Members      []string `json:"members"`
	CreationDate int      `json:"creationDate"`
	FirstAlbum   string   `json:"firstAlbum"`
	Locations    string   `json:"locations"`
	ConcertDates string   `json:"concertDates"`
	Relations    string   `json:"relations"`
}

type Lieu struct {
	ID        int      `json:"id"`
	Locations []string `json:"locations"`
	Dates     string   `json:"dates"`
}

type InfoDate struct {
	ID    int      `json:"id"`
	Dates []string `json:"dates"`
}

type Relation struct {
	ID             int                 `json:"id"`
	DatesLocations map[string][]string `json:"datesLocations"`
}

type IndexRelations struct {
	Index []Relation `json:"index"`
}

type ArtisteCombine struct {
	Artiste
	Shows []Concert `json:"shows,omitempty"`
}

type Concert struct {
	Date     string `json:"date"`
	Location string `json:"location"`
}

// Cache simple en mémoire
var (
	verrouCache sync.Mutex
	cache       = map[string]entreeCache{}
	dureeVie    = 5 * time.Minute
)

type entreeCache struct {
	Donnees   []byte
	ExpireLe  time.Time
	Type      string
}

func obtenirAvecCache(url string) (donnees []byte, typeContenu string, err error) {
	verrouCache.Lock()
	if e, ok := cache[url]; ok && time.Now().Before(e.ExpireLe) {
		donnees, typeContenu = e.Donnees, e.Type
		verrouCache.Unlock()
		return
	}
	verrouCache.Unlock()

	resp, err := http.Get(url)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	typeContenu = resp.Header.Get("Content-Type")
	if typeContenu == "" {
		typeContenu = "application/json; charset=utf-8"
	}

	// Ne pas mettre en cache les réponses d'erreur (>=400)
	if resp.StatusCode >= 400 {
		return nil, typeContenu, &erreurHTTP{CodeStatut: resp.StatusCode, Message: string(b)}
	}

	verrouCache.Lock()
	cache[url] = entreeCache{Donnees: b, ExpireLe: time.Now().Add(dureeVie), Type: typeContenu}
	verrouCache.Unlock()
	return b, typeContenu, nil
}

type erreurHTTP struct {
	CodeStatut int
	Message    string
}

func (e *erreurHTTP) Error() string { return e.Message }

// Récupérer et analyser le JSON depuis l'API externe
func recupererEtParser(endpoint string, v interface{}) error {
	url := baseDistante + endpoint
	b, _, err := obtenirAvecCache(url)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// Obtenir toutes les données et les combiner
func obtenirDonneesCombinees() ([]ArtisteCombine, error) {
	var artistes []Artiste
	var donneesRelations IndexRelations

	// Récupérer les artistes et les relations en parallèle
	var wg sync.WaitGroup
	var errArtistes, errRelations error

	wg.Add(2)
	go func() {
		defer wg.Done()
		errArtistes = recupererEtParser("/artists", &artistes)
	}()
	go func() {
		defer wg.Done()
		errRelations = recupererEtParser("/relation", &donneesRelations)
	}()
	wg.Wait()

	if errArtistes != nil {
		return nil, fmt.Errorf("échec de la récupération des artistes : %w", errArtistes)
	}
	if errRelations != nil {
		return nil, fmt.Errorf("échec de la récupération des relations : %w", errRelations)
	}

	// Construire une carte d'ID d'artiste vers les concerts
	carteRelations := make(map[int][]Concert)
	for _, rel := range donneesRelations.Index {
		var concerts []Concert
		for lieu, dates := range rel.DatesLocations {
			for _, date := range dates {
				concerts = append(concerts, Concert{
					Date:     date,
					Location: lieu,
				})
			}
		}
		carteRelations[rel.ID] = concerts
	}

	// Combiner les artistes avec leurs concerts
	combines := make([]ArtisteCombine, len(artistes))
	for i, artiste := range artistes {
		combines[i] = ArtisteCombine{
			Artiste: artiste,
			Shows:   carteRelations[artiste.ID],
		}
	}

	return combines, nil
}

// Gestionnaire pour /api/combines - renvoie les données enrichies des artistes
func gestionnaireCombines(w http.ResponseWriter, r *http.Request) {
	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(donnees)
}

// Gestionnaire pour /api/recherche?q=terme - filtrage côté serveur
func gestionnaireRecherche(w http.ResponseWriter, r *http.Request) {
	requete := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("q")))

	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	// Si pas de requête, tout renvoyer
	if requete == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(donnees)
		return
	}

	// Filtrer par nom ou membres
	var filtrés []ArtisteCombine
	for _, artiste := range donnees {
		if strings.Contains(strings.ToLower(artiste.Name), requete) {
			filtrés = append(filtrés, artiste)
			continue
		}
		for _, membre := range artiste.Members {
			if strings.Contains(strings.ToLower(membre), requete) {
				filtrés = append(filtrés, artiste)
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(filtrés)
}

// Gestionnaire pour /api/artiste/:id - obtenir un seul artiste avec ses concerts
func gestionnaireArtisteParID(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/artiste/")
	if idStr == "" {
		http.Error(w, "ID d'artiste requis", http.StatusBadRequest)
		return
	}

	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	// Trouver l'artiste par ID (correspondance de chaîne simple)
	for _, artiste := range donnees {
		if fmt.Sprint(artiste.ID) == idStr {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			json.NewEncoder(w).Encode(artiste)
			return
		}
	}

	http.Error(w, "artiste non trouvé", http.StatusNotFound)
}

// Proxy hérité pour la rétrocompatibilité (gardé minimal)
func proxyAPI(w http.ResponseWriter, r *http.Request) {
	chemin := strings.TrimPrefix(r.URL.Path, "/api")
	if chemin == "" || chemin == "/" {
		b, typeContenu, err := obtenirAvecCache(baseDistante)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", typeContenu)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	url := baseDistante + chemin
	b, typeContenu, err := obtenirAvecCache(url)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", typeContenu)
	w.WriteHeader(http.StatusOK)
	w.Write(b)
}

func proxyYT(w http.ResponseWriter, r *http.Request) {
	cle := os.Getenv("YT_API_KEY")
	if cle == "" {
		cle = os.Getenv("YOUTUBE_API_KEY") // Vérifier aussi YOUTUBE_API_KEY
	}
	if cle == "" {
		http.Error(w, "Clé API YouTube manquante. Définissez la variable d'env YT_API_KEY ou YOUTUBE_API_KEY.", http.StatusServiceUnavailable)
		return
	}
	chemin := strings.TrimPrefix(r.URL.Path, "/yt")
	if chemin == "" || chemin == "/" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"endpoints":"/yt/search"}`))
		return
	}
	// Passage /search
	if strings.HasPrefix(chemin, "/search") {
		u, _ := url.Parse(baseYT + "/search")
		q := u.Query()
		for k, vals := range r.URL.Query() {
			for _, v := range vals {
				q.Add(k, v)
			}
		}
		if q.Get("part") == "" {
			q.Set("part", "snippet")
		}
		if q.Get("type") == "" {
			q.Set("type", "video")
		}
		if q.Get("maxResults") == "" {
			q.Set("maxResults", "3")
		}
		q.Set("key", cle)
		u.RawQuery = q.Encode()

		req, err := http.NewRequest("GET", u.String(), nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		req.Header.Set("Referer", "http://localhost:8080/")
		client := &http.Client{Timeout: 12 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if resp.StatusCode >= 400 {
			http.Error(w, string(b), resp.StatusCode)
			return
		}
		typeContenu := resp.Header.Get("Content-Type")
		if typeContenu == "" {
			typeContenu = "application/json; charset=utf-8"
		}
		w.Header().Set("Content-Type", typeContenu)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	// Passage /videos
	if strings.HasPrefix(chemin, "/videos") {
		u, _ := url.Parse(baseYT + "/videos")
		q := u.Query()
		for k, vals := range r.URL.Query() {
			for _, v := range vals {
				q.Add(k, v)
			}
		}
		if q.Get("part") == "" {
			q.Set("part", "snippet,contentDetails")
		}
		q.Set("key", cle)
		u.RawQuery = q.Encode()

		req, err := http.NewRequest("GET", u.String(), nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		req.Header.Set("Referer", "http://localhost:8080/")
		client := &http.Client{Timeout: 12 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if resp.StatusCode >= 400 {
			http.Error(w, string(b), resp.StatusCode)
			return
		}
		typeContenu := resp.Header.Get("Content-Type")
		if typeContenu == "" {
			typeContenu = "application/json; charset=utf-8"
		}
		w.Header().Set("Content-Type", typeContenu)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}
	http.NotFound(w, r)
}

func avecJournalisation(suivant http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		debut := time.Now()
		suivant.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(debut))
	})
}

func main() {
	mux := http.NewServeMux()

	// Nouveaux points de terminaison propulsés par Go avec manipulation de données
	mux.HandleFunc("/api/combines", gestionnaireCombines)
	mux.HandleFunc("/api/recherche", gestionnaireRecherche)
	mux.HandleFunc("/api/artiste/", gestionnaireArtisteParID)

	// Proxy hérité (pour accès brut si nécessaire)
	mux.HandleFunc("/api/artists", proxyAPI)
	mux.HandleFunc("/api/locations", proxyAPI)
	mux.HandleFunc("/api/dates", proxyAPI)
	mux.HandleFunc("/api/relation", proxyAPI)
	mux.HandleFunc("/api", proxyAPI)
	mux.HandleFunc("/api/", proxyAPI)

	// Proxy YouTube
	mux.HandleFunc("/yt", proxyYT)
	mux.HandleFunc("/yt/", proxyYT)

	// Déterminer le répertoire racine pour les fichiers statiques
	repRacine := "."
	if _, err := os.Stat("html"); os.IsNotExist(err) {
		if _, err := os.Stat("../html"); err == nil {
			repRacine = ".."
		}
	}

	// Fichiers statiques depuis la racine du projet
	fs := http.FileServer(http.Dir(repRacine))
	// Servir l'index à la racine depuis html/index.html pour une URL plus propre
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(repRacine, "html", "index.html"))
	})

	adresse := ":8080"
	if depuisEnv := os.Getenv("PORT"); depuisEnv != "" {
		adresse = ":" + depuisEnv
	}

	abs, _ := filepath.Abs(".")
	log.Printf("Serveur démarré sur %s à http://localhost%s", abs, adresse)
	log.Printf("Points de terminaison API : /api/combines, /api/recherche?q=terme, /api/artiste/:id")
	if err := http.ListenAndServe(adresse, avecJournalisation(mux)); err != nil {
		log.Fatal(err)
	}
}
