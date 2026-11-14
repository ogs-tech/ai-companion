# Controle remoto das sessões pelo celular — design

Data: 2026-11-10. Status: aguardando aprovação.

## Intenção

O dono do app sai da frente do PC, mas quer continuar acompanhando e respondendo às sessões dos agentes (Claude, Cursor, LM Studio). Hoje, se uma sessão pede aprovação enquanto ele está na cozinha ou na rua, ela fica parada até ele voltar. O celular deve ser um controle remoto completo das **sessões**, com leitura de **Arquivos** e **Git** como apoio de contexto.

Sucesso: o dono aprova um pedido, manda uma instrução ou abre uma sessão nova pelo celular, dentro e fora de casa, sem expor o PC à internet pública.

## Metas

- Ver a lista de sessões com o estado de cada uma (Pergunta, Trabalhando, Ocioso, Fechado) e o que precisa de resposta primeiro.
- Abrir uma sessão e ver a saída do terminal ao vivo, com o histórico já produzido.
- Responder: digitar texto, aprovar/negar um pedido de permissão, enviar Esc, setas e Ctrl+C por teclas rápidas.
- Criar uma sessão nova (workspace e canal à escolha), encerrar e remover sessões.
- Ver arquivos do workspace (somente leitura) e o estado do Git (branch, mudanças, diff), e commitar.
- Funcionar dentro e fora de casa, com o mesmo endereço.

## Não-metas

- Editar arquivos pelo celular.
- Git além de ver e commitar: sem push, pull, troca de branch, discard ou stage seletivo na v1.
- Os terminais comuns (`terminal.*`), o navegador embutido, Configurações, plugins, marketplaces, credenciais.
- App nativo. A interface é uma página web aberta no navegador do celular.
- Vários usuários. Existe um dono e os dispositivos que ele pareou.
- Funcionar com o PC dormindo ou desligado. O PC fica ligado com o app aberto.

## Anti-metas (seria falha mesmo funcionando)

- Qualquer porta do app acessível da internet pública, ou por qualquer pessoa da mesma rede Wi-Fi sem pareamento.
- O celular conseguir ler ou escrever fora dos workspaces abertos (por exemplo `~/.ssh`).
- Um token vazado dar acesso para sempre, sem como revogar.
- O recurso ligado por padrão. Precisa de um passo consciente para ligar.

## O que o dono decidiu

- Interface: **opção A, três abas** (Sessões, Arquivos, Git) com barra de baixo. Dentro de uma sessão o terminal ocupa a tela, com uma barra de teclas rápidas (Aprovar, Negar, Esc, seta para cima) e um campo "Responder…". Mockup aprovado: https://claude.ai/artifact/7pZddxdLxJFQcavEuHdJno
- Acesso: ele quer algo seguro que funcione também fora da rede de casa. Ele nunca usou VPN.
- O PC fica ligado com o app aberto.

## Decisões minhas (o dono pode revisar)

1. **Rede: Tailscale.** VPN gratuita, instalada no PC e no celular. O mesmo endereço funciona em casa e fora. Nada é aberto no roteador. Alternativas descartadas: porta aberta no roteador (exposição pública), Cloudflare Tunnel (exige domínio e deixa o tráfego passar por terceiro).
2. **O app escuta só em `127.0.0.1`.** O Tailscale publica esse serviço na rede privada (`tailscale serve`, que também entrega HTTPS com certificado válido). Assim o app nunca escuta em interface de rede aberta. O app mostra o comando exato e o endereço resultante na tela de configuração.
3. **Pareamento por código.** O app mostra um código de uso único (QR e texto). O celular o troca por um token de dispositivo de longa duração, guardado hasheado no PC. Cada dispositivo tem nome e pode ser revogado individualmente.
4. **Desligado por padrão**, em Configurações (nova página em Config). Desligar encerra o servidor e invalida as conexões abertas.
5. **Lista de métodos permitidos (allowlist).** O servidor remoto expõe só um subconjunto do contrato IPC existente (`session.*`, leitura de `git.*` mais `git.commit`, leitura de arquivos e listagem de workspaces). Tudo o mais responde `not_found`.
6. **Arquivos: somente leitura**, restritos às pastas dos workspaces abertos. O caminho é resolvido e comparado com a raiz depois de seguir links simbólicos, para impedir saída por `..` ou symlink.
7. **Git na v1:** ver status, ver diff, commitar o que já está em stage, ou fazer stage de tudo e commitar. A mensagem pode ser escrita ou gerada pelo `git.generateCommitMessage` que já existe.
8. **Tempo real:** WebSocket para a saída das sessões e para as mudanças de estado, no lugar dos canais de push do Electron.
9. **Página web:** servida pelo próprio app, em React com a mesma identidade visual do app (tokens do tema OGS em `src/renderer/tokens.ts`: Space Grotesk, JetBrains Mono, creme e tinta). Terminal renderizado com xterm.js, que o app já usa. Pode ser instalada na tela inicial (PWA simples, sem service worker offline).
10. **Nova sessão pelo celular:** mesma operação `session.spawn`, com workspace e canal escolhidos numa folha de baixo.

## Decisões minhas, segunda rodada (após revisão)

11. **Pareamento:** o código vale 5 minutos, é de uso único e permite 5 tentativas erradas antes de ser invalidado. O app no PC mostra "Parear este dispositivo?" com o nome informado pelo celular, e só conclui depois de o dono confirmar no PC.
12. **Token de dispositivo:** vale até ser revogado, sem expiração. No celular fica num cookie `HttpOnly`, `Secure`, `SameSite=Strict`. O PC guarda só o hash. A revogação e o "desligar" derrubam na hora as conexões WebSocket abertas do dispositivo.
13. **Autenticação em toda requisição, inclusive vindas de `localhost`.** Nenhum processo local acessa o servidor sem token. O WebSocket confere o cabeçalho `Origin`. O `tailscale serve` é usado em modo tailnet apenas, nunca `funnel`. O app não confia nos cabeçalhos de identidade do Tailscale; o token é a barreira.
14. **Ciclo de vida:** o servidor roda no processo principal do Electron e só sobe quando o recurso está ligado (nova chave em `Settings`, desligada por padrão). No macOS ele continua enquanto o processo estiver vivo, mesmo com a janela fechada.
15. **Tamanho do terminal:** o PC manda. O celular não redimensiona o PTY; mostra a saída na largura do PTY, com rolagem horizontal.
16. **Histórico ao abrir:** o que `SessionService` já guarda em `outputBuffer` (limitado em memória). Se for insuficiente na prática, ampliar o buffer é decisão de quem constrói.
17. **Aprovar e Negar:** usar `session.answerPermission` quando houver `permissionRequest` publicado; caso contrário, enviar a tecla que o canal usa, definida por canal por quem constrói e confirmada contra o CLI real.

## Mockups

Arquivo: [`2026-11-10-remote-sessions-mockup.html`](2026-11-10-remote-sessions-mockup.html) (abre direto no navegador; mostra as três opções lado a lado). Os textos e nomes nele são exemplos. O visual segue os tokens do app (`src/renderer/tokens.ts`). Não foi conferido em celular real nem no tema escuro.

### Opção escolhida: A, três abas

Barra de baixo fixa com **Sessões**, **Arquivos** e **Git**. Quatro telas:

1. **Sessões (lista).** Título "Sessões" e, à direita, o workspace ativo (toca para trocar). Uma linha por sessão: bolinha de estado, nome do canal e da conversa, estado em texto (Aguardando, Trabalhando, Parada), branch e há quanto tempo, e a última linha da saída em fonte monoespaçada. As que precisam de resposta ficam no topo, com borda âmbar. Botão flutuante "Nova sessão" acima da barra.
2. **Terminal da sessão.** Cabeçalho com voltar, nome da sessão e menu (encerrar, remover). Terminal ocupando a tela. Quando há pedido pendente, ele aparece destacado no fim da saída. Abaixo: teclas rápidas **Aprovar** (verde), **Negar**, **Esc** e **↑**; depois o campo "Responder…" com botão de enviar.
3. **Arquivos.** Caminho atual no topo (`src / main / application`), lista de pastas e arquivos, com marca **M** (modificado) ou **N** (novo) nos arquivos alterados. Somente leitura: tocar abre o arquivo para ler.
4. **Git.** Branch e adiantamento/atraso em relação ao remoto, lista "Alterações" com letra de estado e linhas `+/−`, e o botão "Escrever mensagem de commit" (usa `git.generateCommitMessage`).

Estados de sessão e cores reaproveitam o vocabulário do app: Pergunta (âmbar), Trabalhando (verde), Ocioso/Parada (cinza), Fechado.

### Opções descartadas

- **B. Tela de atenção:** primeira tela só com o que espera resposta, com Aprovar/Negar direto no cartão, e Arquivos/Git numa gaveta. Descartada: aprovar sem ver o contexto é arriscado e Arquivos/Git ficam pouco descobríveis.
- **C. Terminal primeiro:** abre direto na última sessão, com faixa de abas no topo e menu para o resto. Descartada: ver várias sessões de relance fica pior e destoa do app do PC.

### Ainda sem mockup

Tela de pareamento (código e QR), tela "Nova sessão" (escolha de workspace e canal), diff de um arquivo no Git, e estados vazios e de erro de conexão. O construtor desenha esses seguindo a opção A; devem voltar para revisão do dono.

## Como se encaixa no código (pontos de partida, não plano)

- `src/main/ipc/dispatcher.ts` já mapeia `método → handler` e erros para `IpcError`. O servidor remoto deve reutilizar esse mapa de handlers por trás de um filtro de allowlist, sem duplicar a lógica.
- `SessionService` já notifica saída, saída de processo, atividade e substituição por `/clear` por listeners (`outputListeners`, `exitListeners`, `activityListeners`, `onReplaced`). O servidor remoto assina os mesmos listeners e os repassa por WebSocket.
- Sessões sobrevivem à troca de workspace (`rebind()`), o que combina com o uso remoto. As operações de git e arquivos dependem do workspace aberto e falham em Início, como já documentado.
- Composition root: `src/main/index.ts`. A porta de servidor deve ser uma porta nova em `application/ports` com adaptador em `infrastructure/`, seguindo a regra hexagonal do projeto.
- Docs a atualizar quando implementar: `docs/technical/reference/ipc-contract.md` (nova superfície remota) e `architecture.md`; página de produto sobre acesso pelo celular.

## Restrições

- Segurança é requisito de correção, não acabamento: green lint, typecheck e testes, e testes específicos para allowlist, escape de caminho e revogação de token.
- Nenhuma dependência nova sem avisar antes e listar alternativas (provável: um servidor HTTP/WebSocket; avaliar `ws` ou o `http` do Node contra um framework).
- Dentro do que o PTY já faz: um terminal tem um tamanho (colunas × linhas). Com o app aberto no PC e o celular conectado ao mesmo terminal, o tamanho precisa ter uma regra (quem manda).

## Deixado para quem for construir

- Escolha da biblioteca de servidor, formato exato das mensagens do WebSocket, estrutura de pastas do código da página.
- Regra de tamanho do terminal quando PC e celular estão conectados à mesma sessão.
- Detalhes de UX não mostrados nos mockups (estados vazios, erro de conexão, tela de pareamento).
- Como o app detecta que o Tailscale está instalado e ativo, e como guia o dono nos passos de instalação (a ajuda no próprio app é desejável, a forma é livre).

## Verificação

- Automática: lint, typecheck, testes da allowlist, do escape de caminho, do pareamento e da revogação.
- Manual, necessária: abrir a página no celular real pela rede privada, dentro e fora do Wi-Fi de casa, aprovar um pedido real de permissão e digitar no terminal. Nada disso é verificável só por testes.
