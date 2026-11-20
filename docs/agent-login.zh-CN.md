# 终端与 Agent 扫码登录（preview.7）

默认不弹出浏览器窗口。交互式终端会显示二维码并等待扫码确认；Agent 使用 `--detach` 创建后台任务、获取二维码文件及状态查询命令。

**验证范围：任务生命周期、终端二维码渲染、本机交接和取消清理已通过离线测试。当前环境禁止访问官方登录 URL，因此没有执行新的无头／有头登录驱动，也没有通过 HTTP、代理或其他通道绕过。二维码组件选择器和完整真实扫码仍待允许访问后的验收。**

## 命令

```sh
# 终端显示二维码并等待，没有可见浏览器窗口
open-piggy auth login --qr --wait

# Agent异步任务
open-piggy auth login --qr --detach

# 同一后台任务的本机二维码交接页；不是另一浏览器的独立官方登录页
open-piggy auth login --url

# 显式有头模式，供用户处理官方验证；仍返回可轮询的任务
open-piggy auth login --browser

# 查具体任务：只读本地状态，不启动浏览器、不访问官网
open-piggy auth status --login-id <loginId>

# 查当前活跃任务
open-piggy auth status --pending

# 检查已经保存的会话：会请求官方登录状态接口
open-piggy auth status

# 请求取消，之后轮询，直到实际变为 cancelled
open-piggy auth cancel --login-id <loginId>

# 取消活跃任务，等待其不能再保存凭证，然后删除本地会话
open-piggy auth logout
```

`--qr`、`--url`、`--browser` 三选一；不传则为 `--qr`。同一配置目录只允许一个活跃任务。`--browser` 会先取消原任务，再创建一个受同一任务锁管理的有头任务。

## 返回与 Agent 流程

终端等待模式仅在任务结束后输出最终 JSON。以下是 `--detach` 或非交互异步模式的返回示例；ID、时间与路径都是占位内容，不是真实凭证：

```json
{
  "status": 0,
  "message": "success",
  "data": {
    "loginId": "00000000000000000000000000000000",
    "mode": "qr",
    "state": "pending",
    "createdAt": "2026-11-20T00:00:00.000Z",
    "expiresAt": "2026-11-20T00:05:00.000Z",
    "qrExpiresAt": null,
    "qrPath": null,
    "handoffUrl": null,
    "statusCommand": "open-piggy auth status --login-id 00000000000000000000000000000000",
    "cancelCommand": "open-piggy auth cancel --login-id 00000000000000000000000000000000"
  }
}
```

- `pending` 只代表任务存在，不代表登录成功。外层 `status:0` 代表创建／读取任务成功，Agent 必须继续检查 `data.state`。
- `--detach` 创建命令最多等待约15秒获取二维码或本机链接，之后返回。交互式终端／显式 `--wait` 则持续等待至任务终态，不受这个15秒返回窗口影响。
- 二维码就绪时 `qrPath` 为本机绝对路径。交互式终端会尝试将其解码并在 stderr 渲染二维码，stdout 保持 JSON。Agent 可把 PNG 展示给用户；不得将其发布到公开日志或仓库。
- `--url` 返回随机 token 保护的 `127.0.0.1` 交接页，页面显示同一后台浏览器会话中的二维码并轮询状态。普通官方登录 URL 无法把另一浏览器的 Cookie 自动交还 CLI，因此不把它冒充可回收会话的 URL 模式。
- 异步 Agent 建议每2秒左右读取一次本地任务状态，直到 `authenticated` 或其他终态。
- `expiresAt` 是最长5分钟的**任务期限**，不是官方二维码的保证有效期。`qrExpiresAt:null` 表示二维码自身有效期未知。官方二维码可能更早失效；当前未验证过期覆盖层识别，必要时取消后重建任务。

任务状态：

| state | 含义 |
| --- | --- |
| `pending` | 等待二维码／用户扫码或官方流程；可能附带 `cancelRequested:true` |
| `authenticated` | 官方跳转完成，独立会话通过纯 HTTP 校验，凭证已保存 |
| `verification_required` | 无头模式发现官方验证，需要用户显式选择浏览器模式处理 |
| `expired` | 任务期限已过，不会因此保存新的会话 |
| `cancelled` | worker 已处理取消，不再保存该任务的会话 |
| `failed` | 任务失败，`error` 提供脱敏原因 |

没有实际协议证据时，不编造 `scanned`、`confirmed` 等中间状态。

## 本机文件与安全范围

- 默认状态目录：`~/.config/open-piggy/`，支持 `OPEN_PIGGY_HOME`。
- 会话：`session.json`；任务：`logins/<loginId>/status.json`；临时二维码：同目录 `qr.png`。POSIX 目录0700、状态／二维码文件0600。Windows 使用私有用户目录和 ACL。
- QR／URL 模式后台仍依赖 Playwright Chromium。它不是“完全不依赖浏览器”的纯 HTTP 登录实现；查询继续使用纯 HTTP。
- 登录驱动只识别明确官方登录文档内的登录二维码组件，不扫描飞猪首页 App 下载二维码，不导出用户已有 Chrome Cookie。
- 仅后台驱动持有 Cookie；任务 JSON、本机交接状态接口和日志不返回 Cookie。只有官方登录状态和纯 HTTP 校验均成功后才保存会话。
- 成功、失败、验证拦截、过期或取消时清理二维码／profile，关闭浏览器和交接端口，终态保留供 Agent 查询。网络操作有超时，清理不承诺在任务截止瞬间完成。
- 注销等待活跃任务退出可写凭证阶段，避免出现“刚注销，旧后台进程又保存会话”。取消若迟迟未完成，注销明确失败，不能把它当作已退出。
- 本机页面仅绑定127.0.0.1、随机访问 token、严格 Host 和精确只读路径，禁止缓存及 Referer 外传；不是任意网页代理。远程主机需要用户自己的受控端口转发，不自动开放公网监听。
- 新任务使用原子发布的完整锁记录，避免两个后台会话竞争覆盖。启动前已取消的任务不会启动登录驱动；没有活跃 worker 的遗留任务可以回收，正在提交凭证的活跃 worker 则必须等其退出后再完成注销。

## 验收限制

离线测试使用注入的假登录驱动、合成二维码和本机 HTTP 服务。没有连接被限制的官方登录页面；CI 也不会执行真实扫码或使用真实账号。

真实验收还需确认：官方登录组件的实际 DOM、无头环境是否直接获得可用二维码、二维码刷新与更早过期、扫码确认后完整跳转，以及平台风控要求下的人工有头流程。验证失败会明确暴露，不能宣称当前预览已经在真实账号上跑通新二维码模式。

## preview.4：无二维码时明确失败

真实使用中出现过 worker 存活约两分半但 `qrPath:null`、状态持续 `pending` 的情况。本次只修复已确认的任务反馈问题，不把尚未验证的二维码提取原因猜成特定网页变化。

新增 `phase`：queued、opening_login、waiting_for_qr、qr_ready、waiting_for_user。QR模式在登录页打开后30秒仍没有提取到登录二维码，会结束为 failed / CAPABILITY_UNVERIFIED，并清理资源；不再等满五分钟而没有解释。浏览器模式仍允许用户人工处理官方验证。新增的离线回归测试验证该失败出口；真实二维码组件仍待在线验收。

## preview.5：修复提取逻辑

- 文档范围仍限定为精确的 `https://login.taobao.com` origin，接受 `/member/login.jhtml` 和 `/newlogin/` 登录组件路径族；子 frame 不再必须与外层路径完全相同。代码不生成新的接口请求。
- 支持登录组件中的 img、canvas 和背景容器截图，检查全部可见候选；隐藏的首个组件不再遮蔽后续候选。
- 候选图像必须能实际解码成二维码，装饰图片不会被当作二维码。原始 payload 不写入状态、日志或独立文件。
- 没有二维码时，只允许点击可见且明确标注“扫码登录／二维码登录”的控件；同一 frame 只请求切换一次，不执行验证码处理或风控绕过。

离线测试复现了原路径限制拒绝嵌套登录文档、原选择器不匹配 canvas 的缺陷；另测了隐藏首节点、不可解码 logo、背景容器及明确模式切换。全部 frame 和 PNG 均为合成 fixture，没有访问受限的官方登录页面。

这证明上述代码缺陷已修正，不能证明当前官网具体使用哪种结构，也不能据此断言用户之前失败的具体原因已唯一定位。真实扫码验收仍待完成。

## preview.6：服务器首次安装与自检

首次在新账号／新机器上运行前，执行 `open-piggy browser install` 下载与当前CLI匹配的浏览器，再运行 `open-piggy browser doctor`。仅 npm安装CLI不会下载 Chromium。缺少二进制时会返回明确 BROWSER_NOT_INSTALLED，不再用通用 UPSTREAM_ERROR 隐藏直接原因。浏览器安装／系统运行环境问题退出码为7。

自检和真实 Chromium 离线 fixture 均不访问登录网站。真实服务器复现和验证边界见 [dev2-validation.zh-CN.md](dev2-validation.zh-CN.md)。

## preview.7：终端直接打印并等待确认

推荐人工终端使用 `open-piggy auth login --qr --wait`。交互式终端中不传 --wait 也默认等待；即使二维码稍晚出现，前台仍继续追踪，不会因为最初拿到pending就退出。二维码打印到stderr；确认前stdout不提前输出“成功”JSON，任务authenticated后才返回最终结果。提取失败、过期、取消仍有明确终态。

相同payload但PNG视觉字节改变时不重复刷屏；原始payload不进入JSON或日志。Ctrl+C请求取消任务，前台退出码130，既有保存会话不自动注销。

Agent使用 `--detach` 保留异步JSON工作方式；非交互环境默认仍异步，显式 --wait可以在脚本中选择前台等待。--wait与--detach不能同时使用。--url默认继续返回本机交接链接。

新增测试覆盖“最初无二维码、稍后出现、显示后继续等待确认”、PNG变化去重、取消、失败及实际CLI子进程输出时序。CLI测试仅复用合成任务，还指定不存在的浏览器缓存以阻止意外启动真实登录驱动；它没有导航官方登录网站，不能当成真实账号扫码验收。
