/**
 * Gestion de la page de détails de l'artiste.
 * Gère le lecteur audio, les favoris et les playlists.
 */

let PROMESSE_CHARGEMENT_API_YT = null;
const lecteursYT = new Map();

/**
 * Charge l'API YouTube IFrame de manière asynchrone.
 * @returns {Promise} Une promesse résolue quand l'API est prête.
 */
function chargerApiYouTube() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (PROMESSE_CHARGEMENT_API_YT) return PROMESSE_CHARGEMENT_API_YT;
  PROMESSE_CHARGEMENT_API_YT = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {}
      }
      resolve();
    };
    document.head.appendChild(tag);
  });
  return PROMESSE_CHARGEMENT_API_YT;
}

document.addEventListener("DOMContentLoaded", async () => {
  const titreArtiste = document.getElementById("titre-artiste")?.textContent;
  const elementsAudio = document.querySelectorAll(".audio-item");

  // --- Gestion des Favoris et Playlists (Côté Serveur) ---
  let favoris = JSON.parse(localStorage.getItem("likes") || "[]");
  // Les playlists sont maintenant récupérées depuis le serveur
  let playlists = [];

  /**
   * Récupère la liste des playlists depuis le serveur.
   */
  const recupererPlaylists = async () => {
    try {
      const res = await fetch("/api/playlists");
      if (res.ok) {
        playlists = (await res.json()) || [];
      }
    } catch (e) {
      console.error("Échec de la récupération des playlists", e);
    }
  };

  /**
   * Sauvegarde les favoris dans le stockage local.
   */
  const sauvegarderFavoris = () => localStorage.setItem("likes", JSON.stringify(favoris));

  // Éléments de la Modale de Sélection
  const modaleSelection = document.getElementById("playlist-modal");
  const listePlaylists = document.getElementById("playlist-list");
  const btnCreerNouvelle = document.getElementById("btn-create-new");
  const btnAnnulerSelection = document.getElementById("btn-cancel-playlist");
  
  // Éléments de la Modale de Création
  const modaleCreation = document.getElementById("create-playlist-modal");
  const entreeNomPlaylist = document.getElementById("new-playlist-name");
  const btnConfirmerCreation = document.getElementById("btn-confirm-create");
  const btnAnnulerCreation = document.getElementById("btn-cancel-create");

  let chansonEnAttenteAjout = null;

  /**
   * Ferme la modale de sélection de playlist.
   */
  const fermerModaleSelection = () => {
    modaleSelection.classList.add("hidden");
    chansonEnAttenteAjout = null;
  };

  /**
   * Ferme la modale de création de playlist.
   */
  const fermerModaleCreation = () => {
    modaleCreation.classList.add("hidden");
    entreeNomPlaylist.value = "";
  };

  if (btnAnnulerSelection) btnAnnulerSelection.onclick = fermerModaleSelection;
  if (btnAnnulerCreation) btnAnnulerCreation.onclick = fermerModaleCreation;

  // Fermer en cliquant en dehors du contenu de la modale
  if (modaleSelection) {
    modaleSelection.onclick = (e) => {
      if (e.target === modaleSelection) fermerModaleSelection();
    };
  }
  if (modaleCreation) {
    modaleCreation.onclick = (e) => {
      if (e.target === modaleCreation) fermerModaleCreation();
    };
  }

  if (btnCreerNouvelle) {
    btnCreerNouvelle.onclick = () => {
      fermerModaleSelection(); // Fermer la sélection
      modaleCreation.classList.remove("hidden"); // Ouvrir la création
      entreeNomPlaylist.focus();
    };
  }

  if (btnConfirmerCreation) {
    btnConfirmerCreation.onclick = async () => {
      const nom = entreeNomPlaylist.value.trim();
      if (nom) {
        try {
          // Créer la Playlist sur le Serveur
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: nom, songs: [] }),
          });
          
          if (res.ok) {
            const nouvellePl = await res.json();
            playlists.push(nouvellePl);
            
            // Si nous avions une chanson en attente, l'ajouter maintenant
            if (chansonEnAttenteAjout) {
              await ajouterAuPlaylist(nouvellePl.id, chansonEnAttenteAjout);
              if (window.afficherNotification)
                window.afficherNotification(`Playlist "${nom}" créée et titre ajouté`);
            } else {
              if (window.afficherNotification)
                window.afficherNotification(`Playlist "${nom}" créée`);
            }
            fermerModaleCreation();
          }
        } catch (e) {
          console.error(e);
          if (window.afficherNotification) window.afficherNotification("Erreur création playlist", "error");
        }
      }
    };
  }

  /**
   * Ajoute une chanson à une playlist spécifique via l'API.
   * @param {string} idPlaylist - L'ID de la playlist cible.
   * @param {object} chanson - L'objet chanson à ajouter.
   * @returns {boolean} Succès ou échec.
   */
  const ajouterAuPlaylist = async (idPlaylist, chanson) => {
    try {
      const res = await fetch("/api/playlists/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: idPlaylist, song: chanson }),
      });
      if (res.ok) {
        // Mettre à jour le cache local
        const idx = playlists.findIndex(p => p.id === idPlaylist);
        if (idx !== -1) playlists[idx].songs.push(chanson);
        return true;
      } else if (res.status === 409) {
         if (window.afficherNotification) window.afficherNotification("Déjà dans cette playlist", "error");
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  };

  /**
   * Ouvre la modale pour choisir une playlist où ajouter la chanson.
   * @param {object} chanson - La chanson à ajouter.
   */
  const ouvrirModaleSelection = async (chanson) => {
    chansonEnAttenteAjout = chanson;
    listePlaylists.innerHTML = "Chargement...";
    await recupererPlaylists(); // Rafraîchir depuis le serveur
    listePlaylists.innerHTML = "";

    if (playlists.length === 0) {
      listePlaylists.innerHTML =
        '<div style="padding:10px;color:#aaa;text-align:center">Aucune playlist. Créez-en une !</div>';
    } else {
      playlists.forEach((pl) => {
        const div = document.createElement("div");
        div.className = "playlist-option";
        div.innerHTML = `<span>${pl.name}</span> <span class="count">${pl.songs ? pl.songs.length : 0}</span>`;
        div.onclick = async () => {
          const succes = await ajouterAuPlaylist(pl.id, chanson);
          if (succes && window.afficherNotification) window.afficherNotification(`Ajouté à "${pl.name}"`);
          fermerModaleSelection();
        };
        listePlaylists.appendChild(div);
      });
    }
    modaleSelection.classList.remove("hidden");
  };

  if (elementsAudio.length === 0) return;

  // Charger l'API YouTube
  await chargerApiYouTube();

  const intervallesProgression = new Map();

  elementsAudio.forEach((ligne) => {
    const btnLecture = ligne.querySelector(".audio-play");
    const vid = btnLecture.dataset.vid;
    const btnAjout = ligne.querySelector(".btn-add-playlist");
    const btnLike = ligne.querySelector(".btn-like");
    const titre = ligne.querySelector(".audio-title").textContent;
    const barreProgression = ligne.querySelector(".audio-progress");
    let lecteur = null;

    // Initialiser l'état "Aimé"
    if (btnLike && favoris.some((l) => l.id === vid)) {
      btnLike.classList.add("liked");
    }

    const arreterSuiviProgression = () => {
      if (intervallesProgression.has(vid)) {
        clearInterval(intervallesProgression.get(vid));
        intervallesProgression.delete(vid);
      }
    };

    const demarrerSuiviProgression = (p) => {
      arreterSuiviProgression();
      const interval = setInterval(() => {
        if (p && p.getCurrentTime && p.getDuration) {
          const actuel = p.getCurrentTime();
          const total = p.getDuration();
          if (total > 0) {
            const pct = (actuel / total) * 100;
            if (barreProgression) barreProgression.style.width = `${pct}%`;
          }
        }
      }, 500);
      intervallesProgression.set(vid, interval);
    };

    // Logique du Bouton Lecture
    btnLecture.addEventListener("click", () => {
      const enLecture = ligne.classList.contains("playing");

      // Mettre en pause tous les autres
      document.querySelectorAll(".audio-item.playing").forEach((it) => {
        if (it !== ligne) {
          it.classList.remove("playing");
          const autreVid = it.querySelector(".audio-play").dataset.vid;
          const autreLecteur = lecteursYT.get(autreVid);
          if (autreLecteur && autreLecteur.pauseVideo) autreLecteur.pauseVideo();
          const autreBtn = it.querySelector(".audio-play");
          if (autreBtn) autreBtn.textContent = "▶";
          // Arrêter l'autre progression
          if (intervallesProgression.has(autreVid)) {
            clearInterval(intervallesProgression.get(autreVid));
            intervallesProgression.delete(autreVid);
          }
        }
      });

      if (enLecture) {
        ligne.classList.remove("playing");
        if (lecteur) lecteur.pauseVideo();
        btnLecture.textContent = "▶";
        arreterSuiviProgression();
      } else {
        ligne.classList.add("playing");
        if (!lecteur) {
          lecteur = new YT.Player(`player-${vid}`, {
            height: "200",
            width: "100%",
            videoId: vid,
            events: {
              onStateChange: (e) => {
                if (e.data === YT.PlayerState.PLAYING) {
                   demarrerSuiviProgression(lecteur);
                }
                if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
                   arreterSuiviProgression();
                }
                if (e.data === YT.PlayerState.ENDED) {
                  ligne.classList.remove("playing");
                  btnLecture.textContent = "▶";
                  if (barreProgression) barreProgression.style.width = "0%";
                }
              },
            },
          });
          lecteursYT.set(vid, lecteur);
        }
        lecteur.playVideo();
        btnLecture.textContent = "⏸";
      }
    });

    // Logique du Bouton J'aime
    if (btnLike) {
      btnLike.addEventListener("click", (e) => {
        e.stopPropagation();
        btnLike.classList.toggle("liked");
        const estAime = btnLike.classList.contains("liked");

        if (estAime) {
          if (!favoris.some((l) => l.id === vid)) {
            favoris.push({ id: vid, title: titre, artist: titreArtiste });
            sauvegarderFavoris();
          }
          if (window.afficherNotification) window.afficherNotification("Ajouté aux favoris");
        } else {
          favoris = favoris.filter((l) => l.id !== vid);
          sauvegarderFavoris();
          if (window.afficherNotification) window.afficherNotification("Retiré des favoris");
        }
      });
    }

    // Logique d'Ajout à la Playlist
    if (btnAjout) {
      btnAjout.addEventListener("click", (e) => {
        e.stopPropagation();
        ouvrirModaleSelection({ id: vid, title: titre, artist: titreArtiste });
      });
    }
  });
});
