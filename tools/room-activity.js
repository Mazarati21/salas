function observedRoomActivityAt(room, channelStateById, now = Date.now()) {
  const emptySeconds = (room.channels || [])
    .map((channel) => Number(channelStateById.get(Number(channel.cid))?.seconds_empty))
    .filter(Number.isFinite);
  if (!emptySeconds.length) return null;
  const mostRecentEmptySeconds = Math.min(...emptySeconds);
  const observedAt = mostRecentEmptySeconds <= 0 ? now : now - (mostRecentEmptySeconds * 1000);
  return Math.max(Number(room.lastActivityAt || room.createdAt || 0), observedAt);
}

function isRoomExpired(lastActivityAt, now, inactivityMs) {
  return Number(lastActivityAt) <= Number(now) - Number(inactivityMs);
}

module.exports = { isRoomExpired, observedRoomActivityAt };
