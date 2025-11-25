// All data manipulation now happens on the Go backend
const BASE_API = "/api";

// Disable global debug error banner by default; enable with ?debug=1
const SHOW_GLOBAL_ERRORS = /(^|[?&])debug=1(&|$)/.test(location.search);

const etat = {
  artists: [],
  searchTerm: "",
};

const elts = {
  grille: document.getElementById("grille") || document.getElementById("grid"),
  recherche: document.getElementById("nav-search") || document.getElementById("recherche") || document.getElementById("search"),
  erreur: document.getElementById("erreur") || document.getElementById("error"),
};

// Catch JS errors: only show banner when explicitly in debug mode
if (SHOW_GLOBAL_ERRORS) {
  window.addEventListener('error', (e) => {
    try { afficherErreur(`Erreur JS: ${e.message}`); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { afficherErreur(`Erreur Promesse: ${e.reason?.message || e.reason}`); } catch {}
  });
}

function afficherErreur(msg) {
  elts.erreur.textContent = msg || "";
  elts.erreur.style.display = msg ? "block" : "none";
}

function carteSquelette() {
  const card = document.createElement("div");
  card.className = "carte";
  card.innerHTML = `
    <div class="squelette" style="width:100%;aspect-ratio:1;"></div>
    <div class="contenu">
      <div class="squelette" style="width:70%;height:14px;margin-bottom:8px;"></div>
      <div class="squelette" style="width:50%;height:12px;"></div>
    </div>
  `;
  return card;
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

function afficherGrille(liste) {
  elts.grille.innerHTML = "";
  if (!liste || liste.length === 0) {
    const p = document.createElement("p");
    p.className = "texte-gris";
    p.textContent = "Aucun artiste trouvé.";
    elts.grille.appendChild(p);
    return;
  }
  for (const a of liste) {
    const card = document.createElement("div");
    card.className = "carte";
    card.setAttribute('tabindex', '0');
    card.dataset.id = String(a.id);
    card.title = `Voir les détails de ${a.name}`;
    
    // Show number of concerts if available (data comes from Go backend)
    const showsInfo = a.shows && a.shows.length > 0 ? ` • ${a.shows.length} concerts` : '';
    
    card.innerHTML = `
      <a href="/html/details.html?id=${a.id}" style="text-decoration:none;color:inherit;display:block;">
        <img loading="lazy" alt="${a.name}" src="${a.image}" />
        <div class="contenu">
          <div class="titre">${a.name}</div>
          <div class="texte-gris">Créé: ${a.creationDate} • 1er album: ${a.firstAlbum}${showsInfo}</div>
        </div>
      </a>
    `;
    card.addEventListener("click", () => { window.location.href = `/html/details.html?id=${a.id}`; });
    card.addEventListener("keydown", (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = `/html/details.html?id=${a.id}`; } });
    elts.grille.appendChild(card);
  }
}

// Search is now handled server-side via Go backend
async function appliquerFiltre(terme) {
  try {
    afficherErreur("");
    const t = (terme || "").trim();
    etat.searchTerm = t;
    
    // Show loading skeletons
    elts.grille.innerHTML = "";
    for (let i = 0; i < 4; i++) elts.grille.appendChild(carteSquelette());
    
    // Call Go backend search endpoint
    const url = t ? `${BASE_API}/search?q=${encodeURIComponent(t)}` : `${BASE_API}/combined`;
    const data = await chargerJSON(url, { retries: 1, timeoutMs: 10000 });
    
    etat.artists = Array.isArray(data) ? data : [];
    afficherGrille(etat.artists);
  } catch (e) {
    afficherErreur(`Erreur de recherche: ${e.message}`);
    elts.grille.innerHTML = "";
  }
}

async function afficherDetails(artiste) {
  window.location.href = `/html/details.html?id=${artiste.id}`;
}

// Load combined data from Go backend (artists + shows already merged)
async function demarrer() {
  try {
    afficherErreur("");
    elts.grille.innerHTML = "";
    for (let i = 0; i < 8; i++) elts.grille.appendChild(carteSquelette());

    // Fetch combined data from Go backend - all manipulation done server-side
    const data = await chargerJSON(`${BASE_API}/combined`, { retries: 2, timeoutMs: 12000 });
    
    etat.artists = Array.isArray(data) ? data : [];
    console.log("Artistes chargés depuis Go backend:", etat.artists.length);
    afficherGrille(etat.artists);
  } catch (e) {
    afficherErreur(`Erreur de chargement: ${e.message}. Vérifiez que le serveur Go est démarré.`);
    elts.grille.innerHTML = "";
  }
}

// Debounce search to avoid hammering the server
let searchTimeout;
elts.recherche?.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => appliquerFiltre(e.target.value), 300);
});

elts.grille?.addEventListener('click', (ev) => {
  const t = ev.target;
  const carte = t && typeof t.closest === 'function' ? t.closest('.carte') : null;
  if (!carte) return;
  const id = Number(carte.dataset.id);
  const artiste = etat.artists.find(a => a.id === id);
  if (artiste) afficherDetails(artiste);
});

window.addEventListener("DOMContentLoaded", demarrer);

window.addEventListener("DOMContentLoaded", () => {
  const btnBiblio = document.getElementById('btn-biblio');
  if (btnBiblio) {
      btnBiblio.addEventListener('click', () => {
          window.location.href = '/html/library.html';
      });
  }
});

// Focus search when coming with #search or clicking the nav button
function focusSearch() {
  try {
    elts.recherche?.focus();
    if (elts.recherche?.select) elts.recherche.select();
  } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) {
    elts.recherche.value = q;
    appliquerFiltre(q);
  }
  if (location.hash === '#search') { focusSearch(); }
});

window.addEventListener('hashchange', () => {
  if (location.hash === '#search') focusSearch();
});
