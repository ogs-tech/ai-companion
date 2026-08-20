# 📑 Especificação do Projeto: AI Companion

## 1. Visão Geral & Posicionamento de Mercado
O **AI Companion** (originalmente concebido como *superset-ai-app*) é um aplicativo Desktop de **AICM (AI Customization Management & Governance)**. Ele se posiciona na camada superior do ecossistema de inteligência artificial: não compete com modelos (LLMs) ou ferramentas de codificação (como Cursor ou Claude Code), mas atua como a **Fonte Única de Verdade (Single Source of Truth)** para governar, validar e distribuir o contexto que alimenta essas ferramentas.

* **Problema de Mercado:** O fenômeno do *Prompt Drift*—instruções de arquitetura, perfis de agentes e regras de qualidade espalhados em notas soltas, histórico de chats ou arquivos mal formatados, quebrando o comportamento das IAs de desenvolvimento.
* **Abordagem Técnica:** O projeto aborda o contexto como código (**Context as Code - CaC**), transformando regras operacionais em artefatos estruturados, versionáveis e testáveis (Markdown + YAML).

## 2. Pilares de Valor do Software

### 🛡️ Camada de Governança Local e Compliance
* **Validação Estrita:** Centraliza e valida a estrutura de habilidades (*skills*), perfis de agentes, instruções globais e comandos.
* **Controle de Qualidade:** Utiliza validação de esquemas (via *Zod*) para garantir que nenhum artefato corrompido seja inserido no repositório ou no ambiente do desenvolvedor, mitigando falhas de comportamento nos motores de IA.

### 📦 Mecanismo de Distribuição (Deployment Hub)
* **Sincronização por Symlinks:** Atua como um motor de implantação local transparente. Pega as customizações editadas e as injeta instantaneamente nas pastas de execução onde os agentes CLI de terceiros operam (como `~/.claude/` ou `<repo>/.claude/`).
* **Isolamento de Escopos:** Separa de forma clara o que é contexto **Pessoal** (global na máquina do usuário) do que é contexto de **Projeto** (restrito ao repositório atual).

### 🖥️ O Papel Central da IHM (Interface Homem-Máquina)
A interface em **Electron 41 + React 19** é o principal diferencial competitivo do produto, eliminando o efeito de "caixa preta" das linhas de comando (CLIs):
* **Editor Visual Amigável:** Substitui a edição manual de arquivos YAML/Markdown por formulários visuais com feedback de erro em tempo real.
* **Controle de Estados Ativos:** Chaves de ativação (*toggles*) visuais para ligar/desligar agentes e diretrizes com um clique, manipulando os links físicos do sistema operacional em segundo plano.

## 3. Modelo de Entidades Canônicas (Escalabilidade de Multi-Agentes)

Para suportar o ecossistema à medida que ele evolui da validação local para a orquestração corporativa, a arquitetura de dados organiza-se em:

1. **Configuração:** `Agent` (motor cognitivo), `Instruction` (regras globais), `Skill` (receitas lógicas) e `Plugin` (manifestos de ferramentas).
2. **Distribuição:** `AgentBundle` (empacotamento versionado) e `DeploymentTarget` (mapeamento de symlinks para CLIs e IDEs).
3. **Governança & Segurança:** `GlobalGuardrail` (regras de compliance contra vazamento de chaves/PII) e `ComplianceReport` (logs de integridade de schemas).
4. **Observabilidade:** `ActionAuditLog` (registro de auditoria de cada passo executado pelos agentes para controle de custos e conformidade).

## 4. Stack Tecnológico do MVP
* **Shell:** Electron 41
* **UI:** React 19 + TypeScript 5.9
* **Build:** electron-vite + Vite 7
* **Validation:** Zod 4
* **Arquitetura:** Pure TypeScript — sem backend pesado, API externa complexa, banco de dados relacional remoto ou telemetria no início do spike.


## 5. Tool Call 
gerenciar artefatos e trabalhar, mudando a interface de trabalho 