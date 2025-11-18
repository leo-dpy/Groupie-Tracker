const BASE_API = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/api"
  : "https://groupietrackers.herokuapp.com/api";

let BASE = BASE_API;
const YT_BASE = "/yt";

// Disable global debug error banner by default; enable with ?debug=1
const SHOW_GLOBAL_ERRORS = /(^|[?&])debug=1(&|$)/.test(location.search);

const elts = {
  titre: document.getElementById("titre-artiste"),
  corpsDetails: document.getElementById("corps-details"),
  erreur: document.getElementById("erreur"),
};

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

function afficherErreur(msg) {
  elts.erreur.textContent = msg || "";
  elts.erreur.style.display = msg ? "block" : "none";
}

// Debug/erreurs globaux pour visibilité (activé uniquement en mode debug)
if (SHOW_GLOBAL_ERRORS) {
  window.addEventListener('error', (e) => {
    try { afficherErreur(`Erreur JS: ${e.message}`); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { afficherErreur(`Erreur Promesse: ${e.reason?.message || e.reason}`); } catch {}
  });
}

function pause(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function chargerJSON(url, { retries = 0, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { mode: 'cors', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText})`);
    return await res.json();
  } catch (e) {
    if (retries > 0) {
      await pause(1200);
      return chargerJSON(url, { retries: retries - 1, timeoutMs });
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function getIdFromQuery() {
  const p = new URLSearchParams(location.search);
  const id = Number(p.get("id"));
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function chargerArtiste(id) {
  try {
    afficherErreur("");
    elts.corpsDetails.innerHTML = "Chargement...";

    // Warm up base & fetch artists
    try { await chargerJSON(`${BASE}`, { retries: 0, timeoutMs: 6000 }); } catch {}

    let data;
    try {
      data = await chargerJSON(`${BASE}/artists`, { retries: 2, timeoutMs: 12000 });
    } catch (e1) {
      if (BASE !== "https://groupietrackers.herokuapp.com/api") {
        BASE = "https://groupietrackers.herokuapp.com/api";
        data = await chargerJSON(`${BASE}/artists`, { retries: 2, timeoutMs: 12000 });
      } else {
        throw e1;
      }
    }

    const artistes = Array.isArray(data) ? data : data?.data || [];
    const artiste = artistes.find(a => a.id === id);
    if (!artiste) {
      afficherErreur("Artiste introuvable.");
      elts.corpsDetails.innerHTML = "";
      return;
    }

    elts.titre.textContent = artiste.name;
    if (SHOW_GLOBAL_ERRORS) { try { afficherErreur(`Debug: artiste ${id} chargé (base ${BASE}).`); } catch {} }

    // Reprend la logique de details depuis app.js (simplifiée)
    elts.corpsDetails.innerHTML = "";

    const header = document.createElement("div");
    header.className = "bloc";
    header.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;justify-content:space-between;">
        <div style="display:flex;gap:14px;align-items:center;">
          <img alt="${artiste.name}" src="${artiste.image}" style="width:96px;height:96px;border-radius:10px;object-fit:cover;border:1px solid #232a3a;background:#0c0f16" />
          <div>
            <h2 style="margin:0 0 6px 0;">${artiste.name}</h2>
            <div class="texte-gris">Créé: ${artiste.creationDate} • 1er album: ${artiste.firstAlbum}</div>
            <div style="margin-top:8px;">${(artiste.members||[]).map(m=>`<span class="etiquette">${m}</span>`).join(" ")}</div>
          </div>
        </div>
      </div>
    `;
    elts.corpsDetails.appendChild(header);

    const loading = document.createElement("div");
    loading.innerHTML = `
      <div class="bloc">
        <div class="squelette" style="width:40%;height:16px;margin-bottom:10px;"></div>
        <div class="squelette" style="width:100%;height:44px;"></div>
      </div>
      <div class="bloc">
        <div class="squelette" style="width:40%;height:16px;margin-bottom:10px;"></div>
        <div class="squelette" style="width:100%;height:44px;"></div>
      </div>
      <div class="bloc">
        <div class="squelette" style="width:40%;height:16px;margin-bottom:10px;"></div>
        <div class="squelette" style="width:100%;height:44px;"></div>
      </div>
    `;
    elts.corpsDetails.appendChild(loading);

    try {
      const idA = artiste.id;
      const [locations, dates] = await Promise.all([
        chargerJSON(`${BASE}/locations/${idA}`),
        chargerJSON(`${BASE}/dates/${idA}`),
      ]).catch(() => [null, null]);

      loading.remove();

      const locSection = document.createElement("div");
      locSection.className = "bloc";
      locSection.innerHTML = `<h3>Villes / Lieux</h3>`;
      const locs = locations?.locations || locations?.data || locations || {};
      const locWrap = document.createElement("div");
      const locArray = (locs[artiste.id]?.locations || locs.locations || locs || []);
      (locArray || []).forEach(l => {
        const a = document.createElement("a");
        a.className = "etiquette";
        a.textContent = l;
        a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l)}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.setAttribute('data-map', '1');
        a.title = `Ouvrir sur Google Maps: ${l}`;
        locWrap.appendChild(a);
      });
      locSection.appendChild(locWrap);
      elts.corpsDetails.appendChild(locSection);

      const dateSection = document.createElement("div");
      dateSection.className = "bloc";
      dateSection.innerHTML = `<h3>Dates de concert</h3>`;
      const datesData = dates?.dates || dates?.data || dates || {};
      const dateWrap = document.createElement("div");
      const datesArray = (datesData[artiste.id]?.dates || datesData.dates || datesData || []);
      (datesArray || []).forEach(d => {
        const span = document.createElement("span");
        span.className = "etiquette";
        const clean = (d||"").toString().replace(/^[\*•\-\s]+/, "");
        span.textContent = clean;
        dateWrap.appendChild(span);
      });
      dateSection.appendChild(dateWrap);
      elts.corpsDetails.appendChild(dateSection);

      // Section relations supprimée (jugée confuse)

      const ytSection = document.createElement("div");
      ytSection.className = "bloc";
      ytSection.innerHTML = `<h3>Lecteur audio</h3>`;
      const ytWrap = document.createElement("div");
      try {
        let videos = [];
        try {
          const qChan = encodeURIComponent(`${artiste.name} official`);
          const chRes = await chargerJSON(`${YT_BASE}/search?q=${qChan}&type=channel&maxResults=10`, { retries: 1, timeoutMs: 12000 });
          const chans = (chRes && chRes.items) || [];
          let bestChannelId = null;
          let bestScore = -1;
          chans.forEach(ch => {
            const title = (ch.snippet && ch.snippet.channelTitle || "").toLowerCase();
            let score = 0;
            if (title.endsWith(" - topic")) score += 5;
            if (title.includes("official")) score += 3;
            if (title.includes("vevo")) score += 2;
            if (title.includes(artiste.name.toLowerCase())) score += 1;
            if (score > bestScore) { bestScore = score; bestChannelId = ch.id && ch.id.channelId; }
          });
          if (bestChannelId) {
            const vRes = await chargerJSON(`${YT_BASE}/search?channelId=${bestChannelId}&type=video&videoEmbeddable=true&order=viewCount&maxResults=8`, { retries: 1, timeoutMs: 12000 });
            videos = (vRes && vRes.items) || [];
          }
        } catch {}

        if (videos.length === 0) {
          const variants = [
            `${artiste.name} - Topic`,
            `${artiste.name} official audio`,
            `${artiste.name} audio`,
            `${artiste.name} full album`,
            `${artiste.name} VEVO`
          ];
          for (const vq of variants) {
            try {
              const q = encodeURIComponent(vq);
              const yres = await chargerJSON(`${YT_BASE}/search?q=${q}&type=video&videoEmbeddable=true&maxResults=8`, { retries: 1, timeoutMs: 12000 });
              const items = (yres && yres.items) || [];
              if (items.length > 0) { videos = items; break; }
            } catch {}
          }
        }

        let filtered = [];
        try {
          if (videos.length > 0) {
            const ids = videos.map(v => v && v.id && (v.id.videoId || v.id.videoID || v.id.videoid)).filter(Boolean);
            if (ids.length > 0) {
              const vinfo = await chargerJSON(`${YT_BASE}/videos?part=snippet,contentDetails&id=${ids.join(',')}`, { retries: 1, timeoutMs: 12000 });
              const items = (vinfo && vinfo.items) || [];
              const parseIsoDuration = (iso) => {
                const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
                if (!m) return 0;
                const h = parseInt(m[1]||"0",10), mm = parseInt(m[2]||"0",10), s = parseInt(m[3]||"0",10);
                return h*3600 + mm*60 + s;
              };
              const infoById = new Map(items.map(it => [it.id, it]));
              filtered = ids.map(id => {
                const it = infoById.get(id);
                if (!it) return null;
                const cat = it.snippet && it.snippet.categoryId;
                const dur = parseIsoDuration(it.contentDetails && it.contentDetails.duration);
                if (cat === "10" && dur >= 120) return { id, title: (it.snippet && it.snippet.title) || "Piste" };
                return null;
              }).filter(Boolean);
            }
          }
        } catch {}

        if ((!filtered || filtered.length === 0) && videos.length > 0) {
          filtered = videos.map(v => {
            const id = v && v.id && (v.id.videoId || v.id.videoID || v.id.videoid);
            return id ? { id, title: (v.snippet && v.snippet.title) || "Piste" } : null;
          }).filter(Boolean).slice(0,3);
        }

        if (!filtered || filtered.length === 0) {
          const p = document.createElement("p");
          p.className = "texte-gris";
          p.textContent = "Aucune vidéo trouvée.";
          ytWrap.appendChild(p);
        } else {
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
          await ensureYTApi();
          filtered.forEach(({id: vid, title}) => {
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
              <div id="yt-holder-${vid}" class="visually-hidden"></div>
            `;
            const btn = row.querySelector('.audio-play');
            const prog = row.querySelector('.audio-progress');
            const timeEl = row.querySelector('.audio-time');
            const vol = row.querySelector('.audio-volume');
            const bar = row.querySelector('.audio-bar');
            const muteBtn = row.querySelector('.audio-mute');
            ytWrap.appendChild(row);
            const create = () => {
              const holder = row.querySelector(`#yt-holder-${vid}`);
              const player = new YT.Player(holder, {
                width: 320,
                height: 180,
                videoId: vid,
                playerVars: { controls: 0, modestbranding: 1, rel: 0 },
                events: {
                  onReady: () => { try { player.setVolume(Number(vol.value)||60); } catch {} },
                  onStateChange: (ev) => {
                    if (ev.data === YT.PlayerState.ENDED) {
                      btn.textContent = '▶';
                      const obj = ytPlayers.get(vid);
                      if (obj && obj.timer) { clearInterval(obj.timer); obj.timer = null; }
                    }
                  }
                }
              });
              ytPlayers.set(vid, { player, btn, prog, timeEl, vol, bar, muteBtn, timer: null, dragging: false });
              return player;
            };
            btn.addEventListener('click', async ()=>{
              await ensureYTApi();
              let obj = ytPlayers.get(vid);
              if (!obj) { const p = create(); obj = ytPlayers.get(vid); }
              const pl = obj.player;
              const state = typeof pl.getPlayerState === 'function' ? pl.getPlayerState() : -1;
              if (state === YT.PlayerState.PLAYING) {
                pl.pauseVideo();
                btn.textContent = '▶';
                if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
              } else {
                stopOthers(vid);
                pl.playVideo();
                btn.textContent = '⏸';
                if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
                obj.timer = setInterval(()=>{
                  try {
                    const cur = pl.getCurrentTime() || 0;
                    const dur = pl.getDuration() || 0;
                    const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
                    if (!obj.dragging) { obj.prog.style.width = pct + '%'; }
                    obj.timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
                  } catch {}
                }, 500);
              }
            });
            vol.addEventListener('input', async ()=>{
              await ensureYTApi();
              let obj = ytPlayers.get(vid);
              if (!obj) { const p = create(); obj = ytPlayers.get(vid); }
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
              let obj = ytPlayers.get(vid);
              if (!obj) { const p = create(); obj = ytPlayers.get(vid); }
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
              let obj = ytPlayers.get(vid);
              if (!obj) { const p = create(); obj = ytPlayers.get(vid); }
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
          });
        }
      } catch (e) {
        const p = document.createElement("p");
        p.className = "texte-gris";
        p.textContent = "Vidéos indisponibles pour le moment.";
        ytWrap.appendChild(p);
      }
      ytSection.appendChild(ytWrap);
      elts.corpsDetails.appendChild(ytSection);
      afficherErreur("");

    } catch (e) {
      loading.remove();
      const err = document.createElement("div");
      err.className = "erreur";
      err.textContent = "Certaines informations supplémentaires ne sont pas disponibles pour le moment.";
      elts.corpsDetails.appendChild(err);
    }

  } catch (e) {
    afficherErreur(`Erreur de chargement de l'artiste: ${e.message}`);
    elts.corpsDetails.innerHTML = "";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const id = getIdFromQuery();
  try {
    const sec = document.getElementById("details");
    if (sec) sec.style.display = "block";
  } catch {}
  if (!id) {
    afficherErreur("Aucun identifiant d'artiste fourni.");
    return;
  }
  chargerArtiste(id);
});

