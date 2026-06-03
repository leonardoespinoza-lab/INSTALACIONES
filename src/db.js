import fs from "node:fs/promises";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const seedSites = JSON.parse(
  await fs.readFile(new URL("../data/sites.json", import.meta.url), "utf8"),
);

const connectionString = process.env.DATABASE_URL;
let pool = null;
let memory = null;
const scrypt = promisify(scryptCallback);

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
    technician_id: user.technician_id ?? null,
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(password), salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored ?? "").split(":");
  if (!salt || !expectedHex) return false;
  const derived = Buffer.from(await scrypt(String(password), salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeSite(site, index) {
  const district =
    site.district === "VILLA LIA" ? "SAN ANTONIO DE ARECO" : site.district;
  return {
    id: index + 1,
    external_id: site.externalId,
    line: site.line,
    client: site.client,
    locality: site.locality,
    district,
    address: site.address,
    coordinate_text: site.coordinateText,
    latitude: site.latitude,
    longitude: site.longitude,
    map_url: site.mapUrl,
    location_status: site.locationStatus,
    meter_brand: site.meterBrand,
    meter_model: site.meterModel,
    meter_caliber: site.meterCaliber,
    meter_number: site.meterNumber,
    unit_brand: site.unitBrand,
    unit_model: site.unitModel,
    unit_number: site.unitNumber,
    annual_volume_2025: site.annualVolume2025,
    installation_status: "PENDIENTE",
    installed_at: null,
    installed_by: null,
    installed_by_name: null,
  };
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export async function initDb() {
  if (!connectionString) {
    memory = {
      sites: seedSites.map(normalizeSite),
      technicians: [],
      visits: [],
      users: [],
      sessions: [],
    };
    const adminPassword = process.env.APP_PASSWORD || "horatech123";
    memory.users.push({
      id: 1,
      username: (process.env.APP_USERNAME || "horatech").toLowerCase(),
      name: "Administrador Horatech",
      password_hash: await hashPassword(adminPassword),
      role: "ADMIN",
      technician_id: null,
      active: true,
    });
    console.warn(
      "DATABASE_URL no está configurada. La app usa memoria temporal para desarrollo.",
    );
    return;
  }

  const { Pool } = await import("pg");
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS technicians (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      line TEXT,
      client TEXT NOT NULL,
      locality TEXT,
      district TEXT,
      address TEXT,
      coordinate_text TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      map_url TEXT,
      location_status TEXT NOT NULL DEFAULT 'NO_SE_PUDO_UBICAR',
      meter_brand TEXT,
      meter_model TEXT,
      meter_caliber TEXT,
      meter_number TEXT,
      unit_brand TEXT,
      unit_model TEXT,
      unit_number TEXT,
      annual_volume_2025 DOUBLE PRECISION NOT NULL DEFAULT 0,
      installation_status TEXT NOT NULL DEFAULT 'PENDIENTE',
      installed_at TIMESTAMPTZ,
      installed_by INTEGER REFERENCES technicians(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      site_id INTEGER NOT NULL REFERENCES sites(id),
      technician_id INTEGER NOT NULL REFERENCES technicians(id),
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      result TEXT NOT NULL DEFAULT 'INSTALADO',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'TECHNICIAN')),
      technician_id INTEGER REFERENCES technicians(id),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sites_locality_idx ON sites(locality);
    CREATE INDEX IF NOT EXISTS sites_district_idx ON sites(district);
    CREATE INDEX IF NOT EXISTS sites_installation_status_idx ON sites(installation_status);
    CREATE INDEX IF NOT EXISTS visits_visited_at_idx ON visits(visited_at);
    CREATE INDEX IF NOT EXISTS visits_technician_id_idx ON visits(technician_id);
    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  `);

  await pool.query(`
    UPDATE sites
    SET district = 'SAN ANTONIO DE ARECO', updated_at = NOW()
    WHERE district = 'VILLA LIA'
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM sites");
  if (rows[0].count === 0) {
    for (const site of seedSites) {
      await pool.query(
        `INSERT INTO sites (
          external_id, line, client, locality, district, address, coordinate_text,
          latitude, longitude, map_url, location_status, meter_brand, meter_model,
          meter_caliber, meter_number, unit_brand, unit_model, unit_number, annual_volume_2025
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) ON CONFLICT (external_id) DO NOTHING`,
        [
          site.externalId,
          site.line,
          site.client,
          site.locality,
          site.district,
          site.address,
          site.coordinateText,
          site.latitude,
          site.longitude,
          site.mapUrl,
          site.locationStatus,
          site.meterBrand,
          site.meterModel,
          site.meterCaliber,
          site.meterNumber,
          site.unitBrand,
          site.unitModel,
          site.unitNumber,
          site.annualVolume2025,
        ],
      );
    }
  }

  const adminUsername = process.env.APP_USERNAME || "horatech";
  const adminPassword = process.env.APP_PASSWORD;
  if (adminPassword) {
    const passwordHash = await hashPassword(adminPassword);
    await pool.query(
      `INSERT INTO users (username, name, password_hash, role)
       VALUES ($1, 'Administrador Horatech', $2, 'ADMIN')
       ON CONFLICT (username) DO NOTHING`,
      [adminUsername.toLowerCase(), passwordHash],
    );
  }
}

export async function listSites({ district = "", status = "", q = "" }) {
  if (memory) {
    const search = q.toLowerCase();
    return memory.sites
      .filter((site) => !district || site.district === district)
      .filter((site) => !status || site.installation_status === status)
      .filter(
        (site) =>
          !search ||
          [site.client, site.external_id, site.address, site.locality, site.district].some(
            (value) =>
              String(value ?? "")
                .toLowerCase()
                .includes(search),
          ),
      )
      .sort((a, b) =>
        `${a.district}${a.locality}${a.client}`.localeCompare(
          `${b.district}${b.locality}${b.client}`,
        ),
      );
  }

  const { rows } = await pool.query(
    `SELECT s.*, t.name AS installed_by_name
     FROM sites s
     LEFT JOIN technicians t ON t.id = s.installed_by
     WHERE ($1 = '' OR s.district = $1)
       AND ($2 = '' OR s.installation_status = $2)
       AND (
         $3 = '' OR
         s.client ILIKE '%' || $3 || '%' OR
         s.external_id ILIKE '%' || $3 || '%' OR
         s.address ILIKE '%' || $3 || '%' OR
         s.locality ILIKE '%' || $3 || '%' OR
         s.district ILIKE '%' || $3 || '%'
       )
     ORDER BY s.district, s.locality, s.client`,
    [district, status, q],
  );
  return rows;
}

export async function listDistricts() {
  if (memory) {
    const groups = new Map();
    for (const site of memory.sites) {
      const item = groups.get(site.district) ?? {
        district: site.district,
        total: 0,
        installed: 0,
        not_located: 0,
      };
      item.total += 1;
      item.installed += site.installation_status === "INSTALADO" ? 1 : 0;
      item.not_located += site.location_status === "NO_SE_PUDO_UBICAR" ? 1 : 0;
      groups.set(site.district, item);
    }
    return [...groups.values()].sort((a, b) =>
      a.district.localeCompare(b.district),
    );
  }

  const { rows } = await pool.query(`
    SELECT district,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE installation_status = 'INSTALADO')::int AS installed,
      COUNT(*) FILTER (WHERE location_status = 'NO_SE_PUDO_UBICAR')::int AS not_located
    FROM sites
    GROUP BY district
    ORDER BY district
  `);
  return rows;
}

export async function listLocalities(district = "") {
  if (memory) {
    return [...new Set(
      memory.sites
        .filter((site) => !district || site.district === district)
        .map((site) => site.locality)
        .filter(Boolean),
    )].sort();
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT locality
     FROM sites
     WHERE locality IS NOT NULL AND locality <> ''
       AND ($1 = '' OR district = $1)
     ORDER BY locality`,
    [district],
  );
  return rows.map((row) => row.locality);
}

export async function listTechnicians() {
  if (memory) return memory.technicians.filter((item) => item.active);
  const { rows } = await pool.query(
    "SELECT * FROM technicians WHERE active = TRUE ORDER BY name",
  );
  return rows;
}

export async function addTechnician(name) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new Error("El nombre del técnico es obligatorio.");

  if (memory) {
    const existing = memory.technicians.find(
      (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (existing) return existing;
    const technician = {
      id: memory.technicians.length + 1,
      name: cleanName,
      active: true,
    };
    memory.technicians.push(technician);
    return technician;
  }

  const { rows } = await pool.query(
    `INSERT INTO technicians (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET active = TRUE
     RETURNING *`,
    [cleanName],
  );
  return rows[0];
}

export async function installSite(siteId, { technicianId, notes, installedAt }) {
  const when = installedAt ? new Date(installedAt) : new Date();
  if (!technicianId) throw new Error("Seleccioná un técnico.");

  if (memory) {
    const site = memory.sites.find((item) => item.id === Number(siteId));
    const technician = memory.technicians.find(
      (item) => item.id === Number(technicianId),
    );
    if (!site || !technician) throw new Error("Sitio o técnico inexistente.");
    if (site.installation_status === "INSTALADO") {
      throw new Error("Este sitio ya fue marcado como instalado.");
    }
    site.installation_status = "INSTALADO";
    site.installed_at = when.toISOString();
    site.installed_by = technician.id;
    site.installed_by_name = technician.name;
    memory.visits.push({
      id: memory.visits.length + 1,
      site_id: site.id,
      technician_id: technician.id,
      visited_at: when.toISOString(),
      result: "INSTALADO",
      notes: String(notes ?? "").trim(),
    });
    return site;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedSite = await client.query(
      "SELECT installation_status FROM sites WHERE id = $1 FOR UPDATE",
      [siteId],
    );
    if (!lockedSite.rows[0]) throw new Error("Sitio inexistente.");
    if (lockedSite.rows[0].installation_status === "INSTALADO") {
      throw new Error("Este sitio ya fue marcado como instalado.");
    }
    await client.query(
      `INSERT INTO visits (site_id, technician_id, visited_at, result, notes)
       VALUES ($1, $2, $3, 'INSTALADO', $4)`,
      [siteId, technicianId, when, String(notes ?? "").trim()],
    );
    const { rows } = await client.query(
      `UPDATE sites
       SET installation_status = 'INSTALADO', installed_at = $2, installed_by = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [siteId, when, technicianId],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordUnsuccessfulVisit(
  siteId,
  { technicianId, notes, visitedAt },
) {
  const when = visitedAt ? new Date(visitedAt) : new Date();
  const cleanNotes = String(notes ?? "").trim();
  if (!technicianId) throw new Error("Seleccioná un técnico.");
  if (!cleanNotes) throw new Error("El comentario es obligatorio.");

  if (memory) {
    const site = memory.sites.find((item) => item.id === Number(siteId));
    const technician = memory.technicians.find(
      (item) => item.id === Number(technicianId),
    );
    if (!site || !technician) throw new Error("Sitio o técnico inexistente.");
    memory.visits.push({
      id: memory.visits.length + 1,
      site_id: site.id,
      technician_id: technician.id,
      visited_at: when.toISOString(),
      result: "NO_INSTALADO",
      notes: cleanNotes,
    });
    return { ok: true };
  }

  await pool.query(
    `INSERT INTO visits (site_id, technician_id, visited_at, result, notes)
     VALUES ($1, $2, $3, 'NO_INSTALADO', $4)`,
    [siteId, technicianId, when, cleanNotes],
  );
  return { ok: true };
}

export async function authenticateUser(username, password) {
  const cleanUsername = String(username ?? "").trim().toLowerCase();
  if (!cleanUsername || !password) return null;

  if (memory) {
    const user = memory.users.find(
      (item) => item.username === cleanUsername && item.active,
    );
    if (!user || !(await verifyPassword(password, user.password_hash))) return null;
    return publicUser(user);
  }

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE username = $1 AND active = TRUE`,
    [cleanUsername],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  return publicUser(user);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = sessionHash(token);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  if (memory) {
    memory.sessions.push({
      user_id: Number(userId),
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });
    return { token, expiresAt };
  }

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  return { token, expiresAt };
}

export async function getUserBySession(token) {
  if (!token) return null;
  const tokenHash = sessionHash(token);

  if (memory) {
    const session = memory.sessions.find(
      (item) =>
        item.token_hash === tokenHash && new Date(item.expires_at) > new Date(),
    );
    const user = session
      ? memory.users.find((item) => item.id === session.user_id && item.active)
      : null;
    return publicUser(user);
  }

  const { rows } = await pool.query(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE`,
    [tokenHash],
  );
  return publicUser(rows[0]);
}

export async function deleteSession(token) {
  if (!token) return;
  const tokenHash = sessionHash(token);
  if (memory) {
    memory.sessions = memory.sessions.filter((item) => item.token_hash !== tokenHash);
    return;
  }
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export async function listUsers() {
  if (memory) return memory.users.map(publicUser);
  const { rows } = await pool.query(
    `SELECT id, username, name, role, active, technician_id
     FROM users ORDER BY active DESC, name`,
  );
  return rows;
}

export async function createUser({ username, name, password, role }) {
  const cleanUsername = String(username ?? "").trim().toLowerCase();
  const cleanName = String(name ?? "").trim();
  const cleanRole = role === "ADMIN" ? "ADMIN" : "TECHNICIAN";
  if (!/^[a-z0-9._-]{3,40}$/.test(cleanUsername)) {
    throw new Error("El usuario debe tener entre 3 y 40 caracteres simples.");
  }
  if (!cleanName) throw new Error("El nombre es obligatorio.");
  if (String(password ?? "").length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  const passwordHash = await hashPassword(password);

  if (memory) {
    if (memory.users.some((item) => item.username === cleanUsername)) {
      throw new Error("Ese usuario ya existe.");
    }
    let technicianId = null;
    if (cleanRole === "TECHNICIAN") {
      technicianId = (await addTechnician(cleanName)).id;
    }
    const user = {
      id: memory.users.length + 1,
      username: cleanUsername,
      name: cleanName,
      password_hash: passwordHash,
      role: cleanRole,
      technician_id: technicianId,
      active: true,
    };
    memory.users.push(user);
    return publicUser(user);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let technicianId = null;
    if (cleanRole === "TECHNICIAN") {
      const technician = await client.query(
        `INSERT INTO technicians (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET active = TRUE
         RETURNING id`,
        [cleanName],
      );
      technicianId = technician.rows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO users (username, name, password_hash, role, technician_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, name, role, active, technician_id`,
      [cleanUsername, cleanName, passwordHash, cleanRole, technicianId],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") throw new Error("Ese usuario ya existe.");
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserActive(userId, active) {
  if (memory) {
    const user = memory.users.find((item) => item.id === Number(userId));
    if (!user) throw new Error("Usuario inexistente.");
    user.active = Boolean(active);
    return publicUser(user);
  }
  const { rows } = await pool.query(
    `UPDATE users SET active = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, username, name, role, active, technician_id`,
    [userId, Boolean(active)],
  );
  return rows[0];
}

export async function resetUserPassword(userId, password) {
  if (String(password ?? "").length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  const passwordHash = await hashPassword(password);
  if (memory) {
    const user = memory.users.find((item) => item.id === Number(userId));
    if (!user) throw new Error("Usuario inexistente.");
    user.password_hash = passwordHash;
    return;
  }
  await pool.query(
    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash],
  );
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export async function reopenSite(siteId) {
  if (memory) {
    const site = memory.sites.find((item) => item.id === Number(siteId));
    if (!site) throw new Error("Sitio inexistente.");
    site.installation_status = "PENDIENTE";
    site.installed_at = null;
    site.installed_by = null;
    site.installed_by_name = null;
    return site;
  }

  const { rows } = await pool.query(
    `UPDATE sites
     SET installation_status = 'PENDIENTE', installed_at = NULL, installed_by = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [siteId],
  );
  return rows[0];
}

export async function updateMapLink(siteId, mapUrl) {
  const cleanUrl = String(mapUrl ?? "").trim();
  if (!cleanUrl.startsWith("https://") && !cleanUrl.startsWith("http://")) {
    throw new Error("Ingresá un enlace de mapa válido.");
  }

  if (memory) {
    const site = memory.sites.find((item) => item.id === Number(siteId));
    if (!site) throw new Error("Sitio inexistente.");
    site.map_url = cleanUrl;
    site.location_status = "UBICADO_MANUAL";
    return site;
  }

  const { rows } = await pool.query(
    `UPDATE sites
     SET map_url = $2, location_status = 'UBICADO_MANUAL', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [siteId, cleanUrl],
  );
  return rows[0];
}

export async function getReport({
  from,
  to,
  technicianId = "",
  district = "",
  locality = "",
  status = "",
}) {
  if (memory) {
    const visits = memory.visits.filter((visit) => {
      const key = dateKey(visit.visited_at);
      const site = memory.sites.find((item) => item.id === visit.site_id);
      return (
        (!from || key >= from) &&
        (!to || key <= to) &&
        (!technicianId || visit.technician_id === Number(technicianId)) &&
        (!district || site?.district === district) &&
        (!locality || site?.locality === locality) &&
        (!status || visit.result === status)
      );
    });
    const rows = visits
      .map((visit) => {
        const site = memory.sites.find((item) => item.id === visit.site_id);
        const technician = memory.technicians.find(
          (item) => item.id === visit.technician_id,
        );
        return {
          id: visit.id,
          visited_at: visit.visited_at,
          technician: technician?.name ?? "",
          external_id: site?.external_id ?? "",
          client: site?.client ?? "",
          locality: site?.locality ?? "",
          district: site?.district ?? "",
          address: site?.address ?? "",
          result: visit.result,
          notes: visit.notes,
        };
      })
      .sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    return summarizeReport(rows);
  }

  const { rows } = await pool.query(
    `SELECT v.id, v.visited_at, t.name AS technician, s.external_id, s.client,
      s.locality, s.district, s.address, v.result, v.notes
     FROM visits v
     JOIN technicians t ON t.id = v.technician_id
     JOIN sites s ON s.id = v.site_id
     WHERE ($1::date IS NULL OR v.visited_at::date >= $1::date)
       AND ($2::date IS NULL OR v.visited_at::date <= $2::date)
       AND ($3::int IS NULL OR v.technician_id = $3::int)
       AND ($4 = '' OR s.district = $4)
       AND ($5 = '' OR s.locality = $5)
       AND ($6 = '' OR v.result = $6)
     ORDER BY v.visited_at DESC`,
    [from || null, to || null, technicianId || null, district, locality, status],
  );
  return summarizeReport(rows);
}

export async function deleteVisit(visitId) {
  if (memory) {
    memory.visits = memory.visits.filter((item) => item.id !== Number(visitId));
    return;
  }
  await pool.query("DELETE FROM visits WHERE id = $1", [visitId]);
}

function summarizeReport(rows) {
  const byDay = {};
  const byTechnician = {};
  const byMonth = {};
  const byResult = {};

  for (const row of rows) {
    const date = dateKey(row.visited_at);
    const month = date.slice(0, 7);
    byDay[date] = (byDay[date] ?? 0) + 1;
    byMonth[month] = (byMonth[month] ?? 0) + 1;
    byTechnician[row.technician] = (byTechnician[row.technician] ?? 0) + 1;
    byResult[row.result] = (byResult[row.result] ?? 0) + 1;
  }

  return { total: rows.length, byDay, byMonth, byTechnician, byResult, rows };
}
