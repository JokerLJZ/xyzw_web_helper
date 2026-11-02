<template>
  <div class="task-catalog">
    <div class="catalog-toolbar">
      <n-input v-model:value="query" clearable placeholder="搜索任务或分类，如：白玉、报名、月度" class="catalog-search" />
      <n-button :disabled="disabled" @click="$emit('settings')">任务参数设置</n-button>
      <div class="mode-control"><n-switch v-model:value="multiple" :disabled="disabled" /><span>多选任务</span></div>
    </div>

    <nav class="category-nav" aria-label="任务分类">
      <button type="button" class="category-chip" :class="{ active: activeGroup === 'all' }" :aria-pressed="activeGroup === 'all'" @click="activeGroup = 'all'">全部 <span>{{ matchedCount }}</span></button>
      <button v-for="group in groups" :key="group.name" type="button" class="category-chip" :class="{ active: activeGroup === group.name }" :aria-pressed="activeGroup === group.name" @click="activeGroup = group.name">{{ group.label }} <span>{{ group.tasks.length }}</span></button>
    </nav>

    <div v-if="multiple" class="selection-bar">
      <div><strong>已选 {{ selected.length }} 项</strong><span class="selection-note">可跨分类选择，搜索不会清除已选任务</span></div>
      <div class="selection-actions">
        <n-button size="small" :disabled="disabled || !selected.length" @click="selected = []">清空选择</n-button>
        <n-button size="small" type="primary" :disabled="disabled || !canRun || !selected.length" @click="$emit('run', [...selected])">执行已选任务（{{ selected.length }}）</n-button>
      </div>
    </div>
    <p class="hint">{{ multiple ? '按列表顺序执行；每个账号完成所选任务后再切换账号。参数沿用任务设置。' : '点击任务直接执行；需要选择商品或助威对象时，请使用下方专项操作。' }}</p>

    <div class="catalog-sections">
      <section v-for="group in visibleGroups" :key="group.name" class="catalog-group">
        <div class="group-heading"><h4>{{ group.label }}</h4><span>{{ group.tasks.length }} 项任务</span></div>
        <div class="task-grid">
          <template v-for="task in group.tasks" :key="task.value">
            <div v-if="multiple" class="task-option" :class="{ selected: selected.includes(task.value), disabled }">
              <n-checkbox :checked="selected.includes(task.value)" :disabled="disabled" @update:checked="checked => toggle(task.value, checked)">{{ task.label }}</n-checkbox>
            </div>
            <n-button v-else class="task-button" :disabled="disabled || !canRun" @click="$emit('run', [task.value])">{{ task.label }}</n-button>
          </template>
        </div>
      </section>
    </div>
    <n-empty v-if="!groups.length" description="未找到匹配任务，试试其他关键词" />
  </div>
</template>
<script setup>
import { computed, ref, watch } from 'vue';
import { groupTaskCatalog } from '@/utils/batch/taskCatalog.js';
const props = defineProps({ tasks: { type: Array, required: true }, disabled: Boolean, canRun: Boolean });
defineEmits(['run', 'settings']);
const query = ref('');
const multiple = ref(false);
const selected = ref([]);
const activeGroup = ref('all');
const groups = computed(() => groupTaskCatalog(props.tasks, query.value));
const matchedCount = computed(() => groups.value.reduce((count, group) => count + group.tasks.length, 0));
const visibleGroups = computed(() => groups.value.filter(group => activeGroup.value === 'all' || group.name === activeGroup.value));
watch(groups, value => {
  if (activeGroup.value !== 'all' && !value.some(group => group.name === activeGroup.value)) activeGroup.value = 'all';
});
const toggle = (id, checked) => { selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(value => value !== id); };
</script>
<style scoped>
.task-catalog { --catalog-accent: var(--primary-color, #18a058); }
.catalog-toolbar, .mode-control, .selection-bar, .selection-actions, .group-heading { display: flex; align-items: center; gap: 12px; }
.catalog-toolbar { flex-wrap: wrap; }
.catalog-search { flex: 1; min-width: 220px; }
.mode-control { white-space: nowrap; }
.category-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 14px; }
.category-chip { border: 1px solid var(--border-color, #ddd); border-radius: 20px; background: transparent; color: var(--text-secondary, inherit); padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px; transition: background .15s, border-color .15s; }
.category-chip span { margin-left: 5px; opacity: .65; font-size: 12px; }
.category-chip:hover, .category-chip.active { border-color: var(--catalog-accent); color: var(--catalog-accent); background: color-mix(in srgb, var(--catalog-accent) 8%, transparent); }
.category-chip:focus-visible { outline: 2px solid var(--catalog-accent); outline-offset: 2px; }
.selection-bar { justify-content: space-between; flex-wrap: wrap; background: color-mix(in srgb, var(--catalog-accent) 7%, transparent); border: 1px solid color-mix(in srgb, var(--catalog-accent) 25%, transparent); padding: 12px 14px; border-radius: 8px; margin-bottom: 12px; }
.selection-note { display: block; font-size: 12px; color: var(--text-tertiary); margin-top: 3px; }
.hint { color: var(--text-tertiary); margin: 0 0 16px; font-size: 12px; }
.catalog-sections { display: grid; gap: 14px; }
.catalog-group { padding: 16px; border: 1px solid var(--border-color, #ddd); border-radius: 10px; }
.group-heading { justify-content: space-between; margin-bottom: 12px; }
.group-heading h4 { margin: 0; font-size: 14px; border-left: 3px solid var(--catalog-accent); padding-left: 8px; }
.group-heading > span { font-size: 12px; color: var(--text-tertiary); }
.task-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.task-button { width: 100%; height: auto; min-height: 38px; padding: 9px 12px; justify-content: flex-start; }
.task-button :deep(.n-button__content) { white-space: normal; text-align: left; line-height: 1.5; }
.task-option { display: flex; align-items: center; min-height: 38px; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--border-color, #ddd); border-radius: 5px; transition: background .15s, border-color .15s; }
.task-option :deep(.n-checkbox) { width: 100%; }
.task-option.selected { border-color: var(--catalog-accent); background: color-mix(in srgb, var(--catalog-accent) 8%, transparent); }
.task-option:not(.disabled):hover { border-color: var(--catalog-accent); }
@media (max-width: 600px) {
  .catalog-search { flex-basis: 100%; min-width: 0; }
  .catalog-group { padding: 12px; }
  .task-grid { grid-template-columns: 1fr; }
  .selection-actions { width: 100%; justify-content: flex-end; }
}
</style>
