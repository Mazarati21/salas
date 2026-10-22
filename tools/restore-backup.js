const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

async function main() {
  const root = path.resolve(__dirname, "..");
  const backupsDir = path.join(root, "data", "backups");
  const input = String(process.argv[2] || "");
  const requested = path.basename(input);
  if (input !== requested || !/^legendz-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.sqlite$/.test(requested)) {
    throw new Error("Indica um backup válido: npm run restore-backup -- legendz-AAAA-MM-DD[-HHMMSS].sqlite");
  }
  const source = path.join(backupsDir, requested);
  if (!fs.existsSync(source)) throw new Error(`Backup não encontrado: ${requested}`);

  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const candidate = new SQL.Database(fs.readFileSync(source));
  const check = candidate.exec("PRAGMA integrity_check");
  candidate.close();
  if (check[0]?.values?.[0]?.[0] !== "ok") throw new Error("O backup falhou a verificação de integridade.");

  const destination = path.join(root, "data", "legendz.sqlite");
  const safetyCopy = `${destination}.before-restore-${Date.now()}`;
  const temporary = `${destination}.${process.pid}.restore`;
  if (fs.existsSync(destination)) fs.copyFileSync(destination, safetyCopy);
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, destination);
  console.log(`Restauro concluído a partir de ${requested}. Reinicia a aplicação antes de a utilizar.`);
  if (fs.existsSync(safetyCopy)) console.log(`Cópia anterior preservada em ${path.basename(safetyCopy)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
