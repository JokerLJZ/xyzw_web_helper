import { createPetTasks } from "./tasksPet.js";

export function createConfirmedPetMergeTask(deps, { confirm, isBusy = () => false, onCancel = () => {} }) {
  let pending;
  return { batchMergePets: () => {
    if (pending) return pending;
    const ids = [...deps.selectedTokens.value];
    if (!ids.length || isBusy()) return Promise.resolve();
    const maxColor = deps.batchSettings?.petMergeMaxColor ?? 4;
    if (!Number.isInteger(maxColor) || maxColor < 1 || maxColor > 6) {
      deps.message.warning("宠物合成品质范围无效");
      return Promise.resolve();
    }
    const names = ids.map(id => deps.tokens.value.find(t => t.id === id)?.name || id);
    pending = (async () => {
      try {
        if (!await confirm({ names, maxColor })) { onCancel(); return; }
        if (isBusy()) return;
        await createPetTasks({ ...deps, selectedTokens: { value: ids }, batchSettings: { ...deps.batchSettings, petMergeMaxColor: maxColor } }).batchMergePets();
      } finally { pending = null; }
    })();
    return pending;
  } };
}
