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

// 小睡一下，等 UI 刷新
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// 统一写日志到 Zotero Debug 和临时文件
function dlog(win: any, msg: string) {
    try { win.Zotero?.debug?.(msg); } catch { }
    try {
        const p = win.Zotero.getTempDirectory().path + '/zotero-collection-debug.log';
        const t = new Date().toISOString();
        win.Zotero.File.putContents(p, `[${t}] ${msg}\n`, { append: true });
        win.Zotero?.debug?.(`[cdrop] log to ${p}`);
    } catch { }
}

// 把任意值描述成字符串（便于看出类型/是否可转为数字）
function describe(val: any) {
    const n = Number(val);
    return `val=${String(val)} type=${typeof val} num=${String(n)} finite=${Number.isFinite(n)}`;
}

// 扫描左侧集合树，打印前 N 行的 “行ID” 情况，帮助定位为什么会出现 NaN
async function diagnoseTree(win: any, pane: any, hintID: any, hintKey?: string, maxRows = 60) {
    const view: any = pane?.collectionsView;
    const tree: any = (view && (view._tree || view.tree)) || win.document.getElementById('zotero-collections-tree');
    const tv: any = tree?.view;

    const rowCount = Number(tv?.rowCount ?? 0) >>> 0;
    dlog(win, `[cdrop][diag] rowCount=${rowCount} hintID=${describe(hintID)} hintKey=${hintKey ?? ''}`);

    const N = Math.min(rowCount, maxRows);
    for (let i = 0; i < N; i++) {
        let got: any = undefined;
        try {
            got = tv.getIDForIndex?.(i) ?? tv.getItemAtIndex?.(i) ?? tv.getItemAtRow?.(i);
        } catch (e: any) {
            dlog(win, `[cdrop][diag] i=${i} getID error: ${e?.message || e}`);
            continue;
        }
        dlog(win, `[cdrop][diag] i=${i} id=${describe(got)}`);
    }
}

// // 生成log文件
// function dlog(win: any, msg: string) {
//     try {
//         const path = win.Zotero.getTempDirectory().path + '/zotero-collection-debug.log';
//         const stamp = new Date().toISOString();
//         win.Zotero.File.putContents(path, `[${stamp}] ${msg}\n`, { append: true });
//         Zotero.debug?.(`[cdrop] log to ${path}: ${msg}`);
//     } catch (_) { }
// }


// 取集合并生成“路径”，全部走当前窗口的 Zotero（更稳）
async function getCollections(win: any) {
    const { Zotero } = win;

    // 用“当前选中库”为主，退化到 userLibraryID
    let libID: number | undefined;
    try { libID = Number(Zotero.getActiveZoteroPane()?.getSelectedLibraryID?.()); } catch { }
    if (!Number.isFinite(libID)) libID = Number(Zotero.Libraries?.userLibraryID);

    let rows: Array<{ id: number | string; parentID?: number | string; name: string }> = [];

    try {
        const cols = await Zotero.Collections.getByLibrary(libID);
        rows = cols.map((c: any) => ({
            id: c.id ?? c.collectionID,      // 有的构建可能是字符串
            parentID: c.parentID ?? c.parent,
            name: c.name,
        }));
    } catch {
        const sql = `SELECT collectionID AS id, parentID, name FROM collections WHERE libraryID = ?`;
        rows = (await Zotero.DB.queryAsync(sql, [libID])) as any;
    }

    // ✅ 只在确实是数字时才转 number，否则保留原值，避免 NaN
    const maybeNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : String(v));

    rows = rows.map(r => ({
        id: maybeNum(r.id),
        parentID: r.parentID != null ? maybeNum(r.parentID) : undefined,
        name: String(r.name ?? '')
    }))
        .filter(r => r.id !== undefined && r.id !== null && r.id !== '');

    // 你的“构树 + DFS → path”逻辑保持不变
    const byId = new Map(rows.map(r => [r.id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const r of byId.values()) {
        if (r.parentID != null && byId.has(r.parentID)) byId.get(r.parentID)!.children.push(r);
        else roots.push(r);
    }
    const list: Array<{ id: any; path: string }> = [];
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
// —— 仅替换这个函数 ——
// 目标：确保不仅树被选中，而且“中栏也刷新”（触发完整联动）
async function jumpToCollection(win: any, spec: number | string | { id?: number | string }) {
    try {
        const { Zotero } = win;
        const pane: any = Zotero?.getActiveZoteroPane?.() || win.ZoteroPane;
        if (!pane) { dlog(win, '[cdrop] jump: no Zotero pane'); return; }

        // 1) 解析入参
        const inId = (typeof spec === 'object') ? (spec as any)?.id : spec;
        const tryNum = Number(inId);
        const id: number | string = Number.isFinite(tryNum) ? tryNum : String(inId ?? '').trim();
        if (id === '' || id === undefined || id === null) {
            dlog(win, `[cdrop] jump: invalid input id = ${String(inId)}`);
            return;
        }

        // 2) 拿 Collection 对象（优先 number，其次按 key 查 DB）
        let col: any = null;
        try {
            col = (typeof id === 'number') ? Zotero.Collections.get(id) : null;
            if (!col && typeof id === 'string') {
                const row = await Zotero.DB.valueQueryAsync(
                    'SELECT collectionID FROM collections WHERE key = ? LIMIT 1', [id]
                );
                if (row) col = Zotero.Collections.get(Number(row));
            }
        } catch { }

        if (!col) { dlog(win, `[cdrop] jump: collection not found for ${String(id)}`); return; }

        const realID: number = Number(col.id);
        const libID: number = Number(col.libraryID);
        const cKey: string = String(col.key || '');

        // 3) 首选：URI 跳转（触发完整联动）
        //   - 个人库: zotero://select/library/collections/<key>
        //   - 群组库: zotero://select/groups/<libraryID>/collections/<key>
        try {
            const isUser = (libID === Zotero.Libraries?.userLibraryID);
            const uri = isUser
                ? `zotero://select/library/collections/${cKey}`
                : `zotero://select/groups/${libID}/collections/${cKey}`;

            if (Zotero?.URI?.select) {
                Zotero.URI.select(uri);
                dlog(win, `[cdrop] jump: URI.select -> ${uri}`);
                return;
            }
            // 部分环境没有 URI.select，但可以“打开链接”
            if (typeof Zotero.launchURL === 'function') {
                win.location.href = uri;
                // reference:
                // https://forums.zotero.org/discussion/78312/zotero-uri-vs-select-item
                dlog(win, `[cdrop] jump: launchURL -> ${uri}`);
                return;
            }
        } catch (e: any) {
            dlog(win, `[cdrop] jump: URI route failed: ${e?.message || e}`);
        }

        // 4) 次选：面板 API（多数构建可用，能触发中栏刷新）
        try { pane.selectLibrary?.(libID); } catch { }
        // 等视图 ready 一下
        await new Promise(r => setTimeout(r, 50));

        if (typeof pane.selectCollection === 'function' && Number.isFinite(realID)) {
            try {
                pane.selectCollection(realID);
                dlog(win, `[cdrop] jump: pane.selectCollection(${realID}) OK`);
                return;
            } catch (e: any) {
                dlog(win, `[cdrop] jump: pane.selectCollection failed: ${e?.message || e}`);
            }
        } else {
            dlog(win, `[cdrop] jump: pane.selectCollection not available!!!`);
        }

        // 5) 兜底：视图层（可能只高亮，不触发回调；因此额外“人工触发”一次 select 事件）
        const view: any = pane?.collectionsView;
        const tree: any = (view && (view._tree || view.tree)) || win.document.getElementById('zotero-collections-tree');

        if (view && typeof view.selectByID === 'function' && Number.isFinite(realID)) {
            try {
                // 1) 选中左侧树里的该集合
                view.selectByID(realID, true, true);

                // 2) 找到“真正的”树 DOM 节点（不要用 view._tree）
                const doc = (view as any)?._ownerDocument || win.document; // ← 关键：用 ownerDocument 更稳
                const treeEl = doc.getElementById('zotero-collections-tree') as any;

                // 3) 尝试触发选择联动
                if (treeEl && typeof treeEl.dispatchEvent === 'function') {
                    try {
                        // 聚焦一下，让 UI 知道变化
                        treeEl.focus?.();

                        const Ev = doc.defaultView?.Event || win.Event;
                        const evt = new Ev('select', { bubbles: true });
                        treeEl.dispatchEvent(evt);
                    } catch { }
                } else {
                    // 退一步：有些构建把处理器挂在 view 上
                    try { (view as any).onSelect?.(); } catch { }
                    try { (view as any).selectionChanged?.(); } catch { }
                }

                dlog(win, `[cdrop] jump: view.selectByID(${realID}) + dispatch(select via DOM)`);
                return;
            } catch (e: any) {
                dlog(win, `[cdrop] jump: view.selectByID failed: ${e?.message || e}`);
            }
        }


        // 6) 最后再做一次树行兜底（只在 realID 是有限数字时）
        if (Number.isFinite(realID)) {
            try { view?.expandToID?.(realID); } catch { }
            let row = -1;
            try {
                if (typeof view?.getRowIndexByID === 'function') row = Number(view.getRowIndexByID(realID));
                else if (typeof tree?.view?.getRowIndexByID === 'function') row = Number(tree.view.getRowIndexByID(realID));
            } catch { }
            if (row >= 0 && tree?.view?.selection) {
                try {
                    tree.view.selection.select(row);
                    tree.ensureRowIsVisible?.(row);
                    // 再人工触发一次 select
                    try { tree?.dispatchEvent?.(new win.Event('select', { bubbles: true })); } catch { }
                    dlog(win, `[cdrop] jump: tree.select row=${row} id=${realID} + dispatch(select)`);
                    return;
                } catch (e: any) {
                    dlog(win, `[cdrop] jump: tree.select failed: ${e?.message || e}`);
                }
            }
        }

        dlog(win, `[cdrop] jump: all routes failed (id=${String(id)}, key=${cKey})`);
    } catch (e: any) {
        dlog(win, '[cdrop] jump error: ' + (e?.stack || e));
    }
}




// === REPLACE ENTIRE FUNCTION ===
// 作用：从 <select> 读出选中项，解析 id -> 调 jumpToCollection
// 作用：从 <select> 读出选中项，解析 id -> 调 jumpToCollection
async function go(win: any, selectEl: HTMLSelectElement) {
    try {
        if (!selectEl) return;
        const opt = selectEl.options?.[selectEl.selectedIndex];
        if (!opt) { dlog(win, '[cdrop] go(): no selected option'); return; }

        const raw = String((opt as any)?.dataset?.id ?? opt.value ?? '').trim();
        dlog(win, `[cdrop] go(): raw="${raw}" text="${opt.textContent?.trim() || ''}" → ${describe(raw)}`);

        const parsed = Number(raw);
        const id: number | string = Number.isFinite(parsed) ? parsed : raw;

        await jumpToCollection(win, id);
    } catch (e: any) {
        (win as any).Zotero?.debug?.('[cdrop] go() error: ' + (e?.stack || e));
        dlog(win, '[cdrop] go() error: ' + (e?.stack || e));
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
