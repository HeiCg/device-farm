export interface JUnitJob {
  id: string;
}

export interface JUnitStep {
  flowName: string | null;
  status: string;
  durationMs: number | null;
  error: string | null;
}

/**
 * Escape XML special characters in a string.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate JUnit XML from a job and its steps.
 * Produces valid XML with testsuites > testsuite > testcase structure.
 */
export function generateJUnitXML(job: JUnitJob, steps: JUnitStep[]): string {
  const passed = steps.filter((s) => s.status === 'passed').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  const totalTimeMs = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const totalTime = (totalTimeMs / 1000).toFixed(3);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="Device Farm" tests="${steps.length}" failures="${failed}" errors="0" skipped="${skipped}" time="${totalTime}">\n`;
  xml += `  <testsuite name="${escapeXml(job.id)}" tests="${steps.length}" failures="${failed}" errors="0" skipped="${skipped}" time="${totalTime}">\n`;

  for (const step of steps) {
    const time = ((step.durationMs ?? 0) / 1000).toFixed(3);
    const name = escapeXml(step.flowName ?? 'unknown');

    if (step.status === 'passed') {
      xml += `    <testcase name="${name}" classname="maestro" time="${time}" />\n`;
    } else if (step.status === 'failed') {
      const message = escapeXml(step.error ?? 'Test failed');
      xml += `    <testcase name="${name}" classname="maestro" time="${time}">\n`;
      xml += `      <failure message="${message}" type="MaestroFailure" />\n`;
      xml += `    </testcase>\n`;
    } else if (step.status === 'skipped') {
      xml += `    <testcase name="${name}" classname="maestro" time="${time}">\n`;
      xml += `      <skipped />\n`;
      xml += `    </testcase>\n`;
    }
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>`;
  return xml;
}
