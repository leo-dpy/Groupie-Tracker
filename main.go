package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const remoteBase = "https://groupietrackers.herokuapp.com/api"

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

	cacheMu.Lock()
	cache[url] = cacheEntry{Data: b, ExpiresAt: time.Now().Add(ttl), Type: ctype}
	cacheMu.Unlock()
	return b, ctype, nil
}

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

	// Static files from current directory
	fs := http.FileServer(http.Dir("."))
	mux.Handle("/", fs)

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
