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

function expiryWarning(lastActivityAt, now, inactivityMs, warningMask = 0) {
  const remainingMs = Number(lastActivityAt) + Number(inactivityMs) - Number(now);
  if (remainingMs <= 0) return null;
  const day = 86_400_000;
  const thresholds = [
    { days: 1, bit: 4, cumulativeMask: 7 },
    { days: 3, bit: 2, cumulativeMask: 3 },
    { days: 7, bit: 1, cumulativeMask: 1 }
  ];
  const warning = thresholds.find((threshold) => remainingMs <= threshold.days * day && !(Number(warningMask) & threshold.bit));
  return warning ? { ...warning, remainingMs, expiresAt: Number(lastActivityAt) + Number(inactivityMs) } : null;
}

module.exports = { expiryWarning, isRoomExpired, observedRoomActivityAt };
