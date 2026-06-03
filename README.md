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
