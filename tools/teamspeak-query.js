const net = require("net");

const host = process.env.TS_HOST;
const queryPort = Number(process.env.TS_QUERY_PORT || 10011);
const voicePort = process.env.TS_VOICE_PORT;
const user = process.env.TS_USER;
const pass = process.env.TS_PASS;
const quiet = process.env.TS_QUIET === "1";

function assertConfiguration() {
  if (!host || !voicePort || !user || !pass) {
    throw new Error("Faltam TS_HOST, TS_VOICE_PORT, TS_USER ou TS_PASS.");
  }
}

function tsEscape(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\//g, "\\/")
    .replace(/ /g, "\\s")
    .replace(/\|/g, "\\p")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function tsUnescape(value) {
  return String(value)
    .replace(/\\s/g, " ")
    .replace(/\\p/g, "|")
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function parseItems(payload) {
  if (!payload.trim()) return [];
  return payload.trim().split("|").map((item) => {
    const fields = {};
    item.split(" ").forEach((part) => {
      const [key, ...rest] = part.split("=");
      if (key) fields[key] = tsUnescape(rest.join("="));
    });
    return fields;
  });
}

class TeamSpeakQuery {
  constructor() {
    assertConfiguration();
    this.buffer = "";
    this.queue = [];
    this.closed = false;
    this.authenticated = false;
    this.socket = net.createConnection({ host, port: queryPort });
    this.socket.setEncoding("utf8");
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.socket.on("connect", () => {
      if (!quiet) console.log(`ServerQuery ligado a ${host}:${queryPort}`);
    });
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => this.fail(new Error("Ligação ServerQuery terminada.")));
    this.socket.setTimeout(15_000, () => {
      this.socket.destroy(new Error("Timeout na ligação ao TeamSpeak."));
    });
  }

  isUsable() {
    return !this.closed && !this.socket.destroyed && this.authenticated;
  }

  handleData(chunk) {
    this.buffer += chunk;
    if (this.resolveReady && this.buffer.includes("Welcome to the TeamSpeak")) {
      const welcomeEnd = this.buffer.indexOf("\n", this.buffer.indexOf("Welcome to the TeamSpeak"));
      this.buffer = welcomeEnd >= 0 ? this.buffer.slice(welcomeEnd + 1) : "";
      this.resolveReady();
      this.resolveReady = null;
      this.rejectReady = null;
    }

    while (this.buffer.includes("error id=") && this.queue.length) {
      const pos = this.buffer.indexOf("error id=");
      const end = this.buffer.indexOf("\n", pos);
      if (end === -1) return;
      const response = this.buffer.slice(0, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      const current = this.queue.shift();
      clearTimeout(current.timer);
      const errorLine = response.slice(pos).trim();
      const data = response.slice(0, pos).trim();
      if (!errorLine.includes("error id=0")) {
        current.reject(new Error(`${current.label}: ${errorLine}`));
      } else {
        current.resolve(data);
      }
    }
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.authenticated = false;
    if (this.rejectReady) this.rejectReady(error);
    this.resolveReady = null;
    this.rejectReady = null;
    while (this.queue.length) {
      const current = this.queue.shift();
      clearTimeout(current.timer);
      current.reject(error);
    }
  }

  async command(label, command) {
    if (this.closed) throw new Error("A ligação ServerQuery não está disponível.");
    await this.ready;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy(new Error(`${label}: timeout do ServerQuery.`));
      }, 12_000);
      this.queue.push({ label, resolve, reject, timer });
      this.socket.write(`${command}\n`);
    });
  }

  async login() {
    await this.command("login", `login client_login_name=${tsEscape(user)} client_login_password=${tsEscape(pass)}`);
    await this.command("use", `use port=${voicePort}`);
    // The connection timeout protects login only. Persistent Query connections
    // are kept alive by TeamSpeakService and must not die while briefly idle.
    this.socket.setTimeout(0);
    this.authenticated = true;
  }

  close() {
    this.closed = true;
    this.authenticated = false;
    this.socket.destroy();
  }
}

class TeamSpeakService {
  constructor() {
    assertConfiguration();
    this.client = null;
    this.operationQueue = Promise.resolve();
    this.keepAlive = setInterval(() => {
      if (!this.client?.isUsable()) return;
      this.run((ts) => ts.command("keepalive", "whoami")).catch(() => {});
    }, 180_000);
    this.keepAlive.unref();
  }

  async getClient() {
    if (this.client?.isUsable()) return this.client;
    this.client?.close();
    const client = new TeamSpeakQuery();
    this.client = client;
    try {
      await client.login();
      return client;
    } catch (error) {
      client.close();
      if (this.client === client) this.client = null;
      throw error;
    }
  }

  run(work) {
    const execute = async () => {
      const client = await this.getClient();
      try {
        return await work(client);
      } catch (error) {
        if (!client.isUsable()) {
          client.close();
          if (this.client === client) this.client = null;
        }
        throw error;
      }
    };
    const next = this.operationQueue.then(execute, execute);
    this.operationQueue = next.catch(() => {});
    return next;
  }

  close() {
    clearInterval(this.keepAlive);
    this.client?.close();
    this.client = null;
  }
}

module.exports = { TeamSpeakService, parseItems, tsEscape };
