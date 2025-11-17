const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/api"
  : "https://groupietrackers.herokuapp.com/api";

const state = {
  artists: [],
  filtered: [],
  selected: null,
};

const els = {
  grid: document.getElementById("grid"),
  search: document.getElementById("search"),
  detail: document.getElementById("detail"),
  detailBody: document.getElementById("detail-body"),
  error: document.getElementById("error"),
};

function setError(msg) {
  els.error.textContent = msg || "";
  els.error.style.display = msg ? "block" : "none";
}

function skeletonCard() {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="skeleton" style="width:100%;height:160px;"></div>
    <div class="content">
      <div class="skeleton" style="width:70%;height:14px;margin:6px 0;"></div>
      <div class="skeleton" style="width:50%;height:12px;margin:6px 0;"></div>
    </div>
  `;
  return card;
}

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchJSON(url, { retries = 0, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { mode: 'cors', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText})`);
    return await res.json();
  } catch (e) {
    if (retries > 0) {
      await delay(1200);
      return fetchJSON(url, { retries: retries - 1, timeoutMs });
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function renderGrid(list) {
  els.grid.innerHTML = "";
  if (!list || list.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Aucun artiste trouvé.";
    els.grid.appendChild(p);
    return;
  }
  for (const a of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.title = `Voir les détails de ${a.name}`;
    card.innerHTML = `
      <img loading="lazy" alt="${a.name}" src="${a.image}" />
      <div class="content">
        <div class="title">${a.name}</div>
        <div class="muted">Créé: ${a.creationDate} • 1er album: ${a.firstAlbum}</div>
      </div>
    `;
    card.addEventListener("click", () => showDetail(a));
    els.grid.appendChild(card);
  }
}

function applyFilter(term) {
  const t = (term || "").trim().toLowerCase();
  if (!t) {
    state.filtered = state.artists.slice();
  } else {
    state.filtered = state.artists.filter(a =>
      a.name.toLowerCase().includes(t) ||
      (a.members || []).some(m => m.toLowerCase().includes(t))
    );
  }
  renderGrid(state.filtered);
}

async function showDetail(artist) {
  state.selected = artist;
  els.detail.style.display = "block";
  els.detailBody.innerHTML = "";
  // Clear any global error when opening details
  setError("");

  const header = document.createElement("div");
  header.className = "section";
  header.innerHTML = `
    <div style=\"display:flex;gap:14px;align-items:center;justify-content:space-between;\">
      <div style=\"display:flex;gap:14px;align-items:center;\">
        <img alt=\"${artist.name}\" src=\"${artist.image}\" style=\"width:96px;height:96px;border-radius:10px;object-fit:cover;border:1px solid #232a3a;background:#0c0f16\" />
        <div>
          <h2 style=\"margin:0 0 6px 0;\">${artist.name}</h2>
          <div class=\"muted\">Créé: ${artist.creationDate} • 1er album: ${artist.firstAlbum}</div>
          <div style=\"margin-top:8px;\">${(artist.members||[]).map(m=>`<span class=\"badge\">${m}</span>`).join(" ")}</div>
        </div>
      </div>
      <button id=\"close-detail\" style=\"background:#1a2336;color:#c9d6ff;border:1px solid #2c3650;border-radius:8px;padding:6px 10px;cursor:pointer;\">Fermer</button>
    </div>
  `;
  els.detailBody.appendChild(header);
  header.querySelector('#close-detail')?.addEventListener('click', ()=>{
    els.detail.style.display = 'none';
    els.detailBody.innerHTML = '';
  });

  const loading = document.createElement("div");
  loading.innerHTML = `
    <div class=\"section\">
      <div class=\"skeleton\" style=\"width:40%;height:16px;margin-bottom:10px;\"></div>
      <div class=\"skeleton\" style=\"width:100%;height:44px;\"></div>
    </div>
    <div class=\"section\">
      <div class=\"skeleton\" style=\"width:40%;height:16px;margin-bottom:10px;\"></div>
      <div class=\"skeleton\" style=\"width:100%;height:44px;\"></div>
    </div>
    <div class=\"section\">
      <div class=\"skeleton\" style=\"width:40%;height:16px;margin-bottom:10px;\"></div>
      <div class=\"skeleton\" style=\"width:100%;height:44px;\"></div>
    </div>
  `;
  els.detailBody.appendChild(loading);

  try {
    const [locations, dates, relations] = await Promise.all([
      fetchJSON(artist.locations),
      fetchJSON(artist.concertDates),
      fetchJSON(artist.relations || artist.relation || `${API_BASE}/relation/${artist.id}`),
    ]).catch(async (e) => {
      const relUrl = artist.relations || artist.relation || `${API_BASE}/relation/${artist.id}`;
      return [
        await fetchJSON(artist.locations),
        await fetchJSON(artist.concertDates),
        await fetchJSON(relUrl),
      ];
    });

    loading.remove();

    const locSection = document.createElement("div");
    locSection.className = "section";
    locSection.innerHTML = `<h3>Villes / Lieux</h3>`;
    const locs = locations?.locations || locations?.data || locations;
    const locWrap = document.createElement("div");
    (locs?.[artist.id]?.locations || locs?.locations || locs || []).forEach(l => {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = l;
      locWrap.appendChild(span);
    });
    locSection.appendChild(locWrap);
    els.detailBody.appendChild(locSection);

    const dateSection = document.createElement("div");
    dateSection.className = "section";
    dateSection.innerHTML = `<h3>Dates de concert</h3>`;
    const datesData = dates?.dates || dates?.data || dates;
    const dateWrap = document.createElement("div");
    (datesData?.[artist.id]?.dates || datesData?.dates || datesData || []).forEach(d => {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = d;
      dateWrap.appendChild(span);
    });
    dateSection.appendChild(dateWrap);
    els.detailBody.appendChild(dateSection);

    const relSection = document.createElement("div");
    relSection.className = "section";
    relSection.innerHTML = `<h3>Relations (lieu → dates)</h3>`;
    const relData = relations?.relations || relations?.datesLocations || relations;
    const map = (relData?.[artist.id]?.datesLocations) || relData?.datesLocations || relData || {};
    const relList = document.createElement("div");
    Object.entries(map).forEach(([place, dts]) => {
      const line = document.createElement("div");
      line.style.margin = "4px 0";
      line.innerHTML = `<span class=\"badge\">${place}</span> ${(dts||[]).map(d=>`<span class=\"badge\">${d}</span>`).join(" ")}`;
      relList.appendChild(line);
    });
    relSection.appendChild(relList);
    els.detailBody.appendChild(relSection);

  } catch (e) {
    loading.remove();
    // Show a local (inline) error inside the detail panel instead of global banner
    const inlineErr = document.createElement("div");
    inlineErr.className = "error";
    inlineErr.textContent = `Impossible de charger certains détails: ${e.message}`;
    els.detailBody.appendChild(inlineErr);
  }
}

async function init() {
  try {
    setError("");
    els.grid.innerHTML = "";
    for (let i = 0; i < 8; i++) els.grid.appendChild(skeletonCard());

    // Warm up Heroku (cold starts can 502/503)
    try { await fetchJSON(`${API_BASE}`, { retries: 0, timeoutMs: 6000 }); } catch {}

    const data = await fetchJSON(`${API_BASE}/artists`, { retries: 2, timeoutMs: 12000 });
    state.artists = Array.isArray(data) ? data : data?.data || [];
    state.filtered = state.artists.slice();
    renderGrid(state.filtered);
  } catch (e) {
    setError(`Erreur de chargement des artistes: ${e.message}. Vérifiez votre connexion ou réessayez.`);
    els.grid.innerHTML = "";
  }
}

els.search?.addEventListener("input", (e) => applyFilter(e.target.value));

window.addEventListener("DOMContentLoaded", init);
