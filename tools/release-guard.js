const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const results = [];
const requiredFiles = ["app.jsx", "app.js", "index.html", "server.js", "styles.css", "package-lock.json", ".cpanel.yml", "public/legendz.css", "public/legendz.js"];
function add(label, pass, detail) { results.push({ label, pass, detail }); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
add("Ficheiros de produção", missing.length === 0, missing.length ? `Em falta: ${missing.join(", ")}` : `${requiredFiles.length} ficheiros presentes`);

if (!missing.includes("app.jsx") && !missing.includes("app.js")) {
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "app.jsx"))).digest("hex");
  const bundleHash = read("app.js").match(/^\/\* LegendZ source:([a-f0-9]{64}) \*\//)?.[1];
  add("Bundle React atualizado", bundleHash === sourceHash, bundleHash ? `Hash ${sourceHash.slice(0, 12)}` : "O bundle não contém a assinatura da origem");
}

const syntaxFiles = ["server.js", "tools/data-store.js", "tools/teamspeak-query.js", "tools/diagnostics.js", "tools/restore-backup.js"];
for (const file of syntaxFiles) {
  try { execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "ignore" }); add(`Sintaxe ${file}`, true, "Válida"); }
  catch { add(`Sintaxe ${file}`, false, "Node.js rejeitou o ficheiro"); }
}

const index = read("index.html");
const appVersion = index.match(/app\.js\?v=(\d+)/)?.[1];
const styleVersion = index.match(/styles\.css\?v=(\d+)/)?.[1];
add("Versões do painel", Boolean(appVersion && styleVersion), appVersion && styleVersion ? `JS v${appVersion} · CSS v${styleVersion}` : "Versões de cache ausentes");

const serverSource = read("server.js");
const appSource = read("app.jsx");
add("Contrato do diagnóstico", serverSource.includes('["/api/admin/diagnostics", ["POST"]]') && serverSource.includes("requireFounder(ts, session)") && appSource.includes('api("/api/admin/diagnostics", { method: "POST"'), "Endpoint POST, validação Fundador e cliente React presentes");

const publicPages = ["homepage/index.html", "status/index.html", "bans/index.html"].map(read);
const publicJsVersions = new Set(publicPages.map((content) => content.match(/legendz\.js\?v=(\d+)/)?.[1]));
const publicCssVersions = new Set(publicPages.map((content) => content.match(/legendz\.css\?v=(\d+)/)?.[1]));
add("Versões públicas sincronizadas", publicJsVersions.size === 1 && publicCssVersions.size === 1 && !publicJsVersions.has(undefined) && !publicCssVersions.has(undefined), `JS ${[...publicJsVersions].join("/")} · CSS ${[...publicCssVersions].join("/")}`);

const deployment = read(".cpanel.yml");
const guardAt = deployment.indexOf("npm run release:verify");
const firstCopyAt = deployment.indexOf("/bin/cp -f");
add("Bloqueio antes da publicação", guardAt >= 0 && firstCopyAt >= 0 && guardAt < firstCopyAt, "O cPanel valida a release antes da primeira cópia");

let tracked = "";
try { tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }); } catch {}
add("Segredos fora do Git", !tracked.split(/\r?\n/).some((file) => /(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example"), "Nenhum ficheiro .env está versionado");

for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.label} — ${result.detail}`);
const failures = results.filter((result) => !result.pass);
console.log(`\nRelease guard: ${results.length - failures.length}/${results.length} verificações aprovadas.`);
if (failures.length) process.exit(1);
