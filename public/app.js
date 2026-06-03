const state = {
  user: null,
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

async function loadDistricts() {
  state.districts = await api("/api/districts");
  const options = state.districts
    .map(
      (item) =>
        `<option value="${escapeHtml(item.district)}">${escapeHtml(item.district)} (${item.total})</option>`,
    )
    .join("");
  $("#district-filter").innerHTML = `<option value="">Todos los partidos</option>${options}`;
  $("#report-district").innerHTML = `<option value="">Todos los partidos</option>${options}`;
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
    district: $("#district-filter").value,
    status: $("#status-filter").value,
    q: $("#search").value.trim(),
  });
  state.sites = await api(`/api/sites?${params}`);
  renderSites();
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
      ${!located ? `<span class="badge not-located">No se pudo ubicar</span>` : ""}
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
    from: $("#report-from").value,
    to: $("#report-to").value,
    district: $("#report-district").value,
    locality: $("#report-locality").value,
    technicianId: $("#report-technician").value,
    status: $("#report-status").value,
  });
}

async function loadReport() {
  const report = await api(`/api/reports?${reportParams()}`);
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
  const params = new URLSearchParams({ district: $("#report-district").value });
  const localities = await api(`/api/localities?${params}`);
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

try {
  await startApp(await api("/api/auth/me"));
} catch {
  showLogin();
}
