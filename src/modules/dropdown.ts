// === Collection Dropdown (per-window safe version) ===

// 每个窗口维护一份节点与事件句柄
type Nodes = {
    style: HTMLStyleElement;
    btn: HTMLButtonElement;
    panel: HTMLDivElement;
    onDocMouseDown: (e: MouseEvent) => void;
    onBtnClick: () => void;
};
const nodeRegistry = new WeakMap<Window, Nodes>();

// 生成log文件
function appendLog(win: any, msg: string) {
    try {
        const path = win.Zotero.getTempDirectory().path + '/zotero-collection-debug.log';
        const stamp = new Date().toISOString();
        win.Zotero.File.putContents(path, `[${stamp}] ${msg}\n`, { append: true });
    } catch (_) { }
}


// 取集合并生成“路径”，全部走当前窗口的 Zotero（更稳）
async function getCollections(win: any) {
    const { Zotero } = win;
    const libID = Zotero.Libraries.userLibraryID;

    let rows: Array<{ id: number; parentID?: number; name: string }> = [];
    try {
        const cols = await Zotero.Collections.getByLibrary(libID);
        rows = cols.map((c: any) => ({
            id: c.id ?? c.collectionID,
            parentID: c.parentID ?? c.parent,
            name: c.name,
        }));
    } catch {
        const sql = `SELECT collectionID AS id, parentID, name FROM collections WHERE libraryID = ?`;
        rows = (await Zotero.DB.queryAsync(sql, [libID])) as any;
    }

    // 统一把 id / parentID 变成 number，并过滤掉异常
    rows = rows.map(r => ({
        id: Number(r.id),
        parentID: r.parentID != null ? Number(r.parentID) : undefined,
        name: String(r.name ?? '')
    })).filter(r => Number.isFinite(r.id));


    // 构树 → DFS 生成路径
    const byId = new Map(rows.map(r => [r.id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const r of byId.values()) {
        if (r.parentID && byId.has(r.parentID)) byId.get(r.parentID)!.children.push(r);
        else roots.push(r);
    }
    const list: Array<{ id: number; path: string }> = [];
    (function dfs(ns: any[], prefix: string) {
        for (const n of ns) {
            const p = prefix ? `${prefix} / ${n.name}` : n.name;
            list.push({ id: n.id, path: p });
            if (n.children.length) dfs(n.children, p);
        }
    })(roots, "");
    return list.sort((a, b) => a.path.localeCompare(b.path));
}

// —— 挂载：把样式、按钮、面板插入当前窗口 ——
// 按钮默认出现在“右上角”；若你要嵌到工具栏/面包屑，见文件底部注释。
export async function mountDropdown(win: Window) {
    // 避免重复挂载
    if (nodeRegistry.has(win)) return;

    const d = win.document;
    const styleHost = d.head || d.documentElement!;
    const uiHost = d.body || d.documentElement!;

    // ===== 样式：标题栏按钮 + 悬浮面板 =====
    const style = d.createElement("style");
    style.id = "cdrop-style";
    style.textContent = `
    /* 放在标题栏最前面的独立按钮 */
    #cdrop-btn-titlebar {
      -moz-window-dragging: no-drag;       /* 标题栏里必须禁用拖拽，否则吃掉点击 */
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 6px;
      height: 24px; padding: 0 10px; margin-right: 8px;
      border: 1px solid var(--in-content-box-border-color, #ccc);
      border-radius: 7px;
      background: var(--in-content-box-background, #f5f5f5);
      font: menu; font-size: 12px; line-height: 22px;
      cursor: pointer; user-select: none;
    }
    #cdrop-btn-titlebar:focus { outline: none; }

    /* 面板 */
    #cdrop-panel {
      position: fixed; width: 360px; max-height: 420px; display: none;
      z-index: 100000; background: #fff; border: 1px solid #ccc; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.15); padding: 8px;
    }
    #cdrop-panel.show { display: block; }
    #cdrop-search { width: 100%; padding: 6px 8px; box-sizing: border-box; }
    #cdrop-list   { width: 100%; height: 320px; margin-top: 8px; box-sizing: border-box; }
  `;
    styleHost.appendChild(style);

    // ===== 元素：按钮 + 面板 =====
    const btn = d.createElement("button");
    btn.id = "cdrop-btn-titlebar";
    btn.type = "button";
    btn.textContent = "Collections Navigation";

    const panel = d.createElement("div");
    panel.id = "cdrop-panel";
    const search = d.createElement("input");
    search.id = "cdrop-search"; search.type = "text"; search.placeholder = "Filter collections…";
    const list = d.createElement("select");
    list.id = "cdrop-list"; (list as any).size = 12;
    panel.appendChild(search); panel.appendChild(list);
    uiHost.appendChild(panel);

    // ===== 把按钮插到标题栏最前面（找不到就右上角兜底） =====
    const titleBar = d.querySelector('#zotero-title-bar') as HTMLElement | null;
    if (titleBar) {
        titleBar.insertBefore(btn, titleBar.firstChild);
    } else {
        // 兜底：固定右上角，至少可见
        btn.style.cssText += 'position:fixed;top:60px;right:16px;z-index:99999';
        uiHost.appendChild(btn);
    }

    // ===== 懒加载集合 =====
    let loaded = false;
    let all: Array<{ id: number; path: string }> = [];

    async function ensureLoaded() {
        if (loaded) return;
        list.textContent = "";
        const loading = d.createElement("option"); loading.textContent = "Loading…"; list.appendChild(loading);

        try {
            all = await getCollections(win as any);
            list.textContent = "";

            if (!all.length) {
                const empty = d.createElement("option"); empty.textContent = "No collections"; list.appendChild(empty);
            } else {
                for (const c of all) {
                    const opt = d.createElement("option");
                    opt.value = String(c.id);
                    opt.dataset.id = String(c.id);       // 再存一份，避免主题改写 value
                    opt.textContent = c.path;
                    list.appendChild(opt);
                }
            }

            // 过滤
            search.addEventListener("input", () => {
                const q = search.value.trim().toLowerCase();
                const shown = !q ? all : all.filter(c => c.path.toLowerCase().includes(q));
                list.textContent = "";
                for (const c of shown) {
                    const opt = d.createElement("option");
                    opt.value = String(c.id);
                    opt.dataset.id = String(c.id);
                    opt.textContent = c.path;
                    list.appendChild(opt);
                }
            });

            // 跳转
            const go = async () => {
                const opt = list.options[list.selectedIndex];
                if (!opt) return;
                const raw = String(opt?.dataset?.id ?? opt?.value ?? '').trim();
                const id = Number(raw);
                if (!Number.isFinite(id)) {
                    (win as any).Zotero?.debug?.(`[cdrop] go(): invalid option id raw="${raw}" text="${opt?.textContent ?? ''}"`);
                    return;
                }
                await jumpToCollection(win, id);

                panel.classList.remove("show");
            };
            list.addEventListener("dblclick", () => void go());
            list.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); void go(); } });

            loaded = true;
            Zotero.debug?.(`[cdrop] loaded ${all.length} collections`);
        } catch (e) {
            list.textContent = "";
            const err = d.createElement("option");
            err.textContent = "Error: " + ((e as any)?.message ?? String(e));
            list.appendChild(err);
            Zotero.debug?.("[cdrop] ensureLoaded error: " + ((e as any)?.stack || e));
        }
    }

    // ===== 面板开合 =====
    function positionPanel() {
        const rect = btn.getBoundingClientRect();
        const width = 360;
        let left = rect.left;                       // 与按钮左对齐更直觉
        left = Math.max(16, Math.min(left, win.innerWidth - width - 16));
        panel.style.left = `${left}px`;
        panel.style.top = `${rect.bottom + 6}px`;
    }
    const open = () => { panel.classList.add("show"); positionPanel(); void ensureLoaded(); search.focus(); };
    const close = () => panel.classList.remove("show");

    const onBtnClick = (e: MouseEvent) => {
        e.stopPropagation();
        panel.classList.contains("show") ? close() : open();
    };
    btn.addEventListener("click", onBtnClick);

    const onDocMouseDown = (e: MouseEvent) => {
        if (panel.classList.contains("show") && !panel.contains(e.target as Node) && e.target !== btn) close();
    };
    d.addEventListener("mousedown", onDocMouseDown, true);

    // ===== 注册到 registry（unmount 时会统一清理） =====
    nodeRegistry.set(win, {
        style,
        btn,
        panel,
        onDocMouseDown,
        onBtnClick,
    });
    Zotero.debug?.("[cdrop] mount: inserted at #zotero-title-bar (first child)");
}


// === REPLACE ENTIRE FUNCTION ===
async function jumpToCollection(win: any, spec: number | { id?: number }) {
    try {
        const { Zotero } = win;
        const pane: any = win.Zotero?.getActiveZoteroPane?.() || win.ZoteroPane;

        if (!pane) {
            Zotero?.debug?.('[cdrop] jumpToCollection: no Zotero pane');
            appendLog(win, '[cdrop] jumpToCollection: no Zotero pane');
            return;
        }

        // 1) 解析入参 -> id
        let id = (typeof spec === 'number') ? spec : (spec && Number((spec as any).id));
        if (!Number.isFinite(id)) {
            Zotero?.debug?.(`[cdrop] jumpToCollection: invalid id (in) = ${String(id)}`);
            appendLog(win, `[cdrop] jumpToCollection: invalid id (in) = ${String(id)}`);
            return;
        }
        id = Number(id);

        // 2) 以“真实对象”的 id 为准（避免 NaN/字符串）
        let col: any = null;
        try { col = Zotero.Collections.get(id); } catch { }
        if (!col) {
            Zotero?.debug?.(`[cdrop] jumpToCollection: collection not found for id=${id}`);
            appendLog(win, `[cdrop] jumpToCollection: collection not found for id=${id}`);
            return;
        }
        id = Number(col.id);
        if (!Number.isFinite(id)) {
            Zotero?.debug?.(`[cdrop] jumpToCollection: invalid col.id = ${String(col.id)}`);
            appendLog(win, `[cdrop] jumpToCollection: invalid col.id = ${String(col.id)}`);
            return;
        }

        // 3) 切换到正确的库（若存在）
        try { pane.selectLibrary?.(col.libraryID); } catch { }

        // 4) 首选面板 API
        if (typeof pane.selectCollection === 'function') {
            try {
                pane.selectCollection(id);
                Zotero?.debug?.(`[cdrop] jumpToCollection: pane.selectCollection(${id})`);
                appendLog(win, `[cdrop] pane.selectCollection(${id}) OK`);
                return;
            } catch (e: any) {
                Zotero?.debug?.(`[cdrop] jumpToCollection: pane.selectCollection failed: ${e?.message || e}`);
                appendLog(win, `[cdrop] pane.selectCollection failed: ${e?.message || e}`);
            }
        }

        // 5) 退到 collectionsView（新 UI 常见）
        const view: any = pane?.collectionsView;
        const tree: any = (view && (view._tree || view.tree)) || win.document.getElementById('zotero-collections-tree');

        // 5.1 view.selectByID
        if (view && typeof view.selectByID === 'function') {
            try {
                view.selectByID(id, true, true);
                Zotero?.debug?.(`[cdrop] jumpToCollection: view.selectByID(${id})`);
                appendLog(win, `[cdrop] view.selectByID(${id}) OK`);
                return;
            } catch (e: any) {
                appendLog(win, `[cdrop] view.selectByID failed: ${e?.message || e}`);
            }
        }

        // 5.2 尝试展开到该 ID
        try { view?.expandToID?.(id); } catch { }

        // 5.3 通过行号选择
        let row = -1;
        try {
            if (typeof view?.getRowIndexByID === 'function') row = view.getRowIndexByID(id);
            else if (typeof tree?.view?.getRowIndexByID === 'function') row = tree.view.getRowIndexByID(id);
        } catch { }

        if (row >= 0 && tree?.view?.selection) {
            try {
                tree.view.selection.select(row);
                tree.ensureRowIsVisible?.(row);
                Zotero?.debug?.(`[cdrop] jumpToCollection: tree.select row=${row} id=${id}`);
                appendLog(win, `[cdrop] tree.select row=${row} id=${id} OK`);
                return;
            } catch (e: any) {
                appendLog(win, `[cdrop] tree.select failed: ${e?.message || e}`);
            }
        }

        Zotero?.debug?.(`[cdrop] jumpToCollection: id ${id} not found in view`);
        appendLog(win, `[cdrop] id ${id} not found in view`);
    } catch (e: any) {
        // 把完整堆栈打到 Zotero 日志 & 文件
        (win as any).Zotero?.debug?.('[cdrop] jumpToCollection error: ' + (e?.stack || e));
        appendLog(win, '[cdrop] jumpToCollection error: ' + (e?.stack || e));
    }
}

// === REPLACE ENTIRE FUNCTION ===
// 作用：从 <select> 读出选中项，解析 id -> 调 jumpToCollection
async function go(win: any, selectEl: HTMLSelectElement) {
    try {
        if (!selectEl) return;
        const opt = selectEl.options?.[selectEl.selectedIndex];
        if (!opt) {
            appendLog(win, '[cdrop] go(): no selected option');
            return;
        }

        // 既读 data-id 也读 value
        const raw = String((opt as any)?.dataset?.id ?? opt.value ?? '').trim();
        const id = Number(raw);

        if (!Number.isFinite(id)) {
            const txt = opt.textContent?.trim() || '';
            (win as any).Zotero?.debug?.(`[cdrop] go(): invalid option id raw="${raw}" text="${txt}"`);
            appendLog(win, `[cdrop] go(): invalid option id raw="${raw}" text="${txt}"`);
            return;
        }

        await jumpToCollection(win, id);
    } catch (e: any) {
        (win as any).Zotero?.debug?.('[cdrop] go() error: ' + (e?.stack || e));
        appendLog(win, '[cdrop] go() error: ' + (e?.stack || e));
    }
}

// —— 卸载：移除事件与节点（按窗口） ——
export function unmountDropdown(win: Window) {
    const nodes = nodeRegistry.get(win);
    if (!nodes) return;

    const d = win.document;
    nodes.btn.removeEventListener("click", nodes.onBtnClick);
    d.removeEventListener("mousedown", nodes.onDocMouseDown, true);

    nodes.style.remove();
    nodes.btn.remove();
    nodes.panel.remove();

    nodeRegistry.delete(win);
}
