const { TeamSpeakQuery, parseItems, tsEscape } = require("./teamspeak-query");

const title = process.env.TS_ROOM_TITLE || `Teste Codex ${new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
const spacerCid = Number(process.env.TS_TEMP_SPACER_CID || 902);
const passwords = ["teste1", "teste2", "teste3", "teste4"];

function randomId() {
  return Math.random().toString(16).slice(2, 10);
}

async function getChannel(ts, cid) {
  const channels = parseItems(await ts.command("channellist", "channellist"));
  const channel = channels.find((item) => Number(item.cid) === Number(cid));
  if (!channel) throw new Error(`Channel ${cid} not found.`);
  return channel;
}

async function createChannel(ts, label, props) {
  const command = Object.entries(props)
    .map(([key, value]) => `${key}=${tsEscape(value)}`)
    .join(" ");
  const data = await ts.command(label, `channelcreate ${command}`);
  const created = parseItems(data)[0];
  if (!created?.cid) throw new Error(`${label}: missing cid in response ${data}`);
  return Number(created.cid);
}

(async () => {
  const ts = new TeamSpeakQuery();
  const created = [];

  try {
    await ts.login();
    const tempSpacer = await getChannel(ts, spacerCid);
    const previousRootCid = Number(tempSpacer.channel_order || 0);

    const topLineCid = await createChannel(ts, "create top separator", {
      channel_name: `[*spacer${randomId()}]▂▂▂▂`,
      channel_flag_permanent: 1,
      channel_order: previousRootCid
    });
    created.push(topLineCid);

    const parentCid = await createChannel(ts, "create parent room", {
      channel_name: `[cspacer${randomId()}]${title}`,
      channel_flag_permanent: 1,
      channel_order: topLineCid
    });
    created.push(parentCid);

    let previousSubCid = 0;
    for (let index = 0; index < 4; index += 1) {
      const cid = await createChannel(ts, `create Convivio ${index + 1}`, {
        channel_name: `● Convivio ${index + 1}`,
        channel_flag_permanent: 1,
        cpid: parentCid,
        channel_order: previousSubCid,
        channel_password: passwords[index]
      });
      created.push(cid);
      previousSubCid = cid;
    }

    const bottomLineCid = await createChannel(ts, "create bottom separator", {
      channel_name: `[*spacer${randomId()}]━`,
      channel_flag_permanent: 1,
      channel_order: parentCid
    });
    created.push(bottomLineCid);

    console.log(JSON.stringify({
      title,
      created,
      topLineCid,
      parentCid,
      subchannels: created.slice(2, 6),
      bottomLineCid,
      insertedAboveCid: spacerCid
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(`Created before failure: ${created.join(", ") || "none"}`);
    process.exitCode = 1;
  } finally {
    await ts.command("quit", "quit").catch(() => {});
    ts.close();
  }
})();
