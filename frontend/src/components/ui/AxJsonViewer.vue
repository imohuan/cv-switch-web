<script setup lang="ts">
/**
 * JsonViewer — 可折叠 JSON 树查看器
 *
 * 递归渲染 JSON 数据，支持展开/折叠节点。
 * 遵循 ax-ui-kit 规范：语义 token 颜色、Material Symbols 图标、text-xs 字号。
 */
import { ref, computed, watch } from 'vue';
import { useLinkify } from './hooks/useLinkify';
import type { JsonPathSegment } from '../../api';

const { linkify } = useLinkify();

const props = withDefaults(
  defineProps<{
    data: unknown;
    nodeKey?: string | number | null;
    isLast?: boolean;
    isRoot?: boolean;
    expandTrigger?: number;
    /** 递归展开/折叠触发器：>0 递归展开，<0 递归折叠，0 无操作 */
    deepExpandTrigger?: number;
    /** 是否启用自动换行 */
    wrapEnabled?: boolean;
    /** 默认全部展开（覆盖 isExpanded 初始值） */
    defaultExpandAll?: boolean;
    /** 当前节点深度（根节点为 0），用于层级展开控制 */
    depth?: number;
    /**
     * 展开级别：
     *   -1 = 全部折叠（仅根节点可见）
     *    0 = 全部展开（无限层级）
     *   N = 只展开前 N 层（depth < N 的节点可见）
     */
    expandLevel?: number;
    /** 本系统最近一次写入时发生变化的 JSON 路径 */
    changedPaths?: JsonPathSegment[][];
    /** 写入时设置的键值对，根节点根据 value 匹配 JSON 叶子节点自动推导 changedPaths */
    changedValues?: Record<string, string>;
    /** 当前递归节点路径 */
    path?: JsonPathSegment[];
  }>(),
  {
    nodeKey: null,
    isLast: false,
    isRoot: false,
    expandTrigger: 0,
    deepExpandTrigger: 0,
    wrapEnabled: true,
    defaultExpandAll: false,
    depth: 0,
    expandLevel: 0,
    changedPaths: () => [],
    changedValues: () => ({}),
    path: () => [],
  },
);

function samePath(left: JsonPathSegment[], right: JsonPathSegment[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function isPathPrefix(prefix: JsonPathSegment[], target: JsonPathSegment[]): boolean {
  return prefix.length <= target.length && prefix.every((segment, index) => segment === target[index]);
}

const parsedData = computed(() => {
  if (typeof props.data === 'string') {
    const trimmed = props.data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { /* ignore */ }
    }
  }
  return props.data;
});

/** 根节点根据 changedValues 自动推导哪些 JSON 叶子节点被改了 */
const derivedPaths = computed(() => {
  if (!props.isRoot) return props.changedPaths;
  if (!props.changedValues || Object.keys(props.changedValues).length === 0) return [];

  const values = new Set(Object.values(props.changedValues).filter(Boolean));
  if (values.size === 0) return [];

  const result: JsonPathSegment[][] = [];

  function walk(obj: unknown, currentPath: JsonPathSegment[]) {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
      if (values.has(obj)) result.push([...currentPath]);
      return;
    }
    if (typeof obj === 'number') {
      if (values.has(String(obj))) result.push([...currentPath]);
      return;
    }
    if (typeof obj === 'boolean') {
      if (values.has(String(obj))) result.push([...currentPath]);
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], [...currentPath, i]);
      }
      return;
    }
    if (typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        walk(val, [...currentPath, key]);
      }
    }
  }

  console.log("[AxJsonViewer] changedValues:", props.changedValues);
  console.log("[AxJsonViewer] values to match:", [...values]);
  walk(parsedData.value, []);
  console.log("[AxJsonViewer] derivedPaths result:", result.map(p => p.join(".")));
  return result;
});

const effectiveChangedPaths = computed(() =>
  props.isRoot ? derivedPaths.value : props.changedPaths,
);

const isChanged = computed(() => effectiveChangedPaths.value.some((changedPath) => samePath(changedPath, props.path)));
const containsChanges = computed(() => effectiveChangedPaths.value.some((changedPath) => isPathPrefix(props.path, changedPath)));

const isExpanded = ref(props.isRoot || props.expandTrigger > 0 || props.defaultExpandAll);
// 向下传递的递归触发器：Ctrl+点击时生成，逐层透传
const childDeepTrigger = ref(0);

/** 是否应基于展开级别显示 */
const expandedByLevel = computed(() => {
  if (props.expandLevel === -1) return false;
  if (props.expandLevel === 0) return true;
  return (props.depth ?? 0) < props.expandLevel;
});

// 初始化时应用 expandLevel
if (expandedByLevel.value) {
  isExpanded.value = true;
} else if (props.expandLevel >= 0 && !expandedByLevel.value && !props.isRoot && !props.defaultExpandAll) {
  isExpanded.value = false;
}

function toggle() {
  isExpanded.value = !isExpanded.value;
}

/** 根节点响应 defaultExpandAll 变化 → 递归传播到所有子节点 */
watch(
  () => props.defaultExpandAll,
  (val) => {
    if (!props.isRoot) return;
    if (!isComplex.value || isEmpty.value) return;

    const newState = !!val;
    isExpanded.value = newState;
    childDeepTrigger.value = newState
      ? Math.abs(childDeepTrigger.value) + 1
      : -(Math.abs(childDeepTrigger.value) + 1);
  },
);

/** 响应 expandLevel 变化：每个节点根据自身 depth 重新计算展开/折叠状态 */
watch(
  () => [props.expandLevel, props.depth] as const,
  () => {
    const shouldExpand = props.isRoot || props.defaultExpandAll || expandedByLevel.value;
    if (isExpanded.value !== shouldExpand) {
      isExpanded.value = shouldExpand;
    }
    // 透传给子节点（子节点也会各自根据 depth 重新计算）
    if (isComplex.value && !isEmpty.value) {
      childDeepTrigger.value = shouldExpand
        ? Math.abs(childDeepTrigger.value) + 1
        : -(Math.abs(childDeepTrigger.value) + 1);
    }
  },
);

/** 响应父级传来的递归展开/折叠：自身先执行，然后原值透传给子级 */
watch(
  () => props.deepExpandTrigger,
  (val) => {
    if (val === 0) return;
    if (!isComplex.value || isEmpty.value) return;

    if (val > 0 && !isExpanded.value) {
      isExpanded.value = true;
    }
    if (val < 0 && isExpanded.value) {
      isExpanded.value = false;
    }
    // 无论自身是否改变，信号必须继续透传给所有子级
    childDeepTrigger.value = val;
  },
);

/** Ctrl + 点击：递归展开/折叠当前节点及所有嵌套子节点 */
function handleToggle(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    if (!isComplex.value || isEmpty.value) {
      isExpanded.value = !isExpanded.value;
      return;
    }
    const newState = !isExpanded.value;
    isExpanded.value = newState;
    // 生成新的触发值：展开用正值，折叠用负值（无论之前值是多少，永远递增绝对值确保触发）
    childDeepTrigger.value = newState
      ? Math.abs(childDeepTrigger.value) + 1
      : -(Math.abs(childDeepTrigger.value) + 1);
  } else {
    toggle();
  }
}

const dataType = computed(() => {
  const val = parsedData.value;
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
});

const isComplex = computed(() => dataType.value === 'object' || dataType.value === 'array');

const isEmpty = computed(() => {
  if (dataType.value === 'object') return Object.keys(parsedData.value as object).length === 0;
  if (dataType.value === 'array') return (parsedData.value as unknown[]).length === 0;
  return false;
});

const itemCount = computed(() => {
  if (dataType.value === 'object') return Object.keys(parsedData.value as object).length;
  if (dataType.value === 'array') return (parsedData.value as unknown[]).length;
  return 0;
});

const openBracket = computed(() => (dataType.value === 'array' ? '[' : '{'));
const closeBracket = computed(() => (dataType.value === 'array' ? ']' : '}'));

function formatValue(val: unknown): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'number') return String(val);
  return String(val);
}

const valueColorClass = computed(() => {
  switch (dataType.value) {
    case 'string':  return 'text-[#b91c1c]';       // red-700 — 字符串
    case 'boolean':
    case 'null':    return 'text-[#0f766e] font-medium'; // teal-700 — 布尔/null
    case 'number':  return 'text-[#2563eb]';        // blue-600 — 数字
    default:        return 'text-primary';
  }
});

watch(
  () => props.expandTrigger,
  (val) => {
    if (val && val > 0) isExpanded.value = true;
    if (val && val < 0) isExpanded.value = false;
  },
);
</script>

<template>
  <div class="json-viewer select-text font-mono text-xs leading-normal" :class="{ 'overflow-x-auto': !props.wrapEnabled && props.isRoot }">
    <!-- 简单值（非对象/数组） -->
    <div
      v-if="!isComplex"
      class="group flex items-start transition-colors"
      :class="isChanged ? 'bg-green-100/80 shadow-[inset_3px_0_0_#22c55e]' : 'hover:bg-surface-container-low/50'"
    >
      <div class="w-4 shrink-0" />
      <div class="flex-1" :class="props.wrapEnabled ? 'min-w-0' : 'min-w-max'">
        <span v-if="nodeKey !== null" class="mr-ax-xs cursor-text text-primary shrink-0">
          <span class="text-outline">'</span>{{ nodeKey }}<span class="text-outline">'</span
          ><span class="text-outline">:</span>
        </span>
        <span :class="['select-all inline-block align-bottom', valueColorClass, props.wrapEnabled ? 'whitespace-pre-wrap break-all' : 'whitespace-nowrap max-w-none']" v-html="linkify(formatValue(data))" />
        <span v-if="!isLast" class="text-outline shrink-0">,</span>
      </div>
    </div>

    <!-- 对象 / 数组 -->
    <div v-else class="group/tree relative">
      <div
        class="flex items-start transition-colors cursor-pointer"
        :class="[
          { 'hover:bg-surface-container-low/50': !isRoot && !isChanged },
          isChanged ? 'bg-green-100/80 shadow-[inset_3px_0_0_#22c55e]' : '',
        ]"
        @click="handleToggle"
      >
        <!-- 折叠箭头 -->
        <div class="relative z-10 w-4 shrink-0 flex items-center justify-center" :class="{ invisible: isEmpty }">
          <span
            class="material-symbols-outlined text-xs text-outline transition-transform duration-200 select-none"
            :class="{ 'rotate-90': isExpanded }"
          >chevron_right</span>
        </div>

        <div class="flex-1 select-text" :class="props.wrapEnabled ? 'min-w-0 flex flex-wrap items-center' : 'min-w-max whitespace-nowrap'">
          <span v-if="nodeKey !== null" class="mr-ax-xs text-primary">
            <span class="text-outline">'</span>{{ nodeKey }}<span class="text-outline">'</span
            ><span class="text-outline">:</span>
          </span>
          <span v-if="containsChanges && !isChanged" class="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="包含本次改动" />
          <span class="text-outline">{{ openBracket }}</span>
          <template v-if="!isExpanded && !isEmpty">
            <span v-if="dataType === 'array'" class="mx-0.5 text-xs tracking-widest text-outline">...</span>
            <span v-else class="ml-ax-xs text-xs text-outline/70">
              {{ itemCount }} 项
            </span>
          </template>
          <span v-if="!isExpanded || isEmpty" class="text-outline">
            <span v-if="!isExpanded && dataType === 'array' && !isEmpty"> </span>{{ closeBracket
            }}<span v-if="!isLast">,</span>
          </span>
        </div>
      </div>

      <!-- 展开的子节点 -->
      <div v-show="isExpanded && !isEmpty" class="relative">
        <div class="absolute top-0 bottom-0 left-[7px] z-0 w-0 border-l border-dashed border-outline-variant/40 transition-colors group-hover/tree:border-outline/50" />
        <div class="relative z-10 pl-4">
          <AxJsonViewer
            v-for="(val, key, index) in (parsedData as Record<string, any>)"
            :key="key"
            :node-key="dataType === 'array' ? null : key"
            :data="val"
            :is-last="index === (dataType === 'array' ? (parsedData as any[]).length : Object.keys(parsedData as object).length) - 1"
            :expand-trigger="expandTrigger"
            :deep-expand-trigger="childDeepTrigger"
            :depth="(props.depth ?? 0) + 1"
            :expand-level="props.expandLevel"
            :default-expand-all="props.defaultExpandAll"
            :is-root="false"
            :wrap-enabled="props.wrapEnabled"
            :changed-paths="effectiveChangedPaths"
            :path="[...props.path, dataType === 'array' ? Number(key) : String(key)]"
          />
        </div>
      </div>

      <!-- 闭合括号 -->
      <div v-show="isExpanded && !isEmpty" class="group-hover/tree:bg-surface-container-low/30">
        <div class="text-outline pl-[7px]">{{ closeBracket }}<span v-if="!isLast">,</span></div>
      </div>
    </div>
  </div>
</template>
