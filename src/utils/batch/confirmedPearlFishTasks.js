import { createTasksPearlFish } from "./tasksPearlFish.js";

/** 手动与定时入口共用确认，确认期间冻结账号与设置，取消不发送采购请求。 */
export function createConfirmedPearlFishTasks(deps, { confirm, isBusy = () => false, onCancel = () => {} }) {
  let pending = null;
  const run = (taskName) => {
    if (pending) return pending;
    const tokenIds = [...deps.selectedTokens.value];
    if (!tokenIds.length || isBusy()) return Promise.resolve();
    const settings = { ...deps.batchSettings };
    const names = tokenIds.map(id => deps.tokens.value.find(t => t.id === id)?.name || id);
    pending = (async () => {
      try {
        if (!await confirm({ taskName, names, autoUpgrade: settings.pearlFishAutoUpgrade === true })) {
          onCancel();
          return;
        }
        if (isBusy()) return;
        await createTasksPearlFish({ ...deps, selectedTokens: { value: tokenIds }, batchSettings: settings })[taskName]();
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
  return Object.fromEntries(["batchBuyRedFeatherWithPearls", "batchBuyBaguaWithPearls", "batchBuyPearlFish"]
    .map(name => [name, () => run(name)]));
}
