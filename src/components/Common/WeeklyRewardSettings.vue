<template>
  <n-space vertical>
    <span>自选大奖</span>
    <n-input-number :value="modelValue" :min="0" :precision="0" @update:value="$emit('update:modelValue', $event ?? 1)" />
    <span style="font-size: 12px; color: #86909c">填写游戏大奖选项序号，从0开始；默认1为万能红。请按游戏当前大奖列表顺序选择。</span>
  </n-space>
</template>
<script setup>
import { NInputNumber, NSpace } from "naive-ui";
defineProps({ modelValue: { type: Number, default: 1 } });
defineEmits(["update:modelValue"]);
</script>
