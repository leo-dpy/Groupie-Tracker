const API_KEY = "AIzaSyAHoo2BDboQafXAVfvOSfYuMmVitNhepU4";
let player;
let timer;
let searchTimeout;

function safe(str) { return (str === undefined || str === null) ? "Inconnu" : String(str); }

window.onload = () => {
    if(!sessionStorage.getItem('clean_v17')) {
        sessionStorage.removeItem('myLib');
        sessionStorage.setItem('clean_v17', 'true');
    }
    if(document.getElementById('lib-target')) loadLibrary();
    
    const sInput = document.getElementById('search-input');
    if(sInput) {
        sInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const val = e.target.value;
                if(val.length > 1) navigate('/api/recherche?q='+val);
                else if(val.length === 0) navigate('/api/index');
            }, 300);
        });
    }
};

document.addEventListener('click', e => {
    const target = e.target.closest('[data-link]');
    if (target) {
        e.preventDefault();
        const url = target.getAttribute('data-link');
        if(target.classList.contains('nav-btn')) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            target.classList.add('active');
        }
        navigate(url);
    }
});

async function navigate(url) {
    try {
        const res = await fetch(url);
        if(!res.ok) throw new Error("HTTP " + res.status);
        const html = await res.text();
        const contentDiv = document.getElementById('content');
        if(contentDiv) contentDiv.innerHTML = html;
        window.history.pushState({}, "", url.replace('/api', ''));
        
        const tracker = document.getElementById('audio-tracker');
        if(tracker) {
            const artist = tracker.getAttribute('data-artist');
            if(artist) fetchTracks(artist);
        }
        if(document.getElementById('lib-target')) loadLibrary();
    } catch (err) {
        notify("ERREUR NAV: " + err);
    }
}

async function fetchTracks(artist) {
    const list = document.getElementById('audio-tracker');
    if(!list || !artist) return;
    const storageKey = "cache_" + safe(artist);
    if(sessionStorage.getItem(storageKey)) {
        try { renderList(JSON.parse(sessionStorage.getItem(storageKey)), artist); return; } 
        catch(e) { sessionStorage.removeItem(storageKey); }
    }
    const q = `${safe(artist)} official audio song`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&order=viewCount&maxResults=6&key=${API_KEY}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if(data.items) {
            const tracks = data.items.map(i => ({
                id: i.id.videoId,
                title: safe(i.snippet.title).replace(/Official|Video|Audio|[\[\]\(\)]/gi, "").trim()
            }));
            sessionStorage.setItem(storageKey, JSON.stringify(tracks));
            renderList(tracks, artist);
        } else { list.innerHTML = "<div style='padding:10px; color:red'>API LIMITE.</div>"; }
    } catch(e) { list.innerHTML = "<div style='padding:10px; color:red'>ERREUR RESEAU.</div>"; }
}

function renderList(tracks, artist) {
    const list = document.getElementById('audio-tracker');
    let html = "";
    tracks.forEach((t, i) => {
        const safeData = encodeURIComponent(JSON.stringify({id: t.id, title: t.title, artist: artist}));
        const jsTitle = safe(t.title).replace(/'/g, "\\'");
        html += `<div class="track-row">
            <div style="width:70%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;"><span style="color:#555">${i+1}.</span> ${safe(t.title)}</div>
            <div>
                <button class="btn-icon" onclick="addToLib('${safeData}')">+</button>
                <button class="btn-icon" onclick="playID('${t.id}', '${jsTitle}')">></button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.body.appendChild(tag);

function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-hidden', {
        height: '0', width: '0', playerVars: { playsinline: 1 },
        events: { 'onStateChange': onState }
    });
}

function onState(e) {
    const btn = document.getElementById('main-play');
    if(e.data == 1) { btn.innerText = "||"; startTimer(); } else { btn.innerText = ">"; stopTimer(); }
}

function playID(id, title) {
    document.getElementById('status').innerText = "LECTURE: " + safe(title);
    if(player && player.loadVideoById) { player.loadVideoById(id); const vol = document.getElementById('vol'); if(vol) player.setVolume(vol.value); }
}

function togglePlay() { if(player) { if(player.getPlayerState() == 1) player.pauseVideo(); else player.playVideo(); } }
function setVolume(v) { if(player) player.setVolume(v); }

function seek(e) {
    if(!player || !player.getDuration) return;
    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    player.seekTo(player.getDuration() * pct, true);
    document.getElementById('progress-fill').style.width = (pct * 100) + "%";
}

function startTimer() { stopTimer(); timer = setInterval(() => { if(player && player.getCurrentTime) { const pct = (player.getCurrentTime() / player.getDuration()) * 100; const bar = document.getElementById('progress-fill'); if(bar) bar.style.width = pct + "%"; } }, 200); }
function stopTimer() { clearInterval(timer); }

function addToLib(encodedJson) {
    try {
        const data = JSON.parse(decodeURIComponent(encodedJson));
        let lib = JSON.parse(sessionStorage.getItem('myLib') || "[]");
        if(lib.some(i => i.id === data.id)) { notify("DEJA EN BIBLIO."); return; }
        lib.push(data);
        sessionStorage.setItem('myLib', JSON.stringify(lib));
        notify("AJOUTE: " + safe(data.title));
    } catch(e) { notify("ERREUR AJOUT"); }
}

function loadLibrary() {
    const target = document.getElementById('lib-target');
    if(!target) return;
    let lib = [];
    try { lib = JSON.parse(sessionStorage.getItem('myLib') || "[]"); } catch(e) { sessionStorage.setItem('myLib', "[]"); }
    if(lib.length === 0) { target.innerHTML = "<div style='padding:20px; color:#555'>VIDE.</div>"; return; }
    let html = "";
    lib.forEach((t, idx) => {
        const titre = safe(t.title);
        const jsTitle = titre.replace(/'/g, "\\'");
        html += `<div class="track-row">
            <div style="width:70%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${titre} <span style="color:#555">/ ${safe(t.artist)}</span></div>
            <div>
                <button class="btn-icon" onclick="playID('${t.id}', '${jsTitle}')">></button>
                <button class="btn-icon btn-delete" onclick="delFromLib(${idx})">X</button>
            </div>
        </div>`;
    });
    target.innerHTML = html;
}

function delFromLib(idx) {
    let lib = JSON.parse(sessionStorage.getItem('myLib') || "[]");
    lib.splice(idx, 1);
    sessionStorage.setItem('myLib', JSON.stringify(lib));
    loadLibrary();
    notify("SUPPRIME.");
}

function notify(msg) {
    const box = document.getElementById('toast-container');
    if(!box) return;
    const div = document.createElement('div');
    div.className = 'toast-msg'; div.innerText = "> " + msg;
    box.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}