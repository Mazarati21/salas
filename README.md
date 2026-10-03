# LegendZ TeamSpeak Panel

Painel web para autenticar utilizadores através do TeamSpeak, gerir grupos e criar uma sala permanente com quatro subsalas.

## Funcionalidades

- Autenticação por código privado enviado ao cliente TeamSpeak ligado.
- Sessões `HttpOnly`, `SameSite=Strict`, ligadas ao IP e ao browser, com proteção CSRF.
- Uma sala ativa por `client_database_id`, garantida também por restrição SQLite.
- Channel Admin automático na sala principal e nas quatro subsalas.
- Palavra-passe independente por subsala, com ações explícitas para manter, alterar ou remover.
- Ligação ServerQuery persistente, serializada e com reconexão automática.
- Grupos permitidos definidos no servidor; `Membro` e grupos internos não são expostos.
- SQLite em WAL para salas, sessões, desafios, limites e auditoria.
- Tema claro e escuro, layout responsivo e ícones reais do TeamSpeak.

## Desenvolvimento

Requer Node.js 24 ou posterior.

```powershell
npm install
npm run build
npm test
```

Define as variáveis `TS_HOST`, `TS_QUERY_PORT`, `TS_VOICE_PORT`, `TS_USER` e `TS_PASS`, e depois executa:

```powershell
$env:ALLOW_LOCAL_QUERY_OWNER_FALLBACK="1"
npm start
```

`ALLOW_LOCAL_QUERY_OWNER_FALLBACK` existe apenas para desenvolvimento na mesma máquina. Nunca deve ser ativado online.

## Publicação no cPanel

No **Setup Node.js App** do cPanel configura:

- Node.js `22.13` ou superior; Node.js 24 é recomendado.
- Application mode: `Production`.
- Application root: a pasta do repositório.
- Application URL: o domínio ou subdomínio escolhido.
- Application startup file: `server.js`.

Adiciona no próprio cPanel as variáveis de `.env.example`. Em particular:

- `NODE_ENV=production`
- `APP_HOST=teu-dominio.pt` sem `https://` nem caminho
- `TRUST_PROXY=1`
- `SESSION_SECRET` com pelo menos 32 caracteres aleatórios
- todas as variáveis `TS_*` com os valores de produção

Não cries `ALLOW_LOCAL_QUERY_OWNER_FALLBACK` em produção. O cPanel fornece `PORT` automaticamente; utiliza esse valor em vez de fixar uma porta manualmente.

Depois do clone ou atualização executa `npm ci`, confirma que `data/` pode ser escrita pelo utilizador da aplicação e reinicia a aplicação no cPanel. O JavaScript do browser já segue compilado no Git; `npm run build` só é necessário quando `app.jsx` for alterado.

O alojamento tem de permitir ligações TCP de saída para a porta ServerQuery e para a porta de transferência de ficheiros do TeamSpeak, usada para os ícones. A conta Query deve aceitar apenas o IP público do alojamento.

Se o cPanel estiver atrás de Cloudflare, ativa a restauração segura do IP real no servidor web. A aplicação compara o IP do visitante com o IP da ligação TeamSpeak e não deve confiar diretamente num `X-Forwarded-For` enviado da Internet.

### Git Version Control

O repositório inclui todo o código e o bundle compilado. `.env`, SQLite, sessões, auditoria e cache de ícones estão excluídos pelo `.gitignore`. Depois de associares um remote, o cPanel pode clonar o repositório através de **Git Version Control** e usar essa pasta como Application root.

Um `.cpanel.yml` só deve ser criado depois de saber o caminho absoluto da aplicação, por exemplo `/home/utilizador/apps/legendz`. Um caminho incorreto pode publicar ficheiros na pasta errada.

## Publicação num VPS

1. Copia `.env.example` para `.env` e preenche os valores sem versionar esse ficheiro.
2. Gera `SESSION_SECRET` com pelo menos 32 caracteres aleatórios.
3. Define `APP_HOST` apenas com o domínio público, sem protocolo nem porta.
4. Mantém o Node em `127.0.0.1:5175` e publica apenas o reverse proxy HTTPS.
5. No proxy, substitui `X-Forwarded-For` por `$remote_addr`; não anexes valores enviados pelo visitante.
6. Compila com `npm ci && npm run build && npm test` antes de reiniciar o serviço.

Os exemplos em `deploy/` incluem uma unidade systemd limitada e uma configuração Nginx HTTPS. Substitui `panel.example.com`, instala o certificado e cria o utilizador de sistema `legendz` antes de os ativar.

## Dados e manutenção

- Base de dados: `data/legendz.sqlite`
- Cache de ícones: `data/icons/`
- Auditoria: tabela `audit_log`
- Backup: copia o ficheiro SQLite com o serviço parado, ou utiliza a API de backup do SQLite.

O processo deve ter escrita apenas em `data/`. Nunca publiques `.env`, `data/` ou a porta ServerQuery. Limita também o acesso ServerQuery ao IP do servidor web e concede à conta Query apenas as permissões estritamente necessárias.
