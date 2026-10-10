// API 依据：magic/api采集/养号/洗练命令.txt、洗练响应.txt，
// 洗练/equipment_confirm橙.txt、equipment_quench.txt、锁定.txt。
export const DEFAULT_ALT_REFINE_LIMIT = 1000;
export const REFINE_PARTS = [1, 2, 3, 4];

export function hasAltRefineTarget(equipment) {
  return Object.values(equipment?.quenches ?? {}).some(
    ({ colorId, attrId }) =>
      (colorId === 5 && attrId === 9) ||
      (colorId === 6 && [1, 9, 14].includes(attrId)),
  );
}

function bodyOf(result) {
  return result?._raw?.body ?? result?.body ?? result;
}

export async function runAltAccountRefine({
  heroId, equipment, limit = DEFAULT_ALT_REFINE_LIMIT, send,
  shouldStop = () => false, onUpdate = () => {},
  wait = () => Promise.resolve(),
}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("白玉使用次数上限必须为正整数");
  }
  let count = 0;
  const completedParts = [];
  const finish = (reason) => ({ reason, count, completedParts });
  for (const part of REFINE_PARTS) {
    if (shouldStop()) return finish("stopped");
    if (!equipment[part]) throw new Error(`未获取到装备${part}的数据，请刷新阵容`);
    while (!hasAltRefineTarget(equipment[part])) {
      if (shouldStop()) return finish("stopped");
      if (count >= limit) return finish("limit");
      const current = equipment[part];
      if (current.level < 4000) throw new Error(`装备${part}等级不足4000级`);
      // 小号模式仅使用白玉；锁定孔位可能消耗彩玉，不自动解锁。
      if (Object.values(current.quenches ?? {}).some(s => s.isLocked || s.locked)) {
        throw new Error(`装备${part}存在锁定孔位，请先手动解锁后再使用小号洗练`);
      }
      const params = { heroId, part, quenchId: 0, quenches: {} };
      let seed = 0;
      if (Object.values(current.quenches ?? {}).some(s => s.colorId >= 5)) {
        const confirmed = bodyOf(await send("equipment_confirm", params));
        seed = confirmed?.role?.heroes?.[heroId]?.equipment?.[part]?.seed;
        if (seed == null) throw new Error("确认洗练未返回seed，已停止");
        equipment[part] = { ...current, seed };
        if (shouldStop()) return finish("stopped");
      }
      const result = bodyOf(await send("equipment_quench", {
        ...params, seed, skipOrange: false,
      }));
      count++;
      const updated = result?.role?.heroes?.[heroId]?.equipment?.[part];
      if (!updated?.quenches) throw new Error("洗练响应缺少装备孔位数据，已停止以避免继续消耗白玉");
      // confirm 只返回 seed，quench 只返回本次装备；保留其他装备及字段。
      equipment[part] = { ...equipment[part], ...updated };
      onUpdate({ part, count, equipment: equipment[part], items: result.role?.items });
      if (shouldStop()) return finish("stopped");
      if (!hasAltRefineTarget(equipment[part]) && count >= limit) return finish("limit");
      await wait();
    }
    completedParts.push(part);
  }
  return finish("completed");
}
