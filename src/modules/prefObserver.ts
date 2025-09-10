// src/modules/prefObserver.ts
import { config } from "../../package.json";
declare const ChromeUtils: any;
declare const Components: any;

// --- 1) 更稳的 Services 获取 ---
function getServices(): any {
    try {
        // Zotero 7 / Gecko 115
        return ChromeUtils.import("resource://gre/modules/Services.jsm").Services;
    } catch (e) {
        try {
            // 某些环境下（或类型声明不全）退回 Components.utils.import
            return Components.utils.import("resource://gre/modules/Services.jsm").Services;
        } catch {
            return null;
        }
    }
}
const Services: any = getServices();

// --- 2) 监听实现 ---
type OnChange = (fullPrefName: string) => void;

const PREFIX = `extensions.zotero.${config.addonRef}.`;

let _registered = false;
let _observer: any = null;
let _usedRoot = false; // 记录用的是哪种 API，便于卸载

/** 监听 extensions.zotero.<addonRef>. 下所有首选项的变化 */
export function startPrefObserver(onChange: OnChange) {
    stopPrefObserver(); // 防重复注册
    if (!Services) return;

    _observer = {
        observe(_subject: any, topic: string, data: string) {
            if (topic !== "nsPref:changed") return;
            // data: 若用 root 监听，通常是叶名；个别实现可能给全名，下面统一成全名
            const full = data.startsWith(PREFIX) ? data : (PREFIX + data);
            onChange(full);
        },
    };

    try {
        // ✅ 优先：根分支监听（ESR115 签名：addObserver(domain, observer)）
        Services.prefs.addObserver(PREFIX, _observer);
        _usedRoot = true;
        _registered = true;
    } catch {
        // ↩︎ 回退：子分支监听
        try {
            Services.prefs.getBranch(PREFIX).addObserver("", _observer);
            _usedRoot = false;
            _registered = true;
        } catch {
            // 两种都失败：放弃
            _observer = null;
            _registered = false;
        }
    }
}

/** 取消监听（在 onShutdown 或界面销毁时调用） */
export function stopPrefObserver() {
    if (!Services || !_registered || !_observer) return;
    try {
        if (_usedRoot) {
            Services.prefs.removeObserver(PREFIX, _observer);
        } else {
            Services.prefs.getBranch(PREFIX).removeObserver("", _observer);
        }
    } catch {
        // 忽略卸载异常
    } finally {
        _registered = false;
        _observer = null;
    }
}
