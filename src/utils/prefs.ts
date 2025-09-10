import { config } from "../../package.json";
declare const Zotero: any;

const PREFIX = `extensions.zotero.${config.addonRef}.` as const;

export function getEnableTreePane(): boolean {
  return !!Zotero.Prefs.get(PREFIX + "prefEnableTreePane", true);
}

export function getPanelHeight(): number {
  const v = Number(Zotero.Prefs.get(PREFIX + "prefPanelHeight", true));
  return Number.isFinite(v) ? v : 420;
}