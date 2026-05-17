# Knowledge Base

Recurring gotchas, non-obvious rules, and useful patterns discovered during execution.

---

## Tailwind v4 JIT: No dynamic class name construction

**Context:** StatusBadge reskin (M002/S01/T02)

Tailwind v4 JIT scans source files for complete class name strings at build time. Dynamically-constructed class names like `` `bg-${color}/10` `` will NOT be detected and won't generate any CSS. Always use full static class strings in lookup maps:

```typescript
// ❌ WRONG — Tailwind can't see this
const classes = `bg-${mapped}/10 text-${mapped}`;

// ✅ CORRECT — full strings are scannable
const pillStyles: Record<string, string> = {
  passed: 'bg-secondary/10 text-secondary border-secondary/20',
  failed: 'bg-tertiary/10 text-tertiary border-tertiary/20',
};
```

This applies to all Tailwind versions but is especially critical in v4 where `@theme` tokens define custom colors that have no fallback.

---

## Vitest: use vi.hoisted() for mock state needed by vi.mock factories

**Context:** Hierarchy service tests (M003/S01/T01)

`vi.mock()` calls are hoisted above all imports by Vitest. If a mock factory references a `const` declared at module scope (e.g., `const mockFn = vi.fn()`), the factory runs before the declaration — causing `ReferenceError: Cannot access 'X' before initialization`.

Use `vi.hoisted()` to declare mock state that mock factories depend on:

```typescript
// ✅ CORRECT — hoisted alongside vi.mock
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));
```

The existing `server/jobs/__tests__/job-service.test.ts` avoids this issue by declaring `let mockExecuteFn` at the top level (uninitialized `let` doesn't crash on access), but for mock values that must be initialized before the factory runs, `vi.hoisted()` is the safe pattern.

---

## Git worktrees: prior-task artifacts may be missing

**Context:** Inspector page assembly (M003/S01/T04)

When working in `.gsd/worktrees/M003`, files created by prior tasks (T02, T03) in the main repo may not exist in the worktree. Git worktrees share the `.git` directory but have independent working trees. If a prior task committed to a different branch or the worktree wasn't rebased, you'll get `ENOENT` when importing from-T02/T03 files.

**Fix:** Copy the missing files from the main repo before building: `cp /path/to/main/repo/web/src/lib/api/maestro.ts web/src/lib/api/`. Also run `npm install` in both root and `web/` directories since `node_modules` is not shared across worktrees.

---

## ScreenshotOverlay: flatIndex tracking for highlight lookups

**Context:** Element search highlighting (M003/S02/T02)

`ScreenshotOverlay.svelte` derives `visibleNodes` by filtering `flattenTree(nodes)` to only nodes with non-null bounds. This means the loop index inside `{#each visibleNodes}` does NOT match the original `flattenTree()` index. If `ElementSearch` reports matched indices from the full flat tree, the overlay's loop index lookup will highlight the wrong rects.

**Fix:** Map each entry to `{ node, flatIndex }` before filtering, so the original flat-tree index is preserved alongside the visible node. The highlight check then uses `highlightedNodeIds.has(flatIndex)` instead of `highlightedNodeIds.has(index)`.

```typescript
let visibleNodes = $derived(
  flattenTree(nodes)
    .map((n, flatIndex) => ({ node: n, flatIndex }))
    .filter(entry => entry.node.bounds !== null)
);
```

---

## Svelte: double curly braces in attributes are parsed as expressions

**Context:** HookForm command placeholder (M003/S03/T02)

Svelte treats `{{` inside attribute values as expression delimiters. A placeholder string like `placeholder="adb -s {{serial}} shell ..."` will cause `svelte-check` to emit `Error: No value exists in scope for the shorthand property 'serial'`. 

**Fix:** Use a constant with Unicode escapes for the curly braces, or build the string in the `<script>` block:

```typescript
const commandPlaceholder = 'e.g. adb -s \u007B\u007Bserial\u007D\u007D shell settings put global wifi_on 1';
```

Then reference `placeholder={commandPlaceholder}` in the template. The `\u007B` / `\u007D` escapes produce `{` / `}` in the rendered string without triggering Svelte's expression parser.
