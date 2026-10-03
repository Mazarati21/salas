const net = require("net");

const host = process.env.TS_HOST;
const queryPort = Number(process.env.TS_QUERY_PORT || 10011);
const voicePort = process.env.TS_VOICE_PORT;
const user = process.env.TS_USER;
const pass = process.env.TS_PASS;
const spacer = process.env.TS_SPACER || "[cspacer212]═════════════════════";

if (!host || !voicePort || !user || !pass) {
  console.error("Missing TS_HOST, TS_VOICE_PORT, TS_USER or TS_PASS.");
  process.exit(1);
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

const commands = [
  ["login", `login client_login_name=${tsEscape(user)} client_login_password=${tsEscape(pass)}`],
  ["use virtual server", `use port=${voicePort}`],
  ["whoami", "whoami"],
  ["find temporary spacer", `channelfind pattern=${tsEscape(spacer)}`],
  ["quit", "quit"],
];

let commandIndex = 0;
let buffer = "";
let finished = false;

const socket = net.createConnection({ host, port: queryPort });
socket.setEncoding("utf8");

function scrub(text) {
  return text.split(pass).join("***");
}

function sendNext() {
  if (commandIndex >= commands.length) {
    finished = true;
    socket.end();
    return;
  }
  const [label, command] = commands[commandIndex++];
  console.log(`> ${label}`);
  socket.write(`${command}\n`);
}

function handleResponse(response) {
  const clean = scrub(response).trim();
  if (clean) console.log(clean);
  if (!response.includes("error id=0")) {
    finished = true;
    socket.end();
    process.exitCode = 1;
    return;
  }
  sendNext();
}

socket.on("connect", () => {
  console.log(`connected ${host}:${queryPort}`);
});

socket.on("data", (chunk) => {
  buffer += chunk;

  if (buffer.includes("Welcome to the TeamSpeak")) {
    buffer = "";
    sendNext();
    return;
  }

  while (buffer.includes("error id=")) {
    const pos = buffer.indexOf("error id=");
    const end = buffer.indexOf("\n", pos);
    if (end === -1) break;
    const response = buffer.slice(0, end + 1);
    buffer = buffer.slice(end + 1);
    handleResponse(response);
    if (finished) break;
  }
});

socket.on("error", (error) => {
  console.error(`ERR ${error.message}`);
  process.exitCode = 1;
});

socket.on("close", () => {
  console.log("closed");
});

setTimeout(() => {
  if (!finished) {
    console.error("TIMEOUT");
    socket.end();
    process.exitCode = 1;
  }
}, 12000);
