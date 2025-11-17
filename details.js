const BASE_API = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/api"
  : "https://groupietrackers.herokuapp.com/api";

let BASE = BASE_API;

const elts = {
  titre: document.getElementById("titre-artiste"),
  corpsDetails: document.getElementById("corps-details"),
  erreur: document.getElementById("erreur"),
};

function afficherErreur(msg) {
  elts.erreur.textContent = msg || "";
  elts.erreur.style.display = msg ? "block" : "none";
}

// Debug/erreurs globaux pour visibilité
window.addEventListener('error', (e)=>{
  try { afficherErreur(`Erreur JS: ${e.message}`); } catch {}
});
window.addEventListener('unhandledrejection', (e)=>{
  try { afficherErreur(`Erreur Promesse: ${e.reason?.message || e.reason}`); } catch {}
});

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
    try { afficherErreur(`Debug: artiste ${id} chargé (base ${BASE}).`); } catch {}

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
      // Utiliser systématiquement le proxy local pour éviter les problèmes de CORS
      const [locations, dates, relations] = await Promise.all([
        chargerJSON(`${BASE}/locations/${idA}`),
        chargerJSON(`${BASE}/dates/${idA}`),
        chargerJSON(`${BASE}/relation/${idA}`),
      ]).catch(() => [null, null, null]);

      loading.remove();

      const locSection = document.createElement("div");
      locSection.className = "bloc";
      locSection.innerHTML = `<h3>Villes / Lieux</h3>`;
      const locs = locations?.locations || locations?.data || locations || {};
      const locWrap = document.createElement("div");
      const locArray = (locs[artiste.id]?.locations || locs.locations || locs || []);
      (locArray || []).forEach(l => {
        const span = document.createElement("span");
        span.className = "etiquette";
        span.textContent = l;
        locWrap.appendChild(span);
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
        span.textContent = d;
        dateWrap.appendChild(span);
      });
      dateSection.appendChild(dateWrap);
      elts.corpsDetails.appendChild(dateSection);

      const relSection = document.createElement("div");
      relSection.className = "bloc";
      relSection.innerHTML = `<h3>Relations (lieu → dates)</h3>`;
      const relData = relations?.relations || relations?.datesLocations || relations || {};
      const map = (relData[artiste.id]?.datesLocations) || relData.datesLocations || relData || {};
      const relList = document.createElement("div");
      Object.entries(map).forEach(([place, dts]) => {
        const line = document.createElement("div");
        line.style.margin = "4px 0";
        line.innerHTML = `<span class="etiquette">${place}</span> ${(dts||[]).map(d=>`<span class="etiquette">${d}</span>`).join(" ")}`;
        relList.appendChild(line);
      });
      relSection.appendChild(relList);
      elts.corpsDetails.appendChild(relSection);
      // Masquer le debug une fois tout affiché
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
