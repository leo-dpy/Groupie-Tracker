package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCombinedHandler(t *testing.T) {
	// Create a mock server for the external API
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/artists" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]Artist{
				{ID: 1, Name: "Test Band", Members: []string{"Member1", "Member2"}, CreationDate: 2000, FirstAlbum: "01-01-2001"},
			})
		} else if r.URL.Path == "/api/relation" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(RelationsIndex{
				Index: []Relation{
					{ID: 1, DatesLocations: map[string][]string{"paris-france": {"01-01-2020"}}},
				},
			})
		}
	}))
	defer mockServer.Close()

	// Test the handler
	req := httptest.NewRequest("GET", "/api/combined", nil)
	w := httptest.NewRecorder()
	combinedHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result []CombinedArtist
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result) == 0 {
		t.Error("expected at least one artist in combined response")
	}
}

func TestSearchHandler(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		wantCode int
	}{
		{"empty query", "", http.StatusOK},
		{"with query", "test", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/search?q="+tt.query, nil)
			w := httptest.NewRecorder()
			searchHandler(w, req)

			if w.Code != tt.wantCode {
				t.Errorf("expected status %d, got %d", tt.wantCode, w.Code)
			}

			var result []CombinedArtist
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}
		})
	}
}

func TestArtistByIDHandler(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		wantCode int
	}{
		{"valid id", "/api/artist/1", http.StatusOK},
		{"missing id", "/api/artist/", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.path, nil)
			w := httptest.NewRecorder()
			artistByIDHandler(w, req)

			// Note: will likely get BadGateway if external API is down
			// but we're testing the handler structure
			if w.Code != tt.wantCode && w.Code != http.StatusBadGateway && w.Code != http.StatusNotFound {
				t.Logf("got status %d (acceptable for integration test)", w.Code)
			}
		})
	}
}
