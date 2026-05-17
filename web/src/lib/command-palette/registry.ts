/**
 * Phase 36 Plan 36-03 — Command palette action registry.
 *
 * `getActions()` returns the static list of actions surfaced in the palette
 * (navigation + housekeeping). Device + job + page rows are layered on top
 * by the `CommandPalette.svelte` aggregator — this file owns ACTIONS only.
 *
 * Multi-step actions (`steps`) are scaffolded in the type but currently
 * unused — the wizard step runner lands with PAIR-WIZARD-UI (Plan 36-04).
 */

// Wave 2 (36-03) keeps the local placeholder type — the real generated WS
// device type from $lib/api/generated-types lands when DISC-WS frames are
// consumed (Plan 36-02 store wiring). The shape used here matches the
// fields the palette actually reads.
export type Device = {
  id: string;
  name: string;
  platform: string;
  state: string;
};

export type PaletteStep =
  | { type: 'device-select'; multi: boolean; filter?: (d: Device) => boolean }
  | { type: 'parameter'; key: string; placeholder?: string }
  | { type: 'confirm'; message: string; destructive?: boolean };

export interface ActionContext {
  goto: (href: string) => void;
}

export type PaletteAction = {
  kind: 'action';
  id: string;
  label: string;
  description: string;
  keywords: string[];
  steps?: PaletteStep[];
  run: (ctx: ActionContext) => Promise<void> | void;
};

export function getActions(): PaletteAction[] {
  return [
    {
      kind: 'action',
      id: 'pair-device',
      label: 'Pair device',
      description: 'Wireless ADB pairing wizard',
      keywords: ['adb', 'wifi', 'pair', 'wireless'],
      run: (ctx) => ctx.goto('/devices/pair'),
    },
    {
      kind: 'action',
      id: 'go-jobs',
      label: 'Go to Jobs',
      description: 'Open jobs list',
      keywords: ['job', 'runs', 'history'],
      run: (ctx) => ctx.goto('/jobs'),
    },
    {
      kind: 'action',
      id: 'go-devices',
      label: 'Go to Devices',
      description: 'Open devices list',
      keywords: ['devices', 'pool', 'emulator', 'simulator'],
      run: (ctx) => ctx.goto('/devices'),
    },
    {
      kind: 'action',
      id: 'go-pipelines',
      label: 'Go to Pipelines',
      description: 'Open pipelines list',
      keywords: ['pipeline', 'schedule', 'workflow'],
      run: (ctx) => ctx.goto('/pipelines'),
    },
    {
      kind: 'action',
      id: 'go-sessions',
      label: 'Go to Sessions',
      description: 'Open sessions list',
      keywords: ['session', 'mcp', 'agent'],
      run: (ctx) => ctx.goto('/sessions'),
    },
    {
      kind: 'action',
      id: 'go-settings',
      label: 'Go to Settings',
      description: 'Open settings',
      keywords: ['config', 'preferences'],
      run: (ctx) => ctx.goto('/settings'),
    },
    {
      kind: 'action',
      id: 'clear-logs',
      label: 'Clear logs viewer',
      description: 'Clear current job logs viewer (no-op when no viewer open)',
      keywords: ['logs', 'clear', 'reset'],
      // Logs viewer state lives on individual job pages; centralised clear
      // is deferred until a logs-viewer store exists. Documented as no-op.
      run: () => {
        /* no-op until a global logs-viewer store exists */
      },
    },
  ];
}
