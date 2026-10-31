# 宠物开蛋和合成接口依据

核对日期：2026-10-10。

## 已有 API 采集

https://github.com/xiangfu1027/xyzw_web_helper/tree/magic/api%E9%87%87%E9%9B%86/%E5%AE%A0%E7%89%A9

已核对目录及宠物升级、扭蛋记录。升级为 `pet_useexpitem`；扭蛋是 `gacha_drawreward`，与库存宠物蛋使用不同。目录尚无 `pet_merge`、`pet_openegg` 的实际成功/失败抓包。本次合成、开蛋依据官方客户端代码，测试中的合成数据为模拟状态，不冒充真实抓包。

## game 加载的官方客户端

入口 `public/game/main.2a00e.js`：获取 manifest，再加载远程游戏与协议模块。

- 游戏：https://xxz-xyzw-res.hortorgames.com/remote/game/index.22c3b.jsc
- 协议：https://xxz-xyzw-res.hortorgames.com/remote/TEST_REMOTE_MODULE/index.dcdf9.jsc
- 配置：https://xxz-xyzw-res.hortorgames.com/remote/config/import/7c/7cb951cc-bb1a-4cff-8d57-c26146b9b999.19b64.json

`PetModule.sendOpenEgg` 调用 `PetService.openEgg({itemId})`，响应从 `role.petData.pets` 取得宠物增量。客户端检查 `rolePet.unlockedSlot` 范围的空槽才发送。PetEggConf：白37011、绿37012、蓝37013；PetTilesConf前8槽免费，最多16槽，任务只使用已开放槽位。

`PetModule._sendMerge` 调用：

```js
PetService.merge({fromSlotUId, toSlotUId, inheritSlot})
// SlotUId: {slot: number, uId: string}
```

协议命令为 `pet_merge`，响应 `pet_mergeresp`。客户端分别检查协议错误与 `isSuccess`，读取 `reward` 和 `role.petData.pets`；因此接口返回正常不等于合成成功。

`sendDragDropPet`：同品质、双方未锁定、非金色才合成，否则交换。`PetConstData.needMergeConfirm` 从PetConstant.mergeConfirmColor读取阈值4。白绿蓝inheritSlot=0，紫及以上选择继承对象的槽位。任务继承等级较高者，同等级优先靠前槽位。

## 任务验证策略

默认合成白绿蓝紫，保护佩戴和锁定宠物。每次开蛋/合成后查询完整角色，验证蛋库存和槽位数量变化；未知响应、超时或未确认进展时停止且不重试。满槽时合成腾位再开蛋，无配对可腾位则保留剩余蛋。手动及定时入口均执行确认弹窗。

上线前仍需要真实合成成功、失败和开蛋响应验证，本实现没有使用真实账号执行消耗操作。

## 扭蛋累计奖励

`ResidentGachaData.canClaimReward` 和 `ResidentGachaRewardDialog._canClaimStageReward` 均要求 `stageGachaCnt >= GachaAccumRewardConf.num` 且该ID未领取。官方配置包含阶段1至10，门槛依次10、20、30、40、50、60、70、80、90、100次。

先调用 `GachaService.getInfo({})` / `gacha_getinfo` 获取本轮次数与 `claimedStageIdMap`，然后调用 `GachaService.claimStageReward({stageId})` / `gacha_claimstagereward`。`api采集/宠物/扭蛋领奖.txt`实际阶段4响应只有 `roleGacha.claimedStageIdMap[4]=true` 增量，以及奖励/物品增量；必须合并领取状态。测试夹具 `test/fixtures/gacha-claim-stage4.json` 取自该记录，保留相关字段。任务领取所有达标未领阶段，不发送抽奖请求。

## 请求间隔

实际用户日志反馈连续操作触发200400（操作太快）。调整为角色查询后至少等待2500毫秒再开蛋/合成，操作完成后至少等待1500毫秒再查询角色，因此连续消耗操作间隔至少4秒；用户配置的命令间隔更大时采用更大值。所有操作串行，不并发查询，限流或超时后仍停止，不自动重发消耗请求。上述间隔是降频策略，服务器实际限流阈值未公开。

## 图鉴激活领奖、佩戴优先宠物

接口来自上述game加载的游戏代码。`PetRoleDataView`定义图鉴状态：Unclaimed=0，Claimed=1，Locked=2；缺失记录按Locked处理。`PetModule.sendActiveBook`调用`PetService.activateBook({petId})`；`sendClaimBookReward`调用`PetService.claimBookReward({petId})`。`PetRedDotData.judgePetBookPetActiveAward`仅允许已激活且`bookReward[petId] !== 1`的图鉴领奖。API目录图鉴领奖记录确认激活响应`role.petData.books[602]=1`、领奖响应`role.petData.bookReward[602]=1`。游戏中的图鉴只有激活与领奖，本体升星使用`upgradeStar({slotUId})`且消耗碎片，属于另一项功能。

佩戴来自`PetEquipDialog._onClickUse`的`PetService.load({slotUId:{slot,uId}})`，命令`pet_load`，装备槽位`PET_EQUIP_SLOT_ID=-1`。任务先选最高品质（金＞红＞橙＞紫＞蓝＞绿＞白），同品质按自身技能破甲＞格挡＞其他，再比较等级；仍相同时保留当前佩戴，最后按唯一编号稳定选择；佩戴后查询装备槽唯一编号确认。未重复发送已佩戴宠物，未确认成功时停止且不重试。图鉴和佩戴均采用与合成相同的2500/1500毫秒请求间隔。

## 原始响应兼容

用户实号日志出现合成响应省略isSuccess。game直接以`e.isSuccess`真假值决定成功/失败分支，原始数据缺省与该真假值分支兼容；任务仅在省略字段同时有宠物增量、完整查询确认数量减少后按失败分支继续，不对空响应或非布尔异常值猜测。省略字段的实际失败抓包仍待收集，测试为模拟省略值回归。

升级后完整角色库存省略已耗尽经验道具15001时按0处理；完整items对象缺失仍属于无法确认库存。等级未变但经验增加属于有效升级进度，耗尽后正常结束。


## 2026-10-12 佩戴规则预设核对

重新读取本地 `main.2a00e.js` 的 manifest 请求、CDN 转换和 XXTEA 解密规则。当前 manifest（platform=hortor、version=0.32.0-android）为 game=22c3b、launcher=861b5、TEST_REMOTE_MODULE=dcdf9、config=78fbc；`data/version.json` 与 manifest dataVers 均为 `4921343dff`。分析匹配版本的游戏与 launcher 代码，并读取官方 `data/4921343dff/config.json`、`tower.json`；技能描述实际在 tower 的 `SkillSchemeConf`，不能从精炼属性或宠物系列猜测。

调用依据：`PetConstData.getPetSkillIds` 从 `PetConf.petPassiveSkillGroupId` 匹配 `PetPassiveSkillConf.skillGroupId`，以 `skillSchemaId` 获取技能描述；`PetEquipDialog._onClickUse` 使用背包槽位和唯一编号调用 `PetService.load`。沿既有协议注册确认继续使用 `pet_load` 和 `{slotUId:{slot,uId}}`，装备槽为 -1。只修改选择规则，保留查询完整角色及佩戴后确认、限速与不重试策略。没有使用真实账号验证当前响应。

用户确认属性指宠物自身技能。预设按宠物种类分类，即使当前等级尚未解锁对应技能，也使用该种类的属性优先级。配置保存在 `src/utils/petEquipConfig.js`；未知宠物 ID 跳过，后续新增宠物需重新核对官方配置。

| 品质 | 破甲优先 | 格挡其次 | 其他 |
| --- | --- | --- | --- |
| 金 | 赤兔马702 | 黄金章鱼701 | 玄翎鹤703、食梦貘704 |
| 红 | 炎鬃狮602 | 甲锅龟601 | 疾风隼603、蛇尾枭604 |
| 橙 | 雷帽绒503 | 拳击狐502 | 武虾501、灰烬兔504 |
| 紫 | 铁头飞猪403 | 潮团兽401 | 盘牙402、长颈树404 |
| 蓝 | 无 | 冰灯水母301 | 热狗302、幽影蝶303、烛灵304 |
| 绿 | 你真蚌201 | 溜溜萝204 | 梨嘴鸭202、响尾蜂203 |
| 白 | 大眼海胆101 | 小幽灵104 | 芽芽蛙102、泡泡蝇103 |

原任务标识 `batchEquipHighestLevelPet` 保留以兼容已有定时任务，界面和日志改为“佩戴优先宠物”；神灯挑战中独立的最高等级宠物判断不变。游戏更新后按 `docs/game接口定位与更新指南.md` 重读 manifest 和 data 版本，核对上述三张配置表并更新预设与测试。

## 2026-10-31 佩戴筛选修复

重新核对本地 index → game-defines → main 的 manifest、CDN及XXTEA规则；POST manifest参数platform=hortor、version=0.36.0-android，当前COMMIT_ID=172f2fc0，game=dff14、launcher=ae5a4、协议=90329、config=58922。下载并隔离解密当前game，PetEquipDialog._onClickUse仍通过petsReverse取槽位，调用PetService.load({slotUId:{slot,uId}})，未设置等级大于0的佩戴条件。沿用已有已核对的pet_load协议，不新增命令。此次未重新分析配置技能表，品质和属性排序保持原规则。

项目原选择器要求level为至少1的整数，导致0级或缺省等级被排除；现在缺省按0参与等级排序，仍排除负值及异常类型。新增0级、缺省等级紫宠从槽位0佩戴并查询装备槽确认的回归，7项宠物管理测试通过。尚未取得用户此次真实角色响应，不能断言其具体等级字段；未连接账号执行佩戴。后续更新仍需按接口定位指南重新取得manifest，并核对PetEquipDialog、协议及配置，避免沿用快照哈希。
