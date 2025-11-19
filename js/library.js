
const elts = {
    libraryView: document.getElementById('library-view'),
    libraryGrid: document.getElementById('library-grid'),
    playlistView: document.getElementById('playlist-view'),
    playlistSongs: document.getElementById('playlist-songs'),
    currentPlaylistTitle: document.getElementById('current-playlist-title'),
    playlistActions: document.getElementById('playlist-actions'),
    btnBack: document.getElementById('btn-back'),
    // Modal elements
    createModal: document.getElementById('create-playlist-modal'),
    createInput: document.getElementById('create-playlist-name'),
    createConfirm: document.getElementById('confirm-create-playlist'),
    createCancel: document.getElementById('cancel-create-playlist'),
    // Rename Modal
    renameModal: document.getElementById('rename-playlist-modal'),
    renameInput: document.getElementById('rename-playlist-name'),
    renameConfirm: document.getElementById('confirm-rename-playlist'),
    renameCancel: document.getElementById('cancel-rename-playlist'),
    // Confirm Modal
    confirmModal: document.getElementById('confirm-modal'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmBtn: document.getElementById('btn-confirm-action'),
    confirmCancel: document.getElementById('cancel-confirm')
};

// YouTube Player Logic
let YT_API_LOAD_PROMISE = null;
const ytPlayers = new Map();

function ensureYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (YT_API_LOAD_PROMISE) return YT_API_LOAD_PROMISE;
  YT_API_LOAD_PROMISE = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() { if (typeof prev === 'function') { try { prev(); } catch {} } resolve(); };
    document.head.appendChild(tag);
  });
  return YT_API_LOAD_PROMISE;
}

const fmt = (t)=>{
    t = Math.max(0, Math.floor(t||0));
    const m = Math.floor(t/60);
    const s = t%60; return `${m}:${String(s).padStart(2,'0')}`;
};

const stopOthers = (exceptId) => {
    ytPlayers.forEach((obj,key)=>{
        if (key === exceptId) return;
        try { obj.player.pauseVideo(); } catch {}
        if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
        obj.btn.textContent = '▶';
    });
};

function createPlayerItem(song, container, onDelete, onEnded) {
    const vid = song.id;
    const title = song.title;
    const row = document.createElement('div');
    row.className = 'audio-item';
    row.innerHTML = `
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
        <div class="audio-actions" style="display:flex;flex-direction:column;gap:5px;margin-left:10px;">
            <button class="btn-delete" title="Retirer" style="background:none;border:none;cursor:pointer;font-size:1.2rem;">🗑️</button>
        </div>
        <div id="yt-holder-${vid}-${Math.random().toString(36).substr(2, 9)}" class="visually-hidden"></div>
    `;
    
    const holderId = row.querySelector('[id^="yt-holder-"]').id;

    const btn = row.querySelector('.audio-play');
    const prog = row.querySelector('.audio-progress');
    const timeEl = row.querySelector('.audio-time');
    const vol = row.querySelector('.audio-volume');
    const bar = row.querySelector('.audio-bar');
    const muteBtn = row.querySelector('.audio-mute');
    const delBtn = row.querySelector('.btn-delete');

    if (onDelete) {
        delBtn.addEventListener('click', onDelete);
    } else {
        delBtn.style.display = 'none';
    }

    container.appendChild(row);

    const create = (shouldAutoplay = false) => {
        const holder = document.getElementById(holderId);
        const playerVars = { controls: 0, modestbranding: 1, rel: 0 };
        if (shouldAutoplay) playerVars.autoplay = 1;

        const player = new YT.Player(holder, {
        width: 320,
        height: 180,
        videoId: vid,
        playerVars: playerVars,
        events: {
            onReady: () => { try { player.setVolume(Number(vol.value)||60); } catch {} },
            onStateChange: (ev) => {
            const obj = ytPlayers.get(holderId);
            if (!obj) return;
            if (ev.data === YT.PlayerState.PLAYING) {
                stopOthers(holderId);
                btn.textContent = '⏸';
                if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
                obj.timer = setInterval(()=>{
                try {
                    const cur = obj.player.getCurrentTime() || 0;
                    const dur = obj.player.getDuration() || 0;
                    const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
                    if (!obj.dragging) { obj.prog.style.width = pct + '%'; }
                    obj.timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
                } catch {}
                }, 500);
            } else if (ev.data === YT.PlayerState.PAUSED) {
                btn.textContent = '▶';
                if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
            } else if (ev.data === YT.PlayerState.ENDED) {
                btn.textContent = '▶';
                if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
                if (onEnded) onEnded();
            }
            }
        }
        });
        ytPlayers.set(holderId, { player, btn, prog, timeEl, vol, bar, muteBtn, timer: null, dragging: false });
        return player;
    };

    const play = async () => {
        await ensureYTApi();
        let obj = ytPlayers.get(holderId);
        if (!obj) { 
            create(true); 
        } else {
            try { obj.player.playVideo(); } catch {}
        }
    };

    btn.addEventListener('click', async ()=>{
        await ensureYTApi();
        let obj = ytPlayers.get(holderId);
        if (!obj) { const p = create(true); obj = ytPlayers.get(holderId); }
        else {
            const pl = obj.player;
            const state = typeof pl.getPlayerState === 'function' ? pl.getPlayerState() : -1;
            if (state === YT.PlayerState.PLAYING) {
                pl.pauseVideo();
            } else {
                stopOthers(holderId);
                pl.playVideo();
            }
        }
    });

    vol.addEventListener('input', async ()=>{
        await ensureYTApi();
        let obj = ytPlayers.get(holderId);
        if (!obj) { const p = create(); obj = ytPlayers.get(holderId); }
        try { obj.player.setVolume(Number(vol.value)||0); } catch {}
    });

    const getX = (ev) => {
        if (ev.touches && ev.touches[0]) return ev.touches[0].clientX;
        if (ev.changedTouches && ev.changedTouches[0]) return ev.changedTouches[0].clientX;
        return ev.clientX;
    };

    const startDrag = async (ev)=>{
        ev.preventDefault();
        await ensureYTApi();
        let obj = ytPlayers.get(holderId);
        if (!obj) { const p = create(); obj = ytPlayers.get(holderId); }
        obj.dragging = true;
        const pl = obj.player;
        const rect = bar.getBoundingClientRect();
        const move = (e)=>{
        try {
            const x = Math.max(0, Math.min(rect.width, getX(e) - rect.left));
            const frac = rect.width ? (x / rect.width) : 0;
            obj.prog.style.width = (frac*100) + '%';
        } catch {}
        };
        const up = (e)=>{
        try {
            const x = Math.max(0, Math.min(rect.width, getX(e) - rect.left));
            const frac = rect.width ? (x / rect.width) : 0;
            const dur = pl.getDuration() || 0;
            if (dur > 0) { pl.seekTo(dur * frac, true); }
        } catch {}
        obj.dragging = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        window.addEventListener('touchmove', move);
        window.addEventListener('touchend', up);
        move(ev);
    };
    bar.addEventListener('mousedown', startDrag);
    bar.addEventListener('touchstart', startDrag, { passive: false });

    muteBtn.addEventListener('click', async ()=>{
        await ensureYTApi();
        let obj = ytPlayers.get(holderId);
        if (!obj) { const p = create(); obj = ytPlayers.get(holderId); }
        try {
        if (obj.player.isMuted && obj.player.isMuted()) {
            obj.player.unMute();
            muteBtn.textContent = '🔊';
        } else {
            obj.player.mute();
            muteBtn.textContent = '🔇';
        }
        } catch {}
    });

    return { play };
}

// State
let likes = JSON.parse(localStorage.getItem('likes') || '[]');
let playlists = JSON.parse(localStorage.getItem('playlists') || '[]');

// Navigation
elts.btnBack.addEventListener('click', () => {
    elts.playlistView.classList.add('hidden');
    elts.libraryView.classList.remove('hidden');
    // Stop all players
    stopOthers(null);
    renderLibrary();
});

// Modal Logic
elts.createCancel.addEventListener('click', () => {
    elts.createModal.classList.add('hidden');
    elts.createInput.value = '';
});

elts.createConfirm.addEventListener('click', () => {
    const name = elts.createInput.value.trim();
    if (name) {
        const newPl = { id: Date.now(), name: name, songs: [] };
        playlists.push(newPl);
        localStorage.setItem('playlists', JSON.stringify(playlists));
        elts.createModal.classList.add('hidden');
        elts.createInput.value = '';
        renderLibrary();
        showToast(`Playlist "${name}" créée`, 'success');
    } else {
        showToast("Veuillez entrer un nom de playlist.", 'error');
    }
});

// Rename Modal Logic
elts.renameCancel.addEventListener('click', () => {
    elts.renameModal.classList.add('hidden');
});

function openRenameModal(currentName, onSave) {
    elts.renameInput.value = currentName;
    elts.renameModal.classList.remove('hidden');
    elts.renameInput.focus();

    // Use onclick to avoid stacking listeners
    elts.renameConfirm.onclick = () => {
        const newName = elts.renameInput.value.trim();
        if (newName) {
            elts.renameModal.classList.add('hidden');
            onSave(newName);
            showToast("Playlist renommée", 'success');
        } else {
            showToast("Le nom ne peut pas être vide.", 'error');
        }
    };
}

// Confirm Modal Logic
elts.confirmCancel.addEventListener('click', () => {
    elts.confirmModal.classList.add('hidden');
});

function openConfirmModal(title, message, onConfirm) {
    elts.confirmTitle.textContent = title;
    elts.confirmMessage.textContent = message;
    elts.confirmModal.classList.remove('hidden');
    
    // Use onclick to avoid stacking listeners
    elts.confirmBtn.onclick = () => {
        elts.confirmModal.classList.add('hidden');
        onConfirm();
    };
}

function renderLibrary() {
    elts.libraryGrid.innerHTML = '';

    // 1. Titres Likés Card
    const likesCard = document.createElement('div');
    likesCard.className = 'playlist-card';
    likesCard.innerHTML = `
        <div>
            <h3>❤️ Titres Likés</h3>
            <div class="count">${likes.length} titres</div>
        </div>
        <button class="play-btn" title="Lire tout">▶</button>
    `;
    likesCard.addEventListener('click', (e) => {
        if (e.target.closest('.play-btn')) {
            e.stopPropagation();
            openPlaylistView('likes', true);
        } else {
            openPlaylistView('likes');
        }
    });
    elts.libraryGrid.appendChild(likesCard);

    // 2. User Playlists
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
            <div>
                <h3>${pl.name}</h3>
                <div class="count">${pl.songs.length} titres</div>
            </div>
            <button class="play-btn" title="Lire tout">▶</button>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.play-btn')) {
                e.stopPropagation();
                openPlaylistView(pl.id, true);
            } else {
                openPlaylistView(pl.id);
            }
        });
        elts.libraryGrid.appendChild(card);
    });

    // 3. Create Playlist Card (Last)
    const createCard = document.createElement('div');
    createCard.className = 'playlist-card create-card';
    createCard.innerHTML = `
        <div style="text-align:center;">
            <div style="font-size:3rem;margin-bottom:10px;">+</div>
            <div>Créer une playlist</div>
        </div>
    `;
    createCard.addEventListener('click', () => {
        elts.createModal.classList.remove('hidden');
        elts.createInput.focus();
    });
    elts.libraryGrid.appendChild(createCard);
}

function openPlaylistView(playlistId, autoPlay = false) {
    elts.libraryView.classList.add('hidden');
    elts.playlistView.classList.remove('hidden');
    elts.playlistSongs.innerHTML = '';
    elts.playlistActions.innerHTML = '';

    let songsToRender = [];
    let onDelete = null;

    if (playlistId === 'likes') {
        elts.currentPlaylistTitle.textContent = "Titres Likés";
        songsToRender = likes;
        onDelete = (song) => {
            openConfirmModal('Retirer des J\'aime', 'Voulez-vous vraiment retirer ce titre des J\'aime ?', () => {
                likes = likes.filter(l => l.id !== song.id);
                localStorage.setItem('likes', JSON.stringify(likes));
                openPlaylistView('likes'); // Refresh
                showToast("Retiré des J'aime", 'success');
            });
        };
    } else {
        const pl = playlists.find(p => p.id === playlistId);
        if (!pl) return; 
        elts.currentPlaylistTitle.textContent = pl.name;
        songsToRender = pl.songs;

        // Actions: Rename, Delete
        const btnRename = document.createElement('button');
        btnRename.className = 'btn';
        btnRename.textContent = 'Renommer';
        btnRename.onclick = () => {
            openRenameModal(pl.name, (newName) => {
                pl.name = newName;
                localStorage.setItem('playlists', JSON.stringify(playlists));
                elts.currentPlaylistTitle.textContent = pl.name;
            });
        };
        elts.playlistActions.appendChild(btnRename);

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn';
        btnDelete.style.borderColor = 'rgba(248, 113, 113, 0.3)';
        btnDelete.style.color = '#f87171';
        btnDelete.textContent = 'Supprimer';
        btnDelete.onclick = () => {
            openConfirmModal('Supprimer la playlist', 'Voulez-vous vraiment supprimer cette playlist ?', () => {
                playlists = playlists.filter(p => p.id !== pl.id);
                localStorage.setItem('playlists', JSON.stringify(playlists));
                elts.btnBack.click();
                showToast("Playlist supprimée", 'success');
            });
        };
        elts.playlistActions.appendChild(btnDelete);

        onDelete = (song) => {
            openConfirmModal('Retirer de la playlist', 'Voulez-vous vraiment retirer ce titre de la playlist ?', () => {
                pl.songs = pl.songs.filter(s => s.id !== song.id);
                const idx = playlists.findIndex(p => p.id === pl.id);
                if (idx !== -1) playlists[idx] = pl;
                localStorage.setItem('playlists', JSON.stringify(playlists));
                openPlaylistView(pl.id); // Refresh
                showToast("Titre retiré de la playlist", 'success');
            });
        };
    }

    if (songsToRender.length === 0) {
        elts.playlistSongs.innerHTML = '<p class="texte-gris">Playlist vide.</p>';
    } else {
        const playFunctions = [];
        songsToRender.forEach((song, index) => {
            const item = createPlayerItem(song, elts.playlistSongs, () => onDelete(song), () => {
                // On Ended: Play next
                const nextIdx = index + 1;
                if (nextIdx < playFunctions.length) {
                    playFunctions[nextIdx]();
                }
            });
            playFunctions.push(item.play);
        });

        if (autoPlay && playFunctions.length > 0) {
            playFunctions[0]();
        }
    }
}

// Initial render
renderLibrary();
