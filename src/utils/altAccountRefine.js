// 当前客户端依据及响应限制见 docs/小号洗练补减伤.md。
export const DEFAULT_ALT_REFINE_LIMIT = 1000;
export const REFINE_PARTS = [1, 2, 3, 4];

export function hasAltRefineTarget(equipment) {
  return Object.values(equipment?.quenches ?? {}).some(
    ({ colorId, attrId }) =>
      (colorId === 5 && attrId === 9) ||
      (colorId === 6 && [1, 9, 14].includes(attrId)),
  );
}

export function hasAltRefineDamageReduction(equipment) {
  return Object.values(equipment?.quenches ?? {}).some(
    ({ colorId, attrId }) => attrId === 9 && [5, 6].includes(colorId),
  );
}

function bodyOf(result) {
  return result?._raw?.body ?? result?.body ?? result;
}

export async function runAltAccountRefine({
  heroId, equipment, jadeQuantity, limit = DEFAULT_ALT_REFINE_LIMIT, send,
  shouldStop = () => false, onUpdate = () => {},
  wait = () => Promise.resolve(),
}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("白玉使用次数上限必须为正整数");
  }
  let count = 0;
  const completedParts = [];
  const finish = (reason) => ({ reason, count, completedParts: completedParts.filter(p => hasAltRefineTarget(equipment[p])) });
  // 最后一轮只重洗武器，开始后持续追减伤，不再接受攻击/技能伤害。
  for (const [index, part] of [...REFINE_PARTS, 1].entries()) {
    const damageReductionStage = index === REFINE_PARTS.length;
    if (damageReductionStage && REFINE_PARTS.some(p => hasAltRefineDamageReduction(equipment[p]))) break;
    const matches = damageReductionStage ? hasAltRefineDamageReduction : hasAltRefineTarget;
    if (shouldStop()) return finish("stopped");
    if (!equipment[part]) throw new Error(`未获取到装备${part}的数据，请刷新阵容`);
    while (!matches(equipment[part])) {
      if (shouldStop()) return finish("stopped");
      if (count >= limit) return finish("limit");
      if (jadeQuantity === 0) return finish("jade");
      const current = equipment[part];
      if (current.level < 4000) throw new Error(`装备${part}等级不足4000级`);
      // 小号模式仅使用白玉；锁定孔位可能消耗彩玉，不自动解锁。
      if (Object.values(current.quenches ?? {}).some(s => s.isLocked || s.locked)) {
        throw new Error(`装备${part}存在锁定孔位，请先手动解锁后再使用小号洗练`);
      }
      // 游戏客户端提交当前方案和完整孔位，不能对已有洗练的装备始终传空数据。
      const params = {
        heroId, part,
        quenchId: current.curQuenchId ?? 0,
        quenches: Object.fromEntries(
          Object.entries(current.quenches ?? {}).map(([slot, value]) => [slot, { ...value }]),
        ),
      };
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
      if (result.role?.items?.[1022]?.quantity != null) jadeQuantity = result.role.items[1022].quantity;
      onUpdate({ part, count, damageReductionStage, equipment: equipment[part], items: result.role?.items });
      if (shouldStop()) return finish("stopped");
      if (!matches(equipment[part]) && count >= limit) return finish("limit");
      await wait();
    }
    if (!completedParts.includes(part)) completedParts.push(part);
  }
  return finish("completed");
}
