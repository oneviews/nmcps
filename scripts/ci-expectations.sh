#!/bin/sh
# scripts/ci-expectations.sh
# 「每个 CI 步骤的日志里必须出现哪条结论」的唯一事实源（SSOT）。
#
# 用法：
#   sh scripts/ci-expectations.sh <key>      # 打印该步骤的扩展正则（一行）
#   sh scripts/ci-expectations.sh --list     # 列出全部 key<TAB>正则（按表内顺序）
#
# 为什么单独一个文件：正则原先内联在 `ci.yml` 六个步骤里，改小结措辞时要同步改六处，
# 漏一处就退化成「摘要抽不到结论」。现在 `ci.yml` 只写 key：
#   sh scripts/ci-summary.sh "<标题>" <日志> --expect "$(sh scripts/ci-expectations.sh <key>)" || status=1
# `pnpm check:ci-summary` 会反向断言：ci.yml 的每处调用都带 `--expect`、key 来自本表、
# 表里的 key 都有调用点（不留死条目）、unknown key 有明确报错。
#
# 每条正则对应被测脚本真正打印的小结行：
#   lint        → `$ eslint .`（eslint 成功时不打印 N/N 小结，只能断言「命令真的跑了」）
#   typecheck   → `$ vue-tsc -b --pretty`（同上）
#   i18n        → `✅ 文案自查 10/10 通过`
#   governance  → `结果：1009 通过 / 0 失败 / 0 告警`（check:doc-system 的小结）
#   bff         → `127/127 项通过`
#   ui          → `155/155 项通过`
set -eu

KEYS='lint typecheck i18n governance bff ui'

# 表本体：case 分支即数据，新增步骤 = 加一个 key + 在 ci.yml 加一个调用点
lookup() {
	case $1 in
		lint)
			printf '%s\n' '\$ eslint'
			;;
		typecheck)
			printf '%s\n' 'vue-tsc'
			;;
		i18n)
			printf '%s\n' '文案自查 [0-9]+/[0-9]+ 通过'
			;;
		governance)
			printf '%s\n' '结果：[0-9]+ 通过'
			;;
		bff)
			printf '%s\n' '[0-9]+/[0-9]+ 项通过'
			;;
		ui)
			printf '%s\n' '[0-9]+/[0-9]+ 项通过'
			;;
		*)
			return 1
			;;
	esac
}

case ${1:-} in
	"")
		echo 'usage: sh scripts/ci-expectations.sh <key>|--list' >&2
		exit 2
		;;
	--list)
		for key in $KEYS; do
			printf '%s\t%s\n' "$key" "$(lookup "$key")"
		done
		;;
	*)
		if ! lookup "$1"; then
			echo "unknown key: $1（可用 key：$KEYS）" >&2
			exit 2
		fi
		;;
esac
