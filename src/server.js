import express from "express";
import PDFDocument from "pdfkit";
import {
  authenticateUser,
  createSession,
  createUser,
  deleteVisit,
  deleteSession,
  getReport,
  getUserBySession,
  initDb,
  installSite,
  listDistricts,
  listLocalities,
  listSites,
  listTechnicians,
  listUsers,
  listProjects,
  updateCoordinates,
  recordUnsuccessfulVisit,
  reopenSite,
  resetUserPassword,
  setUserActive,
  updateMapLink,
} from "./db.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionCookie = "horatech_session";

app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use(express.static("public"));

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [
          decodeURIComponent(part.slice(0, separator)),
          decodeURIComponent(part.slice(separator + 1)),
        ];
      }),
  );
}

async function requireUser(req, res, next) {
  try {
    const token = parseCookies(req)[sessionCookie];
    const user = await getUserBySession(token);
    if (!user) return res.status(401).json({ error: "Iniciá sesión para continuar." });
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Esta acción requiere permisos de administrador." });
  }
  next();
}

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const user = await authenticateUser(req.body.username, req.body.password);
    if (!user) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    const session = await createSession(user.id);
    res.cookie(sessionCookie, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT),
      expires: session.expiresAt,
      path: "/",
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireUser, async (req, res, next) => {
  try {
    await deleteSession(req.sessionToken);
    res.clearCookie(sessionCookie, { path: "/" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireUser, (req, res) => res.json(req.user));

app.get('/api/map-config', requireUser, (_req, res) => {
  const token = (process.env.MAPBOX_PUBLIC_TOKEN || '').trim();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: token.startsWith('pk.') ? token : '', style: 'mapbox/standard' });
});

app.get('/api/projects', requireUser, async (_req, res, next) => {
  try { res.json(await listProjects()); } catch (error) { next(error); }
});

app.post('/api/sites/:id/coordinates', requireUser, requireAdmin, async (req, res, next) => {
  try { res.json(await updateCoordinates(req.params.id, req.body.latitude, req.body.longitude)); }
  catch (error) { next(error); }
});

app.get("/api/sites", requireUser, async (req, res, next) => {
  try {
    res.json(await listSites(req.query));
  } catch (error) {
    next(error);
  }
});

app.get("/api/districts", requireUser, async (req, res, next) => {
  try {
    res.json(await listDistricts(req.query.projectKey ?? ""));
  } catch (error) {
    next(error);
  }
});

app.get("/api/localities", requireUser, async (req, res, next) => {
  try {
    res.json(await listLocalities(req.query.district ?? "", req.query.projectKey ?? ""));
  } catch (error) {
    next(error);
  }
});

app.get("/api/technicians", requireUser, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listTechnicians());
  } catch (error) {
    next(error);
  }
});

app.post("/api/sites/:id/install", requireUser, async (req, res, next) => {
  try {
    const technicianId =
      req.user.role === "TECHNICIAN" ? req.user.technician_id : req.body.technicianId;
    res.json(await installSite(req.params.id, { ...req.body, technicianId }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sites/:id/visit", requireUser, async (req, res, next) => {
  try {
    const technicianId =
      req.user.role === "TECHNICIAN" ? req.user.technician_id : req.body.technicianId;
    res.json(
      await recordUnsuccessfulVisit(req.params.id, {
        ...req.body,
        technicianId,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/sites/:id/reopen", requireUser, requireAdmin, async (req, res, next) => {
  try {
    res.json(await reopenSite(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sites/:id/map", requireUser, requireAdmin, async (req, res, next) => {
  try {
    res.json(await updateMapLink(req.params.id, req.body.mapUrl));
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireUser, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listUsers());
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireUser, requireAdmin, async (req, res, next) => {
  try {
    res.status(201).json(await createUser(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/:id/active", requireUser, requireAdmin, async (req, res, next) => {
  try {
    if (Number(req.params.id) === Number(req.user.id) && req.body.active === false) {
      throw new Error("No podés desactivar tu propio usuario.");
    }
    res.json(await setUserActive(req.params.id, req.body.active));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/:id/password", requireUser, requireAdmin, async (req, res, next) => {
  try {
    await resetUserPassword(req.params.id, req.body.password);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports", requireUser, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getReport(req.query));
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports/pdf", requireUser, requireAdmin, async (req, res, next) => {
  try {
    const report = await getReport(req.query);
    const project = (await listProjects()).find(item => item.key === req.query.projectKey);
    const filters = { ...req.query, projectName: project?.name };
    const fileName = `informe-horatech-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    renderReportPdf(res, report, filters, req.user);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/visits/:id", requireUser, requireAdmin, async (req, res, next) => {
  try {
    await deleteVisit(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function renderReportPdf(stream, report, filters, user) {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
  doc.pipe(stream);
  const pageWidth = doc.page.width - 72;

  doc.fontSize(18).fillColor("#14283d").text("Horatech - Informe de sitios");
  doc.fontSize(9).fillColor("#6d7b88").text(
    `Generado: ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date())} · Usuario: ${user.name}`,
  );
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#1d2935").text(
    [
      filters.projectName ? `Proyecto: ${filters.projectName}` : null,
      filters.from ? `Desde ${filters.from}` : null,
      filters.to ? `Hasta ${filters.to}` : null,
      filters.district ? `Partido: ${filters.district}` : null,
      filters.locality ? `Localidad: ${filters.locality}` : null,
      filters.status ? `Estado: ${filters.status}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Todos los sitios visitados",
  );
  doc.moveDown();

  doc.roundedRect(36, doc.y, pageWidth, 48, 6).fill("#eaf2ff");
  const cardY = doc.y + 12;
  doc.fillColor("#14283d").fontSize(16).text(String(report.total), 50, cardY, { width: 80 });
  doc.fontSize(9).fillColor("#6d7b88").text("Visitas instaladas", 50, cardY + 20);
  doc.fontSize(16).fillColor("#14283d").text(String(Object.keys(report.byTechnician).length), 190, cardY, { width: 80 });
  doc.fontSize(9).fillColor("#6d7b88").text("Técnicos", 190, cardY + 20);
  doc.fontSize(16).fillColor("#14283d").text(String(Object.keys(report.byDay).length), 310, cardY, { width: 80 });
  doc.fontSize(9).fillColor("#6d7b88").text("Días con visitas", 310, cardY + 20);
  doc.y = cardY + 48;
  doc.moveDown();

  const headers = ["Fecha", "Resultado", "Técnico", "Sitio", "Partido / Localidad", "Dirección"];
  const widths = [52, 55, 70, 105, 95, 146];
  drawPdfRow(doc, headers, widths, true);
  for (const row of report.rows) {
    if (doc.y > doc.page.height - 70) {
      doc.addPage();
      drawPdfRow(doc, headers, widths, true);
    }
    drawPdfRow(
      doc,
      [
        new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(row.visited_at)),
        row.result === "INSTALADO" ? "Instalado" : "No instalado",
        row.technician,
        `${row.external_id} · ${row.client}`,
        `${row.district} · ${row.locality}`,
        `${row.address}${row.notes ? ` · Nota: ${row.notes}` : ""}`,
      ],
      widths,
      false,
    );
  }

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc.fontSize(8).fillColor("#6d7b88").text(
      `Página ${index + 1} de ${pages.count}`,
      36,
      doc.page.height - 28,
      { width: pageWidth, align: "right" },
    );
  }
  doc.end();
}

function drawPdfRow(doc, values, widths, header) {
  const startX = 36;
  const startY = doc.y;
  const padding = 4;
  const heights = values.map((value, index) =>
    doc.heightOfString(String(value ?? ""), { width: widths[index] - padding * 2 }),
  );
  const height = Math.max(header ? 18 : 22, ...heights) + padding * 2;
  if (header) doc.rect(startX, startY, widths.reduce((a, b) => a + b, 0), height).fill("#14283d");
  let x = startX;
  values.forEach((value, index) => {
    if (!header) doc.rect(x, startY, widths[index], height).strokeColor("#dfe7ee").stroke();
    doc
      .fontSize(header ? 8 : 7.5)
      .fillColor(header ? "#ffffff" : "#1d2935")
      .text(String(value ?? ""), x + padding, startY + padding, {
        width: widths[index] - padding * 2,
        height: height - padding * 2,
      });
    x += widths[index];
  });
  doc.y = startY + height;
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(400).json({ error: error.message || "Ocurrió un error." });
});

await initDb();
app.listen(port, () => {
  console.log(`Horatech Sitios disponible en http://localhost:${port}`);
});
