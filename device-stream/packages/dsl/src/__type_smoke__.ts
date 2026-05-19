import { createSession } from './index';

declare const url: string;
declare const username: string;
declare const password: string;
declare const apkPath: string;
declare const packageName: string;
declare const serial: string;

async function hookSetupExample(): Promise<void> {
  const ds = await createSession({ serial, platform: 'android' });

  await ds.openUrl(url);
  await ds.get({ id: 'username' }).fill(username);
  await ds.get({ id: 'password' }).fill(password);
  await ds.tapOn({ text: 'generate installation' });
  const TOKEN: string = await ds.copyText({ id: 'token' });

  await ds.openDownloads();
  await ds.installApp(apkPath);
  await ds.enableInstallByThirdParty(packageName);
  await ds.grantPermissions(packageName);
  await ds.get({ id: 'token' }).fill(TOKEN);
  await ds.get({ id: 'username' }).fill(username);
  await ds.get({ id: 'password' }).fill(password);
  await ds.awaitUntil({ text: 'sync' }).changeTo({ text: 'synced' });

  await ds.close();
}

async function iosCompatExample(): Promise<void> {
  const ds = await createSession({ serial, platform: 'ios', iosKind: 'simulator' });
  await ds.openUrl(url);
  await ds.installApp('/path/to/App.app');
  await ds.grantPermissions('com.example.app', ['android.permission.CAMERA', 'location']);
  await ds.grantPermissions('com.example.app');
  await ds.setLocation(-23.5505, -46.6333);
  await ds.launchApp('com.example.app');
  await ds.get({ id: 'username' }).fill(username);
  await ds.tapOn({ text: 'Sign in' });
  await ds.awaitUntil({ text: 'sync' }).changeTo({ text: 'synced' });
  await ds.close();
}

async function iosDeviceExample(): Promise<void> {
  const ds = await createSession({ serial, platform: 'ios', iosKind: 'device' });
  await ds.installApp('/path/to/App.ipa');
  await ds.launchApp('com.example.app');
  await ds.get({ id: 'login-button' }).tap();
  await ds.close();
}

void hookSetupExample;
void iosCompatExample;
