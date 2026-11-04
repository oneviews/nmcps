#!/bin/sh
# scripts/ci-summary.sh
# 用法：sh scripts/ci-summary.sh "<标题>" <日志文件>
#
# 把校验结果写进 GitHub Actions 的步骤摘要（$GITHUB_STEP_SUMMARY），
# 让「结论 + 失败明细」出现在摘要最前面，排查时不必展开日志；本地运行静默跳过。
#
# 摘要结构（自上而下）：
#   ① 关键结论：日志里的「结果：N 通过 / M 失败 / K 告警」「N/M 项通过」「文案自查 N/M 通过」
#      「文档体系自测 N/M 通过」等小结行（最多 8 条，按出现顺序）
#   ② 失败明细：`❌` / `error TS…` / `Error:` 开头或含有的行（最多 5 条）
#   ③ 日志尾部 40 行，折叠在 <details> 里（默认收起）
set -eu

title=$1
log=$2

if [ -z "${GITHUB_STEP_SUMMARY:-}" ]; then
	echo "（非 CI 环境：跳过步骤摘要）" >&2
	exit 0
fi

# grep 无匹配时返回 1，`set -e` 下必须兜住
keys=$(grep -aE '结果：[0-9]+ 通过|文档体系自测 [0-9]+/[0-9]+ 通过|[0-9]+/[0-9]+ 项通过|文案自查 [0-9]+/[0-9]+ 通过' "$log" | tail -n 8 || true)
fails=$(grep -aE '❌|error TS[0-9]+|^Error:|Error: ' "$log" | head -n 5 || true)

{
	printf '### %s\n\n' "$title"
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
