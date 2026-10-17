# Explorer Panel — árvore única com git

Data: 2026-10-16 · Escopo: **somente renderer** (sem IPC novo, sem mudança em `src/main` ou `src/shared`).

## Problema

O Explorer Panel alterna **Arquivos | Git** com um `ToggleButtonGroup` (`ExplorerPanelContent.tsx`). Só uma visão aparece por vez. Para ver o que mudou, é preciso sair da árvore. A árvore não mostra estado de git, e o `GitView` lista as alterações num layout separado (`ChangeList`).

## Objetivo

Uma única visão no workspace aberto: a **árvore de arquivos com decorações de git**, no estilo do VS Code. Um arquivo alterado mostra uma badge M/A/D/U/R/C/T/! e uma cor. Uma pasta que contém alterações ganha um marcador. As ações de git ficam acessíveis na própria tela.

Fora do escopo: Início (continua com `WorkspaceManagementList`), IPC novo, branch picker, push/pull/fetch, histórico, stash.

## Decisões (confirmadas com o usuário)

| Tema | Decisão |
|---|---|
| Estrutura | Árvore única com badges e marcadores de pasta (opção B do pedido) |
| Clique em arquivo | Abre o arquivo (`onSelectFile`) |
| Abrir diff | Item "Abrir diff" no menu de contexto da linha |
| Ações por arquivo | **Menu de contexto**: Abrir arquivo, Abrir diff, Stage/Unstage, Descartar… |
| Ações globais | **Toolbar no topo**: chip de branch, "Stage all", "Commit…" (popover com a mensagem), refresh |
| Git não iniciado | Ícone ⎇ na toolbar (popover de "Inicializar") **+** cartão dispensável no rodapé |
| Dispensa do cartão | `localStorage`, uma chave por workspace |
| Camada de dados | Reaproveita `useGitStatus` e as mutations de `use-git.ts` |

## Estados

O `git.status` retorna `{ isRepo: false }` ou `{ isRepo: true, head, state, files, truncated }`. Os caminhos em `files[].path` são relativos à raiz do workspace (`SimpleGitRepoClient.isRepo` exige que a raiz seja o top level do repositório). Eles casam direto com o `relPath` usado em `FolderTree`.

- **loading** (`status.isPending`): árvore normal sem decorações e toolbar com o chip em skeleton. Nunca bloqueia a árvore.
- **erro de status**: árvore normal. A toolbar mostra um ícone de alerta com tooltip e, para `GitNotFound`, a mensagem atual sobre o PATH.
- **não é repo**: sem badges. Ícone ⎇ com popover de "Inicializar repositório" e, se não dispensado, o cartão no rodapé.
- **repo limpo ou sujo**: badges e marcadores, toolbar completa.
- **`state !== 'clean'`** (merge/rebase…): o banner de aviso atual aparece acima da árvore.
- **`truncated`**: a nota "Mostrando os primeiros N arquivos" aparece no rodapé da árvore.

## Componentes

### `ExplorerPanelContent` (alterado)
Remove `view`, `onViewChange` e o `ToggleButtonGroup`. No workspace renderiza: `ExplorerToolbar` → banners → `FolderTree` → `GitInitCard`. Início fica igual.

### `ExplorerToolbar` (novo, `components/workspace/ExplorerToolbar.tsx`)
Substitui o cabeçalho de toggle. Contém:
- chip de branch: `GitBranchChip` (reaproveita a lógica de `HeadLine` — nome, "HEAD destacado", "sem commits", ↑ahead ↓behind);
- "Stage all" (desabilitado sem alterações no worktree);
- "Commit…" (abre `CommitPopover`);
- as `toolbarActions` que já existem ("Reler do disco"), que também invalida o status do git.

Sem repo, no lugar do chip mostra o ícone ⎇ que abre o `GitInitPopover`.

### `CommitPopover` (novo, reaproveita `CommitBox`)
Popover ancorado no botão "Commit…". `CommitBox` já faz mensagem, amend e ⌘↵ e é movido sem mudança de comportamento. O popover fecha quando o commit resolve com sucesso.

### `FolderTree` / `TreeNode` (alterados)
Recebem um `gitDecorations` (ver abaixo) por prop. `TreeNode` passa a mostrar:
- **arquivo**: letra de status e cor do texto via `TreeRow.badge` (já existe para a badge de workspace);
- **pasta**: ponto de "contém alterações". O ponto aparece mesmo com a pasta fechada, e a pasta ainda não carregada decide só pelo prefixo de caminho.

Novas entradas no menu de contexto da linha de arquivo, acima das existentes: **Abrir diff**, **Stage** ou **Unstage**, **Descartar…**. O item de Descartar abre o `DiscardConfirmDialog` atual.

Um arquivo com alteração staged e não staged mostra as duas letras (ex.: `M·M`). "Abrir diff" nesse caso oferece os dois diffs (HEAD→index e index→worktree) como dois itens: "Abrir diff (staged)" e "Abrir diff (alterações)".

Arquivos deletados não existem em disco e não aparecem em `useDirListing`. Por isso aparecem numa seção "Removidos" no fim da árvore, com badge `D`. A seção permite Abrir diff, Stage/Unstage e Descartar.

### `GitInitPopover` e `GitInitCard` (novos)
- `GitInitPopover`: texto curto e botão "Inicializar" (`useGitInit`). Sempre disponível pelo ícone ⎇ quando não é repo.
- `GitInitCard`: no rodapé, com "git init" e "Dispensar ✕". Aparece apenas quando `isRepo === false` e a chave de dispensa não está setada.
- Dispensa: `localStorage['ai-companion.git-init-card-dismissed.<workspaceId>'] = '1'`. Leitura e escrita em try/catch; se o storage falhar, o cartão aparece e a dispensa dura só a sessão.
- Após o `git init` bem-sucedido, o status refaz e a UI muda para o estado repo (o cartão some sozinho).

### `git-decorations.ts` (novo, `lib/` ou `components/workspace/git/`)
Função pura `buildGitDecorations(files: GitFileChange[])` que retorna:
- `byPath: Map<string, { letters: string; color: string; staged: boolean; unstaged: boolean; conflicted: boolean }>`;
- `dirtyDirs: Set<string>` com todos os prefixos de diretório de cada caminho alterado;
- `deleted: GitFileChange[]` para a seção "Removidos".

Reaproveita `LETTER` e `COLOR` hoje privados em `ChangeList.tsx` (exportar de um módulo comum) e `groupChanges`.

### Remoções
`GitView.tsx` e `ChangeList.tsx` deixam de ser usados como visão. O `HeadLine`, o `ErrorAlert`, o `DiscardConfirmDialog`, o `CommitBox`, o `RowAction` e a lógica de `toReport` são movidos ou reutilizados, não duplicados. O que ficar sem uso é apagado. `ExplorerView` e `explorerView` saem de `WorkspaceScreen.tsx`.

## Integração com `WorkspaceScreen`

- `showGitView` ("Ver alterações" da overview) passa a **expandir o painel** (se colapsado) e **focar a toolbar do git**. Ele não alterna mais a visão. Se houver alterações, faz scroll até a primeira pasta ou arquivo alterado. Esse scroll é uma melhoria opcional; o mínimo é expandir o painel.
- `openGitDiffTab` e o tab `git-diff` continuam como estão.
- O polling do status: `useGitStatus({ visible })` passa a receber `visible = !explorerCollapsed`, para não consultar o git com o painel fechado.

## Erros

Erros de mutation (stage, unstage, discard, commit, init) continuam passando pelo `toReport` e exibem o `ErrorAlert`, agora acima da árvore e abaixo da toolbar, com o mesmo "Ver detalhes". Falhas em `localStorage` nunca propagam.

## Testes

Atualizar os de `tests/renderer/components/workspace/` (`FolderTree.test.tsx`, `git/*`) e os de `WorkspaceScreen` que dependem de `explorer-view-files` e `explorer-view-git`. Esses `data-testid` são removidos.

Novos testes:
- `buildGitDecorations`: letras, cores, prefixos de diretório, caminhos com espaços, arquivo staged e unstaged ao mesmo tempo, deletados.
- `FolderTree`: badge no arquivo, ponto na pasta, itens novos do menu de contexto, "Abrir diff" chama `onOpenGitDiff` com a fonte certa.
- `ExplorerToolbar`: chip com ahead/behind, "Stage all" desabilitado sem alterações, "Commit…" abre o popover.
- `GitInitCard`: aparece sem repo, some ao dispensar, não volta ao remontar, e usa chaves separadas por workspace; falha de `localStorage` não quebra.
- `ExplorerPanelContent`: Início inalterado e workspace sem toggle.

Portão de qualidade: lint, typecheck e `npm test` verdes (CLAUDE.md, "Project state").

## Docs a atualizar

`docs/how-to/use-the-git-panel.md` (descreve o toggle Arquivos | Git) e as menções ao Explorer em `docs/reference/architecture.md`. O spec `2026-10-06-git-management-design.md` fica como histórico.

## Riscos e trade-offs

- **Arquivos deletados fora da árvore**: a seção "Removidos" é uma solução intermediária. O VS Code mostra deletados na seção do SCM, não na árvore.
- **Pasta não expandida**: a marca vem do prefixo de caminho, então não depende de a pasta ter sido listada.
- **Menu de contexto como única via de stage por arquivo**: descoberta menor que botões no hover. Foi a escolha do usuário. "Stage all" e "Commit…" ficam visíveis na toolbar.
- **Sem diff por clique**: clicar abre o arquivo, e o diff exige o menu. Também foi decisão do usuário.
