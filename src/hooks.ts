import {
  BasicExampleFactory,
  HelperExampleFactory,
  KeyExampleFactory,
} from "./modules/examples";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { mountDropdown, unmountDropdown } from "./modules/dropdown";

export async function onStartup(): Promise<void> {
  const z = Zotero as any;
  const waits: Promise<unknown>[] = [];

  if (z.initializationPromise) waits.push(z.initializationPromise);
  if (z.unlockPromise) waits.push(z.unlockPromise);
  if (z.uiReadyPromise) waits.push(z.uiReadyPromise);
  if (z.ui?.ready) waits.push(z.ui.ready);

  if (waits.length) {
    try {
      await Promise.all(waits);
    } catch (error) {
      ztoolkit.log("startup wait failed", error);
    }
  }

  initLocale();
  BasicExampleFactory.registerPrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win: _ZoteroTypes.MainWindow) =>
      onMainWindowLoad(win),
    ),
  );

  addon.data.initialized = true;
}

export async function onMainWindowLoad(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    unmountDropdown(win);
  } catch (error) {
    ztoolkit.log("pre-mount cleanup failed", error);
  }

  await mountDropdown(win);

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(3000);
}

export async function onMainWindowUnload(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  unmountDropdown(win);
  addon.data.dialog?.window?.close();
}

export function onShutdown(): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      unmountDropdown(win as _ZoteroTypes.MainWindow);
    } catch (error) {
      ztoolkit.log("shutdown cleanup failed", error);
    }
  }

  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  delete (Zotero as any)[addon.data.config.addonInstance];
}

export async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
  if (
    event === "select" &&
    type === "tab" &&
    extraData[ids[0]]?.type === "reader"
  ) {
    BasicExampleFactory.exampleNotifierCallback();
  }
}

export async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    registerPrefsScripts(data.window);
  }
}

export function onShortcuts(type: string) {
  if (type === "larger") KeyExampleFactory.exampleShortcutLargerCallback();
  else if (type === "smaller")
    KeyExampleFactory.exampleShortcutSmallerCallback();
}

export function onDialogEvents(type: string) {
  switch (type) {
    case "dialogExample":
      HelperExampleFactory.dialogExample();
      break;
    case "clipboardExample":
      HelperExampleFactory.clipboardExample();
      break;
    case "filePickerExample":
      HelperExampleFactory.filePickerExample();
      break;
    case "progressWindowExample":
      HelperExampleFactory.progressWindowExample();
      break;
    case "vtableExample":
      HelperExampleFactory.vtableExample();
      break;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
