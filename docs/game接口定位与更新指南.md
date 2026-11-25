# 从 game 文件夹定位接口与更新游戏资源

本文基于 2026-10-11 对本仓库的检查。后续涉及游戏接口的功能，先从 `public/game/` 查询，不再默认先查询旧 GitHub API 采集库。该规则已写入仓库 `AGENTS.md`。


## 2026-11-20：每日任务配置直链404的同版本备用来源

- 本次清单参数 `platform=hortor&version=0.36.0-android`，COMMIT_ID `6f2973f5`，game `57a46`、launcher `3af4e`、config `2938b`、codeVersion `2.55.2`、dataBundleVer `152261a3c8`。这些值是分析快照，代码按本地入口及实时清单解析，不固定哈希。
- 解密当前game与launcher后，确认版本模块使用 `SystemService.getDataBundleVer`，ResourceManager.loadWebConfig读取 `/data/<version>/config.json` 与 `config_ap.json`；本项目既有版本查询指令未修改。当前JSON与二进制直链实测404。
- ResourceManager的配置bundle加载分支通过Cocos JsonAsset合并配置。当前 `/remote/config/config.<清单config哈希>.json` 可用，paths/types/uuids/versions.import给出实际资源路径。主配置COMMIT_ID与服务器dataBundleVer一致，包含10项每日任务；补充配置包含7组BOSS循环。
- 每日任务补差与任务状态展示共用loadDailyTaskConfig；独立任务不一定依赖此加载器。新备用加载仅在直链失败后触发，先检查manifest版本，再验证主配置COMMIT_ID；补充配置若声明版本也须一致。任何不一致、格式错误仍停止，不退回旧配置。
- 实际运行新加载函数成功读取上述同版本资源并通过现有配置校验。未使用账号发送任务或领奖请求；未取得新的游戏任务响应结构，本次不修改进度与领奖响应处理。

## 2026-10-17：根据0.36.0安装包更新资源入口

用户提供的 `20260924172834-android_0.36.0_Release_1278ee41.apk` 中，`assets/jsb-adapter/game-defines.js` 声明 `GAME_VERSION=0.36.0-android`，`assets/main.js` 以该版本调用manifest。原本地入口固定使用0.32.0，只能获取2.48.2；新参数实际返回2.50.3，已包含闲来入镜模块。

现在 `public/game/game-defines.a175e.js` 单独维护 `REMOTE_MANIFEST_VERSION=0.36.0-android`；`main.2a00e.js` 从该参数和SERVER构造manifest URL，每次启动重新请求清单，按服务端哈希加载远程完整业务文件。未固定本次game哈希，也无需把十余MB解密代码复制进公共目录。

本次清单：`COMMIT_ID=54a70b93`、`game=b72ac`、`launcher=91d6a`、`TEST_REMOTE_MODULE=c5e7c`、`codeVersion=2.50.3`，数据配置`0c3a7d906d`。浏览器控制台 `window.remoteGameResourceInfo` 可查看本次加载的清单版本、提交及三个业务哈希。

保留h5web平台、现有浏览器SDK、引擎、本地internal资源、多账号桥接和H5兼容处理。安卓包的 `HSDK.app`、JSB适配和native settings不可直接覆盖网页文件；浏览器原有GAME_VERSION/CODE_VERSION不改为安卓平台标识。新增参数专用于启动时的远程资源选择。

同时修复资源地址转换：输入已经是`.jsc`时不再重复追加`c`；普通miniGameScripts仍保持`.js`。清单缺少或包含无效launcher/game/协议哈希时停止启动，避免混用旧版本。新增加载器回归覆盖新版参数、动态清单、平台保留、响应包装格式、资源扩展名和失败不覆盖。

后续更新应再次从最新官方客户端核对基础版本与加载方式；即使游戏配置版本相同，不同基础包版本也可能拿到不同业务资源。下文旧哈希为2026-10-11的历史分析示例，不能用来代替当前manifest。

## 1. game 文件夹里有什么

仓库中的 game 文件夹是 `public/game/`。它不是完整的离线游戏源码，而是本地启动文件加远程资源加载器。

| 文件 | 查找用途 |
| --- | --- |
| `index.html` | 确认实际加载的脚本、样式及启动顺序 |
| `main.2a00e.js` | manifest 请求、资源地址转换、脚本解密、资源加载补丁 |
| `game-defines.a175e.js` | CDN、服务器、平台、版本等启动常量 |
| `src/settings.da7ef.js` | 本地引擎设置及初始 bundle 信息 |
| `cocos2d-js-min.a5841.js` | 本地 Cocos 引擎 |
| `patch.decrypted_readable.js`、`xh.js`、`sh1.js` | 启动相关脚本；是否需要更新应对照新入口判断 |
| `multi-game.html`、`multi-game-storage-bridge.js` | 本项目的多账号游戏支持，更新官方资源时应保留 |

`game-defines` 中的版本字符串、manifest 请求中的客户端版本、bundle 哈希分别有不同用途，不能全部改成同一个版本号。

## 2. 我如何找到本次钓鱼逻辑

### 第一步：找到启动入口和资源加载路径

先在本地搜索：

```bash
rg -n 'script|settings|main|defines' public/game/index.html
rg -n 'loadRemoteBundleVers|convertAssets|loadJscAndDecode|downloadBundle' public/game/main.2a00e.js
```

本次确认：

1. `index.html` 加载 `main.2a00e.js`。
2. `loadRemoteBundleVers()` 向游戏服务器发送 manifest 请求。
3. manifest 的 `body.bundleVers` 提供 `game`、`launcher` 等资源哈希；该字段可能是 JSON 字符串，需要再解析一次。
4. `convertAssets()` 将 `assets/game/...` 转为官方 CDN 的 `remote/game/...`，并把脚本扩展名转换为 `.jsc`。
5. `loadJscAndDecode()` 下载二进制脚本，再按本地实现解密为 JavaScript。

因此，在本地搜索不到 `ArtifactService`，不等于游戏里没有钓鱼逻辑，可能只是对应业务脚本尚未下载到本地。

### 第二步：按当前 manifest 下载并解密资源

本次 manifest 返回 `game=22c3b`、`launcher=861b5`，所以分析了对应资源：

```text
https://xxz-xyzw-res.hortorgames.com/remote/game/index.22c3b.jsc
https://xxz-xyzw-res.hortorgames.com/remote/launcher/index.861b5.jsc
```

这些哈希是本次分析快照，后续必须重新读取 manifest。

解密时复用了 `main.2a00e.js` 开头的 XXTEA 实现，以及 `loadJscAndDecode()` 中的解密方式。只运行解密函数，不启动整个游戏业务脚本。解密结果本次放在临时目录，没有加入 `public/game/`，也没有修改游戏的资源加载路径。

建议以后把 manifest、加密资源和解密结果存入单独的分析目录，例如 `game-analysis/<日期>/`，与可运行的 `public/game/` 分开。

### 第三步：用稳定关键词定位模块

搜索解密后的代码：

```bash
rg -n 'lotteryNumber|newFree|ArtifactService|sendLottery|remainFreeLotteryTimes' <解密结果目录>
```

代码经过压缩后可能只有一行，可以先格式化，或按关键词截取前后几百个字符。Service 方法名、请求字段名、配置表名通常比缩短后的变量名更适合搜索。

本次找到的调用链是：

```text
ArtifactLotteryDialog._onBtnOne
  → 判断 ArtifactModule.isFreeLottery
  → 有免费次数：sendLottery(normal, 1)
  → 无免费次数：_lottery() 打开数量选择，上限 10
  → ArtifactModule.sendLottery(type, count)
  → ArtifactService.lottery({ type, lotteryNumber: count, newFree: true })
```

黄金鱼竿按钮 `_onBtnTen` 直接进入数量选择。免费次数计算则在 `ArtifactModule.todayFreeLotteryTimes`、`remainFreeLotteryTimes` 中：先按每日统计时间判断是否跨日，再计算剩余次数。

这说明除了找到“请求参数”，还必须沿上游调用查看前置条件和操作顺序。只复制 `lottery()` 的参数，会漏掉免费次数先单次处理的流程。

### 第四步：确认真正发送的协议指令

`ArtifactService.lottery` 是客户端方法；本项目使用 `artifact_lottery` 作为 WebSocket 指令。一般功能必须继续查 Service 定义、协议注册或发送器，确认实际指令，不能仅靠“服务名加方法名转小写”猜测。

本次同时核对了项目的 `src/utils/gameCommands.js`、`src/utils/xyzwWebSocket.js`。响应结构曾用历史抓包补充确认：`syncrewardresp` 中的 `role` 可以只包含部分奖励和统计字段，必须按增量合并。后续新功能不再把查旧 GitHub 库作为前置步骤；客户端无法说明的响应字段，需以当前实际响应补充验证。

### 第五步：把游戏判断落实到项目和测试

本次改动包括先免费单次、再按最多 10 次批量执行，以及每个账号独立查询库存。目标次数包含免费次数。

测试覆盖普通/黄金鱼竿、部分免费次数、跨日重置、账号库存隔离、库存减少、增量缺少库存、请求失败和用户停止。

这里能确认的是客户端流程差异。`200020` 是通用服务端错误，不能仅凭错误码断言唯一原因，最终仍需实际运行验证。

## 3. 游戏更新后怎样更新这个文件夹

### 情况 A：业务资源变化，但启动器仍然能运行

**通常不需要整体替换 `public/game/`。** 当前启动器会重新请求 manifest，并按返回的版本加载远程 game、launcher 等资源；manifest 请求使用 `cache: 'no-store'`。

操作步骤：

1. 重新打开游戏页面，检查控制台是否成功输出远程资源版本。
2. 在浏览器 Network 中确认 manifest 请求成功，`remote/game/index.<新哈希>.jsc` 等资源成功加载。
3. 若是缓存问题，先启用开发者工具的“禁用缓存”再刷新；不要为了刷新资源清空 localStorage/IndexedDB，以免丢失账号数据。
4. 做功能分析时重新下载并解密新版本，记录新旧哈希，比较目标 UI、Module、Service、协议及配置。
5. 如果接口、参数或条件变化，更新本项目对应实现和测试。游戏资源自动变新，并不意味着辅助功能代码也会自动适配。

### 情况 B：启动入口、引擎、平台参数或解密方式发生变化

如果 manifest 请求失败、资源加载 404、解密失败或启动报错，需要更新本地启动层。

1. 先备份 `public/game/`，并记录本地修改。
2. 从你正在使用的新版官方客户端入口获取 HTML；沿它实际引用的脚本和资源定位新文件，不能仅凭旧文件名猜新文件。
3. 对照新入口更新 settings、game-defines、启动脚本及引擎。带哈希的文件名变了，必须同步修改 `index.html` 等引用。
4. 按新客户端核对 manifest 的 URL、平台和版本参数；不要只修改 `GAME_VERSION`，因为当前 manifest URL 里的版本参数是独立写在 `main.2a00e.js` 中的。
5. 检查资源 URL 规则、扩展名、加密算法及解密方式是否变化，更新本地加载器。
6. 把本项目的 CDN 加载适配、多账号页面和存储桥接保留或迁移到新启动文件；不要用官方文件直接覆盖这些功能。
7. 更新完后验证单账号启动、多账号启动、角色读取、WebSocket 连接和一个低消耗操作，再执行测试和构建。

没有固定的“下载最新版 game 文件夹”地址：本仓库采用 manifest 加远程 CDN 的布局。更新时应沿新版入口重新确认布局；若新版改用其他资源结构，也要相应调整加载器。

### 更新验证命令

```bash
npm test
npm run build
```

本次普通构建因既有 `dist/` 文件权限无法清空而失败，改用临时输出目录验证成功。若再次遇到同样问题，可先验证构建：

```bash
npm run build -- --outDir /tmp/xyzw-game-build-check
```

## 4. 后续每个功能应记录的内容

- 分析日期、manifest 参数、game/launcher/config 等相关版本。
- UI 入口、Module 方法、Service 方法与实际协议指令。
- 请求参数、前置条件、批量上限、执行顺序和统计重置规则。
- 响应是完整快照还是增量，以及成功后的状态确认方式。
- 对应实现、测试和尚未完成的在线验证。

旧抓包可以补充历史背景；当前客户端逻辑与当前实际服务端响应优先。

## 2026-11-20：逐鹿盐山配置读取补充

复核当前manifest仍为game `57a46`、launcher `3af4e`、config `2938b`、dataBundleVer `152261a3c8`（入口参数同上）。当前客户端逐鹿盐山界面通过ApexScheduleConf定位赛程，任务模块通过ApexTaskConf读取任务类型和完成值；项目loadApexDailyConfig此前独立读取JSON直链，因此未受每日任务备用加载修复覆盖。现接入同一个严格核对版本的官方配置包加载器，继续使用buildApexDailyRules校验后才允许助威和竞猜。实际下载配置包含312条赛程、7条任务，通过规则校验。此次不改变游戏指令、助威顺序或领奖响应处理，未进行账号写操作。

任务失败后切换回“初始阵容”来自DailyTaskRunner的finally清理分支，仅在本轮曾改变阵容且连接可用时执行，属于恢复动作，保留该行为。

## 2026-11-20：每日任务与逐鹿盐山直接从清单加载

每日任务loadDailyTaskConfig与逐鹿盐山loadApexDailyConfig现统一调用officialTaskConfig.js，直接解析本地启动入口、实时manifest和配置bundle，不再先访问/data配置直链。账号system_getdatabundlever仍是版本校验基准；manifest的dataBundleVer与主配置COMMIT_ID必须完全一致，补充配置若包含COMMIT_ID也必须一致，不修改版本字符串强行通过。当前真实资源验证仍为152261a3c8、config 2938b，读取10条每日任务与312条赛程成功。各业务保留自己的配置校验及按版本缓存，换版本重新加载。此改动范围为上述两个配置入口；其他独立功能的配置加载器尚未迁移。

## 2026-11-20：仓库道具配置和名称

仓库此前借用loadRechargeConfig读取/data配置与语言直链，读取失败后继续使用少量历史中文名；依赖ItemConf的活动道具因此跳过。仓库现有独立加载入口，复用officialTaskConfig，按同一当前config bundle的paths/types/uuids/versions.import读取config、config_ap和language三个JsonAsset。严格核对账号版本与主配置、清单版本，语言若声明COMMIT_ID也核对。失败日志显示具体原因，保留既有跳过规则和使用指令。

当前清单仍为dataBundleVer 152261a3c8、config 2938b，launcher 3af4e的ResourceManager配置列表含language；真实读取确认3007随机红将碎片、3008精铁福袋、3009进阶石福袋、3010晶石福袋、5294玄鱼令、5296凤仪金徽、5297灼华赤羽。只验证配置和名称读取，未使用账号道具；活动保留期、自选包与使用方式的既有判断不变。其他充值活动加载入口此次不迁移。

## 2026-11-20：统一任务配置、地图清单及手动逐鹿赛程

- 当前入口参数仍取public/game实际引用的game-defines中的REMOTE_MANIFEST_VERSION；清单实测dataBundleVer `152261a3c8`、game `57a46`、launcher `3af4e`、config `2938b`。不固定本次哈希；公共活动查询也通过相同入口解析客户端版本。
- officialTaskConfig统一解析paths/types/uuids/versions.import与versions.native。JsonAsset按Cocos序列化结构读取；BufferAsset按清单native索引下载.bin后BON解码。沿当前launcher的ResourceManager.loadWebConfig与_binToJson核对这两类加载规则。
- 充值活动、报名助威、玄武活动、藏品奖励、灯神扫荡、空阵容和皮鞋升级七类加载器均已迁移，连同既有每日任务、逐鹿及仓库入口，不再拼/data直链。业务各自的字段校验及写请求逻辑保留。
- 统一层按fetch来源、账号配置版本、JSON/二进制及语言选项合并并发下载；全局缓存最多保留六种组合，失败移除。清单请求只合并正在进行的请求。配置附带不参与表枚举的清单快照，盐场地图优先复用该快照，并校验任务配置版本一致。
- 手动逐鹿页面改用loadApexDailyConfig/buildApexDailyRules，不再使用历史赛程快照作运行判断；切账号或重新加载时清除当前规则，避免继续使用旧赛程。历史apexStageMap保留给规则测试/兼容默认导出，页面运行入口不依赖它。
- 真实验证：当前JSON合并语言与补充表成功，包含1139项道具、312条逐鹿赛程、5组灯神配置和119条藏品阶段配置。当前二进制configc内COMMIT_ID为 `a5582ce672`，与账号和JSON版本 `152261a3c8` 不同；严格校验后拒绝，空阵容/皮鞋依赖的HeroConf/WeaponConf不能用当前JSON代替，也不擅自使用旧二进制。官方发布版本一致的资源后可自动恢复；若这是官方特殊版本语义，需继续以当前客户端证据确认后适配。
- 宠物图片仍为展示用历史地址，原页面已有图片失败隐藏并保留文字的处理，不作为任务配置；本轮不把图片加载失败视为任务执行失败。答题answer.json及Token来源等独立资源不属于官方配置清单，不混入此加载器。
- 新增配置直链和固定manifest版本的静态回归检查，覆盖统一层并发/重试、二进制版本拒绝和地图版本拒绝。未取得新的在线角色响应或执行任何账号写操作。

## 2026-11-21：特权功法领取前查询

- 当前manifest参数沿public/game入口为platform=hortor、version=0.36.0-android；清单COMMIT_ID 6f2973f5、game 57a46、launcher 3af4e、协议TEST_REMOTE_MODULE 757be、dataBundleVer 152261a3c8。业务资源按当前清单确认，协议资源本次重新下载并按本地loadJscAndDecode解密、仅执行字符串表初始化进行静态分析。
- 官方LegacyPrivilegeDialog.refreshUI读取LegacyChargeReward档位、roleLegacy.chargeClaimedMap及LegacyModule.getLegacySeasonChargeAmount；满足vipSpend且未领取才绑定sendClaimChargeReward(id)。LegacyModule.sendGetInfo通过LegacyService.getInfo({})刷新roleLegacy。协议REQS明确映射Legacy_GetInfo→legacy_getinfo、Legacy_ClaimChargeReward→legacy_claimchargereward，领取参数为{id}。
- 协议声明Legacy_GetInfoResp.roleLegacy为GDRoleLegacy，scheduleId默认0，chargeClaimedMap为空Map；LegacyCharge统计键为legacy:charge。客户端用ROLE.statistics和statisticsTime（秒）判断是否落在当前LegacyScheduleConf的开始（含）至结束（不含）区间，区间外充值数为0。白名单账号使用legacyWhiteListStart。scheduleId小于当前配置id或无开放赛季属于跨季。
- 当前任务保留原来id=2的领取范围，不扩大到更高档位。档位门槛从当前统一配置读取，不硬编码3000。每个账号先查询legacy_getinfo和role_getroleinfo，核对服务器时间、赛季、领取记录及本季充值。查询不完整则失败；已领/不足/跨季正常跳过。领取成功或报错后再次查询legacy_getinfo，同赛季且明确布尔true才确认完成，不重发不确定写请求。200020仅为通用错误，不能单独推定已领取。
- 此次没有使用真实账号查询或领取；当前在线返回体尚未获得，响应模型依据上述客户端协议声明，并对不完整快照拒绝执行。库存增量缺失不当作0，不靠奖励第一项推算领取成功。

## 2026-11-21：特权功法改为覆盖全部三个奖励档位

本次重新查询manifest仍为dataBundleVer 152261a3c8、game 57a46、协议757be。当前LegacyChargeReward包含基础档id=1（无奖励），三个奖励档id=2/3/4，门槛分别为3000/8800/15800，名称凝神香·一/二/三。官方LegacyPrivilegeDialog按LegacyChargeReward.list从索引1开始逐页展示，分别检查chargeClaimedMap[id]并调用sendClaimChargeReward(id)，不能把id=2的已领状态当作所有档位已领。

本次修正此前固定id=2的范围限制：从当前配置枚举奖励档位，按id顺序逐档判断；基础档不发送请求，已领档跳过，未达门槛档跳过，达标且未领的档位单次领取后重新查询同赛季记录确认。某档异常未确认则停止，不继续后续档、不盲目重发。日志逐档显示名称/ID与原因，整轮汇总显示本次确认档数并累加实际返回的残卷奖励。实际账号响应仍未在线查询或领取，沿用已核对的客户端协议模型。

## 2026-11-22：小号大冲关皮肤与咸主战报

当前manifest重新确认dataBundleVer 152261a3c8、game 57a46、launcher 3af4e、协议757be，入口参数仍由本地public/game/game-defines.a175e.js的0.36.0-android决定。业务代码沿当前QuizSkinData/QuizModule、BattleReportModule及MailInfo追踪，不使用旧采集库。

- QuizSkinData只展示StudyClothesConf.open=1项，10000默认已领；10150通过custom.quizSkin的UNLOCK(2)→CLAIM(3)处理，真实指令system_custom({key:"quizSkin",value:3})。普通皮肤按StudyClothesType：ANSWER=1检查study.totRightNum，TASK=2检查totCplTaskNum，MOVIE_TASK=3检查对应studyActId的actTotCplTaskMap；达到配置totRightNum且unlockedSkin无该ID时调用StudyService.unlockSkin({id})，协议REQS明确映射study_unlockskin。本功能不开始答题、不消费知识币、不切换study_setskin。执行后重新查询role_getroleinfo确认各皮肤已解锁；不确定写请求先查后停，不自动重发。
- 咸主战报为EMMailCategory.categoryReportLordMail=1，瓶子战报为2。BattleReportModule._getMailList调用MailService.getBattlefieldReportList({lastId:0,category:1,size:60})，读取list。deleteMailInfo调用MailService.changeState({mailId,state:OMailState.deleted})，deleted=9。协议REQS明确映射mail_getbattlefieldreportlist与mail_changestate。逐封删除并重新查询确认，分页有界限、防重复ID，不调用全邮箱删除。MailInfo.haveAttachments和attachments用于保留state<attachmentGot(3)的未领附件战报。
- 两项功能接入小号分组、任务目录与定时执行器，逐账号读取状态；复用的已有或定时会话不关闭，自建连接释放。加载统一官方配置，不固定皮肤门槛。
- 响应字段依据当前客户端声明和处理代码；尚未查询真实账号或删除真实战报，不能声称已在线验证。分页和操作失败会显示错误，未确认不计成功。


## 2026-11-22：蟠桃园战报200020排查

从本地index、game-defines、main的manifest及XXTEA解码链重新下载当前资源。参数platform=hortor、version=0.36.0-android；COMMIT_ID 6f2973f5、game 57a46、launcher 3af4e、协议757be、config 2938b、dataBundleVer 152261a3c8。分析文件位于/tmp/peach-game.js和/tmp/peach-TEST_REMOTE_MODULE.js。

官方LPRecordDetailDialog的requestKey取PayLoadScheduleConf.key；refreshData调用recordData.sendGetKillRecordList(requestKey)，再按ROLE.legionId区分recordsMap双方。记录模块通过LegionService.getPayloadRecord({})读取enemyLegionMap，通过getPayloadKillRecord({date:i})读取recordsMap。协议REQS注册Legion_GetPayloadKillRecord，其字符串表对应legion_getpayloadkillrecord。LegionModule.sendShowLegionInfo先Math.abs(e)，再getInfoById({legionId:e})。任务模块firstLegionId属于本期报名状态，不能代替当前ROLE.legionId。

页面改为role_getroleinfo读取role.legionId，详情ID取绝对值并校验，保留历史记录和击杀查询；请求阶段写入失败提示。不把200020直接认定为没有战报或已结束。2项测试通过，临时目录生产构建通过；未取得真实报错请求和服务端返回体，因此该改动修正已观察到的客户端差异，尚不能声称已确认200020唯一根因。后续更新仍需重新取manifest，对照上述UI、记录模块、协议和赛程key，不固定本次哈希。


### 2026-11-22：蟠桃信息紧凑显示补充

本轮复用上节同日下载的57a46客户端分析文件与manifest；未更改线上协议或发送参数。客户端英雄battleTeamSlot为零起始，负数表示未上阵；页面已有HeroFillInfo保留站位并排序。阵容显示按0/1前排、2/3/4后排分行；缺失站位保留在后排避免丢失展示。缩小固定列宽及卡片留白。战绩页对无效历史样式值回退默认，切账号重查并在空状态保留请求失败原因。无新的真实服务端响应，不能断言200020或空白已在线复现修复。

## 2026-11-22：战报空列表协议默认值

本次manifest再次确认dataBundleVer 152261a3c8、game 57a46、协议757be。当前Mail_GetListResp构造器初始化list=[]、left=0，BattleReportModule._getMailList调用getBattlefieldReportList后读取getData().list；助手直接解BON未经过协议模型默认值填充，因此不能要求原始响应总显式含list。

新增normalizeLordReportList用于查询与删除后确认：无list时只接受空结构、非负left=0及正确_originalCmd等已核对字段；非空剩余数量、未知结构、null、非数组list和错误码不视作空。日志提示的真实返回体尚未抓取，空字段省略是依据协议模型采取的兼容处理，不能宣称已经用账号响应证实。连接失败/Token自动刷新属于连接层，本次未改。


## 2026-11-25：皮鞋配置版本问题的运行态结论

Edge只读运行态确认config包按dataBundleVer加载JSON分表；WeaponConf在language，WeaponActiveConf/WeaponPassiveConf在level。此前仅合并config/config_ap导致误判JSON缺表，不应改用内部版本不匹配的configc。现皮鞋专用toy模式按账号版本索引合并四表并保持版本校验；真实公开资源通过validateShoeToyConfig。分析版本、具体证据和限制见[皮鞋配置调查](./皮鞋配置版本不一致研究方案.md)。21项相关测试通过，构建通过；全量1204项中1项竞技场日常测试失败。未执行真实账号升级或消费。后续仍从当前manifest和账号版本确定资源，不固定本次哈希。


## 2026-11-25：其他任务分表核查

无将阵容也因HeroConf位于language而误用不匹配BON，现与皮鞋共同使用gameTables JSON分表模式；其余已检查任务依赖表由当前加载资源覆盖。实际资源确认64项HeroConf，相关29项测试通过，构建通过；全量测试仍有1项竞技场日常测试失败。范围、表名兼容性和验证边界见[任务配置分表核查](./任务配置分表核查.md)。未操作真实账号。
