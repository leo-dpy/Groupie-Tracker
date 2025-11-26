// Toutes les données viennent du backend Go
const API_BASE = "/api";
const BASE_YT = "/yt";

// Désactiver la bannière d'erreur de débogage globale par défaut ; activer avec ?debug=1
const AFFICHER_ERREURS_GLOBALES = /(^|[?&])debug=1(&|$)/.test(location.search);

const elements = {
  titre: document.getElementById("titre-artiste"),
  corpsDetails: document.getElementById("corps-details"),
  erreur: document.getElementById("erreur"),
};

let PROMESSE_CHARGEMENT_API_YT = null;
const lecteursYT = new Map();
function assurerApiYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (PROMESSE_CHARGEMENT_API_YT) return PROMESSE_CHARGEMENT_API_YT;
  PROMESSE_CHARGEMENT_API_YT = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() { if (typeof prev === 'function') { try { prev(); } catch {} } resolve(); };
    document.head.appendChild(tag);
  });
  return PROMESSE_CHARGEMENT_API_YT;
}

function afficherErreur(msg) {
  elements.erreur.textContent = msg || "";
  elements.erreur.style.display = msg ? "block" : "none";
}

// Debug/erreurs globaux pour visibilité (activé uniquement en mode debug)
if (AFFICHER_ERREURS_GLOBALES) {
  window.addEventListener('error', (e) => {
    try { afficherErreur(`Erreur JS: ${e.message}`); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { afficherErreur(`Erreur Promesse: ${e.reason?.message || e.reason}`); } catch {}
  });
}

function pause(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function chargerJSON(url, { essais = 0, delaiMs = 10000 } = {}) {
  const controleur = new AbortController();
  const id = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const res = await fetch(url, { mode: 'cors', signal: controleur.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText})`);
    return await res.json();
  } catch (e) {
    if (essais > 0) {
      await pause(1200);
      return chargerJSON(url, { essais: essais - 1, delaiMs });
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function obtenirIdDepuisRequete() {
  const p = new URLSearchParams(location.search);
  const id = Number(p.get("id"));
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function chargerArtiste(id) {
  try {
    afficherErreur("");
    elements.corpsDetails.innerHTML = "Chargement...";

    // Récupérer les données de l'artiste depuis le backend Go (toute manipulation faite côté serveur)
    const artiste = await chargerJSON(`/api/artiste/${id}`, { essais: 2, delaiMs: 12000 });
    
    if (!artiste || !artiste.id) {
      afficherErreur("Artiste introuvable.");
      elements.corpsDetails.innerHTML = "";
      return;
    }

    elements.titre.textContent = artiste.name;
    if (AFFICHER_ERREURS_GLOBALES) { try { afficherErreur(`Debug: artiste ${id} chargé depuis Go backend.`); } catch {} }

    // Reprend la logique de details depuis app.js (simplifiée)
    elements.corpsDetails.innerHTML = "";

    const entete = document.createElement("div");
    entete.className = "bloc";
    entete.innerHTML = `
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
        <img alt="${artiste.name}" src="${artiste.image}" style="width:120px;height:120px;border-radius:var(--radius-md);object-fit:cover;box-shadow:0 10px 30px rgba(0,0,0,0.3);" />
        <div>
          <h2 style="margin:0 0 8px 0;font-size:32px;font-weight:700;">${artiste.name}</h2>
          <div class="texte-gris" style="font-size:14px;margin-bottom:12px;">Créé: ${artiste.creationDate} • 1er album: ${artiste.firstAlbum}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${(artiste.members||[]).map(m=>`<a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(m)}" target="_blank" rel="noopener" class="etiquette" title="Voir sur Wikipedia">${m}</a>`).join("")}</div>
        </div>
      </div>
    `;
    elements.corpsDetails.appendChild(entete);

    const chargement = document.createElement("div");
    chargement.innerHTML = `
      <div class="bloc">
        <div class="squelette" style="width:40%;height:20px;margin-bottom:16px;"></div>
        <div class="squelette" style="width:100%;height:60px;"></div>
      </div>
      <div class="bloc">
        <div class="squelette" style="width:40%;height:20px;margin-bottom:16px;"></div>
        <div class="squelette" style="width:100%;height:60px;"></div>
      </div>
    `;
    elements.corpsDetails.appendChild(chargement);

    try {
      // Les données des concerts viennent déjà du backend Go dans artiste.shows
      chargement.remove();

      const sectionLieux = document.createElement("div");
      sectionLieux.className = "bloc";
      sectionLieux.innerHTML = `<h3>Concerts</h3>`;
      const conteneurLieux = document.createElement("div");
      
      // Extraire les lieux des concerts (Go a déjà combiné cela)
      const concerts = artiste.shows || [];
      const lieux = [...new Set(concerts.map(s => s.location))]; // lieux uniques
      
      lieux.forEach(l => {
        const a = document.createElement("a");
        a.className = "etiquette";
        const lieuPropre = (l || "").replace(/-/g, ", ").replace(/_/g, " ");
        a.textContent = lieuPropre;
        a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lieuPropre)}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.setAttribute('data-map', '1');
        a.title = `Ouvrir sur Google Maps: ${lieuPropre}`;
        conteneurLieux.appendChild(a);
      });
      sectionLieux.appendChild(conteneurLieux);
      elements.corpsDetails.appendChild(sectionLieux);

      const sectionDates = document.createElement("div");
      sectionDates.className = "bloc";
      sectionDates.innerHTML = `<h3>Dates de concert</h3>`;
      const conteneurDates = document.createElement("div");
      
      // Extraire les dates des concerts (Go a déjà combiné cela)
      const dates = [...new Set(concerts.map(s => s.date))]; // dates uniques
      dates.forEach(d => {
        const span = document.createElement("span");
        span.className = "etiquette";
        const propre = (d||"").toString().replace(/^[\*•\-\s]+/, "");
        span.textContent = propre;
        conteneurDates.appendChild(span);
      });
      sectionDates.appendChild(conteneurDates);
      elements.corpsDetails.appendChild(sectionDates);

      // Section relations supprimée (jugée confuse)

      const sectionYT = document.createElement("div");
      sectionYT.className = "bloc";
      sectionYT.innerHTML = `<h3>Lecteur audio</h3>`;
      const conteneurYT = document.createElement("div");
      
      // Toujours afficher le lien de recherche YouTube pour l'artiste
      const divLienRecherche = document.createElement("div");
      divLienRecherche.style.marginBottom = "16px";
      const q = encodeURIComponent(`${artiste.name} official audio`);
      const lienRecherche = document.createElement("a");
      lienRecherche.href = `https://www.youtube.com/results?search_query=${q}`;
      lienRecherche.target = "_blank";
      lienRecherche.rel = "noopener";
      lienRecherche.className = "etiquette";
      lienRecherche.style.display = "inline-flex";
      lienRecherche.innerHTML = `<span style="font-size:1.2em; margin-right:8px; line-height:1;">🎵</span><span>Rechercher "${artiste.name}" sur YouTube</span>`;
      divLienRecherche.appendChild(lienRecherche);
      conteneurYT.appendChild(divLienRecherche);
      
      try {
        let videos = [];
        try {
          const qChaine = encodeURIComponent(`${artiste.name} official`);
          const resChaine = await chargerJSON(`${BASE_YT}/search?q=${qChaine}&type=channel&maxResults=10`, { essais: 1, delaiMs: 12000 });
          const chaines = (resChaine && resChaine.items) || [];
          let meilleurIdChaine = null;
          let meilleurScore = -1;
          chaines.forEach(ch => {
            const titre = (ch.snippet && ch.snippet.channelTitle || "").toLowerCase();
            let score = 0;
            if (titre.endsWith(" - topic")) score += 5;
            if (titre.includes("official")) score += 3;
            if (titre.includes("vevo")) score += 2;
            if (titre.includes(artiste.name.toLowerCase())) score += 1;
            if (score > meilleurScore) { meilleurScore = score; meilleurIdChaine = ch.id && ch.id.channelId; }
          });
          if (meilleurIdChaine) {
            const resV = await chargerJSON(`${BASE_YT}/search?channelId=${meilleurIdChaine}&type=video&videoEmbeddable=true&order=viewCount&maxResults=8`, { essais: 1, delaiMs: 12000 });
            videos = (resV && resV.items) || [];
          }
        } catch {}

        if (videos.length === 0) {
          const variantes = [
            `${artiste.name} - Topic`,
            `${artiste.name} official audio`,
            `${artiste.name} audio`,
            `${artiste.name} full album`,
            `${artiste.name} VEVO`
          ];
          for (const vq of variantes) {
            try {
              const q = encodeURIComponent(vq);
              const yres = await chargerJSON(`${BASE_YT}/search?q=${q}&type=video&videoEmbeddable=true&maxResults=8`, { essais: 1, delaiMs: 12000 });
              const items = (yres && yres.items) || [];
              if (items.length > 0) { videos = items; break; }
            } catch {}
          }
        }

        let filtres = [];
        try {
          if (videos.length > 0) {
            const ids = videos.map(v => v && v.id && (v.id.videoId || v.id.videoID || v.id.videoid)).filter(Boolean);
            if (ids.length > 0) {
              const vinfo = await chargerJSON(`${BASE_YT}/videos?part=snippet,contentDetails&id=${ids.join(',')}`, { essais: 1, delaiMs: 12000 });
              const items = (vinfo && vinfo.items) || [];
              const parserDureeIso = (iso) => {
                const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
                if (!m) return 0;
                const h = parseInt(m[1]||"0",10), mm = parseInt(m[2]||"0",10), s = parseInt(m[3]||"0",10);
                return h*3600 + mm*60 + s;
              };
              const infoParId = new Map(items.map(it => [it.id, it]));
              filtres = ids.map(id => {
                const it = infoParId.get(id);
                if (!it) return null;
                const cat = it.snippet && it.snippet.categoryId;
                const dur = parserDureeIso(it.contentDetails && it.contentDetails.duration);
                if (cat === "10" && dur >= 120) return { id, title: (it.snippet && it.snippet.title) || "Piste" };
                return null;
              }).filter(Boolean);
            }
          }
        } catch {}

        if ((!filtres || filtres.length === 0) && videos.length > 0) {
          filtres = videos.map(v => {
            const id = v && v.id && (v.id.videoId || v.id.videoID || v.id.videoid);
            return id ? { id, title: (v.snippet && v.snippet.title) || "Piste" } : null;
          }).filter(Boolean).slice(0,3);
        }

        if (!filtres || filtres.length === 0) {
          const enveloppe = document.createElement("div");
          const p = document.createElement("p");
          p.className = "texte-gris";
          p.style.fontStyle = "italic";
          p.textContent = "Lecteur vidéo non disponible (nécessite une clé API YouTube).";
          enveloppe.appendChild(p);
          conteneurYT.appendChild(enveloppe);
        } else {
          const fmt = (t)=>{
            t = Math.max(0, Math.floor(t||0));
            const m = Math.floor(t/60);
            const s = t%60; return `${m}:${String(s).padStart(2,'0')}`;
          };
          const arreterAutres = (saufId) => {
            lecteursYT.forEach((obj,cle)=>{
              if (cle === saufId) return;
              try { obj.lecteur.pauseVideo(); } catch {}
              if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
              obj.btn.textContent = '▶';
            });
          };
          await assurerApiYT();
          filtres.forEach(({id: vid, title}) => {
            const ligne = document.createElement('div');
            ligne.className = 'audio-item';
            ligne.innerHTML = `
              <img class="audio-thumb" alt="" src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" />
              <button class="audio-play" aria-label="Lire">▶</button>
              <div class="audio-meta">
                <div class="audio-title" title="${(title || '').replace(/&/g,'&amp;').replace(/\"/g,'&quot;')}">${title || ''}</div>
                <div class="audio-bar" role="slider" aria-label="Position"><div class="audio-progress"></div></div>
                <div class="audio-controls">
                  <button class="audio-mute" aria-label="Muet">🔊</button>
                  <div class="audio-time">0:00 / 0:00</div>
                  <input class="audio-volume" type="range" min="0" max="100" value="60" aria-label="Volume" />
                </div>
              </div>
              <div class="audio-actions" style="display:flex;flex-direction:column;gap:5px;">
                <button class="btn-like" title="J'aime" style="background:none;border:none;cursor:pointer;font-size:1.2rem;">🤍</button>
                <button class="btn-playlist" title="Ajouter à une playlist" style="background:none;border:none;cursor:pointer;font-size:1.2rem;">➕</button>
              </div>
              <div id="yt-holder-${vid}" class="visually-hidden"></div>
            `;
            const btn = ligne.querySelector('.audio-play');
            const prog = ligne.querySelector('.audio-progress');
            const elTemps = ligne.querySelector('.audio-time');
            const vol = ligne.querySelector('.audio-volume');
            const barre = ligne.querySelector('.audio-bar');
            const btnMuet = ligne.querySelector('.audio-mute');
            const btnLike = ligne.querySelector('.btn-like');
            const btnPlaylist = ligne.querySelector('.btn-playlist');

            // Vérifier si aimé
            const aimes = JSON.parse(localStorage.getItem('likes') || '[]');
            if (aimes.some(l => l.id === vid)) {
                btnLike.textContent = '❤️';
            }

            btnLike.addEventListener('click', () => {
                let aimes = JSON.parse(localStorage.getItem('likes') || '[]');
                const idx = aimes.findIndex(l => l.id === vid);
                if (idx === -1) {
                    aimes.push({ id: vid, title: title, artist: artiste.name });
                    btnLike.textContent = '❤️';
                    afficherToast("Ajouté aux J'aime", 'success');
                } else {
                    aimes.splice(idx, 1);
                    btnLike.textContent = '🤍';
                    afficherToast("Retiré des J'aime", 'success');
                }
                localStorage.setItem('likes', JSON.stringify(aimes));
            });

            btnPlaylist.addEventListener('click', (e) => {
                e.stopPropagation();
                ouvrirModalePlaylist(vid, title, artiste.name);
            });

            conteneurYT.appendChild(ligne);
            const creer = () => {
              const conteneur = ligne.querySelector(`#yt-holder-${vid}`);
              const lecteur = new YT.Player(conteneur, {
                width: 320,
                height: 180,
                videoId: vid,
                playerVars: { controls: 0, modestbranding: 1, rel: 0 },
                events: {
                  onReady: () => { try { lecteur.setVolume(Number(vol.value)||60); } catch {} },
                  onStateChange: (ev) => {
                    const obj = lecteursYT.get(vid);
                    if (!obj) return;
                    if (ev.data === YT.PlayerState.PLAYING) {
                      arreterAutres(vid);
                      btn.textContent = '⏸';
                      if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                      obj.minuteur = setInterval(()=>{
                        try {
                          const cur = obj.lecteur.getCurrentTime() || 0;
                          const dur = obj.lecteur.getDuration() || 0;
                          const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
                          if (!obj.glissement) { obj.prog.style.width = pct + '%'; }
                          obj.elTemps.textContent = `${fmt(cur)} / ${fmt(dur)}`;
                        } catch {}
                      }, 500);
                    } else if (ev.data === YT.PlayerState.PAUSED) {
                      btn.textContent = '▶';
                      if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                    } else if (ev.data === YT.PlayerState.ENDED) {
                      btn.textContent = '▶';
                      if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                    }
                  }
                }
              });
              lecteursYT.set(vid, { lecteur, btn, prog, elTemps, vol, barre, btnMuet, minuteur: null, glissement: false });
              return lecteur;
            };
            btn.addEventListener('click', async ()=>{
              await assurerApiYT();
              let obj = lecteursYT.get(vid);
              if (!obj) { const p = creer(); obj = lecteursYT.get(vid); }
              const pl = obj.lecteur;
              const etat = typeof pl.getPlayerState === 'function' ? pl.getPlayerState() : -1;
              if (etat === YT.PlayerState.PLAYING) {
                pl.pauseVideo();
                btn.textContent = '▶';
                if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
              } else {
                arreterAutres(vid);
                pl.playVideo();
                btn.textContent = '⏸';
                if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                obj.minuteur = setInterval(()=>{
                  try {
                    const cur = pl.getCurrentTime() || 0;
                    const dur = pl.getDuration() || 0;
                    const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
                    if (!obj.glissement) { obj.prog.style.width = pct + '%'; }
                    obj.elTemps.textContent = `${fmt(cur)} / ${fmt(dur)}`;
                  } catch {}
                }, 500);
              }
            });
            vol.addEventListener('input', async ()=>{
              await assurerApiYT();
              let obj = lecteursYT.get(vid);
              if (!obj) { const p = creer(); obj = lecteursYT.get(vid); }
              try { obj.lecteur.setVolume(Number(vol.value)||0); } catch {}
            });
            const obtenirX = (ev) => {
              if (ev.touches && ev.touches[0]) return ev.touches[0].clientX;
              if (ev.changedTouches && ev.changedTouches[0]) return ev.changedTouches[0].clientX;
              return ev.clientX;
            };
            const debutGlissement = async (ev)=>{
              ev.preventDefault();
              await assurerApiYT();
              let obj = lecteursYT.get(vid);
              if (!obj) { const p = creer(); obj = lecteursYT.get(vid); }
              obj.glissement = true;
              const pl = obj.lecteur;
              const rect = barre.getBoundingClientRect();
              const deplacer = (e)=>{
                try {
                  const x = Math.max(0, Math.min(rect.width, obtenirX(e) - rect.left));
                  const frac = rect.width ? (x / rect.width) : 0;
                  obj.prog.style.width = (frac*100) + '%';
                } catch {}
              };
              const fin = (e)=>{
                try {
                  const x = Math.max(0, Math.min(rect.width, obtenirX(e) - rect.left));
                  const frac = rect.width ? (x / rect.width) : 0;
                  const dur = pl.getDuration() || 0;
                  if (dur > 0) { pl.seekTo(dur * frac, true); }
                } catch {}
                obj.glissement = false;
                window.removeEventListener('mousemove', deplacer);
                window.removeEventListener('mouseup', fin);
                window.removeEventListener('touchmove', deplacer);
                window.removeEventListener('touchend', fin);
              };
              window.addEventListener('mousemove', deplacer);
              window.addEventListener('mouseup', fin);
              window.addEventListener('touchmove', deplacer);
              window.addEventListener('touchend', fin);
              deplacer(ev);
            };
            barre.addEventListener('mousedown', debutGlissement);
            barre.addEventListener('touchstart', debutGlissement, { passive: false });
            btnMuet.addEventListener('click', async ()=>{
              await assurerApiYT();
              let obj = lecteursYT.get(vid);
              if (!obj) { const p = creer(); obj = lecteursYT.get(vid); }
              try {
                if (obj.lecteur.isMuted && obj.lecteur.isMuted()) {
                  obj.lecteur.unMute();
                  btnMuet.textContent = '🔊';
                } else {
                  obj.lecteur.mute();
                  btnMuet.textContent = '🔇';
                }
              } catch {}
            });
          });
        }
      } catch (e) {
        const enveloppe = document.createElement("div");
        const p = document.createElement("p");
        p.className = "texte-gris";
        p.textContent = "Vidéos indisponibles pour le moment (quota ou indisponibilité).";
        const liens = document.createElement("div");
        liens.style.marginTop = "8px";
        const q = encodeURIComponent(`${artiste.name} official audio`);
        const a = document.createElement("a");
        a.href = `https://www.youtube.com/results?search_query=${q}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "etiquette";
        a.textContent = `Rechercher "${artiste.name}" sur YouTube`;
        liens.appendChild(a);
        enveloppe.appendChild(p);
        enveloppe.appendChild(liens);
        conteneurYT.appendChild(enveloppe);
      }
      sectionYT.appendChild(conteneurYT);
      elements.corpsDetails.appendChild(sectionYT);
      afficherErreur("");

    } catch (e) {
      chargement.remove();
      const err = document.createElement("div");
      err.className = "erreur";
      err.textContent = "Certaines informations supplémentaires ne sont pas disponibles pour le moment.";
      elements.corpsDetails.appendChild(err);
    }

  } catch (e) {
    afficherErreur(`Erreur de chargement de l'artiste: ${e.message}`);
    elements.corpsDetails.innerHTML = "";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const id = obtenirIdDepuisRequete();
  // Accrocher la recherche d'en-tête pour rediriger vers l'accueil avec la requête
  try {
    const navRecherche = document.getElementById('nav-search');
    if (navRecherche) {
      navRecherche.addEventListener('keydown', (ev)=>{
        if (ev.key === 'Enter') {
          const q = (navRecherche.value || '').trim();
          const url = q ? `/?q=${encodeURIComponent(q)}#search` : '/#search';
          window.location.href = url;
        }
      });
    }
  } catch {}
  try {
    const sec = document.getElementById("details");
    if (sec) sec.style.display = "block";
  } catch {}
  if (!id) {
    afficherErreur("Aucun identifiant d'artiste fourni.");
    return;
  }
  
  const btnBiblio = document.getElementById('btn-biblio');
  if (btnBiblio) {
      btnBiblio.addEventListener('click', () => {
          window.location.href = '/html/library.html';
      });
  }

  chargerArtiste(id);
});

function ouvrirModalePlaylist(vid, titre, artiste) {
    const modale = document.getElementById('playlist-choice-modal');
    const liste = document.getElementById('playlist-choice-list');
    const btnCreer = document.getElementById('create-playlist-modal-btn');
    const entreeNouveauNom = document.getElementById('new-playlist-name-modal');
  const btnAnnuler = document.getElementById('cancel-playlist-modal-btn');

    if (!modale || !liste) return;

    const afficherListe = () => {
        liste.innerHTML = '';
        const playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
        
        if (playlists.length === 0) {
            const p = document.createElement('p');
            p.className = "texte-gris";
            p.textContent = "Aucune playlist personnalisée.";
            liste.appendChild(p);
        }
        playlists.forEach(pl => {
            const div = document.createElement('div');
            div.className = 'audio-item';
            div.style.cursor = 'pointer';
            div.style.display = 'block';
            div.style.marginBottom = '8px';
            div.textContent = pl.name;
            div.addEventListener('click', () => {
                ajouterAPlaylist(pl.id, vid, titre, artiste);
                modale.style.display = 'none';
            });
            liste.appendChild(div);
        });
    };

    afficherListe();
    modale.style.display = 'flex';

    // Attacher les écouteurs une seule fois pour le clic sur l'overlay et Echap
    if (!modale.dataset.listenersAttached) {
      modale.addEventListener('click', (e) => {
        // Le clic en dehors du contenu de la modale ferme
        const contenu = modale.querySelector('.modal-content');
        if (contenu && !contenu.contains(e.target)) {
          modale.style.display = 'none';
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modale.style.display !== 'none') {
          modale.style.display = 'none';
        }
      });
      modale.dataset.listenersAttached = '1';
    }

    // Utiliser onclick pour remplacer les écouteurs précédents sans cloner
    if (btnCreer && entreeNouveauNom) {
        btnCreer.onclick = () => {
            const nom = entreeNouveauNom.value.trim();
            if (!nom) {
                afficherToast("Veuillez entrer un nom de playlist.", 'error');
                return;
            }
            const playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
            const nouvellePl = { id: Date.now(), name: nom, songs: [] };
            playlists.push(nouvellePl);
            localStorage.setItem('playlists', JSON.stringify(playlists));
            afficherToast(`Playlist "${nom}" créée et titre ajouté`, 'success');
            ajouterAPlaylist(nouvellePl.id, vid, titre, artiste);
            entreeNouveauNom.value = '';
            modale.style.display = 'none';
        };
    }

    if (btnAnnuler) {
      btnAnnuler.onclick = () => {
        modale.style.display = 'none';
      };
    }
}

function ajouterAPlaylist(idPlaylist, vid, titre, artiste) {
    const playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
    const idx = playlists.findIndex(p => p.id === idPlaylist);
    if (idx !== -1) {
        if (!playlists[idx].songs.some(s => s.id === vid)) {
            playlists[idx].songs.push({ id: vid, title: titre, artist: artiste });
            localStorage.setItem('playlists', JSON.stringify(playlists));
            afficherToast(`Ajouté à la playlist "${playlists[idx].name}"`, 'success');
        } else {
            afficherToast('Déjà dans la playlist.', 'error');
        }
    }
}

