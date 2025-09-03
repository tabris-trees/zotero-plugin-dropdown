import {
  BasicExampleFactory,
  HelperExampleFactory,
  KeyExampleFactory,
  PromptExampleFactory,
  UIExampleFactory,
} from "./modules/examples";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { mountDropdown, unmountDropdown } from "./modules/dropdown";

export async function onStartup(): Promise<void> {
  const z = Zotero as any;

  // 等待 Zotero / UI 就绪（存在的才等，避免 undefined）
  const waits: Promise<any>[] = [];
  if (z.initializationPromise) waits.push(z.initializationPromise);
  if (z.unlockPromise) waits.push(z.unlockPromise);
  if (z.uiReadyPromise) waits.push(z.uiReadyPromise);
  if (z.ui?.ready) waits.push(z.ui.ready);
  if (waits.length) {
    try { await Promise.all(waits); } catch { }
  }

  initLocale();
  BasicExampleFactory.registerPrefs();
  BasicExampleFactory.registerNotifier();
  KeyExampleFactory.registerShortcuts();
  await UIExampleFactory.registerExtraColumn();
  await UIExampleFactory.registerExtraColumnWithCustomCell();
  UIExampleFactory.registerItemPaneCustomInfoRow();
  UIExampleFactory.registerItemPaneSection();
  UIExampleFactory.registerReaderItemPaneSection();

  // 对“当前已打开”的所有主窗口做挂载
  await Promise.all(
    Zotero.getMainWindows().map((win: _ZoteroTypes.MainWindow) => onMainWindowLoad(win))
  );

  addon.data.initialized = true;
}

export async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({ text: getString("startup-begin"), type: "default", progress: 0 })
    .show();

  await Zotero.Promise.delay(1000);
  popupWin.changeLine({ progress: 30, text: `[30%] ${getString("startup-begin")}` });

  UIExampleFactory.registerStyleSheet(win);
  UIExampleFactory.registerRightClickMenuItem();
  UIExampleFactory.registerRightClickMenuPopup(win);
  UIExampleFactory.registerWindowMenuWithSeparator();
  PromptExampleFactory.registerNormalCommandExample();
  PromptExampleFactory.registerAnonymousCommandExample(win);
  PromptExampleFactory.registerConditionalCommandExample();

  // ★ 在窗口里挂载“集合下拉”
  try { unmountDropdown(win); } catch { }
  await mountDropdown(win);

  await Zotero.Promise.delay(1000);
  popupWin.changeLine({ progress: 100, text: `[100%] ${getString("startup-finish")}` });
  popupWin.startCloseTimer(5000);

  addon.hooks.onDialogEvents("dialogExample");
}

export async function onMainWindowUnload(win: _ZoteroTypes.MainWindow): Promise<void> {
  unmountDropdown(win);            // 只对这个窗口清理
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

export function onShutdown(): void {
  // 兜底：对所有已存在窗口清理一次
  for (const w of Zotero.getMainWindows()) {
    try { unmountDropdown(w as _ZoteroTypes.MainWindow); } catch { }
  }
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete (Zotero as any)[addon.data.config.addonInstance];
}

export async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
  if (event === "select" && type === "tab" && extraData[ids[0]].type === "reader") {
    BasicExampleFactory.exampleNotifierCallback();
  }
}

export async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") registerPrefsScripts(data.window);
}

export function onShortcuts(type: string) {
  if (type === "larger") KeyExampleFactory.exampleShortcutLargerCallback();
  else if (type === "smaller") KeyExampleFactory.exampleShortcutSmallerCallback();
}

export function onDialogEvents(type: string) {
  switch (type) {
    case "dialogExample": HelperExampleFactory.dialogExample(); break;
    case "clipboardExample": HelperExampleFactory.clipboardExample(); break;
    case "filePickerExample": HelperExampleFactory.filePickerExample(); break;
    case "progressWindowExample": HelperExampleFactory.progressWindowExample(); break;
    case "vtableExample": HelperExampleFactory.vtableExample(); break;
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
