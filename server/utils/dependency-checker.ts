import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface DependencyConfig {
  android: { enabled: boolean };
  ios: { enabled: boolean };
}

interface Dependency {
  name: string;
  command: string;
  args: string[];
  installHint: string;
  requiredWhen?: 'android' | 'ios';
}

const DEPENDENCIES: Dependency[] = [
  {
    name: 'adb',
    command: 'adb',
    args: ['version'],
    installHint: 'Install Android SDK Platform-Tools',
    requiredWhen: 'android',
  },
  {
    name: 'emulator',
    command: 'emulator',
    args: ['-version'],
    installHint: 'Install Android SDK Emulator package',
    requiredWhen: 'android',
  },
  {
    name: 'avdmanager',
    command: 'avdmanager',
    args: ['list', 'target'],
    installHint: 'Install Android SDK Command-line Tools',
    requiredWhen: 'android',
  },
  {
    name: 'xcrun simctl',
    command: 'xcrun',
    args: ['simctl', 'help'],
    installHint: 'Install Xcode Command Line Tools',
    requiredWhen: 'ios',
  },
  {
    name: 'ffmpeg',
    command: 'ffmpeg',
    args: ['-version'],
    installHint: 'brew install ffmpeg',
  },
  {
    name: 'maestro',
    command: 'maestro',
    args: ['--version'],
    installHint: 'curl -Ls "https://get.maestro.mobile.dev" | bash',
  },
];

/** Optional dependencies — logged as warnings, not errors */
const OPTIONAL_DEPENDENCIES: Dependency[] = [
  {
    name: 'appium',
    command: 'appium',
    args: ['--version'],
    installHint: 'npm install -g appium && appium driver install uiautomator2 && appium driver install xcuitest',
  },
];

export async function checkDependencies(config: DependencyConfig): Promise<void> {
  const errors: string[] = [];

  for (const dep of DEPENDENCIES) {
    if (dep.requiredWhen === 'android' && !config.android.enabled) continue;
    if (dep.requiredWhen === 'ios' && !config.ios.enabled) continue;

    try {
      await execFileAsync(dep.command, dep.args, { timeout: 10_000 });
    } catch {
      errors.push(`Missing: ${dep.name} -- ${dep.installHint}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Required dependencies not found:\n${errors.join('\n')}`);
  }
}

/**
 * Check optional dependencies and return their availability.
 * Does not throw — returns a record of name → available.
 */
export async function checkOptionalDependencies(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};

  for (const dep of OPTIONAL_DEPENDENCIES) {
    try {
      await execFileAsync(dep.command, dep.args, { timeout: 10_000 });
      result[dep.name] = true;
    } catch {
      result[dep.name] = false;
    }
  }

  return result;
}
