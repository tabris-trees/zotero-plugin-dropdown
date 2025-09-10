// === Collection Dropdown (per-window safe version) ===

// setting parameters
// const treeNavEnabled = true;    // 是否启用二级目录导航功能
import { getEnableTreePane, getPanelHeight } from "../utils/prefs";
import { startPrefObserver, stopPrefObserver } from "./prefObserver";

// 每个窗口维护一份节点与事件句柄
type Nodes = {
    style: HTMLStyleElement;
    btn: HTMLButtonElement;
    panel: HTMLDivElement;
    onDocMouseDown: (e: MouseEvent) => void;
    onBtnClick: (e: MouseEvent) => void;
};
const nodeRegistry = new WeakMap<Window, Nodes>();

// 小睡一下，等 UI 刷新
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// 统一写日志到 Zotero Debug 和临时文件
function dlog(win: any, msg: string) {
    try { win.Zotero?.debug?.(msg); } catch { }
    // try {
    //     const p = win.Zotero.getTempDirectory().path + '\\zotero-collection-debug.log';
    //     const t = new Date().toISOString();
    //     const file = win.Zotero.File.pathToFile(p);
    //     win.Zotero.File.putContents(file, `[${t}] ${msg}\n`, { append: true });
    //     win.Zotero?.debug?.(`[cdrop] log to ${p}`);
    // } catch { }
}

// 把任意值描述成字符串（便于看出类型/是否可转为数字）
function describe(val: any) {
    const n = Number(val);
    return `val=${String(val)} type=${typeof val} num=${String(n)} finite=${Number.isFinite(n)}`;
}


// 一把取全库所有集合（含子集合），并生成“A / B / C”路径
async function getCollections(win: any) {
    const { Zotero } = win;

    // 等待 Zotero 完全就绪，避免 ensureLoaded 报错
    await Zotero.initializationPromise;               // ✅ 官方建议
    if (Zotero.Schema?.schemaUpdatePromise) {
        await Zotero.Schema.schemaUpdatePromise.catch(() => { });
    }

    // 当前选中库，取不到就回退到用户库
    let libID = Number(Zotero.getActiveZoteroPane()?.getSelectedLibraryID?.());
    if (!Number.isFinite(libID)) libID = Zotero.Libraries.userLibraryID;

    // 关键：第二个参数传 true → 递归拿到所有（含子集合）
    const cols = Zotero.Collections.getByLibrary(libID, true); // 返回数组

    // 逐个向上追父节点，拼出完整路径
    const list = cols.map((c: any) => {
        const names = [c.name];
        let p = c.parentID ? Zotero.Collections.get(c.parentID) : null;
        while (p) {
            names.unshift(p.name);
            p = p.parentID ? Zotero.Collections.get(p.parentID) : null;
        }
        return { id: c.id, key: c.key, path: names.join(' / ') };
    });

    // 路径排序，便于下拉展示
    return list.sort((a: any, b: any) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true })
    );
}




// —— 挂载：把样式、按钮、面板插入当前窗口 ——
// 按钮默认出现在“右上角”；若你要嵌到工具栏/面包屑，见文件底部注释。
export async function mountDropdown(win: Window) {
    // 避免重复挂载
    if (nodeRegistry.has(win)) return;

    const d = win.document;
    const styleHost = d.head || d.documentElement!;
    const uiHost = d.body || d.documentElement!;

    // let prefPanelHeight = getPanelHeight(); // Panel height (px)

    // ===== 样式：标题栏按钮 + 悬浮面板 =====
    const style = d.createElement("style");
    style.id = "cdrop-style";
    style.textContent = `
    /* 放在标题栏最前面的独立按钮 */
    #cdrop-btn-titlebar {
      -moz-window-dragging: no-drag;       /* 标题栏里必须禁用拖拽，否则吃掉点击 */
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 6px;
      height: 28px; padding: 0 10px; margin-right: 8px; margin-left: 8px;
      margin-top: auto; margin-bottom: auto;
      border: 1px solid var(--in-content-box-border-color, #ccc);
      border-radius: 5px;
      background: #ffffff;
      font: menu; font-size: 12px; line-height: 22px;
      cursor: pointer; user-select: none;
      box-shadow: 0px 0px 0px .5px rgba(0,0,0,.05),0px .5px 2.5px 0px rgba(0,0,0,.3)
      transition: .2s;
    }

    #cdrop-btn-titlebar:hover {
      background: #9FBFD5;
    }
      }
    }
    #cdrop-btn-titlebar:focus { outline: none; }

    /* 面板 */
    #cdrop-panel {
      position: fixed; width: 360px; max-height: 1000px; display: none;
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
                const raw = String((opt as HTMLOptionElement)?.dataset?.id ?? (opt as HTMLOptionElement)?.value ?? '').trim();
                dlog(win, `[cdrop] go(): raw="${raw}" text="${opt?.textContent ?? ''}" → ${describe(raw)}`);
                const id = Number(raw);
                if (!Number.isFinite(id)) {
                    (win as any).Zotero?.debug?.(`[cdrop] go(): invalid option id raw="${raw}" text="${opt?.textContent ?? ''}"`);
                    return;
                }
                await jumpToCollection(win, id);

                panel.classList.remove("show");
            };
            list.addEventListener("dblclick", () => void go());
            list.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void go(); } });

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
    const open = async () => {
        panel.classList.add("show");
        positionPanel();
        void ensureLoaded();
        search.focus();
        let prefEnableTreePane = getEnableTreePane();  // 是否启用二级目录导航功能
        let prefPanelHeight = getPanelHeight();      // 面板高度（px）
        dlog(win, `[cdrop] prefs: enableTreePane=${prefEnableTreePane} panelHeight=${prefPanelHeight}`);
        if (!prefEnableTreePane) {
            const rmID = "cdrop-tree";

            // 开关
            if (!getEnableTreePane()) {
                d.getElementById(rmID)?.remove();
                return;
            }
        };
        try {
            await cdropInstallTreeNav(win);
        } catch (e) {
            dlog(win, '[cdrop] cdropInstallTreeNav error');
        }
    };
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
    // Zotero.debug?.("[cdrop] mount: inserted at #zotero-title-bar (first child)");

    // let prefEnableTreePane = getEnableTreePane();  // 是否启用二级目录导航功能
    // let prefPanelHeight = getPanelHeight();      // 面板高度（px）

    // ===== 安装二级目录功能 =====
    // dlog(win, `[cdrop] prefs: enableTreePane=${prefEnableTreePane} panelHeight=${prefPanelHeight}`);
    // if (!prefEnableTreePane) return;
    // try {
    //     await cdropInstallTreeNav(win);
    // } catch (e) {
    //     dlog(win, '[cdrop] cdropInstallTreeNav error');
    // };

    // startPrefObserver(async (pref) => {
    //     // 只在我们关心的两个键变化时刷新
    //     if (pref.endsWith("enableTreePane") || pref.endsWith("panelHeight")) {
    //         let prefEnableTreePane = getEnableTreePane();
    //         dlog(win, `[cdrop] pref changed: ${pref} → ${String(prefEnableTreePane)}`);
    //         // let prefPanelHeight = getPanelHeight();      // 面板高度（px）
    //         if (!prefEnableTreePane) return;
    //         try {
    //             await cdropInstallTreeNav(win);
    //         } catch (e) {
    //             dlog(win, '[cdrop] cdropInstallTreeNav error');
    //         };
    //     }
    // });
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
                dlog(win, `[cdrop] jump: launchURL -> ${uri}`);
                win.location.href = uri;
                // reference:
                // https://forums.zotero.org/discussion/78312/zotero-uri-vs-select-item
                dlog(win, `[cdrop] jump: launchURL -> ${uri}`);
                return;
            }
        } catch (e: any) {
            dlog(win, `[cdrop] jump: some error has been reported: ${e?.message || e}`);
            return;
        }

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

        const raw = String((opt as HTMLOptionElement)?.dataset?.id ?? (opt as HTMLOptionElement).value ?? '').trim();
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
    stopPrefObserver();
}

/* ============================================
 * cdrop: Tree Navigation Add-on (Non-invasive)
 * 说明：
 * - 这是附加功能模块，不替换你原有的列表逻辑
 * - 只在面板出现时渲染一个树状视图（多级导航）
 * - 不改变现有 DOM，只是追加一个 #cdrop-tree 容器
 * - 所有新 DOM/CSS 节点用独立 id，避免冲突
 * ============================================ */

async function cdropInstallTreeNav(win: any) {                 // 新增一个安装函数：只做“树状导航”的挂载
    const d = win.document as Document;                           // 取窗口文档，供 DOM 操作
    const Zotero: any = (win as any).Zotero;                      // 取 Zotero 句柄，读取集合层次

    // ---- 1) 注入仅供树视图使用的样式（一次性）----
    // —— 树状样式：竖排、层级缩进、折叠箭头、引导线 ——
    // 只影响 #cdrop-tree 作用域内的元素，不会动到你的其他面板样式
    function ensureTreeNavStyle() {
        const css = `
  #cdrop-tree{
    height:${getPanelHeight()}px;overflow:auto;padding:6px 8px;box-sizing:border-box;
    font-size:12px;line-height:1.5;
  }
  /* 统一可点击节点的块级表现与内边距 */
  #cdrop-tree .cdrop-node{
    display:block; position:relative; padding:3px 8px; border-radius:6px;
    cursor:pointer; user-select:none; outline:none;
  }
  #cdrop-tree .cdrop-node:hover,#cdrop-tree .cdrop-node:focus{
    background: color-mix(in srgb, CanvasText 10%, Canvas 90%);
  }

  /* 父节点：用 <details>/<summary>，加箭头 */
  #cdrop-tree details{ margin: 2px 0 2px .25rem; }
  #cdrop-tree summary.cdrop-node{ font-weight:600; }
  #cdrop-tree summary.cdrop-node::before{
    content:"▸"; display:inline-block; width:1em; margin-right:.25em;
    transform: translateY(-.5px);
  }
  #cdrop-tree details[open] > summary.cdrop-node::before{
    transform: rotate(90deg) translateX(.1em);
  }

  /* 子层容器：竖线+缩进，形成树感 */
  #cdrop-tree .cdrop-children{
    margin-left: .75rem; padding-left: .75rem;
    border-left: 1px solid color-mix(in srgb, CanvasText 20%, Canvas 80%);
  }

  /* 叶子节点：和父节点统一风格，但不显示箭头 */
  #cdrop-tree .cdrop-leaf{ margin: 2px 0 2px 1.25rem; }

  /* 可选：长名换行，避免挤成一行 */
  #cdrop-tree .cdrop-node{
    white-space: normal; word-break: break-word;
  }
  `;
        let s = d.getElementById('cdrop-style-tree') as HTMLStyleElement | null;
        if (!s) {
            s = d.createElement('style');
            s.id = 'cdrop-style-tree';
            (d.documentElement || d.body)?.appendChild(s);
        }
        s.textContent = css;
    }


    // ---- 2) 构建 parentID -> children 的索引（一次 O(N)）----
    // 用 parentCollection（父集合的 key）而不是 parentID（数字）
    // key: string | null 作为 Map 的键；value: 原始 collection 对象数组
    async function buildParentIndex(): Promise<Map<string | null, any[]>> {
        const Zot = (Zotero as any);

        await Zot.initializationPromise;
        if (Zot.Schema?.schemaUpdatePromise) { try { await Zot.Schema.schemaUpdatePromise; } catch { } }

        // 当前库 ID（多重兜底可按需保留/精简）
        const pane = Zot.getActiveZoteroPane?.();
        let libID: number | null = Number(pane?.getSelectedLibraryID?.());
        if (!Number.isFinite(libID)) libID = Zot.Libraries?.userLibraryID;

        // 取集合：集合对象里没有 parentID，只有 parentCollection（父 key 或 false）
        const cols: any[] = Zot.Collections?.getByLibrary?.(libID, true) || [];

        const byParent = new Map<string | null, any[]>();
        for (const c of cols) {
            // 顶层：parentCollection === false；否则是父集合的 key（string）
            const pkey: string | null =
                (c?.parentKey && typeof c.parentKey === "string")
                    ? c.parentKey
                    : null;

            dlog(win, `[cdrop] buildParentIndex: key=${describe(c?.key)} parentKey=${describe(pkey)}`);

            const arr = byParent.get(pkey) || [];
            arr.push(c);
            byParent.set(pkey, arr);
        }

        // 同层按名称排序
        for (const arr of byParent.values()) {
            arr.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
        }

        return byParent;
    }

    // ---- 3) 渲染树视图（<details>/<summary> 原生多级展开）----
    function renderTree(container: HTMLElement, byParent: Map<string | null, any[]>) {
        container.textContent = '';

        const roots = byParent.get(null) || [];
        if (roots.length === 0) {
            const em = d.createElement('div');
            em.className = 'cdrop-empty';
            em.textContent = '（此库暂无集合）';
            container.appendChild(em);
            return;
        }

        // 跳转：沿用你已有的统一入口
        const goto = async (col: any) => {
            const spec = typeof col?.id === 'number' && Number.isFinite(col.id)
                ? col.id
                : String(col?.key ?? '');
            await jumpToCollection(win, spec);
            d.getElementById('cdrop-panel')?.classList?.remove('show');
        };

        const mkLeaf = (col: any, depth: number) => {
            const leaf = d.createElement('div');
            leaf.className = 'cdrop-node cdrop-leaf';
            leaf.tabIndex = 0;
            leaf.textContent = col?.name ?? '';
            // 交互：双击 / 回车
            leaf.addEventListener('dblclick', () => { void goto(col); });
            leaf.addEventListener('keydown', (e: KeyboardEvent) => {
                if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void goto(col); }
            });
            return leaf;
        };

        const mkBranch = (col: any, depth: number): HTMLElement => {
            const kids = byParent.get(String(col?.key)) || byParent.get(Number(col?.id) as any) || [];
            if (!kids.length) return mkLeaf(col, depth);

            const det = d.createElement('details');
            det.className = 'cdrop-branch';

            const sum = d.createElement('summary');
            sum.className = 'cdrop-node';
            sum.tabIndex = 0;
            sum.textContent = col?.name ?? '';
            // 父节点也可直接跳转
            sum.addEventListener('dblclick', (e) => { e.preventDefault(); void goto(col); });
            sum.addEventListener('keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void goto(col); }
            });
            det.appendChild(sum);

            const wrap = d.createElement('div');
            wrap.className = 'cdrop-children';
            for (const k of kids) wrap.appendChild(mkBranch(k, depth + 1));
            det.appendChild(wrap);

            return det;
        };

        const root = d.createElement('div');
        for (const r of roots) root.appendChild(mkBranch(r, 0));
        container.appendChild(root);
    }


    // ---- 4) 在面板出现时创建树容器并渲染（不影响原列表）----
    async function mountTreeOnce() {                               // 只在面板出现/刷新时调用，避免重复插入
        ensureTreeNavStyle();                                        // 确保样式到位

        const panel = d.getElementById('cdrop-panel');               // 你的面板容器（现有 DOM）
        if (!panel) return;                                          // 此刻未创建则直接返回（由观察器再次触发）

        const oldList = d.getElementById('cdrop-list');
        if (oldList) oldList.remove();                           // 移除你原有的列表，避免冲突

        let tree = d.getElementById('cdrop-tree') as HTMLElement | null; // 复用已有树容器，避免重复创建
        if (!tree) {
            tree = d.createElement('div');                             // 第一次创建树容器
            tree.id = 'cdrop-tree';
            panel.appendChild(tree);                                   // 追加到面板末尾，不影响你原有列表
        }

        const byParent = await buildParentIndex();                   // 获取当前库的层次结构
        renderTree(tree, byParent);                                  // 渲染树
    }

    // ---- 5) 监听面板出现：首次就装载树（只新增观察，不改你原按钮逻辑）----
    const btn = d.getElementById('cdrop-btn-titlebar');            // 复用你现有的“打开面板”按钮
    btn?.addEventListener('click', () => {                         // 点击后开始等待面板节点出现
        const wait = () => {
            const panel = d.getElementById('cdrop-panel');             // 面板通常是点击后才创建/显示
            if (panel) {
                dlog(win, '[cdrop] panel appeared, installing tree nav…');
                if (panel.classList.contains('show')) { void mountTreeOnce(); } // 若已显示，立即装载树
                const mo = new MutationObserver(muts => {                // 监听面板 class 变化（出现 .show 时装载）
                    for (const m of muts) {
                        if (
                            m.type === 'attributes' &&
                            (m.target as HTMLElement).id === 'cdrop-panel' &&
                            (m.target as HTMLElement).classList.contains('show')
                        ) {
                            void mountTreeOnce();                              // 出现时装一次
                        }
                    }
                });
                mo.observe(panel, { attributes: true, attributeFilter: ['class'] }); // 只关心 class 改变，减小开销
            } else {
                setTimeout(wait, 16); // 使用 setTimeout 替代 requestAnimationFrame，轻量轮询下一帧
            }
        };
        setTimeout(wait, 16); // 等待一帧给主题时间生成 DOM
    }, { capture: true });                                         // capture: true 保证在面板内部自己的监听之前执行

    // ---- 6) 可选：集合变化时，若面板打开则重绘树（保持实时）----
    try {
        Zotero.Notifier.registerObserver({                           // 监听集合增删改事件
            notify: async (event: string, type: string) => {
                if (type === 'collection' && (event === 'add' || event === 'modify' || event === 'delete')) {
                    const panel = d.getElementById('cdrop-panel');
                    if (panel?.classList?.contains('show')) await mountTreeOnce(); // 面板可见时才重绘，避免无谓开销
                }
            },
        }, ['collection'], 'cdrop-tree-observer');                   // 用唯一名称注册，方便将来反注册
    } catch { }                                                     // 环境异常（如早期版本）下忽略，不影响主流程

    // ---- 7) 兼容：若启动时面板恰好已显示（少数主题），立即装载一次 ----
    if (d.getElementById('cdrop-panel')?.classList?.contains('show')) {
        await mountTreeOnce();                                       // 确保首次就有树
    }
}
