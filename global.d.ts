declare module '*?raw' {
    const content: string;
    export default content;
}
declare module '*?url' {
    const content: string;
    export default content;
}
declare module '*.html' {
    const content: string;
    export default content;
}
declare module '*.md' {
    const content: string;
    export default content;
}
declare module '*.css' {
    const content: unknown;
    export default content;
}
declare module '*.vue' {
    import { DefineComponent } from 'vue';
    const component: DefineComponent;
    export default component;
}

declare const YAML: typeof import('yaml');

declare const z: typeof import('zod');
declare namespace z {
    export type infer<T> = import('zod').infer<T>;
    export type input<T> = import('zod').input<T>;
    export type output<T> = import('zod').output<T>;
}

declare const __BUILD_DATE__: string | undefined;
declare const __COMMIT_ID__: string | undefined;

// CFS-MVU 改动 #7：角色卡 MVU 脚本接管所需的 JS-Slash-Runner 脚本管理 API。
// CFS-MVU 自带的 slash-runner/@types 版本较旧、无此声明；运行时 ST 的新版
// JS-Slash-Runner（dist/@types.txt 已声明）提供这些全局函数。此处补 ambient
// 声明仅为满足编译期，结构与运行时一致。
type CfsScriptButton = { name: string; visible: boolean };
type CfsScript = {
    type: 'script';
    enabled: boolean;
    name: string;
    id: string;
    content: string;
    info: string;
    button: { enabled: boolean; buttons: Array<CfsScriptButton> };
    data: Record<string, any>;
    export_with: { data: boolean; button: boolean };
};
type CfsScriptFolder = {
    type: 'folder';
    enabled: boolean;
    name: string;
    id: string;
    icon: string;
    color: string;
    scripts: CfsScript[];
};
type CfsScriptTree = CfsScript | CfsScriptFolder;
type CfsScriptTreesOptions = { type: 'global' | 'preset' | 'character' };
declare function getScriptTrees(option: CfsScriptTreesOptions): CfsScriptTree[];
declare function updateScriptTreesWith(
    updater: (script_trees: CfsScriptTree[]) => CfsScriptTree[],
    option: CfsScriptTreesOptions,
): CfsScriptTree[];
