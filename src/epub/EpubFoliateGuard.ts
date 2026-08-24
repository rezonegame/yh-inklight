/**
 * [INPUT]: 全局 customElements 注册表
 * [OUTPUT]: installFoliateCustomElementGuard，防止 foliate 自定义元素与其他 foliate 插件重复注册冲突
 * [POS]: epub 模块的 foliate 引擎基础设施，迁移自 obsidian-weave-reader 并适配 book-note
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 *
 * 背景：foliate-js 通过 customElements.define 注册 <foliate-view>/<foliate-fxl>/<foliate-paginator>。
 * 若用户同时安装其他基于 foliate 的插件（如 weave），重复 define 同名元素会抛错。
 * guard 拦截 define：对 foliate 元素名，若已注册则跳过。
 */

const FOLIATE_CUSTOM_ELEMENT_NAMES = new Set([
  "foliate-view",
  "foliate-fxl",
  "foliate-paginator",
]);

const GUARD_FLAG = "__yhFoliateCustomElementGuardInstalled__";
const ORIGINAL_DEFINE_KEY = "__yhFoliateOriginalCustomElementDefine__";

type GuardedGlobal = typeof window & {
  [GUARD_FLAG]?: boolean;
  [ORIGINAL_DEFINE_KEY]?: CustomElementRegistry["define"];
};

export function installFoliateCustomElementGuard(
  registry: CustomElementRegistry = customElements,
): void {
  const globalScope = window as GuardedGlobal;
  if (globalScope[GUARD_FLAG]) {
    return;
  }

  const originalDefine = globalScope[ORIGINAL_DEFINE_KEY] || registry.define.bind(registry);
  globalScope[ORIGINAL_DEFINE_KEY] = originalDefine;

  registry.define = function defineWithFoliateGuard(
    this: CustomElementRegistry,
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void {
    if (FOLIATE_CUSTOM_ELEMENT_NAMES.has(name) && this.get(name)) {
      return;
    }
    return originalDefine.call(this, name, constructor, options);
  };

  globalScope[GUARD_FLAG] = true;
}
