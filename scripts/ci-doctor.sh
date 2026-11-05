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
#       也支持 `drill --keys lint,governance` / `drill --keys all` 一次演练多份样本
#   sh scripts/ci-doctor.sh nightly [run-id]   # 核对每周一的定时演练：schedule 运行是否绿、PAT 到期体检报了什么、
#                                             # origin/main 净变更为零、无残留漂移/未关 issue（只读）
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
# `--keys a,b,c` / `--keys all` 一次演练多份样本：⑯ 会给每份漂移样本一行明细，而注解只放
# 首行 + 「共 N 行明细，见日志」，所以批量演练额外验证了「多明细折行」这条路径（单份演练永远
# 只有一行明细，验不到）。注意它仍然只产出一条注解——GitHub 每步 10 条 error 注解的上限靠
# 样本漂移撞不到，脚本只在实测条数 >10 时告警，不假装验过。
set -eu

usage() {
	cat <<'EOF'
用法：sh scripts/ci-doctor.sh [status|logs|artifacts|fixtures|drill|nightly|all] [参数]

  status     最近运行的结论、每个 job 的结论与失败步骤（默认子命令）
  logs       拉全量日志到 ci-logs/runs/<id>/，统计 ✅/❌ 与「N/N 项通过」小结
  artifacts  下载全部产物到 ci-logs/downloads/<id>/，列出文件与大小
  fixtures   把产物回填成 scripts/fixtures/ci-logs/ 的六份样本（会改仓库里的样本与 sha256 清单；
             只取结论为 success 的步骤，等价于 node scripts/check-ci-summary.mjs --from-ci）
  drill      真红演练：往样本注入漂移，推一次临时提交，等 CI 打出 ::error 注解并与本地现场
             生成的期望逐字核对，然后自动回滚、把回滚那次运行跑到绿
               drill [key|--keys a,b,c|all] [--yes] [--dry-run]
               默认 ui；--keys 一次演练多份（⑯ 每份一行明细，注解只放首行 + 「共 N 行」）
               会往 main 推两次提交，所以必须显式 --yes
               --dry-run 只注入 + 核对本地期望，不提交、不推送
  nightly    核对每周一定时演练（只读）：schedule 触发的那次运行绿没绿、运行时到期体检报了什么、
             演练 + 回滚后 origin/main 是否净变更为零、有没有残留漂移或未关的失败 issue
               nightly [run-id]   省略 run-id 时只看最近一次 schedule 运行；还没有就报 ⏳ 并退出 1
                                 （同时自查定时是否被停用、默认分支上有没有 cron）
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

# ── nightly：核对每周一定时演练（只读：不推提交、不改样本）────────────────
# 这条子命令就是「下周一之后人工核对」的脚本化，一次说清四件事：
#   ① `schedule` 触发的那次运行绿没绿（`workflow_dispatch` 的手工演练不算数）；
#   ② 运行里「到期体检」那一步报了什么（PAT 还剩几天 / 根本没有到期时间）；
#   ③ 演练 + 回滚这一对提交之后，`origin/main` 的树是否回到演练之前（净变更为零）；
#   ④ 六份样本上有没有残留 `# drill: 注入漂移`、有没有挂着未关的失败 issue。
# 没有 schedule 运行时不假装绿：退出码 1 + ⏳ 说明「还没到第一次定时触发」，
# 因为「没数据」和「通过」是两件事（与 `--expect` 同一条原则）。
NIGHTLY_WORKFLOW=drill-nightly.yml
NIGHTLY_ISSUE_TITLE='drill-nightly 失败：真红注解链路需要人工看一眼'
NIGHTLY_MARKER='^# drill: 注入漂移'

nightly_problems=0
nightly_bad() {
	nightly_problems=$((nightly_problems + 1))
	echo "❌ $1"
}

cmd_nightly() {
	run_id=${1:-}
	given=1
	if [ -z "$run_id" ]; then
		given=0
		# 只认 schedule：手工 `workflow_dispatch` 演练成功说明不了「每周一还在跑」
		run_id=$(gh run list --workflow "$NIGHTLY_WORKFLOW" --event schedule --limit 1 \
			--json databaseId --jq '.[0].databaseId // empty')
	fi

	echo "── 定时演练 #${run_id:-（无）}"
	if [ -z "$run_id" ]; then
		echo "⏳ 还没有 \`schedule\` 触发的运行（cron 每周一 03:00 UTC）"
		echo "   这次核对无从下结论——别把它当通过，也别关掉这个待办"
		# 干等着是最坏的结果：把「为什么没触发」当场查掉，否则下次、下下次还是同一句 ⏳，
		# 分不清到底是「没到时间」还是「定时任务已被停用 / 默认分支上没有 cron」
		state=$(gh api "repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/workflows/$NIGHTLY_WORKFLOW" \
			--jq .state 2>/dev/null) || state=查不到
		case $state in
		active)
			echo "   工作流状态：active（cron 确实在册，等触发即可）"
			;;
		disabled_inactivity | disabled_manually)
			echo "   ❌ 工作流状态：$state——定时任务没在跑：gh workflow enable $NIGHTLY_WORKFLOW"
			echo "      （仓库 60 天无活动会被 GitHub 自动停用；disabled_manually 是被人手动关的）"
			;;
		*)
			echo "   ⚠️  工作流状态：$state（查不到时先确认 gh 权限，别直接判成「还没到时间」）"
			;;
		esac
		nref=${DOCTOR_REF:-origin/main}
		cron=$(git show "$nref:.github/workflows/$NIGHTLY_WORKFLOW" 2>/dev/null \
			| grep -m1 -o "cron: '[^']*'") || cron=''
		echo "   $nref 上的调度：${cron:-读不到——确认 .github/workflows/$NIGHTLY_WORKFLOW 已在默认分支上}"
		echo "   手工演练查别的运行：sh scripts/ci-doctor.sh nightly <run-id>"
		exit 1
	fi

	# event 与 conclusion 一起取：手工运行即便绿了，event 也会是 workflow_dispatch
	event=$(gh run view "$run_id" --json event --jq .event)
	conclusion=$(gh run view "$run_id" --json conclusion --jq '.conclusion // .status')
	gh run view "$run_id" --json workflowName,event,headSha,status,conclusion,url,createdAt \
		--jq '"workflow: \(.workflowName)\nevent:    \(.event)\ncommit:   \(.headSha[0:7])\nstatus:   \(.status) \(if .conclusion then "/ " + .conclusion else "" end)\nurl:      \(.url)\nstarted:  \(.createdAt)"'

	if [ "$event" != schedule ]; then
		echo "⚠️  这次是 $event 触发，不是 schedule；定时链路仍未验证"
	fi
	if [ "$conclusion" != success ]; then
		nightly_bad "运行 #$run_id 结论是 $conclusion"
		failed=$(gh run view "$run_id" --json jobs \
			--jq '[.jobs[].steps[] | select(.conclusion == "failure") | "  - \(.name)"] | .[]')
		if [ -n "$failed" ]; then
			printf '%s\n' "$failed"
		fi
		echo "   产物 drill-log / 步骤摘要里有明细：sh scripts/ci-doctor.sh logs $run_id"
	fi

	echo
	echo "── 到期体检（PAT 还剩几天）"
	# 日志里既有真输出，也有 GitHub 回显的脚本源码，回显行带颜色转义——但 `gh run view --log` 给的是
	# caret 记法（字面 `^[[36;1m`）而不是 ESC 字节，所以两种都当回显整行剔掉，
	# 否则脚本里那句「401 就该报错」的文字会被当成真的报了错
	preflight=$(gh run view "$run_id" --log 2>/dev/null \
		| grep -a 'Warn early when DRILL_TOKEN' \
		| grep -av -e "$(printf '\033')" -e '\^\[\[' \
		| grep -aoE 'DRILL_TOKEN (到期时间|没有到期时间|距离到期还有|还有|已失效|已过期)[^\r]*|无法体检 DRILL_TOKEN[^\r]*|解析不了 DRILL_TOKEN[^\r]*' \
		| sed 's/[[:space:]]*$//' | sort -u || true)
	if [ -n "$preflight" ]; then
		printf '%s\n' "$preflight" | sed 's/^/  /'
	else
		nightly_bad "这次运行里没找到到期体检的输出（步骤缺失或被跳过）"
	fi

	echo
	echo "── origin/main 收尾状态"
	# 状态检查统一看一个 ref：默认 origin/main；DOCTOR_REF 只给自测用（能用本地 fabricate 的
	# ref 把「残留漂移 / 没回滚 / 树不一致」这些分支真跑一遍，而不用往线上推垃圾提交）
	ref=${DOCTOR_REF:-origin/main}
	if [ "$ref" = origin/main ]; then
		git fetch -q origin main
	fi
	echo "  tip: $(git log -1 --format='%h %s' "$ref")"
	ref_short=$(git rev-parse --short=7 "$ref")

	hit=''
	# `-r` 不能省（少了它 ls-tree 只吐目录名）；这里与 drill-nightly 的兜底步骤看同一批文件
	for f in $(git ls-tree -r --name-only "$ref" -- scripts/fixtures/ci-logs | grep '\.log$' || true); do
		if git show "$ref:$f" | grep -q "$NIGHTLY_MARKER"; then
			hit="$hit $f"
		fi
	done
	if [ -n "$hit" ]; then
		nightly_bad "$ref_short 上有残留漂移：$hit"
	else
		echo "  ✅ 六份样本没有残留 marker"
	fi

	# 净变更为零的硬证据：回滚提交的树 == 演练提交的父提交的树
	rev=$(git log -1 --format=%H --grep='^revert(ci): 演练回滚' "$ref" || true)
	if [ -z "$rev" ]; then
		nightly_bad "$ref_short 上找不到演练的回滚提交（演练可能没回滚）"
	elif ! drift=$(git rev-parse "$rev^" 2>/dev/null); then
		nightly_bad "回滚提交 $(git log -1 --format=%h "$rev") 没有父提交"
	else
		pre=$(git rev-parse "$drift^" 2>/dev/null || true)
		drift_subj=$(git log -1 --format=%s "$drift")
		rev_subj=$(git log -1 --format=%s "$rev")
		case "$drift_subj" in
			'test(ci): 真红演练'*) ;;
			*) nightly_bad "回滚提交的父提交不是演练提交：$drift_subj" ;;
		esac
		back_to=$(printf '%s' "$rev_subj" | sed -n 's/.*回到 \([0-9a-f]\{7,\}\).*/\1/p')
		if [ -n "$pre" ] && [ "$(git rev-parse "$rev^{tree}")" = "$(git rev-parse "$pre^{tree}")" ]; then
			echo "  ✅ 回滚 $(git log -1 --format=%h "$rev") 的树 == 演练前 $(git log -1 --format=%h "$pre") 的树（净变更为零）"
		else
			nightly_bad "回滚后的树与演练前不一致（演练留下了内容变更）"
		fi
		if [ -n "$back_to" ] && [ -n "$pre" ] \
			&& [ "$back_to" != "$(git rev-parse --short=7 "$pre")" ]; then
			nightly_bad "回滚提交写的「回到 $back_to」与演练前提交 $(git rev-parse --short=7 "$pre") 不符"
		fi
	fi

	open=$(gh issue list --state open --search "$NIGHTLY_ISSUE_TITLE in:title" \
		--json number,title --jq '.[] | "#\(.number) \(.title)"' || true)
	if [ -n "$open" ]; then
		nightly_bad "还挂着未关的失败 issue（演练失败过，人工还没接手）"
		printf '%s\n' "$open" | sed 's/^/    /'
	else
		echo "  ✅ 没有未关的 drill-nightly 失败 issue"
	fi

	echo
	if [ "$nightly_problems" -eq 0 ]; then
		if [ "$given" = 1 ]; then
			echo "✅ nightly 体检通过（运行 #$run_id 与 origin/main 收尾状态都正常）"
		else
			echo "✅ nightly 体检通过（定时运行 #$run_id green，origin/main 净变更为零，无残留漂移/未关 issue）"
		fi
		exit 0
	fi
	echo "❌ nightly 体检发现 $nightly_problems 个问题（逐条见上）"
	exit 1
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
		# shellcheck disable=SC2086  # drill_files 是刻意用空格分隔的列表
		git checkout "$drill_pre" -- $drill_files 2>/dev/null || true
		if git commit -q -m "revert(ci): 演练回滚 $drill_keylabel（真红注解已验证，回到 $(drill_short "$drill_pre")）"; then
			drill_reverted=1
			git push -q origin "$DRILL_BRANCH" || echo "❌ 回滚推送失败：请确认 $drill_files 已回到 $(drill_short "$drill_pre") 后手工推送" >&2
		fi
	elif [ "${drill_dirty:-0}" = 1 ]; then
		# shellcheck disable=SC2086
		git checkout -- $drill_files 2>/dev/null || true
	fi
	if [ -n "${tmp_exp:-}" ]; then
		rm -f "$tmp_exp" "${tmp_obs:-}"
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
	keys=$DRILL_KEY_DEFAULT
	yes=0
	dry=0
	while [ "$#" -gt 0 ]; do
		case "$1" in
			--yes | -y)
				yes=1
				shift
				;;
			--dry-run)
				dry=1
				shift
				;;
			--keys)
				if [ "$#" -lt 2 ]; then
					echo "❌ --keys 后面要跟 key 列表（lint,governance）或 all" >&2
					exit 2
				fi
				keys=$2
				shift 2
				;;
			--keys=*)
				keys=${1#--keys=}
				shift
				;;
			-*)
				echo "❌ drill 不认识的参数：$1（用法：drill [key] [--keys a,b,c|all] [--yes] [--dry-run]）" >&2
				exit 2
				;;
			*)
				keys=$1
				shift
				;;
		esac
	done

	available=$(cd scripts/fixtures/ci-logs 2>/dev/null && ls *.log 2>/dev/null | sed 's/\.log$//') || available=""
	if [ -z "$available" ]; then
		echo "❌ 找不到任何样本：scripts/fixtures/ci-logs/*.log" >&2
		exit 2
	fi
	if [ "$keys" = all ]; then
		keys=$(printf '%s' "$available" | paste -sd, -)
	fi

	# key 列表 → 文件列表。一次演练多份样本时，⑯ 会给每份一行明细，
	# 而注解只放首行 + 「共 N 行明细，见日志」——批量演练正好把这条折行路径也验到。
	drill_files=""
	drill_keylabel=""
	seen=" "
	old_ifs=$IFS
	IFS=,
	for k in $keys; do
		IFS=$old_ifs
		if [ -z "$k" ]; then
			IFS=,
			continue
		fi
		case "$seen" in
			*" $k "*)
				IFS=,
				continue
				;;
		esac
		f="scripts/fixtures/ci-logs/$k.log"
		if [ ! -f "$f" ]; then
			echo "❌ 没有这份样本：$f" >&2
			echo "   可用 key：$(printf '%s' "$available" | tr '\n' ' ')" >&2
			exit 2
		fi
		seen="$seen$k "
		drill_files="$drill_files $f"
		drill_keylabel="$drill_keylabel${drill_keylabel:+,}$k"
		IFS=,
	done
	IFS=$old_ifs
	drill_files=${drill_files# }
	if [ -z "$drill_files" ]; then
		echo "❌ key 列表是空的：$keys" >&2
		exit 2
	fi
	drill_count=$(printf '%s\n' $drill_files | wc -l | tr -d ' ')

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

	drill_committed=0
	drill_reverted=0
	drill_dirty=0
	tmp_exp=""
	trap drill_cleanup EXIT

	echo "── 真红演练：$drill_keylabel（$drill_count 份样本，基线 $(drill_short "$drill_pre")）"
	# 漂移只动正文：追加一行，不碰 `# source:`（改头部会同时踩 ⑰，就不是 ⑯ 单点了）
	stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	for f in $drill_files; do
		printf '# drill: 注入漂移 %s（随后自动回滚）\n' "$stamp" >>"$f"
		echo "  已注入漂移：$f 尾部多一行（字节变、出处不变 → ⑯ 该红）"
	done
	drill_dirty=1

	tmp_exp=$(mktemp)
	tmp_obs=$(mktemp)
	local_errors=$(node scripts/check-ci-summary.mjs 2>&1 | grep -a '::error title=' || true)
	if [ -z "$local_errors" ]; then
		echo "❌ 本地跑不出期望注解：注入后 check-ci-summary 没红？先让本地自测自身绿了再演练" >&2
		exit 1
	fi
	printf '%s\n' "$local_errors" | while IFS= read -r line; do
		rest=${line#::error title=}
		printf '%s | %s\n' "$(drill_unescape "${rest%%::*}")" "$(drill_unescape "${rest#*::}")"
	done >"$tmp_exp"
	sort -o "$tmp_exp" "$tmp_exp"
	expected_count=$(wc -l <"$tmp_exp" | tr -d ' ')
	echo "  期望注解（本地现场生成，$expected_count 条）："
	sed 's/^/    /' "$tmp_exp"
	if [ "$expected_count" -gt 10 ]; then
		echo "  ⚠️  本地红了 $expected_count 条断言：GitHub 每步只收 10 条 error 注解，超出的上不了 Checks 页" >&2
	fi


	if [ "$dry" = 1 ]; then
		echo "  --dry-run：到此为止，不提交、不推送（工作区已回滚）"
		exit 0
	fi
	if [ "$yes" != 1 ]; then
		echo "❌ drill 会往 $DRILL_BRANCH 推两次提交（演练 + 回滚），必须显式同意：加 --yes（先加 --dry-run 看一遍）" >&2
		exit 2
	fi

	# shellcheck disable=SC2086  # drill_files 是空格分隔的列表
	git add $drill_files
	git commit -q \
		-m "test(ci): 真红演练：$drill_keylabel 注入漂移，验证 ::error 注解上到 Checks（自动回滚）" \
		-m "期望注解（$expected_count 条）：$(tr '\n' ';' <"$tmp_exp")"
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
	# 标题为空的那条是 Runner 的兜底（Process completed with exit code 1.），不算断言的注解
	: >"$tmp_obs"
	if [ -n "$observed" ]; then
		printf '%s\n' "$observed" | grep -av '^ | ' >"$tmp_obs" || true
	fi
	sort -o "$tmp_obs" "$tmp_obs"
	observed_count=$(wc -l <"$tmp_obs" | tr -d ' ')

	drill_fail=0
	if [ "$drill_conclusion" != failure ]; then
		echo "❌ 演练运行没变红（$drill_conclusion）：样本漂了却没让 ⑯ 红，演练无效" >&2
		drill_fail=1
	fi
	if [ "$observed_count" -gt 10 ]; then
		echo "⚠️  实测 $observed_count 条注解：超过 GitHub 每步 10 条上限，Checks 页上会被截断" >&2
	fi
	if diff -q "$tmp_exp" "$tmp_obs" >/dev/null 2>&1; then
		echo "  ✅ 注解与本地期望逐字一致（$expected_count 条，标题 + 正文）"
	else
		echo "❌ 注解集合与本地期望不一致：期望 $expected_count 条 / 实测 $observed_count 条" >&2
		diff -u "$tmp_exp" "$tmp_obs" 2>/dev/null | tail -n +3 | sed 's/^/   /' >&2 || true
		drill_fail=1
	fi

	echo
	echo "── 回滚"
	# shellcheck disable=SC2086
	git checkout "$drill_pre" -- $drill_files
	git commit -q -m "revert(ci): 演练回滚 $drill_keylabel（真红注解已验证，回到 $(drill_short "$drill_pre")）"
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
	printf '  样本        %s（%s 份）\n' "$drill_keylabel" "$drill_count"
	printf '  基线提交    %s\n' "$(drill_short "$drill_pre")"
	printf '  演练提交    %s（run %s → %s）\n' "$(drill_short "$drill_sha")" "$drill_run" "$drill_conclusion"
	printf '  期望注解    %s 条：\n' "$expected_count"
	sed 's/^/                /' "$tmp_exp"
	printf '  实测注解    %s 条：\n' "$observed_count"
	sed 's/^/                /' "$tmp_obs"
	printf '  回滚提交    %s（run %s → %s，failure 注解 %s 条）\n' "$(drill_short "$revert_sha")" "$revert_run" "$revert_conclusion" "$leftover"
	if [ "$drill_fail" != 0 ]; then
		echo "  ❌ 演练失败：注解链路哪里断了，看上面的对比" >&2
		exit 1
	fi
	echo "  ✅ 演练通过：样本漂 → CI 变红 → Checks 注解点名（标题与正文都和本地一致）→ 自动回滚到绿"
}


cmd=${1:-status}
case "$cmd" in
	status | logs | artifacts | fixtures | drill | nightly | all)
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

# nightly 同理自己找运行（只认 schedule），别被 resolve_run 的「最近一次运行」带偏
if [ "$cmd" = nightly ]; then
	need_gh
	echo "repo: $(gh repo view --json nameWithOwner --jq .nameWithOwner)"
	cmd_nightly "${1:-}"
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
