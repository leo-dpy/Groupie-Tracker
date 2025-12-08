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
	MembersRich []MemberRich `json:"membersRich,omitempty"`
}

type MemberRich struct {
	Name    string `json:"name"`
	WikiURL string `json:"wikiUrl"`
}

type Video struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type Concert struct {
	Date     string `json:"date"`
	Location string `json:"location"`
	MapURL   string `json:"mapUrl"`
}

// Playlist System
type Playlist struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Songs []Video `json:"songs"`
}

var (
	playlists      []Playlist
	verrouPlaylist sync.Mutex
)

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
			// Clean location for Google Maps query
			cleanLoc := strings.ReplaceAll(lieu, "_", " ")
			cleanLoc = strings.ReplaceAll(cleanLoc, "-", ", ")
			mapURL := "https://www.google.com/maps/search/?api=1&query=" + url.QueryEscape(cleanLoc)

			for _, date := range dates {
				concerts = append(concerts, Concert{
					Date:     date,
					Location: lieu,
					MapURL:   mapURL,
				})
			}
		}
		carteRelations[rel.ID] = concerts
	}

	// Combiner les artistes avec leurs concerts
	combines := make([]ArtisteCombine, len(artistes))
	for i, artiste := range artistes {
		// Generate Member Links
		var membersRich []MemberRich
		for _, m := range artiste.Members {
			membersRich = append(membersRich, MemberRich{
				Name:    m,
				WikiURL: "https://en.wikipedia.org/wiki/" + url.QueryEscape(strings.ReplaceAll(m, " ", "_")),
			})
		}

		combines[i] = ArtisteCombine{
			Artiste:     artiste,
			Shows:       carteRelations[artiste.ID],
			MembersRich: membersRich,
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
func proxyVersAPI(w http.ResponseWriter, r *http.Request) {
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

func proxyVersYouTube(w http.ResponseWriter, r *http.Request) {
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

// obtenirVideosPourArtiste récupère les vidéos YouTube pour un artiste donné.
// Tente d'abord de trouver la chaîne officielle, puis cherche les vidéos.
func obtenirVideosPourArtiste(nomArtiste string) []Video {
	cleAPI := os.Getenv("YT_API_KEY")
	if cleAPI == "" {
		log.Println("YT_API_KEY manquante")
		return nil
	}

	// 1. Recherche de la chaîne/artiste
	requete := url.QueryEscape(nomArtiste + " official")
	urlRecherche := fmt.Sprintf("%s/search?q=%s&type=channel&maxResults=1&part=snippet&key=%s", baseYT, requete, cleAPI)
	
	log.Printf("Récupération Chaîne: %s", urlRecherche)

	req, err := http.NewRequest("GET", urlRecherche, nil)
	if err != nil {
		log.Printf("Erreur NewRequest: %v", err)
		return nil
	}
	req.Header.Set("Referer", "http://localhost:8080/")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Erreur Recherche YT: %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		corps, _ := io.ReadAll(resp.Body)
		log.Printf("Erreur API YT (Chaîne): %s - %s", resp.Status, string(corps))
	}

	var resRecherche struct {
		Items []struct {
			ID struct {
				ChannelID string `json:"channelId"`
			} `json:"id"`
		} `json:"items"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&resRecherche)

	var idChaine string
	if len(resRecherche.Items) > 0 {
		idChaine = resRecherche.Items[0].ID.ChannelID
		log.Printf("ID Chaîne trouvé: %s", idChaine)
	} else {
		log.Printf("Aucun ID de chaîne trouvé pour %s", nomArtiste)
	}

	// 2. Recherche des vidéos
	var urlVideo string
	if idChaine != "" {
		urlVideo = fmt.Sprintf("%s/search?channelId=%s&type=video&videoEmbeddable=true&order=viewCount&maxResults=5&part=snippet&key=%s", baseYT, idChaine, cleAPI)
	} else {
		q2 := url.QueryEscape(nomArtiste + " official audio")
		urlVideo = fmt.Sprintf("%s/search?q=%s&type=video&videoEmbeddable=true&maxResults=5&part=snippet&key=%s", baseYT, q2, cleAPI)
	}

	log.Printf("Récupération Vidéos: %s", urlVideo)
	
	reqV, err := http.NewRequest("GET", urlVideo, nil)
	if err != nil {
		return nil
	}
	reqV.Header.Set("Referer", "http://localhost:8080/")

	respV, err := client.Do(reqV)
	if err != nil {
		log.Printf("Erreur Récupération Vidéo YT: %v", err)
		return nil
	}
	defer respV.Body.Close()

	if respV.StatusCode != 200 {
		corps, _ := io.ReadAll(respV.Body)
		log.Printf("Erreur API YT (Vidéos): %s - %s", respV.Status, string(corps))
		// Repli : Retourner des données factices pour tester l'interface
		return []Video{
			{ID: "dQw4w9WgXcQ", Title: nomArtiste + " - Top Hit (Mode Démo)"},
			{ID: "kJQP7kiw5Fk", Title: nomArtiste + " - Live Performance (Mode Démo)"},
			{ID: "9bZkp7q19f0", Title: nomArtiste + " - Official Video (Mode Démo)"},
		}
	}

	var resVideo struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(respV.Body).Decode(&resVideo); err != nil {
		log.Printf("Erreur Décodage JSON: %v", err)
		return nil
	}

	var videos []Video
	for _, item := range resVideo.Items {
		if item.ID.VideoID != "" {
			videos = append(videos, Video{
				ID:    item.ID.VideoID,
				Title: item.Snippet.Title,
			})
		}
	}
	log.Printf("Trouvé %d vidéos pour %s", len(videos), nomArtiste)
	return videos
}

func avecJournalisation(suivant http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		debut := time.Now()
		suivant.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(debut))
	})
}

// --- GESTIONNAIRES SSR ---

// gestionnaireRacine gère la page d'accueil.
func gestionnaireRacine(w http.ResponseWriter, r *http.Request) {
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

// gestionnairePageRecherche gère la page de résultats de recherche.
func gestionnairePageRecherche(w http.ResponseWriter, r *http.Request) {
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
			// Ajouter d'autres filtres si nécessaire (date de création, premier album, etc.)
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

// gestionnairePageArtiste gère la page de détails d'un artiste.
func gestionnairePageArtiste(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		// Essayer de parser le chemin si le paramètre de requête est manquant
		idStr = strings.TrimPrefix(r.URL.Path, "/artist/")
	}

	donnees, err := obtenirDonneesCombinees()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	for _, artiste := range donnees {
		if fmt.Sprint(artiste.ID) == idStr {
			// Récupérer les vidéos côté serveur
			artiste.Videos = obtenirVideosPourArtiste(artiste.Name)

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

	// Parser les templates
	var err error
	templates, err = template.ParseGlob(filepath.Join(repRacine, "html", "*.html"))
	if err != nil {
		log.Fatalf("Erreur parsing templates: %v", err)
	}

	mux := http.NewServeMux()

	// Endpoints SSR
	mux.HandleFunc("/", gestionnaireRacine)
	mux.HandleFunc("/search", gestionnairePageRecherche)
	mux.HandleFunc("/artist", gestionnairePageArtiste)
	mux.HandleFunc("/artist/", gestionnairePageArtiste)
	mux.HandleFunc("/library", func(w http.ResponseWriter, r *http.Request) {
		if err := templates.ExecuteTemplate(w, "library.html", nil); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	// Endpoints API (gardés pour les fonctionnalités bonus/JS)
	mux.HandleFunc("/api/combines", gestionnaireCombines)
	mux.HandleFunc("/api/combined", gestionnaireCombines) // Endpoint anglais
	mux.HandleFunc("/api/recherche", gestionnaireRecherche)
	mux.HandleFunc("/api/search", gestionnaireRecherche) // Endpoint anglais
	mux.HandleFunc("/api/artiste/", gestionnaireArtisteParID)
	mux.HandleFunc("/api/artist/", gestionnaireArtisteParID) // Endpoint anglais

	// API Playlist
	mux.HandleFunc("/api/playlists", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			verrouPlaylist.Lock()
			defer verrouPlaylist.Unlock()
			json.NewEncoder(w).Encode(playlists)
		} else if r.Method == "POST" {
			var p Playlist
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			p.ID = fmt.Sprintf("pl-%d", time.Now().UnixNano())
			verrouPlaylist.Lock()
			playlists = append(playlists, p)
			verrouPlaylist.Unlock()
			json.NewEncoder(w).Encode(p)
		}
	})

	mux.HandleFunc("/api/playlists/add", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Méthode non autorisée", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PlaylistID string `json:"playlistId"`
			Song       Video  `json:"song"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		verrouPlaylist.Lock()
		defer verrouPlaylist.Unlock()
		for i := range playlists {
			if playlists[i].ID == req.PlaylistID {
				// Vérifier les doublons
				for _, s := range playlists[i].Songs {
					if s.ID == req.Song.ID {
						http.Error(w, "Chanson déjà dans la playlist", http.StatusConflict)
						return
					}
				}
				playlists[i].Songs = append(playlists[i].Songs, req.Song)
				json.NewEncoder(w).Encode(playlists[i])
				return
			}
		}
		http.Error(w, "Playlist non trouvée", http.StatusNotFound)
	})

	mux.HandleFunc("/api/playlists/remove", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Méthode non autorisée", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PlaylistID string `json:"playlistId"`
			SongID     string `json:"songId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		verrouPlaylist.Lock()
		defer verrouPlaylist.Unlock()
		for i := range playlists {
			if playlists[i].ID == req.PlaylistID {
				newSongs := []Video{}
				for _, s := range playlists[i].Songs {
					if s.ID != req.SongID {
						newSongs = append(newSongs, s)
					}
				}
				playlists[i].Songs = newSongs
				json.NewEncoder(w).Encode(playlists[i])
				return
			}
		}
		http.Error(w, "Playlist non trouvée", http.StatusNotFound)
	})

	mux.HandleFunc("/api/playlists/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Méthode non autorisée", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PlaylistID string `json:"playlistId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		verrouPlaylist.Lock()
		defer verrouPlaylist.Unlock()
		newPlaylists := []Playlist{}
		for _, p := range playlists {
			if p.ID != req.PlaylistID {
				newPlaylists = append(newPlaylists, p)
			}
		}
		playlists = newPlaylists
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/api/playlists/rename", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Méthode non autorisée", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PlaylistID string `json:"playlistId"`
			NewName    string `json:"newName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		verrouPlaylist.Lock()
		defer verrouPlaylist.Unlock()
		for i := range playlists {
			if playlists[i].ID == req.PlaylistID {
				playlists[i].Name = req.NewName
				json.NewEncoder(w).Encode(playlists[i])
				return
			}
		}
		http.Error(w, "Playlist non trouvée", http.StatusNotFound)
	})

	// Proxy hérité (pour accès brut si nécessaire)
	mux.HandleFunc("/api/artists", proxyVersAPI)
	mux.HandleFunc("/api/locations", proxyVersAPI)
	mux.HandleFunc("/api/dates", proxyVersAPI)
	mux.HandleFunc("/api/relation", proxyVersAPI)
	mux.HandleFunc("/api", proxyVersAPI)
	mux.HandleFunc("/api/", proxyVersAPI)

	// Proxy YouTube
	mux.HandleFunc("/yt", proxyVersYouTube)
	mux.HandleFunc("/yt/", proxyVersYouTube)

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
