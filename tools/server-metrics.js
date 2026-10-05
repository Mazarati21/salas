function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function publicServerMetrics(serverInfo = {}) {
  const clientsOnline = nonNegativeInteger(serverInfo.virtualserver_clientsonline);
  const queryClientsOnline = nonNegativeInteger(serverInfo.virtualserver_queryclientsonline);

  return {
    slotsUsed: Math.max(0, clientsOnline - queryClientsOnline),
    slotsTotal: nonNegativeInteger(serverInfo.virtualserver_maxclients),
    uptimeSeconds: nonNegativeInteger(serverInfo.virtualserver_uptime),
    bytesDownloaded: nonNegativeInteger(serverInfo.virtualserver_total_bytes_downloaded),
    bytesUploaded: nonNegativeInteger(serverInfo.virtualserver_total_bytes_uploaded)
  };
}

module.exports = { publicServerMetrics };
