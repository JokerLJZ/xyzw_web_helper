# 游戏 API 接口与指令查找方法

本文记录本项目查找游戏 WebSocket 指令、请求参数、响应格式和业务判断逻辑的方法。它以“领取成就奖励”为完整案例，也可以复用于活动、武将、装备、任务等奖励接口的分析。

> 仅分析自己有权访问的客户端资源和账号数据。不要用这些方法绕过权限校验、伪造奖励或对服务器进行高频请求。

## 一、先理解项目里的“API”是什么

本项目的大部分游戏操作不是传统 HTTP API，而是通过 WebSocket 发送 BON 编码消息：

```text
界面按钮
  -> 批量任务函数
  -> tokenStore.sendMessageWithPromise()
  -> XyzwWebSocketClient
  -> BON 编码
  -> WebSocket 指令
  -> 游戏服务器响应
```

因此，寻找一个新功能通常需要确认四件事：

1. 请求指令名，例如 `task_claimachievement`。
2. 请求参数，例如 `{ achievementId }`。
3. 操作前需要查询的数据，例如角色信息中的 `role.achievement`。
4. 什么状态才允许执行，以及执行后如何确认成功。

## 二、优先在已有资料和项目代码中搜索

先搜索仓库内已有采集文件、命令注册表、相似功能和响应映射：

```bash
rg -n "achievement|成就|claimachievement" .
rg -n "task_claim|sendMessageWithPromise|sendGetRoleInfo" src
```

搜索时重点查看：

- `src/utils/xyzwWebSocket.js`：指令默认参数和响应映射。
- `src/utils/batch/tasksItem.js`：连接、查询、执行、延迟和日志的现有写法。
- `src/stores/tokenStore.ts`：查询角色信息和发送消息的统一入口。
- `api采集/`：已经保存的抓包或人工整理资料。

尽量复用已有连接及消息发送流程，不要另写一套 WebSocket 客户端。

## 三、从官方客户端资源反查指令

当仓库中没有对应资料时，从当前客户端代码反查。不要只参考旧版采集文件，因为游戏版本更新后，指令名、字段和配置都可能变化。

### 1. 获取当前资源清单

客户端启动时会先请求 manifest。分析时使用与当前客户端匹配的平台和版本参数，例如：

```text
POST /login/manifest?platform=hortor&version=<当前客户端版本>
```

manifest 会给出当前 launcher、game、config 等资源版本或资源地址。应始终以当前 manifest 为准，不要把某个哈希永久写死在分析脚本中。

### 2. 下载并解密 game bundle

game bundle 中包含经过打包、压缩或加密的客户端 JavaScript。解密算法和密钥应从当前客户端启动代码或项目已有解密工具中读取，避免在文档和业务代码里重复保存密钥。

解密后先做关键词搜索：

```bash
rg -n "claimAchievement|Achievement|achievementId" <解密后的目录>
```

压缩后的代码变量名通常已被缩短，但以下内容往往仍然保留：

- Service 方法名；
- 消息字段名；
- 配置表名；
- UI 文案或事件名；
- 请求对象中的键名。

### 3. 从调用点确认参数

这次在客户端成就界面中找到的调用形式是：

```javascript
TaskService.claimAchievement({ achievementId: achievement.gotoConfig.id });
```

它能确认：

- 服务：`TaskService`；
- 方法：`claimAchievement`；
- 参数名：`achievementId`；
- 参数值：成就类别配置 `AchievementConf` 的 `id`，不是阶段配置
  `AchievementTaskList.id`。

根据当前客户端的 Service 到协议命名规则，再确认实际 WebSocket 指令为：

```text
task_claimachievement
```

不能只凭命名习惯猜接口。至少还要在协议注册、网络消息或实际响应中完成一次交叉验证。

### 4. 一个完整的具体例子：查找“成就奖励领取”接口

下面不再只讲原则，而是按这次实际分析的顺序走一遍。

#### 第一步：先从界面动作推测搜索词

目标动作是“点击成就页面中的领取按钮”。暂时不知道接口名，只知道它与“成就”和“领取”有关，所以先在解密后的客户端代码中搜索：

```bash
rg -n "achievement|Achievement|成就" <客户端代码目录>
```

如果结果太多，再增加“领取”相关词缩小范围：

```bash
rg -n "claimAchievement|achievementId" <客户端代码目录>
```

最终在成就界面的按钮回调附近看到类似代码：

```javascript
TaskService.claimAchievement({ achievementId: e.gotoConfig.id });
```

这行代码可以直接读成：

> 用户点击领取按钮时，客户端调用 `TaskService` 的 `claimAchievement` 方法，并把该成就类别的 ID 放进 `achievementId` 字段。

到这里已经确认了请求参数不是 `taskId`、`id` 或 `rewardId`，而是：

```javascript
{ achievementId: 具体成就ID }
```

#### 第二步：从 Service 方法定位协议指令

继续查看 `TaskService.claimAchievement` 的生成或注册位置，并对照同一服务中的已知方法。例如：

```text
TaskService.claimDailyReward  -> task_claimdailyreward
TaskService.claimWeekReward   -> task_claimweekreward
TaskService.claimAchievement  -> task_claimachievement
```

再用协议注册或实际消息进行交叉确认后，得到最终指令：

```text
task_claimachievement
```

因此项目中的单次领取请求等价于：

```javascript
await tokenStore.sendMessageWithPromise(
  tokenId,
  "task_claimachievement",
  { achievementId: 2 },
);
```

这里必须传成就类别 ID `2`。阶段配置 ID `12` 只用于判断该阶段是否已经领取，不能作为领取请求参数。

#### 第三步：找出领取前应该查询什么

仅知道领取指令还不够，因为我们不知道哪个 ID 已完成、哪个已经领过。于是继续从成就页面“刷新列表”的代码往回查，发现它读取：

```javascript
role.achievement
```

假设角色信息接口返回了下面这段数据：

```javascript
{
  role: {
    achievement: {
      2: {
        completeValue: 420,
        lastClaimId: 11,
      },
    },
  },
}
```

它表达的是：

- `2`：第 2 类成就；
- `completeValue: 420`：该类成就当前累计完成值为 420；
- `lastClaimId: 11`：最后已经领取的是配置 ID 11。

这就是为什么功能执行时先调用角色信息查询，而不是直接尝试一批 ID。

#### 第四步：用配置表把状态翻译成可领取 ID

从 `AchievementTaskList` 中取出第 2 类成就，会看到类似阶段：

| 成就类型 | 配置 ID | 要求完成值 |
| --- | ---: | ---: |
| 2 | 11 | 50 |
| 2 | 12 | 100 |
| 2 | 13 | 300 |
| 2 | 14 | 500 |
| 2 | 15 | 1000 |

现在把角色状态代入：

```text
当前完成值 = 420
最后已领取 ID = 11
```

逐项判断如下：

1. ID 11 已经领取，跳过。
2. ID 12 要求 100，`420 >= 100`，可以领取。
3. ID 13 要求 300，`420 >= 300`，可以领取。
4. ID 14 要求 500，`420 < 500`，不能领取。
5. 后续阶段要求更高，因此这一类到此停止。

最终计算结果是“第 2 类成就可以连续领取两档”。发送给服务器的领取计划为：

```javascript
[2, 2]
```

#### 第五步：按顺序真正领取

程序会串行发送两次请求：

```javascript
await claim({ achievementId: 2 });
await wait(commandDelay);
await claim({ achievementId: 2 });
```

第一次请求领取第 2 类的当前阶段（阶段 ID 12）；服务器推进该类别的领奖进度后，第二次仍发送类别 ID 2，领取下一个阶段（阶段 ID 13）。不会发送阶段 ID 11，因为它已经领过；也不会尝试阶段 ID 14，因为进度还不够。

把完整过程连起来就是：

```text
查询角色信息
  -> 得到第2类进度420、最后领取ID 11
  -> 查询本地成就配置
  -> 算出阶段12、13均已达成
  -> 发送成就类别ID 2，领取当前阶段
  -> 等待指令间隔
  -> 再次发送成就类别ID 2，领取下一阶段
  -> 完成
```

#### 第六步：为什么不直接遍历 1 到 200

直接尝试所有 ID 看似简单，但会产生几个问题：

- 已领取的 ID 会被重复请求；
- 未达到条件的 ID 会导致服务器报错；
- 阶段 ID 不保证连续，而且服务端领取参数本来就不是阶段 ID；
- 大量无效请求容易触发 `200400 操作太快`；
- 无法区分“没有奖励”和“接口失败”。

所以本功能采用“先查询状态、再用配置判断、最后只领取符合条件的 ID”的方式。

## 四、查清业务判断，而不只是找到领取指令

如果不先查询状态就盲目领取，很容易重复请求、触发服务器错误或遗漏多阶段奖励。

### 1. 查找状态来源

客户端成就界面读取的是角色信息中的：

```javascript
role.achievement
```

每类成就主要使用：

- `completeValue`：当前完成值；
- `lastClaimId`：这一类最后领取的配置 ID。

因此本项目执行领取前先调用已有的角色信息查询，再从响应中取成就状态。

### 2. 查找成就配置表

状态数据只表示“做到多少”和“领到哪里”，具体阈值与下一阶段 ID 位于配置资源中。本次对应配置表为 `AchievementTaskList`。

需要从当前 config bundle 中解析至少这些字段：

```text
id             成就阶段 ID
type           成就类别
completeValue  领取所需进度
```

不要假设 ID 连续，也不要简单使用 `lastClaimId + 1`。正确方式是：

1. 按 `type` 对配置分组；
2. 保持配置定义的阶段顺序；
3. 找到 `lastClaimId` 所在位置；
4. 从下一项开始检查是否达到阈值；
5. 连续收集所有已达成但未领取的 ID；
6. 遇到第一个未达成阶段就停止该类别。

如果服务器返回了本地配置中未知的 `lastClaimId`，应安全跳过该类别，而不是从头领取，避免版本不匹配时重复发送错误请求。

### 3. 注意特殊比较规则

大部分成就是数值越大越好：

```javascript
completeValue >= requiredValue
```

排名类成就是名次越小越好，并且 `0` 通常表示尚无有效排名：

```javascript
completeValue > 0 && completeValue <= requiredValue
```

特殊规则必须从客户端原始判断逻辑确认，不能对所有成就统一使用大于等于。

## 五、确认响应和错误行为

找到请求后，还要确认 Promise 如何结束。项目的 WebSocket 客户端可能通过以下方式匹配响应：

- 请求序号和响应 `ack`；
- 明确的 `xxxresp -> xxx` 映射；
- 通用同步奖励响应。

本次注册内容为：

```javascript
.register("task_claimachievement", { achievementId: 0 })
```

并补充响应映射：

```javascript
task_claimachievementresp: "task_claimachievement"
```

实际运行时应观察：

1. 请求是否收到成功响应；
2. 奖励是否由独立响应还是同步消息返回；
3. 服务器错误码是否代表操作太快、条件不满足或版本过期；
4. 是否需要在全部操作结束后重新查询状态。

## 六、接入项目的推荐结构

### 1. 将“判断逻辑”与“网络执行”分开

纯判断函数只接收状态和配置，返回应领取的 ID：

```javascript
const ids = getClaimableAchievementIds(role.achievement);
```

网络任务负责：

```text
建立连接
  -> 查询角色信息
  -> 计算可领取 ID
  -> 依次发送领取指令
  -> 输出结果日志
  -> 关闭连接并释放队列位置
```

这样判断逻辑可以脱离服务器进行单元测试，也方便将来更新配置。

### 2. 领取必须串行并保留间隔

同一账号有多个成就奖励时应逐个领取，不要并发发送。每次请求后使用项目统一的 `delayConfig.command` 间隔，降低触发 `200400 操作太快` 的概率。

多账号可以沿用现有连接池并行，但每个账号内部仍保持串行。

### 3. 没有奖励时不要发送领取请求

先查询、再判断。没有可领取项时只记录：

```text
当前没有可领取的成就奖励
```

这既减少无效请求，也方便区分“没有奖励”和“领取失败”。

## 七、验证清单

每增加一个新接口，至少完成以下检查：

- [ ] 指令名来自当前客户端代码或真实消息，不是纯猜测。
- [ ] 请求字段名和数据类型已确认。
- [ ] 操作前置状态及其查询入口已确认。
- [ ] 普通条件和特殊条件均已覆盖。
- [ ] 响应能够正确结束请求 Promise。
- [ ] 无可执行项时不会发送无效请求。
- [ ] 同账号操作串行且有合理间隔。
- [ ] 未知配置或版本错配时安全跳过。
- [ ] 纯判断逻辑有单元测试。
- [ ] `git diff --check`、项目测试和生产构建通过。

成就奖励本次覆盖的关键测试包括：

1. 只返回已经完成且尚未领取的连续阶段；
2. 已领取旧阶段后能够识别后来新增的阶段；
3. 排名成就使用反向比较；
4. 未知 `lastClaimId` 不会导致从头重复领取。

## 八、版本更新后的维护方式

游戏更新后，如果领取功能突然失效，按以下顺序排查：

1. 重新请求 manifest，确认 game/config 版本是否变化；
2. 重新解密当前 game bundle，确认 Service 方法和字段是否改名；
3. 重新解析 `AchievementTaskList`，确认是否新增或调整阶段；
4. 检查角色信息中的成就数据结构是否变化；
5. 查看真实响应命令及错误码；
6. 更新本地配置和测试，再运行完整构建。

核心原则是：**请求指令取自客户端调用，业务条件取自客户端判断，阶段数据取自当前配置，最终结果用服务器响应验证。**
