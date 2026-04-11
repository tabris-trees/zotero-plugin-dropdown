import { config } from "../../package.json";

declare const Services: any;

type OnChange = (fullPrefName: string) => void;

const PREFIX = `extensions.zotero.${config.addonRef}.`;

let registered = false;
let observer: any = null;

export function startPrefObserver(onChange: OnChange) {
  stopPrefObserver();

  if (!Services?.prefs) {
    return;
  }

  observer = {
    observe(_subject: unknown, topic: string, data: string) {
      if (topic !== "nsPref:changed") {
        return;
      }
      const fullPrefName = data.startsWith(PREFIX) ? data : `${PREFIX}${data}`;
      onChange(fullPrefName);
    },
  };

  try {
    Services.prefs.addObserver(PREFIX, observer);
    registered = true;
  } catch (error) {
    observer = null;
    registered = false;
    ztoolkit.log("pref observer registration failed", error);
  }
}

export function stopPrefObserver() {
  if (!Services?.prefs || !registered || !observer) {
    return;
  }

  try {
    Services.prefs.removeObserver(PREFIX, observer);
  } catch (error) {
    ztoolkit.log("pref observer removal failed", error);
  } finally {
    registered = false;
    observer = null;
  }
}
