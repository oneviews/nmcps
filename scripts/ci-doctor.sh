#!/bin/sh
# scripts/ci-doctor.sh
# CI 运行排查助手（除 fixtures / drill 外只读：不触发 workflow、不改仓库）。
#
# 用法（在仓库根目录执行，需本机已 `gh auth login`，scope 至少 repo）：
#   sh scripts/ci-doctor.sh                    # 概览：最近一次运行、各 job 结论、失败步骤
#   sh scripts/ci-doctor.sh status [run-id]
#   sh scripts/ci-doctor.sh logs [run-id]      # 全量日志 → ci-logs/runs/<id>/full.log，并统计 ✅/❌
#   sh scripts/ci-doctor.sh artifacts [run-id] # 产物 → ci-logs/downloads/<id>/
#   sh scripts/ci-doctor.sh fixtures [run-id]  # 产物回填成 scripts/fixtures/ci-logs/ 六份样本
#   sh scripts/ci-doctor.sh drill [key]        # 真红演练：注入漂移 → 推临时提交 → 核对 ::error 注解 → 自动回滚
#   sh scripts/ci-doctor.sh all [run-id]
#
# 省略 run-id 时取最近一次运行。产物与日志目录已被 .gitignore 忽略。
# fixtures 是唯一会写仓库子目录的子命令：它转调 node scripts/check-ci-summary.mjs --from-ci，
# 只回填该次运行里结论为 success 的步骤（失败步骤的日志同样在产物里，绝不当样本）。
# 四种重采入口（本地 / CI / doctor / 应急 --seal）何时允许、之后要做什么、被哪条断言抓，
# 见 quickstart 的「CI 样本重采的四个入口」表；这里只做转发，不另立规则。
# drill 不是第五条重采入口，而是**验证**入口：它故意把样本弄漂、等 CI 用 `::error` 注解说出
# 「哪条断言红了、哪份样本漂了」，核对文案后自己回滚。期望文案由本地 `check-ci-summary.mjs`
# 现场生成、不硬编码，所以改断言措辞不会让演练失效。它会往 main 推两次提交（演练 + 回滚），
# 必须先加 --yes；`--dry-run` 只做注入与期望文案核对，不提交、不推送。
set -eu

usage() {
	cat <<'EOF'
用法：sh scripts/ci-doctor.sh [status|logs|artifacts|fixtures|drill|all] [参数]

  status     最近运行的结论、每个 job 的结论与失败步骤（默认子命令）
  logs       拉全量日志到 ci-logs/runs/<id>/，统计 ✅/❌ 与「N/N 项通过」小结
  artifacts  下载全部产物到 ci-logs/downloads/<id>/，列出文件与大小
  fixtures   把产物回填成 scripts/fixtures/ci-logs/ 的六份样本（会改仓库里的样本与 sha256 清单；
             只取结论为 success 的步骤，等价于 node scripts/check-ci-summary.mjs --from-ci）
  drill      真红演练：往样本注入一处漂移，推一次临时提交，等 CI 打出 ::error 注解并与本地
             期望文案逐字核对，然后自动回滚、把回滚那次运行跑到绿
               drill [key] [--yes] [--dry-run]
               key 默认 ui；会往 main 推两次提交，所以必须显式 --yes
               --dry-run 只注入 + 核对本地期望文案，不提交、不推送
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

# ── drill：真红演练（唯一会推提交的子命令）──────────────────────────────
# 演练验证的是「注解链路」而不是「样本对不对」：注入一处漂移后 CI 必须变红，而且 Checks 页的
# 注解必须与本地 `node scripts/check-ci-summary.mjs` 打出来的那行逐字一致。期望文案现场生成，
# 所以断言措辞、编号怎么改，演练都不用跟着改。
DRILL_BRANCH=main
DRILL_KEY_DEFAULT=ui
DRILL_POLL=20
DRILL_TRIES=90

drill_short() { printf '%.7s' "$1"; }

# 把注解的 `%0A` 那套转义还原成 GitHub API 返回的明文（标题与正文两套规矩，见 check-ci-summary.mjs）
drill_unescape() {
	node -e '
		const map = { "0D": "\r", "0A": "\n", "3A": ":", "2C": ",", "25": "%" };
		process.stdout.write(process.argv[1].replace(/%(0D|0A|3A|2C|25)/g, (_, h) => map[h]));
	' "$1"
}

# trap 兜底：任何退出路径都不许把漂移留在工作区或 main 上
drill_cleanup() {
	status=$?
	if [ "${drill_committed:-0}" = 1 ] && [ "${drill_reverted:-0}" != 1 ]; then
		echo "⚠️  演练提交还在 $DRILL_BRANCH 上，开始回滚：$(drill_short "${drill_sha:-}")" >&2
		git checkout "$drill_pre" -- "$drill_file" 2>/dev/null || true
		if git commit -q -m "revert(ci): 演练回滚 $drill_key.log（真红注解已验证，回到 $(drill_short "$drill_pre")）"; then
			drill_reverted=1
			git push -q origin "$DRILL_BRANCH" || echo "❌ 回滚推送失败：请确认 $drill_file 已回到 $(drill_short "$drill_pre") 后手工推送" >&2
		fi
	elif [ "${drill_dirty:-0}" = 1 ]; then
		git checkout -- "$drill_file" 2>/dev/null || true
	fi
	exit "$status"
}

# 某提交的 workflow 运行：等到 completed，把 run id 打到 stdout（进度走 stderr，别污染返回值）
drill_wait_run() {
	sha=$1
	i=0
	while [ "$i" -lt "$DRILL_TRIES" ]; do
		i=$((i + 1))
		line=$(gh run list --limit 15 --json databaseId,headSha,status,conclusion \
			--jq "[.[] | select(.headSha == \"$sha\")] | .[0] | \"\\(.databaseId) \\(.status) \\(.conclusion // \"-\")\"" 2>/dev/null || true)
		set -- $line
		if [ -n "${1:-}" ] && [ "${1:-}" != "null" ]; then
			printf '  [%ss] run %s → %s %s\n' "$((i * DRILL_POLL))" "$1" "${2:-}" "${3:-}" >&2
			if [ "${2:-}" = completed ]; then
				printf '%s\n' "$1"
				return 0
			fi
		fi
		sleep "$DRILL_POLL"
	done
	echo "❌ 等了 $((DRILL_TRIES * DRILL_POLL / 60)) 分钟仍未等到 $sha 的 CI 结束" >&2
	return 1
}

# 某提交上所有 failure 级注解，每行「标题 | 正文」
drill_annotations() {
	for cr in $(gh api "repos/:owner/:repo/commits/$1/check-runs" --jq '.check_runs[].id' 2>/dev/null); do
		gh api "repos/:owner/:repo/check-runs/$cr/annotations" \
			--jq '.[] | select(.annotation_level == "failure") | "\(.title) | \(.message)"' 2>/dev/null || true
	done
}


cmd_drill() {
	key=$DRILL_KEY_DEFAULT
	yes=0
	dry=0
	for arg in "$@"; do
		case "$arg" in
			--yes | -y) yes=1 ;;
			--dry-run) dry=1 ;;
			-*)
				echo "❌ drill 不认识的参数：$arg（用法：drill [key] [--yes] [--dry-run]）" >&2
				exit 2
				;;
			*) key=$arg ;;
		esac
	done

	file="scripts/fixtures/ci-logs/$key.log"
	if [ ! -f "$file" ]; then
		echo "❌ 没有这份样本：$file" >&2
		echo "   可用 key：$(ls scripts/fixtures/ci-logs/*.log | sed 's#.*/##; s#\.log##' | tr '\n' ' ')" >&2
		exit 2
	fi

	need_gh

	if [ "$(git rev-parse --show-toplevel 2>/dev/null || true)" != "$(pwd -P)" ]; then
		echo "❌ 请在仓库根执行（drill 靠 ci.yml 的 push 触发，路径要对得上）" >&2
		exit 1
	fi
	branch=$(git rev-parse --abbrev-ref HEAD)
	if [ "$branch" != "$DRILL_BRANCH" ]; then
		echo "❌ ci.yml 只在 push $DRILL_BRANCH 时跑；drill 要推两次提交，当前分支是 $branch" >&2
		exit 1
	fi
	if [ -n "$(git status --porcelain)" ]; then
		echo "❌ 工作区不干净：drill 要提交并推送，脏文件会被一起卷进去。先 commit 或 stash：" >&2
		git status --short >&2
		exit 1
	fi

	git fetch -q origin "$DRILL_BRANCH"
	drill_pre=$(git rev-parse HEAD)
	remote=$(git rev-parse "origin/$DRILL_BRANCH")
	if [ "$drill_pre" != "$remote" ]; then
		echo "❌ 本地 HEAD（$(drill_short "$drill_pre")）≠ origin/$DRILL_BRANCH（$(drill_short "$remote")）：先 pull / push" >&2
		exit 1
	fi

	drill_key=$key
	drill_file=$file
	drill_committed=0
	drill_reverted=0
	drill_dirty=0
	trap drill_cleanup EXIT

	echo "── 真红演练：$file（基线 $(drill_short "$drill_pre")）"
	# 漂移只动正文：追加一行，不碰 `# source:`（改头部会同时踩 ⑰，就不是 ⑯ 单点了）
	printf '# drill: 注入漂移 %s（随后自动回滚）\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$file"
	drill_dirty=1
	echo "  已注入漂移：$file 尾部多一行（字节变、出处不变 → ⑯ 该红）"

	expected=$(node scripts/check-ci-summary.mjs 2>&1 | grep -a '::error title=' | head -n 1 || true)
	if [ -z "$expected" ]; then
		echo "❌ 本地跑不出期望注解：注入后 check-ci-summary 没红？先让本地自测自身绿了再演练" >&2
		exit 1
	fi
	rest=${expected#::error title=}
	expected_title=$(drill_unescape "${rest%%::*}")
	expected_msg=$(drill_unescape "${rest#*::}")
	expected_line="$expected_title | $expected_msg"
	echo "  期望注解（本地现场生成）："
	echo "    标题：$expected_title"
	echo "    正文：$expected_msg"

	if [ "$dry" = 1 ]; then
		echo "  --dry-run：到此为止，不提交、不推送（工作区已回滚）"
		exit 0
	fi
	if [ "$yes" != 1 ]; then
		echo "❌ drill 会往 $DRILL_BRANCH 推两次提交（演练 + 回滚），必须显式同意：加 --yes（先加 --dry-run 看一遍）" >&2
		exit 2
	fi

	git add "$file"
	git commit -q \
		-m "test(ci): 真红演练：$key.log 注入漂移，验证 ::error 注解上到 Checks（自动回滚）" \
		-m "期望注解：$expected"
	drill_sha=$(git rev-parse HEAD)
	drill_committed=1
	echo
	echo "── 推演练提交 $(drill_short "$drill_sha")"
	git push -q origin "$DRILL_BRANCH"

	drill_run=$(drill_wait_run "$drill_sha") || exit 1
	drill_conclusion=$(gh run view "$drill_run" --json conclusion --jq '.conclusion')
	echo "  演练运行 #$drill_run → $drill_conclusion（期望 failure：样本漂了 ⑯ 必须红）"

	echo
	echo "── 该提交的 failure 级注解"
	observed=$(drill_annotations "$drill_sha")
	if [ -n "$observed" ]; then
		printf '%s\n' "$observed" | sed 's/^/    /'
	else
		echo "    （一条都没有）"
	fi
	observed_line=$(printf '%s\n' "$observed" | grep -aF "$expected_title | " | head -n 1 || true)

	drill_fail=0
	if [ "$drill_conclusion" != failure ]; then
		echo "❌ 演练运行没变红（$drill_conclusion）：样本漂了却没让 ⑯ 红，演练无效" >&2
		drill_fail=1
	fi
	if [ -z "$observed_line" ]; then
		echo "❌ 没有一条 failure 注解的标题以期望标题开头：$expected_title" >&2
		drill_fail=1
	elif [ "$observed_line" != "$expected_line" ]; then
		echo "❌ 注解标题对上了，正文不一致：" >&2
		echo "   期望：$expected_msg" >&2
		echo "   实测：${observed_line#* | }" >&2
		drill_fail=1
	else
		echo "  ✅ 注解与本地期望逐字一致（标题 + 正文）"
	fi

	echo
	echo "── 回滚"
	git checkout "$drill_pre" -- "$file"
	git commit -q -m "revert(ci): 演练回滚 $key.log（真红注解已验证，回到 $(drill_short "$drill_pre")）"
	revert_sha=$(git rev-parse HEAD)
	drill_reverted=1
	git push -q origin "$DRILL_BRANCH"
	echo "  已推回滚提交 $(drill_short "$revert_sha")"

	revert_run=$(drill_wait_run "$revert_sha") || exit 1
	revert_conclusion=$(gh run view "$revert_run" --json conclusion --jq '.conclusion')
	leftover=$(drill_annotations "$revert_sha" | wc -l | tr -d ' ')
	echo "  回滚运行 #$revert_run → $revert_conclusion，failure 注解 $leftover 条"
	if [ "$revert_conclusion" != success ] || [ "$leftover" != 0 ]; then
		echo "❌ 回滚后没回到绿：conclusion=$revert_conclusion，failure 注解=$leftover" >&2
		drill_fail=1
	fi

	git fetch -q origin "$DRILL_BRANCH"
	if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$DRILL_BRANCH")" ]; then
		echo "❌ 收尾不平：工作区不干净或 HEAD ≠ origin/$DRILL_BRANCH" >&2
		drill_fail=1
	fi

	echo
	echo "── 演练结论"
	printf '  样本        %s\n' "$file"
	printf '  基线提交    %s\n' "$(drill_short "$drill_pre")"
	printf '  演练提交    %s（run %s → %s）\n' "$(drill_short "$drill_sha")" "$drill_run" "$drill_conclusion"
	printf '  期望注解    %s\n' "$expected_line"
	printf '  实测注解    %s\n' "${observed_line:-（无）}"
	printf '  回滚提交    %s（run %s → %s，failure 注解 %s 条）\n' "$(drill_short "$revert_sha")" "$revert_run" "$revert_conclusion" "$leftover"
	if [ "$drill_fail" != 0 ]; then
		echo "  ❌ 演练失败：注解链路哪里断了，看上面的对比" >&2
		exit 1
	fi
	echo "  ✅ 演练通过：样本漂 → CI 变红 → Checks 注解点名（标题与正文都和本地一致）→ 自动回滚到绿"
}


cmd=${1:-status}
case "$cmd" in
	status | logs | artifacts | fixtures | drill | all)
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

# drill 不需要 run-id（它自己 push、自己找运行），也不该被 resolve_run 的「最近一次运行」污染
if [ "$cmd" = drill ]; then
	cmd_drill "$@"
	exit $?
fi

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
