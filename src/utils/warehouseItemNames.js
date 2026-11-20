import { loadOfficialTaskConfig } from "./officialTaskConfig.js";
import { activityBody } from "./rechargeActivity.js";
import { activityText, mapGet } from "./rechargeActivity.js";

// Official language.json snapshot 0c3a7d906d; live names take priority.
export const WAREHOUSE_ITEM_NAMES = Object.freeze({
  37005: "怪异礼包", 5054: "美梦枕头", 5095: "全服祝福", 5128: "茶叶",
  5282: "令旗", 5283: "玄武灵契", 5284: "威震金徽", 5285: "破阵陨铁",
  5286: "蜜烛", 5288: "金樽", 6001: "金锤", 5292: "金吉他", 5293: "满天星",
});

export function formatWarehouseItem(itemId, config) {
  const key = mapGet(config?.ItemConf, itemId)?.name;
  const translated = key && activityText(config, key);
  const name = translated && translated !== key ? translated : WAREHOUSE_ITEM_NAMES[itemId];
  return name ? `${name}（${itemId}）` : `未识别道具（${itemId}）`;
}

const configs = new Map();
export async function loadWarehouseItemConfig(send, fetcher = globalThis.fetch) {
  const version = activityBody(await send("system_getdatabundlever", { isAudit: false }))?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未取得仓库道具配置版本");
  if (!configs.has(version)) {
    const loading = loadOfficialTaskConfig(version, fetcher, { language: true }).then(config => {
      if (!config.ItemConf || !config.LanguageConf) throw new Error("官方道具或语言配置缺失");
      return { ...config, version };
    });
    configs.set(version, loading);
    loading.catch(() => { if (configs.get(version) === loading) configs.delete(version); });
  }
  return configs.get(version);
}
