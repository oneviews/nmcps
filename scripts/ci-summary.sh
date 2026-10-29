#!/bin/sh
# scripts/ci-summary.sh
# 用法：sh scripts/ci-summary.sh "<标题>" <日志文件>
#
# 把校验日志的尾部写进 GitHub Actions 的步骤摘要（$GITHUB_STEP_SUMMARY），
# 这样 ✅/❌ 明细直接显示在运行页面，排查时不必拉全量日志；本地运行静默跳过。
set -eu

title=$1
log=$2

if [ -z "${GITHUB_STEP_SUMMARY:-}" ]; then
	echo "（非 CI 环境：跳过步骤摘要）" >&2
	exit 0
fi

{
	printf '### %s\n\n' "$title"
	printf '```\n'
	tail -n 40 "$log"
	printf '```\n\n'
} >> "$GITHUB_STEP_SUMMARY"
