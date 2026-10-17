import test from "node:test";
import assert from "node:assert/strict";
import { loadRechargeExchangeCatalog, findRechargeActivity, remainingBarbecue, queryRechargeExchange, exchangeRechargeItems, runRechargeStandard, rewardText } from "../src/utils/rechargeActivity.js";
const NOW = Date.parse("2026-10-16T13:00:00+08:00");
const root = { id: 20261016, name: "周年", start: NOW / 1000 - 3600, end: NOW / 1000 + 86400 };
const act = (id, actType, extra = {}) => ({ id, actType, start: root.start, end: root.end, actGroup: 0, ...extra });
const base = () => ({ version: "v1", actConstantConf: { 1: root }, ActFestivalConf: { 1: act(11, 2, { itemId: 5292 }), 2: act(12, 3) }, ExchangeActConf: { 1: { id: 101, actId: 11, rank: 1, consumeNum: 2, resourceType: 3, rewardId: 5, rewardNum: 10, limitNum: 5, unlockNeed: 0 } }, CumulativeChargeActConf: {}, ActMerchandiseConf: {}, ItemConf: { 5: { name: "奖励" }, 5292: { name: "金吉他" } } });
const clone = value => JSON.parse(JSON.stringify(value));
function server({ stock = 10, used = 0 } = {}) {
  const calls = [];
  const info = { 11: { record: { 101: used } } };
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === "activity_get") return { activity: { commonActivityInfo: clone(info) } };
    if (cmd === "role_getroleinfo") return { role: { items: { 5292: { quantity: stock } } } };
    if (cmd === "activity_exchange") { info[11].record[101] += params.quantity; stock -= params.quantity * 2; return { role: { gold: 1 } }; }
    throw new Error(cmd);
  };
  return { send, calls, info };
}
test("按开始时间、活动组和类型识别，不绑定日期编码", () => {
  const config = base();
  assert.equal(findRechargeActivity(config, NOW).code, 20261016);
  config.actConstantConf[1] = { ...root, id: 20301001 };
  assert.equal(findRechargeActivity(config, NOW).code, 20301001);
  assert.equal(findRechargeActivity(config, root.end * 1000), null);
  config.ActFestivalConf[1].actGroup = 2;
  assert.equal(findRechargeActivity(config, NOW), null);
});
test("烧烤包含免费首场，保留当日三次并受总次数约束", () => {
  const activity = { parameters: [60, 10] };
  assert.equal(remainingBarbecue({}, activity, { todayUseTickCnt: 0, useTickCnt: 0 }), 8);
  assert.equal(remainingBarbecue({}, activity, { todayUseTickCnt: 8, useTickCnt: 7 }), 0);
  assert.equal(remainingBarbecue({}, activity, { todayUseTickCnt: 4, useTickCnt: 59 }), 1);
  assert.equal(remainingBarbecue({}, activity, {}), 8);
  assert.throws(() => remainingBarbecue({}, activity, { todayUseTickCnt: -1 }), /异常/);
});
test("兑换先查询该账号的库存、限购与解锁", async () => {
  const account = server({ stock: 7, used: 3 });
  const snapshot = await queryRechargeExchange(account.send, base(), NOW);
  assert.equal(snapshot.rows[0].max, 2);
  assert.equal(snapshot.spent, 6);
  assert.equal(snapshot.itemName, "金吉他");
  const other = await queryRechargeExchange(server({ stock: 0 }).send, base(), NOW);
  assert.equal(other.rows[0].max, 0);
});
test("累计消耗不足时锁定兑换商品", async () => {
  const config = base(); config.ExchangeActConf[1].unlockNeed = 8;
  assert.equal((await queryRechargeExchange(server().send, config, NOW)).rows[0].max, 0);
});
test("兑换成功以刷新后的记录确认，允许奖励仅含角色增量", async () => {
  const account = server();
  await exchangeRechargeItems({ ...account, config: base(), selection: [{ goodsId: 101, quantity: 2 }], expectedActivityId: 11, now: () => NOW });
  assert.equal(account.info[11].record[101], 2);
  assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, 1);
});
test("超时后查询状态且不重试兑换", async () => {
  const account = server();
  const send = async (cmd, params) => { const result = await account.send(cmd, params); if (cmd === "activity_exchange") throw new Error("timeout"); return result; };
  await assert.rejects(exchangeRechargeItems({ send, config: base(), selection: [{ goodsId: 101, quantity: 1 }, { goodsId: 101, quantity: 1 }], expectedActivityId: 11, now: () => NOW }), /不自动重试/);
  assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, 1);
  assert.equal(account.calls.at(-1)[0], "role_getroleinfo");
});
test("切期、库存不足、非法数量均阻止兑换", async () => {
  for (const [expectedActivityId, quantity] of [[99, 1], [11, 6], [11, -1], [11, 1.5]]) {
    const account = server();
    await assert.rejects(exchangeRechargeItems({ ...account, config: base(), selection: [{ goodsId: 101, quantity }], expectedActivityId, now: () => NOW }));
    assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, 0);
  }
});
test("不以缺失活动快照推断尚未领取", async () => {
  await assert.rejects(queryRechargeExchange(async () => ({}), base(), NOW), /快照/);
});
test("物品中文名取自当前语言配置", () => {
  const config = base(); config.ItemConf[5].name = "key"; config.LanguageConf = { part: { key: { chinese: "乘风♂" } } };
  assert.equal(rewardText(config, 3, 5), "乘风♂");
});
test("抽奖只用活动道具，10次后单次，绝不兑换路路通", async () => {
  const config = base(); config.ActFestivalConf[3] = act(13, 24, { parameters: [200, 40009, 40001] });
  let stock = 12; const draws = []; const calls = [];
  const send = async (cmd, params) => {
    calls.push(cmd);
    if (cmd === "role_getroleinfo") return { role: { items: { 40009: { quantity: stock }, 40001: { quantity: 9999 } } } };
    if (cmd === "activity_maydaylottery") { draws.push(params.times); stock -= params.times; return { role: { gold: 1 } }; }
    if (cmd === "activity_get") return { activity: { commonActivityInfo: {} } };
    throw new Error(cmd);
  };
  assert.equal((await runRechargeStandard({ send, config, now: () => NOW })).status, "completed");
  assert.deepEqual(draws, [10, 1, 1]);
  assert.ok(calls.every(cmd => !/exchange|consume/.test(cmd)));
});
test("抽奖库存未确认时停止，不复用上一响应中的库存", async () => {
  const config = base(); config.ActFestivalConf[3] = act(13, 24, { parameters: [200, 40009, 40001] });
  let draws = 0;
  const send = async cmd => {
    if (cmd === "activity_maydaylottery") { draws++; return { role: {} }; }
    if (cmd === "role_getroleinfo") return { role: { items: { 40009: { quantity: 2 } } } };
    return { activity: { commonActivityInfo: {} } };
  };
  assert.equal((await runRechargeStandard({ send, config, now: () => NOW })).status, "failed");
  assert.equal(draws, 1);
});
test("只领取商店零价格和累计充值零门槛，不购买福卡", async () => {
  const config = base(); config.ActFestivalConf[3] = act(13, 4); config.ActFestivalConf[4] = act(14, 1);
  config.ActMerchandiseConf = { 1: { id: 201, activityID: 13, price: 0, limit: 1 }, 2: { id: 202, activityID: 13, price: 6, limit: 1 } };
  config.CumulativeChargeActConf = { 1: { id: 301, actId: 12, chargeAmount: 0 }, 2: { id: 302, actId: 12, chargeAmount: 6000 } };
  const info = { 13: { record: {} }, 12: { record: {} }, 14: { isBought: false } }; const writes = [];
  const send = async (cmd, params) => {
    if (cmd === "activity_commonbuygoods") { writes.push(params.goodsId); info[13].record[201] = 1; }
    if (cmd === "common_claimtotalreward") { writes.push(params.configId); info[12].record[301] = 1; }
    return { activity: { commonActivityInfo: clone(info) } };
  };
  await runRechargeStandard({ send, config, now: () => NOW });
  await runRechargeStandard({ send, config, now: () => NOW });
  assert.deepEqual(writes, [201, 301]);
});
test("生日先祝福、领奖再按任务ID邀请；当天已邀请计入两次上限", async () => {
  const config = base(); config.ActFestivalConf[3] = act(13, 13);
  config.SingleSignConf = { 1: { id: 1, isShare: 1 }, 2: { id: 2, isShare: 1 }, 3: { id: 3, isShare: 1 } };
  config.GlobalSignConf = {};
  const info = { fullServerSignCnt: 0, signCelebrate: { personalSignMap: {}, personalClaimMap: { 1: { claimCnt: 2, signState: 2, shareTime: NOW }, 2: { claimCnt: 1, signState: 2 }, 3: { claimCnt: 1, signState: 2 } }, fullServerClaimMap: {} } };
  const writes = [];
  const send = async (cmd, params) => {
    if (cmd === "activity_get") return { activity: { commonActivityInfo: {} } };
    if (cmd === "celebrate_sign") { writes.push("sign"); info.signCelebrate.personalSignMap.today = NOW; }
    if (cmd === "celebrate_share") { writes.push(params.id); info.signCelebrate.personalClaimMap[params.id].signState = 1; }
    if (cmd === "celebrate_claimpersonal") { const state = info.signCelebrate.personalClaimMap[params.idList[0]]; state.claimCnt++; state.signState = 2; state.shareTime = NOW; }
    return clone(info);
  };
  await runRechargeStandard({ send, config, now: () => NOW });
  assert.deepEqual(writes, ["sign", 2]);
});
test("用户停止中断后续阶段", async () => {
  const error = new Error("停止"); error.stopped = true;
  const config = base(); config.ActFestivalConf[3] = act(13, 13);
  await assert.rejects(runRechargeStandard({ send: async () => { throw error; }, config, now: () => NOW }), /停止/);
});

test("预设兑换跳过库存不足项，继续兑换后续可用物品，各账号独立核对", async () => {
  for (const stock of [0, 2]) {
    const account = server({ stock });
    const logs = [];
    await exchangeRechargeItems({ ...account, config: base(), expectedActivityId: 11, now: () => NOW, skipUnavailable: true,
      selection: [{ goodsId: 101, quantity: 5 }, { goodsId: 101, quantity: 1 }], log: text => logs.push(text) });
    assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, stock ? 1 : 0);
    assert.ok(logs[0].startsWith("跳过"));
  }
});
test("预设兑换遇到明确拒绝继续下一项，超时仍停止且不重发", async () => {
  for (const rejected of [true, false]) {
    const account = server(); let writes = 0;
    const send = async (cmd, params) => {
      if (cmd === "activity_exchange" && ++writes === 1) {
        const error = new Error(rejected ? "服务器拒绝" : "timeout"); error.serverRejected = rejected; throw error;
      }
      return account.send(cmd, params);
    };
    const task = exchangeRechargeItems({ send, config: base(), expectedActivityId: 11, now: () => NOW, skipUnavailable: true,
      selection: [{ goodsId: 101, quantity: 1 }, { goodsId: 101, quantity: 1 }] });
    if (rejected) { await task; assert.equal(writes, 2); }
    else { await assert.rejects(task, /不自动重试/); assert.equal(writes, 1); }
  }
});

test("公共预设清单按当前manifest配置生成中文物品、成本和顺序，不查询账号", async () => {
  const config = base(); const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => url.includes("/manifest?") ? { body: JSON.stringify({ dataBundleVer: "catalog-test-v1" }) }
      : url.endsWith("config.json") ? config : { LanguageConf: { names: { 奖励: { chinese: "测试奖励" } } } } };
  };
  const catalog = await loadRechargeExchangeCatalog(fetcher, NOW);
  assert.equal(catalog.rows[0].name, "测试奖励");
  assert.equal(catalog.rows[0].consumeNum, 2);
  assert.equal(catalog.activityId, 11);
  assert.equal(catalog.configVersion, "catalog-test-v1");
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(catalog.stock, undefined);
});
