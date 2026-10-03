const http = require("http");
const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { DataStore } = require("./tools/data-store");
const { TeamSpeakService, parseItems, tsEscape } = require("./tools/teamspeak-query");

const root = __dirname;
const port = Number(process.env.PORT || 5175);
const isProduction = process.env.NODE_ENV === "production";
const trustProxy = process.env.TRUST_PROXY === "1";
const allowedHost = String(process.env.APP_HOST || "").toLowerCase();
const appBasePath = normalizeBasePath(process.env.APP_BASE_PATH || "/salas");
const allowApiClients = process.env.ALLOW_API_CLIENTS === "1";
const cookieSecure = isProduction || process.env.COOKIE_SECURE === "1";
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const challengeLifetimeMs = 5 * 60 * 1000;
const tempSpacerCid = Number(process.env.TS_TEMP_SPACER_CID || 902);
const channelAdminGroupId = Number(process.env.TS_CHANNEL_ADMIN_GROUP_ID || 49);
const protectedThinSeparatorCid = Number(process.env.TS_PROTECTED_THIN_CID || 33738);
const protectedThinSeparatorName = process.env.TS_PROTECTED_THIN_NAME || "[*spacer252f6c22]━";
const dataDir = path.join(root, "data");
const iconsDir = path.join(dataDir, "icons");
const configuredSecret = String(process.env.SESSION_SECRET || "");
const sessionSecret = configuredSecret || crypto.randomBytes(32).toString("hex");

function normalizeBasePath(value) {
  const normalized = `/${String(value || "").trim()}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "/" ? "" : normalized;
}

if (isProduction && (!allowedHost || !trustProxy || configuredSecret.length < 32)) {
  throw new Error("Produção exige APP_HOST, TRUST_PROXY=1 e SESSION_SECRET com pelo menos 32 caracteres.");
}
if (!configuredSecret) {
  console.warn("SESSION_SECRET não definido: as sessões locais expiram quando o servidor reinicia.");
}

let store;
const teamSpeak = new TeamSpeakService();
const allowedIconIds = new Set();
let groupCache = { expiresAt: 0, categories: [] };

const groupCategories = [
  { key: "jogos", title: "Jogos", limit: 4, sgids: [241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 312, 325, 327, 328, 329, 337, 1265, 172870, 174334] },
  { key: "sexos", title: "Sexos", limit: 1, sgids: [287, 288] },
  { key: "social", title: "Social", limit: 2, sgids: [277, 278, 279, 280, 281, 282, 283] },
  { key: "ranks", title: "Ranks CS2", limit: 1, sgids: [257, 258, 259, 260, 261, 262, 263] },
  { key: "equipas", title: "Equipas", limit: 1, sgids: [290, 291, 292, 293, 173266] },
  { key: "plataformas", title: "Plataformas", limit: 1, sgids: [284, 285, 341, 348, 344, 345, 346] },
  { key: "faceit", title: "Faceit", limit: 1, sgids: [302, 303, 304, 305, 306, 307, 308, 309, 310, 311] },
  { key: "diversao", title: "Diversão", limit: 1, sgids: [1483, 1485, 171665, 171666, 171703, 171927] }
];

const displayNames = new Map([
  [253, "FIFA"],
  [325, "FiveM"],
  [329, "World War Z"],
  [279, "Instagram"],
  [278, "YouTube"],
  [346, "iOS"]
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function securityHeaders() {
  const headers = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
  if (isProduction) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function normalizeIp(value) {
  const ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

function getRequestIp(request) {
  if (trustProxy) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0];
    if (forwarded) return normalizeIp(forwarded);
  }
  return normalizeIp(request.socket.remoteAddress);
}

function isLocalIp(ip) {
  return ip === "127.0.0.1" || ip === "::1";
}

function getHostName(request) {
  try {
    return new URL(`http://${request.headers.host || ""}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedOrigin(request, origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (isProduction) return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === allowedHost;
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) && parsed.port === String(port);
  } catch {
    return false;
  }
}

function enforceRateLimit(bucket, limit, windowMs) {
  const count = store.incrementRateLimit(bucket, windowMs);
  if (count > limit) throw new HttpError(429, "Demasiados pedidos. Aguarda alguns minutos e tenta novamente.");
}

function assertRequestAllowed(request, pathname) {
  const host = getHostName(request);
  const validHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (allowedHost) validHosts.add(allowedHost);
  if (!validHosts.has(host)) throw new HttpError(403, "Host não autorizado.");

  const unsafe = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
  if (unsafe) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) throw new HttpError(415, "O pedido deve usar JSON.");

    const fetchSite = String(request.headers["sec-fetch-site"] || "");
    const origin = String(request.headers.origin || "");
    if (fetchSite && fetchSite !== "same-origin") throw new HttpError(403, "Pedido externo bloqueado.");
    if (origin && !isAllowedOrigin(request, origin)) throw new HttpError(403, "Origem não autorizada.");
    if (!fetchSite && !origin && !allowApiClients) throw new HttpError(403, "Não foi possível validar a origem do pedido.");
  }

  const ip = getRequestIp(request);
  if (pathname === "/api/auth/challenge") {
    enforceRateLimit(`challenge:${ip}`, 5, 10 * 60 * 1000);
  } else if (pathname === "/api/auth/verify") {
    enforceRateLimit(`verify:${ip}`, 10, 10 * 60 * 1000);
  } else if (!pathname.startsWith("/api/icons/")) {
    enforceRateLimit(`${request.method === "GET" ? "read" : "write"}:${ip}`, request.method === "GET" ? 90 : 20, 60_000);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let finished = false;
    request.on("data", (chunk) => {
      if (finished) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 25_000) {
        finished = true;
        reject(new HttpError(413, "Pedido demasiado grande."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (finished) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, "JSON inválido."));
      }
    });
    request.on("error", (error) => {
      if (!finished) reject(error);
    });
  });
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmac(value) {
  return crypto.createHmac("sha256", sessionSecret).update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function userAgentHash(request) {
  return sha256(String(request.headers["user-agent"] || "unknown"));
}

function sessionCookie(token, maxAge = Math.floor(sessionLifetimeMs / 1000)) {
  return [
    `legendz_session=${encodeURIComponent(token)}`,
    `Path=${appBasePath || "/"}`,
    "HttpOnly",
    "SameSite=Strict",
    cookieSecure ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

function resolveSession(request) {
  const token = parseCookies(request).legendz_session;
  if (!token || token.length < 32) return null;
  const tokenHash = sha256(token);
  const session = store.getSession(tokenHash);
  if (!session) return null;
  if (session.ip !== getRequestIp(request) || session.user_agent_hash !== userAgentHash(request)) {
    store.revokeSession(tokenHash);
    return null;
  }
  store.touchSession(tokenHash);
  return { ...session, token, tokenHash, csrfToken: hmac(`csrf:${token}`) };
}

function requireSession(request, verifyCsrf = false) {
  const session = resolveSession(request);
  if (!session) throw new HttpError(401, "Autentica-te através do TeamSpeak para continuar.");
  if (verifyCsrf && !safeEqual(request.headers["x-csrf-token"] || "", session.csrfToken)) {
    throw new HttpError(403, "Token de segurança inválido. Atualiza a página e tenta novamente.");
  }
  return session;
}

function publicUser(source) {
  return source ? { databaseId: Number(source.database_id || source.databaseId), nickname: source.nickname } : null;
}

function withTeamSpeak(work) {
  return teamSpeak.run(work);
}

async function listHumanClients(ts, includeGroups = false) {
  const flags = includeGroups ? "clientlist -ip -uid -groups" : "clientlist -ip -uid";
  return parseItems(await ts.command("listar clientes", flags)).filter((client) => client.client_type === "0");
}

async function getAuthenticationCandidates(ts, request) {
  const ip = getRequestIp(request);
  const clients = await listHumanClients(ts);
  let candidates = clients.filter((client) => normalizeIp(client.connection_client_ip) === ip);

  if (!candidates.length && isLocalIp(ip) && process.env.ALLOW_LOCAL_QUERY_OWNER_FALLBACK === "1") {
    const whoami = parseItems(await ts.command("identificar query", "whoami"))[0];
    candidates = clients.filter((client) => Number(client.client_database_id) === Number(whoami.client_database_id));
  }

  return candidates.map((client) => ({
    clientId: Number(client.clid),
    databaseId: Number(client.client_database_id),
    nickname: client.client_nickname,
    uniqueId: client.client_unique_identifier
  }));
}

async function getSessionClient(ts, session, includeGroups = false) {
  const clients = await listHumanClients(ts, includeGroups);
  const client = clients.find((item) => (
    Number(item.client_database_id) === Number(session.database_id)
    && item.client_unique_identifier === session.unique_id
  ));
  if (!client) throw new HttpError(403, "Mantém o TeamSpeak aberto e ligado ao servidor para usar o painel.");
  return {
    clientId: Number(client.clid),
    databaseId: Number(client.client_database_id),
    nickname: client.client_nickname,
    uniqueId: client.client_unique_identifier,
    serverGroups: String(client.client_servergroups || "").split(",").map(Number).filter(Boolean)
  };
}

async function startAuthChallenge(request, payload) {
  return withTeamSpeak(async (ts) => {
    const candidates = await getAuthenticationCandidates(ts, request);
    if (!candidates.length) throw new HttpError(403, "Liga-te primeiro ao servidor TeamSpeak.");

    const wantedId = Number(payload.databaseId || 0);
    const candidate = candidates.length === 1
      ? candidates[0]
      : candidates.find((item) => item.databaseId === wantedId);
    if (!candidate) throw new HttpError(409, "Seleciona o teu utilizador TeamSpeak.", { candidates: candidates.map(publicUser) });

    const id = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1_000_000));
    const createdAt = Date.now();
    store.createChallenge({
      id,
      codeHash: hmac(`challenge:${id}:${code}`),
      databaseId: candidate.databaseId,
      nickname: candidate.nickname,
      uniqueId: candidate.uniqueId,
      ip: getRequestIp(request),
      userAgentHash: userAgentHash(request),
      createdAt,
      expiresAt: createdAt + challengeLifetimeMs
    });

    await ts.command(
      "enviar código de autenticação",
      `sendtextmessage targetmode=1 target=${candidate.clientId} msg=${tsEscape(`LegendZ: o teu código de acesso é ${code}. Expira em 5 minutos.`)}`
    );
    return { challengeId: id, nickname: candidate.nickname, expiresIn: 300 };
  });
}

async function verifyAuthChallenge(request, payload) {
  const challenge = store.getChallenge(payload.challengeId);
  if (!challenge || challenge.used || challenge.expires_at < Date.now()) {
    throw new HttpError(400, "O código expirou. Pede um novo código no TeamSpeak.");
  }
  if (challenge.ip !== getRequestIp(request) || challenge.user_agent_hash !== userAgentHash(request)) {
    throw new HttpError(403, "Este código pertence a outra sessão do browser.");
  }
  if (challenge.attempts >= 5) throw new HttpError(429, "Demasiadas tentativas. Pede um novo código.");

  const expected = hmac(`challenge:${challenge.id}:${String(payload.code || "").trim()}`);
  if (!safeEqual(expected, challenge.code_hash)) {
    store.recordChallengeFailure(challenge.id);
    throw new HttpError(400, "Código incorreto.");
  }

  await withTeamSpeak(async (ts) => {
    const clients = await listHumanClients(ts);
    const online = clients.some((client) => (
      Number(client.client_database_id) === Number(challenge.database_id)
      && client.client_unique_identifier === challenge.unique_id
    ));
    if (!online) throw new HttpError(403, "O utilizador deixou de estar ligado ao TeamSpeak.");
  });

  store.consumeChallenge(challenge.id);
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = Date.now();
  store.createSession({
    tokenHash: sha256(token),
    databaseId: Number(challenge.database_id),
    nickname: challenge.nickname,
    uniqueId: challenge.unique_id,
    ip: challenge.ip,
    userAgentHash: challenge.user_agent_hash,
    createdAt,
    expiresAt: createdAt + sessionLifetimeMs
  });
  return { token, csrfToken: hmac(`csrf:${token}`), user: { databaseId: Number(challenge.database_id), nickname: challenge.nickname } };
}

function ensureIconsDir() {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function iconFileName(iconid) {
  const numeric = Number(iconid);
  if (!numeric) return null;
  return `icon_${numeric < 0 ? numeric >>> 0 : numeric}`;
}

function detectImageMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "application/octet-stream";
}

function downloadFileTransfer(host, transferPort, ftkey, size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 2_000_000) {
    return Promise.reject(new Error("Tamanho de ícone inválido."));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const socket = net.createConnection({ host, port: Number(transferPort) }, () => socket.write(ftkey));
    const finish = (error, buffer) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(buffer);
    };
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= size) finish(null, Buffer.concat(chunks, received).subarray(0, size));
    });
    socket.on("error", (error) => finish(error));
    socket.setTimeout(8000, () => finish(new Error("Timeout ao descarregar o ícone do TeamSpeak.")));
  });
}

async function getIconBuffer(iconid) {
  const name = iconFileName(iconid);
  if (!name) return null;
  ensureIconsDir();
  const filePath = path.join(iconsDir, `${name}.bin`);
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  return withTeamSpeak(async (ts) => {
    const transfer = parseItems(await ts.command(
      "descarregar ícone",
      `ftinitdownload clientftfid=${crypto.randomInt(1, 60000)} name=${tsEscape(`/${name}`)} cid=0 cpw= seekpos=0`
    ))[0];
    const size = Number(transfer?.size);
    if (!transfer?.ftkey || !size) throw new HttpError(404, "Ícone não encontrado no TeamSpeak.");
    const buffer = await downloadFileTransfer(process.env.TS_HOST, transfer.port, transfer.ftkey, size);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, buffer);
    fs.renameSync(temporaryPath, filePath);
    return buffer;
  });
}

async function getServerGroupCategories(ts, force = false) {
  if (!force && groupCache.expiresAt > Date.now()) return groupCache.categories;
  const groups = parseItems(await ts.command("listar grupos", "servergrouplist"))
    .filter((group) => group.type === "1")
    .map((group) => ({
      sgid: Number(group.sgid),
      name: displayNames.get(Number(group.sgid)) || group.name.trim() || `Grupo ${group.sgid}`,
      iconid: Number(group.iconid || 0),
      iconUrl: Number(group.iconid || 0) ? `${appBasePath}/api/icons/${Number(group.iconid)}` : ""
    }));
  const byId = new Map(groups.map((group) => [group.sgid, group]));
  allowedIconIds.clear();
  const categories = groupCategories.map((category) => ({
    key: category.key,
    title: category.title,
    limit: category.limit,
    options: category.sgids.map((sgid) => byId.get(sgid)).filter(Boolean)
  })).filter((category) => category.options.length);
  categories.forEach((category) => category.options.forEach((option) => {
    if (option.iconid) allowedIconIds.add(option.iconid);
  }));
  groupCache = { categories, expiresAt: Date.now() + 60_000 };
  return categories;
}

function getSelectedGroups(categories, currentGroups) {
  const current = new Set(currentGroups || []);
  return Object.fromEntries(categories.map((category) => [
    category.key,
    category.options.filter((option) => current.has(option.sgid)).map((option) => option.sgid).slice(0, category.limit)
  ]));
}

async function updateUserGroups(payload, session) {
  return withTeamSpeak(async (ts) => {
    const creator = await getSessionClient(ts, session, true);
    const categories = await getServerGroupCategories(ts);
    const currentGroups = new Set(creator.serverGroups);
    const finalGroups = new Set(creator.serverGroups);
    for (const category of categories) {
      const allowed = new Set(category.options.map((option) => option.sgid));
      const requested = Array.isArray(payload.selections?.[category.key]) ? payload.selections[category.key] : [];
      const desired = [...new Set(requested.map(Number))].filter((sgid) => allowed.has(sgid)).slice(0, category.limit);
      const desiredSet = new Set(desired);
      for (const sgid of allowed) {
        if (currentGroups.has(sgid) && !desiredSet.has(sgid)) {
          await ts.command("remover grupo", `servergroupdelclient sgid=${sgid} cldbid=${creator.databaseId}`);
          finalGroups.delete(sgid);
        }
      }
      for (const sgid of desired) {
        if (!currentGroups.has(sgid)) {
          await ts.command("adicionar grupo", `servergroupaddclient sgid=${sgid} cldbid=${creator.databaseId}`);
          finalGroups.add(sgid);
        }
      }
    }
    return { categories, selected: getSelectedGroups(categories, finalGroups) };
  });
}

async function getChannels(ts) {
  return parseItems(await ts.command("listar canais", "channellist"));
}

async function reconcileRooms(ts) {
  const active = store.getRooms().filter((room) => room.active);
  if (!active.length) return;
  const channels = await getChannels(ts);
  store.markMissingRoomsInactive(channels.map((channel) => Number(channel.cid)));
}

function sanitizeTitle(value) {
  return [...String(value || "").replace(/[\[\]\r\n\t]/g, "").replace(/\s+/g, " ").trim()].slice(0, 27).join("");
}

function randomSpacerId() {
  return crypto.randomBytes(3).toString("hex").slice(0, 4);
}

function titleSpacerName(title) {
  return `[cspacer${randomSpacerId()}]${title}`;
}

async function createChannel(ts, label, properties) {
  const command = Object.entries(properties)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${tsEscape(value)}`)
    .join(" ");
  const created = parseItems(await ts.command(label, `channelcreate ${command}`))[0];
  if (!created?.cid) throw new Error(`${label}: resposta sem cid.`);
  return Number(created.cid);
}

async function giveChannelAdmin(ts, creator, cids) {
  for (const cid of cids) {
    await ts.command("atribuir channel admin", `setclientchannelgroup cgid=${channelAdminGroupId} cid=${cid} cldbid=${creator.databaseId}`);
  }
}

function serializeRoom(room) {
  return room ? {
    ...room,
    creator: { databaseId: room.creatorDatabaseId, nickname: room.creatorNickname }
  } : null;
}

async function createRoom(payload, session) {
  const title = sanitizeTitle(payload.title);
  if (!title) throw new HttpError(400, "Escreve um nome válido para a sala.");
  const passwords = Array.from({ length: 4 }, (_, index) => String(payload.channels?.[index]?.password || "").trim().slice(0, 24));

  return withTeamSpeak(async (ts) => {
    const creator = await getSessionClient(ts, session);
    await reconcileRooms(ts);
    if (store.getActiveRoomByCreator(creator.databaseId)) {
      throw new HttpError(409, "Já tens uma sala ativa. Edita-a ou apaga-a antes de criar outra.");
    }

    const channelsBefore = await getChannels(ts);
    const tempSpacer = channelsBefore.find((channel) => Number(channel.cid) === tempSpacerCid);
    const protectedSeparator = channelsBefore.find((channel) => (
      Number(channel.cid) === protectedThinSeparatorCid
      && channel.channel_name === protectedThinSeparatorName
    ));
    if (!tempSpacer) throw new Error(`Canal temporário ${tempSpacerCid} não encontrado.`);
    if (!protectedSeparator) throw new Error("O separador protegido das salas temporárias não foi encontrado.");

    const insertAfterCid = Number(protectedSeparator.channel_order || tempSpacer.channel_order || 0);
    const createdCids = [];
    let separatorMoved = false;
    try {
      const topLineCid = await createChannel(ts, "criar separador superior", {
        channel_name: `[*spacer${crypto.randomBytes(4).toString("hex")}]▂▂▂▂`,
        channel_flag_permanent: 1,
        channel_order: insertAfterCid
      });
      createdCids.push(topLineCid);
      const parentCid = await createChannel(ts, "criar sala principal", {
        channel_name: titleSpacerName(title),
        channel_flag_permanent: 1,
        channel_order: topLineCid
      });
      createdCids.push(parentCid);

      const channels = [];
      let previousSubCid = 0;
      for (let index = 0; index < 4; index += 1) {
        const cid = await createChannel(ts, `criar Convivio ${index + 1}`, {
          channel_name: `● Convivio ${index + 1}`,
          channel_flag_permanent: 1,
          cpid: parentCid,
          channel_order: previousSubCid,
          channel_password: passwords[index]
        });
        createdCids.push(cid);
        channels.push({ cid, name: `Convivio ${index + 1}`, passwordProtected: Boolean(passwords[index]) });
        previousSubCid = cid;
      }

      await ts.command("mover separador protegido", `channeledit cid=${protectedThinSeparatorCid} channel_order=${parentCid}`);
      separatorMoved = true;
      await giveChannelAdmin(ts, creator, [parentCid, ...channels.map((channel) => channel.cid)]);

      const room = store.insertRoom({
        id: crypto.randomUUID(),
        active: true,
        creatorDatabaseId: creator.databaseId,
        creatorNickname: creator.nickname,
        title,
        teamspeak: { topLineCid, parentCid, bottomLineCid: protectedThinSeparatorCid },
        channels
      });
      return serializeRoom(room);
    } catch (error) {
      for (const cid of createdCids.reverse()) {
        await ts.command("reverter canal", `channeldelete cid=${cid} force=1`).catch(() => {});
      }
      if (separatorMoved) {
        await ts.command("repor separador protegido", `channeledit cid=${protectedThinSeparatorCid} channel_order=${insertAfterCid}`).catch(() => {});
      }
      throw error;
    }
  });
}

function getOwnedRoom(session, roomId) {
  const room = store.getActiveRoomById(roomId);
  if (!room) throw new HttpError(404, "Sala ativa não encontrada.");
  if (Number(room.creatorDatabaseId) !== Number(session.database_id)) {
    throw new HttpError(403, "Não tens permissão para alterar esta sala.");
  }
  return room;
}

async function updateRoom(payload, session) {
  const title = sanitizeTitle(payload.title);
  if (!title || !payload.id) throw new HttpError(400, "Sala inválida para atualizar.");
  const requestedChannels = Array.isArray(payload.channels) ? payload.channels : [];
  const room = getOwnedRoom(session, payload.id);
  const passwordChanges = Array.from({ length: 4 }, (_, index) => {
    const action = String(requestedChannels[index]?.passwordAction || "keep");
    const password = String(requestedChannels[index]?.password || "").trim().slice(0, 24);
    if (!["keep", "change", "remove"].includes(action)) {
      throw new HttpError(400, "Ação de palavra-passe inválida.");
    }
    if (action === "change" && !password) {
      throw new HttpError(400, `Escreve a nova palavra-passe do Convivio ${index + 1}.`);
    }
    return { action, password };
  });

  return withTeamSpeak(async (ts) => {
    await getSessionClient(ts, session);
    await ts.command("renomear sala principal", `channeledit cid=${room.teamspeak.parentCid} channel_name=${tsEscape(titleSpacerName(title))}`);
    const updatedChannels = [];
    for (let index = 0; index < 4; index += 1) {
      const saved = room.channels[index];
      if (!saved?.cid) continue;
      const { action, password } = passwordChanges[index];
      const passwordPart = action === "keep" ? "" : ` channel_password=${tsEscape(action === "remove" ? "" : password)}`;
      await ts.command(
        `atualizar Convivio ${index + 1}`,
        `channeledit cid=${saved.cid} channel_name=${tsEscape(`● Convivio ${index + 1}`)}${passwordPart}`
      );
      updatedChannels.push({
        cid: saved.cid,
        name: `Convivio ${index + 1}`,
        passwordProtected: action === "keep" ? saved.passwordProtected : action === "change"
      });
    }
    return serializeRoom(store.updateRoom(room.id, title, updatedChannels));
  });
}

async function deleteRoom(payload, session) {
  if (!payload.id) throw new HttpError(400, "Sala inválida para apagar.");
  const room = getOwnedRoom(session, payload.id);
  return withTeamSpeak(async (ts) => {
    await getSessionClient(ts, session);
    const channels = await getChannels(ts);
    const topLine = channels.find((channel) => Number(channel.cid) === room.teamspeak.topLineCid);
    const protectedSeparator = channels.find((channel) => Number(channel.cid) === protectedThinSeparatorCid);
    if (protectedSeparator && Number(protectedSeparator.channel_order) === room.teamspeak.parentCid) {
      await ts.command(
        "preservar separador protegido",
        `channeledit cid=${protectedThinSeparatorCid} channel_order=${Number(topLine?.channel_order || 0)}`
      );
    }

    const roomCids = [...room.channels.map((channel) => channel.cid), room.teamspeak.parentCid, room.teamspeak.topLineCid];
    for (const cid of roomCids) {
      if (channels.some((channel) => Number(channel.cid) === Number(cid))) {
        await ts.command("apagar canal da sala", `channeldelete cid=${Number(cid)} force=1`);
      }
    }
    store.markRoomInactive(room.id);
  });
}

async function auditAction(request, session, action, target, work) {
  try {
    const result = await work();
    store.audit({ databaseId: session?.database_id, nickname: session?.nickname, ip: getRequestIp(request), action, target, success: true });
    return result;
  } catch (error) {
    store.audit({ databaseId: session?.database_id, nickname: session?.nickname, ip: getRequestIp(request), action, target, success: false, details: { status: error.status, message: error.message } });
    throw error;
  }
}

async function authenticationStatus(request) {
  const session = resolveSession(request);
  if (!session) {
    let candidates = [];
    let teamSpeakOnline = true;
    try {
      candidates = await withTeamSpeak((ts) => getAuthenticationCandidates(ts, request));
    } catch {
      teamSpeakOnline = false;
    }
    return { authenticated: false, teamSpeakOnline, candidates: candidates.map(publicUser) };
  }

  let connected = false;
  let teamSpeakOnline = true;
  try {
    await withTeamSpeak(async (ts) => {
      await getSessionClient(ts, session);
      await reconcileRooms(ts);
      connected = true;
    });
  } catch (error) {
    teamSpeakOnline = Number(error.status) === 403;
    connected = false;
  }
  const activeRoom = store.getActiveRoomByCreator(session.database_id);
  return {
    authenticated: true,
    teamSpeakOnline,
    connected,
    csrfToken: session.csrfToken,
    user: publicUser(session),
    activeRoom: serializeRoom(activeRoom)
  };
}

async function handleApi(request, response, pathname) {
  try {
    assertRequestAllowed(request, pathname);

    if (pathname === "/api/auth/status" && request.method === "GET") {
      sendJson(response, 200, { ok: true, ...(await authenticationStatus(request)) });
      return;
    }

    if (pathname === "/api/auth/challenge" && request.method === "POST") {
      const payload = await readBody(request);
      const challenge = await auditAction(request, null, "auth.challenge", null, () => startAuthChallenge(request, payload));
      sendJson(response, 201, { ok: true, ...challenge });
      return;
    }

    if (pathname === "/api/auth/verify" && request.method === "POST") {
      const payload = await readBody(request);
      const result = await auditAction(request, null, "auth.verify", payload.challengeId, () => verifyAuthChallenge(request, payload));
      sendJson(response, 200, { ok: true, authenticated: true, csrfToken: result.csrfToken, user: result.user }, {
        "Set-Cookie": sessionCookie(result.token)
      });
      return;
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      const session = requireSession(request, true);
      store.revokeSession(session.tokenHash);
      store.audit({ databaseId: session.database_id, nickname: session.nickname, ip: getRequestIp(request), action: "auth.logout", success: true });
      sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
      return;
    }

    const iconMatch = pathname.match(/^\/api\/icons\/(-?\d+)$/);
    if (iconMatch && request.method === "GET") {
      requireSession(request);
      const iconid = Number(iconMatch[1]);
      if (!allowedIconIds.size) await withTeamSpeak((ts) => getServerGroupCategories(ts));
      if (!allowedIconIds.has(iconid)) throw new HttpError(404, "Ícone não encontrado.");
      const buffer = await getIconBuffer(iconid);
      response.writeHead(200, { ...securityHeaders(), "Content-Type": detectImageMime(buffer), "Cache-Control": "private, max-age=604800" });
      response.end(buffer);
      return;
    }

    if (pathname === "/api/groups" && request.method === "GET") {
      const session = requireSession(request);
      const payload = await withTeamSpeak(async (ts) => {
        const creator = await getSessionClient(ts, session, true);
        const categories = await getServerGroupCategories(ts);
        return { categories, selected: getSelectedGroups(categories, creator.serverGroups) };
      });
      sendJson(response, 200, { ok: true, ...payload });
      return;
    }

    if (pathname === "/api/groups" && request.method === "POST") {
      const session = requireSession(request, true);
      const body = await readBody(request);
      const payload = await auditAction(request, session, "groups.update", null, () => updateUserGroups(body, session));
      sendJson(response, 200, { ok: true, ...payload });
      return;
    }

    if (pathname === "/api/rooms" && request.method === "POST") {
      const session = requireSession(request, true);
      const body = await readBody(request);
      const room = await auditAction(request, session, "room.create", null, () => createRoom(body, session));
      sendJson(response, 201, { ok: true, room });
      return;
    }

    if (pathname === "/api/rooms" && request.method === "PATCH") {
      const session = requireSession(request, true);
      const body = await readBody(request);
      const room = await auditAction(request, session, "room.update", body.id, () => updateRoom(body, session));
      sendJson(response, 200, { ok: true, room });
      return;
    }

    if (pathname === "/api/rooms" && request.method === "DELETE") {
      const session = requireSession(request, true);
      const body = await readBody(request);
      await auditAction(request, session, "room.delete", body.id, () => deleteRoom(body, session));
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Rota não encontrada." });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    sendJson(response, status, {
      ok: false,
      error: status >= 500 ? "Não foi possível concluir o pedido no TeamSpeak." : error.message,
      ...(error.details || {})
    });
  }
}

function serveStatic(response, pathname) {
  const publicFiles = new Set([
    "index.html", "styles.css", "theme.js", "app.js",
    "vendor/react.production.min.js", "vendor/react-dom.production.min.js",
    "assets/background-light.png", "assets/background-dark.png"
  ]);
  const safePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!publicFiles.has(safePath)) {
    response.writeHead(404, securityHeaders());
    response.end("Not found");
    return;
  }
  fs.readFile(path.join(root, safePath), (error, data) => {
    if (error) {
      response.writeHead(404, securityHeaders());
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": mimeTypes[path.extname(safePath)] || "application/octet-stream",
      "Cache-Control": safePath === "index.html" ? "no-store" : "public, max-age=3600"
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    sendJson(response, 400, { ok: false, error: "Pedido inválido." });
    return;
  }
  let pathname = url.pathname;
  if (appBasePath && pathname === appBasePath) {
    response.writeHead(308, { ...securityHeaders(), Location: `${appBasePath}/` });
    response.end();
    return;
  }
  if (appBasePath && pathname.startsWith(`${appBasePath}/`)) {
    pathname = pathname.slice(appBasePath.length) || "/";
  }
  if (pathname.startsWith("/api/")) {
    handleApi(request, response, pathname);
  } else {
    serveStatic(response, pathname);
  }
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 60;
async function start() {
  store = await DataStore.open(dataDir);
  server.listen(port, "127.0.0.1", () => {
    console.log(`LegendZ server listening at http://127.0.0.1:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

const cleanupTimer = setInterval(() => store.cleanup(), 60 * 60 * 1000);
cleanupTimer.unref();

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => {
    teamSpeak.close();
    if (store) store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
