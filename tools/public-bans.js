"use strict";

function cleanPublicText(value, fallback, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function publicBanKey(ban) {
  return [ban.name, ban.staff, ban.reason, ban.createdAt, ban.duration]
    .map((value) => String(value).toLocaleLowerCase("pt-PT"))
    .join("\u0000");
}

function normalizePublicBans(items, nowSeconds = Math.floor(Date.now() / 1000)) {
  const unique = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const createdAt = Math.max(0, Number(item.created) || 0);
    const duration = Math.max(0, Number(item.duration) || 0);
    const expiresAt = duration > 0 ? createdAt + duration : null;
    const ban = {
      id: Math.max(0, Number(item.banid) || 0),
      name: cleanPublicText(item.lastnickname, "Sem nome", 80),
      staff: cleanPublicText(item.invokername, "Servidor", 80),
      reason: cleanPublicText(item.reason, "Sem razão indicada", 180),
      createdAt,
      duration,
      expiresAt,
      permanent: duration === 0,
      technicalRecords: 1
    };

    if (!ban.permanent && ban.expiresAt <= nowSeconds) continue;
    const key = publicBanKey(ban);
    const existing = unique.get(key);
    if (existing) {
      existing.technicalRecords += 1;
      if (ban.id > existing.id) existing.id = ban.id;
    } else {
      unique.set(key, ban);
    }
  }

  return [...unique.values()].sort((left, right) => right.createdAt - left.createdAt || right.id - left.id);
}

module.exports = { cleanPublicText, normalizePublicBans, publicBanKey };
