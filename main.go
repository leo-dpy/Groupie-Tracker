package main

import (
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

func apiProxy(w http.ResponseWriter, r *http.Request) {
	// Map /api/... -> remoteBase/...
	path := strings.TrimPrefix(r.URL.Path, "/api")
	if path == "" || path == "/" {
		// return the remote API root links
		b, ctype, err := getWithCache(remoteBase)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	// sanitize and forward
	url := remoteBase + path
	b, ctype, err := getWithCache(url)
	if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(http.StatusOK)
	w.Write(b)
}


func ytProxy(w http.ResponseWriter, r *http.Request) {
	key := os.Getenv("YT_API_KEY")
	if key == "" {
		http.Error(w, "YouTube API key missing. Set YT_API_KEY env var.", http.StatusServiceUnavailable)
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
		for k, vals := range r.URL.Query() { for _, v := range vals { q.Add(k, v) } }
		if q.Get("part") == "" { q.Set("part", "snippet") }
		if q.Get("type") == "" { q.Set("type", "video") }
		if q.Get("maxResults") == "" { q.Set("maxResults", "3") }
		q.Set("key", key)
		u.RawQuery = q.Encode()

		req, err := http.NewRequest("GET", u.String(), nil)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		req.Header.Set("Referer", "http://localhost:8080/")
		client := &http.Client{ Timeout: 12 * time.Second }
		resp, err := client.Do(req)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		if resp.StatusCode >= 400 { http.Error(w, string(b), resp.StatusCode); return }
		ctype := resp.Header.Get("Content-Type")
		if ctype == "" { ctype = "application/json; charset=utf-8" }
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(http.StatusOK)
		w.Write(b)
		return
	}

	// /videos passthrough
	if strings.HasPrefix(path, "/videos") {
		u, _ := url.Parse(ytBase + "/videos")
		q := u.Query()
		for k, vals := range r.URL.Query() { for _, v := range vals { q.Add(k, v) } }
		if q.Get("part") == "" { q.Set("part", "snippet,contentDetails") }
		q.Set("key", key)
		u.RawQuery = q.Encode()

		req, err := http.NewRequest("GET", u.String(), nil)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		req.Header.Set("Referer", "http://localhost:8080/")
		client := &http.Client{ Timeout: 12 * time.Second }
		resp, err := client.Do(req)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil { http.Error(w, err.Error(), http.StatusBadGateway); return }
		if resp.StatusCode >= 400 { http.Error(w, string(b), resp.StatusCode); return }
		ctype := resp.Header.Get("Content-Type")
		if ctype == "" { ctype = "application/json; charset=utf-8" }
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

	// API proxy
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
	if err := http.ListenAndServe(addr, withLogging(mux)); err != nil {
		log.Fatal(err)
	}
}
