function hasAdminGroup(serverGroups, adminGroupIds) {
  const allowed = adminGroupIds instanceof Set ? adminGroupIds : new Set(adminGroupIds || []);
  return (serverGroups || []).some((groupId) => allowed.has(Number(groupId)));
}

function maskIp(value) {
  const rawIp = String(value || "").trim();
  const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
  if (!ip) return "Indisponível";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.*` : "IPv4 protegida";
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return `${parts.slice(0, 2).join(":") || "IPv6"}:*`;
  }
  return "Endereço protegido";
}

function sanitizeRateBucket(bucket) {
  const [kind, ...addressParts] = String(bucket || "").split(":");
  return { kind: kind || "pedido", address: maskIp(addressParts.join(":")) };
}

module.exports = { hasAdminGroup, maskIp, sanitizeRateBucket };
