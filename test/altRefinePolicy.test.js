import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAltRefinePolicy, matchesAltRefinePolicy, countAltRefineEquipment } from "../src/utils/altRefinePolicy.js";
const settings = { altRefineCustom: true, altRefineAttrs: [1,9], altRefineMinColor: 5, altRefineCountEnabled: true, altRefineCount: 2, altRefineCountAttr: 9 };
const equip = rows => ({ quenches: Object.fromEntries(rows.map(([attrId,colorId], i) => [i+1,{attrId,colorId}])) });
test("旧设置保持原规则；新配置复制数组，避免批量运行途中修改", () => {
  assert.equal(normalizeAltRefinePolicy({}),null);
  const p=normalizeAltRefinePolicy(settings);assert.deepEqual(p.attrs,[1,9]);assert.notEqual(p.attrs,settings.altRefineAttrs);
});
test("最低颜色筛选基础目标，按装备数而非槽位数计数", () => {
 const p=normalizeAltRefinePolicy(settings);
 const one= equip([[9,5],[9,6]]);
 assert.ok(matchesAltRefinePolicy(one,p));
 assert.equal(countAltRefineEquipment({1:one,2:equip([[1,6]]),3:equip([[9,4]])},p),1);
 assert.equal(countAltRefineEquipment({1:one,2:equip([[9,6]]),3:equip([[9,4]])},p),2);
 assert.equal(matchesAltRefinePolicy(equip([[2,6]]),p),false);
});
test("关闭数量要求后任一命中达标；配置不合法拒绝，不静默降级", () => {
 const p=normalizeAltRefinePolicy({...settings,altRefineCountEnabled:false});
 assert.ok(matchesAltRefinePolicy(equip([[1,6]]),p));
 for(const patch of [{altRefineAttrs:[]},{altRefineMinColor:7},{altRefineCount:5},{altRefineCountAttr:2}]) assert.throws(()=>normalizeAltRefinePolicy({...settings,...patch}));
});
