import { config } from "../../package.json";
import { getString } from "../utils/locale";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
        {
          dataKey: "title",
          label: getString("prefs-table-title"),
          fixedWidth: true,
          width: 100,
        },
        {
          dataKey: "detail",
          label: getString("prefs-table-detail"),
        },
      ],
      rows: [
        {
          title: "Orange",
          detail: "It's juicy",
        },
        {
          title: "Banana",
          detail: "It's sweet",
        },
        {
          title: "Apple",
          detail: "I mean the fruit APPLE",
        },
      ],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  // updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  // You can initialize some UI elements on prefs window
  // with addon.data.prefs.window.document
  // Or bind some events to the elements
  const renderLock = ztoolkit.getGlobal("Zotero").Promise.defer();
  if (addon.data.prefs?.window == undefined) return;
  const tableHelper = new ztoolkit.VirtualizedTable(addon.data.prefs?.window)
    .setContainerId(`${config.addonRef}-table-container`)
    .setProp({
      id: `${config.addonRef}-prefs-table`,
      // Do not use setLocale, as it modifies the Zotero.Intl.strings
      // Set locales directly to columns
      columns: addon.data.prefs?.columns,
      showHeader: true,
      multiSelect: true,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => addon.data.prefs?.rows.length || 0)
    .setProp(
      "getRowData",
      (index) =>
        addon.data.prefs?.rows[index] || {
          title: "no data",
          detail: "no data",
        },
    )
    // Show a progress window when selection changes
    .setProp("onSelectionChange", (selection) => {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: `Selected line: ${addon.data.prefs?.rows
            .filter((v, i) => selection.isSelected(i))
            .map((row) => row.title)
            .join(",")}`,
          progress: 100,
        })
        .show();
    })
    // When pressing delete, delete selected line and refresh table.
    // Returning false to prevent default event.
    .setProp("onKeyDown", (event: KeyboardEvent) => {
      if (event.key == "Delete" || (Zotero.isMac && event.key == "Backspace")) {
        addon.data.prefs!.rows =
          addon.data.prefs?.rows.filter(
            (v, i) => !tableHelper.treeInstance.selection.isSelected(i),
          ) || [];
        tableHelper.render();
        return false;
      }
      return true;
    })
    // For find-as-you-type
    .setProp(
      "getRowString",
      (index) => addon.data.prefs?.rows[index].title || "",
    )
    // Render the table.
    .render(-1, () => {
      renderLock.resolve();
    });
  await renderLock.promise;
  ztoolkit.log("Preference table rendered!");
}

// function bindPrefEvents() {
//   addon.data
//     .prefs!.window.document?.querySelector(
//       `#zotero-prefpane-${config.addonRef}-enable`,
//     )
//     ?.addEventListener("command", (e: Event) => {
//       ztoolkit.log(e);
//       addon.data.prefs!.window.alert(
//         `Successfully changed to ${(e.target as XUL.Checkbox).checked}!`,
//       );
//     });

//   addon.data
//     .prefs!.window.document?.querySelector(
//       `#zotero-prefpane-${config.addonRef}-input`,
//     )
//     ?.addEventListener("change", (e: Event) => {
//       ztoolkit.log(e);
//       addon.data.prefs!.window.alert(
//         `Successfully changed to ${(e.target as HTMLInputElement).value}!`,
//       );
//     });
// }
function bindPrefEvents() {
  // 勾选开关时的提示（XUL checkbox 用 command 事件）
  addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-enableTreePane`,
    )
    ?.addEventListener("command", (e: Event) => {
      const checked = (e.target as XUL.Checkbox).checked;
      ztoolkit.log({ enableTreePane: checked });
      // 仅展示用：实际保存已由 preference="enableTreePane" 自动完成
      // addon.data.prefs!.window.alert(`已切换为：${checked}`);
    });

  // 调整高度时的提示/校验（HTML input 用 change 事件）
  addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-panelHeight`,
    )
    ?.addEventListener("change", (e: Event) => {
      const el = e.target as HTMLInputElement;
      let v = Number(el.value);
      if (!Number.isFinite(v)) v = 420;
      v = Math.max(200, Math.min(1200, v));
      if (String(v) !== el.value) el.value = String(v); // 规范回写
      ztoolkit.log({ panelHeight: v });
      // 仅展示用：实际保存已由 preference="panelHeight" 自动完成
      // addon.data.prefs!.window.alert(`高度已设为：${v}px`);
    });
}
