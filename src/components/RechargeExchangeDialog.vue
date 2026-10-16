<template>
  <n-modal :show="show" preset="card" title="充值活动兑换物品" style="width: min(1000px, 95vw)" @update:show="$emit('update:show', $event)">
    <n-space vertical>
      <n-alert type="info">{{ first?.eventName }} · 活动 {{ first?.activityId }}。填写每个账号要兑换的份数，按下表顺序执行；库存不足或尚未解锁的账号会停止并记录原因。仅兑换您选中的商品。
      </n-alert>
      <div v-for="account in previews" :key="account.tokenId">
        {{ account.tokenName }}：{{ account.itemName }} {{ account.stock }} 个，已累计消耗 {{ account.spent }} 个
      </div>
      <n-alert v-if="mixed" type="warning">所选账号的活动不同，请按同一期活动重新选择账号并查询。
      </n-alert>
      <div style="max-height: 55vh; overflow: auto">
        <table class="exchange-table">
          <thead><tr><th>兑换物品</th><th>每份金道具</th><th>解锁需累计消耗</th><th>各账号可兑份数</th><th>每账号兑换份数</th></tr></thead>
          <tbody>
            <tr v-for="row in first?.rows || []" :key="row.id">
              <td>{{ row.name }} ×{{ row.rewardNum }}</td>
              <td>{{ row.consumeNum }} {{ first.itemName }}</td>
              <td>{{ row.unlockNeed || 0 }}</td>
              <td>{{ capacities(row.id) }}</td>
              <td><n-input-number v-model:value="quantities[row.id]" :min="0" :precision="0" :max="99999" size="small" style="width: 120px" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>每账号预计消耗 {{ totalCost }} 个{{ first?.itemName }}。查询后库存、限购和活动有效期会在兑换前重新核对。</div>
      <n-space justify="end">
        <n-button @click="$emit('update:show', false)">取消</n-button>
        <n-button type="primary" :disabled="mixed || !selection.length" @click="$emit('execute', selection)">批量兑换所选物品</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>
<script setup>
import { computed, reactive, watch } from "vue";
import { NModal, NSpace, NAlert, NButton, NInputNumber } from "naive-ui";
const props = defineProps({ show: Boolean, previews: { type: Array, default: () => [] } });
defineEmits(["update:show", "execute"]);
const quantities = reactive({});
watch(() => props.show, show => { if (show) for (const key of Object.keys(quantities)) delete quantities[key]; });
const first = computed(() => props.previews[0]);
const mixed = computed(() => props.previews.some(row => row.activityId !== first.value?.activityId || row.configVersion !== first.value?.configVersion));
const selection = computed(() => (first.value?.rows || []).filter(row => Number.isSafeInteger(quantities[row.id]) && quantities[row.id] > 0).map(row => ({ goodsId: row.id, quantity: quantities[row.id] })));
const totalCost = computed(() => selection.value.reduce((sum, choice) => sum + choice.quantity * first.value.rows.find(row => row.id === choice.goodsId).consumeNum, 0));
const capacities = id => props.previews.map(account => `${account.tokenName}：${account.rows.find(row => row.id === id)?.max || 0}`).join("；");
</script>
<style scoped>
.exchange-table { width: 100%; border-collapse: collapse; text-align: left; }
.exchange-table th, .exchange-table td { padding: 10px; border-bottom: 1px solid var(--n-border-color, #8884); }
</style>
