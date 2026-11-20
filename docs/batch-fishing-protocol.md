# 批量钓鱼协议核对

核对日期：2026-10-11。

## 来源

- 本地 `public/game/main.2a00e.js`：游戏资源不是全部包含在本地，`loadRemoteBundleVers` 获取 manifest，`convertAssets` 将 game bundle 指向官方 CDN，`loadJscAndDecode` 解密客户端脚本。
- 本次 manifest 返回的 game bundle 为 `22c3b`，对应官方资源 `https://xxz-xyzw-res.hortorgames.com/remote/game/index.22c3b.jsc`。
- [免费钓鱼抓包（2026-08-30）](https://github.com/xiangfu1027/xyzw_web_helper/blob/magic/api%E9%87%87%E9%9B%86/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1/%E5%85%8D%E8%B4%B9%E9%92%93%E9%B1%BC.txt)。

## 游戏操作顺序

`ArtifactLotteryDialog._onBtnOne` 在 `ArtifactModule.isFreeLottery` 为真时调用一次 `sendLottery(normal, 1)`，否则进入鱼竿数量选择；数量选择上限为 10。黄金鱼竿直接进入数量选择。

`ArtifactModule.sendLottery` 始终发送 `{ type, lotteryNumber, newFree: true }`，不能把付费操作的 `newFree` 改为 false。`todayFreeLotteryTimes` 根据每日计数的 `statisticsTime` 判断是否跨日，剩余免费次数为每日上限减去今日计数。

抓包显示三次免费请求都是 `{ type: 1, lotteryNumber: 1, newFree: true }`，响应为 `syncrewardresp`，`role.statistics["ar:normal:lo:cnt"]` 依次为 1、2、3，对应 `statisticsTime` 为秒时间戳。返回的 `role.items` 是奖励等增量，可能不含鱼竿，不能把它当作完整库存。

## 修复范围

批量钓鱼每个账号独立拉取角色快照，先逐次处理剩余免费次数，再处理最多 10 次的鱼竿请求。目标数量包含免费次数。增量递归合并到本账号快照，定期重新查询库存，库存变少时重新计算尾批。失败不自动重复消耗，停止后不领取累计奖励。

该流程差异是日志中首轮失败的可疑原因；`200020` 是通用服务端错误，不能仅凭该错误码确认唯一原因。回归测试使用模拟服务端验证请求顺序和库存隔离，未使用真实账号执行钓鱼。
