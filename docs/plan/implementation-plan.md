# Device Farm — Plano de Implementacao

Servico que roda em Mac Mini Apple Silicon, gerencia um pool de emuladores/simuladores, recebe jobs de teste Maestro via API REST, executa, e fornece live preview via `device-stream` + logs em tempo real via WebSocket.

---

## Arquitetura Geral

```
┌─────────────┐     ┌──────────────────────────────┐     ┌─────────────────────────────┐
│  Go CLI     │────▶│                              │     │  Mac Mini                   │
│  (QA local) │ REST│  Device Farm Server           │     │                             │
└─────────────┘     │  (Node + SvelteKit + Drizzle)│────▶│  ┌───────────────────────┐  │
                    │                              │     │  │ Emulator Pool Manager │  │
┌─────────────┐     │                              │     │  │  - Android AVDs       │  │
│  Web UI     │◀───▶│                              │     │  │  - iOS Simulators     │  │
│  (Svelte)   │ WS  │                              │     │  └───────────────────────┘  │
└─────────────┘     └──────────────────────────────┘     │                             │
                                                         │  ┌───────────────────────┐  │
┌─────────────┐          │                               │  │ device-stream         │  │
│  CI Pipeline│──────────┘                               │  │ (live preview +       │  │
│  (qualquer) │     REST                                 │  │  recording)           │  │
└─────────────┘                                          │  └───────────────────────┘  │
                                                         └─────────────────────────────┘
```

---

## 1. Configuracao via YAML

O servidor le um arquivo `config.yaml` na raiz do projeto (ou caminho definido via env `DEVICE_FARM_CONFIG`).

```yaml
# config.yaml

server:
  port: 3000
  host: "0.0.0.0"

pool:
  max_devices: 10                    # maximo de emuladores/simuladores simultaneos
  android:
    enabled: true
    max_instances: 5
    headless: true                   # -no-window -no-audio
    api_level: 34                    # Android API level padrao
    device_profile: "pixel_7"       # AVD device profile
    ram_mb: 2048
  ios:
    enabled: true
    max_instances: 5
    runtime: "iOS-17-5"             # simctl runtime
    device_type: "iPhone-15"        # simctl device type

storage:
  recordings:
    path: "./recordings"
    retention_days: 30              # dias para manter gravacoes
    compress_after_days: 7          # comprimir videos apos N dias
    format: "mp4"                   # formato de saida
    max_storage_gb: 50              # limite de disco, cleanup automatico
  logs:
    retention_days: 90
    path: "./logs"

jobs:
  timeout_minutes: 30               # timeout por job
  max_queue_size: 100               # maximo de jobs na fila
  cleanup_completed_after_days: 7   # remover arquivos de jobs antigos

# metadata que o CLI/CI passa por job — a device farm nao interpreta,
# apenas armazena e exibe. isso permite funcionar com qualquer CI.
job_metadata_schema:
  required: []                      # campos obrigatorios (ex: ["branch"])
  optional:                         # campos opcionais com defaults
    - name: "branch"
      type: "string"
    - name: "commit_sha"
      type: "string"
    - name: "pr_number"
      type: "string"
    - name: "pr_url"
      type: "string"
    - name: "triggered_by"
      type: "string"
    - name: "ci_provider"
      type: "string"
    - name: "ci_build_url"
      type: "string"
    - name: "repository"
      type: "string"
    - name: "tags"
      type: "string[]"
```

O schema de metadata e generico — a device farm armazena e exibe os campos, mas nao faz logica em cima deles. A CI de qualquer provider (Azure, GitHub, Bitbucket, GitLab) passa os campos que quiser.

---

## 2. Stack Tecnologica

| Componente | Tecnologia |
|------------|------------|
| Server | Node.js + TypeScript ESM |
| Frontend | SvelteKit (SSR + SPA) |
| ORM | Drizzle + PostgreSQL |
| State management | TanStack Query |
| Live preview | `@device-stream/*` (scrcpy H.264 p/ Android, simctl p/ iOS) |
| Real-time | WebSocket (logs + stream) |
| CLI | Go (binario unico, cross-compile Win/Mac/Linux) |
| Emulador Android | Android SDK `emulator` (headless) |
| Simulador iOS | `xcrun simctl` |
| Teste | Maestro CLI |
| Configuracao | YAML (`js-yaml`) |

---

## 3. Schema do Banco (Drizzle/PostgreSQL)

### jobs

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | PK |
| status | enum | `queued`, `running`, `passed`, `failed`, `cancelled`, `timeout` |
| platform | enum | `android`, `ios` |
| device_id | uuid? | FK para device alocado |
| metadata | jsonb | campos livres (branch, PR, commit, user, CI info) |
| created_at | timestamp | |
| started_at | timestamp? | |
| finished_at | timestamp? | |
| result_summary | jsonb? | `{ total: 10, passed: 8, failed: 2, skipped: 0 }` |
| maestro_output | text? | stdout/stderr completo |
| error_message | text? | se falhou por razao infra |

### job_files

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | PK |
| job_id | uuid | FK |
| filename | varchar | nome original do arquivo (ex: `login-flow.yaml`) |
| content | text | conteudo do YAML |
| file_type | enum | `flow`, `config`, `app_file`, `other` |

### job_steps

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | PK |
| job_id | uuid | FK |
| step_index | integer | ordem do step |
| flow_name | varchar | nome do flow (arquivo yaml) |
| command | varchar | o comando Maestro (ex: `tapOn "Login"`) |
| status | enum | `running`, `passed`, `failed`, `skipped` |
| duration_ms | integer? | |
| error | text? | mensagem de erro se falhou |
| screenshot_path | varchar? | screenshot no momento da falha |
| started_at | timestamp | |
| finished_at | timestamp? | |

### devices

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | PK |
| type | enum | `android`, `ios` |
| name | varchar | ex: `android-avd-01`, `ios-sim-03` |
| status | enum | `idle`, `running`, `booting`, `error`, `offline` |
| current_job_id | uuid? | FK para job em execucao |
| emulator_id | varchar | AVD name ou simctl UDID |
| port | integer? | porta scrcpy/stream |
| created_at | timestamp | |
| last_active_at | timestamp | |

### recordings

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | PK |
| job_id | uuid | FK |
| file_path | varchar | caminho do video |
| file_size_bytes | bigint | tamanho |
| duration_seconds | integer | |
| compressed | boolean | se ja foi comprimido |
| compressed_at | timestamp? | |
| created_at | timestamp | |

---

## 4. API REST

### Jobs

```
POST   /api/jobs                  Criar job (multipart: yaml files + JSON metadata)
GET    /api/jobs                  Listar jobs (filtros: status, platform, metadata.branch, paginacao)
GET    /api/jobs/:id              Detalhes do job
GET    /api/jobs/:id/steps        Steps do job com status
GET    /api/jobs/:id/logs         Logs completos (stdout Maestro)
DELETE /api/jobs/:id              Cancelar job (se queued/running)
GET    /api/jobs/:id/recording    Download do video
```

### Devices

```
GET    /api/devices               Listar todos os emuladores e status
GET    /api/devices/:id           Info de um emulador
POST   /api/devices/:id/restart   Reiniciar emulador com problema
```

### WebSocket

```
WS     /ws/jobs/:id/live          Live stream: { type: "log" | "step" | "frame", data: ... }
WS     /ws/devices/:id/stream     Stream direto do device (device-stream)
```

### Health

```
GET    /api/health                Status do servidor + pool
```

---

## 5. Go CLI

### Estrutura

```
cli/
  cmd/
    root.go          # cobra root command
    run.go           # device-farm run
    status.go        # device-farm status <job-id>
    devices.go       # device-farm devices
    logs.go          # device-farm logs <job-id>
    config.go        # device-farm config set/get
    cancel.go        # device-farm cancel <job-id>
  internal/
    api/             # client HTTP para a device farm API
    output/          # formatacao terminal (cores, tabelas, spinners)
    config/          # leitura ~/.device-farm.yaml (server URL, defaults)
    stream/          # websocket client para logs em tempo real
  main.go
```

### Comandos

```bash
# Executar teste
device-farm run ./login-flow.yaml --platform android
device-farm run ./flows/ --platform ios --metadata '{"branch":"feat/login","pr_number":"42"}'
device-farm run ./smoke-tests/ --platform android --tag smoke

# Acompanhar
device-farm status <job-id>              # status + resultado
device-farm logs <job-id>                # logs completos
device-farm logs <job-id> --follow       # streaming ao vivo

# Devices
device-farm devices                      # tabela com status dos emuladores

# Cancelar
device-farm cancel <job-id>

# Config
device-farm config set server https://mac-mini.local:3000
device-farm config set default-platform android
```

### Comportamento do `run`

1. Lê os arquivos `.yaml` do caminho informado
2. Faz POST multipart para `/api/jobs` com os arquivos + metadata
3. Recebe o job ID + URL do live preview
4. Printa: `Job #abc123 created. Live preview: https://mac-mini:3000/jobs/abc123`
5. Conecta no WebSocket `/ws/jobs/:id/live`
6. Streama logs no terminal em tempo real (step a step, com cores)
7. Quando o job termina, printa o resumo e faz `exit 0` (passed) ou `exit 1` (failed)

Isso permite que qualquer CI use o binario diretamente:
```yaml
# Exemplo generico de CI step
- name: Run tests
  run: device-farm run ./e2e/ --platform android --metadata '{"branch":"$BRANCH","commit":"$COMMIT"}'
```

---

## 6. Emulator Pool Manager

### Responsabilidades

- Boot/shutdown de emuladores conforme config
- Health check periodico (emulador crashou? reinicia)
- Alocacao: job chega → pega primeiro `idle` da plataforma pedida
- Liberacao: job termina → limpa o device (wipe/reset) → volta pra `idle`
- Respeita `max_devices` do config.yaml

### Android Headless

```bash
# Criar AVD
avdmanager create avd -n "farm-android-01" -k "system-images;android-34;google_apis;arm64-v8a" -d "pixel_7"

# Iniciar headless
emulator -avd farm-android-01 -no-window -no-audio -gpu swiftshader_indirect -no-boot-anim -port 5554

# Cleanup entre jobs
adb -s emulator-5554 shell pm clear <app-package>
# ou snapshot restore para estado limpo
```

### iOS Simulator

```bash
# Criar
xcrun simctl create "farm-ios-01" "iPhone 15" "iOS-17-5"

# Boot (headless por padrao no macOS server)
xcrun simctl boot <UDID>

# Cleanup
xcrun simctl erase <UDID>
```

### Ciclo de vida

```
INIT ──▶ BOOTING ──▶ IDLE ──▶ ALLOCATED ──▶ RUNNING ──▶ CLEANUP ──▶ IDLE
                       ▲                                              │
                       └──────────────────────────────────────────────┘
                                    (se erro)
                              BOOTING ──▶ ERROR ──▶ RESTART ──▶ BOOTING
```

---

## 7. Live Preview (device-stream)

### Integracao

O `device-stream` e importado como dependencia (npm workspace ou git submodule):

- Android: `@device-stream/android` — scrcpy H.264 stream via WebSocket
- iOS: `@device-stream/ios-simulator` — simctl screenshot polling ou ReplayKit

### Fluxo

1. Job e alocado em um emulador
2. Server inicia stream via `device-stream` no emulador
3. Stream fica disponivel em `/ws/devices/:id/stream`
4. Web UI conecta e renderiza (WebCodecs H.264 para Android, canvas MJPEG para iOS)
5. Simultaneamente, frames sao gravados para gerar o video do teste
6. Quando o job termina, stream encerra e video e finalizado

### Gravacao

- Captura frames do stream em background
- Ao finalizar, encoda para MP4 via ffmpeg
- Armazena em `storage.recordings.path`
- Cron job comprime videos apos `compress_after_days`
- Cron job deleta videos apos `retention_days`

---

## 8. Web UI (SvelteKit)

### Paginas

| Rota | Descricao |
|------|-----------|
| `/` | Dashboard: jobs recentes + status do pool |
| `/jobs` | Lista de jobs com filtros (status, plataforma, metadata) |
| `/jobs/:id` | Detalhe: live preview + logs lado a lado + steps |
| `/jobs/:id/recording` | Player do video gravado |
| `/devices` | Grid de emuladores com status ao vivo |
| `/settings` | Visualizar config atual do servidor |

### Job Detail (tela principal)

```
┌──────────────────────────────────────────────────────────┐
│  Job #abc123 — android — running                         │
│  branch: feat/login | PR: #42 | by: joao.silva          │
├────────────────────────────┬─────────────────────────────┤
│                            │  Steps                      │
│   Live Preview             │  ✅ Launch app              │
│   (device-stream)          │  ✅ Tap "Login"             │
│                            │  🔄 Type email              │
│   [video stream aqui]      │  ⬜ Type password           │
│                            │  ⬜ Tap "Submit"            │
│                            │  ⬜ Assert "Welcome"        │
│                            │                             │
│                            │  Logs                       │
│                            │  > Running login-flow.yaml  │
│                            │  > Step 3/6: Type email...  │
├────────────────────────────┴─────────────────────────────┤
│  Metadata: commit a1b2c3 | repo: mobile-app | CI: azure │
└──────────────────────────────────────────────────────────┘
```

---

## 9. Storage Lifecycle (Cron Jobs)

Processos em background que rodam periodicamente:

| Tarefa | Frequencia | Descricao |
|--------|------------|-----------|
| Compress recordings | Diaria | Videos com `age > compress_after_days` → re-encode com CRF alto |
| Delete old recordings | Diaria | Videos com `age > retention_days` → delete arquivo + registro |
| Delete old logs | Diaria | Logs com `age > logs.retention_days` → delete |
| Cleanup job files | Diaria | Jobs com `age > cleanup_completed_after_days` → delete YAML files |
| Storage cap check | Horaria | Se disco > `max_storage_gb` → delete mais antigos primeiro |
| Device health check | A cada 30s | Verifica se emuladores estao respondendo |

---

## 10. Estrutura do Projeto

```
device-farm/
  config.yaml                    # configuracao do servidor
  package.json
  tsconfig.json
  drizzle.config.ts

  server/
    index.ts                     # entry point
    config.ts                    # parser do config.yaml + validacao Zod
    routes/
      jobs.ts                    # CRUD de jobs
      devices.ts                 # status dos emuladores
      health.ts
    services/
      pool-manager.ts            # gerencia emuladores (boot, alloc, release)
      job-executor.ts            # executa maestro no device alocado
      maestro-parser.ts          # parseia stdout do maestro em steps
      recording-service.ts       # gravacao via device-stream
      storage-lifecycle.ts       # cron jobs de limpeza/compressao
      stream-service.ts          # integracao com device-stream
    ws/
      job-live.ts                # websocket de logs+steps ao vivo
      device-stream.ts           # websocket de video stream
    db/
      schema.ts                  # Drizzle schema
      index.ts                   # conexao

  client/                        # SvelteKit app
    src/
      routes/
        +page.svelte             # dashboard
        jobs/
          +page.svelte           # lista de jobs
          [id]/
            +page.svelte         # detalhe do job (live preview + logs)
            recording/
              +page.svelte       # player do video
        devices/
          +page.svelte           # grid de emuladores
        settings/
          +page.svelte           # config viewer
      lib/
        api.ts                   # client HTTP
        ws.ts                    # client WebSocket
        stores/                  # svelte stores
      components/
        LivePreview.svelte       # player device-stream
        LogViewer.svelte         # logs em tempo real
        StepList.svelte          # lista de steps
        DeviceCard.svelte        # card de emulador
        JobCard.svelte           # card de job

  cli/                           # Go CLI
    cmd/
      root.go
      run.go
      status.go
      devices.go
      logs.go
      config.go
      cancel.go
    internal/
      api/
      output/
      config/
      stream/
    main.go
    go.mod
    go.sum
```

---

## 11. Fases de Implementacao

### Fase 1 — Fundacao
- Scaffold do projeto (Node + SvelteKit + Drizzle)
- Parser de config.yaml com validacao Zod
- Schema do banco + migrations
- API basica: `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id`
- Pool Manager: boot/shutdown de 1 emulador Android headless

### Fase 2 — Execucao de Testes
- Job Executor: receber YAML, rodar `maestro test` no emulador
- Parser de stdout do Maestro → steps estruturados
- WebSocket de logs em tempo real
- Alocacao/liberacao de devices
- Go CLI: `run`, `status`, `logs`

### Fase 3 — Live Preview + Recording
- Integracao com `device-stream` para stream Android
- WebSocket de video stream
- Componente `LivePreview.svelte`
- Gravacao de video (ffmpeg)
- Pagina de detalhe do job com split view

### Fase 4 — iOS + Pool Completo
- Pool Manager para iOS Simulator
- Integracao `device-stream` iOS
- Pool de ate 10 devices (mix Android + iOS)
- Health check + restart automatico

### Fase 5 — Storage + Polish
- Cron jobs de compressao/limpeza
- Dashboard com metricas
- Filtros e busca na UI
- Go CLI: `devices`, `cancel`, `config`
- Cross-compile do CLI (Windows, macOS, Linux)

---

## 12. Decisoes Tecnicas

| Decisao | Razao |
|---------|-------|
| Metadata como JSONB generico | CI-agnostic: qualquer provider manda os campos que quiser |
| Go para CLI | Binario unico, cross-compile trivial, QAs no Windows instalam sem dependencias |
| YAML para config | Legivel, suporta comentarios, padrao em infra |
| PostgreSQL | Jobs, steps e metadata precisam de queries complexas (filtros, joins) |
| device-stream como dependencia | Reutiliza streaming ja implementado, nao reinventa |
| Maestro como processo externo | `child_process.spawn("maestro", ...)` — simples, sem acoplamento |
| Headless Android | `-no-window` — Mac Mini nao precisa de UI, economiza recursos |

---

## 13. Exemplo de Uso Completo

### QA testando localmente (Windows)

```bash
# Instala o CLI (binario unico)
# Configura o servidor
device-farm config set server https://mac-mini.internal:3000

# Roda o teste
device-farm run ./flows/login.yaml --platform android

# Output:
# Job #f7a2b1 created
# Live preview: https://mac-mini.internal:3000/jobs/f7a2b1
# Platform: android | Device: android-avd-03
#
# ▶ Running login.yaml
#   ✅ launchApp "com.example.app"           120ms
#   ✅ tapOn "Email"                          85ms
#   ✅ inputText "user@test.com"              90ms
#   🔄 tapOn "Login"                          ...
#   ✅ tapOn "Login"                          200ms
#   ✅ assertVisible "Welcome"               150ms
#
# ✅ PASSED (6/6 steps) in 4.2s
# Recording: https://mac-mini.internal:3000/jobs/f7a2b1/recording
```

### CI Pipeline (qualquer provider)

```bash
device-farm run ./e2e/ \
  --platform android \
  --metadata '{"branch":"feat/login","commit_sha":"a1b2c3","pr_number":"42","triggered_by":"ci","ci_provider":"azure","ci_build_url":"https://..."}'

# Exit code 0 = all passed, 1 = any failed
# CI interpreta o exit code normalmente
```
