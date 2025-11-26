// Toute la manipulation de données se fait maintenant sur le backend Go
const API_BASE = "/api";

// Désactiver la bannière d'erreur de débogage globale par défaut ; activer avec ?debug=1
const AFFICHER_ERREURS_GLOBALES = /(^|[?&])debug=1(&|$)/.test(location.search);

const etat = {
  artistes: [],
  termeRecherche: "",
};

const elements = {
  grille: document.getElementById("grille") || document.getElementById("grid"),
  recherche: document.getElementById("nav-search") || document.getElementById("recherche") || document.getElementById("search"),
  erreur: document.getElementById("erreur") || document.getElementById("error"),
};

// Attraper les erreurs JS : afficher la bannière uniquement en mode débogage
if (AFFICHER_ERREURS_GLOBALES) {
  window.addEventListener('error', (e) => {
    try { afficherErreur(`Erreur JS: ${e.message}`); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { afficherErreur(`Erreur Promesse: ${e.reason?.message || e.reason}`); } catch {}
  });
}

function afficherErreur(msg) {
  elements.erreur.textContent = msg || "";
  elements.erreur.style.display = msg ? "block" : "none";
}

function carteSquelette() {
  const carte = document.createElement("div");
  carte.className = "carte";
  carte.innerHTML = `
    <div class="squelette" style="width:100%;aspect-ratio:1;"></div>
    <div class="contenu">
      <div class="squelette" style="width:70%;height:14px;margin-bottom:8px;"></div>
      <div class="squelette" style="width:50%;height:12px;"></div>
    </div>
  `;
  return carte;
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

function afficherGrille(liste) {
  elements.grille.innerHTML = "";
  if (!liste || liste.length === 0) {
    const p = document.createElement("p");
    p.className = "texte-gris";
    p.textContent = "Aucun artiste trouvé.";
    elements.grille.appendChild(p);
    return;
  }
  for (const a of liste) {
    const carte = document.createElement("div");
    carte.className = "carte";
    carte.setAttribute('tabindex', '0');
    carte.dataset.id = String(a.id);
    carte.title = `Voir les détails de ${a.name}`;
    
    // Afficher le nombre de concerts si disponible (données venant du backend Go)
    const infoConcerts = a.shows && a.shows.length > 0 ? ` • ${a.shows.length} concerts` : '';
    
    carte.innerHTML = `
      <a href="/html/details.html?id=${a.id}" style="text-decoration:none;color:inherit;display:block;">
        <img loading="lazy" alt="${a.name}" src="${a.image}" />
        <div class="contenu">
          <div class="titre">${a.name}</div>
          <div class="texte-gris">Créé: ${a.creationDate} • 1er album: ${a.firstAlbum}${infoConcerts}</div>
        </div>
      </a>
    `;
    carte.addEventListener("click", () => { window.location.href = `/html/details.html?id=${a.id}`; });
    carte.addEventListener("keydown", (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = `/html/details.html?id=${a.id}`; } });
    elements.grille.appendChild(carte);
  }
}

// La recherche est maintenant gérée côté serveur via le backend Go
async function appliquerFiltre(terme) {
  try {
    afficherErreur("");
    const t = (terme || "").trim();
    etat.termeRecherche = t;
    
    // Afficher les squelettes de chargement
    elements.grille.innerHTML = "";
    for (let i = 0; i < 4; i++) elements.grille.appendChild(carteSquelette());
    
    // Appeler le point de terminaison de recherche du backend Go
    const url = t ? `${API_BASE}/recherche?q=${encodeURIComponent(t)}` : `${API_BASE}/combines`;
    const donnees = await chargerJSON(url, { essais: 1, delaiMs: 10000 });
    
    etat.artistes = Array.isArray(donnees) ? donnees : [];
    afficherGrille(etat.artistes);
  } catch (e) {
    afficherErreur(`Erreur de recherche: ${e.message}`);
    elements.grille.innerHTML = "";
  }
}

async function afficherDetails(artiste) {
  window.location.href = `/html/details.html?id=${artiste.id}`;
}

// Charger les données combinées depuis le backend Go (artistes + concerts déjà fusionnés)
async function demarrer() {
  try {
    afficherErreur("");
    elements.grille.innerHTML = "";
    for (let i = 0; i < 8; i++) elements.grille.appendChild(carteSquelette());

    // Récupérer les données combinées depuis le backend Go - toute manipulation faite côté serveur
    const donnees = await chargerJSON(`${API_BASE}/combines`, { essais: 2, delaiMs: 12000 });
    
    etat.artistes = Array.isArray(donnees) ? donnees : [];
    console.log("Artistes chargés depuis Go backend:", etat.artistes.length);
    afficherGrille(etat.artistes);
  } catch (e) {
    afficherErreur(`Erreur de chargement: ${e.message}. Vérifiez que le serveur Go est démarré.`);
    elements.grille.innerHTML = "";
  }
}

// Debounce la recherche pour éviter de marteler le serveur
let delaiRecherche;
elements.recherche?.addEventListener("input", (e) => {
  clearTimeout(delaiRecherche);
  delaiRecherche = setTimeout(() => appliquerFiltre(e.target.value), 300);
});

elements.grille?.addEventListener('click', (ev) => {
  const t = ev.target;
  const carte = t && typeof t.closest === 'function' ? t.closest('.carte') : null;
  if (!carte) return;
  const id = Number(carte.dataset.id);
  const artiste = etat.artistes.find(a => a.id === id);
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

// Focus sur la recherche en arrivant avec #search ou en cliquant sur le bouton nav
function focusRecherche() {
  try {
    elements.recherche?.focus();
    if (elements.recherche?.select) elements.recherche.select();
  } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) {
    elements.recherche.value = q;
    appliquerFiltre(q);
  }
  if (location.hash === '#search') { focusRecherche(); }
});

window.addEventListener('hashchange', () => {
  if (location.hash === '#search') focusRecherche();
});
