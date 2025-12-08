let PROMESSE_CHARGEMENT_API_YT = null;
const lecteursYT = new Map();

function assurerApiYT() {
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
  const audioItems = document.querySelectorAll(".audio-item");

  // --- Gestion des Likes et Playlists (LocalStorage) ---
  let likes = JSON.parse(localStorage.getItem("likes") || "[]");
  let playlists = JSON.parse(localStorage.getItem("playlists") || "[]");

  const saveLikes = () => localStorage.setItem("likes", JSON.stringify(likes));
  const savePlaylists = () =>
    localStorage.setItem("playlists", JSON.stringify(playlists));

  // Modal Elements
  const modal = document.getElementById("playlist-modal");
  const modalList = document.getElementById("playlist-list");
  const btnCreate = document.getElementById("btn-create-new");
  const btnCancel = document.getElementById("btn-cancel-playlist");
  let currentSongToAdd = null;

  const closeModal = () => {
    modal.classList.add("hidden");
    currentSongToAdd = null;
  };

  if (btnCancel) btnCancel.onclick = closeModal;

  // Close when clicking outside the modal content
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
  }

  if (btnCreate) {
    btnCreate.onclick = () => {
      const name = prompt("Nom de la nouvelle playlist :");
      if (name) {
        const newPl = {
          id: "pl-" + Date.now(),
          name: name,
          songs: [],
        };
        if (currentSongToAdd) {
          newPl.songs.push(currentSongToAdd);
        }
        playlists.push(newPl);
        savePlaylists();
        if (window.showToast)
          window.showToast(`Playlist "${name}" créée et titre ajouté`);
        closeModal();
      }
    };
  }

  const openPlaylistModal = (song) => {
    currentSongToAdd = song;
    modalList.innerHTML = "";
    playlists = JSON.parse(localStorage.getItem("playlists") || "[]"); // Refresh

    if (playlists.length === 0) {
      modalList.innerHTML =
        '<div style="padding:10px;color:#aaa;text-align:center">Aucune playlist. Créez-en une !</div>';
    } else {
      playlists.forEach((pl) => {
        const div = document.createElement("div");
        div.className = "playlist-option";
        div.innerHTML = `<span>${pl.name}</span> <span class="count">${pl.songs.length}</span>`;
        div.onclick = () => {
          // Check duplicate
          if (pl.songs.some((s) => s.id === song.id)) {
            if (window.showToast)
              window.showToast("Déjà dans cette playlist", "error");
          } else {
            pl.songs.push(song);
            // Update in array
            const idx = playlists.findIndex((p) => p.id === pl.id);
            if (idx !== -1) playlists[idx] = pl;
            savePlaylists();
            if (window.showToast) window.showToast(`Ajouté à "${pl.name}"`);
          }
          closeModal();
        };
        modalList.appendChild(div);
      });
    }
    modal.classList.remove("hidden");
  };

  if (audioItems.length === 0) return;

  // Load YouTube API
  await assurerApiYT();

  const progressIntervals = new Map();

  audioItems.forEach((ligne) => {
    const btnPlay = ligne.querySelector(".audio-play");
    const vid = btnPlay.dataset.vid;
    const wrapper = ligne.querySelector(".yt-embed-wrapper");
    const btnAdd = ligne.querySelector(".btn-add-playlist");
    const btnLike = ligne.querySelector(".btn-like");
    const title = ligne.querySelector(".audio-title").textContent;
    const progressBar = ligne.querySelector(".audio-progress");
    let player = null;

    // Init Like State
    if (btnLike && likes.some((l) => l.id === vid)) {
      btnLike.classList.add("liked");
    }

    const stopProgress = () => {
      if (progressIntervals.has(vid)) {
        clearInterval(progressIntervals.get(vid));
        progressIntervals.delete(vid);
      }
    };

    const startProgress = (p) => {
      stopProgress();
      const interval = setInterval(() => {
        if (p && p.getCurrentTime && p.getDuration) {
          const current = p.getCurrentTime();
          const total = p.getDuration();
          if (total > 0) {
            const pct = (current / total) * 100;
            if (progressBar) progressBar.style.width = `${pct}%`;
          }
        }
      }, 500);
      progressIntervals.set(vid, interval);
    };

    // Play Button Logic
    btnPlay.addEventListener("click", () => {
      const isPlaying = ligne.classList.contains("playing");

      // Pause all others
      document.querySelectorAll(".audio-item.playing").forEach((it) => {
        if (it !== ligne) {
          it.classList.remove("playing");
          const otherVid = it.querySelector(".audio-play").dataset.vid;
          const otherPlayer = lecteursYT.get(otherVid);
          if (otherPlayer && otherPlayer.pauseVideo) otherPlayer.pauseVideo();
          const otherBtn = it.querySelector(".audio-play");
          if (otherBtn) otherBtn.textContent = "▶";
          // Stop other progress
          if (progressIntervals.has(otherVid)) {
            clearInterval(progressIntervals.get(otherVid));
            progressIntervals.delete(otherVid);
          }
        }
      });

      if (isPlaying) {
        ligne.classList.remove("playing");
        if (player) player.pauseVideo();
        btnPlay.textContent = "▶";
        stopProgress();
      } else {
        ligne.classList.add("playing");
        // wrapper.style.display = "block"; // Removed to keep hidden
        if (!player) {
          player = new YT.Player(`player-${vid}`, {
            height: "200",
            width: "100%",
            videoId: vid,
            events: {
              onStateChange: (e) => {
                if (e.data === YT.PlayerState.PLAYING) {
                   startProgress(player);
                }
                if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
                   stopProgress();
                }
                if (e.data === YT.PlayerState.ENDED) {
                  ligne.classList.remove("playing");
                  btnPlay.textContent = "▶";
                  if (progressBar) progressBar.style.width = "0%";
                }
              },
            },
          });
          lecteursYT.set(vid, player);
        }
        player.playVideo();
        btnPlay.textContent = "⏸";
      }
    });

    // Like Button Logic
    if (btnLike) {
      btnLike.addEventListener("click", (e) => {
        e.stopPropagation();
        btnLike.classList.toggle("liked");
        const isLiked = btnLike.classList.contains("liked");

        if (isLiked) {
          if (!likes.some((l) => l.id === vid)) {
            likes.push({ id: vid, title: title, artist: titreArtiste });
            saveLikes();
          }
          if (window.showToast) window.showToast("Ajouté aux favoris");
        } else {
          likes = likes.filter((l) => l.id !== vid);
          saveLikes();
          if (window.showToast) window.showToast("Retiré des favoris");
        }
      });
    }

    // Add to Playlist Logic
    if (btnAdd) {
      btnAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        openPlaylistModal({ id: vid, title: title, artist: titreArtiste });
      });
    }
  });
});
