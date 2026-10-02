<template>
  <div>
    <p>勾选需要采购的商品，并设置采购次数。次数为本次任务尝试购买的次数，已售罄或余额不足时记录提示并继续。取消全部商品将只检查并领取达标奖励。</p>
    <n-space vertical>
      <n-space v-for="item in JIANGHU_BLACK_MARKET_GOODS" :key="item.goodsIndex" align="center">
        <n-checkbox :checked="modelValue[item.goodsIndex] > 0" @update:checked="setCount(item.goodsIndex, $event ? 1 : 0)">
          {{ item.label }}（序号 {{ item.goodsIndex }}）
        </n-checkbox>
        <n-input-number :value="modelValue[item.goodsIndex] || 0" :min="0" :max="4" :precision="0" :disabled="!modelValue[item.goodsIndex]" size="small" style="width: 100px" @update:value="setCount(item.goodsIndex, $event)" />
      </n-space>
    </n-space>
    <n-button size="small" style="margin-top: 12px" @click="$emit('update:modelValue', { ...DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES })">恢复默认清单</n-button>
  </div>
</template>

<script setup>
import { NButton, NCheckbox, NInputNumber, NSpace } from "naive-ui";
import { JIANGHU_BLACK_MARKET_GOODS, DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES } from "@/utils/jianghuBlackMarketWeekly.js";
const props = defineProps({ modelValue: { type: Object, required: true } });
const emit = defineEmits(["update:modelValue"]);
const setCount = (index, count) => emit("update:modelValue", { ...props.modelValue, [index]: count || 0 });
</script>
