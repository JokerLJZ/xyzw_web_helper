export const ALT_REFINE_ATTRIBUTES = ["攻击", "血量", "防御", "速度", "破甲", "破甲抵抗", "精准", "格挡", "减伤", "暴击", "暴击抵抗", "爆伤", "爆伤抵抗", "技能伤害", "免控", "眩晕免疫", "冰冻免疫", "沉默免疫", "流血免疫", "中毒免疫", "灼烧免疫"].map((label, i) => ({ label, value: i + 1 }));
export const ALT_REFINE_COLORS = ["白", "绿", "蓝", "紫", "橙", "红"].map((label, i) => ({ label, value: i + 1 }));

export function normalizeAltRefinePolicy(settings = {}) {
  if (settings.altRefineCustom !== true) return null;
  const attrs = settings.altRefineAttrs;
  const color = settings.altRefineMinColor;
  if (!Array.isArray(attrs) || !attrs.length || attrs.some(id => !ALT_REFINE_ATTRIBUTES.some(a => a.value === id))) throw new Error("请选择有效的目标洗练属性");
  if (!Number.isInteger(color) || color < 1 || color > 6) throw new Error("请选择有效的最低颜色");
  const countEnabled = settings.altRefineCountEnabled === true;
  const count = settings.altRefineCount ?? 1, attr = settings.altRefineCountAttr;
  if (countEnabled && (!attrs.includes(attr) || !Number.isInteger(count) || count < 1 || count > 4)) throw new Error("数量要求需选择目标属性之一，装备数为1至4");
  return { attrs: [...new Set(attrs)], color, countEnabled, count, attr };
}
export function matchesAltRefinePolicy(equipment, policy) {
  const slots = Object.values(equipment?.quenches || {});
  const matching = slots.filter(slot => policy.attrs.includes(slot.attrId) && slot.colorId >= policy.color);
  return matching.length > 0;
}

export function hasAltRefineRequiredAttribute(equipment, policy) {
  return Object.values(equipment?.quenches || {}).some(slot => slot.attrId === policy.attr && slot.colorId >= policy.color);
}
export function countAltRefineEquipment(equipment, policy) {
  return [1,2,3,4].filter(part => hasAltRefineRequiredAttribute(equipment[part], policy)).length;
}
