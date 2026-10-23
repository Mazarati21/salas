function diagnosticCheck(id, label, status, detail) {
  const safeStatus = ["pass", "warn", "fail"].includes(status) ? status : "fail";
  return { id: String(id), label: String(label), status: safeStatus, detail: String(detail || "") };
}

function summarizeDiagnostics(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, total: checks.length, overall: "pass" };
  for (const check of checks) summary[check.status] += 1;
  if (summary.fail) summary.overall = "fail";
  else if (summary.warn) summary.overall = "warn";
  return summary;
}

function evaluateTeamSpeakStructure({ channels = [], groups = [], channelGroups = [], roomChannelIds = [], config = {} }) {
  const channelIds = new Set(channels.map((channel) => Number(channel.cid)));
  const groupIds = new Set(groups.map((group) => Number(group.sgid)));
  const channelGroupIds = new Set(channelGroups.map((group) => Number(group.cgid)));
  const tempSpacer = channels.find((channel) => Number(channel.cid) === Number(config.tempSpacerCid));
  const thinSeparator = channels.find((channel) => Number(channel.cid) === Number(config.protectedThinSeparatorCid));
  const missingRoomChannels = roomChannelIds.map(Number).filter((cid) => !channelIds.has(cid));
  const missingAdminGroups = (config.adminGroupIds || []).map(Number).filter((sgid) => !groupIds.has(sgid));
  const missingFounderGroups = (config.founderGroupIds || []).map(Number).filter((sgid) => !groupIds.has(sgid));

  return [
    diagnosticCheck("temp-spacer", "Área de salas temporárias", tempSpacer ? "pass" : "fail", tempSpacer ? `Canal ${tempSpacer.cid} encontrado.` : `O canal configurado (${config.tempSpacerCid}) não existe.`),
    diagnosticCheck("protected-separator", "Separador protegido", !thinSeparator ? "fail" : thinSeparator.channel_name === config.protectedThinSeparatorName ? "pass" : "warn", !thinSeparator ? `O canal ${config.protectedThinSeparatorCid} não existe.` : thinSeparator.channel_name === config.protectedThinSeparatorName ? "Canal e nome estão corretos." : "O canal existe, mas o nome não corresponde à configuração."),
    diagnosticCheck("separator-order", "Posição das salas temporárias", !tempSpacer || !thinSeparator ? "fail" : Number(tempSpacer.channel_order) === Number(thinSeparator.cid) ? "pass" : "warn", !tempSpacer || !thinSeparator ? "Não foi possível validar a ordem sem os dois separadores." : Number(tempSpacer.channel_order) === Number(thinSeparator.cid) ? "O separador protegido está imediatamente acima das salas temporárias." : "O separador existe, mas não está imediatamente acima das salas temporárias."),
    diagnosticCheck("channel-admin-group", "Grupo Channel Admin", channelGroupIds.has(Number(config.channelAdminGroupId)) ? "pass" : "fail", channelGroupIds.has(Number(config.channelAdminGroupId)) ? `Grupo de canal ${config.channelAdminGroupId} disponível.` : `O grupo de canal ${config.channelAdminGroupId} não existe.`),
    diagnosticCheck("admin-groups", "Grupos administrativos", missingAdminGroups.length ? "warn" : "pass", missingAdminGroups.length ? `IDs não encontrados: ${missingAdminGroups.join(", ")}.` : "Todos os grupos administrativos configurados existem."),
    diagnosticCheck("founder-groups", "Grupo Fundador", missingFounderGroups.length ? "fail" : "pass", missingFounderGroups.length ? `IDs não encontrados: ${missingFounderGroups.join(", ")}.` : "Todos os grupos Fundador configurados existem."),
    diagnosticCheck("room-sync", "Sincronização das salas", missingRoomChannels.length ? "warn" : "pass", missingRoomChannels.length ? `${missingRoomChannels.length} canais registados não foram encontrados no TeamSpeak.` : "Todos os canais registados estão presentes.")
  ];
}

module.exports = { diagnosticCheck, evaluateTeamSpeakStructure, summarizeDiagnostics };
