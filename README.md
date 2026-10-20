# Horatech Sitios

Aplicación web para organizar sitios por partido, mostrar localidad, abrir enlaces de mapa, registrar instalaciones por técnico y generar informes operativos.

## Funcionalidades

- Login con usuarios individuales.
- Roles de administrador y técnico.
- Filtro principal por partido.
- Localidad visible dentro de cada sitio.
- Apertura de Google Maps o búsqueda por dirección.
- Registro de sitios instalados.
- Registro de visitas no instaladas con comentario obligatorio.
- Informes PDF filtrables por mes, día, rango de fechas, partido, localidad, técnico y resultado.
- Administración de usuarios desde la app.
- Persistencia en PostgreSQL para Railway.

## Datos iniciales

La carga inicial fue generada desde `NUC 2026 CLIENTES.xlsx`, hoja `Clientes 2026`.

- 854 sitios.
- 28 partidos normalizados.
- 760 sitios con coordenadas interpretables.
- 94 sitios marcados como `No se pudo ubicar`.

## Desarrollo local

```bash
npm install
npm start
```

Luego abrir:

```text
http://localhost:3000
```

Sin `DATABASE_URL`, la aplicación funciona con memoria temporal. Sirve para probar la interfaz, pero los cambios se pierden al reiniciar.

Usuario local por defecto si no hay `.env`:

```text
Usuario: horatech
Contraseña: horatech123
```

## Variables de entorno

Copiar `.env.example` como `.env` si se desea correr con base real:

```env
PORT=3000
DATABASE_URL=postgresql://usuario:clave@host:5432/base
APP_USERNAME=horatech
APP_PASSWORD=una-clave-segura
```

No subir `.env` a GitHub.

## Railway

Para producción:

1. Crear un repositorio en GitHub con este proyecto.
2. Crear o vincular un proyecto en Railway desde ese repositorio.
3. Agregar PostgreSQL en Railway.
4. Configurar en el servicio web:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `APP_USERNAME`
   - `APP_PASSWORD`
5. Railway ejecuta `npm start`.

Al iniciar por primera vez, la app crea las tablas e importa los sitios. Los reinicios posteriores no duplican la información.

## Proyectos y mapa

Los sitios existentes quedan en NUC 2026 conservando sus IDs, usuarios, visitas y estados.
El selector de proyecto filtra sitios, mapa, localidades e informes (incluido PDF).
El mapa usa puntos naranjas para pendientes y verdes para instalados. Los sitios
coincidentes comparten una ventana con todos los medidores; un borde verde indica
un grupo parcialmente instalado. Los sitios sin coordenadas quedan en el listado
y un administrador puede completar su punto con coordenadas verificadas.

La migración agrega projects, sites.project_key y sites.source_data. La importación
de un proyecto se ejecuta como operación separada, dentro de una transacción y sin
sobrescribir sitios existentes. No se deben versionar listados privados ni claves.

```sh
# Con DATABASE_URL configurada. Por defecto hace una simulación y ROLLBACK.
node scripts/import-project.mjs /ruta/privada/proyecto.json
node scripts/import-project.mjs /ruta/privada/proyecto.json --apply
```

Para una vista local en memoria, PROJECT_IMPORT_FILE puede señalar el JSON privado.
Leaflet 1.9.4 se distribuye localmente en public/vendor/leaflet con su licencia BSD.
Los mapas base usan Mapbox Standard con nombres de calles y vista 3D inicial.
Configurar MAPBOX_PUBLIC_TOKEN en Railway con un token público pk. El token no se
versiona en el repositorio. Se puede alternar entre las vistas 2D y 3D desde el mapa.
Los edificios 3D se muestran donde el proveedor tiene cobertura. El cambio de estado se guarda
en PostgreSQL en producción y se refleja en el mapa después de registrarlo.

El mapa incluye relieve real (Terrain DEM, exageración 1.3), agrupación automática
de sitios por proximidad y control Mi ubicación (requiere permiso del navegador).
Los números cuentan medidores, incluidos los coincidentes; los grupos verdes están
completamente instalados y el borde verde indica una instalación parcial.
El relieve y las capas de sitios se restauran al cambiar de mapa base.
