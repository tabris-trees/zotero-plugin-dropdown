import { config } from "../../package.json";

export async function registerPrefsScripts(window: Window) {
  addon.data.prefs = {
    ...(addon.data.prefs ?? {
      columns: [],
      rows: [],
    }),
    window,
  };

  bindPrefEvents(window);
}

function bindPrefEvents(window: Window) {
  const doc = window.document;

  doc
    .querySelector<XUL.Checkbox>(
      `#zotero-prefpane-${config.addonRef}-prefEnableTreePane`,
    )
    ?.addEventListener("command", (event: Event) => {
      const checked = (event.target as XUL.Checkbox).checked;
      ztoolkit.log({ prefEnableTreePane: checked });
    });

  doc
    .querySelector<HTMLInputElement>(
      `#zotero-prefpane-${config.addonRef}-prefPanelHeight`,
    )
    ?.addEventListener("change", (event: Event) => {
      const input = event.target as HTMLInputElement;
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = 420;
      value = Math.max(200, Math.min(1200, value));
      input.value = String(value);
      ztoolkit.log({ prefPanelHeight: value });
    });
}
