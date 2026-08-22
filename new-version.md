# 📑 Especificação do Projeto: AI Companion

## 1. Visão Geral & Posicionamento de Mercado
O **AI Companion** (originalmente concebido como *superset-ai-app*) é um aplicativo Desktop de **AICM (AI Customization Management & Governance)**. Ele se posiciona na camada superior do ecossistema de inteligência artificial: não compete com modelos (LLMs) ou ferramentas de codificação (como Cursor ou Claude Code), mas atua como a **Fonte Única de Verdade (Single Source of Truth)** para governar, validar e distribuir o contexto que alimenta essas ferramentas.

* **Problema de Mercado:** O fenômeno do *Prompt Drift*—instruções de arquitetura, perfis de agentes e regras de qualidade espalhados em notas soltas, histórico de chats ou arquivos mal formatados, quebrando o comportamento das IAs de desenvolvimento.
* **Abordagem Técnica:** O projeto aborda o contexto como código (**Context as Code - CaC**), transformando regras operacionais em artefatos estruturados, versionáveis e testáveis (Markdown + YAML).

## 2. Diferencial = Orquestrador Mult Agent E Tool Caller
gerenciar artefatos e trabalhar, mudando a interface de trabalho do terminal centralizando no desktop ia compainon 