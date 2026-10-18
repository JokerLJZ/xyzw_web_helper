import test from "node:test";
import assert from "node:assert/strict";
import { formatWarehouseItem, WAREHOUSE_ITEM_NAMES } from "../src/utils/warehouseItemNames.js";

test("历史排除道具及报错道具都有中文名称和编号", () => {
  assert.equal(formatWarehouseItem(5292), "金吉他（5292）");
  assert.equal(formatWarehouseItem(5293), "满天星（5293）");
  for (const id of [5054, 5095, 5128, 5282, 5283, 5284, 5285, 5286, 5288, 6001])
    assert.equal(formatWarehouseItem(id), `${WAREHOUSE_ITEM_NAMES[id]}（${id}）`);
});
test("实时翻译优先，配置缺失或翻译缺失回退，未知编号明确保留", () => {
  const config = { ItemConf: { 5292: { name: "item" } }, LanguageConf: { items: { item: { chinese: "新版道具" } } } };
  assert.equal(formatWarehouseItem(5292, config), "新版道具（5292）");
  config.LanguageConf = {};
  assert.equal(formatWarehouseItem(5292, config), "金吉他（5292）");
  assert.equal(formatWarehouseItem(99999), "未识别道具（99999）");
});
