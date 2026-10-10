// 来源：官方配置 config.a7495acce5.json 的 PetConf、PetConstant；game PetModule._sendMerge。
export const PET_MERGE_CONFIG = {
  "101": {
    "name": "大眼海胆",
    "color": 1
  },
  "102": {
    "name": "芽芽蛙",
    "color": 1
  },
  "103": {
    "name": "泡泡蝇",
    "color": 1
  },
  "104": {
    "name": "小幽灵",
    "color": 1
  },
  "201": {
    "name": "你真蚌",
    "color": 2
  },
  "202": {
    "name": "梨嘴鸭",
    "color": 2
  },
  "203": {
    "name": "响尾蜂",
    "color": 2
  },
  "204": {
    "name": "溜溜萝",
    "color": 2
  },
  "301": {
    "name": "冰灯水母",
    "color": 3
  },
  "302": {
    "name": "热狗",
    "color": 3
  },
  "303": {
    "name": "幽影蝶",
    "color": 3
  },
  "304": {
    "name": "烛灵",
    "color": 3
  },
  "401": {
    "name": "潮团兽",
    "color": 4
  },
  "402": {
    "name": "盘牙",
    "color": 4
  },
  "403": {
    "name": "铁头飞猪",
    "color": 4
  },
  "404": {
    "name": "长颈树",
    "color": 4
  },
  "501": {
    "name": "武虾",
    "color": 5
  },
  "502": {
    "name": "拳击狐",
    "color": 5
  },
  "503": {
    "name": "雷帽绒",
    "color": 5
  },
  "504": {
    "name": "灰烬兔",
    "color": 5
  },
  "601": {
    "name": "甲锅龟",
    "color": 6
  },
  "602": {
    "name": "炎鬃狮",
    "color": 6
  },
  "603": {
    "name": "疾风隼",
    "color": 6
  },
  "604": {
    "name": "蛇尾枭",
    "color": 6
  },
  "701": {
    "name": "黄金章鱼",
    "color": 7
  },
  "702": {
    "name": "赤兔马",
    "color": 7
  },
  "703": {
    "name": "玄翎鹤",
    "color": 7
  },
  "704": {
    "name": "食梦貘",
    "color": 7
  }
};

export function selectPetMergePair(role, maxColor = 4) {
  if (!Number.isInteger(maxColor) || maxColor < 1 || maxColor > 6) throw new Error("宠物合成品质范围无效");
  const equipped = role?.pet?.petUId ?? role?.pet?.uId;
  const pets = Object.entries(role?.petData?.pets ?? {}).flatMap(([key, pet]) => {
    const slot = Number(pet?.slot ?? key);
    const color = PET_MERGE_CONFIG[pet?.petId]?.color;
    if (!Number.isInteger(slot) || slot <= 0 || !pet?.uId || typeof pet.uId !== "string" || pet.isLocked !== false || pet.uId === equipped || !color || color > maxColor) return [];
    return [{ ...pet, slot, color }];
  });
  for (let color = 1; color <= maxColor; color++) {
    const same = pets.filter(p => p.color === color).sort((a,b) => (Number(b.level)||0)-(Number(a.level)||0) || a.slot-b.slot);
    for (let i=0; i<same.length; i++) for (let j=i+1; j<same.length; j++) {
      if (same[i].uId === same[j].uId) continue;
      const keep = same[i], consume = same[j];
      return { fromSlotUId: { slot: consume.slot, uId: consume.uId }, toSlotUId: { slot: keep.slot, uId: keep.uId }, inheritSlot: color >= 4 ? keep.slot : 0 };
    }
  }
  return null;
}

export const PET_EGG_ITEMS = [37011, 37012, 37013];
const boardPets = role => Object.entries(role?.petData?.pets ?? {}).filter(([slot, pet]) => Number(slot) > 0 && pet?.uId);
export async function runPetMerge({ getRole, send, openEgg, maxColor = 4, shouldStop = () => false, wait = async () => {}, onResult = () => {} }) {
  if (!Number.isInteger(maxColor) || maxColor < 1 || maxColor > 6) throw new Error("宠物合成品质范围无效");
  let count = 0, eggsOpened = 0, role = await getRole();
  if (!role?.petData?.pets) throw new Error("未获取到完整宠物列表");
  while (!shouldStop()) {
    const capacity = Number(role.petData.unlockedSlot ?? 8);
    if (!Number.isInteger(capacity) || capacity < 8 || capacity > 16) throw new Error("无法确认宠物槽位数量，停止任务");
    const egg = PET_EGG_ITEMS.find(id => Number(role?.items?.[id]?.quantity) > 0);
    const empty = Array.from({ length: capacity }, (_, i) => i + 1).some(slot => !role.petData.pets[slot]?.uId);
    if (egg && empty && openEgg) {
      const quantity = Number(role.items[egg].quantity);
      const beforeCount = boardPets(role).length;
      await openEgg({ itemId: egg });
      const after = await getRole();
      const remaining = after?.items ? Number(after.items[egg]?.quantity ?? 0) : NaN;
      if (!after?.petData?.pets || !Number.isFinite(remaining) || remaining !== quantity - 1 || boardPets(after).length !== beforeCount + 1) {
        throw new Error("开蛋后库存或宠物数量无法确认，停止且不重试");
      }
      eggsOpened++;
      onResult({ eggsOpened, itemId: egg, openedEgg: true });
      role = after;
      if (!shouldStop()) await wait();
      continue;
    }
    const params = selectPetMergePair(role, maxColor);
    if (!params) break;
    const raw = await send(params);
    const result = raw?._raw?.body ?? raw?.body ?? raw;
    count++;
    if (typeof result?.isSuccess !== "boolean") throw new Error("合成响应缺少isSuccess，停止且不重试");
    const after = await getRole();
    if (!after?.petData?.pets) throw new Error("无法确认合成后宠物列表，停止且不重试");
    const beforeCount = boardPets(role).length;
    if (boardPets(after).length >= beforeCount) throw new Error("合成后宠物数量未减少，停止以避免重复消耗");
    onResult({ count, isSuccess: result.isSuccess, params });
    role = after;
    if (!shouldStop()) await wait();
  }
  return { count, eggsOpened, blockedByCapacity: PET_EGG_ITEMS.some(id => Number(role?.items?.[id]?.quantity) > 0), stopped: shouldStop() };
}
