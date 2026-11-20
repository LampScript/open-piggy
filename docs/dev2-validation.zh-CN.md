# Linux 服务器浏览器启动故障与验证

日期：2026-11-20。环境：用户指定的开发服务器，Debian10 / x86_64 / Node22.16.0。本文不公开主机地址、账号、Cookie、登录 URL 查询参数或任何真实二维码。

## 实际根因

CLI 0.1.0-preview.5 与 Playwright1.65.1 已安装，但该账号的浏览器缓存缺少对应 Chromium1255及 headless-shell1255。直接调用与登录代码一致的 `launchPersistentContext({headless:true})` 之前，普通 Chromium启动已返回“Executable doesn't exist”。这是本次启动失败的直接证据，不是根据系统版本猜测的结果。

使用已安装 Playwright 自己的 CLI 安装 `chromium` 后，匹配二进制已下载。同一账号、同一 Node/Playwright、同样的 persistent headless context 在 about:blank 启动成功。没有安装额外系统库、升级 glibc、修改 sandbox参数或借用其他账号的 Chrome profile。

系统不是 Playwright 官方支持的发行版，安装器会提示使用回退构建；实际空白页和离线 fixture 测试通过不等于对未来所有浏览器版本作兼容保证。

## 本次程序修复

```sh
open-piggy browser install
open-piggy browser doctor
```

- install：使用本 CLI 实际安装的 Playwright 版本，不调用不相关的 npx/latest；安装日志写 stderr，结果保持 JSON。
- doctor：检查二进制并启动独立临时 persistent headless context，只打开 about:blank，验证后清理。失败非零退出，不会访问官方登录页。
- 启动错误区分缺少 Playwright、缺少浏览器、缺系统库、运行时／架构不兼容、缺少显示环境。输出不包含原始启动参数、profile路径或URL。
- 已知登录启动失败不再以顶层 status0 冒充任务创建成功；该情况返回 status1和非零退出。查询既有任务依旧是读取操作，需要检查 data.state。
- Playwright版本固定为本次验收的1.65.1。npm安装CLI本身仍不会自动下载浏览器，首次需要在执行登录的同一用户账号下安装。

## 通过的实际测试

- 修复前：缺少匹配二进制，浏览器启动失败。
- 修复后：persistent Chromium about:blank启动成功。
- 新 browser doctor：ready=true，headlessBlankSmoke=passed，cleanup=complete。
- 新 browser install：匹配版本安装检查成功。
- 源码类型检查、104项测试及构建通过。
- 使用真实 Chromium 的离线组件链路通过：本地合成 iframe、canvas、隐藏首节点和扫码模式按钮；提取可解码二维码；终端渲染；本机交接状态；合成会话保存；二维码/profile/交接端口清理。

离线组件测试命令：

```sh
npm run test:login-browser
```

它使用 about:blank/srcdoc 和合成图像。传给提取函数的登录 origin 是测试元数据，不是实际浏览器导航；测试上下文的页面HTTP请求都会中止，并断言页面外网请求为0。合成 Cookie 只保存在隔离测试目录，不进入用户的真实配置目录。

## 尚未完成的真实验收

**没有在这台服务器上访问官方登录 URL、生成真实官方登录二维码或执行真实账号扫码。** 当前电脑控制工具对该 URL 的限制不能通过移到另一台机器来绕过。

因此本次可以确认浏览器启动故障已修复、客户端离线链路已通过；不能宣称真实官方扫码端到端登录已通过，也不能以合成会话证明账号已登录。后续仍需允许访问环境中的官方页面与扫码验收。

## 全局安装包验收

本地构建的 preview.6 发布包已安装到该服务器原有的用户级全局 npm prefix。直接执行全局二进制确认版本为0.1.0-preview.6；browser doctor再次返回ready=true、Playwright1.65.1、headlessBlankSmoke=passed、cleanup=complete；全局 browser install也完成匹配版本检查。没有执行auth login或访问真实登录页。
