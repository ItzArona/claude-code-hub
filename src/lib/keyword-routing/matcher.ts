import type { KeywordRoutingScanTexts } from "@/lib/message-extractor";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

/**
 * 关键词路由匹配结果
 *
 * matchedIn 标记关键词命中的位置：system（系统提示词）或 user（最后一条用户消息）
 */
export interface KeywordRoutingMatch {
  rule: KeywordRoutingRule;
  matchedIn: "system" | "user";
}

/**
 * 创建小写文本数组的惰性缓存
 *
 * 仅在首次遇到大小写不敏感规则时才构建小写副本，且整个匹配调用内只构建一次，
 * 避免对每个 (规则, 文本) 组合重复执行 toLowerCase（文本可能高达 100KB+）
 */
function createLoweredTextsCache(source: readonly string[]): () => readonly string[] {
  let lowered: string[] | null = null;
  return () => {
    if (lowered === null) {
      lowered = source.map((text) => text.toLowerCase());
    }
    return lowered;
  };
}

/**
 * 在扫描文本中查找首个命中的关键词路由规则
 *
 * 语义：
 * - 按传入顺序逐条评估（调用方需保证 priority 升序、id 升序），首个命中即返回
 * - 跳过已禁用的规则（深度防御）
 * - 跳过关键词为空或仅空白字符的规则（空关键词会匹配一切，防御脏数据）
 * - sourceModel 非空时要求与请求模型相等（大小写不敏感，对齐 ProxyModelGuard），否则跳过该规则
 * - 先检查 systemTexts，再检查 lastUserTexts，matchedIn 反映命中位置
 *
 * @param rules - 已按评估顺序排列的规则列表
 * @param texts - 按来源分类的待扫描文本
 * @param requestedModel - 客户端请求的模型名（可能为 null）
 * @returns 首个命中的规则及命中位置，未命中返回 null
 */
export function findMatchingKeywordRoutingRule(
  rules: readonly KeywordRoutingRule[],
  texts: KeywordRoutingScanTexts,
  requestedModel: string | null
): KeywordRoutingMatch | null {
  const loweredSystemTexts = createLoweredTextsCache(texts.systemTexts);
  const loweredLastUserTexts = createLoweredTextsCache(texts.lastUserTexts);

  for (const rule of rules) {
    if (!rule.isEnabled) {
      continue;
    }

    if (rule.keyword.trim().length === 0) {
      continue;
    }

    if (
      rule.sourceModel &&
      rule.sourceModel.toLowerCase() !== (requestedModel ?? "").toLowerCase()
    ) {
      continue;
    }

    // 大小写不敏感时：关键词每条规则只转小写一次，扫描文本走惰性缓存
    const keyword = rule.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
    const systemTexts = rule.caseSensitive ? texts.systemTexts : loweredSystemTexts();
    const lastUserTexts = rule.caseSensitive ? texts.lastUserTexts : loweredLastUserTexts();

    if (systemTexts.some((text) => text.includes(keyword))) {
      return { rule, matchedIn: "system" };
    }

    if (lastUserTexts.some((text) => text.includes(keyword))) {
      return { rule, matchedIn: "user" };
    }
  }

  return null;
}
