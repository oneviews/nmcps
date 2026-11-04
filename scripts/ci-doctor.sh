#!/bin/sh
# scripts/ci-doctor.sh
# CI 运行排查助手（除 fixtures 外只读：不触发 workflow、不改仓库）。
#
# 用法（在仓库根目录执行，需本机已 `gh auth login`，scope 至少 repo）：
#   sh scripts/ci-doctor.sh                    # 概览：最近一次运行、各 job 结论、失败步骤
#   sh scripts/ci-doctor.sh status [run-id]
#   sh scripts/ci-doctor.sh logs [run-id]      # 全量日志 → ci-logs/runs/<id>/full.log，并统计 ✅/❌
#   sh scripts/ci-doctor.sh artifacts [run-id] # 产物 → ci-logs/downloads/<id>/
#   sh scripts/ci-doctor.sh fixtures [run-id]  # 产物回填成 scripts/fixtures/ci-logs/ 六份样本
#   sh scripts/ci-doctor.sh all [run-id]
#
# 省略 run-id 时取最近一次运行。产物与日志目录已被 .gitignore 忽略。
# fixtures 是唯一会写仓库子目录的子命令：它转调 node scripts/check-ci-summary.mjs --from-ci，
# 只回填该次运行里结论为 success 的步骤（失败步骤的日志同样在产物里，绝不当样本）。
set -eu

usage() {
	cat <<'EOF'
用法：sh scripts/ci-doctor.sh [status|logs|artifacts|fixtures|all] [run-id]

  status     最近运行的结论、每个 job 的结论与失败步骤（默认子命令）
  logs       拉全量日志到 ci-logs/runs/<id>/，统计 ✅/❌ 与「N/N 项通过」小结
  artifacts  下载全部产物到 ci-logs/downloads/<id>/，列出文件与大小
  fixtures   把产物回填成 scripts/fixtures/ci-logs/ 的六份样本（会改仓库里的样本与 sha256 清单；
             只取结论为 success 的步骤，等价于 node scripts/check-ci-summary.mjs --from-ci）
  all        status + logs + artifacts

需要：gh CLI 已登录（gh auth login），且当前目录是仓库根。
EOF
}

need_gh() {
	if ! command -v gh >/dev/null 2>&1; then
		echo "❌ 未找到 gh CLI，请先安装并执行 gh auth login" >&2
		exit 1
	fi
	if ! gh auth status >/dev/null 2>&1; then
		echo "❌ gh 未登录或无仓库权限，请执行 gh auth login（scope 至少 repo）" >&2
		exit 1
	fi
}

latest_run_id() {
	gh run list --limit 1 --json databaseId --jq '.[0].databaseId // empty'
}

resolve_run() {
	if [ -n "${1:-}" ]; then
		printf '%s\n' "$1"
		return 0
	fi
	latest=$(latest_run_id)
	if [ -z "$latest" ]; then
		echo "❌ 仓库还没有 workflow 运行记录" >&2
		exit 1
	fi
	printf '%s\n' "$latest"
}

cmd_status() {
	run_id=$1

	echo "── 运行 #$run_id"
	gh run view "$run_id" \
		--json workflowName,headBranch,headSha,event,status,conclusion,url,createdAt \
		--jq '"workflow: \(.workflowName)\nbranch:   \(.headBranch) @ \(.headSha[0:7])\nevent:    \(.event)\nstatus:   \(.status) \(if .conclusion then "/ " + .conclusion else "" end)\nurl:      \(.url)\nstarted:  \(.createdAt)"'

	echo
	echo "── jobs"
	gh run view "$run_id" --json jobs \
		--jq '.jobs[] | "  \(.name) → \(.conclusion // .status)  \(.completedAt // "running")"'

	echo
	echo "── 失败步骤"
	failed=$(gh run view "$run_id" --json jobs \
		--jq '[.jobs[].steps[] | select(.conclusion == "failure") | "  - \(.name)"] | .[]')
	if [ -n "$failed" ]; then
		printf '%s\n' "$failed"
	else
		echo "  （无）"
	fi
	echo
}

cmd_logs() {
	run_id=$1
	dir="ci-logs/runs/$run_id"
	mkdir -p "$dir"

	echo "── 日志 #$run_id → $dir"
	gh run view "$run_id" --log > "$dir/full.log" 2>"$dir/log.err" || true
	if [ ! -s "$dir/full.log" ]; then
		echo "⚠️  首次拉取失败，重试一次" >&2
		gh run view "$run_id" --log > "$dir/full.log" 2>"$dir/log.err" || true
	fi

	if [ -s "$dir/full.log" ]; then
		rm -f "$dir/log.err"
		lines=$(wc -l < "$dir/full.log")
		passed=$(grep -c '✅' "$dir/full.log" || true)
		failed=$(grep -c '❌' "$dir/full.log" || true)
		printf '  行数 %s，✅ %s，❌ %s\n' "$lines" "$passed" "$failed"
		echo "  小结（N/N 项通过）："
		summary=$(grep -E '项通过$' "$dir/full.log" | sed 's/^/    /' || true)
		if [ -n "$summary" ]; then
			printf '%s\n' "$summary"
		else
			echo "    （未找到）"
		fi
	else
		echo "⚠️  全量日志不可用（运行可能仍在进行），退回 --log-failed" >&2
		if [ -s "$dir/log.err" ]; then
			head -n 3 "$dir/log.err" >&2
		fi
	fi

	echo
	echo "── 失败步骤日志"
	gh run view "$run_id" --log-failed > "$dir/failed.log" 2>/dev/null || true
	if [ -s "$dir/failed.log" ]; then
		tail -n 80 "$dir/failed.log"
	else
		echo "  （无）"
	fi
	echo
}

cmd_artifacts() {
	run_id=$1
	dir="ci-logs/downloads/$run_id"
	rm -rf "$dir"
	mkdir -p "$dir"

	echo "── 产物 #$run_id → $dir"
	if ! gh run download "$run_id" -D "$dir"; then
		echo "⚠️  该运行没有可下载的产物，或产物已过期" >&2
		return 0
	fi
	find "$dir" -type f | sort | while IFS= read -r file; do
		printf '  %8s  %s\n' "$(wc -c < "$file")" "${file#"$dir"/}"
	done
	echo
}

cmd_fixtures() {
	run_id=$1

	echo "── 样本回填 #$run_id"
	echo "  只回填该运行里结论为 success 的步骤；出处、样本与 sha256 清单由 node 脚本写入"
	echo
	# exec 让 node 的退出码直接成为本脚本的退出码（有跳过项时是 1）
	exec node scripts/check-ci-summary.mjs --from-ci "$run_id"
}

cmd=${1:-status}
case "$cmd" in
	status | logs | artifacts | fixtures | all)
		if [ "$#" -gt 0 ]; then
			shift
		fi
		;;
	-h | --help | help)
		usage
		exit 0
		;;
	*)
		echo "❌ 未知子命令：$cmd" >&2
		usage
		exit 2
		;;
esac

need_gh
echo "repo: $(gh repo view --json nameWithOwner --jq .nameWithOwner)"
run_id=$(resolve_run "${1:-}")

case "$cmd" in
	status)
		cmd_status "$run_id"
		;;
	logs)
		cmd_logs "$run_id"
		;;
	artifacts)
		cmd_artifacts "$run_id"
		;;
	fixtures)
		cmd_fixtures "$run_id"
		;;
	all)
		cmd_status "$run_id"
		cmd_logs "$run_id"
		cmd_artifacts "$run_id"
		;;
esac
