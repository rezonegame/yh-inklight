# scripts/
> L2 | 父级: /Users/epiphanyxiao/Documents/Playground/obsidian-annotation-plugin/AGENTS.md

成员清单
install.sh: 一条命令安装器，从 GitHub release 下载 main.js、manifest.json、styles.css 到指定 Obsidian vault。
test.mjs: 使用 esbuild 临时编译纯 TypeScript 测试并交给 Node 测试运行器执行，不进入生产包。

法则: 安装脚本只搬运 release 产物·不修改 vault 内容·失败信息必须可执行

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
