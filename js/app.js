const BASE_API = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/api"
  : "https://groupietrackers.herokuapp.com/api";

let BASE = BASE_API;

// Disable global debug error banner by default; enable with ?debug=1
const SHOW_GLOBAL_ERRORS = /(^|[?&])debug=1(&|$)/.test(location.search);

const etat = {
  artists: [],
  filtered: [],
  selected: null,
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
    card.innerHTML = `
      <a href="/html/details.html?id=${a.id}" style="text-decoration:none;color:inherit;display:block;">
        <img loading="lazy" alt="${a.name}" src="${a.image}" />
        <div class="contenu">
          <div class="titre">${a.name}</div>
          <div class="texte-gris">Créé: ${a.creationDate} • 1er album: ${a.firstAlbum}</div>
        </div>
      </a>
    `;
    card.addEventListener("click", () => { window.location.href = `/html/details.html?id=${a.id}`; });
    card.addEventListener("keydown", (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = `/html/details.html?id=${a.id}`; } });
    elts.grille.appendChild(card);
  }
}

function appliquerFiltre(terme) {
  const t = (terme || "").trim().toLowerCase();
  if (!t) {
    etat.filtered = etat.artists.slice();
  } else {
    etat.filtered = etat.artists.filter(a =>
      a.name.toLowerCase().includes(t) ||
      (a.members || []).some(m => m.toLowerCase().includes(t))
    );
  }
  afficherGrille(etat.filtered);
}

async function afficherDetails(artiste) {
  window.location.href = `/html/details.html?id=${artiste.id}`;
}

async function demarrer() {
  try {
    afficherErreur("");
    elts.grille.innerHTML = "";
    for (let i = 0; i < 8; i++) elts.grille.appendChild(carteSquelette());

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
    etat.artists = Array.isArray(data) ? data : data?.data || [];
    etat.filtered = etat.artists.slice();
    console.log("Artistes chargés:", etat.artists.length, "via base", BASE);
    afficherGrille(etat.filtered);
  } catch (e) {
    afficherErreur(`Erreur de chargement des artistes: ${e.message}. Vérifiez votre connexion ou réessayez.`);
    elts.grille.innerHTML = "";
  }
}

elts.recherche?.addEventListener("input", (e) => appliquerFiltre(e.target.value));

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
