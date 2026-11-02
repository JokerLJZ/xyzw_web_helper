# 助威商店采购与批量任务列表

分析日期：2026-11-02。未连接真实账号、未执行线上购买。以下响应字段来自当前客户端声明，实际账号返回体仍待运行确认；返回缺失或不符合预期时停止，不猜测成功。

## 当前资源及复查路径

本地 `public/game/index.html` 引用 `game-defines.a175e.js`、`main.2a00e.js`。当前 loader 以 `SERVER` 和 `REMOTE_MANIFEST_VERSION=0.36.0-android` 构造 POST `/login/manifest?platform=hortor&version=0.36.0-android`，空请求体，不带账号信息。本次返回：

| 资源 | 版本 |
| --- | --- |
| COMMIT_ID / codeVersion | 172f2fc0 / 2.52.1 |
| game / launcher / TEST_REMOTE_MODULE | dff14 / ae5a4 / 90329 |
| dataBundleVer / config bundle / language bundle | cbb769dfb4 / 58922 / 6465a |

`convertAssets` 将 assets 转成 CDN remote，脚本使用 `.jsc`。按 loader 的 XXTEA 函数及当前密钥解密，只运行纯解密实现，不执行业务脚本。分析快照位于临时目录，未提交大型官方资源。

配置不能只查 `data/<version>/config.json`：launcher 同时加载 `config_ap` 等配置。助威商店商品来自当前 `data/cbb769dfb4/config_ap.json` 的 `LegionStoreConf`，`storeID=2`、`coin=4`、`itemID=2101`；库存物品2101为助威币。基础配置还可通过 remote/config/config.58922.json 路径和 UUID 还原：本次 config_ap import 为 `18/185ae3cd-fd69-4c4b-b2c9-b24af68d82f4.d6465.json`。商品12名称在该 bundle 的 language 基础资源中为“四圣转星镜”，描述说明有效期3天；不应仅因在线 language 增量缺失该词条而认为它不存在。

## 调用链与协议证据

- `StoreLegionDataAdapter.bindItem` 读取 `LegionStoreConf` 商品、`buyGoods[id]` 已购数量及 `UIHelper.isPaymentEnough(coin,price,itemID)`，购买按钮经确认对话框调用 `LegionModule.sendStoreBuyGoods(id)`。
- `LegionModule.sendStoreGoodsList` 调用 `LegionService.storeGoodsList({})`；返回后清空并重建 `buyGoods`，该字段为完整已购额度表。
- `LegionModule.sendStoreBuyGoods(id,num=0)` 调用 `LegionService.storeBuyGoods({id,num})`，成功后展示 `reward` 并替换 `buyGoods`。助威商店单份 UI 使用默认 num=0。本次错误反馈后已修正原实现：助威商店只能按已观察到的官方单份调用逐次发送 `{id,num:0}`；不能把其他商店的正整数数量调用推广到这里。
- 当前 TEST_REMOTE_MODULE 中注册 `_gs("Legion",{...,storeBuyGoods:tV,storeGoodsList:nV,...})`。注册器以 `(service+"_"+method).toLowerCase()` 生成发送命令，因此实际为 `legion_storegoodslist`、`legion_storebuygoods`。已隔离字符串表及轮转解码核对 `_gs`、`toLowerCase`、`Legion_StoreBuyGoodsResp`、`buyGoods`，没有执行整个协议包。
- 客户端声明 `Legion_StoreGoodsListResp.buyGoods`、`Legion_StoreBuyGoodsResp.buyGoods`。购买响应的角色字段可能为增量，因此库存始终重新查询 `role_getroleinfo`，不把增量缺失当作清零。

| id | 商品 | 每份助威币 | 客户端配置限购 |
| --- | --- | --- | --- |
| 7 | 随机红将碎片100 | 20 | 1 |
| 8 | 白玉2000 | 20 | 1 |
| 9 | 军团币1000 | 20 | 1 |
| 10 | 进阶石1600 | 20 | 20 |
| 11 | 精铁4000 | 20 | 20 |
| 12 | 四圣转星镜1（有效期3天） | 150 | 1 |

商店读取服务端当前周期已购额度，不以月赛助威的第四个周日窗口限制采购，也不自行按本地日期清零。配置数量表示本期累计目标，默认全为0；按表中顺序依次购买，扣除已购数量，并以当前账号余额限制份数。账号之间不共享角色库存。写请求异常后查询额度；结果已确认则继续，否则停止，不重复发送。包含助威商店的组合任务关闭失败账号自动补跑，避免其他任务触发采购重发。

## 页面与多选

批量列表按日常领取、月度、周常限时、俱乐部赛事、商店、副本、资源管理、宠物、功法、养成阵容分类，支持搜索任务或分类名称。立即执行与定时任务共用分类。

“多选任务”开启后可跨分类、跨搜索勾选，按列表顺序执行；每个账号完成全部所选任务后切换下一账号。复用既有账号会话、连接队列、停止和状态汇总，手动组合不自动补跑、不发送定时任务完成通知、不写入定时任务完成历史。参数沿用全局任务设置；助威采购缺少清单、黄金天宫缺少对象时先打开相应配置，不执行未配置的组合。原有弹窗和专项操作保留在可展开区域。

## 验证与后续更新

`test/cheerShop.test.js` 覆盖库存不足、累计目标、账号隔离、超时状态核对、不确认即停止、停止操作、无效状态、分类覆盖及搜索。既有洗练入口测试改为核对新的养成分类。

游戏更新时重新请求 manifest；重新核对 game UI/Module、协议注册、config_ap 商品与 language 基础及增量资源。若商品、限购或接口变化，更新 `src/utils/cheerShop.js` 和测试；不要固定沿用本文资源哈希。加载器更新步骤见 `game接口定位与更新指南.md`。

验证结果：采购和洗练入口相关15项测试通过；全量919项中918项通过，宠物合成测试在未修改HEAD快照同样失败。生产构建通过，仍有既有worker.js缺失及大包提示。未进行浏览器人工交互或真实账号采购验证。

2026-11-02 用户确认调整：查询咸主、加入俱乐部明确归入养成与阵容；换皮闯关明确归入周常与限时活动；资源分类名称改为“资源管理”。明确归属优先于关键词匹配。列表新增分类数量筛选、网格任务项和多选高亮，跨分类/搜索保留选择。相关16项测试及生产构建通过，未进行浏览器人工交互验证。

## 2026-11-02：200020反馈后的参数纠正

重新请求当前manifest并下载业务/协议，版本仍为game dff14、launcher ae5a4、TEST_REMOTE_MODULE 90329、codeVersion 2.52.1、dataBundleVer cbb769dfb4、COMMIT_ID 172f2fc0。

进一步核对 `LegionShopDialog._refreshItem`：当 `o.storeID !== SALT_CRYSTAL_STORE_ID` 时，普通确认对话框成功后调用 `_module.sendStoreBuyGoods(o.id)`；只有盐晶商店调用 `_showSaltCrystalBuyDialog`，数量回调才调用 `sendStoreBuyGoods(t.id,e)`。类内 `SALT_CRYSTAL_STORE_ID=4`，助威商品配置的storeID=2。因此助威应使用 `sendStoreBuyGoods` 的默认num=0表示单份。

原实现把盐晶等其他商品的批量num推广到助威商店，是缺乏当前UI调用依据的推断，现已纠正。累计目标仍有效，但每次只发送 `{id,num:0}`，刷新额度，确认已购数量增加1，再查询库存继续下一份。失败日志记录商品名称、id、已购前后额度、单价及请求前库存；200020仍只认定通用错误，不能据此证明余额不足或服务器禁止的具体条件。未使用真实账号复现或执行线上购买，修正效果仍需实际运行确认。

同时修正组合任务连接等待阶段：用户主动停止标记为stopped并记录“已停止”，真实断线和普通错误仍为failed。
