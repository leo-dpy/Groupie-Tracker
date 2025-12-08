package main

import (
	"encoding/json"
	"fmt"
	"html/template"
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
	Videos []Video   `json:"videos,omitempty"`
}

type Video struct {
	ID    string `json:"id"`
	Title string `json:"title"`
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
	templates   *template.Template
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
	// Support both French and English endpoints
	idStr := strings.TrimPrefix(r.URL.Path, "/api/artiste/")
	idStr = strings.TrimPrefix(idStr, "/api/artist/")

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

func getVideosForArtist(artistName string) []Video {
	apiKey := os.Getenv("YT_API_KEY")
	if apiKey == "" {
		log.Println("YT_API_KEY missing")
		return nil
	}

	// 1. Search for channel/artist
	query := url.QueryEscape(artistName + " official")
	searchURL := fmt.Sprintf("%s/search?q=%s&type=channel&maxResults=1&part=snippet&key=%s", baseYT, query, apiKey)
	
	log.Printf("Fetching Channel: %s", searchURL) // DEBUG

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		log.Printf("NewRequest Error: %v", err)
		return nil
	}
	req.Header.Set("Referer", "http://localhost:8080/")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("YT Search Error: %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("YT API Error (Channel): %s - %s", resp.Status, string(body))
		// Fallback to keyword search immediately if channel search fails (e.g. 403 quota or 404)
	}

	var searchRes struct {
		Items []struct {
			ID struct {
				ChannelID string `json:"channelId"`
			} `json:"id"`
		} `json:"items"`
	}
	// Decode even if error to avoid crash, but items will be empty
	_ = json.NewDecoder(resp.Body).Decode(&searchRes)

	var channelID string
	if len(searchRes.Items) > 0 {
		channelID = searchRes.Items[0].ID.ChannelID
		log.Printf("Found Channel ID: %s", channelID)
	} else {
		log.Printf("No Channel ID found for %s", artistName)
	}

	// 2. Search for videos (by channel if found, else by keyword)
	var videoURL string
	if channelID != "" {
		videoURL = fmt.Sprintf("%s/search?channelId=%s&type=video&videoEmbeddable=true&order=viewCount&maxResults=5&part=snippet&key=%s", baseYT, channelID, apiKey)
	} else {
		q2 := url.QueryEscape(artistName + " official audio")
		videoURL = fmt.Sprintf("%s/search?q=%s&type=video&videoEmbeddable=true&maxResults=5&part=snippet&key=%s", baseYT, q2, apiKey)
	}

	log.Printf("Fetching Videos: %s", videoURL) // DEBUG
	
	reqV, err := http.NewRequest("GET", videoURL, nil)
	if err != nil {
		return nil
	}
	reqV.Header.Set("Referer", "http://localhost:8080/")

	respV, err := client.Do(reqV)
	if err != nil {
		log.Printf("YT Video Fetch Error: %v", err)
		return nil
	}
	defer respV.Body.Close()

	if respV.StatusCode != 200 {
		body, _ := io.ReadAll(respV.Body)
		log.Printf("YT API Error (Videos): %s - %s", respV.Status, string(body))
		return nil
	}

	var videoRes struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(respV.Body).Decode(&videoRes); err != nil {
		log.Printf("JSON Decode Error: %v", err)
		return nil
	}

	var videos []Video
	for _, item := range videoRes.Items {
		if item.ID.VideoID != "" {
			videos = append(videos, Video{
				ID:    item.ID.VideoID,
				Title: item.Snippet.Title,
			})
		}
	}
	log.Printf("Found %d videos for %s", len(videos), artistName)
	return videos
}

func avecJournalisation(suivant http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		debut := time.Now()
		suivant.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(debut))
	})
}

// --- SSR HANDLERS ---

func rootHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if err := templates.ExecuteTemplate(w, "index.html", donnees); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func searchPageHandler(w http.ResponseWriter, r *http.Request) {
	requete := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("q")))
	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	var resultats []ArtisteCombine
	if requete == "" {
		resultats = donnees
	} else {
		for _, artiste := range donnees {
			if strings.Contains(strings.ToLower(artiste.Name), requete) {
				resultats = append(resultats, artiste)
				continue
			}
			for _, membre := range artiste.Members {
				if strings.Contains(strings.ToLower(membre), requete) {
					resultats = append(resultats, artiste)
					break
				}
			}
			// Add more filters if needed (creation date, first album, etc.)
			if strings.Contains(fmt.Sprint(artiste.CreationDate), requete) {
				resultats = append(resultats, artiste)
				continue
			}
			if strings.Contains(strings.ToLower(artiste.FirstAlbum), requete) {
				resultats = append(resultats, artiste)
				continue
			}
		}
	}
	
	if err := templates.ExecuteTemplate(w, "index.html", resultats); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func artistPageHandler(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		// Try path parsing if query param missing
		idStr = strings.TrimPrefix(r.URL.Path, "/artist/")
	}

	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	for _, artiste := range donnees {
		if fmt.Sprint(artiste.ID) == idStr {
			// Fetch videos server-side
			artiste.Videos = getVideosForArtist(artiste.Name)

			if err := templates.ExecuteTemplate(w, "details.html", artiste); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
	}
	http.NotFound(w, r)
}

func main() {
	// Déterminer le répertoire racine pour les fichiers statiques et templates
	repRacine := "."
	if _, err := os.Stat("html"); os.IsNotExist(err) {
		if _, err := os.Stat("../html"); err == nil {
			repRacine = ".."
		}
	}

	// Parse templates
	var err error
	templates, err = template.ParseGlob(filepath.Join(repRacine, "html", "*.html"))
	if err != nil {
		log.Fatalf("Erreur parsing templates: %v", err)
	}

	mux := http.NewServeMux()

	// SSR Endpoints
	mux.HandleFunc("/", rootHandler)
	mux.HandleFunc("/search", searchPageHandler)
	mux.HandleFunc("/artist", artistPageHandler)
	mux.HandleFunc("/artist/", artistPageHandler)
	mux.HandleFunc("/library", func(w http.ResponseWriter, r *http.Request) {
		if err := templates.ExecuteTemplate(w, "library.html", nil); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	// API Endpoints (kept for bonus features/JS)
	mux.HandleFunc("/api/combines", gestionnaireCombines)
	mux.HandleFunc("/api/combined", gestionnaireCombines) // English endpoint
	mux.HandleFunc("/api/recherche", gestionnaireRecherche)
	mux.HandleFunc("/api/search", gestionnaireRecherche) // English endpoint
	mux.HandleFunc("/api/artiste/", gestionnaireArtisteParID)
	mux.HandleFunc("/api/artist/", gestionnaireArtisteParID) // English endpoint

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

	// Fichiers statiques (CSS, JS, Images)
	fs := http.FileServer(http.Dir(repRacine))
	mux.Handle("/css/", fs)
	mux.Handle("/js/", fs)
	mux.Handle("/image/", fs)

	adresse := ":8080"
	if depuisEnv := os.Getenv("PORT"); depuisEnv != "" {
		adresse = ":" + depuisEnv
	}

	abs, _ := filepath.Abs(".")
	log.Printf("Serveur démarré sur %s à http://localhost%s", abs, adresse)
	log.Printf("Mode SSR activé. Templates chargés.")
	if err := http.ListenAndServe(adresse, avecJournalisation(mux)); err != nil {
		log.Fatal(err)
	}
}
