const { useEffect, useMemo, useState } = React;

const THEME_KEY = "legendz-theme";
const channelNames = ["Convivio 1", "Convivio 2", "Convivio 3", "Convivio 4"];
let csrfToken = "";

function normalizeRoom(room) {
  if (!room) return null;
  return { ...room, channels: channelNames.map((name, index) => ({
    ...(room.channels?.[index] || {}), name,
    passwordProtected: Boolean(room.channels?.[index]?.passwordProtected)
  })) };
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
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
  return <button className="theme-toggle" type="button" onClick={onToggle}>{theme === "dark" ? "Modo claro" : "Modo escuro"}</button>;
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
      {message.text && <div className={`message is-${message.type}`}>{message.text}</div>}
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
    <div className="groups-actions"><button className="primary-button" type="button" disabled={!enabled || !dirty || busy || sections.length === 0} onClick={onApply}>{busy ? "A guardar..." : dirty ? "Guardar grupos" : "Grupos atualizados"}</button>{message.text && <div className={`message is-${message.type}`}>{message.text}</div>}</div>
  </section>;
}

function CreatorPanel({ enabled, hasActiveRoom, onCreate, message, busy }) {
  const [title, setTitle] = useState("");
  const [passwords, setPasswords] = useState(["", "", "", ""]);
  async function submit(event) {
    event.preventDefault();
    const created = await onCreate({ title: title.trim(), channels: channelNames.map((name, index) => ({ name, password: passwords[index].trim() })) });
    if (created) { setTitle(""); setPasswords(["", "", "", ""]); }
  }
  return <section className="panel creator-panel"><div className="panel-top split"><div><p className="eyebrow">Nova estrutura</p><h2>Criar sala permanente</h2></div><div className="mini-rule"><span>1 sala por utilizador</span><strong>Admin automático</strong></div></div><form className="creator-form" onSubmit={submit}><label className="field big-field"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" placeholder="Ex.: Ortigas mais 4" required disabled={!enabled || hasActiveRoom} /></label><div className="password-grid">{channelNames.map((name, index) => <label className="field" key={name}><span>Palavra-passe do {name}</span><input type="password" autoComplete="new-password" value={passwords[index]} onChange={(event) => { const next = [...passwords]; next[index] = event.target.value; setPasswords(next); }} maxLength="24" placeholder="Sem palavra-passe" disabled={!enabled || hasActiveRoom} /></label>)}</div><button className="primary-button" disabled={!enabled || hasActiveRoom || busy}>{busy ? "A criar..." : hasActiveRoom ? "Já tens uma sala ativa" : "Criar sala"}</button></form>{message.text && <div className={`message is-${message.type}`}>{message.text}</div>}</section>;
}

function RoomTree({ room, open, setOpen, onUpdate, onDelete, busy }) {
  return <section className="panel tree-panel"><div className="panel-top"><div><p className="eyebrow">Estrutura ativa</p><h2>A tua sala</h2></div></div><div className="tree-body">{!room && <div className="empty-tree"><strong>Nenhuma sala ativa</strong><span>A sala criada aparece aqui e no TeamSpeak.</span></div>}{room && <RoomCard room={room} isOpen={open} setOpen={() => setOpen(!open)} onUpdate={onUpdate} onDelete={onDelete} busy={busy} />}<div className="temporary-block"><div className="protected-line">━</div><strong>SALAS TEMPORÁRIAS</strong><span>═════════════════════</span></div></div></section>;
}

function RoomCard({ room, isOpen, setOpen, onUpdate, onDelete, busy }) {
  const [title, setTitle] = useState(room.title);
  const [actions, setActions] = useState(["keep", "keep", "keep", "keep"]);
  const [passwords, setPasswords] = useState(["", "", "", ""]);
  useEffect(() => { setTitle(room.title); setActions(["keep", "keep", "keep", "keep"]); setPasswords(["", "", "", ""]); }, [room]);
  async function submit(event) {
    event.preventDefault();
    const updated = await onUpdate({ id: room.id, title: title.trim() || room.title, channels: channelNames.map((name, index) => ({ name, passwordAction: actions[index], password: actions[index] === "change" ? passwords[index].trim() : "" })) });
    if (updated) { setActions(["keep", "keep", "keep", "keep"]); setPasswords(["", "", "", ""]); }
  }
  return <article className={`room-card ${isOpen ? "is-open" : ""}`}><div className="thick-line" /><button className="room-main" type="button" onClick={setOpen} aria-expanded={isOpen}><span>{room.title}</span><small>Admin: {room.creator?.nickname || "utilizador"}</small></button><ul className="channel-list">{room.channels.map((channel) => <li key={channel.name}><span className="check">✓</span><span>● {channel.name}</span>{channel.passwordProtected && <span className="lock">Protegida</span>}</li>)}</ul>{isOpen && <form className="admin-panel" onSubmit={submit}><label className="field wide"><span>Nome central / título</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength="27" required /></label>{channelNames.map((name, index) => <div className="password-editor" key={name}><label className="field"><span>{name}</span><select value={actions[index]} onChange={(event) => { const next = [...actions]; next[index] = event.target.value; setActions(next); }}><option value="keep">{room.channels[index]?.passwordProtected ? "Manter palavra-passe" : "Continuar sem palavra-passe"}</option><option value="change">{room.channels[index]?.passwordProtected ? "Definir nova palavra-passe" : "Adicionar palavra-passe"}</option>{room.channels[index]?.passwordProtected && <option value="remove">Remover palavra-passe</option>}</select></label>{actions[index] === "change" && <label className="field"><span>Nova palavra-passe</span><input type="password" autoComplete="new-password" value={passwords[index]} onChange={(event) => { const next = [...passwords]; next[index] = event.target.value; setPasswords(next); }} maxLength="24" required placeholder="Até 24 caracteres" /></label>}</div>)}<div className="admin-actions"><button className="primary-button" disabled={busy}>{busy ? "A guardar..." : "Guardar alterações"}</button><button className="danger-button" type="button" disabled={busy} onClick={() => window.confirm("Apagar esta sala e as quatro subsalas do TeamSpeak?") && onDelete(room)}>Apagar sala</button></div></form>}</article>;
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
  const room = useMemo(() => normalizeRoom(auth.activeRoom), [auth.activeRoom]);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; localStorage.setItem(THEME_KEY, theme); }, [theme]);

  async function refreshAuth() {
    try { const payload = await api("/api/auth/status"); csrfToken = payload.csrfToken || ""; setAuth({ loading: false, ...payload, activeRoom: normalizeRoom(payload.activeRoom) }); return payload; }
    catch (error) { csrfToken = ""; setAuth({ loading: false, authenticated: false, teamSpeakOnline: false, connected: false, candidates: [], activeRoom: null, error: error.message }); return null; }
  }
  async function refreshGroups() {
    try { const payload = await api("/api/groups"); setSections(payload.categories || []); setSelections(payload.selected || {}); setSavedSelections(payload.selected || {}); }
    catch (error) { setGroupMessage({ text: error.message, type: "error" }); }
  }
  async function refreshAll() { const next = await refreshAuth(); if (next?.authenticated && next.connected) await refreshGroups(); }
  useEffect(() => { refreshAll(); const timer = window.setInterval(refreshAuth, 30000); return () => window.clearInterval(timer); }, []);

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    csrfToken = ""; setSections([]); setSelections({}); setSavedSelections({}); setRoomOpen(false); await refreshAuth();
  }
  async function applyGroups() {
    setGroupsBusy(true); setGroupMessage({ text: "A guardar grupos no TeamSpeak...", type: "neutral" });
    try { const payload = await api("/api/groups", { method: "POST", body: JSON.stringify({ selections }) }); const selected = payload.selected || selections; setSections(payload.categories || sections); setSelections(selected); setSavedSelections(selected); setGroupMessage({ text: "Grupos atualizados no TeamSpeak.", type: "success" }); }
    catch (error) { setGroupMessage({ text: error.message, type: "error" }); } finally { setGroupsBusy(false); }
  }
  async function createRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A criar a sala no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "POST", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomOpen(true); setRoomMessage({ text: "Sala criada. Recebeste Channel Admin nas cinco salas.", type: "success" }); return true; }
    catch (error) { setRoomMessage({ text: error.message, type: "error" }); return false; } finally { setRoomBusy(false); }
  }
  async function updateRoom(payload) {
    setRoomBusy(true); setRoomMessage({ text: "A guardar alterações no TeamSpeak...", type: "neutral" });
    try { const result = await api("/api/rooms", { method: "PATCH", body: JSON.stringify(payload) }); setAuth((current) => ({ ...current, activeRoom: normalizeRoom(result.room) })); setRoomMessage({ text: "Alterações guardadas.", type: "success" }); return true; }
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
    <section className="intro-bar" aria-label="Resumo do painel"><div><strong>4</strong><span>subsalas por espaço</span></div><div><strong>1</strong><span>sala por utilizador</span></div><div><strong>Auto</strong><span>Channel Admin</span></div><p>Gere os teus grupos e a tua sala com confirmação segura através do TeamSpeak.</p></section>
    {!auth.loading && !auth.authenticated && <AuthPanel auth={auth} onAuthenticated={refreshAll} />}
    {auth.loading && <section className="panel loading-panel"><span className="loader" /><strong>A preparar o painel...</strong></section>}
    {auth.authenticated && <div className="dashboard"><GroupsPanel sections={sections} selections={selections} setSelections={setSelections} savedSelections={savedSelections} onApply={applyGroups} busy={groupsBusy} message={groupMessage} enabled={enabled} /><div className="side-stack"><CreatorPanel enabled={enabled} hasActiveRoom={Boolean(room)} onCreate={createRoom} message={roomMessage} busy={roomBusy} /><RoomTree room={room} open={roomOpen} setOpen={setRoomOpen} onUpdate={updateRoom} onDelete={deleteRoom} busy={roomBusy} /></div></div>}
    <Footer />
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
