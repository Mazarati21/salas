const { TeamSpeakQuery, parseItems, tsEscape } = require("./teamspeak-query");

const spacerName = process.env.TS_SPACER || "[cspacer212]═════════════════════";

(async () => {
  const ts = new TeamSpeakQuery();
  try {
    await ts.login();
    const found = parseItems(await ts.command("channelfind", `channelfind pattern=${tsEscape(spacerName)}`));
    const spacer = found[0];
    if (!spacer) throw new Error("Temporary spacer not found.");

    const channels = parseItems(await ts.command("channellist", "channellist"));
    const rootChannels = channels
      .filter((channel) => channel.pid === "0")
      .map((channel) => ({
        cid: Number(channel.cid),
        pid: Number(channel.pid),
        order: Number(channel.channel_order),
        name: channel.channel_name
      }));

    const ordered = [];
    const seen = new Set();
    let previous = 0;
    while (ordered.length < rootChannels.length) {
      const next = rootChannels.find((channel) => channel.order === previous && !seen.has(channel.cid));
      if (!next) break;
      ordered.push(next);
      seen.add(next.cid);
      previous = next.cid;
    }

    const idx = ordered.findIndex((channel) => channel.cid === Number(spacer.cid));
    const childChannels = channels
      .filter((channel) => Number(channel.pid) !== 0)
      .map((channel) => ({
        cid: Number(channel.cid),
        pid: Number(channel.pid),
        order: Number(channel.channel_order),
        name: channel.channel_name
      }));

    console.log(JSON.stringify({
      spacer,
      nearbyRootChannels: ordered.slice(Math.max(0, idx - 8), idx + 8),
      nearbyChildren: childChannels.filter((channel) => (
        ordered.slice(Math.max(0, idx - 8), idx + 8).some((root) => root.cid === channel.pid)
      ))
    }, null, 2));
  } finally {
    await ts.command("quit", "quit").catch(() => {});
    ts.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
