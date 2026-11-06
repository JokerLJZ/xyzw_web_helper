import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bon } from "../src/utils/bonProtocol.js";
import { loadShoeToyConfig, planShoePassiveFormation, runShoeToyUpgrade, TOY_REWARD_RECORD } from "../src/utils/shoeToyRunner.js";

// 从2026-11-06官方359abd1cc2/configc.bin提取的皮鞋配置，不含账号数据。
const official = JSON.parse(fs.readFileSync(new URL("./fixtures/shoeToyConfig.json", import.meta.url)));
const copy = value => structuredClone(value);
const makeRole = () => ({
  lord: { level: 4001 }, gold: 100000, items: { 1026: { quantity: 0 }, 1006: { quantity: 0 } },
  statistics: {}, lordWeaponId: 0, lordWeapon: {},
  heroes: Object.fromEntries([107, 110, 104, 106, 204, 223, 101].map((id, index) => [id, { heroId: id, star: index < 2 ? 10 : 30 }])),
  battleTeam: { 0: { heroId: 107 }, 1: { heroId: 110 }, 2: { heroId: 104 }, 3: { heroId: 106 }, 4: { heroId: 204 } },
});
const harness = (options = {}) => {
  let role = options.role || makeRole();
  const config = copy(official);
  // 缩小升级上限使执行流测试聚焦换阵/领取；费用测试单独使用原始官方表。
  config.WeaponConf[2].maxLevel = 2;
  for (const row of Object.values(config.WeaponPassiveConf)) row.passiveMaxLevel = 2;
  const commands = [], events = [];
  let restored = 0, applied = 0, stop = false;
  const send = async (command, params) => {
    commands.push({ command, params });
    if (options.failBefore === command) throw new Error("timeout");
    const shoe = role.lordWeapon[2];
    if (command === "lordweapon_claimopenreward") {
      role.statistics[TOY_REWARD_RECORD] = 1;
      role.items[1026].quantity += 500;
    } else if (command === "lordweapon_unlock") {
      role.items[1026].quantity -= 500;
      role.lordWeapon[2] = { level: 1, passiveSkill: {} };
    } else if (command === "lordweapon_changedefaultweapon") role.lordWeaponId = params.weaponId;
    else if (command === "lordweapon_get" && shoe && !options.noUnlock) {
      // 模拟服务端在查询时同步已开放状态；不将此视为真实服务端触发时机证据。
      const stars = planShoePassiveFormation(role, config).currentStars;
      config.WeaponConf[2].passiveSkill.forEach((id, index) => {
        if (stars >= config.WeaponConf[2].passiveSkillUnlock[index]) shoe.passiveSkill[id] ||= { level: 1 };
      });
    } else if (command === "lordweapon_upgradeactiveskilllevel") {
      const row = Object.values(config.WeaponActiveConf).find(row => row.weaponId === 2 && row.weaponLevel === shoe.level);
      role.items[1026].quantity -= row.activeCost[0].value;
      shoe.level++;
    } else if (command === "lordweapon_upgradepassiveskilllevel") {
      const skill = shoe.passiveSkill[params.skillId];
      const row = config.WeaponPassiveConf[params.skillId];
      role.items[1006].quantity -= row.costItemNum[skill.level];
      role.gold -= row.coinCost[skill.level];
      skill.level++;
      if (options.stopAfterUpgrade) stop = true;
    }
    if (options.failAfter === command) throw new Error("timeout");
    // 模拟奖励/同步增量没有库存或被动；runner必须另查完整快照。
    return { role: { gold: role.gold } };
  };
  return {
    config, role, commands, events, get restored() { return restored; }, get applied() { return applied; },
    run: () => runShoeToyUpgrade({
      send, config, queryRole: async () => ({ role: copy(role) }),
      shouldStop: () => stop,
      log: message => events.push(message),
      applyFormation: async heroes => {
        applied++;
        role.battleTeam = Object.fromEntries(heroes.map(hero => [hero.slot, { heroId: hero.heroId }]));
        if (options.stopDuringFormation) { stop = true; throw Object.assign(new Error("停止"), { stopped: true }); }
      },
      restoreFormation: async () => {
        restored++;
        if (options.failRestore) throw new Error("连接断开");
        role.battleTeam = makeRole().battleTeam;
      },
    }),
  };
};

test("官方皮鞋门槛是80/100/110/130，主动突破读取当前等级费用，被动前置10级", () => {
  assert.deepEqual(official.WeaponConf[2].passiveSkillUnlock, [80, 100, 110, 130]);
  assert.equal(official.WeaponConf[2].passiveLimit, 10);
  const row = Object.values(official.WeaponActiveConf).find(row => row.weaponLevel === 30);
  assert.equal(row.activeCost[0].value, 400);
  assert.equal(official.WeaponPassiveConf[5].costItemNum[1], 160);
});

test("按实际battleTeam统计，最高五星阵容而非所有武将之和；同星保留在阵位置", () => {
  const role = makeRole();
  const plan = planShoePassiveFormation(role, official);
  assert.equal(plan.currentStars, 110);
  assert.equal(plan.maxStars, 150);
  assert.equal(plan.needsChange, true);
  assert.equal(plan.targetHeroes.length, 5);
  assert.deepEqual(plan.targetHeroes.find(hero => hero.heroId === 104), { heroId: 104, slot: 2 });
  role.heroes = new Map(Object.entries(role.heroes).map(([k, v]) => [Number(k), v]));
  role.battleTeam = new Map(Object.entries(role.battleTeam));
  assert.equal(planShoePassiveFormation(role, official).maxStars, 150);
});

test("边界星级与已开放被动不会重复激活或触发多余换阵", () => {
  const role = makeRole();
  role.heroes = { 107: { star: 80 } };
  role.battleTeam = { 0: { heroId: 107 } };
  let plan = planShoePassiveFormation(role, official);
  assert.deepEqual(plan.reachable.map(row => row.skillId), [5]);
  assert.equal(plan.unreachable[0].required - plan.maxStars, 20);
  assert.equal(plan.needsChange, false);
  role.lordWeapon = { 2: { passiveSkill: { 5: { level: 1 } } } };
  assert.equal(planShoePassiveFormation(role, official).reachable.length, 0);
});

test("领取界面礼包使用独立空参数指令，领取后才激活装配，并高星上阵确认被动后恢复", async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(h.commands.slice(0, 4).map(row => row.command), ["lordweapon_get", "lordweapon_claimopenreward", "lordweapon_unlock", "lordweapon_changedefaultweapon"]);
  assert.deepEqual(h.commands[1].params, {});
  assert.equal(h.applied, 1);
  assert.equal(result.openedPassiveCount, 4);
  assert.equal(h.restored, 1);
  assert.equal(h.role.lordWeaponId, 2);
});

test("已领取礼包不再领取；上次达标已永久开放时不换高星阵容", async () => {
  const role = makeRole();
  role.statistics[TOY_REWARD_RECORD] = 1;
  role.lordWeaponId = 2;
  role.lordWeapon[2] = { level: 2, passiveSkill: Object.fromEntries([5, 6, 7, 8].map(id => [id, { level: 1 }])) };
  const h = harness({ role });
  await h.run();
  assert.equal(h.commands.some(row => row.command === "lordweapon_claimopenreward"), false);
  assert.equal(h.applied, 0);
  assert.equal(h.restored, 1);
});

test("礼包超时但领取记录已更新只核对，不重复领取", async () => {
  const h = harness({ failAfter: "lordweapon_claimopenreward" });
  await h.run();
  assert.equal(h.commands.filter(row => row.command === "lordweapon_claimopenreward").length, 1);
});

test("礼包超时未生效停止，不激活也不消耗已有扳手", async () => {
  const h = harness({ failBefore: "lordweapon_claimopenreward" });
  await assert.rejects(h.run(), /礼包领取未确认/);
  assert.equal(h.commands.some(row => row.command === "lordweapon_unlock"), false);
});

test("星级达标但服务端未开放时停止升级并恢复阵容", async () => {
  const h = harness({ noUnlock: true });
  await assert.rejects(h.run(), /触发条件待核实/);
  assert.equal(h.restored, 1);
  assert.equal(h.commands.some(row => row.command === "lordweapon_upgradepassiveskilllevel"), false);
});

test("前一被动不足10级不能升级后一被动，即使精铁充足", async () => {
  const h = harness();
  h.role.items[1006].quantity = 10000;
  const result = await h.run();
  assert.equal(result.passiveUpgraded, 1);
  assert.deepEqual(h.commands.filter(row => row.command === "lordweapon_upgradepassiveskilllevel").map(row => row.params.skillId), [5]);
});

test("按查询最新精铁共享库存，不能把已消耗材料分配给其他被动", async () => {
  const h = harness();
  h.role.items[1006].quantity = 479;
  h.config.WeaponConf[2].passiveLimit = 2;
  const result = await h.run();
  assert.equal(result.passiveUpgraded, 1);
  assert.equal(h.role.items[1006].quantity, 319);
});

test("金币不足保留精铁，不发送升级", async () => {
  const h = harness();
  h.role.items[1006].quantity = 10000;
  h.config.WeaponPassiveConf[5].coinCost[1] = 100001;
  const result = await h.run();
  assert.equal(result.passiveUpgraded, 0);
  assert.equal(h.role.items[1006].quantity, 10000);
});

test("升级超时已生效不重发；未生效停止且恢复", async () => {
  for (const applied of [true, false]) {
    const h = harness({ [applied ? "failAfter" : "failBefore"]: "lordweapon_upgradepassiveskilllevel" });
    h.role.items[1006].quantity = 160;
    if (applied) assert.equal((await h.run()).passiveUpgraded, 1);
    else await assert.rejects(h.run(), /升级未确认/);
    assert.equal(h.restored, 1);
    assert.equal(h.commands.filter(row => row.command === "lordweapon_upgradepassiveskilllevel").length, 1);
  }
});

test("换阵途中停止仍执行恢复，恢复失败单独报错", async () => {
  const h = harness({ stopDuringFormation: true });
  await assert.rejects(h.run(), error => error.stopped === true);
  assert.equal(h.restored, 1);
  const failed = harness({ stopDuringFormation: true, failRestore: true });
  await assert.rejects(failed.run(), /恢复推图默认阵容失败：连接断开/);
  assert.equal(failed.restored, 1);
});

test("账号库存与领取记录独立，不足4001级不领取、不换阵", async () => {
  const a = harness(), b = harness();
  b.role.lord.level = 4000;
  await Promise.all([a.run(), b.run()]);
  assert.equal(b.commands.length, 0);
  assert.equal(b.restored, 0);
  assert.equal(b.role.items[1026].quantity, 0);
});

test("动态配置从当前版本BON读取，JSON缺玩具配置时不猜测旧门槛", async () => {
  const requests = [];
  const config = await loadShoeToyConfig(async (cmd, params) => {
    assert.equal(cmd, "system_getdatabundlever");
    assert.deepEqual(params, { isAudit: false });
    return { dataBundleVer: "shoe-test-version" };
  }, async url => {
    requests.push(url);
    return { ok: true, arrayBuffer: async () => bon.encode(official).buffer };
  });
  assert.equal(config.version, "shoe-test-version");
  assert.match(requests[0], /shoe-test-version\/configc.bin$/);
  await assert.rejects(loadShoeToyConfig(async () => ({ dataBundleVer: "shoe-invalid" }), async () => ({ ok: true, arrayBuffer: async () => bon.encode({}).buffer })), /皮鞋被动配置不完整/);
});


test("主动30到31级使用当前等级400扳手费用，399不足，400只升级一次", async () => {
  for (const quantity of [399, 400]) {
    const h = harness();
    h.role.statistics[TOY_REWARD_RECORD] = 1;
    h.role.lordWeapon[2] = { level: 30, passiveSkill: {} };
    h.role.items[1026].quantity = quantity;
    h.config.WeaponConf[2].maxLevel = 31;
    const result = await h.run();
    assert.equal(result.activeUpgraded, quantity === 400 ? 1 : 0);
    assert.equal(result.finalLevel, quantity === 400 ? 31 : 30);
    assert.equal(h.role.items[1026].quantity, quantity === 400 ? 0 : 399);
  }
});

test("升级期间手动停止不继续消耗，恢复默认阵容后结束", async () => {
  const h = harness({ stopAfterUpgrade: true });
  h.role.items[1006].quantity = 10000;
  await assert.rejects(h.run(), error => error.stopped === true);
  assert.equal(h.commands.filter(row => row.command === "lordweapon_upgradepassiveskilllevel").length, 1);
  assert.equal(h.restored, 1);
});
