export const LEGACY_PROJECT = { key: 'nuc-2026', name: 'NUC 2026' };

// Additive migration: existing site IDs, installation state and visit history stay intact.
export async function ensureProjectSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO projects (key, name) VALUES ('nuc-2026', 'NUC 2026')
      ON CONFLICT (key) DO NOTHING;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS project_key TEXT NOT NULL
      DEFAULT 'nuc-2026' REFERENCES projects(key);
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS source_data JSONB NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS sites_project_key_idx ON sites(project_key);
  `);
}

export function validateProjectImport(payload) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(payload?.key ?? '') || !payload?.name?.trim()) {
    throw new Error('El proyecto debe tener una clave y un nombre válidos.');
  }
  if (payload.key === LEGACY_PROJECT.key || !Array.isArray(payload.sites) || !payload.sites.length) {
    throw new Error('La importación debe corresponder a un proyecto nuevo con sitios.');
  }
  const ids = new Set();
  for (const site of payload.sites) {
    if (!site.externalId || ids.has(site.externalId) || !site.client || !site.address || !site.locality) {
      throw new Error('Hay identificadores duplicados o sitios sin datos obligatorios.');
    }
    ids.add(site.externalId);
    if (site.projectKey !== payload.key) throw new Error('El sitio pertenece a otro proyecto.');
    if ((site.latitude == null) !== (site.longitude == null)) throw new Error('Coordenadas incompletas.');
    if (site.latitude != null && (!Number.isFinite(site.latitude) || Math.abs(site.latitude) > 90 ||
        !Number.isFinite(site.longitude) || Math.abs(site.longitude) > 180)) throw new Error('Coordenadas inválidas.');
    if (!/^https:\/\//.test(site.mapUrl ?? '')) throw new Error('Falta un enlace de mapa seguro.');
  }
  return payload;
}

// Caller owns BEGIN/COMMIT/ROLLBACK. Existing sites are never overwritten.
export async function importProject(db, input) {
  const payload = validateProjectImport(input);
  await db.query('INSERT INTO projects (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    [payload.key, payload.name]);
  const { rows: projects } = await db.query('SELECT name FROM projects WHERE key = $1', [payload.key]);
  if (projects[0].name !== payload.name) throw new Error('La clave ya corresponde a otro nombre de proyecto.');
  const records = JSON.stringify(payload.sites.map(site => ({
    external_id: site.externalId, client: site.client, locality: site.locality,
    district: site.district, address: site.address, latitude: site.latitude,
    longitude: site.longitude, coordinate_text: site.coordinateText,
    map_url: site.mapUrl, location_status: site.locationStatus,
    meter_brand: site.meterBrand, meter_model: site.meterModel,
    meter_caliber: site.meterCaliber, meter_number: site.meterNumber,
    project_key: payload.key, source_data: site.sourceData ?? {},
  })));
  const { rows: conflicts } = await db.query(`SELECT s.external_id FROM sites s
    JOIN jsonb_to_recordset($1::jsonb) AS i(external_id TEXT) ON i.external_id=s.external_id
    WHERE s.project_key <> $2`, [records, payload.key]);
  if (conflicts.length) throw new Error('El identificador ya existe en otro proyecto.');
  const { rowCount: inserted } = await db.query(`INSERT INTO sites (
    external_id, client, locality, district, address, latitude, longitude,
    coordinate_text, map_url, location_status, meter_brand, meter_model,
    meter_caliber, meter_number, project_key, source_data)
    SELECT external_id, client, locality, district, address, latitude, longitude,
      coordinate_text, map_url, location_status, meter_brand, meter_model,
      meter_caliber, meter_number, project_key, source_data
    FROM jsonb_to_recordset($1::jsonb) AS i(
      external_id TEXT, client TEXT, locality TEXT, district TEXT, address TEXT,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, coordinate_text TEXT,
      map_url TEXT, location_status TEXT, meter_brand TEXT, meter_model TEXT,
      meter_caliber TEXT, meter_number TEXT, project_key TEXT, source_data JSONB)
    ON CONFLICT (external_id) DO NOTHING`, [records]);
  return { project: payload.name, received: payload.sites.length, inserted,
    existing: payload.sites.length - inserted };
}
