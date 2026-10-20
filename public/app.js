const state = {
  user: null,
  projects: [],
  projectKey: "nuc-2026",
  sites: [],
  districts: [],
  technicians: [],
  users: [],
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const type = response.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (response.status === 401 && path !== "/api/auth/login") showLogin();
  if (!response.ok) throw new Error(data?.error || "Ocurrió un error.");
  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  setTimeout(() => element.classList.add("hidden"), 2800);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function nowForInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function isAdmin() {
  return state.user?.role === "ADMIN";
}

function showLogin() {
  state.user = null;
  $("#app-shell").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}

async function startApp(user) {
  state.user = user;
  $("#login-view").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#current-user").textContent = `${user.name} · ${user.role === "ADMIN" ? "Administrador" : "Técnico"}`;
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", !isAdmin());
  });
  $("#install-technician-label").classList.toggle("hidden", !isAdmin());
  $("#visit-technician-label").classList.toggle("hidden", !isAdmin());
  await loadProjects();
  state.mapConfig = await api('/api/map-config');
  await loadDistricts();
  if (isAdmin()) await loadTechnicians();
  await loadSites();
}

async function loadTechnicians() {
  state.technicians = await api("/api/technicians");
  const options = state.technicians
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("");
  $("#install-technician").innerHTML =
    `<option value="">Seleccionar técnico</option>${options}`;
  $("#visit-technician").innerHTML =
    `<option value="">Seleccionar técnico</option>${options}`;
  $("#report-technician").innerHTML =
    `<option value="">Todos los técnicos</option>${options}`;
}

async function loadProjects() {
  state.projects = await api('/api/projects');
  $('#project-filter').innerHTML = state.projects.map(project =>
    `<option value="${escapeHtml(project.key)}">${escapeHtml(project.name)} (${project.total})</option>`).join('');
  const remembered = localStorage.getItem('horatech-project');
  state.projectKey = state.projects.some(project => project.key === remembered) ? remembered : state.projects[0]?.key || '';
  $('#project-filter').value = state.projectKey;
  updateProjectDescription();
}

function updateProjectDescription() {
  $('#project-description').textContent = state.projects.find(project => project.key === state.projectKey)?.name || '';
}

async function loadDistricts() {
  const projectKey = state.projectKey;
  const selected = $('#district-filter').value;
  const reportSelected = $('#report-district').value;
  const districts = await api(`/api/districts?${new URLSearchParams({ projectKey })}`);
  if (projectKey !== state.projectKey) return;
  state.districts = districts;
  const options = state.districts
    .map(
      (item) =>
        `<option value="${escapeHtml(item.district)}">${escapeHtml(item.district)} (${item.total})</option>`,
    )
    .join("");
  $("#district-filter").innerHTML = `<option value="">Todos los partidos</option>${options}`;
  $("#report-district").innerHTML = `<option value="">Todos los partidos</option>${options}`;
  if (state.districts.some(item => item.district === selected)) $('#district-filter').value = selected;
  if (state.districts.some(item => item.district === reportSelected)) $('#report-district').value = reportSelected;
  renderDistrictCards();
}

function renderDistrictCards() {
  const selected = $("#district-filter").value;
  $("#district-cards").innerHTML = state.districts
    .map(
      (item) => `
        <button class="district-card ${selected === item.district ? "active" : ""}" data-district="${escapeHtml(item.district)}">
          <strong>${escapeHtml(item.district)}</strong>
          <span>${item.installed} instalados de ${item.total}</span>
          ${item.not_located ? `<span>${item.not_located} sin coordenadas</span>` : ""}
        </button>
      `,
    )
    .join("");
}

async function loadSites() {
  const params = new URLSearchParams({
    projectKey: state.projectKey,
    district: $("#district-filter").value,
    status: $("#status-filter").value,
    q: $("#search").value.trim(),
  });
  const requestKey = params.toString();
  state.siteRequestKey = requestKey;
  const sites = await api(`/api/sites?${params}`);
  if (state.siteRequestKey !== requestKey) return;
  state.sites = sites;
  renderSites();
  renderMap();
}

function renderSites() {
  const installed = state.sites.filter((site) => site.installation_status === "INSTALADO").length;
  const notLocated = state.sites.filter((site) => site.location_status === "NO_SE_PUDO_UBICAR").length;
  $("#site-kpis").innerHTML = `
    <div class="kpi"><strong>${state.sites.length}</strong><span>Sitios visibles</span></div>
    <div class="kpi"><strong>${installed}</strong><span>Instalados</span></div>
    <div class="kpi"><strong>${state.sites.length - installed}</strong><span>Pendientes</span></div>
    <div class="kpi"><strong>${notLocated}</strong><span>Sin coordenadas</span></div>
  `;
  if (!state.sites.length) {
    $("#sites-list").innerHTML = `<div class="empty">No hay sitios para los filtros elegidos.</div>`;
    return;
  }
  const groups = new Map();
  for (const site of state.sites) {
    const district = site.district || "Sin partido";
    groups.set(district, [...(groups.get(district) ?? []), site]);
  }
  $("#sites-list").innerHTML = [...groups.entries()]
    .map(
      ([district, sites]) => `
        <section class="district-group">
          <div class="district-title"><h3>${escapeHtml(district)}</h3><span>${sites.length} sitios</span></div>
          <div class="site-grid">${sites.map(siteCard).join("")}</div>
        </section>
      `,
    )
    .join("");
}

function meterModelDetail(site) {
  if (site.meter_model) return `Modelo: ${site.meter_model}`;
  const reference = site.source_data?.meterMaterial;
  if (!reference) return '';
  return reference === 'MEDIDOR_CONSUMO'
    ? 'Modelo no especificado en el Excel'
    : `Modelo / referencia: ${reference}`;
}

function siteCard(site) {
  const installed = site.installation_status === "INSTALADO";
  const located = site.location_status !== "NO_SE_PUDO_UBICAR";
  return `
    <article class="site-card ${installed ? "installed" : "pending"}">
      <div class="site-head">
        <div><span class="site-code">Sitio ${escapeHtml(site.external_id)}</span><h4>${escapeHtml(site.client)}</h4></div>
        <span class="badge ${installed ? "installed" : "pending"}">${installed ? "Instalado" : "Pendiente"}</span>
      </div>
      <div class="site-address">${escapeHtml(site.address || "Sin dirección")}</div>
      <div class="site-meta">Localidad: ${escapeHtml(site.locality)}${site.meter_number ? ` · Medidor ${escapeHtml(site.meter_number)}` : ""}</div>
      ${site.meter_brand ? `<div class="site-meta">Marca: ${escapeHtml(site.meter_brand)}</div>` : ''}
      ${meterModelDetail(site) ? `<div class="site-meta"><strong>${escapeHtml(meterModelDetail(site))}</strong></div>` : ''}
      ${site.source_data?.brandCode && !site.meter_brand ? `<div class="site-meta">Marca (código de origen): ${escapeHtml(site.source_data.brandCode)}</div>` : ''}
      ${site.source_data?.locationReview ? `<div class="location-review">${escapeHtml(site.source_data.locationReview)}</div>` : ''}
      ${!located ? `<span class="badge not-located">Sin punto en el mapa</span>` : ""}
      ${isAdmin() ? `<button class="reopen-button" data-locate="${site.id}">${hasCoordinates(site) ? 'Corregir punto' : 'Ubicar punto'}</button>` : ''}
      ${installed ? `<div class="site-meta">Instalado por ${escapeHtml(site.installed_by_name || "")} · ${formatDate(site.installed_at)}</div>` : ""}
      <div class="site-actions">
        <a class="map-button" href="${escapeHtml(site.map_url)}" target="_blank" rel="noreferrer">${located ? "Abrir mapa" : "Buscar en mapa"}</a>
        <button class="secondary-button" data-visit="${site.id}">Comentar visita</button>
        ${isAdmin() ? `<button class="reopen-button" data-map="${site.id}">Vincular mapa</button>` : ""}
        ${installed
          ? isAdmin() ? `<button class="reopen-button" data-reopen="${site.id}">Reabrir</button>` : ""
          : `<button class="primary-button" data-install="${site.id}">Instalado</button>`}
      </div>
    </article>
  `;
}

function openInstall(siteId) {
  const site = state.sites.find((item) => item.id === Number(siteId));
  $("#install-site-id").value = site.id;
  $("#install-site-name").textContent = site.client;
  $("#install-date").value = nowForInput();
  $("#install-notes").value = "";
  $("#install-dialog").showModal();
}

function openVisit(siteId) {
  const site = state.sites.find((item) => item.id === Number(siteId));
  $("#visit-site-id").value = site.id;
  $("#visit-site-name").textContent = site.client;
  $("#visit-date").value = nowForInput();
  $("#visit-notes").value = "";
  $("#visit-dialog").showModal();
}

async function submitInstall(event) {
  event.preventDefault();
  await api(`/api/sites/${$("#install-site-id").value}/install`, {
    method: "POST",
    body: JSON.stringify({
      technicianId: isAdmin() ? $("#install-technician").value : null,
      installedAt: $("#install-date").value,
      notes: $("#install-notes").value,
    }),
  });
  $("#install-dialog").close();
  toast("Instalación registrada.");
  await Promise.all([loadSites(), loadDistricts()]);
}

async function submitVisit(event) {
  event.preventDefault();
  await api(`/api/sites/${$("#visit-site-id").value}/visit`, {
    method: "POST",
    body: JSON.stringify({
      technicianId: isAdmin() ? $("#visit-technician").value : null,
      visitedAt: $("#visit-date").value,
      notes: $("#visit-notes").value,
    }),
  });
  $("#visit-dialog").close();
  toast("Comentario de visita registrado.");
}

function reportParams() {
  return new URLSearchParams({
    projectKey: state.projectKey,
    from: $("#report-from").value,
    to: $("#report-to").value,
    district: $("#report-district").value,
    locality: $("#report-locality").value,
    technicianId: $("#report-technician").value,
    status: $("#report-status").value,
  });
}

async function loadReport() {
  const params = reportParams().toString();
  const report = await api(`/api/reports?${params}`);
  if (params !== reportParams().toString()) return;
  $("#report-kpis").innerHTML = `
    <div class="kpi"><strong>${report.total}</strong><span>Visitas registradas</span></div>
    <div class="kpi"><strong>${report.byResult.NO_INSTALADO ?? 0}</strong><span>No instaladas</span></div>
    <div class="kpi"><strong>${Object.keys(report.byTechnician).length}</strong><span>Técnicos</span></div>
    <div class="kpi"><strong>${Object.keys(report.byDay).length}</strong><span>Días con visitas</span></div>
  `;
  $("#by-technician").innerHTML = summaryRows(report.byTechnician);
  $("#by-month").innerHTML = summaryRows(report.byMonth);
  $("#report-rows").innerHTML = report.rows
    .map(
      (row) => `
        <tr>
          <td>${formatDate(row.visited_at)}</td>
          <td><span class="badge ${row.result === "INSTALADO" ? "installed" : "not-located"}">${row.result === "INSTALADO" ? "Instalado" : "No instalado"}</span></td>
          <td>${escapeHtml(row.technician)}</td>
          <td><strong>${escapeHtml(row.client)}</strong><br />${escapeHtml(row.external_id)}</td>
          <td><strong>${escapeHtml(row.district)}</strong><br />${escapeHtml(row.locality)}<br />${escapeHtml(row.address)}</td>
          <td>${escapeHtml(row.notes)}</td>
          <td><button class="secondary-button" data-delete-visit="${row.id}">Eliminar</button></td>
        </tr>
      `,
    )
    .join("");
}

function summaryRows(summary) {
  const entries = Object.entries(summary);
  if (!entries.length) return `<div class="empty">Sin datos todavía.</div>`;
  return entries.map(([label, count]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`).join("");
}

async function loadReportLocalities() {
  const params = new URLSearchParams({ district: $("#report-district").value, projectKey: state.projectKey });
  const localities = await api(`/api/localities?${params}`);
  if (params.get('projectKey') !== state.projectKey || params.get('district') !== $('#report-district').value) return;
  $("#report-locality").innerHTML =
    `<option value="">Todas las localidades</option>` +
    localities.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
}

async function loadUsers() {
  state.users = await api("/api/users");
  $("#user-rows").innerHTML = state.users
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.username)}</td>
          <td>${user.role === "ADMIN" ? "Administrador" : "Técnico"}</td>
          <td><span class="badge ${user.active ? "installed" : "not-located"}">${user.active ? "Activo" : "Inactivo"}</span></td>
          <td>
            <button class="secondary-button" data-user-active="${user.id}" data-active="${!user.active}">${user.active ? "Desactivar" : "Activar"}</button>
            <button class="secondary-button" data-user-password="${user.id}">Nueva contraseña</button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  $(`#${name}-view`).classList.remove("hidden");
  document.querySelectorAll(".nav-button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  if (name === "sites" && sitesMap) requestAnimationFrame(() => sitesMap.resize());
  if (name === "reports") loadReport();
  if (name === "users") loadUsers();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    const user = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#login-username").value, password: $("#login-password").value }),
    });
    $("#login-password").value = "";
    await startApp(user);
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
});

document.addEventListener("click", async (event) => {
  const install = event.target.closest("[data-install]");
  const visit = event.target.closest("[data-visit]");
  const reopen = event.target.closest("[data-reopen]");
  const map = event.target.closest("[data-map]");
  const district = event.target.closest("[data-district]");
  const nav = event.target.closest("[data-view]");
  const active = event.target.closest("[data-user-active]");
  const password = event.target.closest("[data-user-password]");
  const deleteVisit = event.target.closest("[data-delete-visit]");

  if (install) openInstall(install.dataset.install);
  if (visit) openVisit(visit.dataset.visit);
  if (reopen) {
    await api(`/api/sites/${reopen.dataset.reopen}/reopen`, { method: "POST" });
    toast("El sitio volvió a quedar pendiente.");
    await Promise.all([loadSites(), loadDistricts()]);
  }
  if (map) {
    const site = state.sites.find((item) => item.id === Number(map.dataset.map));
    const mapUrl = prompt("Pegá el enlace de Google Maps o Waze:", site.map_url);
    if (mapUrl) {
      await api(`/api/sites/${site.id}/map`, { method: "POST", body: JSON.stringify({ mapUrl }) });
      toast("Enlace de mapa actualizado.");
      await Promise.all([loadSites(), loadDistricts()]);
    }
  }
  if (district) {
    $("#district-filter").value = district.dataset.district;
    renderDistrictCards();
    await loadSites();
  }
  if (nav) showView(nav.dataset.view);
  if (active) {
    await api(`/api/users/${active.dataset.userActive}/active`, {
      method: "POST",
      body: JSON.stringify({ active: active.dataset.active === "true" }),
    });
    await loadUsers();
  }
  if (password) {
    const nextPassword = prompt("Nueva contraseña (mínimo 8 caracteres):");
    if (nextPassword) {
      await api(`/api/users/${password.dataset.userPassword}/password`, {
        method: "POST",
        body: JSON.stringify({ password: nextPassword }),
      });
      toast("Contraseña actualizada.");
    }
  }
  if (deleteVisit && confirm("¿Eliminar este registro de visita del informe?")) {
    await api(`/api/visits/${deleteVisit.dataset.deleteVisit}`, { method: "DELETE" });
    toast("Registro de visita eliminado.");
    await loadReport();
  }
  const close = event.target.closest("[data-close]");
  if (close) $(`#${close.dataset.close}`).close();
});

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      name: $("#user-name").value,
      username: $("#user-username").value,
      password: $("#user-password").value,
      role: $("#user-role").value,
    }),
  });
  $("#user-dialog").close();
  event.target.reset();
  toast("Usuario creado.");
  await Promise.all([loadUsers(), loadTechnicians()]);
});

$("#open-user-dialog").addEventListener("click", () => $("#user-dialog").showModal());
$("#install-form").addEventListener("submit", submitInstall);
$("#visit-form").addEventListener("submit", submitVisit);
$("#refresh-report").addEventListener("click", loadReport);
$("#download-pdf").addEventListener("click", () => {
  window.location.href = `/api/reports/pdf?${reportParams()}`;
});
$("#report-district").addEventListener("change", loadReportLocalities);
$("#report-month").addEventListener("change", () => {
  const value = $("#report-month").value;
  if (!value) return;
  const [year, month] = value.split("-").map(Number);
  $("#report-from").value = `${value}-01`;
  $("#report-to").value = new Date(year, month, 0).toISOString().slice(0, 10);
});
$("#district-filter").addEventListener("change", () => { renderDistrictCards(); loadSites(); });
$("#status-filter").addEventListener("change", loadSites);
let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadSites, 250);
});

let sitesMap = null;
let mapStyle = 'standard-satellite';
let mapMarkers = [];
let mapSignature = '';
function hasCoordinates(site) {
  return Number.isFinite(site.latitude) && Number.isFinite(site.longitude) &&
    Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180;
}
function fitMap() {
  const points = state.sites.filter(hasCoordinates);
  if (!sitesMap || !points.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  points.forEach(site => bounds.extend([site.longitude, site.latitude]));
  $('#toggle-map-perspective').textContent = 'Vista 2D';
  sitesMap.fitBounds(bounds, { padding: 55, maxZoom: 16, pitch: 55, bearing: -15, duration: 600 });
}
function renderMap() {
  const visible = state.sites.filter(hasCoordinates);
  $('#map-count').textContent = `${visible.length} sitios ubicados de ${state.sites.length} sitios visibles`;
  const missing = state.sites.length - visible.length;
  $('#map-missing').textContent = missing ? `${missing} sitios sin coordenadas. Permanecen en el listado para completar su ubicación.` : '';
  if (!window.mapboxgl || !state.mapConfig?.token) {
    $('#map-missing').textContent = 'No se pudo cargar Mapbox. El listado sigue disponible.'; return;
  }
  if (!sitesMap) {
    try {
      sitesMap = new mapboxgl.Map({
        container: 'sites-map', accessToken: state.mapConfig.token,
        style: `mapbox://styles/mapbox/${mapStyle}`, center: [-63.8, -32.1],
        zoom: 7, pitch: 55, bearing: -15, antialias: true,
        config: { basemap: { lightPreset: 'day', showRoadLabels: true, show3dObjects: true } }
      });
      sitesMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
      sitesMap.on('error', () => {
        $('#map-missing').textContent = 'No se pudo cargar una parte del mapa. Revisá la conexión o el acceso a Mapbox.';
      });
    } catch {
      $('#map-missing').textContent = 'Este navegador no pudo iniciar la vista 3D. El listado sigue disponible.'; return;
    }
  }
  mapMarkers.forEach(marker => marker.remove());
  mapMarkers = [];
  // Exact coincident coordinates share one popup so every meter remains accessible.
  const groups = new Map();
  for (const site of visible) {
    const key = `${site.latitude},${site.longitude}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(site);
  }
  for (const group of groups.values()) {
    const installed = group.filter(site => site.installation_status === 'INSTALADO').length;
    const mixed = installed > 0 && installed < group.length;
    const color = installed === group.length ? '#14845d' : '#d97706';
    const point = group[0];
    const element = document.createElement('button');
    element.className = 'mapbox-site-marker';
    element.style.backgroundColor = color;
    element.style.borderColor = mixed ? '#14845d' : '#fff';
    element.style.borderWidth = mixed ? '4px' : '2px';
    element.title = group.length > 1 ? `${group.length} sitios: ${installed} instalados` :
      `Medidor ${point.meter_number || point.external_id} · ${installed ? 'Instalado' : 'Pendiente'}`;
    element.setAttribute('aria-label', element.title);
    element.textContent = group.length > 1 ? group.length : '';
    const content = document.createElement('div');
    content.className = 'map-popup-content';
    content.innerHTML = group.map(site => `<div class="map-site"><strong>${escapeHtml(site.client)}</strong>
      <div>${escapeHtml(site.address)}</div><div>Medidor ${escapeHtml(site.meter_number || '')}</div>
      ${site.meter_brand ? `<div>Marca: ${escapeHtml(site.meter_brand)}</div>` : ''}
      ${meterModelDetail(site) ? `<div><strong>${escapeHtml(meterModelDetail(site))}</strong></div>` : ''}
      <div class="map-status ${site.installation_status === 'INSTALADO' ? 'installed' : 'pending'}">${site.installation_status === 'INSTALADO' ? 'Instalado' : 'Pendiente'}</div>
      ${site.source_data?.locationReview ? `<p class="location-review">${escapeHtml(site.source_data.locationReview)}</p>` : ''}
      <a href="${escapeHtml(site.map_url)}" target="_blank" rel="noreferrer">Abrir ubicación</a>
      ${site.installation_status !== 'INSTALADO' ? `<button class="primary-button" data-install="${site.id}">Marcar instalado</button>` : ''}
      <button class="secondary-button" data-visit="${site.id}">Comentar visita</button></div>`).join('');
    content.onclick = event => {
      event.stopPropagation();
      const install = event.target.closest('[data-install]');
      const visit = event.target.closest('[data-visit]');
      if (install) openInstall(install.dataset.install);
      if (visit) openVisit(visit.dataset.visit);
    };
    const popup = new mapboxgl.Popup({ offset: 15, maxWidth: '330px' }).setDOMContent(content);
    const marker = new mapboxgl.Marker({ element, anchor: 'center' })
      .setLngLat([point.longitude, point.latitude]).setPopup(popup).addTo(sitesMap);
    mapMarkers.push(marker);
  }
  const signature = `${state.projectKey}|${visible.map(site => `${site.id}:${site.latitude}:${site.longitude}`).join(',')}`;
  if (signature !== mapSignature) { fitMap(); mapSignature = signature; }
  requestAnimationFrame(() => sitesMap.resize());
}

$('#fit-map').addEventListener('click', fitMap);
$('#project-filter').addEventListener('change', async () => {
  clearTimeout(searchTimer);
  state.projectKey = $('#project-filter').value;
  localStorage.setItem('horatech-project', state.projectKey);
  updateProjectDescription();
  $('#district-filter').value = ''; $('#report-district').value = '';
  $('#status-filter').value = ''; $('#search').value = '';
  $('#report-rows').innerHTML = ''; $('#report-kpis').innerHTML = '';
  await loadDistricts(); await loadReportLocalities(); await loadSites();
  if (!$('#reports-view').classList.contains('hidden') && isAdmin()) await loadReport();
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-locate]');
  if (!button) return;
  const site = state.sites.find(site => site.id === Number(button.dataset.locate));
  const input = prompt('Coordenadas verificadas: latitud, longitud', hasCoordinates(site) ? `${site.latitude}, ${site.longitude}` : '');
  if (!input) return;
  const parts = input.split(',').map(value => Number(value.trim()));
  if (parts.length !== 2 || input.split(',').some(value => !value.trim()) || !parts.every(Number.isFinite)) { toast('Ingresá latitud y longitud separadas por coma.'); return; }
  try {
    await api(`/api/sites/${site.id}/coordinates`, { method: 'POST', body: JSON.stringify({ latitude: parts[0], longitude: parts[1] }) });
    await loadSites(); await loadDistricts(); toast('Punto actualizado.');
  } catch (error) { toast(error.message); }
});

try {
  await startApp(await api("/api/auth/me"));
} catch {
  showLogin();
}

$('#toggle-map-perspective').addEventListener('click', () => {
  if (!sitesMap) return;
  const flat = sitesMap.getPitch() > 10;
  sitesMap.easeTo({ pitch: flat ? 0 : 55, bearing: flat ? 0 : -15, duration: 650 });
  $('#toggle-map-perspective').textContent = flat ? 'Vista 3D' : 'Vista 2D';
});

document.querySelectorAll('input[name="map-layer"]').forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked || !['standard-satellite', 'standard'].includes(input.value)) return;
    mapStyle = input.value;
    if (sitesMap) sitesMap.setStyle(`mapbox://styles/mapbox/${mapStyle}`, {
      config: { basemap: { lightPreset: 'day', showRoadLabels: true, show3dObjects: true } }
    });
    $('#map-layers').open = false;
  });
});
