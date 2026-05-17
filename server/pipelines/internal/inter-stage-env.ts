const MARKER_RE = /^##device-farm\[setvariable name=([A-Za-z_][A-Za-z0-9_]*)\](.+)$/;

export interface EnvSink {
  set(key: string, value: string): void;
  log(line: string): void;
}

export interface MarkerParserOpts {
  secretNames?: string[];
}

export interface MarkerParser {
  write(chunk: string): void;
  end(): void;
}

export function createMarkerParser(sink: EnvSink, opts: MarkerParserOpts = {}): MarkerParser {
  const secretNames = new Set(opts.secretNames ?? []);
  const secretValues = new Set<string>();
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
      sink.set(name, value);
      if (secretNames.has(name)) {
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
    },
    end(): void {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
    },
  };
}
