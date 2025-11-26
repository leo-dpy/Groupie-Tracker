
const elements = {
    vueBibliotheque: document.getElementById('library-view'),
    grilleBibliotheque: document.getElementById('library-grid'),
    vuePlaylist: document.getElementById('playlist-view'),
    chansonsPlaylist: document.getElementById('playlist-songs'),
    titrePlaylistCourante: document.getElementById('current-playlist-title'),
    actionsPlaylist: document.getElementById('playlist-actions'),
    btnRetour: document.getElementById('btn-back'),
    // Éléments de la modale
    modaleCreation: document.getElementById('create-playlist-modal'),
    entreeCreation: document.getElementById('create-playlist-name'),
    confirmerCreation: document.getElementById('confirm-create-playlist'),
    annulerCreation: document.getElementById('cancel-create-playlist'),
    // Modale de renommage
    modaleRenommage: document.getElementById('rename-playlist-modal'),
    entreeRenommage: document.getElementById('rename-playlist-name'),
    confirmerRenommage: document.getElementById('confirm-rename-playlist'),
    annulerRenommage: document.getElementById('cancel-rename-playlist'),
    // Modale de confirmation
    modaleConfirmation: document.getElementById('confirm-modal'),
    titreConfirmation: document.getElementById('confirm-title'),
    messageConfirmation: document.getElementById('confirm-message'),
    btnConfirmer: document.getElementById('btn-confirm-action'),
    annulerConfirmation: document.getElementById('cancel-confirm')
};

// Logique du lecteur YouTube
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

const formaterTemps = (t)=>{
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

function creerElementLecteur(chanson, conteneur, surSuppression, surFin) {
    const vid = chanson.id;
    const titre = chanson.title;
    const ligne = document.createElement('div');
    ligne.className = 'audio-item';
    ligne.innerHTML = `
        <img class="audio-thumb" alt="" src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" />
        <button class="audio-play" aria-label="Lire">▶</button>
        <div class="audio-meta">
        <div class="audio-title" title="${(titre || '').replace(/&/g,'&amp;').replace(/\"/g,'&quot;')}">${titre || ''}</div>
        <div class="audio-bar" role="slider" aria-label="Position"><div class="audio-progress"></div></div>
        <div class="audio-controls">
            <button class="audio-mute" aria-label="Muet">🔊</button>
            <div class="audio-time">0:00 / 0:00</div>
            <input class="audio-volume" type="range" min="0" max="100" value="60" aria-label="Volume" />
        </div>
        </div>
        <div class="audio-actions" style="display:flex;flex-direction:column;gap:5px;margin-left:10px;">
            <button class="btn-delete" title="Retirer" style="background:none;border:none;cursor:pointer;font-size:1.2rem;">🗑️</button>
        </div>
        <div id="yt-holder-${vid}-${Math.random().toString(36).substr(2, 9)}" class="visually-hidden"></div>
    `;
    
    const idConteneur = ligne.querySelector('[id^="yt-holder-"]').id;

    const btn = ligne.querySelector('.audio-play');
    const prog = ligne.querySelector('.audio-progress');
    const elTemps = ligne.querySelector('.audio-time');
    const vol = ligne.querySelector('.audio-volume');
    const barre = ligne.querySelector('.audio-bar');
    const btnMuet = ligne.querySelector('.audio-mute');
    const btnSuppr = ligne.querySelector('.btn-delete');

    if (surSuppression) {
        btnSuppr.addEventListener('click', surSuppression);
    } else {
        btnSuppr.style.display = 'none';
    }

    conteneur.appendChild(ligne);

    const creer = (lectureAuto = false) => {
        const conteneur = document.getElementById(idConteneur);
        const varsLecteur = { controls: 0, modestbranding: 1, rel: 0 };
        if (lectureAuto) varsLecteur.autoplay = 1;

        const lecteur = new YT.Player(conteneur, {
        width: 320,
        height: 180,
        videoId: vid,
        playerVars: varsLecteur,
        events: {
            onReady: () => { try { lecteur.setVolume(Number(vol.value)||60); } catch {} },
            onStateChange: (ev) => {
            const obj = lecteursYT.get(idConteneur);
            if (!obj) return;
            if (ev.data === YT.PlayerState.PLAYING) {
                arreterAutres(idConteneur);
                btn.textContent = '⏸';
                if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                obj.minuteur = setInterval(()=>{
                try {
                    const cur = obj.lecteur.getCurrentTime() || 0;
                    const dur = obj.lecteur.getDuration() || 0;
                    const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
                    if (!obj.glissement) { obj.prog.style.width = pct + '%'; }
                    obj.elTemps.textContent = `${formaterTemps(cur)} / ${formaterTemps(dur)}`;
                } catch {}
                }, 500);
            } else if (ev.data === YT.PlayerState.PAUSED) {
                btn.textContent = '▶';
                if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
            } else if (ev.data === YT.PlayerState.ENDED) {
                btn.textContent = '▶';
                if (obj.minuteur) { clearInterval(obj.minuteur); obj.minuteur = null; }
                if (surFin) surFin();
            }
            }
        }
        });
        lecteursYT.set(idConteneur, { lecteur, btn, prog, elTemps, vol, barre, btnMuet, minuteur: null, glissement: false });
        return lecteur;
    };

    const jouer = async () => {
        await assurerApiYT();
        let obj = lecteursYT.get(idConteneur);
        if (!obj) { 
            creer(true); 
        } else {
            try { obj.lecteur.playVideo(); } catch {}
        }
    };

    btn.addEventListener('click', async ()=>{
        await assurerApiYT();
        let obj = lecteursYT.get(idConteneur);
        if (!obj) { const p = creer(true); obj = lecteursYT.get(idConteneur); }
        else {
            const pl = obj.lecteur;
            const etat = typeof pl.getPlayerState === 'function' ? pl.getPlayerState() : -1;
            if (etat === YT.PlayerState.PLAYING) {
                pl.pauseVideo();
            } else {
                arreterAutres(idConteneur);
                pl.playVideo();
            }
        }
    });

    vol.addEventListener('input', async ()=>{
        await assurerApiYT();
        let obj = lecteursYT.get(idConteneur);
        if (!obj) { const p = creer(); obj = lecteursYT.get(idConteneur); }
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
        let obj = lecteursYT.get(idConteneur);
        if (!obj) { const p = creer(); obj = lecteursYT.get(idConteneur); }
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
        let obj = lecteursYT.get(idConteneur);
        if (!obj) { const p = creer(); obj = lecteursYT.get(idConteneur); }
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

    return { jouer };
}

// État
let aimes = JSON.parse(localStorage.getItem('likes') || '[]');
let playlists = JSON.parse(localStorage.getItem('playlists') || '[]');

// Navigation
elements.btnRetour.addEventListener('click', () => {
    elements.vuePlaylist.classList.add('hidden');
    elements.vueBibliotheque.classList.remove('hidden');
    // Arrêter tous les lecteurs
    arreterAutres(null);
    afficherBibliotheque();
});

// Logique de la modale
elements.annulerCreation.addEventListener('click', () => {
    elements.modaleCreation.classList.add('hidden');
    elements.entreeCreation.value = '';
});

elements.confirmerCreation.addEventListener('click', () => {
    const nom = elements.entreeCreation.value.trim();
    if (nom) {
        const nouvellePl = { id: Date.now(), name: nom, songs: [] };
        playlists.push(nouvellePl);
        localStorage.setItem('playlists', JSON.stringify(playlists));
        elements.modaleCreation.classList.add('hidden');
        elements.entreeCreation.value = '';
        afficherBibliotheque();
        afficherToast(`Playlist "${nom}" créée`, 'success');
    } else {
        afficherToast("Veuillez entrer un nom de playlist.", 'error');
    }
});

// Logique de la modale de renommage
elements.annulerRenommage.addEventListener('click', () => {
    elements.modaleRenommage.classList.add('hidden');
});

function ouvrirModaleRenommer(nomActuel, surSauvegarde) {
    elements.entreeRenommage.value = nomActuel;
    elements.modaleRenommage.classList.remove('hidden');
    elements.entreeRenommage.focus();

    // Utiliser onclick pour éviter l'empilement des écouteurs
    elements.confirmerRenommage.onclick = () => {
        const nouveauNom = elements.entreeRenommage.value.trim();
        if (nouveauNom) {
            elements.modaleRenommage.classList.add('hidden');
            surSauvegarde(nouveauNom);
            afficherToast("Playlist renommée", 'success');
        } else {
            afficherToast("Le nom ne peut pas être vide.", 'error');
        }
    };
}

// Logique de la modale de confirmation
elements.annulerConfirmation.addEventListener('click', () => {
    elements.modaleConfirmation.classList.add('hidden');
});

function ouvrirModaleConfirmation(titre, message, surConfirmation) {
    elements.titreConfirmation.textContent = titre;
    elements.messageConfirmation.textContent = message;
    elements.modaleConfirmation.classList.remove('hidden');
    
    // Utiliser onclick pour éviter l'empilement des écouteurs
    elements.btnConfirmer.onclick = () => {
        elements.modaleConfirmation.classList.add('hidden');
        surConfirmation();
    };
}

function afficherBibliotheque() {
    elements.grilleBibliotheque.innerHTML = '';

    // 1. Carte des titres aimés
    const carteAimes = document.createElement('div');
    carteAimes.className = 'playlist-card';
    carteAimes.innerHTML = `
        <div>
            <h3>❤️ Titres Likés</h3>
            <div class="count">${aimes.length} titres</div>
        </div>
        <button class="play-btn" title="Lire tout">▶</button>
    `;
    carteAimes.addEventListener('click', (e) => {
        if (e.target.closest('.play-btn')) {
            e.stopPropagation();
            ouvrirVuePlaylist('likes', true);
        } else {
            ouvrirVuePlaylist('likes');
        }
    });
    elements.grilleBibliotheque.appendChild(carteAimes);

    // 2. Playlists utilisateur
    playlists.forEach(pl => {
        const carte = document.createElement('div');
        carte.className = 'playlist-card';
        carte.innerHTML = `
            <div>
                <h3>${pl.name}</h3>
                <div class="count">${pl.songs.length} titres</div>
            </div>
            <button class="play-btn" title="Lire tout">▶</button>
        `;
        carte.addEventListener('click', (e) => {
            if (e.target.closest('.play-btn')) {
                e.stopPropagation();
                ouvrirVuePlaylist(pl.id, true);
            } else {
                ouvrirVuePlaylist(pl.id);
            }
        });
        elements.grilleBibliotheque.appendChild(carte);
    });

    // 3. Carte de création de playlist (Dernière)
    const carteCreation = document.createElement('div');
    carteCreation.className = 'playlist-card create-card';
    carteCreation.innerHTML = `
        <div style="text-align:center;">
            <div style="font-size:3rem;margin-bottom:10px;">+</div>
            <div>Créer une playlist</div>
        </div>
    `;
    carteCreation.addEventListener('click', () => {
        elements.modaleCreation.classList.remove('hidden');
        elements.entreeCreation.focus();
    });
    elements.grilleBibliotheque.appendChild(carteCreation);
}

function ouvrirVuePlaylist(idPlaylist, lectureAuto = false) {
    elements.vueBibliotheque.classList.add('hidden');
    elements.vuePlaylist.classList.remove('hidden');
    elements.chansonsPlaylist.innerHTML = '';
    elements.actionsPlaylist.innerHTML = '';

    let chansonsAAfficher = [];
    let surSuppression = null;

    if (idPlaylist === 'likes') {
        elements.titrePlaylistCourante.textContent = "Titres Likés";
        chansonsAAfficher = aimes;
        surSuppression = (chanson) => {
            ouvrirModaleConfirmation('Retirer des J\'aime', 'Voulez-vous vraiment retirer ce titre des J\'aime ?', () => {
                aimes = aimes.filter(l => l.id !== chanson.id);
                localStorage.setItem('likes', JSON.stringify(aimes));
                ouvrirVuePlaylist('likes'); // Rafraîchir
                afficherToast("Retiré des J'aime", 'success');
            });
        };
    } else {
        const pl = playlists.find(p => p.id === idPlaylist);
        if (!pl) return; 
        elements.titrePlaylistCourante.textContent = pl.name;
        chansonsAAfficher = pl.songs;

        // Actions : Renommer, Supprimer
        const btnRenommer = document.createElement('button');
        btnRenommer.className = 'btn';
        btnRenommer.textContent = 'Renommer';
        btnRenommer.onclick = () => {
            ouvrirModaleRenommer(pl.name, (nouveauNom) => {
                pl.name = nouveauNom;
                localStorage.setItem('playlists', JSON.stringify(playlists));
                elements.titrePlaylistCourante.textContent = pl.name;
            });
        };
        elements.actionsPlaylist.appendChild(btnRenommer);

        const btnSupprimer = document.createElement('button');
        btnSupprimer.className = 'btn';
        btnSupprimer.style.borderColor = 'rgba(248, 113, 113, 0.3)';
        btnSupprimer.style.color = '#f87171';
        btnSupprimer.textContent = 'Supprimer';
        btnSupprimer.onclick = () => {
            ouvrirModaleConfirmation('Supprimer la playlist', 'Voulez-vous vraiment supprimer cette playlist ?', () => {
                playlists = playlists.filter(p => p.id !== pl.id);
                localStorage.setItem('playlists', JSON.stringify(playlists));
                elements.btnRetour.click();
                afficherToast("Playlist supprimée", 'success');
            });
        };
        elements.actionsPlaylist.appendChild(btnSupprimer);

        surSuppression = (chanson) => {
            ouvrirModaleConfirmation('Retirer de la playlist', 'Voulez-vous vraiment retirer ce titre de la playlist ?', () => {
                pl.songs = pl.songs.filter(s => s.id !== chanson.id);
                const idx = playlists.findIndex(p => p.id === pl.id);
                if (idx !== -1) playlists[idx] = pl;
                localStorage.setItem('playlists', JSON.stringify(playlists));
                ouvrirVuePlaylist(pl.id); // Rafraîchir
                afficherToast("Titre retiré de la playlist", 'success');
            });
        };
    }

    if (chansonsAAfficher.length === 0) {
        elements.chansonsPlaylist.innerHTML = '<p class="texte-gris">Playlist vide.</p>';
    } else {
        const fonctionsLecture = [];
        chansonsAAfficher.forEach((chanson, index) => {
            const element = creerElementLecteur(chanson, elements.chansonsPlaylist, () => surSuppression(chanson), () => {
                // À la fin : Lire le suivant
                const indexSuivant = index + 1;
                if (indexSuivant < fonctionsLecture.length) {
                    fonctionsLecture[indexSuivant]();
                }
            });
            fonctionsLecture.push(element.jouer);
        });

        if (lectureAuto && fonctionsLecture.length > 0) {
            fonctionsLecture[0]();
        }
    }
}

// Rendu initial
afficherBibliotheque();
