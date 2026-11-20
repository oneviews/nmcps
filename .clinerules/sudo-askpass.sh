#!/bin/sh
# sudo -A 的 askpass 助手：把本地口令文件的内容回显给 sudo，口令本身不入库。
#
# 用法（完整说明见同目录 09-local-sudo.md）：
#   SUDO_ASKPASS=$PWD/.clinerules/sudo-askpass.sh sudo -A <command>
#
# 口令文件默认是本目录的 .sudo.local（git-ignored，chmod 600）。
# sudo 会清理环境变量，所以改成别的路径要配 `sudo -E`（或改本脚本的默认值）。
set -eu

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
file=${NMCPS_SUDO_PASS_FILE:-"$dir/.sudo.local"}

if [ ! -r "$file" ]; then
	echo "sudo-askpass: 读不到口令文件 $file —— 见 .clinerules/09-local-sudo.md" >&2
	exit 1
fi

exec head -n 1 "$file"
