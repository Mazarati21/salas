function numeric(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function stripSpacerMarker(value) {
  return String(value || "").replace(/^\[(?:\*?c?spacer)[^\]]*\]/i, "").trim();
}

function isRoomTitle(channel) {
  return /^\[cspacer[^\]]+\]/i.test(String(channel?.channel_name || ""))
    && Boolean(stripSpacerMarker(channel.channel_name));
}

function isDivider(channel) {
  const visible = stripSpacerMarker(channel?.channel_name);
  return /^[━▂═─_]+$/u.test(visible);
}

function orderedSiblings(channels, parentId) {
  const siblings = channels.filter((channel) => Number(channel.pid) === Number(parentId));
  const byPrevious = new Map();
  siblings.forEach((channel) => byPrevious.set(Number(channel.channel_order || 0), channel));
  const ordered = [];
  const seen = new Set();
  let previous = 0;
  while (byPrevious.has(previous)) {
    const channel = byPrevious.get(previous);
    const cid = numeric(channel.cid);
    if (!cid || seen.has(cid)) break;
    ordered.push(channel);
    seen.add(cid);
    previous = cid;
  }
  return ordered.length === siblings.length ? ordered : siblings.slice().sort((left, right) => numeric(left.cid) - numeric(right.cid));
}

function channelName(channel, fallback) {
  const clean = String(channel?.channel_name || "")
    .replace(/^[●•]+\s*/u, "")
    .replace(/[\[\]\r\n\t]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...(clean || fallback)].slice(0, 28).join("");
}

function findOwner(parentCid, children, assignments, channelAdminGroupId) {
  const relevant = assignments.filter((entry) => Number(entry.cgid) === Number(channelAdminGroupId));
  const ownersAt = (cid) => new Set(relevant
    .filter((entry) => Number(entry.cid) === Number(cid))
    .map((entry) => numeric(entry.cldbid))
    .filter(Boolean));
  const parentOwners = [...ownersAt(parentCid)];
  if (parentOwners.length === 1) return parentOwners[0];
  if (!children.length) return 0;
  const common = [...ownersAt(children[0].cid)].filter((databaseId) => (
    children.every((child) => ownersAt(child.cid).has(databaseId))
  ));
  return common.length === 1 ? common[0] : 0;
}

function discoverLegacyRooms({
  channels = [], assignments = [], trackedParentCids = [],
  protectedSeparatorCid, channelAdminGroupId
}) {
  const roots = orderedSiblings(channels, 0);
  const separatorIndex = roots.findIndex((channel) => numeric(channel.cid) === Number(protectedSeparatorCid));
  if (separatorIndex < 0) return { candidates: [], skipped: [{ reason: "protected-separator-missing" }] };

  const tracked = new Set(trackedParentCids.map(Number));
  const candidates = [];
  const skipped = [];
  let cursor = separatorIndex - 1;
  while (cursor >= 1) {
    const parent = roots[cursor];
    const divider = roots[cursor - 1];
    if (!isRoomTitle(parent) || !isDivider(divider)) break;

    const parentCid = numeric(parent.cid);
    const children = orderedSiblings(channels, parentCid);
    if (children.length < 1 || children.length > 4) {
      skipped.push({ parentCid, reason: "invalid-subchannel-count" });
      cursor -= 2;
      continue;
    }
    if (tracked.has(parentCid)) {
      skipped.push({ parentCid, reason: "already-tracked" });
      cursor -= 2;
      continue;
    }

    const ownerDatabaseId = findOwner(parentCid, children, assignments, channelAdminGroupId);
    if (!ownerDatabaseId) {
      skipped.push({ parentCid, reason: "owner-not-unique" });
      cursor -= 2;
      continue;
    }
    const ownerEntry = assignments.find((entry) => (
      Number(entry.cgid) === Number(channelAdminGroupId)
      && Number(entry.cldbid) === ownerDatabaseId
      && (Number(entry.cid) === parentCid || children.some((child) => Number(child.cid) === Number(entry.cid)))
    ));
    candidates.push({
      ownerDatabaseId,
      ownerNickname: String(ownerEntry?.client_nickname || "Utilizador").trim().slice(0, 80) || "Utilizador",
      title: [...stripSpacerMarker(parent.channel_name)].slice(0, 27).join(""),
      teamspeak: {
        topLineCid: numeric(divider.cid),
        parentCid,
        bottomLineCid: Number(protectedSeparatorCid)
      },
      channels: children.map((child, index) => ({
        cid: numeric(child.cid),
        name: channelName(child, `Convivio ${index + 1}`),
        passwordProtected: String(child.channel_flag_password || "0") === "1"
      }))
    });
    cursor -= 2;
  }
  return { candidates, skipped };
}

module.exports = { discoverLegacyRooms, orderedSiblings, stripSpacerMarker };
