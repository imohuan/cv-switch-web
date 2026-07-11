/**
 * codexCatalog.ts — Codex model_catalog.json 生成器
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 背景
 * ─────────────────────────────────────────────────────────────────────────────
 * Codex CLI 在启动时会反序列化 model_catalog_json 指向的 JSON 文件，
 * 反序列化用的是 Rust serde，对应 struct 定义在：
 *
 *   https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs
 *   pub struct ModelInfo { ... }
 *
 * serde 的行为：
 *   - 字段标了 #[serde(default)]          → JSON 中缺失时用类型默认值，不报错
 *   - 字段是 Option<T> 且有 #[serde(default)] → 缺失时为 None，不报错
 *   - 字段是 Option<T> 但无 #[serde(default)] → JSON 中必须存在该 key（值可以是 null）
 *   - 字段无 Option 且无 #[serde(default)]    → JSON 中必须存在且非 null
 *
 * 缺少必填字段时 serde 报错格式：
 *   "missing field `xxx`" — 缺哪个报哪个，修一个出下一个
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 字段必填/可选速查表
 * ─────────────────────────────────────────────────────────────────────────────
 *  ✅ 必填（无 serde default）           ⬜ 可选（有 serde default）
 *
 *  ✅ slug                          String
 *  ✅ display_name                  String
 *  ✅ description                   Option<String>  (可为 null)
 *  ⬜ default_reasoning_level        Option<ReasoningEffort>
 *  ✅ supported_reasoning_levels    Vec<ReasoningEffortPreset>
 *  ✅ shell_type                    ConfigShellToolType
 *  ✅ visibility                    ModelVisibility
 *  ✅ supported_in_api              bool
 *  ✅ priority                      i32
 *  ⬜ additional_speed_tiers        Vec<String>
 *  ⬜ service_tiers                 Vec<ModelServiceTier>
 *  ⬜ default_service_tier          Option<String>
 *  ✅ availability_nux              Option<ModelAvailabilityNux>  (可为 null)
 *  ✅ upgrade                       Option<ModelInfoUpgrade>      (可为 null)
 *  ✅ base_instructions             String
 *  ⬜ model_messages                Option<ModelMessages>
 *  ⬜ include_skills_usage_instructions  bool
 *  ✅ supports_reasoning_summaries  bool
 *  ⬜ default_reasoning_summary      ReasoningSummary
 *  ✅ support_verbosity             bool
 *  ✅ default_verbosity             Option<Verbosity>  (可为 null)
 *  ✅ apply_patch_tool_type         Option<ApplyPatchToolType>  (可为 null)
 *  ⬜ web_search_tool_type          WebSearchToolType
 *  ✅ truncation_policy             TruncationPolicyConfig
 *  ✅ supports_parallel_tool_calls  bool
 *  ⬜ supports_image_detail_original     bool
 *  ⬜ context_window                Option<i64>
 *  ⬜ max_context_window            Option<i64>
 *  ⬜ auto_compact_token_limit      Option<i64>
 *  ⬜ comp_hash                     Option<String>
 *  ⬜ effective_context_window_percent  i64  (default = 95)
 *  ✅ experimental_supported_tools  Vec<String>
 *  ⬜ input_modalities              Vec<InputModality>  (default = [text, image])
 *  ⬜ supports_search_tool          bool
 *  ⬜ use_responses_lite            bool
 *  ⬜ auto_review_model_override    Option<String>
 *  ⬜ tool_mode                     Option<ToolMode>
 *  ⬜ multi_agent_version           Option<MultiAgentVersion>
 *
 * 注意：旧代码中 parallel_tool_calls 是错误字段名，serde 会忽略它，
 *       导致 supports_parallel_tool_calls 缺失 → parse error。
 *       正确字段名是 supports_parallel_tool_calls。
 */

import type { Provider } from '../db.js';
import { codexModels } from './providerConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript 类型定义（镜像 Rust struct，便于 IDE 提示和类型检查）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 推理强度。Rust enum ReasoningEffort，序列化为字符串。
 * 有效值: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
 * 空字符串 "" 会被拒绝。未知字符串作为 Custom(String) 优雅降级。
 */
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/**
 * 推理强度预设项。Rust struct ReasoningEffortPreset。
 * @field effort       - 推理强度等级
 * @field description  - UI 中显示的简短说明
 */
interface ReasoningEffortPreset {
  effort: ReasoningEffort;
  description: string;
}

/**
 * Shell 执行类型。Rust enum ConfigShellToolType，snake_case 序列化。
 * "default"       - 默认 shell 工具
 * "local"         - 本地 shell
 * "unified_exec"  - 统一执行
 * "disabled"      - 禁用 shell
 * "shell_command" - shell 命令模式
 */
type ConfigShellToolType = 'default' | 'local' | 'unified_exec' | 'disabled' | 'shell_command';

/**
 * 模型可见性。Rust enum ModelVisibility，lowercase 序列化。
 * "list" - 在选择器中显示
 * "hide" - 隐藏但可使用
 * "none" - 完全不可见
 */
type ModelVisibility = 'list' | 'hide' | 'none';

/**
 * 截断模式。Rust enum TruncationMode，snake_case 序列化。
 * "tokens" - 按 token 数截断
 * "bytes"  - 按字节数截断
 */
type TruncationMode = 'tokens' | 'bytes';

/**
 * 截断策略配置。Rust struct TruncationPolicyConfig。
 * @field mode  - 截断模式
 * @field limit - 截断上限（token 数或字节数，取决于 mode）
 */
interface TruncationPolicyConfig {
  mode: TruncationMode;
  limit: number;
}

/**
 * 输入模态。Rust enum InputModality，lowercase 序列化。
 * "text"  - 文本输入
 * "image" - 图片输入
 */
type InputModality = 'text' | 'image';

/**
 * ModelInfo — 完整镜像 Rust struct ModelInfo 的 TypeScript 类型。
 * 必填字段用非 Optional 类型，可选字段用 `| null` 或直接省略。
 */
interface ModelInfo {
  // ── 必填：基础标识 ──
  slug: string;
  display_name: string;
  description: string | null;
  // 指定该模型使用的 provider ID，不设置则用顶层 model_provider
  model_provider_ref: string;

  // ── 推理 ──
  default_reasoning_level?: ReasoningEffort;
  supported_reasoning_levels: ReasoningEffortPreset[];

  // ── 工具与执行 ──
  shell_type: ConfigShellToolType;
  supports_parallel_tool_calls: boolean;

  // ── 可见性 ──
  visibility: ModelVisibility;
  supported_in_api: boolean;

  // ── 排序 ──
  priority: number;

  // ── 服务等级（可选，空数组） ──
  service_tiers?: unknown[];

  // ── 指令 ──
  base_instructions: string;

  // ── 推理摘要 ──
  supports_reasoning_summaries: boolean;

  // ── 详略度 ──
  support_verbosity: boolean;
  default_verbosity: null;

  // ── Apply Patch ──
  apply_patch_tool_type: null;

  // ── 截断策略 ──
  truncation_policy: TruncationPolicyConfig;

  // ── 实验性工具 ──
  experimental_supported_tools: string[];

  // ── Option 必须存在但可为 null ──
  availability_nux: null;
  upgrade: null;

  // ── 可选 ──
  context_window?: number;
  input_modalities?: InputModality[];
}

/**
 * ModelsResponse — 顶层 JSON 结构。
 * @field models - 模型列表
 */
interface ModelsResponse {
  models: ModelInfo[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 生成函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 根据 Provider 配置生成 Codex model_catalog.json 内容。
 *
 * 生成的 JSON 严格匹配 ModelInfo 的 serde schema：
 * - 所有无 #[serde(default)] 的字段都会显式写入
 * - Option<T> 无 default 的字段写入 null
 * - 有 #[serde(default)] 的字段按需写入（写了更明确，不写也不会报错）
 *
 * @param provider - 数据库中的 Provider 记录
 * @returns ModelsResponse 对象，调用方负责 JSON.stringify 写入文件
 */
export function generateCodexModelCatalog(provider: Provider): ModelsResponse {
  const { models } = codexModels(provider);

  return {
    models: models.map((item, index): ModelInfo => {
      const modelSlug = item.model;
      const displayName = item.displayName || item.model;
      const contextWindow = Number(item.contextWindow) || 1000000;
      const modalities = (item.inputModalities || ['text', 'image']) as InputModality[];

      return {
        // ── 基础标识 ──
        slug: modelSlug,
        display_name: displayName,
        description: `Custom model ${modelSlug} configured via cc-switch-web`,
        // 强制该模型走 custom provider，否则 Codex 会默认走 OpenAI 内置 provider
        model_provider_ref: 'custom',

        // ── 推理 ──
        // 默认推理强度。Option 有 default，不写也不报错，但写了更明确。
        default_reasoning_level: 'medium',
        // 支持的推理强度列表。必填，不能为空数组（Codex 需要至少一个选项）。
        supported_reasoning_levels: [
          { effort: 'minimal', description: 'Minimal reasoning effort' },
          { effort: 'low', description: 'Low reasoning effort' },
          { effort: 'medium', description: 'Medium reasoning effort' },
          { effort: 'high', description: 'High reasoning effort' },
        ],

        // ── 工具与执行 ──
        // shell 工具类型，default = 标准 shell 执行
        shell_type: 'default',
        // 是否支持并行工具调用。⚠️ 旧代码写成 parallel_tool_calls 是 bug！
        //   serde 会把 parallel_tool_calls 当未知字段忽略，
        //   然后 supports_parallel_tool_calls 缺失 → parse error。
        supports_parallel_tool_calls: item.supportsParallelToolCalls ?? true,

        // ── 可见性 ──
        // list = 在模型选择器中可见
        visibility: 'list',
        // 非 ChatGPT 认证时只显示 supported_in_api=true 的模型
        supported_in_api: true,

        // ── 排序 ──
        // 越小越优先，第一个模型 priority=0
        priority: index,

        // ── 服务等级 ──
        // 有 serde default，空数组即可。自定义 provider 不需要服务等级。
        service_tiers: [],

        // ── 指令 ──
        // 基础系统指令。必填，不能为空字符串（Codex 会用它作为默认 system prompt）。
        base_instructions:
          item.baseInstructions ||
          `You are a helpful coding assistant powered by ${modelSlug}.`,

        // ── 推理摘要 ──
        // 是否支持推理摘要输出
        supports_reasoning_summaries: true,

        // ── 详略度 ──
        // support_verbosity 必填。false = 不支持详略度调节。
        support_verbosity: false,
        // default_verbosity 是 Option<Verbosity> 但无 serde default，
        // 必须在 JSON 中存在该 key。null = 使用模型默认。
        default_verbosity: null,

        // ── Apply Patch 工具 ──
        // Option<ApplyPatchToolType> 无 serde default，必须存在。
        // null = 不使用 apply_patch 工具。非 null 时唯一有效值是 "freeform"。
        apply_patch_tool_type: null,

        // ── 截断策略 ──
        // 工具输出截断策略。必填。
        // mode="tokens" + limit=100000 表示工具输出超过 10 万 token 时截断。
        truncation_policy: { mode: 'tokens', limit: 100000 },

        // ── 实验性工具 ──
        // 必填，空数组 = 不启用实验性工具。
        experimental_supported_tools: [],

        // ── Option 必须存在但可为 null 的字段 ──
        // availability_nux: Option<ModelAvailabilityNux> 无 default
        //   null = 不显示新功能提示
        availability_nux: null,
        // upgrade: Option<ModelInfoUpgrade> 无 default
        //   null = 无推荐升级目标
        //   非 null 时需要 { model: string, migration_markdown: string }
        upgrade: null,

        // ── 可选字段（有 serde default，不写也不报错） ──
        // 上下文窗口大小
        context_window: contextWindow,
        // 输入模态列表
        input_modalities: modalities,
      };
    }),
  };
}

/**
 * 聚合所有 Provider 的模型到一个 model_catalog。
 * 每个模型的 slug 格式为 {providerId}::{modelName}。
 */
export function generateAggregatedModelCatalog(providers: Provider[], modelFilter?: string[]): ModelsResponse {
  const allModels: ModelInfo[] = [];
  let priority = 0;

  for (const provider of providers) {
    const { models } = codexModels(provider);
    for (const item of models) {
      // 如果指定了 modelFilter，只生成选中的模型
      if (modelFilter && modelFilter.length > 0 && !modelFilter.includes(item.model)) {
        continue;
      }
      const modelSlug = item.model;
      const nameSlug = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || provider.id;
      const fullSlug = nameSlug + "::" + modelSlug;
      const displayName = provider.name + " / " + (item.displayName || modelSlug);
      const contextWindow = Number(item.contextWindow) || 1000000;
      const modalities = (item.inputModalities || ["text", "image"]) as InputModality[];

      allModels.push({
        slug: fullSlug,
        display_name: displayName,
        description: provider.name + " → " + modelSlug,
        model_provider_ref: nameSlug,
        default_reasoning_level: "medium",
        supported_reasoning_levels: [
          { effort: "minimal", description: "Minimal reasoning effort" },
          { effort: "low", description: "Low reasoning effort" },
          { effort: "medium", description: "Medium reasoning effort" },
          { effort: "high", description: "High reasoning effort" },
        ],
        shell_type: "default",
        supports_parallel_tool_calls: item.supportsParallelToolCalls ?? true,
        visibility: "list",
        supported_in_api: true,
        priority: priority++,
        service_tiers: [],
        base_instructions: item.baseInstructions || ("You are a helpful coding assistant powered by " + modelSlug + "."),
        supports_reasoning_summaries: true,
        support_verbosity: false,
        default_verbosity: null,
        apply_patch_tool_type: null,
        truncation_policy: { mode: "tokens", limit: 100000 },
        experimental_supported_tools: [],
        availability_nux: null,
        upgrade: null,
        context_window: contextWindow,
        input_modalities: modalities,
      });
    }
  }

  return { models: allModels };
}

