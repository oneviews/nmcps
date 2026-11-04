#!/bin/sh
# scripts/ci-summary.sh
# 用法：sh scripts/ci-summary.sh "<标题>" <日志文件> [--expect "<扩展正则>"]
#
# 把校验结果写进 GitHub Actions 的步骤摘要（$GITHUB_STEP_SUMMARY），
# 让「结论 + 失败明细」出现在摘要最前面，排查时不必展开日志；本地运行静默跳过。
#
# 摘要结构（自上而下）：
#   ① 关键结论：日志里的「结果：N 通过 / M 失败 / K 告警」「N/M 项通过」「文案自查 N/M 通过」
#      「文档体系自测 N/M 通过」等小结行（最多 8 条，按出现顺序）
#   ② 失败明细：`❌` / `error TS…` / `Error:` 开头或含有的行（最多 5 条）
#   ③ 日志尾部 40 行，折叠在 <details> 里（默认收起）
#
# `--expect "<扩展正则>"` 声明「本步骤的日志里必须出现这条结论」，用于把
# 「校验通过了、但摘要抽不到结论」这种静默降级变成可见失败（校验脚本被跳过、
# 小结措辞被改写、输出被截断……）。缺失时：
#   ① 日志里打 `::error` 注解（Runner 页面 Annotations 变红）
#   ② 摘要顶部写「预期结论缺失」
#   ③ 退出码 1 —— ci.yml 里调用处写成 `sh scripts/ci-summary.sh … || status=1`，
#      于是这一步真正变红，而不是绿着显示一句「没有小结行」
# 不给 `--expect` 时行为不变（退出码 0），摘要里只有「没有小结行」的提示。
set -eu

if [ $# -lt 2 ]; then
	echo 'usage: sh scripts/ci-summary.sh "<标题>" <日志文件> [--expect "<扩展正则>"]' >&2
	exit 2
fi

title=$1
log=$2
expect=""

if [ "${3:-}" = "--expect" ]; then
	if [ $# -lt 4 ] || [ -z "${4:-}" ]; then
		echo 'usage: sh scripts/ci-summary.sh "<标题>" <日志文件> [--expect "<扩展正则>"]' >&2
		exit 2
	fi
	expect=$4
elif [ $# -gt 2 ]; then
	echo "unknown option: ${3}" >&2
	exit 2
fi

# grep 无匹配时返回 1，`set -e` 下必须兜住
missing=0
if [ -n "$expect" ]; then
	hit=$(grep -aE "$expect" "$log" | tail -n 1 || true)
	if [ -z "$hit" ]; then
		missing=1
		printf '::error title=预期结论缺失 (%s)::日志 %s 里没有匹配 /%s/ 的小结行，校验可能没真正执行或摘要措辞改了\n' \
			"$title" "$log" "$expect" || true
	fi
fi

if [ -z "${GITHUB_STEP_SUMMARY:-}" ]; then
	echo "（非 CI 环境：跳过步骤摘要）" >&2
	exit "$missing"
fi

# grep 无匹配时返回 1，`set -e` 下必须兜住
keys=$(grep -aE '结果：[0-9]+ 通过|文档体系自测 [0-9]+/[0-9]+ 通过|[0-9]+/[0-9]+ 项通过|文案自查 [0-9]+/[0-9]+ 通过' "$log" | tail -n 8 || true)
fails=$(grep -aE '❌|error TS[0-9]+|^Error:|Error: ' "$log" | head -n 5 || true)

{
	printf '### %s\n\n' "$title"
	if [ "$missing" = 1 ]; then
		printf '> ⚠️ **预期结论缺失**：本步骤日志里没有匹配 `/%s/` 的结论行（校验可能没真正执行，或摘要措辞被改），已按失败处理。\n\n' "$expect"
	fi
	if [ -n "$keys" ]; then
		printf '**关键结论**\n\n```\n%s\n```\n\n' "$keys"
	else
		printf '**关键结论**：日志里没有「N/N 项通过 / 结果：…」小结行（见下方尾部日志）\n\n'
	fi
	if [ -n "$fails" ]; then
		printf '**失败明细（最多 5 条）**\n\n```\n%s\n```\n\n' "$fails"
	fi
	printf '<details><summary>日志尾部 40 行</summary>\n\n```\n'
	tail -n 40 "$log"
	printf '```\n\n</details>\n\n'
} >> "$GITHUB_STEP_SUMMARY"

exit "$missing"
