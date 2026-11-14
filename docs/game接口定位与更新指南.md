# 从 game 文件夹定位接口与更新游戏资源

本文基于 2026-10-11 对本仓库的检查。后续涉及游戏接口的功能，先从 `public/game/` 查询，不再默认先查询旧 GitHub API 采集库。该规则已写入仓库 `AGENTS.md`。

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
