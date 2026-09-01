const MARKER_RE = /^##device-farm\[setvariable name=([A-Za-z_][A-Za-z0-9_]*)\](.+)$/;

/** Cap the pending (newline-free) line buffer so a flood can't grow the heap. */
const MAX_LINE_BUFFER = 64 * 1024;

export interface EnvSink {
  set(key: string, value: string, opts?: { secret?: boolean }): void;
  log(line: string): void;
}

export interface MarkerParserOpts {
  /** Marker names whose values should be masked in subsequent log lines. */
  secretNames?: string[];
  /**
   * Pre-known secret values to mask from the first line onward — seeded from
   * secrets exported by earlier stages (e.g. the internal-clone PASSWORD),
   * which never appear as a `setvariable` marker in this stage's stream.
   */
  secretValues?: string[];
}

export interface MarkerParser {
  write(chunk: string): void;
  end(): void;
}

export function createMarkerParser(sink: EnvSink, opts: MarkerParserOpts = {}): MarkerParser {
  const secretNames = new Set(opts.secretNames ?? []);
  const secretValues = new Set<string>(opts.secretValues ?? []);
  let buffer = '';

  function mask(line: string): string {
    let result = line;
    for (const v of secretValues) {
      if (v.length >= 3) {
        result = result.split(v).join('***');
      }
    }
    return result;
  }

  function processLine(line: string): void {
    const m = MARKER_RE.exec(line);
    if (m) {
      const [, name, value] = m;
      const secret = secretNames.has(name);
      sink.set(name, value, { secret });
      if (secret) {
        secretValues.add(value);
      }
      return;
    }
    sink.log(mask(line));
  }

  return {
    write(chunk: string): void {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(line);
      }
      // Newline-free flood guard: flush the truncated chunk as a (masked) log
      // line rather than letting the pending buffer grow without bound.
      if (buffer.length > MAX_LINE_BUFFER) {
        sink.log(mask(buffer.slice(0, MAX_LINE_BUFFER)));
        buffer = '';
      }
    },
    end(): void {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
    },
  };
}
