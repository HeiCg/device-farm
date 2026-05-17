# Device Farm

## What This Is

Servico self-hosted que roda em Mac Mini Apple Silicon, gerencia um pool de emuladores Android e simuladores iOS via `@device-stream/*`, recebe jobs de teste Maestro via API REST, executa os testes, grava MP4 completo do inicio ao fim, e fornece live preview + logs em tempo real via WebSocket. Substitui servicos pagos como BrowserStack/Firebase Test Lab com uma solucao interna.

## Core Value

QAs e pipelines CI conseguem rodar testes Maestro em emuladores gerenciados automaticamente e acompanhar a execucao em tempo real (live preview + logs), sem depender de servico externo.

## Current Milestone: v3.0 Spec-Driven Architecture

**Goal:** Refatorar server + CLI + web pra arquitetura spec-driven + event-driven, tornando o codigo legivel e manutenivel por LLMs.

**Pilares:**
- **Zod em todos os boundaries** — single source of truth. Schemas para API req/resp, WebSocket messages, eventos, row decoders do Postgres, config YAML. TS infere tipos do Zod.
- **Event bus in-process tipado** — publishers/subscribers por modulo em `events.ts`. Sincrono, para reacoes locais rapidas.
- **Queue pg-boss (Postgres-native)** — tudo async/retriavel: execucao Maestro (persistente, sobrevive crash), webhooks com retry/DLQ, cleanup/housekeeping, pipelines (substitui node-cron).
- **Rastreabilidade** — correlation IDs em logs + tabela `events` append-only pra eventos de negocio criticos.
- **Modulos LLM-first** — cada modulo tem `MODULE.md` (contrato publico, eventos emitidos/consumidos, invariantes), `index.ts` barrel (so API publica), `events.ts` centralizado, testes como spec (describe blocks documentam contrato).

**Estrategia:** Modulo por modulo. Primeira phase = modulo piloto estabelece padrao; phases seguintes replicam.

**Escopo:** Server (Fastify) + CLI (Go) + Web (SvelteKit) — tudo.

**Inclui tech debt v2.0:** Phase 15 (operational deps), CLI deviceName UUID, Nyquist validation nas phases.

**Target features:** Sem features novas. Milestone 100% refactor arquitetural.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Configuracao do servidor via YAML — v1.0
- ✓ Pool Manager: boot/shutdown de emuladores Android — v1.0
- ✓ Pool Manager: boot/shutdown de simuladores iOS — v1.0
- ✓ Health check periodico + restart automatico — v1.0
- ✓ Alocacao/liberacao automatica de devices por job — v1.0
- ✓ API REST: CRUD jobs, devices, artifacts — v1.0
- ✓ Job Executor: Maestro test execution — v1.0
- ✓ Parser de stdout do Maestro em steps estruturados — v1.0
- ✓ WebSocket: logs + steps do job ao vivo — v1.0
- ✓ Gravacao de video (ffmpeg) — v1.0
- ✓ Storage lifecycle: compressao, retencao, cleanup — v1.0
- ✓ Web UI: dashboard, jobs, devices, settings — v1.0
- ✓ Autenticacao: API keys — v1.0
- ✓ Go CLI: run, status, logs, devices, cancel, config, doctor — v1.0
- ✓ CLI `doctor` reescrito com checks completos (11 deps incluindo device-stream) — v2.0
- ✓ CLI `dependencies` com instalacao automatica (9 installers via brew/sdkmanager) — v2.0
- ✓ Device management via `@device-stream/android` (substitui pool manager Android) — v2.0
- ✓ Device management via `@device-stream/ios-simulator` (substitui pool manager iOS) — v2.0
- ✓ Gravacao MP4 via device-stream streaming (Android H.264 + iOS MJPEG) — v2.0
- ✓ Device preview WebSocket entrega frames via adapter factory — v2.0

### Active

<!-- Current scope. Building toward these. v3.0 refactor — full list in REQUIREMENTS.md -->

- [ ] Zod schemas em todos os boundaries (API, WebSocket, eventos, DB rows, config)
- [ ] Event bus in-process tipado por modulo
- [ ] Queue pg-boss substituindo filas in-memory e node-cron
- [ ] Correlation IDs + tabela events pra rastreabilidade
- [ ] Modulos com MODULE.md + barrel index.ts + events.ts + testes-como-spec
- [ ] Refactor aplicado ao server, CLI (Go) e web (SvelteKit)
- [ ] Tech debt v2.0 resolvido (operational deps, CLI deviceName, Nyquist)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-node / cluster de Mac Minis — single-node por enquanto
- Notificacoes (Slack, email) — webhook futuramente
- Suporte a frameworks alem do Maestro (Appium, Espresso, XCTest)
- App mobile nativo para acompanhar testes
- Billing / multi-tenancy
- Test Case Management (M004) — pausado
- Appium integration (M005) — pausado

## Context

- Empresa usa Azure como cloud principal e GitHub como SCM
- Time de QA ja tem flows Maestro prontos, precisa da infra para rodar de forma centralizada
- `@device-stream/*` agora e o engine principal de device lifecycle + recording + preview; ainda resolvido de `file:../device-stream` (tech debt a resolver)
- Volume atual e baixo (<50 testes/dia), mas deve crescer com adocao
- Mac Mini Apple Silicon e a maquina target (ARM64)
- Metadata de jobs e generico (JSONB) — CI de qualquer provider passa os campos que quiser
- Tech debt pos-v2.0: Phase 15 (operational deps) nunca planejada; CLI device name mostra UUID; Nyquist validation nao rodou em nenhuma phase

## Constraints

- **Hardware**: Mac Mini Apple Silicon — emuladores Android ARM64, simuladores iOS nativos
- **Dependencia externa**: `@device-stream/*` — lib interna, referenciada via `file:../device-stream` (requer sibling repo ate resolver)
- **Dependencia externa**: Maestro CLI — executado como processo externo via `child_process.spawn`
- **Dependencia externa**: PostgreSQL — necessario para queries complexas em jobs/steps/metadata
- **Stack decidida**: Node.js + TypeScript ESM (server, Fastify 5), SvelteKit 5 (frontend), Drizzle ORM, Go (CLI via Cobra)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Metadata como JSONB generico | CI-agnostic: qualquer provider manda os campos que quiser | ✓ Good |
| Go para CLI | Binario unico, cross-compile trivial, QAs instalam sem dependencias | ✓ Good |
| YAML para config do servidor | Legivel, suporta comentarios, padrao em infra | ✓ Good |
| PostgreSQL ao inves de SQLite | Jobs, steps e metadata precisam de queries complexas (filtros, joins, JSONB) | ✓ Good |
| device-stream como dependencia | Reutiliza streaming ja implementado, nao reinventa | ✓ Good |
| device-stream substitui pool manager | Lifecycle completo (boot/shutdown/health) via device-stream, nao so streaming | ✓ Good — shipped v2.0 |
| CLI doctor/deps reescrito do zero | Doctor existente muito basico, precisa cobrir device-stream deps | ✓ Good — shipped v2.0 |
| Maestro como processo externo | `child_process.spawn("maestro", ...)` — simples, sem acoplamento | ✓ Good |
| Headless Android | `-no-window` — Mac Mini nao precisa de UI, economiza recursos | ✓ Good |
| API keys (v1) + OAuth SSO (v2) | API keys para v1 (simples, cobre CLI/CI/Web). OAuth Azure AD + GitHub planejado | — Pending |
| Hybrid Android driver | Retem emulator spawning, delega health checks ao TangoADB (misto, nao puro wrapper) | ✓ Good — v2.0 |
| Pure iOS driver | Delega todo lifecycle ao IOSSimulatorManager (simctl erase em vez de deleteDevice) | ✓ Good — v2.0 |
| RecordingSession envolve device-stream | RecordingService nao gere ffmpeg diretamente; ScrcpyService/CaptureService sao singletons Fastify | ✓ Good — v2.0 |
| Adapter factory post-construction injection | `setAdapterFactory` usa `(this as any)` cast para contornar readonly — limitacao aceita | ⚠️ Revisit se DevicePreviewManager for refatorado |

## Tech Debt

Carried forward from v2.0 (see `.planning/milestones/v2.0-MILESTONE-AUDIT.md`):

- **Operational dependencies** (Phase 15 never planned): `api` plugin nao declara `lifecycle-plugin` como dependencia; `@device-stream/*` resolvido via `file:../device-stream` (exige sibling repo); `installSimCapture` depende de `../device-stream` existir.
- **CLI device name**: `Job.DeviceName` espera `deviceName` mas server retorna `deviceId` UUID — campo vazio no CLI status.
- **Nyquist validation**: 13/13 phases marcadas `nyquist_compliant: false` — validacao nunca executada.

---
*Last updated: 2026-04-16 after starting milestone v3.0*
