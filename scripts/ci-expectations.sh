#!/bin/sh
# scripts/ci-expectations.sh
# 「每个 CI 步骤的日志里必须出现哪条结论」的唯一事实源（SSOT）。
#
# 用法：
#   sh scripts/ci-expectations.sh <key>      # 打印该步骤的扩展正则（一行）
#   sh scripts/ci-expectations.sh --list     # 列出全部 key<TAB>正则（按表内顺序）
#
# 为什么单独一个文件：正则原先内联在 `ci.yml` 的各个步骤里，改小结措辞时要同步改每一处，
# 漏一处就退化成「摘要抽不到结论」。现在 `ci.yml` 只写 key：
#   sh scripts/ci-summary.sh "<标题>" <日志> --expect "$(sh scripts/ci-expectations.sh <key>)" || status=1
# `pnpm check:ci-summary` 会反向断言：ci.yml 的每处调用都带 `--expect`、key 来自本表、
# 表里的 key 都有调用点（不留死条目）、unknown key 有明确报错。
#
# 每条正则对应被测脚本真正打印的小结行：
#   lint        → `$ eslint .`（eslint 成功时不打印 N/N 小结，只能断言「命令真的跑了」）
#   typecheck   → `$ vue-tsc -b --pretty`（同上）
#   i18n        → `✅ 文案自查 10/10 通过`
#   governance  → `结果：N 通过 / 0 失败 / 0 告警`（check:doc-system 的小结；N 随文档增减变化，不写死）
#   bff         → `107/107 项通过`
#   ui          → `305/305 项通过`
#   lab-terminal → `6/6 项通过（真实 bash + PTY）`
#   lab-api     → `源码守卫 4/4 组通过`（`--source-only`，无 Mininet 依赖）
#   snmp        → `结果：28 通过 / 0 失败`（`check:snmp` 的小结；条数随用例增减变化，不写死）
set -eu

KEYS='lint typecheck i18n governance bff ui lab-terminal lab-api snmp'

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
		lab-terminal)
			# 与 bff / ui 同为「N/N 项通过」，但额外要求真 PTY 的括号说明：脚本被改成
			# 只吐计数、或非 POSIX 静默跳过（没有小结行）都要在这里显形。
			printf '%s\n' '[0-9]+/[0-9]+ 项通过（真实 bash \+ PTY）'
			;;
		lab-api)
			# Mininet 后端源码守卫（`--source-only`）：四组断言跑完才有这一行，
			# 某组被跳过、脚本退化到只打印计数、或 import 失败被当成「跳过」都在这里显形。
			printf '%s\n' '源码守卫 [0-9]+/[0-9]+ 组通过'
			;;
		snmp)
			# SNMP 采集面自检（`NMCPS-ADR-0028`）：条数不写死（加用例不该改表），
			# 但失败数必须是 0 —— 只匹配「结果：N 通过」时，`/ 3 失败` 的行照样命中。
			printf '%s\n' '结果：[0-9]+ 通过 / 0 失败'
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
