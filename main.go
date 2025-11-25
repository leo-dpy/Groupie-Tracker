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

const remoteBase = "https://groupietrackers.herokuapp.com/api"
const ytBase = "https://www.googleapis.com/youtube/v3"

// Data models
type Artist struct {
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

type Location struct {
	ID        int      `json:"id"`
	Locations []string `json:"locations"`
	Dates     string   `json:"dates"`
}

type DateInfo struct {
	ID    int      `json:"id"`
	Dates []string `json:"dates"`
}

type Relation struct {
	ID             int                 `json:"id"`
	DatesLocations map[string][]string `json:"datesLocations"`
}

type RelationsIndex struct {
	Index []Relation `json:"index"`
}

type CombinedArtist struct {
	Artist
	Shows []Show `json:"shows,omitempty"`
}

type Show struct {
	Date     string `json:"date"`
	Location string `json:"location"`
}

// Simple in-memory cache
var (
	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}
	ttl     = 5 * time.Minute
)

type cacheEntry struct {
	Data      []byte
	ExpiresAt time.Time
	Type      string
}

func getWithCache(url string) (data []byte, ctype string, err error) {
	cacheMu.Lock()
	if e, ok := cache[url]; ok && time.Now().Before(e.ExpiresAt) {
		data, ctype = e.Data, e.Type
		cacheMu.Unlock()
		return
	}
	cacheMu.Unlock()

	resp, err := http.Get(url)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	ctype = resp.Header.Get("Content-Type")
	if ctype == "" {
		ctype = "application/json; charset=utf-8"
	}

	// Do not cache error responses (>=400)
	if resp.StatusCode >= 400 {
		return nil, ctype, &httpError{StatusCode: resp.StatusCode, Message: string(b)}
	}

	cacheMu.Lock()
	cache[url] = cacheEntry{Data: b, ExpiresAt: time.Now().Add(ttl), Type: ctype}
	cacheMu.Unlock()
	return b, ctype, nil
}

type httpError struct {
	StatusCode int
	Message    string
}

func (e *httpError) Error() string { return e.Message }

// Fetch and parse JSON from external API
func fetchAndParse(endpoint string, v interface{}) error {
	url := remoteBase + endpoint
	b, _, err := getWithCache(url)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// Get all data and combine
func getCombinedData() ([]CombinedArtist, error) {
	var artists []Artist
	var relationsData RelationsIndex

	// Fetch artists and relations in parallel
	var wg sync.WaitGroup
	var errArtists, errRelations error

	wg.Add(2)
	go func() {
		defer wg.Done()
		errArtists = fetchAndParse("/artists", &artists)
	}()
	go func() {
		defer wg.Done()
		errRelations = fetchAndParse("/relation", &relationsData)
	}()
	wg.Wait()

	if errArtists != nil {
		return nil, fmt.Errorf("failed to fetch artists: %w", errArtists)
	}
	if errRelations != nil {
		return nil, fmt.Errorf("failed to fetch relations: %w", errRelations)
	}

	// Build a map of artist ID to shows
	relationMap := make(map[int][]Show)
	for _, rel := range relationsData.Index {
		var shows []Show
		for location, dates := range rel.DatesLocations {
			for _, date := range dates {
				shows = append(shows, Show{
					Date:     date,
					Location: location,
				})
			}
		}
		relationMap[rel.ID] = shows
	}

	// Combine artists with their shows
	combined := make([]CombinedArtist, len(artists))
	for i, artist := range artists {
		combined[i] = CombinedArtist{
			Artist: artist,
			Shows:  relationMap[artist.ID],
		}
	}

	return combined, nil
}

// Handler for /api/combined - returns enriched artist data
func combinedHandler(w http.ResponseWriter, r *http.Request) {
	data, err := getCombinedData()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(data)
}

// Handler for /api/search?q=term - server-side filtering
func searchHandler(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("q")))

	data, err := getCombinedData()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	// If no query, return all
	if query == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(data)
		return
	}

	// Filter by name or members
	var filtered []CombinedArtist
	for _, artist := range data {
		if strings.Contains(strings.ToLower(artist.Name), query) {
			filtered = append(filtered, artist)
			continue
		}
		for _, member := range artist.Members {
			if strings.Contains(strings.ToLower(member), query) {
				filtered = append(filtered, artist)
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(filtered)
}

// Handler for /api/artist/:id - get single artist with shows
func artistByIDHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/artist/")
	if idStr == "" {
		http.Error(w, "artist ID required", http.StatusBadRequest)
		return
	}

	data, err := getCombinedData()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	// Find artist by ID (simple string match)
	for _, artist := range data {
		if fmt.Sprint(artist.ID) == idStr {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			json.NewEncoder(w).Encode(artist)
			return
		}
	}

	http.Error(w, "artist not found", http.StatusNotFound)
}

// Legacy proxy for backwards compatibility (kept minimal)
func apiProxy(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	if path == "" || path == "/" {
		b, ctype, err := getWithCache(remoteBase)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	url := remoteBase + path
	b, ctype, err := getWithCache(url)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(http.StatusOK)
	w.Write(b)
}

func ytProxy(w http.ResponseWriter, r *http.Request) {
	key := os.Getenv("YT_API_KEY")
	if key == "" {
		key = os.Getenv("YOUTUBE_API_KEY") // Also check YOUTUBE_API_KEY
	}
	if key == "" {
		http.Error(w, "YouTube API key missing. Set YT_API_KEY or YOUTUBE_API_KEY env var.", http.StatusServiceUnavailable)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/yt")
	if path == "" || path == "/" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"endpoints":"/yt/search"}`))
		return
	}
	// /search passthrough
	if strings.HasPrefix(path, "/search") {
		u, _ := url.Parse(ytBase + "/search")
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
		q.Set("key", key)
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
		ctype := resp.Header.Get("Content-Type")
		if ctype == "" {
			ctype = "application/json; charset=utf-8"
		}
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	// /videos passthrough
	if strings.HasPrefix(path, "/videos") {
		u, _ := url.Parse(ytBase + "/videos")
		q := u.Query()
		for k, vals := range r.URL.Query() {
			for _, v := range vals {
				q.Add(k, v)
			}
		}
		if q.Get("part") == "" {
			q.Set("part", "snippet,contentDetails")
		}
		q.Set("key", key)
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
		ctype := resp.Header.Get("Content-Type")
		if ctype == "" {
			ctype = "application/json; charset=utf-8"
		}
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}
	http.NotFound(w, r)
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func main() {
	mux := http.NewServeMux()

	// New Go-powered endpoints with data manipulation
	mux.HandleFunc("/api/combined", combinedHandler)
	mux.HandleFunc("/api/search", searchHandler)
	mux.HandleFunc("/api/artist/", artistByIDHandler)

	// Legacy proxy (for raw access if needed)
	mux.HandleFunc("/api/artists", apiProxy)
	mux.HandleFunc("/api/locations", apiProxy)
	mux.HandleFunc("/api/dates", apiProxy)
	mux.HandleFunc("/api/relation", apiProxy)
	mux.HandleFunc("/api", apiProxy)
	mux.HandleFunc("/api/", apiProxy)

	// YouTube proxy
	mux.HandleFunc("/yt", ytProxy)
	mux.HandleFunc("/yt/", ytProxy)

	// Static files from project root
	fs := http.FileServer(http.Dir("."))
	// Serve index at root from html/index.html for cleaner URL
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join("html", "index.html"))
	})

	addr := ":8080"
	if fromEnv := os.Getenv("PORT"); fromEnv != "" {
		addr = ":" + fromEnv
	}

	abs, _ := filepath.Abs(".")
	log.Printf("Serving %s on http://localhost%s", abs, addr)
	log.Printf("API endpoints: /api/combined, /api/search?q=term, /api/artist/:id")
	if err := http.ListenAndServe(addr, withLogging(mux)); err != nil {
		log.Fatal(err)
	}
}
