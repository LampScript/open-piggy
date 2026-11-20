# open-piggy 与官方 FlyAI CLI 差异

核对日期：2026-11-20。

## 结论

**open-piggy 当前是预览版，还不能直接替换官方 CLI。**

8 个查询命令都提供了入口，但只有机票、火车票、热门景点和关键词商品搜索这 4 类取得过真实 HTTP 结果，而且各自只覆盖部分功能。酒店、万豪酒店、万豪套餐、AI 搜索尚未实现，执行时会明确报错。

主要变化是查询链路：官方通过 FlyAI MCP 查询；open-piggy 使用飞猪网页实际使用的接口，扫码登录后以本工具自己的会话发起 HTTP 请求。它不需要 FlyAI API Key，但也没有继承官方服务全部能力。

### 对比基线

| 项目 | 本文使用的版本或证据 |
| --- | --- |
| 官方已发布 CLI | `@fly-ai/flyai-cli@1.0.16`，逐项核对本机 `--help`；本次 npmjs.org 查询最新版也是 1.0.16 |
| 官方技能文档 | `alibaba-flyai/flyai-skill`，提交 [`7a05a82`](https://github.com/alibaba-flyai/flyai-skill/tree/7a05a82fa0bda1c92e86230b07d375ed56ea90cb) |
| open-piggy | [`v0.1.0-preview.1`](https://github.com/LampScript/open-piggy/releases/tag/v0.1.0-preview.1)，代码提交 [`4468802`](https://github.com/LampScript/open-piggy/tree/4468802) |
| 实测范围 | 本次对比不重新查询票价；沿用版本对应的真实 HTTP 验收记录及代码、命令帮助核对 |

下文“官方支持”指官方文档或已发布 CLI 声明的能力，**不表示本次逐项实测了官方服务当前可用性**。文档和 CLI 不一致的地方单独列出。

## 1. 查询与登录方式

| 项目 | 官方 FlyAI CLI | open-piggy 当前版本 |
| --- | --- | --- |
| 命令名称 | `flyai` | `open-piggy` |
| 数据通道 | FlyAI MCP 服务 | 飞猪消费者网页使用的 HTTP 接口 |
| 鉴权 | 提供体验模式，可配置自己的 API Key | 机票和关键词查询使用独立的官方登录会话；火车票和热门景点可用本工具新建的匿名会话查询 |
| 登录入口 | 已发布 CLI 无 `auth login/status/logout` | 新增 `auth login`、`auth status`、`auth logout` |
| 扫码登录 | 不属于已发布 CLI 的鉴权方式 | 打开官方登录页面，由用户扫码、完成跳转，再校验会话能否用于纯 HTTP |
| 浏览器依赖 | CLI 查询走 MCP | 仅登录使用 Playwright／Chromium，查询不启动浏览器 |
| 已有 Chrome 会话 | 不适用 | 不读取、不复用用户现有 Chrome Cookie；只保存本工具自己的登录会话 |
| 会话保存 | 本文不比较其内部凭证存储实现 | 默认 `~/.config/open-piggy/session.json`；POSIX 目录权限 0700、文件 0600；支持 `OPEN_PIGGY_HOME` |
| 预订与付款 | 返回官方预订链接 | 返回官方页面链接，不创建订单或付款 |
| 可维护性 | 依赖 MCP 服务能力及配额 | 需要自行维护网页协议；网页接口不是有稳定性承诺的开放 API |

官方链路与安装方式见[官方 README](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/README.md)。open-piggy 的协议证据见[接口记录](endpoints.md)。

## 2. 八类功能对比

| 命令 | 官方声明能力 | open-piggy 实际状态 | 主要缺口 |
| --- | --- | --- | --- |
| `search-flight` | 单程、往返、日期范围、多条件筛选 | **实验性、部分支持**：固定日期单程／往返、真实航段选择与卖家报价；必须显式传 `--experimental` | 日期范围、时段、中转城市筛选、更多排序；行李／票价品牌／联程保障未解析；不覆盖高端 GDS 报价页签 |
| `search-train` | 火车票检索，包含往返、日期范围、中转和筛选参数 | **部分支持**：单程直达时刻、座席起价、预售状态，以及部分本地筛选 | 往返、日期范围、中转、出发／到达小时筛选 |
| `search-hotel` | 日期、酒店类型、星级、床型、地标、价格及排序 | **未支持**：命令会返回 `CAPABILITY_UNVERIFIED` | 找到网页接口线索，但结果解析及过滤条件未通过验收；勘察遇到官方验证页后停止 |
| `search-poi` | 城市、关键词、景区等级、类别 | **部分支持**：按城市返回热门景点及起价 | 关键词、等级、类别筛选；不能查询指定日期门票余量 |
| `search-marriott-hotel` | 万豪酒店查询，文档另列品牌／酒店名筛选 | **未支持** | 未验证万豪专属库存及对应筛选，不能拿普通关键词结果代替 |
| `search-marriott-package` | 万豪套餐商品及价格排序 | **未支持** | 未取得可验证的套餐商品接口与条件 |
| `keyword-search` | 关键词／自然语言旅游商品搜索 | **部分支持**：网页商品关键词检索、页码和起价 | 不能据此宣称支持自然语言复杂需求；商品起价不是指定日期最终成交价 |
| `ai-search` | 自然语言理解、多条件旅游搜索或规划 | **未支持** | 未验证飞猪消费者网页对应接口；按约定不接第三方模型，也不以关键词搜索冒充 AI 搜索 |

“4 类有结果”不等于“完成一半功能”：例如机票日期范围缺失会直接影响弹性日期比价，不能简单按命令数量计算覆盖率。

## 3. 机票参数差异

以下官方参数在 1.0.16 的 `search-flight --help` 中存在。open-piggy 未支持的参数即使能被命令行识别，**也会明确失败，不会被静默忽略**。

| 参数 | open-piggy 当前行为 |
| --- | --- |
| `--origin`、`--destination` | 支持；由官方网页解析航线，机场／城市 IATA 代码已验证。未知地点报错，不自动猜测 |
| `--dep-date` | 支持固定出发日期；当前必须提供目的地和出发日期 |
| `--back-date` | 支持固定返程日期 |
| `--dep-date-start/end`、`--back-date-start/end` | **不支持**，不能直接执行弹性日期范围比价 |
| `--journey-type` | 支持 `1` 直达、`2` 多航段。当前依据返回航段数量筛选，没有另行识别所有经停／换机类型 |
| `--seat-class-name` | 支持按真实返回的全部航段舱等名称筛选；英文别名为 `economy`→经济舱、`business`→公务舱、`first`→头等舱。未显式筛选时可返回多种舱等 |
| `--transport-no` | 支持逗号分隔的航班号白名单；每一段都必须命中。**不是精确航段序列匹配，也不要求白名单里的全部航班都出现** |
| `--transfer-city` | **不支持** |
| `--dep-hour-start/end`、`--arr-hour-start/end` | **不支持** |
| `--total-duration-hour` | 支持；每个方向分别判断，使用网页旅程总时长，包含中转等待。当前为严格小于：传 20 时排除恰好 20 小时的行程；官方文档写“最大总时长”，未明确边界是否含等号 |
| `--max-price` | 支持人民币搜索报价上限，包含等于上限的报价 |
| `--sort-type` | 仅支持 `1` 价格降序和 `3` 价格升序；`2/4/5/6/7/8` 明确拒绝 |
| 新增 `--experimental` | 当前机票命令必需；标记尚未完成全部参数和票价条件验收 |
| 新增 `--limit` | 每个方向最多选择多少候选继续查价，默认 5，可设 1–100；不是卖家报价条数，也不是上游完整分页 |

### 查询覆盖差异

- 官方一次返回最多 10 项，维护者已确认；日期范围结果不能当作每天完整库存。[官方问题 #54](https://github.com/alibaba-flyai/flyai-skill/issues/54)
- open-piggy 不套用这个 10 项上限，但也**不保证查全**。它从返回的候选中选择有限组合查价，并输出 `coverage.combinationsQueried`、`candidateLimitPerDirection` 和 `exhaustive:false`。
- 当前仅查网页“低价之选”卖家页签，没有查询高端 GDS 页签。
- `jumpUrl` 打开固定日期的官方航线搜索页，不保证自动锁定该条报价或指定卖家；比官方返回的特定跳转链接更弱。

### 当前关注航班的调用方式

```bash
open-piggy search-flight --experimental \
  --origin SHA --destination LAX \
  --dep-date 2027-02-04 --back-date 2027-02-12 \
  --transport-no AC026,AC554,AC551,AC025 \
  --seat-class-name economy \
  --total-duration-hour 20 --sort-type 3 --limit 1
```

这组实际返回过四段目标航班；每次仍需检查结果里的航班号。示例命令本身不保证库存或票价保持不变。

## 4. 其他已接入功能的参数差异

### 火车票

| 参数或行为 | open-piggy 当前状态 |
| --- | --- |
| 出发地、目的地、固定出发日期 | 支持，三项必需 |
| `--journey-type 1` | 支持单程直达；`2` 不支持 |
| `--transport-no` | 支持班次号白名单 |
| `--seat-class-name` | 支持实际返回座席名；提供二等座、一等座、商务座、硬卧、软卧的官方文档英文别名映射 |
| `--max-price`、`--total-duration-hour` | 支持，按选定座席的起价过滤；时长同样为严格小于 |
| `--sort-type 1/3` | 价格降／升序 |
| `--sort-type 4/5` | 时长升／降序 |
| `--sort-type 6/7` | 出发时间升／降序 |
| `--sort-type 2/8` | 保留上游顺序；当前只有直达数据，**没有独立实现推荐算法** |
| 新增 `--limit` | 过滤、排序后的本地输出条数限制 |
| 往返、日期范围、中转城市、小时筛选 | 不支持 |
| 预售期外班次 | 可能返回时刻和参考起价，明确输出 `bookable:false`、预售时间；不代表现在可以买票 |

### 景点与商品搜索

| 命令 | 支持 | 未支持或注意事项 |
| --- | --- | --- |
| `search-poi` | `--city-name` | `--keyword`、`--poi-level`、`--category` 全部拒绝；热门推荐接口返回的 10 项不是全城景点库 |
| `keyword-search` | `--query`；新增 `--page`、`--limit` | `--page` 请求真实网页页码，`--limit` 只截取本页输出；价格为起价，零／缺失价格输出未知；不保证日期、余量或品牌归属 |

## 5. 输出与错误处理差异

| 项目 | 官方 CLI／文档 | open-piggy 当前版本 |
| --- | --- | --- |
| 标准输出 | JSON；机票常见 `data.itemList`、`ticketPrice`、`journeys`、`jumpUrl` | 同样输出单行 JSON，但只保留部分相似字段，**不是完整输出兼容** |
| 成功状态 | 通常 `status:0` | `status:0,message:'success',data:...` |
| 业务失败 | 存在 HTTP 成功、业务 `status:1` 但进程退出 0 的已知反馈 | 非零退出，同时输出 `error.code` 和 `error.message`；诊断写 stderr |
| 机票金额 | MCP 的 `ticketPrice` 返回人民币金额 | 网页原始金额为分，转换为人民币元后输出数字；不能把原始值直接显示成元 |
| 税费 | 文档示例未提供统一保证，具体取决于返回字段 | 根据网页报价字段判断；无法判断则为 `null`，不套用航司通用规则 |
| 行李／票价品牌／联程保障 | 本文没有证据证明官方所有结果统一包含这些字段 | 机票当前均为 `null`；不从相邻字段猜测 |
| 价格字段类型 | 不能仅依赖文档示例；实测字段与文档存在差异 | 机票／火车票金额是数值；景点／关键词价格是字符串或 `null`，消费方需要按命令解析 |
| 时长字段 | 示例和实测可能为分钟字符串 | 机票／火车票 `totalDuration` 为分钟数值 |
| 结果字段 | 具体命令自有结构 | 机票使用 `journeys[].flights[]`；并非官方示例的 `journeys[].segments[]`，原脚本需改解析 |
| 链接字段 | 返回预订链接 | 机票／火车票多为官方航线列表链接；景点／商品有对应详情链接，均非出票保证 |

已知官方字段／错误反馈：[问题 #65](https://github.com/alibaba-flyai/flyai-skill/issues/65)、[问题 #74](https://github.com/alibaba-flyai/flyai-skill/issues/74)。不应把这些历史问题泛化为官方所有调用都会失败。

open-piggy 的退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功或显式帮助／版本输出 |
| 1 | 网络失败、上游业务失败、响应结构变化 |
| 2 | 参数错误 |
| 3 | 未登录或会话过期 |
| 4 | 需要官方人工验证 |
| 5 | 被限流 |
| 6 | 当前未支持／未验证的能力 |

验证码和会话失效不会被当作“没有库存”。没有验证码绕过、设备风控算法或失败请求无限重试；正常机票续查和火车票令牌初始化有单独的有限处理。

## 6. 官方文档与已发布 CLI 本身的差异

这部分不属于 open-piggy 已实现的能力，而是制定兼容目标时需要澄清的上游差异。

| 项目 | 官方技能文档 | 官方 CLI 1.0.16 的 `--help` | open-piggy 当前版本 |
| --- | --- | --- | --- |
| 万豪酒店 `--hotel-brands`、`--hotel-name` | 有 | 没有；有维护者确认的待发布修复反馈 | 识别这两个参数，但整个命令仍未实现，不算支持 |
| 万豪套餐 `--hotel-name`、`--province-or-city` | 当前参考文档未列 | 有 | 未注册这两个参数；命令本身也未实现 |
| 机票价格示例 | 出现 `adultPrice` | 有实际返回使用 `ticketPrice` 的反馈 | 自行解析网页字段；不声称照搬官方 schema |
| `flyai config set ...` | README／技能说明提供该配置示例 | 本机根命令帮助没有 `config` 子命令 | 无此命令；使用本工具扫码会话，不配置 FlyAI Key |

官方万豪参数相关反馈见[问题 #67](https://github.com/alibaba-flyai/flyai-skill/issues/67)。文档未列出的参数不能靠猜测补成支持。

## 7. 对现有使用的影响与补齐顺序

**现在可以迁移的场景：**固定日期机票比价、单程直达火车时刻／座席参考价、城市热门景点推荐、旅游商品关键词搜索。都需要遵守上面的子集限制。

**现在不该直接迁移的场景：**自动扫描日期范围、酒店多条件检索、万豪专属商品、自然语言复杂行程规划，以及依赖官方 JSON 字段结构的原脚本。

建议按使用价值补齐：

1. 机票精确航段序列匹配、卖家报价直达链接、行李／退改条件、更多筛选与日期组合；每一步标出实际查询覆盖。
2. 酒店结果解析和日期／价格／品牌筛选；遇到官方验证时先由用户完成验证，不改走绕过路径。
3. 火车往返／中转和日期范围，景点关键词／类别筛选。
4. 万豪专属酒店、套餐和网页 AI 搜索；只有找到真实对应能力后才验收，不能用普通关键词替代。

这是一份后续补齐建议，不表示这些功能已承诺完成或已通过验收。当前 34 项测试和 6 组 CI 通过，只证明已实现代码的检查结果，**不证明 8 类功能全部对齐**。

## 参考与复核入口

- [open-piggy 对比基线代码](https://github.com/LampScript/open-piggy/tree/4468802)
- [命令和限制实现](https://github.com/LampScript/open-piggy/blob/4468802/src/cli.ts)
- [机票实现](https://github.com/LampScript/open-piggy/blob/4468802/src/flight.ts)
- [火车票实现](https://github.com/LampScript/open-piggy/blob/4468802/src/train.ts)
- [关键词实现](https://github.com/LampScript/open-piggy/blob/4468802/src/keyword.ts)
- [官方命令说明](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/README.md)
- [本项目验收记录](validation.md)、[接口证据](endpoints.md)、[官方参数目录](compatibility.md)
