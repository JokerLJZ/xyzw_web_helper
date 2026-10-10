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

## 图鉴激活领奖、佩戴最高等级宠物

接口来自上述game加载的游戏代码。`PetRoleDataView`定义图鉴状态：Unclaimed=0，Claimed=1，Locked=2；缺失记录按Locked处理。`PetModule.sendActiveBook`调用`PetService.activateBook({petId})`；`sendClaimBookReward`调用`PetService.claimBookReward({petId})`。`PetRedDotData.judgePetBookPetActiveAward`仅允许已激活且`bookReward[petId] !== 1`的图鉴领奖。API目录图鉴领奖记录确认激活响应`role.petData.books[602]=1`、领奖响应`role.petData.bookReward[602]=1`。游戏中的图鉴只有激活与领奖，本体升星使用`upgradeStar({slotUId})`且消耗碎片，属于另一项功能。

佩戴来自`PetEquipDialog._onClickUse`的`PetService.load({slotUId:{slot,uId}})`，命令`pet_load`，装备槽位`PET_EQUIP_SLOT_ID=-1`。任务先按等级取最高宠物，同等级优先保留当前佩戴，其次品质、红属性数量、唯一编号；佩戴后查询装备槽唯一编号确认。未重复发送已佩戴宠物，未确认成功时停止且不重试。图鉴和佩戴均采用与合成相同的2500/1500毫秒请求间隔。
