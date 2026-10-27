const { useEffect, useMemo, useRef, useState } = React;

const THEME_KEY = "legendz-theme";
const channelNames = ["Convivio 1", "Convivio 2", "Convivio 3", "Convivio 4"];
const roomTemplates = [
  { key: "convivio", label: "Convívio", channels: channelNames },
  { key: "competitivo", label: "Competitivo", channels: ["Lobby", "Equipa A", "Equipa B", "Análise"] },
  { key: "equipa", label: "Equipa", channels: ["Geral", "Treino", "Jogo"] }
];
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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${appBasePath}${path}`, { credentials: "same-origin", cache: "no-store", ...options, headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || "Não foi possível concluir o pedido.");
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("O servidor demorou demasiado a responder. Tenta novamente.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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
  return <button className="theme-toggle" type="button" onClick={onToggle} aria-label={`Ativar modo ${theme === "dark" ? "claro" : "escuro"}`} title="Alternar tema"><span aria-hidden="true">◐</span><span>Tema</span></button>;
}

function Message({ message }) {
  if (!message.text) return null;
  return <div className={`message is-${message.type}`} role={message.type === "error" ? "alert" : "status"} aria-live={message.type === "error" ? "assertive" : "polite"}>{message.text}</div>;
}

function MaintenanceBanner({ maintenance }) {
  if (!maintenance?.enabled) return null;
  return <section className="maintenance-banner" role="status"><span className="maintenance-icon" aria-hidden="true">!</span><div><strong>Painel em manutenção</strong><p>{maintenance.message}</p></div></section>;
}

function ToastRegion({ toast, onClose }) {
  if (!toast?.text) return null;
  return <div className="toast-region" aria-live="polite"><div className={`toast is-${toast.type || "success"}`}><span className="toast-mark" aria-hidden="true">{toast.type === "error" ? "!" : "✓"}</span><span>{toast.text}</span><button type="button" onClick={onClose} aria-label="Fechar notificação">×</button></div></div>;
}

function ConfirmDialog({ dialog, onResolve }) {
  if (!dialog) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onResolve(false)}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <span className={`confirm-symbol ${dialog.danger ? "is-danger" : ""}`} aria-hidden="true">{dialog.danger ? "!" : "?"}</span>
      <div><p className="eyebrow">Confirmação</p><h2 id="confirm-title">{dialog.title}</h2><p id="confirm-message">{dialog.message}</p></div>
      <div className="confirm-actions"><button className="secondary-button" type="button" onClick={() => onResolve(false)}>Cancelar</button><button className={dialog.danger ? "danger-button" : "primary-button"} type="button" onClick={() => onResolve(true)} autoFocus>{dialog.confirmLabel || "Confirmar"}</button></div>
    </section>
  </div>;
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
      <div className="profile-notifications" aria-label="Notificações da conta">
        <div className="profile-notifications-head"><strong>Notificações</strong><span>{auth.notifications?.length || 0}</span></div>
        {(auth.notifications || []).map((notification) => <article className={`profile-notification is-${notification.tone}`} key={notification.id}><span className="notification-mark" aria-hidden="true">{notification.tone === "neutral" ? "i" : "!"}</span><div><strong>{notification.title}</strong><p>{notification.message}</p><time dateTime={new Date(notification.date).toISOString()}>{formatDate(notification.date)}</time></div></article>)}
        {!auth.notifications?.length && <div className="profile-notifications-empty"><span className="notification-mark" aria-hidden="true">✓</span><span>Não tens avisos pendentes.</span></div>}
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
  return <section className="panel groups-panel" id="groups-panel" aria-label="Grupos e ícones">
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
  const [template, setTemplate] = useState("custom");
  function applyTemplate(item) {
    setTemplate(item.key);
    setChannels(item.channels.map((name) => ({ name, password: "" })));
  }
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
    if (created) { setTitle(""); setTemplate("custom"); setChannels([{ name: channelNames[0], password: "" }]); }
  }
  return <section className="panel creator-panel" id="room-creator"><div className="panel-top split"><div><p className="eyebrow">Nova estrutura</p><h2>Criar sala permanente</h2></div><div className="mini-rule"><span>Expira após 30 dias sem atividade</span><strong>Admin automático</strong></div></div><form className="creator-form" onSubmit={submit}><div className="template-picker"><span>Modelo</span><div role="group" aria-label="Modelo da sala"><button type="button" className={template === "custom" ? "is-active" : ""} onClick={() => setTemplate("custom")} disabled={!enabled || hasActiveRoom}>Personalizado</button>{roomTemplates.map((item) => <button type="button" key={item.key} className={template === item.key ? "is-active" : ""} onClick={() => applyTemplate(item)} disabled={!enabled || hasActiveRoom}>{item.label}</button>)}</div></div><label className="field big-field"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" placeholder="Ex.: Sala do Mazarati" required disabled={!enabled || hasActiveRoom} /></label><div className="channel-builder-head"><div><strong>Subsalas</strong><span>{channels.length} de 4</span></div><button className="add-channel-button" type="button" onClick={() => { setTemplate("custom"); addChannel(); }} disabled={!enabled || hasActiveRoom || channels.length >= 4}>+ Adicionar subsala</button></div><div className="channel-config-grid">{channels.map((channel, index) => <div className="channel-config" key={`create-${index}`}><div className="channel-config-head"><strong>Subsala {index + 1}</strong><button className="remove-channel-button" type="button" onClick={() => { setTemplate("custom"); removeChannel(index); }} disabled={!enabled || hasActiveRoom || channels.length <= 1} aria-label={`Remover subsala ${index + 1}`} title="Remover subsala">×</button></div><label className="field"><span>Nome</span><input value={channel.name} onChange={(event) => { setTemplate("custom"); updateChannel(index, "name", event.target.value); }} maxLength="28" placeholder={channelNames[index]} required disabled={!enabled || hasActiveRoom} /></label><label className="field"><span>Palavra-passe</span><input type="password" autoComplete="new-password" value={channel.password} onChange={(event) => updateChannel(index, "password", event.target.value)} maxLength="24" placeholder="Sem palavra-passe" disabled={!enabled || hasActiveRoom} /></label></div>)}</div><button className="primary-button" disabled={!enabled || hasActiveRoom || busy}>{busy ? "A criar..." : hasActiveRoom ? "Já tens uma sala ativa" : `Criar sala com ${channels.length} ${channels.length === 1 ? "subsala" : "subsalas"}`}</button></form><Message message={message} /></section>;
}

function RoomTree({ room, open, setOpen, onUpdate, onDelete, busy, enabled, confirmAction }) {
  return <section className="panel tree-panel" id="room-manager"><div className="panel-top"><div><p className="eyebrow">Estrutura ativa</p><h2>A tua sala</h2></div>{room && <span className="manage-room-hint"><i aria-hidden="true">✎</i> Usa o botão para editar nomes e passes</span>}</div><div className="tree-body">{!room && <div className="empty-tree"><strong>Nenhuma sala ativa</strong><span>A sala criada aparece aqui e no TeamSpeak.</span></div>}{room && <RoomCard room={room} isOpen={open} setOpen={() => setOpen(!open)} onUpdate={onUpdate} onDelete={onDelete} busy={busy} enabled={enabled} confirmAction={confirmAction} />}<div className="temporary-block"><div className="protected-line">━</div><strong>SALAS TEMPORÁRIAS</strong><span>═════════════════════</span></div></div></section>;
}

function RoomCard({ room, isOpen, setOpen, onUpdate, onDelete, busy, enabled, confirmAction }) {
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
  async function removeChannel(index) {
    if (channels.length <= 1) return;
    const channel = channels[index];
    if (channel.cid && !await confirmAction({ title: "Remover subsala", message: `A subsala “${channel.name}” será eliminada quando guardares as alterações.`, confirmLabel: "Remover", danger: true })) return;
    setChannels(channels.filter((_, channelIndex) => channelIndex !== index));
  }
  async function submit(event) {
    event.preventDefault();
    await onUpdate({ id: room.id, title: title.trim() || room.title, channels: channels.map((channel) => ({ cid: channel.cid, name: channel.name.trim(), passwordAction: channel.passwordAction, password: channel.passwordAction === "change" ? channel.password.trim() : "" })) });
  }
  const remainingMs = Math.max(0, Number(room.expiresAt || 0) - Date.now());
  const remainingDays = Math.max(1, Math.ceil(remainingMs / 86_400_000));
  const expiryProgress = room.autoExpire ? Math.max(0, Math.min(100, remainingMs / (Number(room.inactivityDays || 30) * 86_400_000) * 100)) : 100;
  const expiryTone = remainingDays <= 3 ? "is-danger" : remainingDays <= 7 ? "is-warning" : "is-safe";
  const protectedCount = room.channels.filter((channel) => channel.passwordProtected).length;
  return <article className={`room-card owner-room-card ${isOpen ? "is-open" : ""}`}>
    <div className="thick-line" />
    <div className="owner-room-command">
      <div><p className="eyebrow">Propriedade confirmada</p><h3>{room.title}</h3><span>Channel Admin atribuído a {room.creator?.nickname || "utilizador"}</span></div>
      <div className="owner-room-actions"><span className={`owner-state ${enabled ? "is-online" : "is-offline"}`}><i aria-hidden="true" />{enabled ? "Pronta a gerir" : "TeamSpeak desligado"}</span><button className="owner-manage-button" type="button" onClick={setOpen} aria-expanded={isOpen} aria-controls="owner-room-editor"><span aria-hidden="true">✎</span>{isOpen ? "Fechar editor" : "Editar sala e subsalas"}<b aria-hidden="true">{isOpen ? "↑" : "↓"}</b></button></div>
    </div>
    <div className="owner-room-metrics" aria-label="Resumo da sala">
      <div><span>Estrutura</span><strong>{room.channels.length}/4</strong><small>{room.channels.length === 1 ? "subsala ativa" : "subsalas ativas"}</small></div>
      <div><span>Proteção</span><strong>{protectedCount}</strong><small>{protectedCount === 1 ? "subsala com passe" : "subsalas com passe"}</small></div>
      <div><span>Retenção</span><strong>{room.autoExpire ? `${remainingDays} d` : "Permanente"}</strong><small>{room.autoExpire ? "atividade renova o prazo" : "sala antiga sem expiração"}</small></div>
    </div>
    {room.autoExpire ? <div className={`room-expiry ${expiryTone}`}><div><span>Prazo de atividade</span><strong>{remainingDays} {remainingDays === 1 ? "dia restante" : "dias restantes"}</strong></div><small>Renova ao entrares numa subsala · expira {formatDate(room.expiresAt)}</small><div className="room-expiry-track" aria-hidden="true"><i style={{ width: `${expiryProgress}%` }} /></div></div> : <div className="legacy-room-note"><span aria-hidden="true">◇</span><div><strong>Sala histórica protegida</strong><small>Importada do painel anterior e excluída da eliminação automática.</small></div></div>}
    <div className="owner-channel-grid">{room.channels.map((channel, index) => <article key={channel.cid || index}><span className="owner-channel-index">0{index + 1}</span><div><strong>{channel.name}</strong><small>{channel.passwordProtected ? "Acesso protegido" : "Acesso livre"}</small></div><span className={`owner-channel-security ${channel.passwordProtected ? "is-locked" : ""}`} aria-label={channel.passwordProtected ? "Protegida por palavra-passe" : "Sem palavra-passe"}>{channel.passwordProtected ? "●" : "○"}</span></article>)}</div>
    {isOpen && <form className="admin-panel owner-editor" id="owner-room-editor" onSubmit={submit}><div className="owner-editor-intro wide"><div><p className="eyebrow">Editor da estrutura</p><strong>Alterações aplicadas diretamente no TeamSpeak</strong></div><span>{channels.length} de 4 subsalas</span></div><label className="field wide"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" required disabled={!enabled} /></label><div className="channel-builder-head wide"><div><strong>Subsalas</strong><span>{channels.length} de 4</span></div><button className="add-channel-button" type="button" onClick={addChannel} disabled={!enabled || busy || channels.length >= 4}>+ Adicionar subsala</button></div>{channels.map((channel, index) => <div className="password-editor" key={channel.cid || `new-${index}`}><div className="channel-config-head"><strong>Subsala {index + 1}</strong><button className="remove-channel-button" type="button" onClick={() => removeChannel(index)} disabled={!enabled || busy || channels.length <= 1} aria-label={`Remover subsala ${index + 1}`} title="Remover subsala">×</button></div><label className="field"><span>Nome</span><input value={channel.name} onChange={(event) => updateChannel(index, { name: event.target.value })} maxLength="28" placeholder={channelNames[index]} required disabled={!enabled} /></label><label className="field"><span>Palavra-passe</span><select value={channel.passwordAction} onChange={(event) => updateChannel(index, { passwordAction: event.target.value, password: "" })} disabled={!enabled}><option value="keep">{channel.passwordProtected ? "Manter palavra-passe" : "Continuar sem palavra-passe"}</option><option value="change">{channel.passwordProtected ? "Definir nova palavra-passe" : "Adicionar palavra-passe"}</option>{channel.passwordProtected && <option value="remove">Remover palavra-passe</option>}</select></label>{channel.passwordAction === "change" && <label className="field"><span>Nova palavra-passe</span><input type="password" autoComplete="new-password" value={channel.password} onChange={(event) => updateChannel(index, { password: event.target.value })} maxLength="24" required placeholder="Até 24 caracteres" disabled={!enabled} /></label>}</div>)}<div className="admin-actions"><button className="primary-button" disabled={!enabled || busy}>{busy ? "A guardar..." : "Guardar alterações"}</button><button className="danger-button" type="button" disabled={!enabled || busy} onClick={async () => await confirmAction({ title: "Apagar sala permanente", message: `A sala e ${room.channels.length === 1 ? "a subsala" : "todas as subsalas"} serão removidas do TeamSpeak.`, confirmLabel: "Apagar sala", danger: true }) && onDelete(room)}>Apagar sala</button></div></form>}
  </article>;
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
  "admin.room.recover": "Propriedade da sala recuperada",
  "admin.rooms.import": "Salas antigas importadas",
  "admin.maintenance.update": "Manutenção alterada",
  "admin.backup.create": "Backup manual criado",
  "admin.diagnostics.run": "Diagnóstico executado",
  "room.auto_delete": "Sala removida por inatividade",
  "room.expiry_warning": "Aviso de expiração enviado"
};

function formatDate(value) {
  if (!value) return "Indisponível";
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function auditFailureMessage(entry) {
  const message = String(entry.details?.message || "").replace(/\\s/g, " ");
  if (/error id=771\b/.test(message)) return "O nome do canal já está a ser utilizado.";
  return message;
}

function auditActionKind(action) {
  if (String(action).startsWith("room.") || String(action).startsWith("admin.room.")) return "room";
  if (String(action).startsWith("auth.") || String(action).startsWith("admin.session.")) return "access";
  if (String(action).startsWith("groups.")) return "group";
  return "system";
}

function AuditLog({ entries = [] }) {
  const [filter, setFilter] = useState("all");
  const counts = {
    all: entries.length,
    failures: entries.filter((entry) => !entry.success).length,
    rooms: entries.filter((entry) => auditActionKind(entry.action) === "room").length
  };
  const filteredEntries = entries.filter((entry) => {
    if (filter === "failures") return !entry.success;
    if (filter === "rooms") return auditActionKind(entry.action) === "room";
    return true;
  });
  const filters = [{ key: "all", label: "Todos" }, { key: "failures", label: "Falhas" }, { key: "rooms", label: "Salas" }];

  return <section className="panel admin-section audit-section">
    <div className="admin-section-head audit-section-head"><div><p className="eyebrow">Registo recente</p><h3>Auditoria</h3></div><span className="badge">{entries.length} eventos</span></div>
    <div className="audit-toolbar" role="group" aria-label="Filtrar auditoria">{filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? "is-active" : ""} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}><span>{item.label}</span><b>{counts[item.key]}</b></button>)}</div>
    <div className="audit-feed" role="list">{filteredEntries.map((entry) => {
      const failureMessage = !entry.success && auditFailureMessage(entry);
      const kind = auditActionKind(entry.action);
      return <div className={`audit-entry ${entry.success ? "is-success" : "is-failure"}`} role="listitem" key={entry.id}>
        <span className={`audit-event-icon is-${kind}`} aria-hidden="true">{entry.success ? "✓" : "!"}</span>
        <div className="audit-entry-body">
          <div className="audit-entry-title"><strong>{auditLabels[entry.action] || entry.action}</strong><span className={`audit-outcome ${entry.success ? "is-success" : "is-failure"}`}>{entry.success ? "Concluído" : "Falhou"}</span></div>
          <div className="audit-entry-meta"><span className="audit-actor">{entry.nickname || "Visitante"}</span>{entry.databaseId && <span>DB #{entry.databaseId}</span>}<span>{entry.ip}</span><time dateTime={new Date(entry.createdAt).toISOString()}>{formatDate(entry.createdAt)}</time></div>
          {failureMessage && <div className="audit-error-detail"><strong>Motivo</strong><span>{failureMessage}</span>{entry.details?.status && <code>HTTP {entry.details.status}</code>}</div>}
        </div>
      </div>;
    })}{!filteredEntries.length && <div className="audit-empty"><strong>Sem registos neste filtro</strong><span>Os novos eventos vão aparecer aqui automaticamente.</span></div>}</div>
  </section>;
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

function AdminSkeleton() {
  return <div className="admin-dashboard admin-skeleton" aria-label="A carregar administração"><section className="skeleton-block skeleton-heading" /><section className="skeleton-block skeleton-metrics" /><section className="skeleton-block skeleton-feed" /><div className="admin-grid"><section className="skeleton-block skeleton-card" /><section className="skeleton-block skeleton-card" /></div></div>;
}

function OperationalChart({ history }) {
  const hourly = history?.hourly || [];
  const peak = Math.max(1, ...hourly.map((item) => Number(item.peakSlots || 0)));
  return <section className="panel admin-section operations-chart-section">
    <div className="admin-section-head"><div><p className="eyebrow">Últimas 24 horas</p><h3>Utilização e disponibilidade</h3></div><span className="badge">Pico {history?.peakSlots30d || 0}</span></div>
    <div className="operations-chart" aria-label="Utilização horária do TeamSpeak">{hourly.map((item, index) => <div className={`operations-bar ${item.onlinePercent == null ? "is-empty" : item.onlinePercent < 100 ? "is-partial" : ""}`} key={item.at || index} title={`${formatDate(item.at)} · ${item.peakSlots ?? 0} utilizadores · ${item.onlinePercent ?? 0}% online`}><i style={{ height: `${Math.max(8, (Number(item.peakSlots || 0) / peak) * 100)}%` }} /><span>{index % 4 === 0 ? new Intl.DateTimeFormat("pt-PT", { hour: "2-digit" }).format(new Date(item.at)) : ""}</span></div>)}</div>
    <div className="operations-legend"><span><i className="is-online" />Operacional</span><span><i className="is-partial" />Parcial</span><strong>{history?.availability30d == null ? "A recolher dados" : `${Number(history.availability30d).toFixed(2)}% observado`}</strong></div>
  </section>;
}

function MaintenanceControl({ maintenance, busy, onSave }) {
  const [message, setMessage] = useState(maintenance?.message || "O painel está temporariamente em manutenção.");
  useEffect(() => { setMessage(maintenance?.message || "O painel está temporariamente em manutenção."); }, [maintenance?.message]);
  const active = Boolean(maintenance?.enabled);
  return <section className={`panel admin-section maintenance-section ${active ? "is-active" : ""}`}>
    <div className="admin-section-head"><div><p className="eyebrow">Controlo de acesso</p><h3>Modo de manutenção</h3></div><span className={`status-chip ${active ? "is-danger" : "is-success"}`}>{active ? "Ativo" : "Desativado"}</span></div>
    <div className="maintenance-control"><p>{active ? "Criação, edição e remoção de salas e grupos estão suspensas." : "O painel está disponível para todos os utilizadores autenticados."}</p><label className="field"><span>Mensagem apresentada</span><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength="180" /></label><button className={active ? "secondary-button" : "danger-button"} type="button" disabled={Boolean(busy)} onClick={() => onSave(!active, message)}>{busy === "maintenance" ? "A guardar..." : active ? "Desativar manutenção" : "Ativar manutenção"}</button></div>
  </section>;
}

function BackupManager({ backups = [], busy, onCreate }) {
  return <section className="panel admin-section backups-section">
    <div className="admin-section-head"><div><p className="eyebrow">Proteção de dados</p><h3>Backups SQLite</h3></div><button className="compact-action" type="button" disabled={Boolean(busy)} onClick={onCreate}>{busy === "backup:create" ? "A criar..." : "Criar backup"}</button></div>
    <div className="backup-list">{backups.map((backup) => <div className="backup-row" key={backup.file}><span className={`backup-state is-${backup.integrity}`} aria-hidden="true">{backup.integrity === "ok" ? "✓" : "!"}</span><span><strong>{backup.manual ? "Backup manual" : "Backup automático"}</strong><small>{formatDate(backup.createdAt)} · {formatBytes(backup.bytes)}</small></span><a className="download-button" href={`${appBasePath}/api/admin/backups/download?file=${encodeURIComponent(backup.file)}`} download={backup.file} title="Descarregar backup">↓</a></div>)}{!backups.length && <p className="empty-admin-row">Ainda não existem backups disponíveis.</p>}</div>
  </section>;
}

function DiagnosticsPanel({ diagnostics, busy, onRun }) {
  const overall = diagnostics?.summary?.overall || "idle";
  const overallLabel = overall === "pass" ? "Tudo operacional" : overall === "warn" ? "Requer atenção" : overall === "fail" ? "Falhas detetadas" : "Ainda não executado";
  return <section className={`panel admin-section diagnostics-section is-${overall}`}>
    <div className="admin-section-head"><div><p className="eyebrow">Verificação segura</p><h3>Diagnóstico TeamSpeak</h3></div><button className="compact-action" type="button" disabled={Boolean(busy)} onClick={onRun}>{busy === "diagnostics" ? "A verificar..." : diagnostics ? "Executar novamente" : "Executar diagnóstico"}</button></div>
    {!diagnostics && <div className="diagnostics-empty"><span aria-hidden="true">+</span><div><strong>Pronto para verificar</strong><p>Analisa Query, canais protegidos, grupos, salas, SQLite, backups, armazenamento e configuração segura.</p></div></div>}
    {diagnostics && <><div className="diagnostics-summary"><span className={`diagnostics-overall is-${overall}`} aria-hidden="true">{overall === "pass" ? "✓" : overall === "warn" ? "!" : "×"}</span><div><strong>{overallLabel}</strong><small>{diagnostics.summary.pass} OK · {diagnostics.summary.warn} {diagnostics.summary.warn === 1 ? "aviso" : "avisos"} · {diagnostics.summary.fail} {diagnostics.summary.fail === 1 ? "falha" : "falhas"} · {diagnostics.durationMs} ms</small></div><time dateTime={new Date(diagnostics.ranAt).toISOString()}>{formatDate(diagnostics.ranAt)}</time></div><div className="diagnostics-list">{diagnostics.checks.map((check) => <article key={check.id} className={`is-${check.status}`}><span aria-hidden="true">{check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "×"}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div><b>{check.status === "pass" ? "OK" : check.status === "warn" ? "Aviso" : "Falha"}</b></article>)}</div></>}
  </section>;
}

function IncidentTimeline({ incidents = [], busy, onNote, canManage }) {
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState("");
  function openEditor(incident) { setEditing(incident.id); setNote(incident.note || ""); }
  return <section className="panel admin-section incidents-section">
    <div className="admin-section-head"><div><p className="eyebrow">Serviço público</p><h3>Cronologia de incidentes</h3></div><span className="badge">{incidents.length}</span></div>
    <div className="incident-timeline">{incidents.map((incident) => <article key={incident.id} className={incident.resolvedAt ? "is-resolved" : "is-open"}><span className="timeline-node" aria-hidden="true" /><div className="timeline-body"><div><strong>{incident.summary}</strong><span>{incident.resolvedAt ? "Resolvido" : "Em curso"}</span></div><small>{formatDate(incident.startedAt)}{incident.resolvedAt ? ` — ${formatDate(incident.resolvedAt)}` : ""}</small>{incident.note && <p><b>{incident.noteBy || "Staff"}</b> · {incident.note}</p>}{canManage && (editing === incident.id ? <form className="inline-note-form" onSubmit={async (event) => { event.preventDefault(); if (await onNote(incident.id, note)) setEditing(null); }}><input value={note} onChange={(event) => setNote(event.target.value)} maxLength="300" placeholder="Nota visível na página de Estado" autoFocus /><button type="submit" disabled={Boolean(busy)}>Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></form> : <button className="text-action" type="button" onClick={() => openEditor(incident)}>Adicionar nota pública</button>)}</div></article>)}{!incidents.length && <p className="empty-admin-row">Não existem incidentes nos últimos 30 dias.</p>}</div>
  </section>;
}

function RoomOperations({ rooms = [], canManage, busy, onDeleteRoom, onImportRooms, confirmAction }) {
  const [filter, setFilter] = useState("all");
  const filters = [
    { key: "all", label: "Todas" },
    { key: "expiring", label: "A expirar" },
    { key: "idle", label: "Pouca atividade" },
    { key: "unsynced", label: "Dessincronizadas" }
  ];
  const visible = rooms.filter((room) => filter === "all" || (filter === "expiring" && room.autoExpire && room.remainingDays <= 7) || (filter === "idle" && room.inactivityDays >= 14) || (filter === "unsynced" && !room.synchronized));
  return <section className="panel admin-section rooms-section">
    <div className="admin-section-head"><div><p className="eyebrow">TeamSpeak</p><h3>Salas permanentes</h3></div><div className="alerts-head-actions"><span className="badge">{rooms.length}</span>{canManage && <button className="compact-action" type="button" disabled={Boolean(busy)} onClick={async () => await confirmAction({ title: "Importar salas antigas", message: "O painel vai procurar estruturas compatíveis acima das salas temporárias e associá-las ao respetivo Channel Admin. Nenhum canal será alterado ou apagado.", confirmLabel: "Importar salas" }) && onImportRooms()}>{busy === "rooms:import" ? "A procurar..." : "Importar antigas"}</button>}</div></div>
    <div className="room-filter-bar" role="group" aria-label="Filtrar salas">{filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
    <div className="room-status-list">{visible.map((item) => { const tone = !item.synchronized ? "is-danger" : item.autoExpire && item.remainingDays <= 7 ? "is-warning" : "is-success"; const status = !item.synchronized ? "Rever" : item.autoExpire && item.remainingDays <= 7 ? `${item.remainingDays} d` : "Ativa"; return <div key={item.id}><span><strong>{item.title}</strong><small>{item.creator?.nickname || "Utilizador"} · {item.channelCount} canais · atividade {item.inactivityDays === 0 ? "hoje" : `há ${item.inactivityDays} d`}</small></span><span className="room-admin-controls"><span className={`status-chip ${tone}`}>{status}</span>{canManage && <button className="table-action is-danger" type="button" disabled={Boolean(busy)} onClick={async () => await confirmAction({ title: "Apagar sala permanente", message: `A sala “${item.title}” e os respetivos canais serão removidos do TeamSpeak.`, confirmLabel: "Apagar sala", danger: true }) && onDeleteRoom(item)}>{busy === `room:${item.id}` ? "A apagar..." : "Apagar"}</button>}</span></div>; })}{!visible.length && <p className="empty-admin-row">Não existem salas neste filtro.</p>}</div>
  </section>;
}

function RoomRecoveryCenter({ rooms = [], busy, onRecoverRoom, confirmAction }) {
  const [roomId, setRoomId] = useState(rooms[0]?.id || "");
  const [targetDatabaseId, setTargetDatabaseId] = useState("");
  useEffect(() => {
    if (!rooms.some((room) => room.id === roomId)) setRoomId(rooms[0]?.id || "");
  }, [rooms, roomId]);
  const selectedRoom = rooms.find((room) => room.id === roomId);
  async function submit(event) {
    event.preventDefault();
    const databaseId = Number(targetDatabaseId);
    if (!selectedRoom || !Number.isSafeInteger(databaseId) || databaseId <= 0) return;
    const approved = await confirmAction({
      title: "Transferir propriedade da sala",
      message: `“${selectedRoom.title}” deixa de pertencer a ${selectedRoom.creator?.nickname || "utilizador"} e passa para a identidade DB #${databaseId}. O Channel Admin será atualizado em toda a estrutura.`,
      confirmLabel: "Transferir propriedade",
      danger: true
    });
    if (!approved) return;
    if (await onRecoverRoom({ roomId: selectedRoom.id, targetDatabaseId: databaseId })) setTargetDatabaseId("");
  }
  return <section className="panel admin-section recovery-section">
    <div className="admin-section-head"><div><p className="eyebrow">Recuperação controlada</p><h3>Centro de recuperação de salas</h3></div><span className="status-chip is-success">Fundador</span></div>
    <div className="recovery-layout">
      <div className="recovery-explainer"><span className="recovery-symbol" aria-hidden="true">↔</span><div><strong>Transferência segura de propriedade</strong><p>Valida a identidade na base de dados do TeamSpeak, transfere Channel Admin em todas as subsalas e regista a operação na auditoria.</p></div></div>
      <form className="recovery-form" onSubmit={submit}>
        <label className="field"><span>Sala permanente</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)} required disabled={Boolean(busy) || !rooms.length}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.title} — {room.creator?.nickname || "Sem proprietário"}</option>)}</select></label>
        <label className="field"><span>Novo ID da base de dados TeamSpeak</span><input type="number" inputMode="numeric" min="1" step="1" value={targetDatabaseId} onChange={(event) => setTargetDatabaseId(event.target.value.replace(/\D/g, ""))} placeholder="Ex.: 2655" required disabled={Boolean(busy)} /></label>
        <div className="recovery-current"><span>Proprietário atual</span><strong>{selectedRoom?.creator?.nickname || "Indisponível"}</strong><small>{selectedRoom ? `DB #${selectedRoom.creator?.databaseId}` : "Seleciona uma sala"}</small></div>
        <button className="primary-button" type="submit" disabled={Boolean(busy) || !selectedRoom || !targetDatabaseId}>{busy === `recover:${roomId}` ? "A transferir..." : "Validar e transferir"}</button>
      </form>
      <div className="recovery-safeguards"><span><b>01</b> Identidade confirmada no TeamSpeak</span><span><b>02</b> Uma sala ativa por utilizador</span><span><b>03</b> Reversão automática se ocorrer uma falha</span></div>
    </div>
  </section>;
}

function AdminAlerts({ alerts = [], onRead, onNote, busy }) {
  const [filter, setFilter] = useState("new");
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState("");
  const active = alerts.filter((alert) => alert.active);
  const unread = alerts.filter((alert) => !alert.read);
  const filtered = alerts.filter((alert) => filter === "all" || (filter === "new" && !alert.read) || (filter === "active" && alert.active) || (filter === "resolved" && !alert.active));
  const filters = [{ key: "new", label: "Novas", count: unread.length }, { key: "active", label: "Ativas", count: active.length }, { key: "resolved", label: "Resolvidas", count: alerts.length - active.length }, { key: "all", label: "Todas", count: alerts.length }];
  return <section className="panel admin-section alerts-section">
    <div className="admin-section-head alerts-head"><div><p className="eyebrow">Caixa da staff</p><h3>Notificações operacionais</h3></div><div className="alerts-head-actions"><span className={`status-chip ${active.length ? "is-danger" : "is-success"}`}>{active.length ? `${active.length} ${active.length === 1 ? "ativo" : "ativos"}` : "Sem alertas"}</span>{unread.length > 0 && <button className="mark-all-button" type="button" disabled={Boolean(busy)} onClick={() => onRead(null)}>{busy === "alerts:all" ? "A guardar..." : `Marcar ${unread.length} como lida${unread.length === 1 ? "" : "s"}`}</button>}</div></div>
    <div className="alert-filter-bar" role="group" aria-label="Filtrar notificações">{filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}><span>{item.label}</span><b>{item.count}</b></button>)}</div>
    <div className="alerts-list">{filtered.map((alert) => <article className={`admin-alert is-${alert.severity} ${alert.active ? "is-active" : "is-resolved"} ${alert.read ? "is-read" : "is-unread"}`} key={alert.id}><span className="admin-alert-mark" aria-hidden="true">{alert.active ? "!" : "✓"}</span><div><span className="alert-title-line"><strong>{alert.type === "query" ? "ServerQuery" : alert.type === "security" ? "Segurança" : alert.type === "maintenance" ? "Manutenção" : "Sincronização"}</strong>{!alert.read && <b>Nova</b>}</span><p>{alert.message}</p><small>{alert.active ? `Detetado ${formatDate(alert.createdAt)}` : `Resolvido ${formatDate(alert.resolvedAt)}`}</small>{alert.staffNote && <p className="staff-note"><b>{alert.staffNoteBy || "Staff"}</b> · {alert.staffNote}</p>}{editing === alert.id && <form className="inline-note-form" onSubmit={async (event) => { event.preventDefault(); if (await onNote(alert.id, note)) setEditing(null); }}><input value={note} onChange={(event) => setNote(event.target.value)} maxLength="300" placeholder="Nota interna para a staff" autoFocus /><button type="submit" disabled={Boolean(busy)}>Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></form>}</div><div className="admin-alert-controls"><span className="admin-alert-state">{alert.active ? "Ação necessária" : "Resolvido"}</span>{!alert.read && <button className="alert-read-button" type="button" disabled={Boolean(busy)} onClick={() => onRead(alert.id)}>{busy === `alert:${alert.id}` ? "A guardar..." : "Marcar como lida"}</button>}<button className="text-action" type="button" onClick={() => { setEditing(alert.id); setNote(alert.staffNote || ""); }}>Nota interna</button></div></article>)}{!filtered.length && <div className="alerts-empty"><strong>Sem notificações neste filtro</strong><span>Os novos eventos surgem aqui automaticamente.</span></div>}</div>
  </section>;
}

function AdminDashboard({ data, busy, error, diagnostics, onRunDiagnostics, onRefresh, actionBusy, actionMessage, onReadAlert, onNoteAlert, onNoteIncident, onMaintenance, onCreateBackup, onRevokeSession, onDeleteRoom, onImportRooms, onRecoverRoom, confirmAction }) {
  if (!data && busy) return <AdminSkeleton />;
  if (!data) return <section className="panel admin-unavailable"><p className="eyebrow">Administração</p><h2>Não foi possível abrir a supervisão</h2><p>{error || "Volta a tentar dentro de alguns instantes."}</p><button className="primary-button" type="button" onClick={() => onRefresh(true)}>Tentar novamente</button></section>;

  const teamSpeak = data.health?.teamSpeak || {};
  const canManage = Boolean(data.permissions?.canManage);
  return <div className="admin-dashboard">
    <section className="admin-heading" aria-labelledby="admin-title">
      <div className="admin-heading-copy"><p className="admin-heading-kicker"><span aria-hidden="true" />Centro de operações</p><h2 id="admin-title">Administração e segurança</h2><p>{canManage ? "Supervisão do TeamSpeak, acessos e infraestrutura num único painel." : "Supervisão em modo de leitura. Os endereços de rede aparecem anonimizados."}</p></div>
      <div className="admin-heading-side"><div className="admin-command-state"><span className="command-state-dot" aria-hidden="true" /><div><strong>Monitorização ativa</strong><small>Atualização automática a cada 30 segundos</small></div></div><div className="admin-heading-actions"><span className={`readonly-badge ${canManage ? "is-manage" : ""}`}>{canManage ? "Acesso Fundador" : "Só leitura"}</span><button className="refresh-button" type="button" onClick={() => onRefresh(true)} disabled={busy || Boolean(actionBusy)}><span aria-hidden="true">↻</span>{busy ? "A atualizar..." : "Atualizar"}</button></div></div>
    </section>
    {error && <div className="admin-warning" role="status">{error} A mostrar os últimos dados disponíveis.</div>}
    {actionMessage.text && <div className={`admin-action-message is-${actionMessage.type}`} role="status">{actionMessage.text}</div>}
    <section className="metric-strip" aria-label="Resumo administrativo">
      <div className="admin-metric"><span className="metric-index">01</span><span className="metric-dot is-good" /><strong>{data.health?.queryLatencyMs ?? "-"} ms</strong><small>Resposta ServerQuery</small></div>
      <div className="admin-metric"><span className="metric-index">02</span><span className="metric-dot is-good" /><strong>{data.counts?.activeSessions ?? 0}</strong><small>Sessões web ativas</small></div>
      <div className={`admin-metric ${data.counts?.unsynchronizedRooms ? "has-alert" : ""}`}><span className="metric-index">03</span><span className={`metric-dot ${data.counts?.unsynchronizedRooms ? "is-alert" : "is-good"}`} /><strong>{data.counts?.activeRooms ?? 0}</strong><small>Salas permanentes</small></div>
      <div className={`admin-metric ${data.counts?.failures24h ? "has-alert" : ""}`}><span className="metric-index">04</span><span className={`metric-dot ${data.counts?.failures24h ? "is-alert" : "is-good"}`} /><strong>{data.counts?.failures24h ?? 0}</strong><small>Falhas nas últimas 24 h</small></div>
    </section>
    {canManage && <DiagnosticsPanel diagnostics={diagnostics} busy={actionBusy} onRun={onRunDiagnostics} />}
    <AdminAlerts alerts={data.alerts || []} onRead={onReadAlert} onNote={onNoteAlert} busy={actionBusy} />
    <OperationalChart history={data.history} />
    <div className="admin-grid">
      {canManage && <MaintenanceControl maintenance={data.maintenance} busy={actionBusy} onSave={onMaintenance} />}
      {canManage && <BackupManager backups={data.backups || []} busy={actionBusy} onCreate={onCreateBackup} />}
      <section className="panel admin-section health-section">
        <div className="admin-section-head"><div><p className="eyebrow">Estado atual</p><h3>Serviços</h3></div><span className="status-chip is-success">Operacional</span></div>
        <dl className="health-list">
          <div><dt>TeamSpeak</dt><dd>{teamSpeak.slotsUsed ?? 0} / {teamSpeak.slotsTotal ?? 0} utilizadores</dd></div>
          <div><dt>Uptime TeamSpeak</dt><dd>{formatDuration(teamSpeak.uptimeSeconds)}</dd></div>
          <div><dt>Processo web</dt><dd>{formatDuration(data.health?.processUptimeSeconds)}</dd></div>
          <div><dt>Base de dados</dt><dd>{formatBytes(data.health?.databaseBytes)}</dd></div>
          <div><dt>Último backup</dt><dd className={data.health?.backup?.latestAt ? "value-good" : "value-alert"}>{data.health?.backup?.latestAt ? formatDate(data.health.backup.latestAt) : "Pendente"}</dd></div>
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
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utilizador</th><th>Rede</th><th>Última atividade</th><th>Expira</th>{canManage && <th>Ação</th>}</tr></thead><tbody>{(data.sessions || []).map((session) => { const ownSession = Number(session.databaseId) === Number(data.administrator?.databaseId); return <tr key={`${session.databaseId}-${session.createdAt}`}><td><strong>{session.nickname}</strong><small>DB #{session.databaseId}</small></td><td>{session.ip}</td><td>{formatDate(session.lastSeenAt)}</td><td>{formatDate(session.expiresAt)}</td>{canManage && <td><button className="table-action" type="button" disabled={ownSession || Boolean(actionBusy)} title={ownSession ? "A tua sessão está protegida" : "Terminar todas as sessões deste utilizador"} onClick={async () => await confirmAction({ title: "Terminar sessões", message: `Todas as sessões web de ${session.nickname} serão revogadas.`, confirmLabel: "Terminar sessões", danger: true }) && onRevokeSession(session)}>{actionBusy === `session:${session.databaseId}` ? "A terminar..." : ownSession ? "Sessão atual" : "Terminar"}</button></td>}</tr>; })}{!data.sessions?.length && <tr><td colSpan={canManage ? 5 : 4} className="empty-table">Não existem sessões ativas.</td></tr>}</tbody></table></div>
      </section>
      <RoomOperations rooms={data.rooms || []} canManage={canManage} busy={actionBusy} onDeleteRoom={onDeleteRoom} onImportRooms={onImportRooms} confirmAction={confirmAction} />
      {canManage && <RoomRecoveryCenter rooms={data.rooms || []} busy={actionBusy} onRecoverRoom={onRecoverRoom} confirmAction={confirmAction} />}
      <IncidentTimeline incidents={data.history?.incidents || []} busy={actionBusy} onNote={onNoteIncident} canManage={canManage} />
      <AuditLog entries={data.audit || []} />
    </div>
    <p className="admin-updated">Dados atualizados em {formatDate(data.fetchedAt)}.</p>
  </div>;
}

function Footer() {
  return <footer className="footer">
    <a className="footer-brand" href="/" aria-label="LegendZ Community, início"><span className="brand-mark">LZ</span><span><strong>LegendZ</strong><small>Community Network</small></span></a>
    <p>Copyright © {new Date().getFullYear()} realizado com <span className="heart">♥</span> por <a href="https://steamcommunity.com/id/mazarati21" target="_blank" rel="noreferrer">Mazarati</a>{" · "}<a href="https://legendzcommunity.com/" target="_blank" rel="noreferrer">legendzcommunity.com</a></p>
  </footer>;
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [auth, setAuth] = useState({ loading: true, authenticated: false, teamSpeakOnline: true, connected: false, candidates: [], activeRoom: null });
  const [sections, setSections] = useState([]), [selections, setSelections] = useState({}), [savedSelections, setSavedSelections] = useState({});
  const [groupMessage, setGroupMessage] = useState({ text: "", type: "neutral" }), [roomMessage, setRoomMessage] = useState({ text: "", type: "neutral" });
  const [groupsBusy, setGroupsBusy] = useState(false), [roomBusy, setRoomBusy] = useState(false), [roomOpen, setRoomOpen] = useState(false);
  const [view, setView] = useState("panel"), [adminData, setAdminData] = useState(null), [adminBusy, setAdminBusy] = useState(false), [adminError, setAdminError] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(""), [adminActionMessage, setAdminActionMessage] = useState({ text: "", type: "success" });
  const [diagnostics, setDiagnostics] = useState(null);
  const [toast, setToast] = useState(null), [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolver = useRef(null);
  const room = useMemo(() => normalizeRoom(auth.activeRoom), [auth.activeRoom]);
  function showToast(text, type = "success") { setToast({ text, type, id: Date.now() }); }
  function confirmAction(options) {
    return new Promise((resolve) => { confirmResolver.current = resolve; setConfirmDialog(options); });
  }
  function resolveConfirm(result) {
    confirmResolver.current?.(result); confirmResolver.current = null; setConfirmDialog(null);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const alternateBackground = new Image();
    alternateBackground.src = `${appBasePath}/assets/background-${theme === "dark" ? "light" : "dark"}.png?v=2`;
  }, [theme]);
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(null), 4500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!confirmDialog) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") resolveConfirm(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog]);

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
    try { const result = await api("/api/admin/sessions/revoke", { method: "POST", body: JSON.stringify({ databaseId: session.databaseId }) }); const text = `${result.revoked} sessão${result.revoked === 1 ? "" : "ões"} de ${session.nickname} terminada${result.revoked === 1 ? "" : "s"}.`; setAdminActionMessage({ text, type: "success" }); showToast(text); await refreshAdmin(false); }
    catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function deleteAdminRoom(room) {
    setAdminActionBusy(`room:${room.id}`); setAdminActionMessage({ text: "", type: "success" });
    try { await api("/api/admin/rooms", { method: "DELETE", body: JSON.stringify({ id: room.id }) }); const text = `A sala “${room.title}” foi removida do TeamSpeak.`; setAdminActionMessage({ text, type: "success" }); showToast(text); await refreshAdmin(false); }
    catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function importLegacyRooms() {
    setAdminActionBusy("rooms:import"); setAdminActionMessage({ text: "", type: "success" });
    try {
      const result = await api("/api/admin/rooms/import", { method: "POST", body: "{}" });
      const count = result.imported?.length || 0;
      const text = count ? `${count} ${count === 1 ? "sala antiga importada" : "salas antigas importadas"} com sucesso.` : "Não foram encontradas novas salas antigas compatíveis.";
      setAdminActionMessage({ text, type: count ? "success" : "neutral" }); showToast(text, count ? "success" : "neutral");
      await Promise.all([refreshAdmin(false), refreshAuth()]);
    } catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function recoverAdminRoom(payload) {
    setAdminActionBusy(`recover:${payload.roomId}`); setAdminActionMessage({ text: "", type: "success" });
    try {
      const result = await api("/api/admin/rooms/recover", { method: "POST", body: JSON.stringify(payload) });
      const text = `A sala “${result.room.title}” pertence agora a ${result.room.creator.nickname} (DB #${result.room.creator.databaseId}).`;
      setAdminActionMessage({ text, type: "success" }); showToast("Propriedade e Channel Admin transferidos.");
      await Promise.all([refreshAdmin(false), refreshAuth()]);
      return true;
    } catch (error) {
      setAdminActionMessage({ text: error.message, type: "error" }); showToast(error.message, "error");
      return false;
    } finally { setAdminActionBusy(""); }
  }

  async function markAdminAlertRead(alertId) {
    const busyKey = alertId == null ? "alerts:all" : `alert:${alertId}`;
    setAdminActionBusy(busyKey); setAdminActionMessage({ text: "", type: "success" });
    try {
      await api("/api/admin/alerts/read", { method: "POST", body: JSON.stringify(alertId == null ? { all: true } : { id: alertId }) });
      await refreshAdmin(false);
    } catch (error) { setAdminActionMessage({ text: error.message, type: "error" }); }
    finally { setAdminActionBusy(""); }
  }

  async function saveAdminAlertNote(alertId, note) {
    setAdminActionBusy(`alert-note:${alertId}`);
    try { await api("/api/admin/alerts/note", { method: "POST", body: JSON.stringify({ id: alertId, note }) }); showToast("Nota interna guardada."); await refreshAdmin(false); return true; }
    catch (error) { showToast(error.message, "error"); return false; }
    finally { setAdminActionBusy(""); }
  }

  async function saveIncidentNote(incidentId, note) {
    setAdminActionBusy(`incident-note:${incidentId}`);
    try { await api("/api/admin/incidents/note", { method: "POST", body: JSON.stringify({ id: incidentId, note }) }); showToast("Nota pública atualizada."); await refreshAdmin(false); return true; }
    catch (error) { showToast(error.message, "error"); return false; }
    finally { setAdminActionBusy(""); }
  }

  async function updateMaintenance(enabled, message) {
    const approved = await confirmAction({ title: enabled ? "Ativar manutenção" : "Desativar manutenção", message: enabled ? "Os utilizadores deixam temporariamente de poder alterar grupos e salas." : "O painel volta a aceitar alterações de todos os utilizadores autenticados.", confirmLabel: enabled ? "Ativar" : "Desativar", danger: enabled });
    if (!approved) return;
    setAdminActionBusy("maintenance");
    try { await api("/api/admin/maintenance", { method: "POST", body: JSON.stringify({ enabled, message }) }); showToast(enabled ? "Modo de manutenção ativado." : "Modo de manutenção desativado."); await Promise.all([refreshAdmin(false), refreshAuth()]); }
    catch (error) { showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function createManualBackup() {
    setAdminActionBusy("backup:create");
    try { await api("/api/admin/backups", { method: "POST", body: "{}" }); showToast("Backup manual criado e verificado."); await refreshAdmin(false); }
    catch (error) { showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function runDiagnostics() {
    setAdminActionBusy("diagnostics");
    try {
      const result = await api("/api/admin/diagnostics", { method: "POST", body: "{}" });
      setDiagnostics(result.diagnostics);
      const summary = result.diagnostics?.summary;
      showToast(summary?.fail ? `${summary.fail} ${summary.fail === 1 ? "falha encontrada" : "falhas encontradas"} no diagnóstico.` : summary?.warn ? `Diagnóstico concluído com ${summary.warn} ${summary.warn === 1 ? "aviso" : "avisos"}.` : "Diagnóstico concluído sem problemas.", summary?.fail ? "error" : "success");
      await refreshAdmin(false);
    } catch (error) { showToast(error.message, "error"); }
    finally { setAdminActionBusy(""); }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    csrfToken = ""; setSections([]); setSelections({}); setSavedSelections({}); setRoomOpen(false); setView("panel"); setAdminData(null); setDiagnostics(null); setAdminError(""); setAdminActionMessage({ text: "", type: "success" }); await refreshAuth();
  }
  async function applyGroups() {
    setGroupsBusy(true); setGroupMessage({ text: "A guardar grupos no TeamSpeak...", type: "neutral" });
    try { const payload = await api("/api/groups", { method: "POST", body: JSON.stringify({ selections }) }); const selected = payload.selected || selections; setSections(payload.categories || sections); setSelections(selected); setSavedSelections(selected); setGroupMessage({ text: "Grupos atualizados no TeamSpeak.", type: "success" }); showToast("Grupos atualizados no TeamSpeak."); }
    catch (error) { setGroupMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); } finally { setGroupsBusy(false); }
  }
  async function createRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A criar a sala no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "POST", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomOpen(true); const text = `Sala criada com ${result.room.channels.length} ${result.room.channels.length === 1 ? "subsala" : "subsalas"}.`; setRoomMessage({ text: `${text} Recebeste Channel Admin em toda a estrutura.`, type: "success" }); showToast(text); return true; }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); return false; } finally { setRoomBusy(false); }
  }
  async function updateRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A guardar alterações no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "PATCH", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomMessage({ text: "Estrutura da sala atualizada no TeamSpeak.", type: "success" }); showToast("Sala atualizada no TeamSpeak."); return true; }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); return false; } finally { setRoomBusy(false); }
  }
  async function deleteRoom(target) {
    setRoomBusy(true); setRoomMessage({ text: "A apagar a sala no TeamSpeak...", type: "neutral" });
    try { await api("/api/rooms", { method: "DELETE", body: JSON.stringify({ id: target.id }) }); setAuth((current) => ({ ...current, activeRoom: null })); setRoomOpen(false); setRoomMessage({ text: "Sala apagada. O separador fixo foi preservado.", type: "success" }); showToast("Sala apagada; o separador protegido foi preservado."); }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); showToast(error.message, "error"); } finally { setRoomBusy(false); }
  }

  function navigateMobile(target) {
    const targetView = target === "admin" ? "admin" : "panel";
    setView(targetView);
    window.setTimeout(() => document.getElementById(target === "admin" ? "admin-area" : target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  const enabled = auth.authenticated && auth.connected && !auth.maintenance?.enabled;
  return <><main className="app-shell" id="panel-top">
    <header className="hero">
      <a className="brand-lockup" href="/" aria-label="LegendZ Community, início"><span className="brand-mark">LZ</span><div><p className="eyebrow">LegendZ Community</p><h1>Control Center</h1></div></a>
      <nav className="panel-links" aria-label="Navegação LegendZ"><a href="/">Início</a><a href="/status/">Estado</a><a href="/bans/">Bans</a></nav>
      <div className="header-actions"><ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />{auth.authenticated && <button className="logout-button" type="button" onClick={logout}>Sair</button>}<StatusPill auth={auth} /></div>
    </header>
    <section className="intro-bar" aria-label="Resumo do painel"><div><strong>1–4</strong><span>subsalas por espaço</span></div><div><strong>1</strong><span>sala por utilizador</span></div><div><strong>Auto</strong><span>Channel Admin</span></div><p>Gere os teus grupos e a tua sala com confirmação segura através do TeamSpeak.</p></section>
    <MaintenanceBanner maintenance={auth.maintenance} />
    {!auth.loading && !auth.authenticated && <AuthPanel auth={auth} onAuthenticated={refreshAll} />}
    {auth.loading && <section className="panel loading-panel"><span className="loader" /><strong>A preparar o painel...</strong></section>}
    {auth.authenticated && auth.isAdmin && <nav className="view-switcher" aria-label="Área do painel"><button type="button" className={view === "panel" ? "is-active" : ""} aria-current={view === "panel" ? "page" : undefined} onClick={() => setView("panel")}>O meu painel</button><button type="button" className={view === "admin" ? "is-active" : ""} aria-current={view === "admin" ? "page" : undefined} onClick={() => setView("admin")}>Administração{Boolean(adminData?.counts?.unreadAlerts) && <span className="nav-alert-count">{adminData.counts.unreadAlerts}</span>}</button></nav>}
    {auth.authenticated && view === "panel" && <div className="dashboard"><ProfilePanel auth={auth} room={room} sections={sections} selections={selections} /><GroupsPanel sections={sections} selections={selections} setSelections={setSelections} savedSelections={savedSelections} onApply={applyGroups} busy={groupsBusy} message={groupMessage} enabled={enabled} /><div className="side-stack"><CreatorPanel enabled={enabled} hasActiveRoom={Boolean(room)} onCreate={createRoom} message={roomMessage} busy={roomBusy} /><RoomTree room={room} open={roomOpen} setOpen={setRoomOpen} onUpdate={updateRoom} onDelete={deleteRoom} busy={roomBusy} enabled={enabled} confirmAction={confirmAction} /></div></div>}
    {auth.authenticated && auth.isAdmin && view === "admin" && <div id="admin-area"><AdminDashboard data={adminData} busy={adminBusy} error={adminError} diagnostics={diagnostics} onRunDiagnostics={runDiagnostics} onRefresh={refreshAdmin} actionBusy={adminActionBusy} actionMessage={adminActionMessage} onReadAlert={markAdminAlertRead} onNoteAlert={saveAdminAlertNote} onNoteIncident={saveIncidentNote} onMaintenance={updateMaintenance} onCreateBackup={createManualBackup} onRevokeSession={revokeAdminSession} onDeleteRoom={deleteAdminRoom} onImportRooms={importLegacyRooms} onRecoverRoom={recoverAdminRoom} confirmAction={confirmAction} /></div>}
    <Footer />
  </main>{auth.authenticated && <nav className="mobile-command-bar" aria-label="Navegação rápida"><button type="button" onClick={() => navigateMobile("panel-top")}><span aria-hidden="true">⌂</span>Painel</button><button type="button" onClick={() => navigateMobile("groups-panel")}><span aria-hidden="true">#</span>Grupos</button><button type="button" onClick={() => navigateMobile(room ? "room-manager" : "room-creator")}><span aria-hidden="true">+</span>Sala</button>{auth.isAdmin && <button type="button" onClick={() => navigateMobile("admin")}><span aria-hidden="true">!</span>Admin{Boolean(adminData?.counts?.unreadAlerts) && <b>{adminData.counts.unreadAlerts}</b>}</button>}</nav>}<ToastRegion toast={toast} onClose={() => setToast(null)} /><ConfirmDialog dialog={confirmDialog} onResolve={resolveConfirm} /></>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
