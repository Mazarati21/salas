function roomChannelIds(room) {
  return [
    ...(room?.channels || []).map((channel) => Number(channel.cid)),
    Number(room?.teamspeak?.parentCid),
    Number(room?.teamspeak?.topLineCid)
  ].filter((cid) => Number.isInteger(cid) && cid > 0);
}

function clientsInChannels(clients, channelIds) {
  const ids = channelIds instanceof Set ? channelIds : new Set(channelIds.map(Number));
  return (clients || []).filter((client) => ids.has(Number(client.cid)));
}

function findEvacuationChannel(channels, excludedChannelIds) {
  const excluded = excludedChannelIds instanceof Set
    ? excludedChannelIds
    : new Set(excludedChannelIds.map(Number));
  const channel = (channels || []).find((item) => (
    Number(item.channel_flag_default) === 1
    && Number.isInteger(Number(item.cid))
    && !excluded.has(Number(item.cid))
  ));
  return channel ? Number(channel.cid) : null;
}

module.exports = { clientsInChannels, findEvacuationChannel, roomChannelIds };
