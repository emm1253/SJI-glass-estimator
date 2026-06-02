import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileApp } from "./scripts/build-app.mjs";

const scrypt = promisify(crypto.scrypt);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const dataPath = path.join(dataDir, "pricing.json");
const usersPath = path.join(dataDir, "users.json");
const sessionsPath = path.join(dataDir, "sessions.json");
const estimatesPath = path.join(dataDir, "estimates.json");
const databaseUrl = process.env.DATABASE_URL || "";
const usePostgres = Boolean(databaseUrl);
let dbPool = null;
const publicDir = path.join(__dirname, "public");
const srcDir = path.join(__dirname, "src");
const port = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = "sji_session";
const sessionTtlSeconds = 60 * 60 * 8;
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 8;

const defaultSettings = {
  markupMultiplier: 2.25,
  defaultTaxRate: 0,
  glassSpecs: [
    { id: "clear", name: "Clear", pricePerSqFt: 0 },
    { id: "lowe", name: "LowE", pricePerSqFt: 2 },
    { id: "tempered", name: "Tempered", pricePerSqFt: 5 },
    { id: "annealed", name: "Annealed", pricePerSqFt: 1.25 },
    { id: "colored-spacer", name: "Colored Spacer", pricePerSqFt: 0.75 },
    { id: "argon", name: "Argon", pricePerSqFt: 1.5 },
    { id: "pattern", name: "Pattern", pricePerSqFt: 3 },
    { id: "eighth-over-eighth", name: "1/8 over 1/8", pricePerSqFt: 2.5 },
    { id: "sixteenth-over-sixteenth", name: "1/16 over 1/16", pricePerSqFt: 1.75 }
  ],
  addOns: [
    { id: "logistics", name: "Logistics", cost: 85, costType: "flat" },
    { id: "disposal", name: "Disposal", cost: 12, costType: "per_item" }
  ],
  labor: {
    hourly: { enabled: true, rate: 95 },
    perSquareFoot: { enabled: true, rate: 4.5 },
    flatFee: { enabled: true, fee: 175 }
  }
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

async function ensureJsonFile(filePath, fallback) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeJson(filePath, fallback);
  }
}

async function readJson(filePath, fallback) {
  await ensureJsonFile(filePath, fallback);
  const raw = await readFile(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function initPostgres() {
  const { Pool } = await import("pg");
  dbPool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === "require" || process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined
  });

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'team_member')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      id UUID PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS app_estimates (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      customer_name TEXT,
      created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS app_estimates_created_at_idx ON app_estimates(created_at DESC);
  `);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function dbUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    passwordHash: row.password_hash,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function dbSession(row) {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    userAgent: row.user_agent || ""
  };
}

async function ensureSettingsFile() {
  await ensureJsonFile(dataPath, defaultSettings);
}

async function readSettings() {
  if (usePostgres) {
    const result = await dbPool.query("SELECT value FROM app_settings WHERE key = 'pricing'");
    return normalizeSettings(result.rows[0]?.value || defaultSettings);
  }

  await ensureSettingsFile();
  const raw = await readFile(dataPath, "utf8");
  return normalizeSettings(JSON.parse(raw));
}

async function writeSettings(settings) {
  const normalized = normalizeSettings(settings);
  if (usePostgres) {
    await dbPool.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('pricing', $1::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [JSON.stringify(normalized)]
    );
    return;
  }

  await writeJson(dataPath, normalized);
}

async function initData() {
  if (usePostgres) {
    await initPostgres();

    const defaultEmail = process.env.SJI_ADMIN_EMAIL || "admin@sjiglass.local";
    const defaultPassword = process.env.SJI_ADMIN_PASSWORD || "ChangeMe!2026";

    if (isProduction && (!process.env.SJI_ADMIN_EMAIL || !process.env.SJI_ADMIN_PASSWORD)) {
      throw new Error("Set SJI_ADMIN_EMAIL and SJI_ADMIN_PASSWORD before starting in production.");
    }

    await dbPool.query(
      `
        INSERT INTO app_settings (key, value)
        VALUES ('pricing', $1::jsonb)
        ON CONFLICT (key) DO NOTHING
      `,
      [JSON.stringify(defaultSettings)]
    );

    const userCount = await dbPool.query("SELECT COUNT(*)::int AS count FROM app_users");
    if (userCount.rows[0].count === 0) {
      await dbPool.query(
        `
          INSERT INTO app_users (id, email, name, role, active, password_hash)
          VALUES ($1, $2, $3, 'admin', TRUE, $4)
        `,
        [
          crypto.randomUUID(),
          defaultEmail.toLowerCase(),
          "SJI Admin",
          await hashPassword(defaultPassword)
        ]
      );

      if (!isProduction) {
        console.log(`Created local admin login: ${defaultEmail} / ${defaultPassword}`);
      }
    }

    return;
  }

  await mkdir(dataDir, { recursive: true });
  await ensureSettingsFile();
  await ensureJsonFile(sessionsPath, []);
  await ensureJsonFile(estimatesPath, []);

  try {
    await stat(usersPath);
  } catch {
    const defaultEmail = process.env.SJI_ADMIN_EMAIL || "admin@sjiglass.local";
    const defaultPassword = process.env.SJI_ADMIN_PASSWORD || "ChangeMe!2026";

    if (isProduction && (!process.env.SJI_ADMIN_EMAIL || !process.env.SJI_ADMIN_PASSWORD)) {
      throw new Error("Set SJI_ADMIN_EMAIL and SJI_ADMIN_PASSWORD before starting in production.");
    }

    const now = new Date().toISOString();
    const admin = {
      id: crypto.randomUUID(),
      email: defaultEmail.toLowerCase(),
      name: "SJI Admin",
      role: "admin",
      active: true,
      passwordHash: await hashPassword(defaultPassword),
      createdAt: now,
      updatedAt: now
    };

    await writeJson(usersPath, [admin]);
    if (!isProduction) {
      console.log(`Created local admin login: ${defaultEmail} / ${defaultPassword}`);
    }
  }
}

function slugify(value, fallback) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function numberOr(value, fallback, min = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, numeric);
}

function boolOr(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSettings(input = {}) {
  const base = defaultSettings;
  const glassSpecs = Array.isArray(input.glassSpecs) && input.glassSpecs.length
    ? input.glassSpecs
    : base.glassSpecs;
  const addOns = Array.isArray(input.addOns) ? input.addOns : base.addOns;
  const labor = input.labor || {};

  return {
    markupMultiplier: numberOr(input.markupMultiplier, base.markupMultiplier, 0),
    defaultTaxRate: numberOr(input.defaultTaxRate, base.defaultTaxRate, 0),
    glassSpecs: glassSpecs.map((spec, index) => ({
      id: slugify(spec.id || spec.name, `glass-spec-${index + 1}`),
      name: String(spec.name || `Glass spec ${index + 1}`).trim(),
      pricePerSqFt: numberOr(spec.pricePerSqFt, 0, 0)
    })),
    addOns: addOns.map((addOn, index) => {
      const costType = ["flat", "per_sq_ft", "per_item"].includes(addOn.costType)
        ? addOn.costType
        : "flat";
      return {
        id: slugify(addOn.id || addOn.name, `add-on-${index + 1}`),
        name: String(addOn.name || `Add-on ${index + 1}`).trim(),
        cost: numberOr(addOn.cost, 0, 0),
        costType
      };
    }),
    labor: {
      hourly: {
        enabled: boolOr(labor.hourly?.enabled, base.labor.hourly.enabled),
        rate: numberOr(labor.hourly?.rate, base.labor.hourly.rate, 0)
      },
      perSquareFoot: {
        enabled: boolOr(labor.perSquareFoot?.enabled, base.labor.perSquareFoot.enabled),
        rate: numberOr(labor.perSquareFoot?.rate, base.labor.perSquareFoot.rate, 0)
      },
      flatFee: {
        enabled: boolOr(labor.flatFee?.enabled, base.labor.flatFee.enabled),
        fee: numberOr(labor.flatFee?.fee, base.labor.flatFee.fee, 0)
      }
    }
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(String(password), salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, keyHex] = String(storedHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(String(password), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex === -1) return cookies;
      cookies[cookie.slice(0, separatorIndex)] = decodeURIComponent(cookie.slice(separatorIndex + 1));
      return cookies;
    }, {});
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" || isProduction);
}

function sessionCookie(token, req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${sessionTtlSeconds}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function expiredSessionCookie(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

async function readUsers() {
  if (usePostgres) {
    const result = await dbPool.query("SELECT * FROM app_users ORDER BY created_at ASC");
    return result.rows.map(dbUser);
  }

  return readJson(usersPath, []);
}

async function writeUsers(users) {
  if (usePostgres) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const ids = users.map((user) => user.id);
      if (ids.length) {
        await client.query("DELETE FROM app_users WHERE NOT (id = ANY($1::uuid[]))", [ids]);
      } else {
        await client.query("DELETE FROM app_users");
      }
      for (const user of users) {
        await client.query(
          `
            INSERT INTO app_users (
              id, email, name, role, active, password_hash, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id)
            DO UPDATE SET
              email = EXCLUDED.email,
              name = EXCLUDED.name,
              role = EXCLUDED.role,
              active = EXCLUDED.active,
              password_hash = EXCLUDED.password_hash,
              updated_at = EXCLUDED.updated_at
          `,
          [
            user.id,
            user.email,
            user.name,
            normalizeRole(user.role),
            Boolean(user.active),
            user.passwordHash,
            user.createdAt || new Date().toISOString(),
            user.updatedAt || new Date().toISOString()
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await writeJson(usersPath, users);
}

async function readSessions() {
  if (usePostgres) {
    const result = await dbPool.query("SELECT * FROM app_sessions ORDER BY created_at ASC");
    return result.rows.map(dbSession);
  }

  return readJson(sessionsPath, []);
}

async function writeSessions(sessions) {
  if (usePostgres) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const ids = sessions.map((session) => session.id);
      if (ids.length) {
        await client.query("DELETE FROM app_sessions WHERE NOT (id = ANY($1::uuid[]))", [ids]);
      } else {
        await client.query("DELETE FROM app_sessions");
      }
      for (const session of sessions) {
        await client.query(
          `
            INSERT INTO app_sessions (
              id, token_hash, user_id, created_at, expires_at, user_agent
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id)
            DO UPDATE SET
              token_hash = EXCLUDED.token_hash,
              user_id = EXCLUDED.user_id,
              expires_at = EXCLUDED.expires_at,
              user_agent = EXCLUDED.user_agent
          `,
          [
            session.id,
            session.tokenHash,
            session.userId,
            session.createdAt,
            session.expiresAt,
            session.userAgent || ""
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await writeJson(sessionsPath, sessions);
}

async function readEstimates() {
  if (usePostgres) {
    const result = await dbPool.query("SELECT data FROM app_estimates ORDER BY created_at DESC");
    return result.rows.map((row) => row.data);
  }

  return readJson(estimatesPath, []);
}

async function writeEstimates(estimates) {
  if (usePostgres) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const ids = estimates.map((estimate) => estimate.id);
      if (ids.length) {
        await client.query("DELETE FROM app_estimates WHERE NOT (id = ANY($1::uuid[]))", [ids]);
      } else {
        await client.query("DELETE FROM app_estimates");
      }
      for (const estimate of estimates) {
        await client.query(
          `
            INSERT INTO app_estimates (
              id, name, customer_name, created_by, created_by_name, data, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            ON CONFLICT (id)
            DO UPDATE SET
              name = EXCLUDED.name,
              customer_name = EXCLUDED.customer_name,
              created_by = EXCLUDED.created_by,
              created_by_name = EXCLUDED.created_by_name,
              data = EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
          `,
          [
            estimate.id,
            estimate.name,
            estimate.customerName || "",
            estimate.createdBy || null,
            estimate.createdByName || "",
            JSON.stringify(estimate),
            estimate.createdAt || new Date().toISOString(),
            estimate.updatedAt || new Date().toISOString()
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await writeJson(estimatesPath, estimates);
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function createSession(user, req, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const sessions = await readSessions();
  sessions.push({
    id: crypto.randomUUID(),
    tokenHash: tokenHash(token),
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionTtlSeconds * 1000).toISOString(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 220)
  });
  await writeSessions(sessions.filter((session) => new Date(session.expiresAt).getTime() > now));
  res.setHeader("Set-Cookie", sessionCookie(token, req));
}

async function destroySession(req, res) {
  const token = parseCookies(req)[sessionCookieName];
  if (token) {
    const hash = tokenHash(token);
    const sessions = await readSessions();
    await writeSessions(sessions.filter((session) => session.tokenHash !== hash));
  }
  res.setHeader("Set-Cookie", expiredSessionCookie(req));
}

async function currentUser(req) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;

  const now = Date.now();
  const hash = tokenHash(token);
  const [sessions, users] = await Promise.all([readSessions(), readUsers()]);
  const validSessions = sessions.filter((session) => new Date(session.expiresAt).getTime() > now);

  if (validSessions.length !== sessions.length) {
    await writeSessions(validSessions);
  }

  const session = validSessions.find((item) => item.tokenHash === hash);
  const user = session ? users.find((item) => item.id === session.userId) : null;
  return user && user.active ? user : null;
}

function requireAdmin(user) {
  return user?.role === "admin";
}

function assertSameOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) return;
  const origin = req.headers.origin;
  if (!origin) return;

  const host = req.headers.host;
  const allowedOrigins = new Set([
    process.env.APP_ORIGIN,
    `http://${host}`,
    `https://${host}`
  ].filter(Boolean));

  if (!allowedOrigins.has(origin)) {
    const error = new Error("Invalid request origin.");
    error.statusCode = 403;
    throw error;
  }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function loginKey(req, email) {
  return `${clientIp(req)}:${String(email || "").trim().toLowerCase()}`;
}

function assertLoginAllowed(req, email) {
  const key = loginKey(req, email);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + loginWindowMs });
    return;
  }

  if (attempt.count >= maxLoginAttempts) {
    const error = new Error("Too many login attempts. Try again later.");
    error.statusCode = 429;
    throw error;
  }
}

function recordLoginFailure(req, email) {
  const key = loginKey(req, email);
  const now = Date.now();
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: now + loginWindowMs };
  loginAttempts.set(key, {
    count: attempt.count + 1,
    resetAt: attempt.resetAt > now ? attempt.resetAt : now + loginWindowMs
  });
}

function clearLoginFailures(req, email) {
  loginAttempts.delete(loginKey(req, email));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function safeStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  if (cleanPath.startsWith("/src/")) {
    return path.join(srcDir, cleanPath.slice("/src/".length));
  }
  const publicPath = cleanPath === "/" ? "/index.html" : cleanPath;
  return path.join(publicDir, publicPath);
}

async function serveStatic(req, res) {
  const filePath = safeStaticPath(new URL(req.url, `http://${req.headers.host}`).pathname);
  const allowed = filePath.startsWith(publicDir) || filePath.startsWith(srcDir);
  if (!allowed) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    await stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendError(res, 404, "Not found");
  }
}

function requireFields(payload, fields) {
  for (const field of fields) {
    if (!payload[field]) {
      const error = new Error(`${field} is required.`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function normalizeRole(role) {
  return role === "admin" ? "admin" : "team_member";
}

async function login(req, res) {
  const { email, password } = await readBody(req);
  requireFields({ email, password }, ["email", "password"]);
  assertLoginAllowed(req, email);

  const users = await readUsers();
  const user = users.find((item) => item.email === String(email).trim().toLowerCase());

  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(req, email);
    sendError(res, 401, "Invalid email or password.");
    return;
  }

  clearLoginFailures(req, email);
  await createSession(user, req, res);
  sendJson(res, 200, { user: safeUser(user) });
}

async function listUsers(res) {
  const users = await readUsers();
  sendJson(res, 200, { users: users.map(safeUser) });
}

async function createUser(req, res) {
  const body = await readBody(req);
  requireFields(body, ["email", "name", "password"]);

  const users = await readUsers();
  const email = String(body.email).trim().toLowerCase();
  if (users.some((user) => user.email === email)) {
    sendError(res, 409, "A team member with that email already exists.");
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email,
    name: String(body.name).trim(),
    role: normalizeRole(body.role),
    active: body.active !== false,
    passwordHash: await hashPassword(body.password),
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  await writeUsers(users);
  sendJson(res, 201, { user: safeUser(user), users: users.map(safeUser) });
}

async function updateUser(req, res, userId, authUser) {
  const body = await readBody(req);
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) {
    sendError(res, 404, "Team member not found.");
    return;
  }

  const next = { ...users[index] };
  if (body.email) {
    const email = String(body.email).trim().toLowerCase();
    if (users.some((user) => user.email === email && user.id !== userId)) {
      sendError(res, 409, "A team member with that email already exists.");
      return;
    }
    next.email = email;
  }
  if (body.name) next.name = String(body.name).trim();
  if (body.role) next.role = normalizeRole(body.role);
  if (typeof body.active === "boolean") next.active = body.active;
  if (body.password) next.passwordHash = await hashPassword(body.password);
  next.updatedAt = new Date().toISOString();

  if (userId === authUser.id && next.role !== "admin") {
    sendError(res, 400, "You cannot remove your own admin role.");
    return;
  }

  users[index] = next;
  await writeUsers(users);
  sendJson(res, 200, { user: safeUser(next), users: users.map(safeUser) });
}

async function deleteUser(res, userId, authUser) {
  if (userId === authUser.id) {
    sendError(res, 400, "You cannot delete your own account.");
    return;
  }

  const users = await readUsers();
  const nextUsers = users.filter((user) => user.id !== userId);
  if (nextUsers.length === users.length) {
    sendError(res, 404, "Team member not found.");
    return;
  }

  await writeUsers(nextUsers);
  sendJson(res, 200, { users: nextUsers.map(safeUser) });
}

function squareFeet(width, height) {
  return (width * height) / 144;
}

function specPricePerSqFt(line, settings) {
  const selected = new Set(line.specIds);
  return settings.glassSpecs.reduce((total, spec) => selected.has(spec.id) ? total + spec.pricePerSqFt : total, 0);
}

function calculateAddOn(addOn, totalSqFt, totalQuantity) {
  if (addOn.costType === "per_sq_ft") return addOn.cost * totalSqFt;
  if (addOn.costType === "per_item") return addOn.cost * totalQuantity;
  return addOn.cost;
}

function calculateEstimate(payload, settings) {
  const validSpecIds = new Set(settings.glassSpecs.map((spec) => spec.id));
  const validAddOnIds = new Set(settings.addOns.map((addOn) => addOn.id));
  const lines = Array.isArray(payload.lines)
    ? payload.lines.map((line) => ({
        id: line.id || crypto.randomUUID(),
        width: numberOr(line.width, 0, 0),
        height: numberOr(line.height, 0, 0),
        quantity: numberOr(line.quantity, 0, 0),
        specIds: Array.isArray(line.specIds)
          ? line.specIds.filter((specId) => validSpecIds.has(specId))
          : []
      })).filter((line) => line.width > 0 && line.height > 0 && line.quantity > 0)
    : [];

  if (!lines.length) {
    const error = new Error("At least one estimate line item is required.");
    error.statusCode = 400;
    throw error;
  }

  const selectedAddOns = Array.isArray(payload.selectedAddOns)
    ? payload.selectedAddOns.filter((addOnId) => validAddOnIds.has(addOnId))
    : [];
  const laborSelection = payload.laborSelection || {};
  const lineCalculations = lines.map((line) => {
    const unitSqFt = squareFeet(line.width, line.height);
    const totalSqFt = unitSqFt * line.quantity;
    const pricePerSqFt = specPricePerSqFt(line, settings);
    const subtotal = totalSqFt * pricePerSqFt;
    return { line, unitSqFt, totalSqFt, pricePerSqFt, subtotal };
  });
  const totalSqFt = lineCalculations.reduce((total, line) => total + line.totalSqFt, 0);
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0);
  const glassSubtotal = lineCalculations.reduce((total, line) => total + line.subtotal, 0);
  const glassTotalWithMarkup = glassSubtotal * settings.markupMultiplier;
  const addOnsTotal = settings.addOns
    .filter((addOn) => selectedAddOns.includes(addOn.id))
    .reduce((total, addOn) => total + calculateAddOn(addOn, totalSqFt, totalQuantity), 0);
  const laborTotal =
    (laborSelection.useHours && settings.labor.hourly.enabled
      ? numberOr(laborSelection.hours, 0, 0) * settings.labor.hourly.rate
      : 0) +
    (laborSelection.useSquareFoot && settings.labor.perSquareFoot.enabled
      ? totalSqFt * settings.labor.perSquareFoot.rate
      : 0) +
    (laborSelection.useFlatFee && settings.labor.flatFee.enabled
      ? settings.labor.flatFee.fee
      : 0);
  const preTaxTotal = glassTotalWithMarkup + addOnsTotal + laborTotal;
  const taxEnabled = Boolean(payload.taxEnabled);
  const taxRate = numberOr(payload.taxRate, settings.defaultTaxRate || 0, 0);
  const taxAmount = taxEnabled ? preTaxTotal * (taxRate / 100) : 0;

  return {
    lines,
    selectedAddOns,
    laborSelection: {
      useHours: Boolean(laborSelection.useHours),
      hours: String(laborSelection.hours || ""),
      useSquareFoot: Boolean(laborSelection.useSquareFoot),
      useFlatFee: Boolean(laborSelection.useFlatFee)
    },
    taxEnabled,
    taxRate,
    totals: {
      totalSqFt,
      totalQuantity,
      glassSubtotal,
      glassTotalWithMarkup,
      addOnsTotal,
      laborTotal,
      preTaxTotal,
      taxAmount,
      grandTotal: preTaxTotal + taxAmount
    }
  };
}

async function createEstimate(req, res, authUser) {
  const body = await readBody(req);
  const settings = await readSettings();
  const calculated = calculateEstimate(body, settings);
  const estimates = await readEstimates();
  const now = new Date().toISOString();
  const estimate = {
    id: crypto.randomUUID(),
    name: String(body.name || `Estimate ${estimates.length + 1}`).trim().slice(0, 120),
    customerName: String(body.customerName || "").trim().slice(0, 120),
    createdBy: authUser.id,
    createdByName: authUser.name,
    createdAt: now,
    updatedAt: now,
    pricingSnapshot: settings,
    ...calculated
  };
  estimates.unshift(estimate);
  await writeEstimates(estimates);
  sendJson(res, 201, { estimate, estimates });
}

async function deleteEstimate(res, estimateId) {
  const estimates = await readEstimates();
  const nextEstimates = estimates.filter((estimate) => estimate.id !== estimateId);
  if (nextEstimates.length === estimates.length) {
    sendError(res, 404, "Estimate not found.");
    return;
  }
  await writeEstimates(nextEstimates);
  sendJson(res, 200, { estimates: nextEstimates });
}

async function handleApi(req, res, requestUrl) {
  assertSameOrigin(req);

  if (requestUrl.pathname === "/api/health" && req.method === "GET") {
    if (usePostgres) {
      await dbPool.query("SELECT 1");
    }
    sendJson(res, 200, {
      ok: true,
      storage: usePostgres ? "postgresql" : "json",
      timestamp: new Date().toISOString()
    });
    return true;
  }

  if (requestUrl.pathname === "/api/login" && req.method === "POST") {
    await login(req, res);
    return true;
  }

  if (requestUrl.pathname === "/api/logout" && req.method === "POST") {
    await destroySession(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const user = await currentUser(req);

  if (requestUrl.pathname === "/api/session" && req.method === "GET") {
    if (!user) {
      sendError(res, 401, "Not authenticated.");
      return true;
    }
    sendJson(res, 200, { user: safeUser(user) });
    return true;
  }

  if (!user) {
    sendError(res, 401, "Login required.");
    return true;
  }

  if (requestUrl.pathname === "/api/settings" && req.method === "GET") {
    sendJson(res, 200, await readSettings());
    return true;
  }

  if (requestUrl.pathname === "/api/settings" && req.method === "PUT") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await writeSettings(await readBody(req));
    sendJson(res, 200, await readSettings());
    return true;
  }

  if (requestUrl.pathname === "/api/users" && req.method === "GET") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await listUsers(res);
    return true;
  }

  if (requestUrl.pathname === "/api/users" && req.method === "POST") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await createUser(req, res);
    return true;
  }

  const userMatch = requestUrl.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === "PUT") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await updateUser(req, res, userMatch[1], user);
    return true;
  }

  if (userMatch && req.method === "DELETE") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await deleteUser(res, userMatch[1], user);
    return true;
  }

  if (requestUrl.pathname === "/api/estimates" && req.method === "GET") {
    sendJson(res, 200, { estimates: await readEstimates() });
    return true;
  }

  if (requestUrl.pathname === "/api/estimates" && req.method === "POST") {
    await createEstimate(req, res, user);
    return true;
  }

  const estimateMatch = requestUrl.pathname.match(/^\/api\/estimates\/([^/]+)$/);
  if (estimateMatch && req.method === "DELETE") {
    if (!requireAdmin(user)) {
      sendError(res, 403, "Admin permission is required.");
      return true;
    }
    await deleteEstimate(res, estimateMatch[1]);
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, requestUrl);
      if (!handled) sendError(res, 404, "Not found");
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 405, "Method not allowed");
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendError(res, status, error instanceof Error ? error.message : "Unexpected server error");
  }
});

await initData();
await compileApp(__dirname);

server.listen(port, () => {
  console.log(`SJI Glass estimator running at http://localhost:${port}`);
});
