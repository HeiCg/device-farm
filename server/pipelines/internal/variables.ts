/**
 * Replace {{variable}} placeholders in a string with values from the given map.
 * Unknown variables are left as-is (not replaced).
 */
export function interpolateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match;
  });
}
