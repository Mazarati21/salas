const { useEffect, useMemo, useState } = React;

const THEME_KEY = "legendz-theme";
const channelNames = ["Convivio 1", "Convivio 2", "Convivio 3", "Convivio 4"];
const appBasePath = (document.querySelector('meta[name="app-base-path"]')?.content || "").replace(/\/$/, "");
let csrfToken = "";

function nextDefaultChannelName(channels) {
  const usedNames = new Set(channels.map((channel) => String(channel.name || "").trim().toLocaleLowerCase("pt-PT")));
  return channelNames.find((name) => !usedNames.has(name.toLocaleLowerCase("pt-PT"))) || `Convivio ${channels.length + 1}`;
}

function normalizeRoom(room) {
  if (!room) return null;
  return { ...room, channels: (room.channels || []).slice(0, 4).map((channel, index) => {
    const fallbackName = channelNames[index];
    return { ...channel, name: channel.name || fallbackName, passwordProtected: Boolean(channel.passwordProtected) };
  }) };
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${appBasePath}${path}`, { credentials: "same-origin", ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "Não foi possível concluir o pedido.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function StatusPill({ auth }) {
  const available = auth.teamSpeakOnline && (!auth.authenticated || auth.connected);
  let title = "A verificar TeamSpeak";
  let detail = "A estabelecer ligação segura...";
  if (!auth.loading && !auth.teamSpeakOnline) { title = "TeamSpeak indisponível"; detail = "O servidor Query não respondeu."; }
  else if (!auth.loading && !auth.authenticated) { title = "Autenticação necessária"; detail = "Confirma a tua identidade através do TeamSpeak."; }
  else if (auth.authenticated && auth.connected) { title = `Ligado como ${auth.user?.nickname || "utilizador"}`; detail = auth.activeRoom ? "Sessão segura · 1 sala ativa" : "Sessão segura · pronto a utilizar"; }
  else if (auth.authenticated) { title = "TeamSpeak desligado"; detail = "Volta a ligar-te ao servidor para usar o painel."; }
  return <div className={`status-pill ${available ? "is-online" : "is-offline"}`}><span className="pulse" /><div><strong>{title}</strong><span>{detail}</span></div></div>;
}

function ThemeToggle({ theme, onToggle }) {
  return <button className="theme-toggle" type="button" onClick={onToggle} aria-label={`Ativar modo ${theme === "dark" ? "claro" : "escuro"}`}>{theme === "dark" ? "Modo claro" : "Modo escuro"}</button>;
}

function Message({ message }) {
  if (!message.text) return null;
  return <div className={`message is-${message.type}`} role={message.type === "error" ? "alert" : "status"} aria-live={message.type === "error" ? "assertive" : "polite"}>{message.text}</div>;
}

function profileInitials(nickname) {
  const words = String(nickname || "TS").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return Array.from(words[0] || "TS").slice(0, 2).join("").toUpperCase();
}

function ProfilePanel({ auth, room, sections, selections }) {
  const selectedGroups = useMemo(() => sections.flatMap((section) => {
    const selected = new Set((selections[section.key] || []).map(Number));
    return section.options.filter((option) => selected.has(Number(option.sgid)));
  }), [sections, selections]);
  const visibleGroups = selectedGroups.slice(0, 6);
  const hiddenCount = Math.max(0, selectedGroups.length - visibleGroups.length);
  const nickname = auth.user?.nickname || "Utilizador";

  return <section className="panel profile-panel" aria-labelledby="profile-title">
    <div className="profile-body">
      <div className="profile-identity">
        <span className="profile-avatar" aria-hidden="true">{profileInitials(nickname)}</span>
        <div className="profile-name"><p className="eyebrow">Perfil TeamSpeak</p><h2 id="profile-title">{nickname}</h2><span className={`profile-connection ${auth.connected ? "is-connected" : "is-disconnected"}`}>{auth.connected ? "Ligado ao servidor" : "Desligado do servidor"}</span></div>
      </div>
      <div className="profile-facts">
        <div><span>Grupos ativos</span><strong>{selectedGroups.length}</strong></div>
        <div><span>Sala permanente</span><strong title={room?.title || ""}>{room?.title || "Sem sala"}</strong></div>
      </div>
      <div className="profile-groups" aria-label="Grupos TeamSpeak ativos">
        {visibleGroups.map((group) => <span className="profile-group" key={group.sgid}>{group.iconUrl ? <img src={group.iconUrl} alt="" loading="lazy" /> : <span className="profile-group-fallback" aria-hidden="true">{group.name.slice(0, 1)}</span>}<span>{group.name}</span></span>)}
        {hiddenCount > 0 && <span className="profile-more">+{hiddenCount}</span>}
        {selectedGroups.length === 0 && <span className="profile-empty">Ainda não tens grupos selecionados.</span>}
      </div>
    </div>
  </section>;
}

function AuthPanel({ auth, onAuthenticated }) {
  const [candidateId, setCandidateId] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "neutral" });
  const candidates = auth.candidates || [];

  useEffect(() => { if (candidates.length === 1) setCandidateId(String(candidates[0].databaseId)); }, [auth.candidates]);

  async function requestCode() {
    setBusy(true); setMessage({ text: "A enviar um código privado no TeamSpeak...", type: "neutral" });
    try {
      const payload = await api("/api/auth/challenge", { method: "POST", body: JSON.stringify({ databaseId: Number(candidateId) || undefined }) });
      setChallenge(payload); setCode(""); setMessage({ text: `Código enviado para ${payload.nickname}.`, type: "success" });
    } catch (error) { setMessage({ text: error.message, type: "error" }); }
    finally { setBusy(false); }
  }

  async function verifyCode(event) {
    event.preventDefault(); setBusy(true); setMessage({ text: "A validar o código...", type: "neutral" });
    try {
      const payload = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, code }) });
      csrfToken = payload.csrfToken; await onAuthenticated();
    } catch (error) { setMessage({ text: error.message, type: "error" }); }
    finally { setBusy(false); }
  }

  return <section className="panel auth-panel">
    <div className="auth-copy"><p className="eyebrow">Acesso protegido</p><h2>Confirma que és tu no TeamSpeak</h2><p>Recebe um código por mensagem privada. Só utilizadores ligados ao servidor podem gerir grupos ou criar salas.</p><ol className="auth-steps"><li>Liga-te ao TeamSpeak.</li><li>Pede o código nesta página.</li><li>Introduz os 6 números recebidos.</li></ol></div>
    <div className="auth-action">
      {!challenge ? <>
        {candidates.length > 1 && <label className="field"><span>Utilizador TeamSpeak</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Selecionar utilizador</option>{candidates.map((candidate) => <option key={candidate.databaseId} value={candidate.databaseId}>{candidate.nickname}</option>)}</select></label>}
        {candidates.length === 1 && <div className="identity-box"><span>Utilizador detetado</span><strong>{candidates[0].nickname}</strong></div>}
        {candidates.length === 0 && <div className="identity-box is-warning"><span>Nenhum utilizador detetado</span><strong>Liga-te ao TeamSpeak e atualiza a página.</strong></div>}
        <button className="primary-button" type="button" onClick={requestCode} disabled={busy || !auth.teamSpeakOnline || candidates.length === 0 || (candidates.length > 1 && !candidateId)}>{busy ? "A enviar..." : "Enviar código no TeamSpeak"}</button>
      </> : <form className="code-form" onSubmit={verifyCode}><label className="field"><span>Código de acesso</span><input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required autoFocus /></label><button className="primary-button" disabled={busy || code.length !== 6}>{busy ? "A validar..." : "Entrar no painel"}</button><button className="text-button" type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(""); setMessage({ text: "", type: "neutral" }); }}>Pedir outro código</button></form>}
      <Message message={message} />
    </div>
  </section>;
}

function GroupsPanel({ sections, selections, setSelections, savedSelections, onApply, busy, message, enabled }) {
  const dirty = JSON.stringify(selections) !== JSON.stringify(savedSelections);
  function updateChoice(section, index, value) {
    const current = selections[section.key] || [];
    const nextValues = Array.from({ length: section.limit }, (_, itemIndex) => current[itemIndex] || "");
    nextValues[index] = value ? Number(value) : "";
    setSelections({ ...selections, [section.key]: nextValues.filter(Boolean) });
  }
  return <section className="panel groups-panel" aria-label="Grupos e ícones">
    <div className="panel-top"><div><p className="eyebrow">Perfil TeamSpeak</p><h2>Grupos e ícones</h2></div><span className="badge">{sections.length} categorias</span></div>
    <div className="group-grid">
      {!enabled && <div className="empty-groups"><strong>TeamSpeak desligado</strong><span>Volta a ligar-te para alterar os teus grupos.</span></div>}
      {enabled && sections.length === 0 && <div className="empty-groups"><strong>A carregar grupos</strong><span>As opções surgem quando o servidor responder.</span></div>}
      {sections.map((section) => <div className="group-card" key={section.key}><div className="group-heading"><strong>{section.title}</strong><span>Até {section.limit} {section.limit === 1 ? "escolha" : "escolhas"}</span></div>{Array.from({ length: section.limit }).map((_, index) => {
        const selected = selections[section.key] || [];
        const option = section.options.find((item) => Number(item.sgid) === Number(selected[index]));
        return <div className="group-choice" key={`${section.key}-${index}`}><span className="group-icon-slot">{option?.iconUrl ? <img src={option.iconUrl} alt="" loading="lazy" /> : <span className="icon-fallback">{section.title.slice(0, 1)}</span>}</span><select aria-label={`${section.title}, escolha ${index + 1}`} value={selected[index] || ""} onChange={(event) => updateChoice(section, index, event.target.value)} disabled={!enabled}><option value="">Sem escolha</option>{section.options.map((item) => <option key={item.sgid} value={item.sgid} disabled={selected.some((sgid, selectedIndex) => Number(sgid) === item.sgid && selectedIndex !== index)}>{item.name}</option>)}</select></div>;
      })}</div>)}
    </div>
    <div className="groups-actions"><button className="primary-button" type="button" disabled={!enabled || !dirty || busy || sections.length === 0} onClick={onApply}>{busy ? "A guardar..." : dirty ? "Guardar grupos" : "Grupos atualizados"}</button><Message message={message} /></div>
  </section>;
}

function CreatorPanel({ enabled, hasActiveRoom, onCreate, message, busy }) {
  const [title, setTitle] = useState("");
  const [channels, setChannels] = useState([{ name: channelNames[0], password: "" }]);
  function updateChannel(index, field, value) {
    setChannels(channels.map((channel, channelIndex) => channelIndex === index ? { ...channel, [field]: value } : channel));
  }
  function addChannel() {
    if (channels.length >= 4) return;
    setChannels([...channels, { name: nextDefaultChannelName(channels), password: "" }]);
  }
  function removeChannel(index) {
    if (channels.length <= 1) return;
    setChannels(channels.filter((_, channelIndex) => channelIndex !== index));
  }
  async function submit(event) {
    event.preventDefault();
    const created = await onCreate({ title: title.trim(), channels: channels.map((channel) => ({ name: channel.name.trim(), password: channel.password.trim() })) });
    if (created) { setTitle(""); setChannels([{ name: channelNames[0], password: "" }]); }
  }
  return <section className="panel creator-panel"><div className="panel-top split"><div><p className="eyebrow">Nova estrutura</p><h2>Criar sala permanente</h2></div><div className="mini-rule"><span>Expira após 30 dias sem atividade</span><strong>Admin automático</strong></div></div><form className="creator-form" onSubmit={submit}><label className="field big-field"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" placeholder="Ex.: Sala do Mazarati" required disabled={!enabled || hasActiveRoom} /></label><div className="channel-builder-head"><div><strong>Subsalas</strong><span>{channels.length} de 4</span></div><button className="add-channel-button" type="button" onClick={addChannel} disabled={!enabled || hasActiveRoom || channels.length >= 4}>+ Adicionar subsala</button></div><div className="channel-config-grid">{channels.map((channel, index) => <div className="channel-config" key={`create-${index}`}><div className="channel-config-head"><strong>Subsala {index + 1}</strong><button className="remove-channel-button" type="button" onClick={() => removeChannel(index)} disabled={!enabled || hasActiveRoom || channels.length <= 1} aria-label={`Remover subsala ${index + 1}`} title="Remover subsala">×</button></div><label className="field"><span>Nome</span><input value={channel.name} onChange={(event) => updateChannel(index, "name", event.target.value)} maxLength="28" placeholder={channelNames[index]} required disabled={!enabled || hasActiveRoom} /></label><label className="field"><span>Palavra-passe</span><input type="password" autoComplete="new-password" value={channel.password} onChange={(event) => updateChannel(index, "password", event.target.value)} maxLength="24" placeholder="Sem palavra-passe" disabled={!enabled || hasActiveRoom} /></label></div>)}</div><button className="primary-button" disabled={!enabled || hasActiveRoom || busy}>{busy ? "A criar..." : hasActiveRoom ? "Já tens uma sala ativa" : `Criar sala com ${channels.length} ${channels.length === 1 ? "subsala" : "subsalas"}`}</button></form><Message message={message} /></section>;
}

function RoomTree({ room, open, setOpen, onUpdate, onDelete, busy }) {
  return <section className="panel tree-panel"><div className="panel-top"><div><p className="eyebrow">Estrutura ativa</p><h2>A tua sala</h2></div></div><div className="tree-body">{!room && <div className="empty-tree"><strong>Nenhuma sala ativa</strong><span>A sala criada aparece aqui e no TeamSpeak.</span></div>}{room && <RoomCard room={room} isOpen={open} setOpen={() => setOpen(!open)} onUpdate={onUpdate} onDelete={onDelete} busy={busy} />}<div className="temporary-block"><div className="protected-line">━</div><strong>SALAS TEMPORÁRIAS</strong><span>═════════════════════</span></div></div></section>;
}

function RoomCard({ room, isOpen, setOpen, onUpdate, onDelete, busy }) {
  const [title, setTitle] = useState(room.title);
  const draftChannels = () => room.channels.map((channel, index) => ({ ...channel, name: channel.name || channelNames[index], passwordAction: "keep", password: "" }));
  const [channels, setChannels] = useState(draftChannels);
  useEffect(() => { setTitle(room.title); setChannels(draftChannels()); }, [room]);
  function updateChannel(index, values) {
    setChannels(channels.map((channel, channelIndex) => channelIndex === index ? { ...channel, ...values } : channel));
  }
  function addChannel() {
    if (channels.length >= 4) return;
    setChannels([...channels, { name: nextDefaultChannelName(channels), passwordProtected: false, passwordAction: "keep", password: "" }]);
  }
  function removeChannel(index) {
    if (channels.length <= 1) return;
    const channel = channels[index];
    if (channel.cid && !window.confirm(`Remover “${channel.name}” quando guardares as alterações?`)) return;
    setChannels(channels.filter((_, channelIndex) => channelIndex !== index));
  }
  async function submit(event) {
    event.preventDefault();
    await onUpdate({ id: room.id, title: title.trim() || room.title, channels: channels.map((channel) => ({ cid: channel.cid, name: channel.name.trim(), passwordAction: channel.passwordAction, password: channel.passwordAction === "change" ? channel.password.trim() : "" })) });
  }
  return <article className={`room-card ${isOpen ? "is-open" : ""}`}><div className="thick-line" /><button className="room-main" type="button" onClick={setOpen} aria-expanded={isOpen}><span>{room.title}</span><small>Admin: {room.creator?.nickname || "utilizador"} · {room.channels.length} {room.channels.length === 1 ? "subsala" : "subsalas"}{room.autoExpire ? " · 30 dias sem atividade" : ""}</small></button><ul className="channel-list">{room.channels.map((channel, index) => <li key={channel.cid || index}><span className="check">✓</span><span>● {channel.name}</span>{channel.passwordProtected && <span className="lock">Protegida</span>}</li>)}</ul>{isOpen && <form className="admin-panel" onSubmit={submit}><label className="field wide"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" required /></label><div className="channel-builder-head wide"><div><strong>Subsalas</strong><span>{channels.length} de 4</span></div><button className="add-channel-button" type="button" onClick={addChannel} disabled={busy || channels.length >= 4}>+ Adicionar subsala</button></div>{channels.map((channel, index) => <div className="password-editor" key={channel.cid || `new-${index}`}><div className="channel-config-head"><strong>Subsala {index + 1}</strong><button className="remove-channel-button" type="button" onClick={() => removeChannel(index)} disabled={busy || channels.length <= 1} aria-label={`Remover subsala ${index + 1}`} title="Remover subsala">×</button></div><label className="field"><span>Nome</span><input value={channel.name} onChange={(event) => updateChannel(index, { name: event.target.value })} maxLength="28" placeholder={channelNames[index]} required /></label><label className="field"><span>Palavra-passe</span><select value={channel.passwordAction} onChange={(event) => updateChannel(index, { passwordAction: event.target.value, password: "" })}><option value="keep">{channel.passwordProtected ? "Manter palavra-passe" : "Continuar sem palavra-passe"}</option><option value="change">{channel.passwordProtected ? "Definir nova palavra-passe" : "Adicionar palavra-passe"}</option>{channel.passwordProtected && <option value="remove">Remover palavra-passe</option>}</select></label>{channel.passwordAction === "change" && <label className="field"><span>Nova palavra-passe</span><input type="password" autoComplete="new-password" value={channel.password} onChange={(event) => updateChannel(index, { password: event.target.value })} maxLength="24" required placeholder="Até 24 caracteres" /></label>}</div>)}<div className="admin-actions"><button className="primary-button" disabled={busy}>{busy ? "A guardar..." : "Guardar alterações"}</button><button className="danger-button" type="button" disabled={busy} onClick={() => window.confirm(`Apagar esta sala e ${room.channels.length === 1 ? "a subsala" : "todas as subsalas"} do TeamSpeak?`) && onDelete(room)}>Apagar sala</button></div></form>}</article>;
}

const auditLabels = {
  "auth.challenge": "Código solicitado",
  "auth.verify": "Autenticação",
  "auth.logout": "Sessão terminada",
  "groups.update": "Grupos alterados",
  "room.create": "Sala criada",
  "room.update": "Sala alterada",
  "room.delete": "Sala apagada",
  "admin.session.revoke": "Sessão terminada pelo Fundador",
  "admin.room.delete": "Sala removida pelo Fundador",
  "room.auto_delete": "Sala removida por inatividade"
};

function formatDate(value) {
  if (!value) return "Indisponível";
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / (1024 ** (unit + 1))).toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function AdminDashboard({ data, busy, error, onRefresh, actionBusy, actionMessage, onRevokeSession, onDeleteRoom }) {
  if (!data && busy) return <section className="panel loading-panel admin-loading"><span className="loader" /><strong>A recolher dados de segurança...</strong></section>;
  if (!data) return <section className="panel admin-unavailable"><p className="eyebrow">Administração</p><h2>Não foi possível abrir a supervisão</h2><p>{error || "Volta a tentar dentro de alguns instantes."}</p><button className="primary-button" type="button" onClick={() => onRefresh(true)}>Tentar novamente</button></section>;

  const teamSpeak = data.health?.teamSpeak || {};
  const canManage = Boolean(data.permissions?.canManage);
  return <div className="admin-dashboard">
    <section className="admin-heading" aria-labelledby="admin-title">
      <div><p className="eyebrow">Área reservada</p><h2 id="admin-title">Administração e segurança</h2><p>{canManage ? "Ações operacionais exclusivas do grupo Fundador." : "Supervisão em modo de leitura. Os endereços de rede aparecem anonimizados."}</p></div>
      <div className="admin-heading-actions"><span className={`readonly-badge ${canManage ? "is-manage" : ""}`}>{canManage ? "Ações de Fundador" : "Só leitura"}</span><button className="refresh-button" type="button" onClick={() => onRefresh(true)} disabled={busy || Boolean(actionBusy)}>{busy ? "A atualizar..." : "Atualizar dados"}</button></div>
    </section>
    {error && <div className="admin-warning" role="status">{error} A mostrar os últimos dados disponíveis.</div>}
    {actionMessage.text && <div className={`admin-action-message is-${actionMessage.type}`} role="status">{actionMessage.text}</div>}
    <section className="metric-strip" aria-label="Resumo administrativo">
      <div><span className="metric-dot is-good" /><strong>{data.health?.queryLatencyMs ?? "-"} ms</strong><small>Resposta Query</small></div>
      <div><span className="metric-dot is-good" /><strong>{data.counts?.activeSessions ?? 0}</strong><small>Sessões ativas</small></div>
      <div><span className={`metric-dot ${data.counts?.unsynchronizedRooms ? "is-alert" : "is-good"}`} /><strong>{data.counts?.activeRooms ?? 0}</strong><small>Salas permanentes</small></div>
      <div><span className={`metric-dot ${data.counts?.failures24h ? "is-alert" : "is-good"}`} /><strong>{data.counts?.failures24h ?? 0}</strong><small>Falhas em 24 h</small></div>
    </section>
    <div className="admin-grid">
      <section className="panel admin-section health-section">
        <div className="admin-section-head"><div><p className="eyebrow">Estado atual</p><h3>Serviços</h3></div><span className="status-chip is-success">Operacional</span></div>
        <dl className="health-list">
          <div><dt>TeamSpeak</dt><dd>{teamSpeak.slotsUsed ?? 0} / {teamSpeak.slotsTotal ?? 0} utilizadores</dd></div>
          <div><dt>Uptime TeamSpeak</dt><dd>{formatDuration(teamSpeak.uptimeSeconds)}</dd></div>
          <div><dt>Processo web</dt><dd>{formatDuration(data.health?.processUptimeSeconds)}</dd></div>
          <div><dt>Base de dados</dt><dd>{formatBytes(data.health?.databaseBytes)}</dd></div>
          <div><dt>Tráfego</dt><dd>↓ {formatBytes(teamSpeak.bytesDownloaded)} · ↑ {formatBytes(teamSpeak.bytesUploaded)}</dd></div>
          <div><dt>Salas dessincronizadas</dt><dd className={data.counts?.unsynchronizedRooms ? "value-alert" : "value-good"}>{data.counts?.unsynchronizedRooms ?? 0}</dd></div>
        </dl>
      </section>
      <section className="panel admin-section rate-section">
        <div className="admin-section-head"><div><p className="eyebrow">Última hora</p><h3>Pressão dos limites</h3></div><span className="badge">Top {data.busiestBuckets?.length || 0}</span></div>
        <div className="rate-list">{(data.busiestBuckets || []).map((item, index) => <div key={`${item.kind}-${item.address}-${index}`}><span><strong>{item.kind}</strong><small>{item.address}</small></span><b>{item.count}</b></div>)}{!data.busiestBuckets?.length && <p className="empty-admin-row">Sem atividade limitada na última hora.</p>}</div>
      </section>
      <section className="panel admin-section sessions-section">
        <div className="admin-section-head"><div><p className="eyebrow">Acesso web</p><h3>Sessões ativas</h3></div><span className="badge">{data.sessions?.length || 0}</span></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utilizador</th><th>Rede</th><th>Última atividade</th><th>Expira</th>{canManage && <th>Ação</th>}</tr></thead><tbody>{(data.sessions || []).map((session) => { const ownSession = Number(session.databaseId) === Number(data.administrator?.databaseId); return <tr key={`${session.databaseId}-${session.createdAt}`}><td><strong>{session.nickname}</strong><small>DB #{session.databaseId}</small></td><td>{session.ip}</td><td>{formatDate(session.lastSeenAt)}</td><td>{formatDate(session.expiresAt)}</td>{canManage && <td><button className="table-action" type="button" disabled={ownSession || Boolean(actionBusy)} title={ownSession ? "A tua sessão está protegida" : "Terminar todas as sessões deste utilizador"} onClick={() => window.confirm(`Terminar todas as sessões web de ${session.nickname}?`) && onRevokeSession(session)}>{actionBusy === `session:${session.databaseId}` ? "A terminar..." : ownSession ? "Sessão atual" : "Terminar"}</button></td>}</tr>; })}{!data.sessions?.length && <tr><td colSpan={canManage ? 5 : 4} className="empty-table">Não existem sessões ativas.</td></tr>}</tbody></table></div>
      </section>
      <section className="panel admin-section rooms-section">
        <div className="admin-section-head"><div><p className="eyebrow">TeamSpeak</p><h3>Salas permanentes</h3></div><span className="badge">{data.rooms?.length || 0}</span></div>
        <div className="room-status-list">{(data.rooms || []).map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{item.creator?.nickname || "Utilizador"} · {item.channelCount} canais · {item.autoExpire ? `expira ${formatDate(item.expiresAt)}` : "sem expiração automática"}</small></span><span className="room-admin-controls"><span className={`status-chip ${item.synchronized ? "is-success" : "is-danger"}`}>{item.synchronized ? "Sincronizada" : "Rever"}</span>{canManage && <button className="table-action is-danger" type="button" disabled={Boolean(actionBusy)} onClick={() => window.confirm(`Apagar permanentemente a sala “${item.title}” e os respetivos canais do TeamSpeak?`) && onDeleteRoom(item)}>{actionBusy === `room:${item.id}` ? "A apagar..." : "Apagar"}</button>}</span></div>)}{!data.rooms?.length && <p className="empty-admin-row">Ainda não existem salas permanentes.</p>}</div>
      </section>
      <section className="panel admin-section audit-section">
        <div className="admin-section-head"><div><p className="eyebrow">Registo recente</p><h3>Auditoria</h3></div><span className="badge">Últimos {data.audit?.length || 0}</span></div>
        <div className="admin-table-wrap"><table className="admin-table audit-table"><thead><tr><th>Data</th><th>Utilizador</th><th>Ação</th><th>Rede</th><th>Resultado</th></tr></thead><tbody>{(data.audit || []).map((entry) => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td><strong>{entry.nickname || "Visitante"}</strong>{entry.databaseId && <small>DB #{entry.databaseId}</small>}</td><td>{auditLabels[entry.action] || entry.action}</td><td>{entry.ip}</td><td><span className={`status-chip ${entry.success ? "is-success" : "is-danger"}`} title={entry.details?.message || ""}>{entry.success ? "Concluído" : "Falhou"}</span></td></tr>)}{!data.audit?.length && <tr><td colSpan="5" className="empty-table">Ainda não existem registos de auditoria.</td></tr>}</tbody></table></div>
      </section>
    </div>
    <p className="admin-updated">Dados atualizados em {formatDate(data.fetchedAt)}.</p>
  </div>;
}

function Footer() {
  return <footer className="footer">Copyright © {new Date().getFullYear()} realizado com <span className="heart">♥</span> por <a href="https://steamcommunity.com/id/mazarati21" target="_blank" rel="noreferrer">Mazarati</a>{" | "}<a href="https://legendzcommunity.com/" target="_blank" rel="noreferrer">legendzcommunity.com</a></footer>;
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [auth, setAuth] = useState({ loading: true, authenticated: false, teamSpeakOnline: true, connected: false, candidates: [], activeRoom: null });
  const [sections, setSections] = useState([]), [selections, setSelections] = useState({}), [savedSelections, setSavedSelections] = useState({});
  const [groupMessage, setGroupMessage] = useState({ text: "", type: "neutral" }), [roomMessage, setRoomMessage] = useState({ text: "", type: "neutral" });
  const [groupsBusy, setGroupsBusy] = useState(false), [roomBusy, setRoomBusy] = useState(false), [roomOpen, setRoomOpen] = useState(false);
  const [view, setView] = useState("panel"), [adminData, setAdminData] = useState(null), [adminBusy, setAdminBusy] = useState(false), [adminError, setAdminError] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(""), [adminActionMessage, setAdminActionMessage] = useState({ text: "", type: "success" });
  const room = useMemo(() => normalizeRoom(auth.activeRoom), [auth.activeRoom]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const alternateBackground = new Image();
    alternateBackground.src = `${appBasePath}/assets/background-${theme === "dark" ? "light" : "dark"}.png?v=2`;
  }, [theme]);

  async function refreshAuth() {
    try { const payload = await api("/api/auth/status"); csrfToken = payload.csrfToken || ""; setAuth({ loading: false, ...payload, activeRoom: normalizeRoom(payload.activeRoom) }); return payload; }
    catch (error) { csrfToken = ""; setAuth({ loading: false, authenticated: false, teamSpeakOnline: false, connected: false, candidates: [], activeRoom: null, error: error.message }); return null; }
  }
  async function refreshGroups() {
    try { const payload = await api("/api/groups"); setSections(payload.categories || []); setSelections(payload.selected || {}); setSavedSelections(payload.selected || {}); }
    catch (error) { setGroupMessage({ text: error.message, type: "error" }); }
  }
  async function refreshAll() { await refreshAuth(); }
  useEffect(() => { refreshAll(); const timer = window.setInterval(refreshAuth, 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (auth.authenticated && auth.connected) refreshGroups();
  }, [auth.authenticated, auth.connected]);
  useEffect(() => { if (!auth.isAdmin && view === "admin") setView("panel"); }, [auth.isAdmin, view]);
  useEffect(() => {
    if (view !== "admin" || !auth.isAdmin) return undefined;
    refreshAdmin(true);
    const timer = window.setInterval(() => refreshAdmin(false), 30000);
    return () => window.clearInterval(timer);
  }, [view, auth.isAdmin]);

  async function refreshAdmin(showLoader = true) {
    if (showLoader) setAdminBusy(true);
    setAdminError("");
    try { setAdminData(await api("/api/admin/overview")); }
    catch (error) { setAdminError(error.message); }
    finally { setAdminBusy(false); }
  }

  async function revokeAdminSession(session) {
    setAdminActionBusy(`session:${session.databaseId}`); setAdminActionMessage({ text: "", type: "success" });
    try { const result = await api("/api/admin/sessions/revoke", { method: "POST", body: JSON.stringify({ databaseId: session.databaseId }) }); setAdminActionMessage({ text: `${result.revoked} sessão${result.revoked === 1 ? "" : "ões"} de ${session.nickname} terminada${result.revoked === 1 ? "" : "s"}.`, type: "success" }); await refreshAdmin(false); }
    catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); }
    finally { setAdminActionBusy(""); }
  }

  async function deleteAdminRoom(room) {
    setAdminActionBusy(`room:${room.id}`); setAdminActionMessage({ text: "", type: "success" });
    try { await api("/api/admin/rooms", { method: "DELETE", body: JSON.stringify({ id: room.id }) }); setAdminActionMessage({ text: `A sala “${room.title}” foi removida do TeamSpeak.`, type: "success" }); await refreshAdmin(false); }
    catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); }
    finally { setAdminActionBusy(""); }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    csrfToken = ""; setSections([]); setSelections({}); setSavedSelections({}); setRoomOpen(false); setView("panel"); setAdminData(null); setAdminError(""); setAdminActionMessage({ text: "", type: "success" }); await refreshAuth();
  }
  async function applyGroups() {
    setGroupsBusy(true); setGroupMessage({ text: "A guardar grupos no TeamSpeak...", type: "neutral" });
    try { const payload = await api("/api/groups", { method: "POST", body: JSON.stringify({ selections }) }); const selected = payload.selected || selections; setSections(payload.categories || sections); setSelections(selected); setSavedSelections(selected); setGroupMessage({ text: "Grupos atualizados no TeamSpeak.", type: "success" }); }
    catch (error) { setGroupMessage({ text: error.message, type: "error" }); } finally { setGroupsBusy(false); }
  }
  async function createRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A criar a sala no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "POST", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomOpen(true); setRoomMessage({ text: `Sala criada com ${result.room.channels.length} ${result.room.channels.length === 1 ? "subsala" : "subsalas"}. Recebeste Channel Admin em toda a estrutura.`, type: "success" }); return true; }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); return false; } finally { setRoomBusy(false); }
  }
  async function updateRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A guardar alterações no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "PATCH", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomMessage({ text: "Estrutura da sala atualizada no TeamSpeak.", type: "success" }); return true; }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); return false; } finally { setRoomBusy(false); }
  }
  async function deleteRoom(target) {
    setRoomBusy(true); setRoomMessage({ text: "A apagar a sala no TeamSpeak...", type: "neutral" });
    try { await api("/api/rooms", { method: "DELETE", body: JSON.stringify({ id: target.id }) }); setAuth((current) => ({ ...current, activeRoom: null })); setRoomOpen(false); setRoomMessage({ text: "Sala apagada. O separador fixo foi preservado.", type: "success" }); }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); } finally { setRoomBusy(false); }
  }

  const enabled = auth.authenticated && auth.connected;
  return <main className="app-shell">
    <header className="hero"><div className="brand-lockup"><span className="brand-mark">LZ</span><div><p className="eyebrow">LegendZ Community</p><h1>Painel TeamSpeak</h1></div></div><div className="header-actions"><ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />{auth.authenticated && <button className="logout-button" type="button" onClick={logout}>Terminar sessão</button>}<StatusPill auth={auth} /></div></header>
    <section className="intro-bar" aria-label="Resumo do painel"><div><strong>1–4</strong><span>subsalas por espaço</span></div><div><strong>1</strong><span>sala por utilizador</span></div><div><strong>Auto</strong><span>Channel Admin</span></div><p>Gere os teus grupos e a tua sala com confirmação segura através do TeamSpeak.</p></section>
    {!auth.loading && !auth.authenticated && <AuthPanel auth={auth} onAuthenticated={refreshAll} />}
    {auth.loading && <section className="panel loading-panel"><span className="loader" /><strong>A preparar o painel...</strong></section>}
    {auth.authenticated && auth.isAdmin && <nav className="view-switcher" aria-label="Área do painel"><button type="button" className={view === "panel" ? "is-active" : ""} aria-current={view === "panel" ? "page" : undefined} onClick={() => setView("panel")}>O meu painel</button><button type="button" className={view === "admin" ? "is-active" : ""} aria-current={view === "admin" ? "page" : undefined} onClick={() => setView("admin")}>Administração</button></nav>}
    {auth.authenticated && view === "panel" && <div className="dashboard"><ProfilePanel auth={auth} room={room} sections={sections} selections={selections} /><GroupsPanel sections={sections} selections={selections} setSelections={setSelections} savedSelections={savedSelections} onApply={applyGroups} busy={groupsBusy} message={groupMessage} enabled={enabled} /><div className="side-stack"><CreatorPanel enabled={enabled} hasActiveRoom={Boolean(room)} onCreate={createRoom} message={roomMessage} busy={roomBusy} /><RoomTree room={room} open={roomOpen} setOpen={setRoomOpen} onUpdate={updateRoom} onDelete={deleteRoom} busy={roomBusy} /></div></div>}
    {auth.authenticated && auth.isAdmin && view === "admin" && <AdminDashboard data={adminData} busy={adminBusy} error={adminError} onRefresh={refreshAdmin} actionBusy={adminActionBusy} actionMessage={adminActionMessage} onRevokeSession={revokeAdminSession} onDeleteRoom={deleteAdminRoom} />}
    <Footer />
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
