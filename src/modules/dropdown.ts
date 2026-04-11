import { getEnableTreePane, getPanelHeight } from "../utils/prefs";

type CollectionEntry = {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  path: string;
  parentKey: string | null;
};

type WindowNodes = {
  style: HTMLStyleElement;
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  search: HTMLInputElement;
  list: HTMLSelectElement;
  tree: HTMLDivElement;
  onButtonClick: (event: MouseEvent) => void;
  onDocumentMouseDown: (event: MouseEvent) => void;
  onSearchInput: () => void;
  onListDoubleClick: () => void;
  onListKeyDown: (event: KeyboardEvent) => void;
  onTreeDoubleClick: (event: MouseEvent) => void;
  onTreeKeyDown: (event: KeyboardEvent) => void;
  collections: CollectionEntry[];
};

const registry = new WeakMap<Window, WindowNodes>();

function debug(win: Window, message: string) {
  try {
    (win as any).Zotero?.debug?.(`[cdrop] ${message}`);
  } catch {
    // Ignore logging failures in privileged contexts.
  }
}

async function getCollections(win: Window): Promise<CollectionEntry[]> {
  const zotero = (win as any).Zotero;

  await zotero.initializationPromise;
  if (zotero.Schema?.schemaUpdatePromise) {
    try {
      await zotero.Schema.schemaUpdatePromise;
    } catch (error) {
      debug(win, `schema update wait failed: ${String(error)}`);
    }
  }

  let libraryID = Number(
    zotero.getActiveZoteroPane()?.getSelectedLibraryID?.(),
  );
  if (!Number.isFinite(libraryID)) {
    libraryID = zotero.Libraries.userLibraryID;
  }

  const collections = zotero.Collections.getByLibrary(
    libraryID,
    true,
  ) as Array<any>;
  const entries = collections.map((collection) => {
    const names = [String(collection.name ?? "")];
    let parent = collection.parentID
      ? zotero.Collections.get(collection.parentID)
      : null;
    while (parent) {
      names.unshift(String(parent.name ?? ""));
      parent = parent.parentID ? zotero.Collections.get(parent.parentID) : null;
    }

    return {
      id: Number(collection.id),
      key: String(collection.key ?? ""),
      libraryID: Number(collection.libraryID),
      name: String(collection.name ?? ""),
      path: names.join(" / "),
      parentKey:
        typeof collection.parentKey === "string" ? collection.parentKey : null,
    } satisfies CollectionEntry;
  });

  entries.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
  return entries;
}

function applyPanelPreferences(nodes: WindowNodes) {
  const enableTreePane = getEnableTreePane();
  const panelHeight = getPanelHeight();

  nodes.list.style.height = `${panelHeight}px`;
  nodes.tree.style.height = `${panelHeight}px`;
  nodes.list.hidden = enableTreePane;
  nodes.tree.hidden = !enableTreePane;
}

function renderList(nodes: WindowNodes, entries: CollectionEntry[]) {
  const doc = nodes.list.ownerDocument!;
  nodes.list.replaceChildren();

  if (!entries.length) {
    const option = doc.createElement("option");
    option.textContent = "No collections";
    option.disabled = true;
    nodes.list.appendChild(option);
    return;
  }

  for (const entry of entries) {
    const option = doc.createElement("option");
    option.value = String(entry.id);
    option.dataset.id = String(entry.id);
    option.textContent = entry.path;
    nodes.list.appendChild(option);
  }

  nodes.list.selectedIndex = 0;
}

function renderTree(nodes: WindowNodes, entries: CollectionEntry[]) {
  const doc = nodes.tree.ownerDocument!;
  nodes.tree.replaceChildren();

  if (nodes.tree.hidden) {
    return;
  }

  if (!entries.length) {
    const empty = doc.createElement("div");
    empty.className = "cdrop-empty";
    empty.textContent = "No collections";
    nodes.tree.appendChild(empty);
    return;
  }

  const byParent = new Map<string | null, CollectionEntry[]>();
  for (const entry of entries) {
    const bucket = byParent.get(entry.parentKey) ?? [];
    bucket.push(entry);
    byParent.set(entry.parentKey, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  }

  const createBranch = (entry: CollectionEntry): HTMLElement => {
    const children = byParent.get(entry.key) ?? [];
    if (!children.length) {
      const leaf = doc.createElement("div");
      leaf.className = "cdrop-tree-node cdrop-tree-leaf";
      leaf.tabIndex = 0;
      leaf.textContent = entry.name;
      leaf.dataset.id = String(entry.id);
      return leaf;
    }

    const details = doc.createElement("details");
    details.className = "cdrop-tree-branch";
    details.open = true;

    const summary = doc.createElement("summary");
    summary.className = "cdrop-tree-node";
    summary.tabIndex = 0;
    summary.textContent = entry.name;
    summary.dataset.id = String(entry.id);
    details.appendChild(summary);

    const childrenWrap = doc.createElement("div");
    childrenWrap.className = "cdrop-tree-children";
    for (const child of children) {
      childrenWrap.appendChild(createBranch(child));
    }
    details.appendChild(childrenWrap);
    return details;
  };

  const rootEntries = byParent.get(null) ?? [];
  for (const entry of rootEntries) {
    nodes.tree.appendChild(createBranch(entry));
  }
}

function filterCollections(nodes: WindowNodes) {
  const query = nodes.search.value.trim().toLocaleLowerCase();
  const entries = !query
    ? nodes.collections
    : nodes.collections.filter((entry) =>
        entry.path.toLocaleLowerCase().includes(query),
      );
  applyPanelPreferences(nodes);
  renderList(nodes, entries);
  renderTree(nodes, entries);
}

async function jumpToCollection(win: Window, collectionID: number) {
  const zotero = (win as any).Zotero;
  const collection = zotero.Collections.get(collectionID);
  if (!collection) {
    debug(win, `collection not found: ${collectionID}`);
    return;
  }

  const pane = zotero.getActiveZoteroPane?.() ?? (win as any).ZoteroPane;
  if (!pane) {
    debug(win, "active Zotero pane not available");
    return;
  }

  try {
    if (typeof pane.selectCollection === "function") {
      await pane.selectCollection(collectionID);
      return;
    }
  } catch (error) {
    debug(win, `pane.selectCollection failed: ${String(error)}`);
  }

  const libraryID = Number(collection.libraryID);
  const key = String(collection.key ?? "");
  const isUserLibrary = libraryID === zotero.Libraries?.userLibraryID;
  const uri = isUserLibrary
    ? `zotero://select/library/collections/${key}`
    : `zotero://select/groups/${libraryID}/collections/${key}`;

  try {
    if (typeof zotero.URI?.select === "function") {
      zotero.URI.select(uri);
      return;
    }
    (win as any).location.href = uri;
  } catch (error) {
    debug(win, `URI selection failed: ${String(error)}`);
  }
}

async function jumpToSelectedCollection(win: Window, nodes: WindowNodes) {
  const option = nodes.list.options[nodes.list.selectedIndex] as
    | HTMLOptionElement
    | undefined;
  const rawID = option?.dataset.id ?? option?.value ?? "";
  const collectionID = Number(rawID);
  if (!Number.isFinite(collectionID)) {
    return;
  }

  await jumpToCollection(win, collectionID);
  nodes.panel.classList.remove("show");
}

async function openPanel(win: Window, nodes: WindowNodes) {
  nodes.panel.classList.add("show");
  const rect = nodes.button.getBoundingClientRect();
  const width = 420;
  const left = Math.max(16, Math.min(rect.left, win.innerWidth - width - 16));
  nodes.panel.style.left = `${left}px`;
  nodes.panel.style.top = `${rect.bottom + 6}px`;

  if (!nodes.collections.length) {
    nodes.collections = await getCollections(win);
  }

  filterCollections(nodes);
  nodes.search.focus();
  nodes.search.select();
}

export async function mountDropdown(win: Window) {
  if (registry.has(win)) {
    return;
  }

  const doc = win.document;
  const host = (doc.body ?? doc.documentElement)!;
  const styleHost = (doc.head ?? doc.documentElement)!;

  const style = doc.createElement("style");
  style.id = "cdrop-style";
  style.textContent = `
#cdrop-btn-titlebar {
  -moz-window-dragging: no-drag;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin: auto 8px;
  padding: 0 10px;
  border: 1px solid var(--in-content-box-border-color, #c8c8c8);
  border-radius: 5px;
  background: var(--material-toolbar, #ffffff);
  color: inherit;
  font: menu;
  font-size: 12px;
  line-height: 22px;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.05), 0 0.5px 2.5px rgba(0, 0, 0, 0.3);
  transition: background-color 0.2s ease;
}

#cdrop-btn-titlebar:hover {
  background: color-mix(in srgb, AccentColor 16%, Canvas 84%);
}

#cdrop-btn-titlebar:focus-visible {
  outline: 2px solid var(--focus-outline-color, AccentColor);
  outline-offset: 1px;
}

#cdrop-panel {
  position: fixed;
  width: 420px;
  max-width: min(420px, calc(100vw - 32px));
  display: none;
  z-index: 100000;
  padding: 10px;
  border: 1px solid var(--in-content-box-border-color, #c8c8c8);
  border-radius: 8px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
}

#cdrop-panel.show {
  display: grid;
  gap: 8px;
}

#cdrop-search,
#cdrop-list {
  box-sizing: border-box;
  width: 100%;
}

#cdrop-search {
  padding: 6px 8px;
}

#cdrop-list {
  min-height: 200px;
}

#cdrop-tree {
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--in-content-box-border-color, #d9d9d9);
  border-radius: 6px;
  background: color-mix(in srgb, CanvasText 3%, Canvas 97%);
}

.cdrop-tree-node {
  display: block;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
  user-select: none;
  white-space: normal;
  word-break: break-word;
}

.cdrop-tree-node:hover,
.cdrop-tree-node:focus-visible {
  background: color-mix(in srgb, AccentColor 12%, Canvas 88%);
  outline: none;
}

.cdrop-tree-children {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid color-mix(in srgb, CanvasText 20%, Canvas 80%);
}

.cdrop-tree-leaf {
  margin-left: 20px;
}

.cdrop-empty {
  opacity: 0.7;
}
`;
  styleHost.appendChild(style);

  const button = doc.createElement("button");
  button.id = "cdrop-btn-titlebar";
  button.type = "button";
  button.textContent = "Collections";

  const panel = doc.createElement("div");
  panel.id = "cdrop-panel";

  const search = doc.createElement("input");
  search.id = "cdrop-search";
  search.type = "text";
  search.placeholder = "Filter collections";

  const list = doc.createElement("select");
  list.id = "cdrop-list";
  list.size = 12;

  const tree = doc.createElement("div");
  tree.id = "cdrop-tree";

  panel.append(search, list, tree);
  host.appendChild(panel);

  const titleBar = doc.querySelector("#zotero-title-bar");
  if (titleBar?.firstChild) {
    titleBar.insertBefore(button, titleBar.firstChild);
  } else if (titleBar) {
    titleBar.appendChild(button);
  } else {
    button.style.cssText =
      "position:fixed;top:60px;right:16px;z-index:99999;-moz-window-dragging:no-drag;";
    host.appendChild(button);
  }

  const nodes: WindowNodes = {
    style,
    button,
    panel,
    search,
    list,
    tree,
    collections: [],
    onButtonClick: () => {
      if (panel.classList.contains("show")) {
        panel.classList.remove("show");
        return;
      }
      void openPanel(win, nodes);
    },
    onDocumentMouseDown: (event) => {
      const target = event.target as Node | null;
      if (!panel.classList.contains("show")) {
        return;
      }
      if (target && (panel.contains(target) || target === button)) {
        return;
      }
      panel.classList.remove("show");
    },
    onSearchInput: () => {
      filterCollections(nodes);
    },
    onListDoubleClick: () => {
      void jumpToSelectedCollection(win, nodes);
    },
    onListKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void jumpToSelectedCollection(win, nodes);
      }
    },
    onTreeDoubleClick: (event) => {
      const target = (event.target as HTMLElement | null)?.closest(
        "[data-id]",
      ) as HTMLElement | null;
      const id = Number(target?.dataset.id);
      if (Number.isFinite(id)) {
        void jumpToCollection(win, id);
        panel.classList.remove("show");
      }
    },
    onTreeKeyDown: (event) => {
      if (event.key !== "Enter") {
        return;
      }
      const target = (event.target as HTMLElement | null)?.closest(
        "[data-id]",
      ) as HTMLElement | null;
      const id = Number(target?.dataset.id);
      if (Number.isFinite(id)) {
        event.preventDefault();
        void jumpToCollection(win, id);
        panel.classList.remove("show");
      }
    },
  };

  button.addEventListener("click", nodes.onButtonClick);
  doc.addEventListener("mousedown", nodes.onDocumentMouseDown, true);
  search.addEventListener("input", nodes.onSearchInput);
  list.addEventListener("dblclick", nodes.onListDoubleClick);
  list.addEventListener("keydown", nodes.onListKeyDown);
  tree.addEventListener("dblclick", nodes.onTreeDoubleClick);
  tree.addEventListener("keydown", nodes.onTreeKeyDown);

  applyPanelPreferences(nodes);
  registry.set(win, nodes);
}

export function unmountDropdown(win: Window) {
  const nodes = registry.get(win);
  if (!nodes) {
    return;
  }

  const doc = win.document;
  nodes.button.removeEventListener("click", nodes.onButtonClick);
  doc.removeEventListener("mousedown", nodes.onDocumentMouseDown, true);
  nodes.search.removeEventListener("input", nodes.onSearchInput);
  nodes.list.removeEventListener("dblclick", nodes.onListDoubleClick);
  nodes.list.removeEventListener("keydown", nodes.onListKeyDown);
  nodes.tree.removeEventListener("dblclick", nodes.onTreeDoubleClick);
  nodes.tree.removeEventListener("keydown", nodes.onTreeKeyDown);

  nodes.style.remove();
  nodes.button.remove();
  nodes.panel.remove();
  registry.delete(win);
}
