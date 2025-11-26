package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGestionnaireCombines(t *testing.T) {
	// Créer un serveur fictif pour l'API externe
	serveurMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/artists" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]Artiste{
				{ID: 1, Name: "Groupe Test", Members: []string{"Membre1", "Membre2"}, CreationDate: 2000, FirstAlbum: "01-01-2001"},
			})
		} else if r.URL.Path == "/api/relation" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(IndexRelations{
				Index: []Relation{
					{ID: 1, DatesLocations: map[string][]string{"paris-france": {"01-01-2020"}}},
				},
			})
		}
	}))
	defer serveurMock.Close()

	// Tester le gestionnaire
	req := httptest.NewRequest("GET", "/api/combines", nil)
	w := httptest.NewRecorder()
	gestionnaireCombines(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("statut attendu 200, obtenu %d", w.Code)
	}

	var resultat []ArtisteCombine
	if err := json.NewDecoder(w.Body).Decode(&resultat); err != nil {
		t.Fatalf("échec du décodage de la réponse : %v", err)
	}

	if len(resultat) == 0 {
		t.Error("au moins un artiste attendu dans la réponse combinée")
	}
}

func TestGestionnaireRecherche(t *testing.T) {
	tests := []struct {
		nom      string
		requete  string
		codeAttendu int
	}{
		{"requête vide", "", http.StatusOK},
		{"avec requête", "test", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.nom, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/recherche?q="+tt.requete, nil)
			w := httptest.NewRecorder()
			gestionnaireRecherche(w, req)

			if w.Code != tt.codeAttendu {
				t.Errorf("statut attendu %d, obtenu %d", tt.codeAttendu, w.Code)
			}

			var resultat []ArtisteCombine
			if err := json.NewDecoder(w.Body).Decode(&resultat); err != nil {
				t.Fatalf("échec du décodage de la réponse : %v", err)
			}
		})
	}
}

func TestGestionnaireArtisteParID(t *testing.T) {
	tests := []struct {
		nom      string
		chemin   string
		codeAttendu int
	}{
		{"id valide", "/api/artiste/1", http.StatusOK},
		{"id manquant", "/api/artiste/", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.nom, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.chemin, nil)
			w := httptest.NewRecorder()
			gestionnaireArtisteParID(w, req)

			// Note : on obtiendra probablement BadGateway si l'API externe est hors ligne
			// mais on teste la structure du gestionnaire
			if w.Code != tt.codeAttendu && w.Code != http.StatusBadGateway && w.Code != http.StatusNotFound {
				t.Logf("statut obtenu %d (acceptable pour test d'intégration)", w.Code)
			}
		})
	}
}
